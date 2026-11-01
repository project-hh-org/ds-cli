import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ProductForm({ onSubmit }: { onSubmit: (name: string, price: number) => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);

  return (
    <form
      className="space-y-4 rounded-[var(--radius-sm)] bg-[color:var(--color-gray-50)] p-[var(--space-5)]"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(name, price);
      }}
    >
      <label className="block text-[color:var(--color-blue-900)]">
        상품명
        <input
          className="mt-[var(--space-2)] block w-full rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)]"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="block text-[color:var(--color-blue-900)]">
        가격
        <input
          type="number"
          className="mt-[var(--space-2)] block w-full rounded-[var(--radius-sm)] px-[var(--space-3)] py-[var(--space-2)]"
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
        />
      </label>
      <p style={{ color: "var(--color-red-500)" }}>가격은 0 이상이어야 합니다.</p>
      <Button type="submit">저장</Button>
    </form>
  );
}
