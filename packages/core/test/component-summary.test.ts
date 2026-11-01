import { describe, expect, it } from "vitest";
import type { ComponentUsage } from "../src/index.js";
import {
  duplicateNames,
  localDefinitionFiles,
  localDefinitionsOf,
  summarizeComponents,
} from "../src/component/summary.js";

function u(p: Partial<ComponentUsage> & { name: string }): ComponentUsage {
  return {
    file: "src/App.tsx",
    line: 1,
    importedFrom: null,
    module: "",
    props: [],
    ...p,
  };
}

describe("summarizeComponents", () => {
  it("name+module로 묶고 count 내림차순 → name → importedFrom → module로 정렬한다", () => {
    const result = summarizeComponents([
      u({ name: "Button", importedFrom: "src/a/Button", module: "src/a/Button" }),
      u({ name: "Button", importedFrom: "src/a/Button", module: "src/a/Button" }),
      u({ name: "Button", importedFrom: "src/b/Button", module: "src/b/Button" }),
      u({ name: "Badge", importedFrom: "src/Badge", module: "src/Badge" }),
    ]);
    expect(result.map((s) => [s.name, s.module, s.count])).toEqual([
      ["Button", "src/a/Button", 2],
      ["Badge", "src/Badge", 1],
      ["Button", "src/b/Button", 1],
    ]);
  });

  it("서브패스가 달라도 같은 module이면 한 그룹이고 importedFrom은 처음 본 값이다", () => {
    const result = summarizeComponents([
      u({ name: "Button", importedFrom: "@mui/material/Button", module: "@mui/material" }),
      u({ name: "Button", importedFrom: "@mui/material", module: "@mui/material" }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ importedFrom: "@mui/material/Button", module: "@mui/material", count: 2 });
  });

  it("props는 사용처의 합집합을 오름차순으로 낸다", () => {
    const result = summarizeComponents([
      u({ name: "B", module: "m", importedFrom: "m", props: ["variant"] }),
      u({ name: "B", module: "m", importedFrom: "m", props: ["size", "variant"] }),
    ]);
    expect(result[0]?.props).toEqual(["size", "variant"]);
  });

  it("files는 count 내림차순, 같으면 file 오름차순이다", () => {
    const result = summarizeComponents([
      u({ name: "B", module: "m", importedFrom: "m", file: "src/z.tsx" }),
      u({ name: "B", module: "m", importedFrom: "m", file: "src/b.tsx" }),
      u({ name: "B", module: "m", importedFrom: "m", file: "src/a.tsx" }),
      u({ name: "B", module: "m", importedFrom: "m", file: "src/z.tsx" }),
    ]);
    expect(result[0]?.files).toEqual([
      { file: "src/z.tsx", count: 2 },
      { file: "src/a.tsx", count: 1 },
      { file: "src/b.tsx", count: 1 },
    ]);
  });
});

describe("duplicateNames", () => {
  it("같은 이름이 둘 이상의 module에서 오면 사용 수 내림차순으로 모은다", () => {
    const s = summarizeComponents([
      u({ name: "Button", module: "a", importedFrom: "a" }),
      u({ name: "Button", module: "b", importedFrom: "b" }),
      u({ name: "Button", module: "b", importedFrom: "b" }),
      u({ name: "Badge", module: "c", importedFrom: "c" }),
      u({ name: "Badge", module: "d", importedFrom: "d" }),
      u({ name: "Card", module: "e", importedFrom: "e" }),
    ]);
    expect(duplicateNames(s)).toEqual(["Button", "Badge"]);
  });

  it("import 없는 지역 사용(module '')은 출처로 세지 않는다", () => {
    const s = summarizeComponents([
      u({ name: "Card", module: "src/Card", importedFrom: "src/Card" }),
      u({ name: "Card", module: "", declaredLocally: true }),
    ]);
    expect(duplicateNames(s)).toEqual([]);
  });

  it("패키지 서브패스와 루트 import는 중복이 아니다", () => {
    const s = summarizeComponents([
      u({ name: "Button", module: "@mui/material", importedFrom: "@mui/material/Button" }),
      u({ name: "Button", module: "@mui/material", importedFrom: "@mui/material" }),
    ]);
    expect(duplicateNames(s)).toEqual([]);
  });
});

describe("localDefinitionsOf / localDefinitionFiles", () => {
  const usages = [
    u({ name: "Header", file: "src/P.tsx", declaredLocally: true }),
    u({ name: "Header", file: "src/Q.tsx", declaredLocally: true }),
    u({ name: "Header", file: "src/Q.tsx", declaredLocally: true }),
    u({ name: "Icon", file: "src/P.tsx" }), // 선언 없음(props로 받은 것)
    u({ name: "Icon", file: "src/Q.tsx" }),
    u({ name: "Solo", file: "src/P.tsx", declaredLocally: true }), // 한 파일만
    u({ name: "Header", file: "src/R.tsx", importedFrom: "src/Header", module: "src/Header", declaredLocally: true }), // import 있음
  ];

  it("import 없이 쓰고 최상위 선언이 있는 이름 중 둘 이상의 파일에 있는 것만 낸다", () => {
    expect(localDefinitionsOf(usages)).toEqual([{ name: "Header", files: 2 }]);
  });

  it("파일 수 내림차순 → 이름순, limit(기본 20)을 적용한다", () => {
    const many: ComponentUsage[] = [];
    for (let i = 0; i < 25; i++) {
      const name = `C${String(i).padStart(2, "0")}`;
      many.push(u({ name, file: "a.tsx", declaredLocally: true }), u({ name, file: "b.tsx", declaredLocally: true }));
    }
    many.push(u({ name: "Z", file: "a.tsx", declaredLocally: true }), u({ name: "Z", file: "b.tsx", declaredLocally: true }), u({ name: "Z", file: "c.tsx", declaredLocally: true }));
    const result = localDefinitionsOf(many);
    expect(result).toHaveLength(20);
    expect(result[0]).toEqual({ name: "Z", files: 3 });
    expect(result[1]).toEqual({ name: "C00", files: 2 });
    expect(localDefinitionsOf(many, 3)).toHaveLength(3);
  });

  it("localDefinitionFiles는 declaredLocally 파일을 중복 없이 오름차순으로 낸다", () => {
    expect(localDefinitionFiles(usages, "Header")).toEqual(["src/P.tsx", "src/Q.tsx"]);
    expect(localDefinitionFiles(usages, "Icon")).toEqual([]);
  });
});
