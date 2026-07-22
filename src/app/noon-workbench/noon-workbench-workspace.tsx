"use client";

import "./noon-workbench.css";
import {
  GlobalCard,
  MarketMetric,
  MarketSource,
  OfferStatus,
} from "@/components/noon/market-cards";
import { Pager } from "@/components/workbench/pager";
import { useEffect, useMemo, useRef, useState } from "react";

type NoonStore = { id: string; name: string };

type CatalogMode = "fbn" | "global";
type CatalogSyncSource = "internal_api" | "export";
type SyncJobStatus = "idle" | "running" | "completed" | "failed";
type JobLog = { line: string };
type SyncJob = { id: string; status: SyncJobStatus; logs?: JobLog[]; error?: string };
type SyncProgress = { message: string; detail: string; percent: number; error: string };
type CatalogRow = { title: string; psku: string; sku: string; price: string; inventory: string; issues: string; imageUrl: string };
type CatalogPagination = { page: number; pageSize: number; totalItems: number; totalPages: number };
type CatalogSync = { synced: boolean; rows: CatalogRow[]; output: string; fileName: string; pagination?: CatalogPagination };
type BulkUpdateFiles = { product: string; price: string; stock: string };
type BulkOperation =
  | { type: "set_attribute"; field: string; value: string }
  | { type: "set_price"; countryCodes: string; price: string }
  | { type: "set_stock"; stock: string; warehouseCode?: string }
  | { type: "set_processing_time"; processingTime: string; warehouseCode?: string }
  | { type: "delete_products" };

function CatalogSyncActions({ catalogMode, disabled, exportDisabled, onStart }: {
  catalogMode: CatalogMode;
  disabled: boolean;
  exportDisabled: boolean;
  onStart: (source: CatalogSyncSource) => void;
}) {
  return (
    <div className="noon-sync-actions">
      <button disabled={disabled} onClick={() => onStart("internal_api")} type="button">API 快速同步</button>
      <button
        aria-describedby={catalogMode === "global" ? undefined : "catalog-export-mode-note"}
        disabled={exportDisabled}
        onClick={() => onStart("export")}
        title={catalogMode === "global" ? undefined : "导出同步仅支持 Global 模式"}
        type="button"
      >导出同步</button>
    </div>
  );
}

function CatalogCover({ imageUrl, title }: { imageUrl: string; title: string }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) return <div className="noon-sku-cover noon-sku-cover-empty">无图</div>;
  return <img alt={title} className="noon-sku-cover" loading="lazy" onError={() => setFailed(true)} src={imageUrl} />;
}

