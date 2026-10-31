import clsx from "clsx";
import type { ReactNode } from "react";

interface BadgeProps {
  color?: "blue" | "gray" | "red";
  children: ReactNode;
}

export function Badge({ color = "gray", children }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-block rounded-full px-2 py-[3px] text-xs",
        color === "blue" && "bg-[#3C83F7] text-white",
        color === "red" && "bg-[#EF4444] text-white",
        color === "gray" && "bg-gray-100 text-gray-700",
      )}
    >
      {children}
    </span>
  );
}
