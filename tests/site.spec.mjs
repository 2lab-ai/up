import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { navigation, publicationChapterCount, toSidebar } from "../docs/.vitepress/navigation.mjs";

const SITE_URL = "https://dosi.dev/up/";
const REPOSITORY_URL = "https://github.com/2lab-ai/up";
const ORIGINAL_REPOSITORY_URL = "https://github.com/byoungd/up";
const MANUAL_PAGER = /^(?:이전 글|다음 글|다음 부|다음 파트|홈으로 돌아가기|처음으로)\s*[：:]/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const headingFromSource = (source) => {
  const file = resolve(process.cwd(), "docs", source);
  const heading = readFileSync(file, "utf8").match(/^# (.+)$/m)?.[1];
  if (!heading) throw new Error(`내비게이션 source에 1단계 제목이 없습니다: ${source}`);
  return heading;
};

const textPattern = (text) => new RegExp(escapeRegExp(text));

const structuredDataFromPage = async (page) =>
  JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());

const routesFromNavigation = (groups) =>
  groups.flatMap(({ items }) =>
    items.map(({ link, source }) => [link === "/" ? "./" : `.${link}`, headingFromSource(source)]),
  );

const routes = routesFromNavigation(navigation);
const expectedBuildRevision = process.env.GITHUB_SHA || process.env.BUILD_REVISION || "local";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const group = (text) => navigation.find((entry) => entry.text === text);
const readDoc = (source) => readFileSync(resolve(process.cwd(), "docs", source), "utf8");

test("start here leads from the home page into the reader guide and prologue", () => {
  expect(group("시작하기")?.items.slice(0, 3).map(({ source }) => source)).toEqual([
    "README.md",
    "threads/part-0/reader-guide.md",
    "threads/part-0/prologue.md",
  ]);
});

test("navigation follows the five-part book arc", () => {
  expect(navigation.slice(1, 7).map(({ text }) => text)).toEqual([
    "제1부: 입력을 열다",
    "제2부: 나를 삶으로 돌려놓다",
    "제3부: 도구로 능력을 키우다",
    "제4부: 실천과 회복",
    "제5부: 행동과 장기적 변화",
    "후기",
  ]);
});

test("every part opens with an introduction", () => {
  expect(navigation.slice(1, 6).map(({ items }) => items[0].source)).toEqual([
    "threads/part-1/open-input.md",
    "threads/part-2/return-to-life.md",
    "threads/part-3/amplify-ability.md",
    "threads/part-4/practice-and-recovery.md",
    "threads/part-5/long-term-action.md",
  ]);
});

test("navigation publishes one Korean route per page", () => {
  const links = navigation.flatMap(({ items }) => items.map(({ link }) => link));
  expect(new Set(links).size).toBe(links.length);
  expect(links.filter((link) => /^\/en(?:\/|$)/.test(link))).toEqual([]);
  expect(JSON.stringify(navigation)).not.toMatch(/\p{Script=Han}/u);
});

test("reference collections follow the book and stay collapsed by default", () => {
  expect(navigation.slice(7).map(({ text }) => text)).toEqual(["도구 상자", "옛글 보관함", "단어 목록"]);
  expect(toSidebar(navigation).slice(0, 7).every(({ collapsed }) => collapsed === false)).toBe(true);
  expect(toSidebar(navigation).slice(7).every(({ collapsed }) => collapsed === true)).toBe(true);
});

test("the toolkit begins with a worked example and private reader evidence", () => {
  expect(group("도구 상자")?.items.slice(0, 5).map(({ source }) => source)).toEqual([
    "templates/toolkit-walkthrough.md",
    "templates/evidence-chain.md",
    "templates/reader-field-note.md",
    "templates/family-learning-agreement.md",
    "templates/learning-state.md",
  ]);
});

test("Part I places grammar between vocabulary and listening", () => {
  expect(group("제1부: 입력을 열다")?.items.slice(3, 6).map(({ source }) => source)).toEqual([
    "threads/part-1/2-vocabulary.md",
    "threads/part-1/grammar.md",
    "threads/part-1/3-listening.md",
  ]);
});

test("life-review chapters move from story through echoes into recovery", () => {
  expect(group("제2부: 나를 삶으로 돌려놓다")?.items.slice(1, 5).map(({ source }) => source)).toEqual([
    "threads/part-2/my-story.md",
    "threads/part-2/narrative-and-evidence.md",
    "threads/part-2/x-misc.md",
    "threads/part-2/recovery.md",
  ]);
});

test("practice chapters move from the first week through family learning into systems and rhythm", () => {
  expect(group("제4부: 실천과 회복")?.items.slice(-4).map(({ source }) => source)).toEqual([
    "threads/part-4/week-1.md",
    "threads/part-4/family-learning.md",
    "threads/part-4/daily-system.md",
    "threads/part-4/rhythm-and-compounding.md",
  ]);
});

test("long-term action moves from a 90-day cycle through a real case into handover", () => {
  expect(group("제5부: 행동과 장기적 변화")?.items.map(({ source }) => source)).toEqual([
    "threads/part-5/long-term-action.md",
    "threads/part-5/90-day-plan.md",
    "threads/part-5/book-as-proof.md",
    "threads/part-5/after-90-days.md",
  ]);
});

test("reader field notes ask for action, delayed evidence, revision, and privacy", () => {
  const template = readFileSync(
    resolve(process.cwd(), ".github/ISSUE_TEMPLATE/reader-field-note.yml"),
    "utf8",
  );
  for (const field of ["problem", "action", "delayed_result", "revision", "privacy"]) {
    expect(template).toContain(`id: ${field}`);
  }
  expect(template).toContain("작거나 실패한 시도도 쓸모 있는 증거입니다.");
  expect(template).toContain("고객 개인정보");
  expect(template).toContain("관찰한 사실과 추론하거나 바라는 내용을 구분해");
});

