import { Badge } from "@/components/Badge";
import { Badge as StatusBadge } from "@/components/common/StatusBadge";
import { Table } from "@/components/Table";
import { EmptyState } from "@/components/EmptyState";
import { maskPhone, formatRelative } from "@/lib/format";
import { theme } from "@/lib/theme";

const CUSTOMERS = [
  { id: 1, name: "박서연", phone: "010-2345-6789", grade: "VIP", lastOrder: "2026-10-30T09:12:00", lastStatus: "paid" },
  { id: 2, name: "이도윤", phone: "010-8812-3345", grade: "일반", lastOrder: "2026-10-27T21:03:00", lastStatus: "delivered" },
  { id: 3, name: "최하은", phone: "010-5521-9087", grade: "휴면", lastOrder: "2026-07-02T14:30:00", lastStatus: "refunded" },
] as const;

export default function CustomersPage() {
  if (CUSTOMERS.length === 0) {
    return <EmptyState title="등록된 고객이 없습니다" description="첫 주문이 들어오면 여기에 표시됩니다." />;
  }

  return (
    <div>
      <h1 className="page-title">고객 관리</h1>
      <p className="mb-4 text-sm" style={{ color: theme.muted }}>
        전체 {CUSTOMERS.length}명 · 휴면 고객은 90일 이상 주문이 없는 고객입니다.
      </p>

      <Table
        rowKey={(c) => String(c.id)}
        rows={[...CUSTOMERS]}
        columns={[
          { key: "name", header: "이름" },
          { key: "phone", header: "연락처", render: (c) => maskPhone(c.phone) },
          {
            key: "grade",
            header: "등급",
            render: (c) => <Badge color={c.grade === "VIP" ? "blue" : c.grade === "휴면" ? "red" : "gray"}>{c.grade}</Badge>,
          },
          { key: "lastOrder", header: "최근 주문", render: (c) => formatRelative(c.lastOrder) },
          { key: "lastStatus", header: "최근 상태", render: (c) => <StatusBadge status={c.lastStatus} /> },
        ]}
      />

      <a href="/orders" className="mt-6 inline-block underline" style={{ color: "#3B82F6" }}>
        주문 내역으로 이동
      </a>
    </div>
  );
}
