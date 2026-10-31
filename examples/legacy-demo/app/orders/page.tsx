"use client";

import { useState } from "react";
import { Button } from "../../src/components/Button";
import { Select } from "@/components/forms/Select";
import { Table } from "@/components/Table";
import { Badge, type OrderStatus } from "@/components/common/StatusBadge";
import { Modal } from "@/components/Modal";
import { formatDate, formatWon } from "@/lib/format";

interface Order {
  id: string;
  customer: string;
  amount: number;
  status: OrderStatus;
  orderedAt: string;
}

const ORDERS: Order[] = [
  { id: "A-20931", customer: "박서연", amount: 48900, status: "paid", orderedAt: "2026-10-30T09:12:00" },
  { id: "A-20927", customer: "정민재", amount: 87000, status: "shipping", orderedAt: "2026-10-29T18:40:00" },
  { id: "A-20915", customer: "강지우", amount: 15900, status: "refunded", orderedAt: "2026-10-28T11:05:00" },
];

export default function OrdersPage() {
  const [status, setStatus] = useState("all");
  const [target, setTarget] = useState<Order | null>(null);

  const rows = status === "all" ? ORDERS : ORDERS.filter((o) => o.status === status);

  return (
    <div>
      <h1 className="page-title">주문 관리</h1>

      <div className="flex items-end gap-2 mb-[22px]">
        <div className="w-48">
          <Select
            label="주문 상태"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={[
              { value: "all", label: "전체" },
              { value: "paid", label: "결제완료" },
              { value: "shipping", label: "배송중" },
              { value: "refunded", label: "환불" },
            ]}
          />
        </div>
        <Button variant="secondary" size="sm">엑셀 다운로드</Button>
      </div>

      <Table
        rowKey={(o) => o.id}
        rows={rows}
        emptyText="조건에 맞는 주문이 없습니다."
        columns={[
          { key: "id", header: "주문번호" },
          { key: "customer", header: "주문자" },
          { key: "amount", header: "결제금액", align: "right", render: (o) => formatWon(o.amount) },
          { key: "status", header: "상태", render: (o) => <Badge status={o.status} /> },
          { key: "orderedAt", header: "주문일시", render: (o) => formatDate(o.orderedAt) },
          {
            key: "actions",
            header: "",
            render: (o) => (
              <Button variant="danger" size="sm" onClick={() => setTarget(o)}>
                취소
              </Button>
            ),
          },
        ]}
      />

      <Modal open={target !== null} title="주문 취소" onClose={() => setTarget(null)}>
        <p className="text-sm text-gray-700">{target?.id} 주문을 취소하시겠습니까?</p>
        <div style={{ marginTop: 18, textAlign: "right" }}>
          <Button variant="danger" onClick={() => setTarget(null)}>
            주문 취소
          </Button>
        </div>
      </Modal>
    </div>
  );
}
