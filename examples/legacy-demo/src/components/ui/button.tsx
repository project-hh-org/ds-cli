import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

const variants = {
  default: "bg-brand text-white hover:bg-[#3C83F7]",
  outline: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  destructive: "bg-[#EF4444] text-white hover:bg-[#e53e3e]",
  ghost: "text-[#6B7280] hover:bg-gray-100",
};

const sizes = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = "default", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
