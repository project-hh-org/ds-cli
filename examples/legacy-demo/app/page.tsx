import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/KpiCard";
import { Table } from "@/components/Table";
import { formatWon } from "@/lib/format";
import { theme } from "@/lib/theme";

const RECENT = [
  { id: "A-20931", customer: "박서연", amount: 48900, channel: "앱" },
  { id: "A-20930", customer: "이도윤", amount: 129000, channel: "웹" },
  { id: "A-20929", customer: "최하은", amount: 23500, channel: "앱" },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title" style={{ color: theme.primary }}>대시보드</h1>
        <Button variant="outline" size="sm">리포트 내려받기</Button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <KpiCard label="오늘 주문" value="128건" delta={12} />
        <KpiCard label="오늘 매출" value={formatWon(4820000)} delta={4} />
        <KpiCard label="신규 고객" value="37명" delta={-3} />
        <KpiCard label="정산 예정" value={formatWon(12350000)} />
      </div>

      <section className="bg-white rounded-lg p-4 mt-6">
        <h2 className="mb-3 text-base font-semibold text-gray-900">최근 주문</h2>
        <Table
          rowKey={(r) => r.id}
          rows={RECENT}
          columns={[
            { key: "id", header: "주문번호" },
            { key: "customer", header: "고객" },
            { key: "channel", header: "채널" },
            { key: "amount", header: "금액", align: "right", render: (r) => formatWon(r.amount) },
          ]}
        />
        <div style={{ marginTop: 18, display: "flex", gap: "10px" }}>
          <Button size="sm">주문 전체 보기</Button>
          <Button variant="ghost" size="sm">정산 내역</Button>
        </div>
      </section>
    </div>
  );
}
