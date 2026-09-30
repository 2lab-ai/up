# Docsify 배포 스냅숏

VitePress로 전이하기 전의 Docsify 사이트 전체는 Git 커밋 `42e6faa`에 남아 있다. 이 커밋에는 원래의 `docs/index.html`, 내비게이션, 콘텐츠, 정적 리소스가 들어 있어 읽기 전용 스냅숏이나 긴급 롤백 원본으로 쓸 수 있다.

이전 진입점 보기:

```bash
git show 42e6faa:docs/index.html
```

회복할 때는 이 커밋에서 별도의 임시 브랜치를 만들어 배포한다. 현재 `master`나 사용자 작업 공간의 커밋하지 않은 변경 사항을 덮어쓰지 않는다.
