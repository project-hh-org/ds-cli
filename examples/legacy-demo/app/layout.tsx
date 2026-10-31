import type { ReactNode } from "react";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";

export const metadata = {
  title: "모노마켓 어드민",
  description: "주문·고객·상품·정산 관리",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 flex flex-col">
            <Topbar userName="김운영" unreadCount={3} />
            <main className="p-6 bg-gray-50 flex-1">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
