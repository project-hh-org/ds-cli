import type { TextPatch } from "../patch/apply.js";

export interface MigrationPatch extends TextPatch {
  /** 원본에서 바뀐 구간의 텍스트(되돌리기 근거) */
  original: string;
}

export interface MigrationFile {
  /** root 상대 POSIX */
  file: string;
  /** 편집 전·후 내용의 sha256Text */
  before: string;
  after: string;
  /** 원본 좌표, start 오름차순 */
  patches: MigrationPatch[];
  status: "pending" | "applied" | "rolled-back" | "reverted" | "skipped-modified";
  reason?: string;
}

export interface MigrationRecord {
  version: 1;
  /** "20261101-143005"(로컬 시각), 같은 초에 있으면 "-2", "-3" */
  id: string;
  dsmith: string;
  /** ISO */
  createdAt: string;
  status: "applying" | "applied" | "reverted";
  summary: { tokens: number; components: number; files: number };
  /** `--close`로 close(근사) 매칭을 포함해 계획했는지. 없으면(이전 기록) 포함하지 않음 */
  close?: boolean;
  branch?: { name: string; base: string; /** 브랜치를 만들기 직전 HEAD */ baseSha?: string; commit: string | null };
  files: MigrationFile[];
}
