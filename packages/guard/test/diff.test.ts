import { afterEach, describe, expect, it } from "vitest";
import { changedFiles, fileAtBase } from "../src/diff.js";
import { cleanupTmps, commitAll, git, makeRepo, write } from "./helpers.js";

afterEach(cleanupTmps);

function repo(): string {
  const root = makeRepo({ "a.txt": "a\n", "dir/b.txt": "b\n" });
  git(root, "init", "-q", "-b", "main");
  commitAll(root, "base");
  git(root, "switch", "-q", "-c", "feat");
  return root;
}

describe("changedFiles / fileAtBase", () => {
  it("이름 바꾼 파일은 baseOf에 옛 경로를 담는다(R100 포함)", async () => {
    const root = repo();
    git(root, "mv", "a.txt", "moved.txt");
    write(root, "dir/c.txt", "c\n");
    commitAll(root, "feat");
    const res = await changedFiles(root, "main");
    expect(res.files).toEqual(["dir/c.txt", "moved.txt"]);
    expect([...res.baseOf]).toEqual([["moved.txt", "a.txt"]]);
  });

  it("fileAtBase: merge-base에 없는 경로는 null, 그 밖의 git 오류는 stderr와 함께 던진다", async () => {
    const root = repo();
    const mb = git(root, "rev-parse", "main").trim();
    expect(await fileAtBase(root, mb, "a.txt")).toBe("a\n");
    expect(await fileAtBase(root, mb, "nope.txt")).toBeNull();
    write(root, "untracked.txt", "u\n");
    expect(await fileAtBase(root, mb, "untracked.txt")).toBeNull();
    await expect(fileAtBase(root, "no-such-rev", "a.txt")).rejects.toThrow(/git show .* 실패: /);
  });
});
