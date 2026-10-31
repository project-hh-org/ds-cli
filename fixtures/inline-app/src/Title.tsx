const theme = { primary: "#3B82F6" };

export function Title({ text }: { text: string }) {
  return <h1 style={{ color: theme.primary }}>{text}</h1>;
}
