/** @jsxImportSource @emotion/react */
import { css } from "@emotion/react";
import type { ReactNode } from "react";

const panel = css`
  color: #111827;
  padding: 16px;
`;

export function Panel({ children }: { children: ReactNode }) {
  return <section css={panel}>{children}</section>;
}
