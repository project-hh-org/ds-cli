/** @jsxImportSource @emotion/react */
import { Badge } from "../components/Badge";
import { Panel } from "../components/Panel";

export function Orders() {
  return (
    <Panel>
      <h2 css={{ fontSize: 18, marginBottom: 8 }}>주문 목록</h2>
      <p>
        #1024 <Badge>배송 지연</Badge>
      </p>
      <button css={{ padding: 8, "&:hover": { color: "#EF4444" } }}>주문 취소</button>
    </Panel>
  );
}