test("main book chapters leave continuous reading to the authoritative pager", () => {
  const sources = navigation
    .slice(1, 7)
    .flatMap(({ items }) => items.map(({ source }) => source))
    .filter((source) => /^threads\/part-[0-6]\//.test(source) || source === "projects.md");

  for (const source of sources) {
    for (const line of readDoc(source).split("\n")) expect(line.trim(), source).not.toMatch(MANUAL_PAGER);
  }
});

test("Part I core chapters end with a literary closing", () => {
  const ending = /^맺음말\s*[：:]/;
  const sources = group("제1부: 입력을 열다")?.items.slice(1).map(({ source }) => source) || [];
  expect(sources).toHaveLength(10);
  for (const source of sources) {
    const headings = [...readDoc(source).matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings.at(-1), source).toMatch(ending);
  }
});

test("key story, narrative, entrepreneurship, and AI chapters end on their literary movement", () => {
  const cases = [
    ["threads/part-2/my-story.md", "맺음말: 다시 시작은 승리의 귀환이 아니다"],
    ["threads/part-2/narrative-and-evidence.md", "맺음말: 이야기를 삶으로 돌려보내기"],
    ["threads/part-2/entrepreneurship.md", "맺음말: 야심이 현실을 통과하게 하라"],
    ["threads/part-3/1-ai-learning.md", "맺음말: 능력을 사람에게 남기기"],
    ["threads/part-4/family-learning.md", "맺음말: 아이 대신 그 길을 다 걸어 주지 마라"],
    ["threads/part-5/book-as-proof.md", "맺음말: 작업물도 자기 심판을 받아야 한다"],
  ];

  for (const [source, ending] of cases) {
    const headings = [...readDoc(source).matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings.at(-1), source).toBe(ending);
  }
});

// Each case pairs a chapter with its evidence card and the Korean terms each must contain.
function expectChapterAndCard({ chapter, card, chapterTerms, cardTerms }) {
  const chapterText = readDoc(chapter);
  const cardText = readDoc(card);
  for (const term of chapterTerms) expect(chapterText, chapter).toContain(term);
  for (const term of cardTerms) expect(cardText, card).toContain(term);
  return { chapterText, cardText };
}

test("grammar turns rules into meaning decisions and delayed evidence", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/grammar.md",
    card: "templates/grammar-evidence.md",
    chapterTerms: ["문법은 문장을 복잡하게 만드는 일이 아니다", "명시적 설명 다음에는 반드시 다시 써야 한다", "14일 문법 실험"],
    cardTerms: ["의미 변경", "3–7일째", "오류·중의성·사용역·문체를 구분했는가"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.1111%2F0023-8333.00136");
  expect(chapterText).toContain("grammar-evidence.md");
  expect(cardText).toContain("part-1/grammar.md");
});

test("speaking prioritises intelligibility, variation, repair, and transfer", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/5-speaking.md",
    card: "templates/speaking-evidence.md",
    chapterTerms: ["참고 변이형을 고르되 위계를 만들지 않는다", "악센트, 이해 가능도, 이해 난도를 나눈다", "섀도잉은 종착점이 아니다", "14일 말하기 실험"],
    cardTerms: ["기기 / 마이크", "청자가 실제로 들은 내용 남기기", "음성 인식 점수", "14일 차"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.2307%2F3588486");
  expect(chapterText).toContain("speaking-evidence.md");
  expect(cardText).toContain("part-1/5-speaking.md");
  expect(chapterText).not.toContain("cop /ɑ/");
});

test("listening turns repeated playback into diagnosis, reconstruction, and transfer", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/3-listening.md",
    card: "templates/listening-audit.md",
    chapterTerms: ["실제 첫 듣기 한 번 남기기", "모든 실패를 “못 알아들었다”로 부르지 않기", "자막은 치울 수 있는 사다리다", "14일 듣기 실험"],
    cardTerms: ["자막 없는 첫 듣기 남기기", "6층위 오류 지도 만들기", "비계 사다리 쓰기", "의미 재구성"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.1111%2Fj.1467-9922.2009.00559.x");
  expect(chapterText).toContain("listening-audit.md");
  expect(cardText).toContain("part-1/3-listening.md");
  expect((chapterText.match(/https?:\/\//g) || []).length).toBeLessThanOrEqual(4);
  expect(chapterText).not.toContain("Echo Loop");
});

test("reading turns word-by-word translation into verification and delivery", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/4-reading.md",
    card: "templates/reading-evidence.md",
    chapterTerms: ["꾸미지 않은 첫 읽기를 한 번 보관하기", "“읽어도 모르겠다”를 여섯 층으로 나누기", "기술 문서: 페이지를 검증 가능한 사실로 읽기", "14일 읽기 실험"],
    cardTerms: ["다듬지 않은 첫 읽기 남기기", "여섯 층위 걸림돌 지도 만들기", "기술 문서 사실 카드", "여러 출처 비교와 실제 출력"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.1111%2Flang.12034");
  expect(chapterText).toContain("reading-evidence.md");
  expect(cardText).toContain("part-1/4-reading.md");
  expect((chapterText.match(/https?:\/\//g) || []).length).toBeLessThanOrEqual(4);
  expect(chapterText).not.toContain("Animal Farm");
  expect(chapterText).not.toContain("WeChat Official Accounts");
});

test("vocabulary turns card familiarity into contextual retrieval", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/2-vocabulary.md",
    card: "templates/vocabulary-audit.md",
    chapterTerms: ["다듬지 않은 첫 만남을 보존한다", "모르는 항목에 다섯 가지 결정을 내린다", "단어 하나에는 적어도 여덟 가지 질문이 들어 있다", "14일 어휘 실험"],
    cardTerms: ["사전을 찾지 않은 첫 만남 남기기", "미지 항목 결정 대기열 만들기", "여덟 가지 차원 기록하기", "지연 유지와 전이 확인하기"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.3138%2Fcmlr.63.1.59");
  expect(chapterText).toContain("vocabulary-audit.md");
  expect(cardText).toContain("part-1/2-vocabulary.md");
  expect((chapterText.match(/https?:\/\//g) || []).length).toBeLessThanOrEqual(8);
});

test("learning principles turn effort into a complete evidence loop", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/1-understanding.md",
    card: "templates/english-diagnostic.md",
    chapterTerms: ["한 번의 온전한 학습 순환", "첫 버전은 측정이지 판결이 아니다", "자신을 심판하지 말고 오류를 진단하라", "상태를 세션 바깥에 두라", "능력이 조건을 넘어 움직이게 하라"],
    cardTerms: ["진단 경계 정하기", "네 영역 첫 버전 과제", "느낌이 아니라 영향으로 점수 매기기", "영역마다 주요 장애물 하나만 고르기", "지연 재측정과 전이"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.1177%2F1529100612453266");
  expect(chapterText).toContain("english-diagnostic.md");
  expect(cardText).toContain("evidence-chain.md");
  expect((chapterText.match(/https?:\/\//g) || []).length).toBeLessThanOrEqual(8);
});

test("AI work papers keep evaluation, human gates, and independent transfer visible", () => {
  const { chapterText: briefText, cardText: logText } = expectChapterAndCard({
    chapter: "templates/ai-task-brief.md",
    card: "templates/ai-learning-log.md",
    chapterTerms: ["입력, 출처와 데이터 경계", "출력과 평가 세트", "사람 관문", "실패, 일시 중지와 롤백", "시작 전 점검"],
    cardTerms: ["AI 없는 기준선", "상호작용과 출처 점검", "세 번의 대조", "지연 유지와 인계", "다음 주기 결정"],
  });
  expect(briefText).toContain("AI Task Brief");
  expect(logText).toContain("AI Learning Log");
  expect(logText).toContain("evidence-chain.md");
});

test("writing turns tool polish into accountable revision and delivery", () => {
  const { chapterText, cardText } = expectChapterAndCard({
    chapter: "threads/part-1/6-writing.md",
    card: "templates/writing-evidence.md",
    chapterTerms: ["다듬지 않은 초고를 보존하기", "사실과 책임 장부부터 만들기", "번역은 대필이 아니다", "14일 쓰기 실험"],
    cardTerms: ["도움 없이 쓴 초고 남기기", "번역에서 생긴 의미 변화 기록하기", "피드백 흡수 기록하기", "점수 매기기와 서명 결정"],
  });
  expect(chapterText).toContain("api.crossref.org/works/10.1111%2Fmodl.12189");
  expect(chapterText).toContain("writing-evidence.md");
  expect(cardText).toContain("part-1/6-writing.md");
  expect((chapterText.match(/https?:\/\//g) || []).length).toBeLessThanOrEqual(3);
  expect(chapterText).not.toContain("Welcome to the writing chapter");
});

test("the entrepreneurship chapter advances through scenes instead of stacked binary contrasts", () => {
  const text = readDoc("threads/part-2/entrepreneurship.md");
  // Korean counterparts of the upstream markers (is-not / but-rather / truly), as in scripts/check-content.mjs.
  const markers = ["아니다", "아니라", "진정한", "진짜"];
  const contrastMarkers = markers.reduce(
    (total, marker) => total + (text.match(new RegExp(escapeRegExp(marker), "g")) || []).length,
    0,
  );
  expect(contrastMarkers).toBeLessThanOrEqual(8);
});

test("relationships separate repair from reconciliation and protect consent under unequal power", () => {
  expectChapterAndCard({
    chapter: "threads/part-2/relationships.md",
    card: "templates/life-practice-toolkit.md",
    chapterTerms: [
      "복구: 관계를 원래대로 되돌리는 일이 아니다",
      "복구는 화해와 같지 않다",
      "권력 차이: 거절에 진짜 출구를 만들기",
      "침묵은 자동 동의가 아니고, 의존은 백지 위임이 아니다",
    ],
    cardTerms: [
      "누가 더 많은 자원, 평가 권한, 계정, 정보를 쥐고 있고 누구의 이탈 비용이 더 큰가",
      "상대가 이 대화를 안전하게 거절하거나 멈추거나 떠날 수 있는가",
      "용서나 화해를 조건으로 삼지 않고 관찰할 수 있는 복구는 무엇인가",
    ],
  });
});

test("decisions separate uncertainty from values and name authority, disconfirming evidence, and stop gates", () => {
  expectChapterAndCard({
    chapter: "threads/part-2/decision.md",
    card: "templates/life-practice-toolkit.md",
    chapterTerms: [
      "먼저 판단하기: 정보가 부족한가, 가치가 충돌하는가",
      "결정권, 영향, 실행을 나누기",
      "중단 조건을 눈에 보이는 신호로 적기",
      "어떤 증거가 현재 선택을 뒤집는가",
    ],
    cardTerms: [
      "문제 유형: 정보 부족 / 결과 불확실 / 가치 충돌 / 정체성 방어",
      "최종 결정자와 그 권한의 근거",
      "문턱에 닿으면 취할 행동: 일시 중지 / 중단 / 롤백 / 상위 도움 요청",
    ],
  });
  const glossaryText = readDoc("reference/glossary.md");
  for (const term of ["가치 충돌", "결정권", "반증", "중단 문턱"]) expect(glossaryText).toContain(term);
});

test("recovery separates safety, reduced load, and rebuilding before a bounded return to work", () => {
  const { chapterText } = expectChapterAndCard({
    chapter: "threads/part-2/recovery.md",
    card: "templates/life-practice-toolkit.md",
    chapterTerms: [
      "오늘의 회복 모드부터 고르기",
      "업무 복귀는 스위치가 아니라 단계적인 부하 시험이다",
      "도움은 구체적으로 청하되 주체성은 지키기",
      "안전 / 낮춤 / 재건",
      "WHO: Mental health at work",
    ],
    cardTerms: [
      "오늘의 모드: 안전 / 낮춤 / 재건",
      "지원자가 나 대신 해서는 안 되는 일",
      "다음 날 확인할 대가",
      "재점검 날짜와 일시 중지 권한이 있는 사람",
    ],
  });
  const glossaryText = readDoc("reference/glossary.md");
  for (const term of ["회복 모드", "업무 복귀 부하 시험", "지원 협약"]) expect(glossaryText).toContain(term);
  expect(chapterText).toContain("sources_checked: 2026-09-07");
});

test("the scheduled link audit checks authoritative sources and retires the 193-197 failure URLs", () => {
  const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/links.yml"), "utf8");
  for (const source of ['"ATTRIBUTIONS.md"', '"docs/README.md"', '"docs/threads/**/*.md"']) {
    expect(workflow).toContain(source);
  }
  expect(workflow).not.toContain('"docs/en/');
  for (const retiredUrl of [
    "scholarspace\\.manoa\\.hawaii\\.edu",
    "doi\\.org/10\\.64152/10125/66973",
    "10\\.1076/edre\\.7\\.1\\.403\\.3989",
    "web\\.archive\\.org/web/20160424221725",
  ]) {
    expect(workflow).toContain(retiredUrl);
  }
  expect(workflow).toContain("if grep -REni");
  expect(workflow).toContain("193-197 실패 계열에서 폐기한 URL이 다시 나타났습니다.");
});

for (const [route, heading] of routes) {
  test(`${route} renders`, async ({ page }) => {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { level: 1, name: new RegExp(escapeRegExp(heading)) }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
  });
}

test("the site ships a single Korean edition", async ({ page, request }) => {
  await page.goto("./threads/part-1/0-cefr");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko-KR");
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);
  await expect(page.locator(".VPNavBarTranslations")).toHaveCount(0);
  expect((await request.get("en/")).status()).toBe(404);
});

test("page metadata follows the route", async ({ page }) => {
  await page.goto("./threads/part-1/2-vocabulary");
  const canonical = `${SITE_URL}threads/part-1/2-vocabulary`;
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "ko_KR");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${SITE_URL}assets/feature.png`);
  await expect(page.locator('meta[property="og:image:type"]')).toHaveAttribute("content", "image/png");
  const chapterData = await structuredDataFromPage(page);
  expect(chapterData).toMatchObject({
    "@context": "https://schema.org",
    "@type": "Chapter",
    inLanguage: "ko-KR",
    author: { "@type": "Person", name: "한셴카이" },
    translator: { name: "2lab.ai" },
    isBasedOn: { "@type": "Book", url: ORIGINAL_REPOSITORY_URL, inLanguage: "zh-CN" },
    isPartOf: { "@type": "Book", name: "인생 레벨업 가이드", url: SITE_URL },
    license: "https://creativecommons.org/licenses/by-nc/4.0/",
  });
  expect(chapterData.dateModified).toBe("2026-09-02");
  await expect(page).toHaveTitle(textPattern("어휘 편"));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", textPattern("어휘"));
});

test("home metadata follows the lifelong-learning positioning", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", SITE_URL);
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "book");
  await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute("content", "ko_KR");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/assets\/feature\.png$/);
  await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute("content", "1200");
  await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute("content", "630");
  await expect(page.locator('meta[property="og:image:alt"]')).toHaveAttribute("content", /책 공유 표지/);
  await expect(page.locator('meta[name="build-revision"]')).toHaveAttribute("content", expectedBuildRevision);
  const bookData = await structuredDataFromPage(page);
  expect(bookData).toMatchObject({
    "@context": "https://schema.org",
    "@type": "Book",
    name: "인생 레벨업 가이드",
    alternateName: "Life Level-up Guide",
    bookFormat: "https://schema.org/EBook",
    inLanguage: "ko-KR",
    author: { "@type": "Person", name: "한셴카이" },
    translator: { name: "2lab.ai" },
    isBasedOn: { url: ORIGINAL_REPOSITORY_URL },
    encoding: [
      {
        "@type": "MediaObject",
        encodingFormat: "application/epub+zip",
        contentUrl: `${SITE_URL}downloads/life-level-up-guide-ko.epub`,
      },
      {
        "@type": "MediaObject",
        encodingFormat: "application/pdf",
        contentUrl: `${SITE_URL}downloads/life-level-up-guide-ko.pdf`,
      },
    ],
  });
  await expect(page).toHaveTitle(/인생 레벨업 가이드/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "인생 레벨업 가이드 | AI 시대의 평생학습");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    new RegExp(["AI 시대", "실제 프로젝트", "바닥"].map((term) => escapeRegExp(term)).join(".*")),
  );
});

test("the home page exposes the deterministic Korean EPUB edition", async ({ page, request }) => {
  const manifestResponse = await request.get("downloads/epub-manifest.json");
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toContain("application/json");
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ version: 1, standard: "EPUB 3.3" });
  expect(Object.keys(manifest.outputs)).toEqual(["ko-KR"]);

  const output = manifest.outputs["ko-KR"];
  expect(output.file).toBe("life-level-up-guide-ko.epub");
  expect(output.chapters).toBe(publicationChapterCount(navigation));
  expect(output.images).toBeGreaterThan(1);
  expect(output.bytes).toBeGreaterThan(1_000_000);
  expect(output.bytes).toBeLessThan(8_000_000);
  const response = await request.get(`downloads/${output.file}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/epub+zip");
  const body = await response.body();
  expect(body.subarray(0, 2).toString("ascii")).toBe("PK");
  expect(body.length).toBe(output.bytes);
  expect(sha256(body)).toBe(output.sha256);

  await page.goto("./");
  const link = page.getByRole("link", { name: "한국어판 EPUB 다운로드", exact: true });
  await expect(link).toHaveAttribute("href", "./downloads/life-level-up-guide-ko.epub");
  await expect(link).toHaveAttribute("download", "");
});

test("the home page exposes the reproducible print-ready Korean PDF edition", async ({ page, request }) => {
  const manifestResponse = await request.get("downloads/pdf-manifest.json");
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["content-type"]).toContain("application/json");
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ version: 2, format: "PDF 1.7", pageSize: "6 × 9.6 in" });
  expect(manifest.inspector).toEqual({ name: "pypdf", version: "6.16.2" });
  expect(Object.keys(manifest.outputs)).toEqual(["ko-KR"]);

  const output = manifest.outputs["ko-KR"];
  expect(output.file).toBe("life-level-up-guide-ko.pdf");
  expect(output.chapters).toBe(publicationChapterCount(navigation));
  expect(output.pages).toBeGreaterThan(200);
  expect(output.bytes).toBeGreaterThan(500_000);
  expect(output.bytes).toBeLessThan(8_000_000);
  expect(output.semanticSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(output.outlineEntries).toBeGreaterThan(500);
  expect(output.linkAnnotations).toBeGreaterThan(500);
  expect(output.images).toBeGreaterThan(10);
  const embeddedNotoFonts = output.fonts.filter((font) => font.name.startsWith("Noto") && font.embedded);
  expect(embeddedNotoFonts.map((font) => font.name)).toEqual(
    expect.arrayContaining(["NotoSerifKR-Bold", "NotoSerifKR-Regular"]),
  );
  const response = await request.get(`downloads/${output.file}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const body = await response.body();
  expect(body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(body.length).toBe(output.bytes);
  expect(sha256(body)).toBe(output.sha256);

  await page.goto("./");
  const link = page.getByRole("link", { name: "한국어판 PDF 다운로드", exact: true });
  await expect(link).toHaveAttribute("href", "./downloads/life-level-up-guide-ko.pdf");
  await expect(link).toHaveAttribute("download", "");
});

test("brand and social assets load at their declared dimensions", async ({ page, request }) => {
  await page.goto("./");
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/up/assets/logo.svg");
  const rasterAssets = [
    { path: "assets/feature.png", dimensions: { width: 1200, height: 630 } },
    { path: "assets/cover-portrait.png", dimensions: { width: 1600, height: 2560 } },
  ];
  for (const { path, dimensions: expectedDimensions } of rasterAssets) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/png");
    const dimensions = await page.evaluate(
      (source) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
          image.onerror = reject;
          image.src = source;
        }),
      `./${path}`,
    );
    expect(dimensions).toEqual(expectedDimensions);
  }
  for (const retired of ["assets/feature-en.png", "assets/cover-portrait-en.png"]) {
    expect((await request.get(retired)).status()).toBe(404);
  }

  const logo = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = reject;
        image.src = "./assets/logo.svg";
      }),
  );
  expect(logo).toEqual({ width: 48, height: 48 });

  const sitemapResponse = await request.get("sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  const sitemap = await sitemapResponse.text();
  expect(sitemap).toContain(`<loc>${SITE_URL}threads/part-1/2-vocabulary</loc>`);
  expect(sitemap).not.toContain("hreflang");
  expect(sitemap).not.toContain(`${SITE_URL}en/`);

  const robots = await (await request.get("robots.txt")).text();
  expect(robots).toContain(`Sitemap: ${SITE_URL}sitemap.xml`);
});

test("AI resource-layer chapter has metadata and navigation", async ({ page }) => {
  await page.goto("./threads/part-3/2-ai-development-and-resource-layer");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${SITE_URL}threads/part-3/2-ai-development-and-resource-layer`,
  );
  await expect(
    page.getByRole("link", { name: "AI 개발과 리소스 계층 창업", exact: true }).first(),
  ).toBeVisible();
  await expect(page).toHaveTitle(textPattern("AI 학습, 프로젝트 개발, 리소스 계층 창업"));
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    new RegExp(`한셴카이.*${escapeRegExp("AI 리소스 계층 창업")}`),
  );
});

test("resource-layer work returns from verification to disclosure and daily practice", async ({ page }) => {
  await page.goto("./threads/part-3/2-ai-development-and-resource-layer");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: "방법을 일상으로 되돌리기" })).toBeVisible();
  await expect(main.getByRole("link", { name: "저자 프로젝트와 현실 실천", exact: true }).last()).toBeVisible();
  await expect(main.getByRole("link", { name: "제4부: 실천과 회복", exact: true }).last()).toBeVisible();
});

test("legacy Docsify hash route redirects once", async ({ page }) => {
  await page.goto("./#/threads/part-1/1-understanding");
  await expect(page).toHaveURL(/\/up\/threads\/part-1\/1-understanding$/);
  await expect(page.getByRole("heading", { level: 1, name: textPattern("인지 편") })).toBeVisible();
});

test("local search uses Korean labels and returns a result", async ({ page }) => {
  await page.goto("./");
  const searchButton = page.getByRole("button", { name: "검색", exact: true });
  const [titleBox, searchButtonBox] = await Promise.all([
    page.locator(".VPNavBarTitle").boundingBox(),
    searchButton.boundingBox(),
  ]);
  expect(titleBox?.x + (titleBox?.width || 0)).toBeLessThanOrEqual(searchButtonBox?.x || 0);
  await searchButton.click();
  const searchBox = page.locator(".VPLocalSearchBox");
  const input = searchBox.locator("input");
  // The search box chunk and the Korean index (~730 KiB) load lazily on first use.
  await expect(input).toBeVisible({ timeout: 30_000 });
  await expect(input).toHaveAttribute("placeholder", "검색");
  await expect(searchBox.locator('button[title="검색 닫기"]')).toHaveCount(1);
  await expect(searchBox.locator('button[title="상세 결과 표시"]')).toHaveCount(1);
  await expect(searchBox.locator('button[title="검색어 지우기"]')).toHaveCount(1);
  await expect(searchBox).toContainText("선택");
  await expect(searchBox).toContainText("이동");
  await expect(searchBox).toContainText("닫기");
  await input.fill("검색어가없는문장");
  await expect(searchBox).toContainText("검색 결과가 없습니다:", { timeout: 30_000 });
  await input.fill("학습 상태");
  await expect(searchBox.getByRole("link", { name: textPattern("학습 상태") }).first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(searchBox).toBeHidden();
});

// Search queries and result titles are Korean headings from the translated pages.
async function expectSearchHit(page, query, result = query) {
  const searchBox = page.locator(".VPLocalSearchBox");
  if (!(await searchBox.isVisible())) await page.getByRole("button", { name: "검색", exact: true }).click();
  await searchBox.locator("input").fill(query);
  await expect(searchBox.getByRole("link", { name: textPattern(result) }).first()).toBeVisible({ timeout: 30_000 });
}

test("page-level search keeps nested chapter text discoverable", async ({ page }) => {
  await page.goto("./");
  await expectSearchHit(page, "14일은 글쓰기 속성 기한이 아니다", "쓰기 편");
});

test("heading-only search keeps long-form chapters and tools discoverable without indexing their full prose", async ({ page }) => {
  await page.goto("./");
  for (const heading of [
    "목표에는 만료일과 출구 관문이 있어야 한다",
    "작업물도 자기 심판을 받아야 한다",
    "기억은 파일에 맡기고, 판단은 스스로 쥐기",
    "가정 학습 편: 성장을 아이에게 돌려주기",
    "취업 영어 편: 능력을 면접과 원격 협업으로 가져가기",
    "문법 편: 구조가 뜻을 돕게 하기",
    "문법 증거 카드: 규칙 식별에서 실제 표현으로",
    "말하기 편: 뜻이 분명하게 닿게 하기",
    "말하기 증거 카드: 악센트 불안에서 검증 가능한 상호작용으로",
    "듣기 편: 소리 분별에서 실제 이해로",
    "듣기 증거 카드: 재생 시간에서 의미 재구성으로",
    "읽기 편: 단어별 번역에서 관점과 증거로",
    "읽기 증거 카드: 다 읽은 요약에서 실제 전달로",
    "어휘 편: 눈에 익은 단어를 실제 과제에서 꺼내 쓰기까지",
    "어휘 증거 카드: 카드 속 낯익음에서 상황 속 꺼내 쓰기로",
    "인지 편: 노력을 검증 가능한 학습으로 바꾸기",
    "영어 능력 진단: 네 영역 기준선과 전이 기록",
    "AI 과제 브리프: 문제에서 사람의 검수까지",
    "AI 학습 기록: 도구와의 협업에서 독립적인 능력으로",
    "쓰기 편: 초고에서 검증 가능한 퇴고까지",
    "쓰기 증거 카드: 도구 윤문에서 이름을 건 전달로",
  ]) {
    await expectSearchHit(page, heading);
  }
});

test("Part I literary closings remain discoverable in search", async ({ page }) => {
  await page.goto("./");
  await expectSearchHit(page, "소리 뒤의 사람을 듣기", "듣기 편");
});

test("story and AI literary closings remain discoverable", async ({ page }) => {
  await page.goto("./");
  await expectSearchHit(page, "다시 시작은 승리의 귀환이 아니다", "나의 이야기");
});

test("top navigation and a representative image work", async ({ page }) => {
  await page.goto("./");
  let lifelongLearning = page.getByRole("link", { name: "평생학습", exact: true });
  if ((await lifelongLearning.count()) === 0) {
    await page.getByRole("button", { name: "모바일 내비게이션" }).click();
    lifelongLearning = page.getByRole("link", { name: "평생학습", exact: true });
  }
  await expect(lifelongLearning).toBeVisible();
  await expect(lifelongLearning).toHaveAttribute("href", "/up/templates/learning-state");

  await page.goto("./projects");
  const image = page.getByRole("img", { name: textPattern("token.love 제품 페이지 보관본") });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("complete", true);
});

test("home page shows the latest updates", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 2, name: "현실은 계속된다" })).toBeVisible();
  const partnerPhoto = page.getByRole("img", { name: "한셴카이와 연인이 함께 찍은 사진" });
  const readersPhoto = page.getByRole("img", { name: "Agentic DB 콘퍼런스에서 독자들과 함께 사진을 찍은 한셴카이" });
  for (const image of [partnerPhoto, readersPhoto]) {
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", /\.webp$/);
    await expect(image).toHaveAttribute("loading", "lazy");
    await expect(image).toHaveAttribute("decoding", "async");
    await expect(image).toHaveAttribute("fetchpriority", "low");
    await expect(image).toHaveAttribute("width", /^\d+$/);
    await expect(image).toHaveAttribute("height", /^\d+$/);
  }
});

test("the home page uses book metadata without third-party image requests", async ({ page }) => {
  const externalImages = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.resourceType() === "image" && url.hostname !== "127.0.0.1") externalImages.push(url.href);
  });

  await page.goto("./");
  const socialLinks = await page.locator(".VPSocialLink").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(socialLinks.length).toBeGreaterThan(0);
  expect(new Set(socialLinks)).toEqual(new Set([REPOSITORY_URL]));
  expect(externalImages).toEqual([]);
  const meta = page.locator(".book-meta");
  await expect(meta).toContainText("계속 업데이트되는 원고");
  await expect(meta.getByRole("link", { name: "소스 코드와 정오표" })).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/(?:2lab-ai|byoungd)\/up$/,
  );
  await expect(meta.getByRole("link", { name: "독자 실천 회신" })).toHaveAttribute(
    "href",
    "./templates/reader-field-note",
  );
  await expect(meta.getByRole("link", { name: "본문 CC BY-NC 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by-nc/4.0/",
  );
});

test("latest home photos stay within the deferred media budget", async ({ page, request }) => {
  await page.goto("./");
  const images = [
    page.getByRole("img", { name: "한셴카이와 연인이 함께 찍은 사진" }),
    page.getByRole("img", { name: "Agentic DB 콘퍼런스에서 독자들과 함께 사진을 찍은 한셴카이" }),
  ];
  let total = 0;
  for (const image of images) {
    const source = await image.getAttribute("src");
    expect(source).toMatch(/\.webp$/);
    const response = await request.get(source);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/webp");
    const size = (await response.body()).byteLength;
    expect(size).toBeLessThan(220_000);
    total += size;
  }
  expect(total).toBeLessThan(280_000);
});

test("deferred story media reserves its intrinsic layout space", async ({ page }) => {
  await page.goto("./threads/part-2/my-story");
  const image = page.getByRole("img", { name: "소프트웨어 제품 페이지" });
  await expect(image).toHaveAttribute("loading", "lazy");
  await expect(image).toHaveAttribute("decoding", "async");
  await expect(image).toHaveAttribute("width", "1440");
  await expect(image).toHaveAttribute("height", "1266");
  const box = await image.boundingBox();
  expect(box?.width).toBeGreaterThan(0);
  expect(box?.height).toBeGreaterThan(0);
  expect((box?.width || 0) / (box?.height || 1)).toBeCloseTo(1440 / 1266, 2);
});

test("the home page links to the reader guide", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("link", { name: "읽기 가이드", exact: true }).first()).toBeVisible();
  for (const [name, href] of [
    ["가정과 중고등학생 학습", "./threads/part-4/family-learning"],
    ["해외 구직과 원격 협업", "./threads/part-1/8-job-search-english"],
    ["문법 기초와 실제 표현", "./threads/part-1/grammar"],
    ["쓰기와 비동기 전달", "./threads/part-1/6-writing"],
  ]) {
    await expect(page.getByRole("link", { name: textPattern(name) })).toHaveAttribute("href", href);
  }
  await expect(page.locator('main a[href="./threads/part-1/5-speaking"]').first()).toBeVisible();
});

test("home guide paths are grouped by purpose and keep third-party resources distinct", async ({ page }) => {
  await page.goto("./");
  const groups = page.locator("main .guide-path-group");
  await expect(groups).toHaveCount(4);
  await expect(groups.nth(0).locator(".guide-path")).toHaveCount(4);
  await expect(groups.nth(1).locator(".guide-path")).toHaveCount(2);
  await expect(groups.nth(2).locator(".guide-path")).toHaveCount(4);
  // The upstream biezou.com recommendation is not carried into the Korean edition.
  await expect(groups.nth(3).locator(".guide-path")).toHaveCount(1);
  await expect(groups.nth(3)).toHaveClass(/guide-path-group-external/);
  for (const [index, heading] of ["기초 세우기", "도구로 능력을 키우다", "실제 삶으로 들어가기", "제3자 자료"].entries()) {
    await expect(groups.nth(index).getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }
});

test("the home page carries no upstream third-party relay recommendation", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator('a[href*="biezou.com"]')).toHaveCount(0);
});

