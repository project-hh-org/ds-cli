import clsx from "clsx";
import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  highlight?: boolean;
  className?: string;
}

export function EmptyState({ title, description, action, highlight, className }: EmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex flex-col items-center py-12 text-center",
        highlight && "bg-[#3B82F6]/10",
        className,
      )}
    >
      <p className="text-base font-semibold text-gray-900">{title}</p>
      {description && <p className="mt-2 text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
