import React from "react";

// 정산 화면에서 쓰던 헬퍼. 아직 js로 남아 있음
export function sumBy(list, key) {
  return list.reduce((acc, item) => acc + (item[key] || 0), 0);
}

export function EmptyNote({ text }) {
  return (
    <p style={{ padding: 7, color: "#6B7280", fontSize: 13 }}>
      {text || "표시할 내용이 없습니다."}
    </p>
  );
}