test("the home page exposes OpenHuge_ai as a bounded Telegram resource reference", async ({ page }) => {
  await page.goto("./");
  const openHuge = page.locator('a[href="https://t.me/OpenHuge_ai"]').first();
  await expect(openHuge).toBeVisible();
  await expect(openHuge).toHaveAttribute("target", "_blank");
  await expect(openHuge).toHaveAttribute("rel", /noopener/);
  await expect(openHuge).toContainText("AI 자료 텔레그램 채널: OpenHuge_ai");
  await expect(openHuge).toContainText("제3자 텔레그램 채널 추천");
});

test("the home page explains per-entry product verification dates", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByText(textPattern("제품과 서비스 항목의 점검 날짜는 각 페이지와"))).toBeVisible();
});

// Link and heading names inside the translated pages.
async function expectLinks(scope, names, { first = false } = {}) {
  for (const name of names) {
    const link = scope.getByRole("link", { name: name, exact: true });
    await expect(first ? link.first() : link).toBeVisible();
  }
}

async function expectHeadings(scope, level, names) {
  for (const name of names) {
    await expect(scope.getByRole("heading", { level, name: textPattern(name) }).first()).toBeVisible();
  }
}

test("evidence chapter hands off to practice and action", async ({ page }) => {
  await page.goto("./threads/part-3/5-evidence-and-transfer");
  await expectLinks(page.locator("main"), ["AI 개발과 리소스 계층 창업", "행동 편: 90일, 삶을 나에게 되돌려주기"]);
});

