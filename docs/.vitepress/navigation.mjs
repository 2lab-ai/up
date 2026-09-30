const page = (text, link, source = `${link.replace(/^\//, "")}.md`) => ({
  text,
  link,
  source,
});

// Word lists keep programming-language names; the general lists get Korean labels.
const wordListLabels = { Common: "공통", Prompt: "프롬프트", VibeCoding: "바이브 코딩" };

export const navigation = [
  {
    text: "시작하기",
    items: [
      page("인생 레벨업 가이드", "/", "README.md"),
      page("읽기 가이드: 책을 삶으로 돌려놓기", "/threads/part-0/reader-guide"),
      page("서장: 인생을 바꾸려 서두르지 않기", "/threads/part-0/prologue"),
      page("용어와 방법 색인", "/reference/glossary"),
      page("도구 상자 둘러보기", "/templates/toolkit"),
    ],
  },
  {
    text: "제1부: 입력을 열다",
    items: [
      page("제1부 들어가며: 입력을 열다", "/threads/part-1/open-input"),
      page("CEFR 목표와 자가 진단", "/threads/part-1/0-cefr"),
      page("1. 인지와 훈련 원칙", "/threads/part-1/1-understanding"),
      page("2. 어휘 체계", "/threads/part-1/2-vocabulary"),
      page("문법 편: 구조가 뜻을 돕게 하기", "/threads/part-1/grammar"),
      page("3. 듣기 훈련", "/threads/part-1/3-listening"),
      page("4. 읽기 훈련", "/threads/part-1/4-reading"),
      page("5. 말하기 훈련", "/threads/part-1/5-speaking"),
      page("6. 쓰기 훈련", "/threads/part-1/6-writing"),
      page("7. AI로 영어 배우기", "/threads/part-1/7-ai"),
      page("8. 취업 영어와 원격 협업", "/threads/part-1/8-job-search-english"),
    ],
  },
  {
    text: "제2부: 나를 삶으로 돌려놓다",
    items: [
      page("제2부 들어가며: 나를 삶으로 돌려놓다", "/threads/part-2/return-to-life"),
      page("나의 이야기", "/threads/part-2/my-story"),
      page("서사와 증거 편: 경험을 운명으로 쓰지 않기", "/threads/part-2/narrative-and-evidence"),
      page("메아리 편: 도피를 낭만으로 쓰지 않기", "/threads/part-2/x-misc"),
      page("회복 편: 먼저 나를 붙들어 주기", "/threads/part-2/recovery"),
      page("선택 편: 불확실성 속에서 결정하기", "/threads/part-2/decision"),
      page("관계 편: 관계 속에서 어른이 되기", "/threads/part-2/relationships"),
      page("창업 편: 야심에서 사명으로", "/threads/part-2/entrepreneurship"),
    ],
  },
  {
    text: "제3부: 도구로 능력을 키우다",
    items: [
      page("제3부 들어가며: 도구로 능력을 키우다", "/threads/part-3/amplify-ability"),
      page("AI로 무엇이든 배우기", "/threads/part-3/1-ai-learning"),
      page("주의력 편: 주의력을 나에게 돌려주기", "/threads/part-3/3-attention-and-judgment"),
      page("작업물 편: 배운 것을 만들어 내기", "/threads/part-3/4-artifacts-and-delivery"),
      page("증거 편: 변화는 어떻게 보이게 되는가", "/threads/part-3/5-evidence-and-transfer"),
      page("AI 개발과 리소스 계층 창업", "/threads/part-3/2-ai-development-and-resource-layer"),
      page("저자 프로젝트와 현실 실천", "/projects"),
    ],
  },
  {
    text: "제4부: 실천과 회복",
    items: [
      page("제4부 들어가며: 실천과 회복", "/threads/part-4/practice-and-recovery"),
      page("실천 편: 먼저 첫 주를 끝까지 지내기", "/threads/part-4/week-1"),
      page("가정 학습 편: 성장을 아이에게 돌려주기", "/threads/part-4/family-learning"),
      page("생활 시스템 편: 변화를 하루하루에 들여놓기", "/threads/part-4/daily-system"),
      page("리듬 편: 작은 일이 시간을 건너가게 하기", "/threads/part-4/rhythm-and-compounding"),
    ],
  },
  {
    text: "제5부: 행동과 장기적 변화",
    items: [
      page("제5부 들어가며: 행동과 장기적 변화", "/threads/part-5/long-term-action"),
      page("행동 편: 90일, 삶을 나에게 되돌려주기", "/threads/part-5/90-day-plan"),
      page("사례 편: 이 책이 자기 방법을 증명하게 하기", "/threads/part-5/book-as-proof"),
      page("90일 이후: 변화를 삶에 남기기", "/threads/part-5/after-90-days"),
    ],
  },
  {
    text: "후기",
    items: [
      page("레벨업은 원래의 나를 떠나는 일이 아니다", "/threads/part-6/afterword"),
    ],
  },
  {
    text: "도구 상자",
    items: [
      page("도구 상자 실전: 세션을 넘는 AI 학습", "/templates/toolkit-walkthrough"),
      page("증거 사슬 템플릿", "/templates/evidence-chain"),
      page("독자 실천 회신", "/templates/reader-field-note"),
      page("가정 학습 공동 협약", "/templates/family-learning-agreement"),
      page("학습 상태 템플릿", "/templates/learning-state"),
      page("리듬 장부 템플릿", "/templates/rhythm-ledger"),
      page("주간 회고 템플릿", "/templates/weekly-review"),
      page("영어 능력 진단", "/templates/english-diagnostic"),
      page("취업 영어 증거 카드", "/templates/interview-evidence"),
      page("문법 증거 카드", "/templates/grammar-evidence"),
      page("어휘 증거 카드", "/templates/vocabulary-audit"),
      page("듣기 증거 카드", "/templates/listening-audit"),
      page("읽기 증거 카드", "/templates/reading-evidence"),
      page("말하기 증거 카드", "/templates/speaking-evidence"),
      page("쓰기 증거 카드", "/templates/writing-evidence"),
      page("90일 행동 총괄표", "/templates/90-day-cycle"),
      page("작업물 브리프와 전달 카드", "/templates/artifact-brief"),
      page("AI 과제 브리프", "/templates/ai-task-brief"),
      page("AI 학습 기록", "/templates/ai-learning-log"),
      page("AI 경험 사례 회고", "/templates/ai-case-review"),
      page("AI 프로젝트 점수표", "/templates/ai-project-scorecard"),
      page("생활 레벨업 워크시트", "/templates/life-practice-toolkit"),
    ],
  },
  {
    text: "옛글 보관함",
    items: [
      page("보관함 안내", "/threads/archive/", "threads/archive/README.md"),
      page("드디어 글 쓸 곳이 생겼다", "/threads/archive/a-place-to-write"),
      page("작년의 나와 지금의 나를 간단히 소개하며", "/threads/archive/last-year-and-now"),
      page("쓰러진 노인, 도와야 할까 말아야 할까", "/threads/archive/help-the-elderly"),
      page("블로그 임시 이름 변경 공지", "/threads/archive/blog-renaming-notice"),
    ],
  },
  {
    text: "단어 목록",
    items: [
      ...["Common", "Go", "Java", "JavaScript", "PHP", "Prompt", "Python", "Swift", "Rust", "VibeCoding"].map((name) =>
        page(wordListLabels[name] ?? name, `/threads/word-list/${name}`),
      ),
    ],
  },
];

export function publicationSections(navigation, { frontMatter = "", appendices = "" } = {}) {
  const [start, ...rest] = navigation;
  return [
    { text: frontMatter, items: start.items.slice(1, 3) },
    ...rest.slice(0, 6),
    {
      text: appendices,
      items: [...start.items.slice(3), ...navigation[7].items],
    },
  ];
}

export function publicationChapterCount(navigation) {
  return publicationSections(navigation).reduce((total, section) => total + section.items.length, 0);
}

const collapsedGroups = new Set(["도구 상자", "옛글 보관함", "단어 목록"]);

export function toSidebar(groups) {
  return groups.map(({ text, items }) => ({
    text,
    collapsed: collapsedGroups.has(text),
    items: items.map(({ text: itemText, link }) => ({ text: itemText, link })),
  }));
}
