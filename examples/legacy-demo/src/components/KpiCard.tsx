import { theme } from "@/lib/theme";

interface KpiCardProps {
  label: string;
  value: string;
  delta?: number;
}

// 대시보드 상단 카드. 급하게 만들어서 className이랑 style이 섞여 있음
export function KpiCard({ label, value, delta }: KpiCardProps) {
  const up = (delta ?? 0) >= 0;

  return (
    <div
      className="bg-white rounded-lg p-4 border border-gray-200"
      style={{ padding: 13, borderColor: "#E5E7EB", minWidth: 200 }}
    >
      <p className="text-sm text-[#6B7280]">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      {delta !== undefined && (
        <p className="mt-1 text-xs" style={{ color: up ? theme.primary : "#EF4444" }}>
          {up ? "▲" : "▼"} 전일 대비 {Math.abs(delta)}%
        </p>
      )}
    </div>
  );
}