test("rhythm chapter bridges the daily system and 90-day plan", async ({ page }) => {
  await page.goto("./threads/part-4/rhythm-and-compounding");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["복리로 불어나는 네 가지"]);
  await expectLinks(main, ["용어와 방법 색인", "리듬 장부 템플릿"]);
  await expectLinks(main, ["90일 행동 편"], { first: true });
});

test("toolkit overview routes readers by problem", async ({ page }) => {
  await page.goto("./templates/toolkit");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["먼저 답하기: 나는 지금 어디서 막혀 있나?"]);
  await expectLinks(main, ["생활 레벨업 워크시트", "가정 학습 공동 협약"]);
  await expectLinks(
    main,
    ["학습 상태", "리듬 장부", "취업 영어 증거 카드", "문법 증거 카드", "말하기 증거 카드", "듣기 증거 카드", "읽기 증거 카드", "어휘 증거 카드", "쓰기 증거 카드"],
    { first: true },
  );
});

test("writing pages preserve authorship, feedback uptake, and async delivery", async ({ page }) => {
  await page.goto("./threads/part-1/6-writing");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["사실과 책임 장부부터 만들기", "번역은 대필이 아니다", "AI는 편집 조수이지 보이지 않는 글쓴이가 아니다"]);
  await expectLinks(main, ["쓰기 증거 카드"], { first: true });

  await page.goto("./templates/writing-evidence");
  await expectHeadings(page.locator("main"), 2, ["도움 없이 쓴 초고 남기기", "피드백 흡수 기록하기", "비동기 전달 점검하기"]);
});

