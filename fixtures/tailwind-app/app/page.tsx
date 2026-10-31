import { PricingCard } from "./components/PricingCard";

export default function Page() {
  return (
    <main className="p-4">
      <h1 className="text-gray-900 text-2xl">요금제</h1>
      <PricingCard title="스타터" price="무료" />
    </main>
  );
}
