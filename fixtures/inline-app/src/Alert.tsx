export function Alert({ message }: { message: string }) {
  return (
    <div style={{ background: "#EF4444", padding: 12 }}>
      <strong>{message}</strong>
    </div>
  );
}
