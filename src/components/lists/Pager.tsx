"use client";
// «Προηγούμενη / Επόμενη» — ίδιο με τη λίστα συμβολαίων (dash-pager).

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";
import { pageCount } from "@/lib/pagination";

export default function Pager({
  page,
  total,
  pageSize,
  loading,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  loading: boolean;
  onPage: (page: number) => void;
}) {
  const tr = useT();
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  return (
    <div className="dash-pager">
      <button className="dash-btn" disabled={page <= 1 || loading} onClick={() => onPage(Math.max(1, page - 1))} aria-label={tr("contracts.prevPage")}>
        <ChevronLeft size={16} />
      </button>
      <span className="dash-count">
        {tr("contracts.page")} {page} / {pages}
      </span>
      <button className="dash-btn" disabled={page >= pages || loading} onClick={() => onPage(Math.min(pages, page + 1))} aria-label={tr("contracts.nextPage")}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
