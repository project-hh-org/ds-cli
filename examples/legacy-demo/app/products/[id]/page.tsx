import PrimaryButton from "@/legacy/PrimaryButton";
import { EmptyNote, sumBy } from "@/lib/legacy-helpers";
import { formatWon, percent } from "@/lib/format";

const PRODUCT = {
  name: "무선 핸디 청소기 HC-200",
  price: 189000,
  stock: 42,
  variants: [
    { sku: "HC200-WH", color: "화이트", stock: 30 },
    { sku: "HC200-BK", color: "블랙", stock: 12 },
  ],
};

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const total = sumBy(PRODUCT.variants, "stock");

  return (
    <div>
      <h1 className="page-title">상품 상세 #{params.id}</h1>

      <div className="bg-white rounded-lg px-[18px] py-4 border border-gray-200">
        <h2 className="text-lg font-semibold text-[#111827]">{PRODUCT.name}</h2>
        <p className="mt-2 text-2xl font-bold text-gray-900">{formatWon(PRODUCT.price)}</p>
        <p className="mt-[22px] text-sm text-gray-500">
          재고 {total}개 (옵션별 비중: {PRODUCT.variants.map((v) => `${v.color} ${percent(v.stock, total)}`).join(", ")})
        </p>
        <ul className="mt-4 gap-2 flex flex-col">
          {PRODUCT.variants.map((v) => (
            <li key={v.sku} className="text-sm text-gray-700">
              {v.sku} · {v.color} · {v.stock}개
            </li>
          ))}
        </ul>
        {PRODUCT.variants.length === 0 && <EmptyNote text="등록된 옵션이 없습니다." />}
      </div>

      <div style={{ marginTop: 18, display: "flex", gap: "10px" }}>
        <PrimaryButton>상품 수정</PrimaryButton>
        <PrimaryButton>품절 처리</PrimaryButton>
      </div>
    </div>
  );
}
