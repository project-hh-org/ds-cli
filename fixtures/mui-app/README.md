dsmith 테스트용 fixture (실제 앱이 아님). MUI `sx`로 스타일링하는 작은 어드민.
- `sx`의 숫자 간격(`p: 2`, `paddingTop: 1`)·`borderRadius: 1`·팔레트 경로(`"primary.main"`)는 테마 token, `"13px"`·`"#111"`은 하드코딩으로 센다.
- `Button`을 `@mui/material`과 `@mui/material/Button` 양쪽에서 import해도 같은 모듈이므로 중복으로 보지 않는다.
