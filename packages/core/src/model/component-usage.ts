export interface ComponentUsage {
  file: string;
  line: number;
  name: string;
  /** 상대 경로·`@/` 별칭은 root 상대 경로로, 패키지는 import한 specifier 그대로. import가 없으면 null. */
  importedFrom: string | null;
  /**
   * 같은 모듈 판정용 키. 패키지는 서브패스를 뗀 패키지명(`@mui/material/Button` → `@mui/material`),
   * 경로는 tsconfig paths·baseUrl까지 풀어 확장자·끝 `/`·`/index`를 뗀 root 상대 경로(root index는 "index").
   * paths 별칭이 root 밖이나 의존성 패키지를 가리키면 패키지명. import가 없으면 "".
   */
  module: string;
  props: string[];
  /**
   * import 없이(importedFrom null) 쓴 이름이 그 파일 최상위에 선언돼 있으면 true
   * (`function X`, `const/let/var X =`, `class X`, `export default function X`). 아니면 필드가 없다.
   * props·지역 변수로 받은 컴포넌트(`<Icon />`, `const Tag = as ?? "div"`)를 지역 재정의 집계에서 빼는 데 쓴다.
   */
  declaredLocally?: boolean;
}
