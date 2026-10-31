import { theme } from "@/lib/theme";

interface TopbarProps {
  userName: string;
  unreadCount?: number;
}

export function Topbar({ userName, unreadCount = 0 }: TopbarProps) {
  return (
    <header
      style={{
        background: "#111827",
        border: "1px solid #E5E7EB",
        color: "#fff",
        padding: "10px 24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span style={{ fontWeight: 600 }}>모노마켓 어드민</span>
      <span style={{ fontSize: 13, color: theme.muted }}>
        {unreadCount > 0 && (
          <span
            title={`읽지 않은 알림 ${unreadCount}건`}
            style={{ backgroundColor: "rgb(59,130,246)", display: "inline-block", width: 8, height: 8, borderRadius: 4, marginRight: 8 }}
          />
        )}
        {userName} 님
      </span>
    </header>
  );
}
