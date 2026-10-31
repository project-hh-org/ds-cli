"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";

const MENUS = [
  { href: "/", label: "대시보드" },
  { href: "/orders", label: "주문" },
  { href: "/customers", label: "고객" },
  { href: "/products/1001", label: "상품" },
  { href: "/settings", label: "설정" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-white border-r border-gray-200 px-3 py-6">
      <h1 className="px-3 mb-[22px] text-lg font-bold text-[#3B82F6]">모노마켓</h1>
      <nav className="flex flex-col gap-1">
        {MENUS.map((menu) => {
          const active = menu.href === "/" ? pathname === "/" : pathname.startsWith(menu.href);
          return (
            <Link
              key={menu.href}
              href={menu.href}
              className={clsx(
                "rounded-md px-3 py-2 text-sm",
                active ? "bg-[#3B82F6] text-white" : "text-gray-700 hover:bg-gray-100",
              )}
            >
              {menu.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