test("reading pages turn technical documents into verifiable delivery", async ({ page }) => {
  await page.goto("./threads/part-1/4-reading");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["꾸미지 않은 첫 읽기를 한 번 보관하기", "기술 문서: 페이지를 검증 가능한 사실로 읽기", "여러 출처와 문화 간 논리"]);
  await expectLinks(main, ["읽기 증거 카드"], { first: true });

  await page.goto("./templates/reading-evidence");
  await expectHeadings(page.locator("main"), 2, ["다듬지 않은 첫 읽기 남기기", "기술 문서 사실 카드", "여러 출처 비교와 실제 출력"]);
});

test("listening pages turn replay into diagnosis, reconstruction, and transfer", async ({ page }) => {
  await page.goto("./threads/part-1/3-listening");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["실제 첫 듣기 한 번 남기기", "자막은 치울 수 있는 사다리다", "정밀 듣기와 폭넓은 듣기는 하는 일이 다르다"]);
  await expectLinks(main, ["듣기 증거 카드"], { first: true });

  await page.goto("./templates/listening-audit");
  const card = page.locator("main");
  await expectHeadings(card, 2, ["자막 없는 첫 듣기 남기기", "비계 사다리 쓰기", "지연 유지와 전이 확인하기"]);
  await expect(card).toContainText("재생 횟수는 결과가 아니다");
});

