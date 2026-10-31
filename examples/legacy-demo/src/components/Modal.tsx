"use client";

import type { ReactNode } from "react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

// radix 도입 전에 만든 모달. 포커스 트랩이 없어서 ui/dialog로 교체 예정이었음
export function Modal({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: "rgba(17, 24, 39, 0.5)", zIndex: 50 }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg w-[480px] p-[13px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} aria-label="닫기" className="text-[#6B7280]">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
