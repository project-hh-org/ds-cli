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
}
