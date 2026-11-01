type Props = {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
};

export function Pagination({ page, pageCount, onChange }: Props) {
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1);

  return (
    <nav className="flex items-center gap-1" aria-label="페이지 이동">
      <button
        className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        이전
      </button>
      {pages.map((p) => (
        <button
          key={p}
          className={p === page ? "rounded-md bg-brand px-3 py-1.5 text-sm text-white" : "rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onChange(p)}
        >
          {p}
        </button>
      ))}
      <button
        className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        다음
      </button>
    </nav>
  );
}
