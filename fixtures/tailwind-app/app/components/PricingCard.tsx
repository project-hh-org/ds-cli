export function PricingCard({ title, price }: { title: string; price: string }) {
  return (
    <section className="bg-white p-[13px] border border-[#EF4444]">
      <h2 className="text-[#3B82F6]">{title}</h2>
      <p className="text-gray-900">{price}</p>
    </section>
  );
}
