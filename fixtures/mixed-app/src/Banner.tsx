export function Banner({ text }: { text: string }) {
  return (
    <div className="text-[#3B82F6]" style={{ padding: 12 }}>
      {text}
    </div>
  );
}
