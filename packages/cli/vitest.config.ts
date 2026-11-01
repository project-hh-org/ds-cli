import { defineConfig } from "vitest/config";

// cli 테스트는 빌드된 CLI를 자식 프로세스로 여러 번 띄운다 — CI 러너에서 기본 5초를 넘기는 일이 있어 넉넉히 둔다
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
