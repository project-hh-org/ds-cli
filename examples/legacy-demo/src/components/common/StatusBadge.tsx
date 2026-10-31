export type OrderStatus = "paid" | "shipping" | "delivered" | "refunded";

const LABEL: Record<OrderStatus, string> = {
  paid: "결제완료",
  shipping: "배송중",
  delivered: "배송완료",
  refunded: "환불",
};

const BG: Record<OrderStatus, string> = {
  paid: "rgb(59,130,246)",
  shipping: "#F59E0B",
  delivered: "#10B981",
  refunded: "#F04545",
};

// 주문 상태 뱃지. 다른 곳의 Badge와는 별개로 만들었음
export function Badge({ status }: { status: OrderStatus }) {
  return (
    <span
      style={{
        backgroundColor: BG[status],
        color: "#fff",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        borderColor: status === "refunded" ? "#F04545" : "rgb(59,130,246)",
      }}
    >
      {LABEL[status]}
    </span>
  );
}
