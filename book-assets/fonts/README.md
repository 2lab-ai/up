# PDF 폰트 관리

한국어 인쇄판에는 OFL 라이선스로 배포되는 Noto Serif KR의 400·700 굵기 서브셋을 임베드한다. 서브셋 문자 집합은 현재 한국어 EPUB의 본문 문자에 KS X 1001 한글 음절 2,350자, 라틴 문자, 자주 쓰는 문장부호를 더한 것이다. 원고를 조금 고쳐도 서브셋을 다시 만들 필요가 없도록 기본 문자 집합을 넉넉히 넣었다. Noto Serif KR에 없는 IPA 문자는 별도의 Noto Sans 대체 서브셋(`NotoSans-LifeLevelUp-IPA.ttf`)이 맡는다.

고정한 업스트림 원본은 Google Fonts 커밋 `d58d8d9f1c5c68363f51f4696bb79af59bc7cf0e`의 `ofl/notoserifkr/NotoSerifKR[wght].ttf`이며, SHA-256 값은 `11f8d5de6f1b79195efba3828aaa2ec95c1178f5ae976fb23c8d53250a9938f3`이다. 라이선스 전문은 `OFL-NotoSerifKR.txt`에 있다.

서브셋을 다시 생성하려면 먼저 한국어 EPUB을 만든 다음 다음을 실행한다.

```sh
python3 -m pip install -r requirements-fonts.txt
npm run book:build
python3 scripts/subset-pdf-fonts.py --source-font /path/to/NotoSerifKR[wght].ttf --baseline
npm run book:pdf:build
```

다시 생성하기 전에 내려받은 원본의 SHA-256 값을 확인하라. PDF 빌더는 필수 공백 글리프까지 포함해 커버리지를 한 번 더 점검하며, 원고에 필요한 문자가 하나라도 빠져 있으면 게시 전에 빌드를 실패시킨다.
