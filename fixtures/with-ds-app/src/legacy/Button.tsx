import type { ReactNode } from "react";

export function Button({ children }: { children: ReactNode }) {
  return <button className="bg-blue-500 text-white">{children}</button>;
}
