import { existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { defineConfig } from "vitepress";
import { navigation, toSidebar } from "./navigation.mjs";

const origin = "https://dosi.dev";
const base = "/up/";
const siteUrl = `${origin}${base}`;
const configDir = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(configDir, "..");
const assetsDir = join(docsDir, "assets");
const buildRevision = process.env.GITHUB_SHA || process.env.BUILD_REVISION || "local";
const bookName = "인생 레벨업 가이드";
const siteTitle = "인생 레벨업 가이드 | AI 시대의 평생학습";
const defaultDescription =
  "『인생 레벨업 가이드』는 평범한 사람이 AI 시대에 꾸준히 배우고, 실제 프로젝트를 완수하고, 인생의 바닥을 지나며 성장의 증거를 남기도록 돕습니다.";
const repositoryUrl = "https://github.com/2lab-ai/up";
const originalRepositoryUrl = "https://github.com/byoungd/up";
const contentLicenseUrl = "https://creativecommons.org/licenses/by-nc/4.0/";
const editLinkPattern = `${repositoryUrl}/edit/master/docs/:path`;
const originalAuthor = {
  "@type": "Person",
  name: "한셴카이",
  alternateName: ["리푸", "Han Xiankai", "Li Pu", "byoungd"],
  url: "https://github.com/byoungd",
};
const translator = { "@type": "Organization", name: "2lab.ai", url: "https://github.com/2lab-ai" };
// The Korean edition is a translation of the original Chinese manuscript.
const originalWork = {
  "@type": "Book",
  name: "Life Level-up Guide",
  url: originalRepositoryUrl,
  inLanguage: "zh-CN",
  author: originalAuthor,
  license: contentLicenseUrl,
};

function rasterFiles(directory: string, output: string[] = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) rasterFiles(path, output);
    else if (/\.(?:avif|jpe?g|png|webp)$/i.test(entry.name)) output.push(path);
  }
  return output;
}

const rasterDimensions = new Map(
  await Promise.all(
    rasterFiles(assetsDir).map(async (path) => {
      const { width, height } = await sharp(path).metadata();
      return [path, width && height ? { width, height } : undefined] as const;
    }),
  ),
);

