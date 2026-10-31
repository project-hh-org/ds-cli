const LENGTH_PATTERN = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)?$/i;
const REM_PX = 16;

export function normalizeLength(raw: string): number | null {
  const match = LENGTH_PATTERN.exec(raw.trim());
  if (match === null) return null;

  const value = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  return unit === "rem" || unit === "em" ? value * REM_PX : value;
}
