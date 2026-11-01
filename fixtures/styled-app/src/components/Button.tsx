import styled from "styled-components";

export const Button = styled.button<{ $muted?: boolean }>`
  background: #3B82F6;
  padding: 13px;
  opacity: ${(p) => (p.$muted ? 0.5 : 1)};
`;