test("speaking pages turn accent anxiety into listener evidence and repair", async ({ page }) => {
  await page.goto("./threads/part-1/5-speaking");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["참고 변이형을 고르되 위계를 만들지 않는다", "악센트, 이해 가능도, 이해 난도를 나눈다", "상호작용 복구는 뒷수습이 아니라 능력이다"]);
  await expectLinks(main, ["말하기 증거 카드"], { first: true });

  await page.goto("./templates/speaking-evidence");
  const card = page.locator("main");
  await expectHeadings(card, 2, ["원고 없는 기준선 세 가지 남기기", "청자가 실제로 들은 내용 남기기"]);
  await expect(card).toContainText("음성 인식 점수는 마이크, 소음, 네트워크, 모델, 악센트의 영향을 받으므로");
});

test("job-search English maps one real role into interview and remote-work evidence", async ({ page }) => {
  await page.goto("./threads/part-1/8-job-search-english");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["CEFR은 좌표이지 합격선이 아니다", "직무 기술서에서 언어 지도 뽑아내기", "상호작용 복구는 면접 능력이지"]);
  await expect(main).toContainText("원격 직무는 글쓰기도 시험한다");
  await expect(main).toContainText("프로젝트, 직무, 데이터, 고객, 결과 지어내기");
  await expectLinks(main, ["취업 영어 증거 카드", "말하기 증거 카드", "쓰기 증거 카드"], { first: true });
});

test("job-search evidence cards preserve unfamiliar follow-ups, async writing, and integrity", async ({ page }) => {
  await page.goto("./templates/interview-evidence");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["직무 언어 지도", "듣기와 복구", "14일 비교", "면접 후 결산"]);
  await expect(main).toContainText("명시적인 허락 없이 실제 면접에서 몰래 실시간 도움을 받지 말라");
});

test("family learning protects learner agency, school reality, and children's data", async ({ page }) => {
  const source = "https://www.unesco.org/en/articles/guidance-generative-ai-education-and-research";
  await page.goto("./threads/part-4/family-learning");
  const main = page.locator("main");
  await expect(main.getByRole("link", { name: /UNESCO/ }).first()).toHaveAttribute("href", source);
  await expectHeadings(main, 2, ["네 가지 역할은 서로 대신하지 않는다", "AI가 집에 들어오기 전에 다섯 관문부터 통과하기"]);
  await expect(main).toContainText("아이에게 참여할 권리가 있다고 해서 모든 책임을 혼자 지는 것은 아니다");
  await expect(main).toContainText("이름, 학교, 반, 신분증");
  await expectLinks(main, ["가정 학습 공동 협약"], { first: true });
});

test("family learning agreements make the learner speak first and review adult support", async ({ page }) => {
  await page.goto("./templates/family-learning-agreement");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["따로 쓰고, 함께 읽기", "2주 회고: 학습자가 먼저 말한다"]);
  await expectHeadings(main, 3, ["학습자가 먼저 쓴다"]);
  await expect(main).toContainText("어른이 분명히 하지 않는 것");
  await expect(main).toContainText("대신 쓰거나 대신 답하지 않고, AI에게 대신 시킨 뒤");
});

test("toolkit walkthrough keeps learning state outside the AI conversation", async ({ page }) => {
  await page.goto("./templates/toolkit-walkthrough");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["1단계: 상태를 세션 밖에 두기"]);
  await expect(main).toContainText("AI가 세션을 넘어 학습을 추적한 것이 아니다. 추적은 상태 파일이 했고");
  await expectLinks(main, ["학습 상태", "독자 실천 회신"], { first: true });
});

