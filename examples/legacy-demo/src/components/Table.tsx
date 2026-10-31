import type { ReactNode } from "react";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  render?: (row: T) => ReactNode;
}

interface TableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyText?: string;
}

export function Table<T extends Record<string, any>>({ columns, rows, rowKey, emptyText }: TableProps<T>) {
  if (rows.length === 0) {
    return <p className="p-4 text-center text-gray-500">{emptyText ?? "데이터가 없습니다."}</p>;
  }

  return (
    <table className="w-full text-sm bg-white border border-[#E5E7EB]">
      <thead className="bg-[#F9FAFB]">
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={`px-4 py-2 font-medium text-gray-700 ${col.align === "right" ? "text-right" : "text-left"}`}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)} className="border-t border-gray-200">
            {columns.map((col) => (
              <td key={col.key} className="px-4 py-[11px]">
                {col.render ? col.render(row) : row[col.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
