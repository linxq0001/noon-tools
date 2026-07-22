"use client";

import { useState } from "react";
import { buildPagerItems } from "@/lib/pager";

type PagerProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function Pager({ page, pageSize, totalItems, totalPages, disabled = false, onPageChange, onPageSizeChange }: PagerProps) {
  const [pageJump, setPageJump] = useState("");
  const pagerItems = buildPagerItems(page, totalPages);

  function submitPageJump() {
    if (!pageJump.trim() || disabled) return;
    const nextPage = Number(pageJump);
    if (!Number.isInteger(nextPage)) return;
    onPageChange(Math.min(totalPages, Math.max(1, nextPage)));
    setPageJump("");
  }

  return (
    <nav aria-label="分页导航" className="pager">
      <span className="pager-total">共 {totalItems} 条</span>
      <button aria-label="上一页" className="pager-arrow" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} type="button">‹</button>
      <div className="pager-pages">
        {pagerItems.map((item, index) => item === "ellipsis" ? (
          <span aria-hidden="true" className="pager-ellipsis" key={`ellipsis-${index}`}>•••</span>
        ) : (
          <button aria-current={item === page ? "page" : undefined} className={item === page ? "pager-page-button active" : "pager-page-button"} disabled={disabled} key={item} onClick={() => onPageChange(item)} type="button">{item}</button>
        ))}
      </div>
      <button aria-label="下一页" className="pager-arrow" disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">›</button>
      <select aria-label="每页条数" data-page-size disabled={disabled} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
        {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条/页</option>)}
      </select>
      <label className="pager-jump">
        跳至
        <input className="pager-jump-input" disabled={disabled} inputMode="numeric" value={pageJump} onBlur={submitPageJump} onChange={(event) => setPageJump(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitPageJump(); }} />
        页
      </label>
    </nav>
  );
}