test("reader field notes remain private first and retest after delay", async ({ page }) => {
  await page.goto("./templates/reader-field-note");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["두 번째 기록: 3~7일 뒤"]);
  await expect(main).toContainText("공개 공유는 언제나 선택 사항이다");
  await expect(main.getByRole("link", { name: "공개 독자 회신", exact: true })).toHaveAttribute(
    "href",
    `${REPOSITORY_URL}/issues/new?template=reader-field-note.yml`,
  );
});

test("evidence chain template preserves comparable stages", async ({ page }) => {
  await page.goto("./templates/evidence-chain");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["손대지 않은 기준선을 남긴다", "지연 유지를 확인한다"]);
  await expectLinks(main, ["증거 편: 변화는 어떻게 보이게 되는가"]);
});

test("reader guide routes return visits to the right tools", async ({ page }) => {
  await page.goto("./threads/part-0/reader-guide");
  const main = page.locator("main");
  await expectLinks(main, ["증거 사슬 템플릿", "도구 상자 둘러보기", "리듬 장부", "증거 편", "리듬"], { first: true });
  await expectLinks(main, [
    "가정 학습 편: 성장을 아이에게 돌려주기",
    "가정 학습 공동 협약",
    "문법 편: 구조가 뜻을 돕게 하기",
    "문법 증거 카드",
    "말하기 편: 뜻이 분명하게 닿게 하기",
    "말하기 증거 카드",
    "듣기 편: 소리 분별에서 실제 이해로",
    "듣기 증거 카드",
    "어휘 편: 눈에 익은 단어를 실제 과제에서 꺼내 쓰기까지",
    "어휘 증거 카드",
    "읽기 편: 단어별 번역에서 관점과 증거로",
    "읽기 증거 카드",
    "쓰기 편: 초고에서 검증 가능한 퇴고까지",
    "쓰기 증거 카드",
  ]);
});

test("echoes chapter separates harm, responsibility, and the next choice", async ({ page }) => {
  await page.goto("./threads/part-2/x-misc");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1, name: "메아리 편: 도피를 낭만으로 쓰지 않기" })).toBeVisible();
  await expect(main.getByText(textPattern("폭력은 교육이 아니며 나는 다치지 말았어야 했다"))).toBeVisible();
  await expectHeadings(main, 2, ["옛 이야기를 새로 읽는 법"]);
  await expectLinks(main, ["회복 편: 먼저 나를 붙들어 주기"], { first: true });
});

test("first-week practice turns a baseline into a reviewable next step", async ({ page }) => {
  await page.goto("./threads/part-4/week-1");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1, name: "실천 편: 먼저 첫 주를 끝까지 지내기" })).toBeVisible();
  await expectHeadings(main, 2, ["7일은 꽉 채우기보다 돌아올 수 있으면 된다"]);
  await expectLinks(main, ["증거 사슬 템플릿", "주간 회고 템플릿", "가정 학습 편", "생활 시스템 편"]);
});

test("part introductions state a reading contract and hand off to the first chapter", async ({ page }) => {
  for (const { route, previous, next } of [
    { route: "./threads/part-1/open-input", previous: "/up/threads/part-0/prologue", next: "/up/threads/part-1/0-cefr" },
    {
      route: "./threads/part-5/long-term-action",
      previous: "/up/threads/part-4/rhythm-and-compounding",
      next: "/up/threads/part-5/90-day-plan",
    },
  ]) {
    await page.goto(route);
    const footer = page.locator(".VPDocFooter .prev-next");
    await expect(footer.locator(".pager-link.prev")).toHaveAttribute("href", previous);
    await expect(footer.locator(".pager-link.next")).toHaveAttribute("href", next);
  }

  await page.goto("./threads/part-1/open-input");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1, name: "제1부: 입력을 열다" })).toBeVisible();
  await expectHeadings(main, 2, ["이 부에서 답할 질문"]);
});

test("post-cycle chapter turns short-term effort into a long-term handover", async ({ page }) => {
  await page.goto("./threads/part-5/after-90-days");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1, name: "90일 이후: 변화를 삶에 남기기" })).toBeVisible();
  await expectHeadings(main, 2, ["먼저 결산하고, 그다음에 소원을 빈다", "목표에는 만료일과 출구 관문이 있어야 한다"]);
  await expectLinks(main, ["증거 사슬 템플릿", "주간 회고"]);
});

test("afterword closes the book with a return path", async ({ page }) => {
  await page.goto("./threads/part-6/afterword");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["미래의 독자에게"]);
  await expectLinks(main, ["도구 상자 둘러보기", "증거 사슬 템플릿"]);
});

test("book boundary pagers follow the reading arc without duplicate manual navigation", async ({ page }) => {
  const cases = [
    { route: "./threads/part-0/reader-guide", previous: "/up/", next: "/up/threads/part-0/prologue" },
    { route: "./threads/part-0/prologue", previous: "/up/threads/part-0/reader-guide", next: "/up/threads/part-1/open-input" },
    { route: "./threads/part-1/open-input", previous: "/up/threads/part-0/prologue", next: "/up/threads/part-1/0-cefr" },
    { route: "./threads/part-1/2-vocabulary", previous: "/up/threads/part-1/1-understanding", next: "/up/threads/part-1/grammar" },
    { route: "./threads/part-1/grammar", previous: "/up/threads/part-1/2-vocabulary", next: "/up/threads/part-1/3-listening" },
    { route: "./threads/part-1/7-ai", previous: "/up/threads/part-1/6-writing", next: "/up/threads/part-1/8-job-search-english" },
    { route: "./threads/part-1/8-job-search-english", previous: "/up/threads/part-1/7-ai" },
    { route: "./threads/part-5/after-90-days", previous: "/up/threads/part-5/book-as-proof", next: "/up/threads/part-6/afterword" },
    { route: "./threads/part-6/afterword", previous: "/up/threads/part-5/after-90-days", next: "/up/" },
  ];

  for (const entry of cases) {
    await page.goto(entry.route);
    const footer = page.locator(".VPDocFooter .prev-next");
    await expect(footer.locator(".pager-link.prev")).toHaveAttribute("href", entry.previous);
    if (entry.next) await expect(footer.locator(".pager-link.next")).toHaveAttribute("href", entry.next);
    const manualParagraphs = page.locator("main .vp-doc p").filter({ hasText: MANUAL_PAGER });
    await expect(manualParagraphs).toHaveCount(0);
  }
});

test("prologue contract points to the current toolkit", async ({ page }) => {
  await page.goto("./threads/part-0/prologue");
  await expectLinks(page.locator("main"), ["증거 사슬 템플릿", "도구 상자 둘러보기", "리듬 장부"], { first: true });
});

test("foundation chapters hand off to the shared evidence chain", async ({ page }) => {
  for (const route of ["./threads/part-1/0-cefr", "./threads/part-1/7-ai"]) {
    await page.goto(route);
    await expectLinks(page.locator("main"), ["증거 사슬 템플릿"], { first: true });
  }
});

test("weekly review explains the handover between core records", async ({ page }) => {
  await page.goto("./templates/weekly-review");
  const main = page.locator("main");
  await expectHeadings(main, 2, ["반영한 뒤 인계할 곳"]);
  await expectLinks(main, ["증거 사슬 템플릿", "리듬 장부"]);
});

test("90-day planning connects gates, evidence, and rhythm", async ({ page }) => {
  await page.goto("./templates/90-day-cycle");
  await expectLinks(page.locator("main"), ["증거 사슬 템플릿", "리듬 장부", "학습 상태"], { first: true });
});

