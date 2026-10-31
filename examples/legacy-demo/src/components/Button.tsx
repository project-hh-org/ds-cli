import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "primary", size = "md", className, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={`rounded-lg font-medium ${variant === "primary" ? "bg-[#3B82F6] text-white" : variant === "danger" ? "bg-[#F04545] text-white" : "bg-white text-gray-900 border border-gray-300"} ${size === "sm" ? "px-2 py-1 text-xs" : "px-[18px] py-2 text-sm"} ${className ?? ""}`}
    />
  );
}