export default function NoonWorkbenchWorkspace() {
  const [stores, setStores] = useState<NoonStore[]>([]);
  const [storeId, setStoreId] = useState("");
  const [status, setStatus] = useState("读取店铺中...");
  const [catalogMode, setCatalogMode] = useState<CatalogMode>("global");
  const [syncJobId, setSyncJobId] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncJobStatus>("idle");
  const [syncProgress, setSyncProgress] = useState<SyncProgress>({ message: "", detail: "", percent: 0, error: "" });
  const [catalogRows, setCatalogRows] = useState<CatalogRow[]>([]);
  const [catalogOutput, setCatalogOutput] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogPageSize, setCatalogPageSize] = useState(50);
  const [catalogPagination, setCatalogPagination] = useState<CatalogPagination>({ page: 1, pageSize: 50, totalItems: 0, totalPages: 1 });
  const [totalCount, setTotalCount] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const catalogRequestController = useRef<AbortController | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set());
  const [bulkUpdateFiles, setBulkUpdateFiles] = useState<BulkUpdateFiles | null>(null);
  const [exportingBulkUpdates, setExportingBulkUpdates] = useState(false);
  const [runningBulkAction, setRunningBulkAction] = useState(false);

  const rowKeys = useMemo(() => catalogRows.map(rowKey), [catalogRows]);
  const selectedRows = useMemo(() => catalogRows.filter((row) => selectedRowKeys.has(rowKey(row))), [catalogRows, selectedRowKeys]);
  const selectedCount = selectedRowKeys.size;
  const allRowsSelected = rowKeys.length > 0 && rowKeys.every((key) => selectedRowKeys.has(key));
  const catalogSyncDisabled = syncStatus === "running" || !storeId;
  const catalogExportDisabled = catalogSyncDisabled || catalogMode !== "global";
  const dateRange = useMemo(() => {
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const ymd = yesterday.toISOString().split("T")[0];
    return `${yearStart} 至 ${ymd}`;
  }, []);

  useEffect(() => {
    fetch("/api/stores")
      .then((response) => response.json())
      .then((result: { stores?: NoonStore[]; defaultStoreId?: string }) => {
        const items = result.stores || [];
        setStores(items);
        setStoreId((current) => current || result.defaultStoreId || items[0]?.id || "");
        setStatus(items.length ? "" : "暂无 noon 店铺。");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取店铺失败。"));
  }, []);

  useEffect(() => {
    if (!storeId) return;
    setCatalogPage(1);
  }, [storeId, catalogMode]);

  useEffect(() => {
    if (!storeId) return;
    void refreshCatalogRows();
  }, [storeId, catalogMode, catalogPage, catalogPageSize]);

  useEffect(() => {
    const visibleKeys = new Set(rowKeys);
    setSelectedRowKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))));
  }, [rowKeys]);

  useEffect(() => {
    if (!syncJobId || syncStatus !== "running") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/upload-jobs/${syncJobId}`);
        const job = await readSyncJobResponse(response);
        if (cancelled) return;
        const progress = parseSyncJobProgress(job);
        setSyncProgress(progress);
        setSyncStatus(job.status);
        if (job.status === "completed") {
          setStatus(`同步 SKU 任务已完成：${job.id}`);
          void refreshCatalogRows();
        } else if (job.status === "failed") {
          setStatus("同步 SKU 失败");
        }
      } catch (error) {
        if (!cancelled) {
          setSyncStatus("failed");
          setStatus("同步 SKU 失败");
          setSyncProgress((current) => ({ ...current, error: error instanceof Error ? error.message : "读取同步进度失败。" }));
        }
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [syncJobId, syncStatus]);

  return (
    <>
      <div className="page-head">
        <div>
          <p className="page-kicker">Noon Operations</p>
          <h1 className="page-title">Noon 工作台</h1>
        </div>
        <button className="secondary" onClick={() => void refreshCatalogRows()} type="button">刷新商品</button>
      </div>
      <section className="repository-workspace noon-workbench-workspace">
        <section className="noon-catalog-hero">
          <div className="noon-catalog-head">
            <div>
              <h3>商品目录</h3>
              <p>管理 Noon SKU、批量调价、改库存、改时效。批量操作后通常需要等待 1-3 分钟在 Noon 生效。</p>
            </div>
            <span className="noon-catalog-badge">Catalog Manager</span>
          </div>
          <div className="noon-mode-card">
            <div className="noon-mode-tabs">
              <button className={catalogMode === "fbn" ? "secondary active" : "secondary"} onClick={() => setCatalogMode("fbn")} type="button">FBN/FBP 模式</button>
              <button className={catalogMode === "global" ? "secondary active" : "secondary"} onClick={() => setCatalogMode("global")} type="button">Global (NGS) 模式</button>
            </div>
            <span className="noon-mode-note">默认跟随仓库 &amp; 运费配置</span>
          </div>
          <div className="noon-sync-card">
            <span>{status || "首次使用请先同步 SKU 数据"}</span>
            <CatalogSyncActions
              catalogMode={catalogMode}
              disabled={catalogSyncDisabled}
              exportDisabled={catalogExportDisabled}
              onStart={(source) => void startCatalogSync(source)}
            />
            {catalogMode !== "global" ? <span id="catalog-export-mode-note">导出同步仅支持 Global 模式</span> : null}
          </div>
          {syncStatus === "running" ? (
            <section className="noon-sync-progress" data-sync-progress>
              <div className="noon-sync-progress-head">
                <div><strong>同步进度</strong>　{syncProgress.message || "正在启动同步任务..."}</div>
                <span>{syncProgress.detail || "正在获取 Noon SKU 数量"}</span>
              </div>
              <div className="noon-progress-track"><span className="noon-progress-fill" style={{ "--progress": `${Math.max(8, Math.min(100, syncProgress.percent || 12))}%` } as React.CSSProperties}></span></div>
            </section>
          ) : null}
        </section>

        <section className="noon-summary-grid">
          <SummaryCard title="总销量" value={`${totalCount}件`} meta={`统计区间 ${dateRange}`} />
          <SummaryCard title="商品查看" value={String(totalCount)} meta="来自 Noon Catalog 同步" />
          <SummaryCard title="阿联酋 (AE)" value="AED 0.00" meta="GMV - 退款/取消金额" />
          <SummaryCard title="沙特 (SA)" value="SAR 0.00" meta="GMV - 退款/取消金额" />
        </section>

        <section className="repository-controls repository-toolbar product-bulk-bar noon-bulk-bar">
          <div className="repository-control-row">
            <label className="noon-sku-check">
              <input aria-label="选择本页" checked={allRowsSelected} disabled={catalogLoading || !rowKeys.length} onChange={toggleAllRows} type="checkbox" />
            </label>
            <span className="meta">已选择 {selectedCount} 个商品</span>
          </div>
          <div className="repository-control-row">
            <button className="secondary" disabled={catalogLoading || !selectedCount || runningBulkAction} onClick={bulkEditAttribute} type="button">批量改商品属性</button>
            <button className="secondary" disabled={catalogLoading || !selectedCount || runningBulkAction} onClick={bulkEditPrice} type="button">批量调价</button>
            <button className="secondary" disabled={catalogLoading || !selectedCount || runningBulkAction} onClick={bulkEditStock} type="button">批量改FBP/NGS库存</button>
            <button className="secondary" disabled={catalogLoading || !selectedCount || runningBulkAction} onClick={bulkEditProcessingTime} type="button">批量改时效</button>
            <button className="secondary" disabled={catalogLoading || exportingBulkUpdates} onClick={exportGlobalBulkUpdates} type="button">
              {exportingBulkUpdates ? "导出中" : "导出 Global 表"}
            </button>
            <button className="secondary" disabled={catalogLoading || !selectedCount} onClick={() => setSelectedRowKeys(new Set())} type="button">取消选择</button>
            <button className="danger" disabled={catalogLoading || !selectedCount || runningBulkAction} onClick={() => void bulkDeleteSelected()} type="button">批量删除</button>
          </div>
          {bulkUpdateFiles ? (
            <div className="noon-export-links">
              <a href={bulkUpdateFiles.product} target="_blank">商品表</a>
              <a href={bulkUpdateFiles.price} target="_blank">价格表</a>
              <a href={bulkUpdateFiles.stock} target="_blank">库存表</a>
            </div>
          ) : null}
        </section>

        <section className="noon-monitor-quota">
          <div className="noon-quota-head">
            <strong>跟卖监控配额</strong>
            <div>
              <span>0 / 10</span>
              <span>　0%</span>
            </div>
          </div>
          <div className="noon-progress-track"><span className="noon-progress-fill" style={{ "--progress": "0%" } as React.CSSProperties}></span></div>
          <div className="noon-quota-foot">剩余 10 个配额</div>
        </section>

        <section className="repository-list-pane noon-workbench-table">
          {catalogRows.length ? (
            <div className="repository-table noon-sku-table">
              <div className="noon-sku-header-line">
                <span className="noon-sku-check" />
                <span>商品信息</span>
                <span>售价</span>
                <span>库存</span>
                <span>销售情况</span>
                <span>利润/规格</span>
                <span>状态</span>
                <span>跟卖监控</span>
                <span>操作</span>
              </div>
              {catalogRows.map((row) => (
                <article className="noon-sku-product-line" key={`${row.psku}-${row.sku}`}>
                  <label className="noon-sku-check">
                    <input aria-label={`选择 ${row.title}`} checked={selectedRowKeys.has(rowKey(row))} disabled={catalogLoading} onChange={() => toggleRow(rowKey(row))} type="checkbox" />
                  </label>
                  <div className="noon-sku-product">
                    <CatalogCover imageUrl={row.imageUrl} title={row.title} />
                    <div className="noon-sku-copy">
                      <strong title={row.title}>{row.title}</strong>
                      <span><b>PSKU:</b> {row.psku || "-"}</span>
                      <span><b>SKU:</b> {row.sku || "-"}</span>
                      <small>品牌 Generic　来源 -</small>
                    </div>
                  </div>

                  <div className="noon-sku-cell noon-sku-price">
                    <MarketMetric market="AE" tone="blue" title="买家最终价" value="AED 0.00" lines={["USD 0.00", "CNY 0.00"]} />
                    <MarketMetric market="SA" tone="cream" title="买家最终价" value="SAR 0.00" lines={["USD 0.00", "CNY 0.00"]} />
                  </div>

                  <div className="noon-sku-cell noon-sku-stock">
                    <MarketMetric market="AE" tone="blue" title="总计 0" value="NGS 0" compact />
                    <MarketMetric market="SA" tone="cream" title="总计 0" value="NGS 0" compact />
                  </div>

                  <div className="noon-sku-cell noon-sku-sales">
                    <MarketMetric market="AE" tone="blue" title="0件　浏览0" value="AED 0.00" lines={["取消 0 · 退货 0"]} />
                    <MarketMetric market="SA" tone="cream" title="0件　浏览0" value="SAR 0.00" lines={["取消 0 · 退货 0"]} />
                  </div>

                  <div className="noon-sku-cell noon-sku-profit">
                    <MarketSource market="AE" />
                    <MarketSource market="SA" />
                  </div>

                  <div className="noon-sku-cell noon-sku-status">
                    <OfferStatus market="AE" />
                    <OfferStatus market="SA" />
                    <GlobalCard />
                  </div>

                  <div className="noon-sku-cell noon-sku-monitor">
                    <span className="noon-monitor-dot" />
                  </div>

                  <button className="noon-delete-button" disabled={catalogLoading} onClick={() => void deleteRows([row])} type="button">删除</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="noon-empty-sync">
              <div className="noon-empty-icon">↻</div>
              <h3>{syncStatus === "failed" ? "同步 SKU 失败" : "暂无 SKU 数据"}</h3>
              {syncProgress.error ? <div className="noon-sync-error">获取数据失败：{syncProgress.error}</div> : <p>点击下方按钮从 Noon Catalog 同步商品列表</p>}
              <CatalogSyncActions
                catalogMode={catalogMode}
                disabled={catalogSyncDisabled}
                exportDisabled={catalogExportDisabled}
                onStart={(source) => void startCatalogSync(source)}
              />
            </div>
          )}
          {catalogPagination.totalItems > 0 ? (
            <Pager
              disabled={catalogLoading}
              onPageChange={setCatalogPage}
              onPageSizeChange={(nextPageSize) => {
                setCatalogPageSize(nextPageSize);
                setCatalogPage(1);
              }}
              page={catalogPagination.page}
              pageSize={catalogPageSize}
              totalItems={catalogPagination.totalItems}
              totalPages={catalogPagination.totalPages}
            />
          ) : null}
        </section>
      </section>
    </>
  );

  async function refreshCatalogRows(page = catalogPage) {
    catalogRequestController.current?.abort();
    const controller = new AbortController();
    catalogRequestController.current = controller;
    setCatalogLoading(true);
    setSelectedRowKeys(new Set());
    const params = new URLSearchParams({ storeId, mode: catalogMode, page: String(catalogPage), pageSize: String(catalogPageSize) });
    params.set("page", String(page));
    try {
      const response = await fetch(`/api/noon-catalog-sync?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error("读取 SKU 数据失败。");
      const result = (await response.json()) as CatalogSync;
      if (controller.signal.aborted) return;
      setCatalogRows(result.synced ? result.rows || [] : []);
      setCatalogOutput(result.output || result.fileName || "");
      setTotalCount(result.pagination?.totalItems || 0);
      if (result.pagination) {
        setCatalogPagination(result.pagination);
        setCatalogPage(result.pagination.page);
      }
      if (result.synced) setStatus(`已加载 ${result.pagination?.totalItems || result.rows?.length || 0} 条 SKU 数据`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setStatus(error instanceof Error ? error.message : "读取 SKU 数据失败。");
    } finally {
      if (catalogRequestController.current === controller) setCatalogLoading(false);
    }
  }

  function toggleAllRows() {
    setSelectedRowKeys(allRowsSelected ? new Set() : new Set(rowKeys));
  }

  function toggleRow(key: string) {
    setSelectedRowKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function exportGlobalBulkUpdates() {
    setExportingBulkUpdates(true);
    setBulkUpdateFiles(null);
    try {
      const response = await fetch("/api/noon-bulk-updates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skus: selectedSkus() }),
      });
      const result = (await response.json()) as { files?: BulkUpdateFiles; skuCount?: number; productDirs?: string[]; unresolvedSkus?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || "导出 Global 表失败。");
      if (result.files) setBulkUpdateFiles(result.files);
      const unresolved = result.unresolvedSkus?.length ? `，${result.unresolvedSkus.length} 个 SKU 未匹配本地商品` : "";
      setStatus(`已导出 Global 表：${result.skuCount || 0} 个 SKU${unresolved}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导出 Global 表失败。");
    } finally {
      setExportingBulkUpdates(false);
    }
  }

  function bulkEditAttribute() {
    const input = window.prompt("输入商品属性，支持 hs_code=420222、actual_weight_kg=0.6、vm_weight_cm=1.2、dimensions_cm=17,6,15");
    if (!input) return;
    const separator = input.indexOf("=");
    if (separator <= 0) {
      setStatus("商品属性格式不正确，请使用 字段=值。");
      return;
    }
    void applyBulkOperation({
      type: "set_attribute",
      field: input.slice(0, separator).trim(),
      value: input.slice(separator + 1).trim(),
    });
  }

  function bulkEditPrice() {
    const input = window.prompt("输入国家=售价，例如 ae=18.5 或 ae,sa=18.5");
    if (!input) return;
    const parsed = parsePairInput(input);
    if (!parsed) {
      setStatus("调价格式不正确，请使用 国家=售价，例如 ae,sa=18.5。");
      return;
    }
    void applyBulkOperation({ type: "set_price", countryCodes: parsed.left, price: parsed.right });
  }

  function bulkEditStock() {
    const input = window.prompt("输入库存，例如 9，或 仓库码=9");
    if (!input) return;
    const parsed = parseOptionalWarehouseValue(input);
    void applyBulkOperation({ type: "set_stock", stock: parsed.value, warehouseCode: parsed.warehouseCode });
  }

  function bulkEditProcessingTime() {
    const input = window.prompt("输入时效，例如 2_days，或 仓库码=2_days");
    if (!input) return;
    const parsed = parseOptionalWarehouseValue(input);
    void applyBulkOperation({ type: "set_processing_time", processingTime: parsed.value, warehouseCode: parsed.warehouseCode });
  }

  async function bulkDeleteSelected() {
    if (!window.confirm(`通过 Noon API 删除已选 ${selectedCount} 个商品？`)) return;
    await applyBulkOperation({ type: "delete_products" }, selectedRows);
  }

  async function deleteRows(rows: CatalogRow[]) {
    if (!rows.length) return;
    if (!window.confirm(`通过 Noon API 删除 ${rows.length} 个商品？`)) return;
    await applyBulkOperation({ type: "delete_products" }, rows);
  }

  async function applyBulkOperation(operation: BulkOperation, rows = selectedRows) {
    if (catalogLoading) return;
    setRunningBulkAction(true);
    try {
      const response = await fetch("/api/noon-bulk-operations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId, items: apiItemsForRows(rows), skus: skusForRows(rows), operation }),
      });
      const result = (await response.json()) as { changedCount?: number; failedCount?: number; unresolvedSkus?: string[]; error?: string };
      if (!response.ok) throw new Error(result.error || "批量操作失败。");
      const unresolved = result.unresolvedSkus?.length ? `，${result.unresolvedSkus.length} 个 SKU 未匹配本地商品` : "";
      const failed = result.failedCount ? `，${result.failedCount} 个失败` : "";
      setStatus(`批量操作完成：${result.changedCount || 0} 个商品已更新${failed}${unresolved}`);
      setSelectedRowKeys(new Set());
      await refreshCatalogRows();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "批量操作失败。");
    } finally {
      setRunningBulkAction(false);
    }
  }

  function selectedSkus() {
    return skusForRows(selectedRows);
  }

  async function startCatalogSync(source: CatalogSyncSource) {
    if (!storeId) {
      setStatus("请先选择 noon 店铺。");
      return;
    }
    try {
      const response = await fetch("/api/noon-catalog-sync-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeId, mode: catalogMode, source }),
      });
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "同步 SKU 任务创建失败。");
      setSyncJobId(result.id);
      setSyncStatus("running");
      setSyncProgress({ message: "同步 SKU 任务已启动", detail: result.id, percent: 8, error: "" });
      setStatus(`同步 SKU 任务已启动：${result.id}`);
    } catch (error) {
      setSyncStatus("failed");
      setSyncProgress({ message: "", detail: "", percent: 0, error: error instanceof Error ? error.message : "同步 SKU 任务创建失败。" });
      setStatus("同步 SKU 失败");
    }
  }
}

function rowKey(row: CatalogRow) {
  return `${row.psku}::${row.sku}`;
}

function skusForRows(rows: CatalogRow[]) {
  return [...new Set(rows.flatMap((row) => [row.psku, row.sku]).map((value) => value.trim()).filter(Boolean))];
}

function apiItemsForRows(rows: CatalogRow[]) {
  return rows.map((row) => ({
    partner_sku: row.psku.trim() || row.sku.trim(),
    zsku_child: row.sku.trim(),
  })).filter((item) => item.partner_sku || item.zsku_child);
}

function parsePairInput(input: string) {
  const separator = input.indexOf("=");
  if (separator <= 0) return null;
  const left = input.slice(0, separator).trim();
  const right = input.slice(separator + 1).trim();
  return left && right ? { left, right } : null;
}

function parseOptionalWarehouseValue(input: string) {
  const parsed = parsePairInput(input);
  if (!parsed) return { value: input.trim() };
  return { warehouseCode: parsed.left, value: parsed.right };
}

function SummaryCard({ title, value, meta }: { title: string; value: string; meta: string }) {
  return (
    <div className="noon-summary-card">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function parseSyncJobProgress(job: SyncJob): SyncProgress {
  const logs = job.logs || [];
  const lastJsonError = [...logs].reverse().map((log) => parseJsonLog(log.line)).find((value) => value?.status === "error");
  if (lastJsonError?.error) {
    return { message: "同步失败", detail: "Noon Catalog 返回错误", percent: 100, error: String(lastJsonError.error) };
  }

  const apiPageLog = [...logs].reverse().find((log) => log.line.includes("正在读取 API 第"));
  if (apiPageLog) {
    const pageMatch = apiPageLog.line.match(/正在读取 API 第\s+(\d+)\s*\/\s*(\d+)\s+页(?:，已获取\s+(\d+)\s+条商品)?/);
    const currentPage = Number(pageMatch?.[1] || 1);
    const totalPages = Number(pageMatch?.[2] || 0);
    const count = Number(pageMatch?.[3] || 0);
    const percent = totalPages ? Math.round((currentPage / totalPages) * 100) : 12;
    return {
      message: apiPageLog.line,
      detail: totalPages ? `第 ${currentPage} / ${totalPages} 页，已获取 ${count} 条商品` : "正在读取 API 分页",
      percent,
      error: "",
    };
  }

  // 兼容旧分页进度 + 新导出流程进度
  const pageLog = [...logs].reverse().find((log) => log.line.includes("正在同步第"));
  if (pageLog) {
    const pageMatch = pageLog.line.match(/正在同步第\s+(\d+)(?:\s*\/\s*(\d+))?/);
    const currentPage = Number(pageMatch?.[1] || 1);
    const totalPages = Number(pageMatch?.[2] || 0);
    const percent = totalPages ? Math.round((currentPage / totalPages) * 100) : Math.min(95, 12 + currentPage * 8);
    return { message: pageLog.line, detail: totalPages ? `第 ${currentPage} / ${totalPages} 页` : "正在读取分页", percent, error: "" };
  }

  // 导出流程：等待生成进度
  const pollLog = [...logs].reverse().find((log) => log.line.includes("正在等待导出生成"));
  if (pollLog) {
    const waitMatch = pollLog.line.match(/已等待\s+(\d+)\s+秒/);
    const waited = Number(waitMatch?.[1] || 0);
    return { message: "Noon 正在生成导出文件", detail: `已等待 ${waited} 秒`, percent: Math.min(62, 12 + Math.round((waited / 300) * 50)), error: "" };
  }

  // 导出流程：下载与解析
  if (logs.find((log) => log.line.includes("正在下载导出文件"))) return { message: "正在下载导出文件", detail: "即将完成", percent: 80, error: "" };
  if (logs.find((log) => log.line.includes("正在解析商品数据"))) return { message: "正在解析商品数据", detail: "即将完成", percent: 90, error: "" };

  const lastLine = logs[logs.length - 1]?.line || "";
  if (job.status === "failed") return { message: "同步失败", detail: "任务已结束", percent: 100, error: lastLine || job.error || "同步 SKU 失败。" };
  if (job.status === "completed") return { message: "同步完成", detail: "任务已结束", percent: 100, error: "" };
  return { message: lastLine || "正在启动同步任务...", detail: "正在获取 Noon SKU 数量", percent: 12, error: "" };
}

async function readSyncJobResponse(response: Response): Promise<SyncJob> {
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(response.ok ? "同步任务响应不是有效 JSON。" : `读取同步进度失败：HTTP ${response.status}`);
  }
  const error = value && typeof value === "object" && "error" in value ? String(value.error || "") : "";
  if (!response.ok) throw new Error(error || `读取同步进度失败：HTTP ${response.status}`);
  if (!isSyncJob(value)) throw new Error("同步任务响应缺少有效的 status。");
  return value;
}

function isSyncJob(value: unknown): value is SyncJob {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "idle" || status === "running" || status === "completed" || status === "failed";
}

function parseJsonLog(line: string) {
  try {
    return JSON.parse(line) as { status?: string; error?: string };
  } catch {
    return null;
  }
}
