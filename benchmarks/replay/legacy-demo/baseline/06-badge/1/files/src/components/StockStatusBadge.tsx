type Stock = "enough" | "low" | "out";

const LABEL: Record<Stock, string> = { enough: "충분", low: "부족", out: "품절" };

const STYLE: Record<Stock, string> = {
  enough: "bg-green-100 text-green-800",
  low: "bg-yellow-100 text-yellow-800",
  out: "bg-[#fee2e2] text-red-800",
};

export function StockStatusBadge({ stock }: { stock: Stock }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-xs font-medium ${STYLE[stock]}`}>
      {LABEL[stock]}
    </span>
  );
}