test("Korean chrome uses Korean labels and author metadata", async ({ page }, testInfo) => {
  await page.goto("./threads/part-1/0-cefr");
  await expect(page.locator('meta[name="author"]')).toHaveAttribute("content", /한셴카이.*리푸/);
  await expect(page.locator("#doc-outline-aria-label")).toHaveText("이 페이지 목차");
  await expect(page.locator(".VPLastUpdated")).toContainText("마지막 업데이트");
  await expect(page.locator(".VPLastUpdated time")).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일$/);
  if (testInfo.project.name === "mobile-chromium") {
    await expect(page.getByRole("button", { name: "목차", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "이 페이지 목차" })).toBeVisible();
  } else {
    await expect(page.locator(".VPNavBarSocialLinks .VPSocialLink")).toHaveAttribute("href", REPOSITORY_URL);
  }
});

test("site chrome, footer attribution, and missing pages are Korean", async ({ page }) => {
  await page.goto("./threads/part-1/0-cefr");
  await expect(page.locator(".VPSkipLink")).toHaveText("본문으로 건너뛰기");
  await expect(page.locator(".edit-link-button")).toHaveText("GitHub에서 이 페이지 편집");
  await expect(page.locator(".edit-link-button")).toHaveAttribute(
    "href",
    `${REPOSITORY_URL}/edit/master/docs/threads/part-1/0-cefr.md`,
  );
  await expect(page.locator(".VPSwitchAppearance").first()).toHaveAttribute("title", /^(?:밝은|어두운) 모드로 전환$/);
  await expect(page.locator("#main-nav-aria-label")).toHaveText("주 내비게이션");
  await expect(page.locator("#sidebar-aria-label")).toHaveText("사이드바 내비게이션");
  await expect(page.locator("#doc-footer-aria-label")).toHaveText("이전 글과 다음 글");
  await expect(page.locator(".VPNavBarHamburger")).toHaveAttribute("aria-label", "모바일 내비게이션");
  await expect(page.locator(".VPSidebarItem .caret").first()).toHaveAttribute("aria-label", "그룹 펼치기 또는 접기");
  await expect(page.locator(".header-anchor").first()).toHaveAttribute("aria-label", /고정 링크$/);
  await expect(page.locator(".VPDocFooter .pager-link.prev .desc")).toHaveText("이전 글");
  await expect(page.locator(".VPDocFooter .pager-link.next .desc")).toHaveText("다음 글");

  await page.goto("./");
  const footer = page.locator(".VPFooter");
  await expect(footer).toBeVisible();
  await expect(footer).toContainText("원작: 한셴카이(byoungd)의 『인생 레벨업 가이드』");
  await expect(footer).toContainText("저작권 © 2017–현재 byoungd와 기여자");
  await expect(footer).not.toContainText("Copyright");
  await expect(footer).toContainText("중국어 원문을 한국어로 옮김");
  await expect(footer.getByRole("link", { name: "github.com/byoungd/up" })).toHaveAttribute("href", ORIGINAL_REPOSITORY_URL);
  await expect(footer.getByRole("link", { name: "CC BY-NC 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by-nc/4.0/deed.ko",
  );
  await expect(footer.getByRole("link", { name: "2lab.ai" })).toHaveAttribute("href", REPOSITORY_URL);

  await page.goto("./definitely-missing-reader-route");
  const notFound = page.locator(".NotFound");
  await expect(notFound.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "페이지를 찾을 수 없습니다");
  await expect(page.locator(".VPFooter")).toContainText("원작: 한셴카이(byoungd)");
  await expect(notFound).toContainText("길이 사라진 것이 아니라 이 페이지가 자리를 옮겼을 뿐일 때도 있습니다");
  await expect(notFound.getByRole("link", { name: "『인생 레벨업 가이드』 홈으로 돌아가기" })).toHaveText("홈으로 돌아가기");
});

test("long-form reading progress and typography remain stable", async ({ page }, testInfo) => {
  await page.goto("./threads/part-3/2-ai-development-and-resource-layer");
  const progress = page.locator("[data-reading-progress]");
  await expect(progress).toBeVisible();
  await expect.poll(async () => Number(await progress.getAttribute("data-progress"))).toBeLessThan(5);
  const progressBox = await progress.boundingBox();
  expect(progressBox?.y).toBe(0);
  expect(progressBox?.height).toBe(2);

  const typography = await page.evaluate(() => {
    const heading = document.querySelector(".vp-doc h1");
    const paragraph = document.querySelector(".vp-doc p");
    const headingStyles = heading ? getComputedStyle(heading) : null;
    const paragraphStyles = paragraph ? getComputedStyle(paragraph) : null;
    return {
      headingSize: Number.parseFloat(headingStyles?.fontSize || "0"),
      lineHeight: Number.parseFloat(paragraphStyles?.lineHeight || "0"),
      paragraphSize: Number.parseFloat(paragraphStyles?.fontSize || "0"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wordBreak: paragraphStyles?.wordBreak,
      fontFamily: getComputedStyle(document.body).fontFamily,
    };
  });
  expect(typography.lineHeight / typography.paragraphSize).toBeGreaterThanOrEqual(1.75);
  expect(typography.overflow).toBeLessThanOrEqual(1);
  expect(typography.headingSize).toBe(testInfo.project.name === "mobile-chromium" ? 32 : 42);
  expect(typography.wordBreak).toBe("keep-all");
  expect(typography.fontFamily).toContain("Apple SD Gothic Neo");

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => Number(await progress.getAttribute("data-progress"))).toBeGreaterThan(95);
});

test("print view keeps the manuscript and removes site chrome", async ({ page }) => {
  await page.goto("./threads/part-4/daily-system");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".VPNav")).toBeHidden();
  await expect(page.locator(".VPSidebar")).toBeHidden();
  await expect(page.locator("[data-reading-progress]")).toBeHidden();
});

test("private session asset is never publicly served", async ({ request }) => {
  const response = await request.get("assets/session.json");
  expect(response.status()).toBe(404);
});

test("representative pages load every local image with descriptive alt text", async ({ page }) => {
  for (const route of [
    "./",
    "./projects",
    "./threads/part-1/5-speaking",
    "./threads/part-1/6-writing",
    "./threads/part-2/entrepreneurship",
    "./threads/part-2/my-story",
  ]) {
    await page.goto(route);
    const images = page.locator("main img");
    const count = await images.count();
    expect(count, `${route} should contain at least one image`).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const image = images.nth(index);
      await expect(image).toHaveAttribute("loading", "lazy");
      await expect(image).toHaveAttribute("decoding", "async");
      const source = await image.getAttribute("src");
      if (source?.startsWith("/up/assets/") && !source.endsWith(".svg")) {
        await expect(image).toHaveAttribute("width", /^\d+$/);
        await expect(image).toHaveAttribute("height", /^\d+$/);
      }
      if ((await image.getAttribute("loading")) === "lazy") await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty("complete", true);
      await expect(image).toHaveAttribute("alt", /\S+/);
      await expect.poll(() => image.evaluate((element) => element.naturalWidth)).toBeGreaterThan(0);
    }
  }
});

test("code blocks label their language and copy button in Korean", async ({ page }) => {
  await page.goto("./templates/learning-state");
  const labels = await page.locator(".vp-doc div[class*='language-'] > span.lang").allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect(new Set(labels)).toEqual(new Set(["마크다운", "텍스트"]));
  await expect(page.locator(".vp-doc div[class*='language-'] > button.copy").first()).toHaveAttribute("title", "코드 복사");
});

test("the home page reaches the archive index", async ({ page, request }) => {
  await page.goto("./");
  const archive = page.locator("main").getByRole("link", { name: "옛글 보관함", exact: true });
  await expect(archive).toHaveAttribute("href", "./threads/archive/");
  const response = await request.get("threads/archive/");
  expect(response.status()).toBe(200);
});

test("keyboard focus reaches navigation", async ({ page }) => {
  await page.goto("./");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  await expect(focused).toHaveAttribute("href", /#VPContent|\/up\//);
});