function localImagePath(source: string, pagePath?: string) {
  if (!source || /^(?:[a-z]+:|#)/i.test(source)) return undefined;
  const clean = decodeURIComponent(source.split(/[?#]/, 1)[0]);
  if (clean.startsWith("/")) return resolve(docsDir, clean.replace(/^\/+/, ""));
  if (!pagePath) return undefined;
  return resolve(dirname(pagePath), clean);
}

const searchHeadingContent = /(.*?)<a.*? href="#(.*?)".*?>.*?<\/a>/i;

function splitSearchSections(file: string, html: string) {
  const normalizedFile = file.replaceAll("\\", "/");
  const titleOnly = [
    "/templates/reader-field-note.md",
    "/templates/interview-evidence.md",
    "/templates/grammar-evidence.md",
    "/templates/speaking-evidence.md",
    "/templates/listening-audit.md",
    "/templates/reading-evidence.md",
    "/templates/vocabulary-audit.md",
    "/templates/english-diagnostic.md",
    "/templates/ai-task-brief.md",
    "/templates/ai-learning-log.md",
    "/threads/part-4/family-learning.md",
    "/threads/part-1/8-job-search-english.md",
    "/threads/part-1/grammar.md",
    "/threads/part-1/5-speaking.md",
    "/threads/part-1/4-reading.md",
    "/threads/part-1/2-vocabulary.md",
    "/threads/part-1/1-understanding.md",
  ].some((suffix) => normalizedFile.endsWith(suffix));
  const headingOnly = [
    "/docs/README.md",
    "/threads/part-0/reader-guide.md",
    "/threads/part-5/after-90-days.md",
    "/threads/part-5/book-as-proof.md",
    "/templates/toolkit-walkthrough.md",
    "/threads/part-1/3-listening.md",
  ].some((suffix) => normalizedFile.endsWith(suffix));
  const pageLevelOnly =
    normalizedFile.includes("/templates/") ||
    normalizedFile.includes("/reference/") ||
    normalizedFile.includes("/threads/archive/") ||
    normalizedFile.includes("/threads/part-1/") ||
    normalizedFile.includes("/threads/word-list/");
  const levels = titleOnly ? "1" : headingOnly ? "12" : pageLevelOnly ? "1" : "12";
  const headings = [
    ...html.matchAll(new RegExp(`<h([${levels}]).*?>(.*?<a.*? href="#.*?".*?>.*?<\\/a>)<\\/h\\1>`, "gi")),
  ];
  let pageTitle = "";
  return headings.flatMap((match, index) => {
    const level = Number(match[1]);
    const heading = searchHeadingContent.exec(match[2]);
    const title = (heading?.[1] || "").replace(/<[^>]*>/g, "").trim();
    const anchor = heading?.[2] || "";
    const contentStart = (match.index || 0) + match[0].length;
    const contentEnd = headings[index + 1]?.index ?? html.length;
    // These navigation-heavy home pages and long-form chapters have descriptive headings; indexing
    // those headings keeps every concept discoverable without duplicating each full page in the client bundle.
    const text = titleOnly || headingOnly
      ? title
      : html.slice(contentStart, contentEnd).replace(/<[^>]*>/g, "").trim();
    if (!title || !text) return [];
    if (level === 1) pageTitle = title;
    return [{ anchor, titles: level === 1 ? [title] : [pageTitle, title].filter(Boolean), text }];
  });
}

function routeFromRelativePath(relativePath: string) {
  const clean = relativePath
    .replace(/(^|\/)(README|index)\.md$/, "$1")
    .replace(/\.md$/, "")
    .replace(/^index$/, "");
  return clean.replace(/^\/+|\/+$/g, "");
}

function privateAssetGuard() {
  let outDir = "";
  const isPrivateSession = (url = "") => {
    const pathname = decodeURIComponent(url.split("?")[0]);
    return pathname === "/assets/session.json" || pathname.endsWith("/assets/session.json");
  };

  return {
    name: "private-asset-guard",
    enforce: "post" as const,
    configResolved(config: { build: { outDir: string } }) {
      outDir = config.build.outDir;
    },
    configureServer(server: { middlewares: { use: (handler: (req: { url?: string }, res: { statusCode: number; end: (body: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (!isPrivateSession(req.url)) {
          next();
          return;
        }
        res.statusCode = 404;
        res.end("Not found");
      });
    },
    closeBundle() {
      if (!outDir) return;
      const generatedPath = resolve(outDir, "assets/session.json");
      if (existsSync(generatedPath)) rmSync(generatedPath);
    },
  };
}

// The default theme hard-codes English fallbacks and accessibility labels that site config cannot reach
// (SSR renders them before any client script runs). Replace them at build time; a missing literal fails the
// build so a VitePress upgrade cannot silently bring English UI back.
const themeStrings: Record<string, Array<[string, string]>> = {
  // Client-side 404 page data (in-app navigation to a missing route).
  "shared.js": [["description: 'Not Found'", "description: '페이지를 찾을 수 없습니다'"]],
  "app/components/Content.js": [["'404 Page Not Found'", "'404 페이지를 찾을 수 없습니다'"]],
  "theme-default/NotFound.vue": [
    ["'PAGE NOT FOUND'", "'페이지를 찾을 수 없습니다'"],
    [
      `"But if you don't change your direction, and if you keep looking, you may end up where you are heading."`,
      `"길이 사라진 것이 아니라 이 페이지가 자리를 옮겼을 뿐일 때도 있습니다."`,
    ],
    ["'go to home'", "'홈으로 돌아가기'"],
    ["'Take me home'", "'홈으로 돌아가기'"],
  ],
  "theme-default/components/VPDocFooter.vue": [
    [">Pager</span>", ">이전 글과 다음 글</span>"],
    ["'Previous page'", "'이전 글'"],
    ["'Next page'", "'다음 글'"],
  ],
  "theme-default/components/VPDocFooterLastUpdated.vue": [["'Last updated'", "'마지막 업데이트'"]],
  "theme-default/components/VPLocalNav.vue": [["'Menu'", "'목차'"]],
  "theme-default/components/VPLocalNavOutlineDropdown.vue": [["'Return to top'", "'맨 위로'"]],
  "theme-default/components/VPLocalSearchBox.vue": [
    ["'Search'", "'검색'"],
    ["'Display detailed list'", "'상세 결과 표시'"],
    ["'Reset search'", "'검색어 지우기'"],
    ["'Close search'", "'검색 닫기'"],
    ["'No results for'", "'검색 결과가 없습니다:'"],
    ["'to select'", "'선택'"],
    ["'enter'", "'Enter 키로 선택'"],
    ["'to navigate'", "'이동'"],
    ["'up arrow'", "'위쪽 화살표로 이전 항목 선택'"],
    ["'down arrow'", "'아래쪽 화살표로 다음 항목 선택'"],
    ["'to close'", "'닫기'"],
    ["'escape'", "'Esc 키로 닫기'"],
  ],
  "theme-default/components/VPNavBarExtra.vue": [
    ['label="extra navigation"', 'label="추가 메뉴"'],
    ["'Appearance'", "'화면 모드'"],
  ],
  "theme-default/components/VPNavBarHamburger.vue": [['aria-label="mobile navigation"', 'aria-label="모바일 내비게이션"']],
  "theme-default/components/VPNavBarMenu.vue": [["Main Navigation", "주 내비게이션"]],
  "theme-default/components/VPNavBarSearchButton.vue": [
    ["buttonText: 'Search'", "buttonText: '검색'"],
    ["buttonAriaLabel: 'Search'", "buttonAriaLabel: '검색'"],
  ],
  "theme-default/components/VPNavBarTranslations.vue": [["'Change language'", "'언어 바꾸기'"]],
  "theme-default/components/VPNavScreenAppearance.vue": [["'Appearance'", "'화면 모드'"]],
  "theme-default/components/VPSidebar.vue": [["Sidebar Navigation", "사이드바 내비게이션"]],
  "theme-default/components/VPSidebarItem.vue": [['aria-label="toggle section"', 'aria-label="그룹 펼치기 또는 접기"']],
  "theme-default/components/VPSkipLink.vue": [["'Skip to content'", "'본문으로 건너뛰기'"]],
  "theme-default/components/VPSwitchAppearance.vue": [
    ["'Switch to light theme'", "'밝은 모드로 전환'"],
    ["'Switch to dark theme'", "'어두운 모드로 전환'"],
  ],
  "theme-default/composables/outline.js": [["'On this page'", "'이 페이지 목차'"]],
  // The Korean label below already exists for :lang(ko); drop the Chinese one so no Han ships in the CSS.
  "theme-default/styles/vars.css": [
    [`:lang(zh) {\n  --vp-code-copy-copied-text-content: '${String.fromCharCode(0x5df2, 0x590d, 0x5236)}';\n}\n`, ""],
  ],
};

function koreanThemeStrings() {
  const marker = "/vitepress/dist/client/";
  return {
    name: "korean-theme-strings",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const index = id.indexOf(marker);
      // Vue sub-requests (?vue&type=...) are compiled from the already transformed full SFC.
      if (index < 0 || id.includes("?")) return null;
      const file = id.slice(index + marker.length);
      const pairs = themeStrings[file];
      if (!pairs) return null;
      let output = code;
      for (const [from, to] of pairs) {
        if (!output.includes(from)) throw new Error(`korean-theme-strings: "${from}" not found in ${file}`);
        output = output.replaceAll(from, to);
      }
      return { code: output, map: null };
    },
  };
}

const codeLanguageLabels: Record<string, string> = { markdown: "마크다운", md: "마크다운", text: "텍스트", txt: "텍스트" };

const legacyHashRedirect = `
(function () {
  var hash = window.location.hash || '';
  if (!hash.startsWith('#/')) return;
  var raw = hash.slice(2).split('?id=')[0].split('#')[0];
  var clean = raw.replace(/^\\/+|\\/+$/g, '').replace(/\\/README(?:\\.md)?$/i, '');
  var target = '${base}' + (clean ? clean + '/' : '');
  if (window.location.pathname + window.location.search !== target) window.location.replace(target);
})();`;

export default defineConfig({
  lang: "ko-KR",
  title: siteTitle,
  description: defaultDescription,
  base,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ["SUMMARY.md"],
  sitemap: { hostname: siteUrl },
  markdown: {
    codeCopyButtonTitle: "코드 복사",
    config(md) {
      md.core.ruler.after("inline", "defer-content-images", (state) => {
        for (const token of state.tokens) {
          if (token.type !== "inline" || !token.children) continue;
          for (const child of token.children) {
            if (child.type !== "image") continue;
            child.attrSet("loading", "lazy");
            child.attrSet("decoding", "async");
            const path = localImagePath(child.attrGet("src") || "", state.env.path);
            const dimensions = path ? rasterDimensions.get(path) : undefined;
            if (dimensions) {
              child.attrSet("width", String(dimensions.width));
              child.attrSet("height", String(dimensions.height));
            }
          }
        }
      });
      // VitePress labels heading permalinks in English inside its bundled anchor plugin; relabel them in Korean.
      // README.md pages are served at their directory (see rewrites), so point links at the directory.
      md.core.ruler.push("readme-directory-links", (state) => {
        for (const token of state.tokens) {
          for (const child of token.children || []) {
            if (child.type !== "link_open") continue;
            const href = child.attrGet("href") || "";
            if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href)) continue;
            const match = href.match(/^((?:.*\/)?)README\.md(#.*)?$/);
            if (match) child.attrSet("href", `${match[1] || "./"}${match[2] || ""}`);
          }
        }
      });
      // VitePress prints the fence language (markdown, text) in the corner of every code block.
      const fence = md.renderer.rules.fence;
      if (fence) {
        md.renderer.rules.fence = (...args) =>
          fence(...args).replace(
            /<span class="lang">(markdown|md|text|txt)<\/span>/,
            (_, language) => `<span class="lang">${codeLanguageLabels[language]}</span>`,
          );
      }
      md.core.ruler.push("korean-anchor-labels", (state) => {
        state.tokens.forEach((token, index) => {
          if (token.type !== "heading_open") return;
          const inline = state.tokens[index + 1];
          for (const child of inline?.children || []) {
            if (child.type === "link_open" && child.attrGet("class") === "header-anchor") {
              child.attrSet("aria-label", `“${inline.content}” 고정 링크`);
            }
          }
        });
      });
    },
  },
  vite: { plugins: [koreanThemeStrings(), privateAssetGuard()] },
  rewrites: {
    "README.md": "index.md",
    "threads/archive/README.md": "threads/archive/index.md",
  },
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}assets/logo.svg` }],
    ["meta", { name: "theme-color", content: "#1f6f5c" }],
    ["meta", { name: "author", content: "한셴카이(필명 '리푸') 외 기여자 · 한국어 번역 2lab.ai" }],
    ["meta", { name: "build-revision", content: buildRevision }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["script", {}, legacyHashRedirect],
  ],
  themeConfig: {
    logo: "/assets/logo.svg",
    siteTitle: bookName,
    nav: [
      { text: "평생학습", link: "/templates/learning-state" },
      { text: "AI 학습", link: "/threads/part-3/1-ai-learning" },
      { text: "프로젝트 실천", link: "/threads/part-3/2-ai-development-and-resource-layer" },
      { text: "영어 학습", link: "/threads/part-1/0-cefr" },
    ],
    sidebar: toSidebar(navigation),
    socialLinks: [{ icon: "github", link: repositoryUrl, ariaLabel: "GitHub 저장소 (2lab-ai/up)" }],
    outline: { label: "이 페이지 목차", level: [2, 3] },
    docFooter: { prev: "이전 글", next: "다음 글" },
    editLink: { pattern: editLinkPattern, text: "GitHub에서 이 페이지 편집" },
    lastUpdated: {
      text: "마지막 업데이트",
      formatOptions: { dateStyle: "long", timeZone: "UTC", forceLocale: true },
    },
    returnToTopLabel: "맨 위로",
    sidebarMenuLabel: "목차",
    darkModeSwitchLabel: "화면 모드",
    lightModeSwitchTitle: "밝은 모드로 전환",
    darkModeSwitchTitle: "어두운 모드로 전환",
    skipToContentLabel: "본문으로 건너뛰기",
    notFound: {
      title: "페이지를 찾을 수 없습니다",
      quote: "길이 사라진 것이 아니라 이 페이지가 자리를 옮겼을 뿐일 때도 있습니다. 본 줄기로 돌아가 계속 나아가세요.",
      linkLabel: "『인생 레벨업 가이드』 홈으로 돌아가기",
      linkText: "홈으로 돌아가기",
    },
    search: {
      provider: "local",
      options: {
        _render(src, env, md) {
          const contentTokens = md
            .parse(src, env)
            .filter(({ type }) => type !== "fence" && type !== "code_block");
          // Code blocks stay out of the index. The upstream bibliography-heading filter was dropped:
          // none of its zh/en headings exists in the manuscript at 7478ac2 (scripts/ko/heading-map.json).
          return md.renderer.render(contentTokens, md.options, env);
        },
        miniSearch: {
          _splitIntoSections(file, html) {
            return splitSearchSections(file, html);
          },
        },
        translations: {
          button: { buttonText: "검색", buttonAriaLabel: "검색" },
          modal: {
            displayDetails: "상세 결과 표시",
            resetButtonTitle: "검색어 지우기",
            backButtonTitle: "검색 닫기",
            noResultsText: "검색 결과가 없습니다:",
            footer: {
              selectText: "선택",
              selectKeyAriaLabel: "Enter 키로 선택",
              navigateText: "이동",
              navigateUpKeyAriaLabel: "위쪽 화살표로 이전 항목 선택",
              navigateDownKeyAriaLabel: "아래쪽 화살표로 다음 항목 선택",
              closeText: "닫기",
              closeKeyAriaLabel: "Esc 키로 닫기",
            },
          },
        },
      },
    },
    footer: {
      message: [
        `원작: 한셴카이(byoungd)의 『인생 레벨업 가이드』 · 원문 <a href="${originalRepositoryUrl}">github.com/byoungd/up</a>`,
        `본문 <a href="${contentLicenseUrl}deed.ko">CC BY-NC 4.0</a> · 코드 MIT · 한국어 번역 <a href="${repositoryUrl}">2lab.ai</a> — 중국어 원문을 한국어로 옮김`,
      ].join("<br>"),
      copyright: "저작권 © 2017–현재 byoungd와 기여자 · 한국어 번역 © 2026 2lab.ai",
    },
  },
  // The pre-rendered 404.html takes its head from VitePress's built-in (English) not-found page data.
  transformHtml(html, _id, { pageData }) {
    if (!pageData.isNotFound) return;
    const localized = html.replace(
      '<meta name="description" content="Not Found">',
      '<meta name="description" content="페이지를 찾을 수 없습니다">',
    );
    if (localized.includes('content="Not Found"')) throw new Error("404.html: English description left");
    return localized;
  },
  transformPageData(pageData) {
    const updated = pageData.frontmatter.updated;
    const timestamp =
      updated instanceof Date
        ? updated.getTime()
        : typeof updated === "string"
          ? Date.parse(`${updated}T00:00:00Z`)
          : Number.NaN;
    if (Number.isFinite(timestamp)) {
      pageData.lastUpdated = timestamp;
    }
  },
  transformHead({ pageData }) {
    // The 404 page has no address of its own: no canonical, Open Graph URL, or structured data.
    if (pageData.isNotFound) return [];
    const route = routeFromRelativePath(pageData.relativePath);
    const isIndexPage = /(^|\/)(README|index)\.md$/.test(pageData.relativePath);
    const canonical = `${siteUrl}${route}${route && isIndexPage ? "/" : ""}`;
    const isBookHome = route === "";
    const isChapter = route.startsWith("threads/");
    const title = pageData.title || siteTitle;
    const description = pageData.frontmatter.description || `${title}. ${defaultDescription}`;
    const image = `${siteUrl}assets/feature.png`;
    const imageAlt = "『인생 레벨업 가이드』 책 공유 표지";
    const updated = pageData.frontmatter.updated;
    const dateModified =
      updated instanceof Date
        ? updated.toISOString().slice(0, 10)
        : typeof updated === "string"
          ? updated.slice(0, 10)
          : undefined;
    const structuredData: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": isBookHome ? "Book" : isChapter ? "Chapter" : "WebPage",
      name: isBookHome ? bookName : title,
      description,
      url: canonical,
      image,
      inLanguage: "ko-KR",
      author: originalAuthor,
      translator,
      isBasedOn: originalWork,
      license: contentLicenseUrl,
      ...(isBookHome
        ? {
            alternateName: "Life Level-up Guide",
            bookFormat: "https://schema.org/EBook",
            encoding: [
              {
                "@type": "MediaObject",
                encodingFormat: "application/epub+zip",
                contentUrl: `${siteUrl}downloads/life-level-up-guide-ko.epub`,
              },
              {
                "@type": "MediaObject",
                encodingFormat: "application/pdf",
                contentUrl: `${siteUrl}downloads/life-level-up-guide-ko.pdf`,
              },
            ],
          }
        : {
            isPartOf: {
              "@type": "Book",
              name: bookName,
              url: siteUrl,
            },
          }),
      ...(dateModified ? { dateModified } : {}),
    };
    const jsonLd = JSON.stringify(structuredData).replaceAll("<", "\\u003c");
    return [
      ["link", { rel: "canonical", href: canonical }],
      ["meta", { property: "og:type", content: isBookHome ? "book" : "article" }],
      ["meta", { property: "og:site_name", content: bookName }],
      ["meta", { property: "og:locale", content: "ko_KR" }],
      ["meta", { property: "og:title", content: title }],
      ["meta", { property: "og:description", content: description }],
      ["meta", { property: "og:url", content: canonical }],
      ["meta", { property: "og:image", content: image }],
      ["meta", { property: "og:image:type", content: "image/png" }],
      ["meta", { property: "og:image:width", content: "1200" }],
      ["meta", { property: "og:image:height", content: "630" }],
      ["meta", { property: "og:image:alt", content: imageAlt }],
      ["meta", { name: "twitter:title", content: title }],
      ["meta", { name: "twitter:description", content: description }],
      ["meta", { name: "twitter:image", content: image }],
      ["meta", { name: "twitter:image:alt", content: imageAlt }],
      ["script", { type: "application/ld+json" }, jsonLd],
    ];
  },
});
