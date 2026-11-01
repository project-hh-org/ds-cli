import { useState } from "react";
import { Button } from "@/components/Button";

export function ProductForm({ onSubmit }: { onSubmit: (name: string, price: number) => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);

  return (
    <form
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-6"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name, price);
      }}
    >
      <label className="block text-sm font-medium text-gray-700">
        상품명
        <input
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-[7px] text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block text-sm font-medium text-gray-700">
        가격
        <input
          type="number"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-[7px] text-sm"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
      </label>
      <p className="text-xs" style={{ color: "#dc2626" }}>
        가격은 0 이상이어야 합니다.
      </p>
      <Button type="submit">저장</Button>
    </form>
  );
}
