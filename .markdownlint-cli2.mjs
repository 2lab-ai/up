import { execFileSync } from "node:child_process";

// Skip every directory git ignores (.gitignore and .git/info/exclude), e.g. local clones and caches.
let gitIgnoredDirectories = [];
try {
  gitIgnoredDirectories = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((entry) => entry.endsWith("/"))
    .map((entry) => `${entry}**`);
} catch {
  gitIgnoredDirectories = [];
}

export default {
  ignores: [
    ...gitIgnoredDirectories,
    ".codex-artifact-work/**",
    ".ko-work/**",
    "scripts/ko/prompts/**",
    "outputs/**",
    "docs/.vitepress/dist/**",
    "playwright-report/**",
    "test-results/**",
  ],
  config: {
    default: true,
    MD013: false,
    MD024: false,
    MD025: false,
    MD026: false,
    MD029: false,
    MD033: false,
    MD036: false,
    MD040: false,
    MD041: false,
    MD051: false,
    MD053: false,
    MD060: false,
  },
};
