# 한국어판 번역 파이프라인 (`scripts/ko`)

원본 [byoungd/up](https://github.com/byoungd/up)(커밋 `7478ac2`)의 중국어 본문과 영어 저장소 문서를 한국어로 옮기는 스크립트 모음이다. 번역은 LLM이 하고, 구조 보존·한자 0자·앵커 연결은 기계 게이트가 검사하며, 다른 모델이 교차 검토한다. 외부 패키지 없이 Node.js(>= 20)만으로 돈다.

## 한눈에 보기

| 단계 | 명령 | 하는 일 | 산출물 |
| --- | --- | --- | --- |
| 1 | `node scripts/ko/pipeline.mjs glossary --write` | 용어·제목·내비게이션 라벨·반복 소제목 용어집 생성 | `scripts/ko/glossary.md` |
| 1b | `node scripts/ko/pipeline.mjs glossary --supplement --write` | 책 전체를 한 번에 읽혀 인명·지명·기업·시험·도서 제목을 보충(기존 행은 그대로) | `scripts/ko/glossary.md` |
| 2–3 | `node scripts/ko/pipeline.mjs translate` | 파일 단위 번역 + 기계 게이트(실패 시 결함 목록을 붙여 1회 재시도) | 작업 트리의 번역 파일 |
| 4 | `node scripts/ko/pipeline.mjs anchors` | 모든 제목의 중→한 대응표, 내부 `#조각` 링크를 한국어 제목 id로 교체 | `scripts/ko/heading-map.json` |
| 5 | `node scripts/ko/pipeline.mjs review` | 다른 모델의 교차 검토 → MUST 문제가 있는 파일은 번역 모델이 다시 번역 → 게이트·앵커 → 1회 재검토 | `scripts/ko/review-report.json` |
| 5b | `node scripts/ko/pipeline.mjs polish` | MUST 없이 SHOULD만 받은 파일: 번역 모델이 정확한 찾아 바꾸기 편집만 제안 → 적용 → 게이트·앵커 → 1회 재검토(MUST가 늘면 되돌림) | `scripts/ko/review-report.json` |
| 5c | `node scripts/ko/pipeline.mjs audit` | 검토 모델이 문장 단위로 뜻이 바뀐 곳만 다시 찾음 → 번역 모델의 찾아 바꾸기 → 게이트·앵커 → 1회 재감수(지적이 늘면 되돌림) | `review-report.json`의 `audit` |
| 5d | `node scripts/ko/pipeline.mjs readme` | 루트 `README.md`를 번역된 `docs/README.md`의 저장소용 사본으로 다시 만듦(원본에서도 `scripts/sync-readme.mjs`가 만드는 사본이다) | `README.md` |
| 검사 | `node scripts/ko/pipeline.mjs gates` | 최종 게이트(한자 0자 포함) 전수 검사, 실패 시 종료 코드 1 | 표준 출력 |
| 6 | `node scripts/ko/pipeline.mjs manifest` | 원문·번역 해시, 모델, 프롬프트 버전 기록 | `scripts/ko/manifest.json` |

`node scripts/ko/pipeline.mjs all`은 2→4→5→5b→5c→5d→4→검사→6을 한 번에 돈다. 특정 파일만 돌리려면 뒤에 `--only docs/threads/part-1/0-cefr.md …`를 붙인다.

용어집은 사람이 읽고 고친 뒤에 번역을 돌린다. 1·1b 단계의 모델 원본은 `.ko-work/glossary.raw.md`, `.ko-work/glossary-supplement.raw.md`에 남는다. 같은 중국어에 한국어가 둘이면 안 되고(검사: 모든 zh가 한 가지 ko), ko 칸에 한자가 있으면 안 된다. ‘반복 개념’ 절은 기본 대응어라 문맥에 따라 바꿔 쓸 수 있고, 나머지 절(제목·소제목·용어·고유명사)은 글자 그대로 쓴다.

## 준비

- LLM 게이트웨이: 기본값은 로컬 llmux `http://127.0.0.1:3456`의 Anthropic Messages API다(`x-api-key` 아무 값, 스트리밍 SSE). 다른 곳을 쓰려면 환경 변수로 바꾼다.
  - `KO_LLM_BASE_URL`, `KO_LLM_API_KEY`
  - `KO_LLM_SYSTEM_PREFIX` — llmux는 구독(OAuth) 계정으로 중계하므로 첫 system 블록이 Claude Code 식별 문장이어야 429를 피한다(기본값). 일반 API 키로 직접 부를 때는 빈 문자열로 둔다.
  - `KO_MAX_INFLIGHT`(기본 5): 동시에 보내는 요청 수 상한. 429·5xx·overloaded·네트워크 오류는 지수 백오프로 재시도한다.
- 모델(`config.mjs`): 번역 `claude-opus-5-5`(effort high), 검토 `claude-fable-5-1`(effort high, 구조화 출력 JSON, 거절 시 서버 측 폴백 `claude-opus-4-8`). 번역 모델과 검토 모델이 같으면 `review.mjs`가 시작하지 않는다. 실제로 응답한 모델은 `review-report.json`의 `reviewer_served_by`에 남는다.
- 원문은 작업 트리가 아니라 git 커밋에서 읽는다(`git show 7478ac2:<path>`). 작업 트리에는 번역본이 들어 있기 때문이다. 다른 커밋을 원문으로 쓰려면 `KO_SOURCE_REF=<ref>`를 준다.

## 캐시와 재실행

- 모든 LLM 응답은 `.ko-work/cache/<단계>/<sha256>.json`에 저장된다. 키는 원문 + 프롬프트 버전 + 용어집(파일에 해당하는 행) + 모델·effort의 sha256이라, 같은 입력이면 다시 부르지 않는다. 중간에 끊겨도 같은 명령을 다시 치면 끝난 호출은 캐시에서 읽는다.
- `translate`는 원문·용어집·프롬프트 버전이 그대로이고 이미 번역된 파일을 건너뛴다(`.ko-work/state/translate.json` 기준). 검토·다듬기·감수·수작업 수정이 들어간 작업 트리를 첫 번역으로 되돌리지 않기 위해서다. 다시 번역하려면 `--force`.
- 자동 단계 뒤에 사람이 판정해 고친 곳과 그대로 둔 지적은 `review-report.json`의 `summary.adjudication`에 남긴다(수정 내용, 근거, 재감수 결과).
- 호출 로그: `.ko-work/logs/llm.jsonl`(모델, 실제 응답 모델, 토큰, 소요 시간, 오류).
- 프롬프트를 고치면 `config.mjs`의 `PROMPT_VERSION`을 올린다.

## 원본이 갱신됐을 때 (upstream sync)

```bash
git fetch https://github.com/byoungd/up.git main:upstream-main
KO_SOURCE_REF=upstream-main node scripts/ko/pipeline.mjs sync
```

`sync`는 `manifest.json`의 `source_sha256`과 새 원문을 비교해 바뀐 파일만 번역·앵커·검토·게이트를 돌리고 매니페스트를 갱신한다. 새 커밋을 기준으로 삼으면 `config.mjs`의 `UPSTREAM.commit`도 바꾼다.

## 게이트 (파일마다)

- a. 한자(`\p{Script=Han}`) 0자 — frontmatter·코드·alt 포함. 셸에서 확인할 때도 `grep -lP '\p{Script=Han}'`을 쓴다. PCRE2 10.40 이후의 `\p{Han}`은 Script_Extensions로 해석돼 한국어 문장부호인 가운뎃점(·, U+00B7)과 「」『』(U+300C–U+300F)까지 잡는다.
- b. 구조 동일 — frontmatter 키와 순서, 제목 레벨 순서, 코드펜스, 표의 행·열, 목록 항목, 인용 줄, `:::` 컨테이너, HTML 태그, 링크·이미지 대상(내부 `#조각`은 4단계에서 따로 검사).
- c. 길이 비율 — 중국어 원문일 때 번역 글자 수 ÷ 원문 글자 수(공백 제외)가 0.9–2.6 밖이면 사람이 읽는다(자동 실패 아님).
- d. 코드 밖 전각 문장부호 금지 — `（），。：；！？、【】《》`와 전각 ASCII(U+FF01–FF5E). 「」는 스타일 가이드가 글·장 제목에 쓰라고 정했으므로 금지 대신 줄마다 짝이 맞는지 검사한다.
- e. frontmatter가 YAML로 읽혀야 한다 — `": "`가 들어가거나 YAML 특수문자로 시작하는 값은 자동으로 큰따옴표로 감싸고(`scripts/check-content.mjs`의 규칙과 같음) 다시 검사한다.

## 앵커 (`heading-map.json`)

VitePress 1.6.4의 slugify를 그대로 옮겨(`lib/markdown.mjs`) 제목 id를 계산한다. 이 함수는 NFKD 정규화를 하므로 **한국어 id는 자모가 분해된 문자열**이다(`도구와 전달` → `도구와-전달`처럼 보여도 코드 포인트는 U+1103…). 그래서 링크 조각은 `encodeURIComponent(ko_slug)`로 적는다 — VitePress 라우터가 `decodeURIComponent(hash)`로 풀어 id와 비교한다. 같은 id가 겹치면 `-1`, `-2`가 붙는다. `heading-map.json`에는 모든 파일의 모든 제목이 `zh → ko → ko_slug` 순서로 들어 있어, 설정 파일의 중국어 제목 문자열을 한국어로 바꿀 때 쓴다.

## 파일 구성

- `pipeline.mjs` — 진입점(위 명령들)
- `config.mjs` — 모델·경로·대상 파일 목록(`docs/**/*.md` 중 `docs/en/**`·`docs/SUMMARY.md` 제외 + 루트 문서 13개)
- `glossary.mjs`, `translate.mjs`, `anchors.mjs`, `review.mjs`, `polish.mjs`, `audit.mjs`, `manifest.mjs` — 단계별 구현
- `lib/llm.mjs`(원시 HTTP + SSE 클라이언트), `lib/markdown.mjs`(구조 분석·slugify·frontmatter), `lib/gates.mjs`(게이트), `lib/glossary.mjs`(용어집 파서)
- `prompts/` — 번역·검토·용어집 프롬프트와 스타일 가이드
- `glossary.md`, `heading-map.json`, `review-report.json`, `manifest.json` — 산출물

`SUMMARY.md`·`docs/SUMMARY.md`는 `docs/.vitepress/navigation.mjs`에서 생성되므로 이 파이프라인이 번역하지 않는다. `LICENSE-CODE.md`(MIT 원문)도 그대로 둔다.
