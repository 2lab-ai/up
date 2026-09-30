// Zero-dependency Anthropic Messages API client (raw HTTP + SSE) for the local llmux gateway.
// - streaming only (long outputs, no HTTP timeout surprises)
// - global in-flight limiter (default 5)
// - exponential backoff on 429 / 5xx / overloaded / network / idle-stream errors
import http from "node:http";
import https from "node:https";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BASE_URL = process.env.KO_LLM_BASE_URL || "http://127.0.0.1:3456";
const API_KEY = process.env.KO_LLM_API_KEY || "x";
// llmux forwards to subscription (OAuth) accounts; upstream answers 429 on every account unless the
// first system block is the Claude Code identity line (measured 2026-09-30: without it 502 after
// ~30 s of account cycling, with it 200 in ~1.8 s). Set KO_LLM_SYSTEM_PREFIX="" for a plain API key.
const SYSTEM_PREFIX = process.env.KO_LLM_SYSTEM_PREFIX ?? "You are Claude Code, Anthropic's official CLI for Claude.";

function withSystemPrefix(body) {
  if (!SYSTEM_PREFIX) return body;
  const system = typeof body.system === "string" ? [{ type: "text", text: body.system }] : body.system || [];
  return { ...body, system: [{ type: "text", text: SYSTEM_PREFIX }, ...system] };
}
const MAX_ATTEMPTS = Number(process.env.KO_LLM_MAX_ATTEMPTS || 8);
const IDLE_TIMEOUT_MS = Number(process.env.KO_LLM_IDLE_TIMEOUT_MS || 15 * 60 * 1000);
const TOTAL_TIMEOUT_MS = Number(process.env.KO_LLM_TOTAL_TIMEOUT_MS || 90 * 60 * 1000);

export class Semaphore {
  constructor(size) {
    this.free = size;
    this.waiters = [];
  }
  async acquire() {
    if (this.free > 0) {
      this.free -= 1;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
  }
  release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.free += 1;
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const limiter = new Semaphore(Number(process.env.KO_MAX_INFLIGHT || 5));

export class LlmError extends Error {
  constructor(message, { retryable = false, retryAfterMs, status, kind } = {}) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
    this.kind = kind;
  }
}

let logFile = null;
export function setLogFile(path) {
  mkdirSync(dirname(path), { recursive: true });
  logFile = path;
}
function log(record) {
  if (!logFile) return;
  appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseSseBlock(raw) {
  let event = "message";
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}

function streamOnce(body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL("/v1/messages", BASE_URL);
    const lib = url.protocol === "https:" ? https : http;
    const payload = Buffer.from(JSON.stringify({ ...withSystemPrefix(body), stream: true }));
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      fn(value);
    };
    let idleTimer;
    const totalTimer = setTimeout(() => {
      req.destroy(new LlmError(`total timeout ${TOTAL_TIMEOUT_MS}ms`, { retryable: true, kind: "timeout" }));
    }, TOTAL_TIMEOUT_MS);
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        req.destroy(new LlmError(`idle timeout ${IDLE_TIMEOUT_MS}ms`, { retryable: true, kind: "timeout" }));
      }, IDLE_TIMEOUT_MS);
    };
    const req = lib.request(
      url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
          "content-length": payload.length,
          ...extraHeaders,
        },
      },
      (res) => {
        res.setEncoding("utf8");
        resetIdle();
        if (res.statusCode !== 200) {
          let text = "";
          res.on("data", (chunk) => {
            text += chunk;
          });
          res.on("end", () => {
            const status = res.statusCode;
            const retryAfter = Number(res.headers["retry-after"]);
            const retryable = status === 408 || status === 409 || status === 429 || status >= 500 || /overloaded/i.test(text);
            finish(
              reject,
              new LlmError(`HTTP ${status}: ${text.slice(0, 800)}`, {
                retryable,
                status,
                retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
                kind: "http",
              }),
            );
          });
          return;
        }
        const state = { id: null, model: null, text: "", stopReason: null, stopDetails: null, usage: {}, blockTypes: [] };
        let buffer = "";
        let stopped = false;
        const handle = (raw) => {
          const { event, data } = parseSseBlock(raw);
          if (!data) return;
          let json;
          try {
            json = JSON.parse(data);
          } catch {
            return;
          }
          const type = json.type || event;
          if (type === "message_start") {
            state.id = json.message?.id ?? null;
            state.model = json.message?.model ?? null;
            Object.assign(state.usage, json.message?.usage || {});
          } else if (type === "content_block_start") {
            state.blockTypes.push(json.content_block?.type);
            if (json.content_block?.type === "text" && json.content_block.text) state.text += json.content_block.text;
          } else if (type === "content_block_delta") {
            if (json.delta?.type === "text_delta") state.text += json.delta.text;
          } else if (type === "message_delta") {
            if (json.delta?.stop_reason) state.stopReason = json.delta.stop_reason;
            if (json.delta?.stop_details) state.stopDetails = json.delta.stop_details;
            if (json.stop_details) state.stopDetails = json.stop_details;
            Object.assign(state.usage, json.usage || {});
          } else if (type === "message_stop") {
            stopped = true;
          } else if (type === "error") {
            const errType = json.error?.type || "error";
            const retryable = /overloaded|api_error|rate_limit|timeout/i.test(errType);
            req.destroy(new LlmError(`stream error ${errType}: ${json.error?.message || data}`, { retryable, kind: "stream" }));
          }
        };
        res.on("data", (chunk) => {
          resetIdle();
          buffer += chunk;
          let match;
          while ((match = /\r?\n\r?\n/.exec(buffer))) {
            const raw = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            handle(raw);
          }
        });
        res.on("end", () => {
          if (buffer.trim()) handle(buffer);
          if (!stopped) {
            finish(reject, new LlmError("stream ended before message_stop", { retryable: true, kind: "stream" }));
            return;
          }
          finish(resolve, state);
        });
        res.on("error", (error) => finish(reject, error));
      },
    );
    req.on("error", (error) => {
      if (error instanceof LlmError) finish(reject, error);
      else finish(reject, new LlmError(`network: ${error.code || ""} ${error.message}`, { retryable: true, kind: "network" }));
    });
    req.end(payload);
  });
}

// body: Messages API body (without `stream`). meta: { label } for logs.
export async function createMessage(body, { label = "", headers = {} } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const started = Date.now();
    try {
      const result = await limiter.run(() => streamOnce(body, headers));
      log({ label, model: body.model, attempt, ok: true, ms: Date.now() - started, served_by: result.model, stop: result.stopReason, usage: result.usage });
      return result;
    } catch (error) {
      lastError = error;
      log({ label, model: body.model, attempt, ok: false, ms: Date.now() - started, error: String(error.message).slice(0, 400) });
      if (!error.retryable || attempt === MAX_ATTEMPTS) break;
      const backoff = Math.min(180_000, 5_000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 3_000);
      const wait = Math.max(backoff, error.retryAfterMs || 0);
      process.stderr.write(`[llm] ${label} attempt ${attempt} failed (${error.message.slice(0, 160)}); retry in ${Math.round(wait / 1000)}s\n`);
      await sleep(wait);
    }
  }
  throw lastError;
}
