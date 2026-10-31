import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function Input({ label, error, id, ...rest }: InputProps) {
  return (
    <label htmlFor={id} className="block text-sm text-gray-700">
      {label}
      <input
        id={id}
        {...rest}
        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-[#3B82F6] focus:outline-none"
      />
      {error && <span className="mt-1 block text-xs text-[#e53e3e]">{error}</span>}
    </label>
  );
}
