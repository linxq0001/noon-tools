"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Pager } from "@/components/workbench/pager";

type RepositorySummary = {
  id: string;
  name: string;
  productCount: number;
  imageCount: number;
  uploadableCount: number;
  blockedCount: number;
};

type ProductSummary = {
  dirName: string;
  title: string;
  sourceUrl: string;
  price: unknown;
  imageCount: number;
  generatedAt: string;
  warnings: string[];
  coverImage: string;
  noonSummary?: {
    title: string;
    variantCount: number;
    imageCount: number;
    partnerSku?: string;
    hsCode?: string;
    blockingCount: number;
  };
};

type ProductPage = {
  repository: { id: string; name: string; productCount: number };
  products: ProductSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

type NoonStore = { id: string; name: string };
type UploadJobStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
type JobLog = { line: string };
type UploadJob = { id: string; status: UploadJobStatus; logs?: JobLog[]; error?: string; productDir?: string; productDirs?: string[]; repository?: string };
type UploadProgress = { message: string; detail: string; percent: number; error: string };

export default function RepositoriesWorkspace({ mode = "upload" }: { mode?: "upload" | "operations" }) {
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [productPage, setProductPage] = useState<ProductPage | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState("读取中...");
  const [stores, setStores] = useState<NoonStore[]>([]);
  const [storeId, setStoreId] = useState("");
  const [selectedProductDirs, setSelectedProductDirs] = useState<string[]>([]);
  const [uploadJobId, setUploadJobId] = useState("");
  const [uploadStatus, setUploadStatus] = useState<UploadJobStatus>("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({ message: "", detail: "", percent: 0, error: "" });
  const isOperations = mode === "operations";

  useEffect(() => {
    fetch("/api/repositories")
      .then((response) => response.json())
      .then((items: RepositorySummary[]) => {
        setRepositories(items);
        setRepositoryId((current) => current || items[0]?.id || "");
        setStatus(items.length ? "" : "暂无仓库。");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取仓库失败。"));
  }, []);

  useEffect(() => {
    fetch("/api/stores")
      .then((response) => response.json())
      .then((result: { stores?: NoonStore[]; defaultStoreId?: string }) => {
        setStores(result.stores || []);
        setStoreId((current) => current || result.defaultStoreId || result.stores?.[0]?.id || "");
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!repositoryId) return;
    const params = new URLSearchParams({
      repository: repositoryId,
      page: String(page),
      pageSize: String(pageSize),
      q,
    });

    fetch(`/api/products?${params}`)
      .then((response) => response.json())
      .then((data: ProductPage | { error?: string }) => {
        if ("error" in data && data.error) throw new Error(data.error);
        setProductPage(data as ProductPage);
        setStatus("");
      })
      .catch((error) => setStatus(error instanceof Error ? error.message : "读取商品失败。"));
  }, [repositoryId, page, pageSize, q]);



  const activeRepository = useMemo(
    () => repositories.find((repository) => repository.id === repositoryId),
    [repositories, repositoryId],
  );
  const pagination = productPage?.pagination;
  const products = useMemo(() => productPage?.products || [], [productPage]);
  const visibleProductDirs = useMemo(() => products.map((product) => product.dirName), [products]);
  const allPageProductsSelected = visibleProductDirs.length > 0 && visibleProductDirs.every((dir) => selectedProductDirs.includes(dir));
  const selectedOnPageCount = visibleProductDirs.filter((dir) => selectedProductDirs.includes(dir)).length;

  useEffect(() => {
    setSelectedProductDirs((current) => current.filter((dir) => visibleProductDirs.includes(dir)));
  }, [visibleProductDirs]);

  useEffect(() => {
    if (!uploadJobId || uploadStatus !== "running") return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/upload-jobs/${uploadJobId}`);
        const job = (await response.json()) as UploadJob;
        if (cancelled) return;
        const progress = parseUploadJobProgress(job);
        setUploadProgress(progress);
        setUploadStatus(job.status);
        if (job.status === "completed") {
          setStatus(`上传任务已完成：${job.id}`);
        } else if (job.status === "failed") {
          setStatus("上传任务失败");
        } else if (job.status === "cancelled") {
          setStatus("上传任务已停止");
        }
      } catch (error) {
        if (!cancelled) {
          setUploadStatus("failed");
          setStatus("上传任务失败");
          setUploadProgress((current) => ({ ...current, error: error instanceof Error ? error.message : "读取上传进度失败。" }));
        }
      }
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [uploadJobId, uploadStatus]);

  return (
    <section className={isOperations ? "repository-workspace noon-workbench-workspace" : "repository-workspace"}>
      <div className="repository-summary-grid">
        {activeRepository ? (
          <>
            <div className="repository-summary-card">
              <span>全部商品</span>
              <strong>{activeRepository.productCount}</strong>
            </div>
            <div className="repository-summary-card" data-tone="blue">
              <span>商品图片</span>
              <strong>{activeRepository.imageCount}</strong>
            </div>
            <div className="repository-summary-card" data-tone="blue">
              <span>可上传</span>
              <strong>{activeRepository.uploadableCount}</strong>
            </div>
            <div className="repository-summary-card" data-tone="red">
              <span>阻塞问题</span>
              <strong>{activeRepository.blockedCount}</strong>
            </div>
            <div className="repository-summary-card">
              <span>当前页</span>
              <strong>{pagination?.page || 1}</strong>
            </div>
          </>
        ) : (
          <div className="repository-summary-card">
            <span>全部商品</span>
            <strong>0</strong>
          </div>
        )}
      </div>

      <section className="product-command-panel">
        <div className="product-filter-panel">
          <div className="product-source-card">
            <div className="product-filter-head product-warehouse-row product-primary-control">
              <div className="product-filter-title">
                <strong>仓库</strong>
                <span>1688 商品仓库</span>
              </div>
              <div className="product-source-select">
                <label className="sr-only" htmlFor="repositorySourceSelect">仓库数据源</label>
                <select id="repositorySourceSelect" value={repositoryId} onChange={(event) => { setRepositoryId(event.target.value); setPage(1); }}>
                  {repositories.map((repository) => (
                    <option key={repository.id} value={repository.id}>
                      {repository.name} · {repository.productCount} 个商品
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="product-control-grid">
              <div className="product-filter-row product-control-block">
                <div className="product-filter-title">
                  <strong>状态</strong>
                  <span>{isOperations ? "Noon 商品作业视图" : "本阶段只展示仓库总览"}</span>
                </div>
                <div className="product-pill-group">
                  <button className="product-pill active" type="button">全部 {pagination?.totalItems || activeRepository?.productCount || 0}</button>
                  <button className="product-pill" disabled type="button">可上传 {activeRepository?.uploadableCount || 0}</button>
                  <button className="product-pill" disabled type="button">阻塞 {activeRepository?.blockedCount || 0}</button>
                </div>
              </div>
              <div className="product-filter-row product-control-block">
                <div className="product-filter-title">
                  <strong>上传店铺</strong>
                  <span>商品上传目标 noon 店铺</span>
                </div>
                <div className="product-source-select">
                  <label className="sr-only" htmlFor="uploadStoreId">上传目标店铺</label>
                  <select id="uploadStoreId" value={storeId} onChange={(event) => setStoreId(event.target.value)}>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.id}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="product-search-panel">
          <div className="product-search-card">
            <div className="product-filter-title">
              <strong>搜索</strong>
              <span>名称、目录或 Noon 标题</span>
            </div>
            <div className="product-search-row">
              <input value={q} onChange={(event) => { setQ(event.target.value); setPage(1); }} placeholder="搜索商品名称、目录、Noon 标题..." />
            </div>
          </div>
        </div>
      </section>

      {isOperations ? (
        <section className="repository-controls repository-toolbar product-bulk-bar">
          <div className="repository-control-row">
            <span className="meta">
              {activeRepository ? `${activeRepository.name} · 共 ${pagination?.totalItems || activeRepository.productCount} 个商品` : "暂无仓库"}
            </span>
          </div>
          <div className="repository-control-row">
            <button className="secondary" disabled title="批量更新导出将在 exporter 迁入 Next 后启用" type="button">导出 Global 批量更新表</button>
            <span className="meta">{pagination ? `第 ${pagination.page} / ${pagination.totalPages} 页` : "等待读取"}</span>
          </div>
        </section>
      ) : null}

      {status ? <p className="setting-hint">{status}</p> : null}

      {!isOperations && uploadStatus === "running" ? (
        <section className="noon-sync-progress" data-upload-progress>
          <div className="noon-sync-progress-head">
            <div><strong>上传进度</strong>　{uploadProgress.message || "正在启动上传任务..."}</div>
            <span>{uploadProgress.detail || "正在获取上传进度"}</span>
          </div>
          <div className="noon-progress-track"><span className="noon-progress-fill" style={{ "--progress": `${Math.max(8, Math.min(100, uploadProgress.percent || 12))}%` } as React.CSSProperties}></span></div>
        </section>
      ) : null}

      <div className={isOperations ? "repository-content-grid operations-content-grid" : "repository-content-grid"}>
        <div className="repository-list-pane">
          {isOperations ? null : (
            <div className="repository-upload-toolbar">
              <label className="repository-page-select">
                <input
                  checked={allPageProductsSelected}
                  disabled={visibleProductDirs.length === 0}
                  onChange={(event) => selectPageProducts(event.target.checked)}
                  type="checkbox"
                />
                <span>选择当前页</span>
              </label>
              <span className="meta">已选 {selectedOnPageCount} / {visibleProductDirs.length}</span>
              <div className="repository-upload-actions">
                <button
                  className="secondary"
                  disabled={selectedProductDirs.length === 0}
                  id="uploadSelectedButton"
                  onClick={() => startUpload({ productDirs: selectedProductDirs })}
                  type="button"
                >
                  多选上传
                </button>
                <button
                  className="primary"
                  disabled={!repositoryId}
                  id="uploadAllButton"
                  onClick={() => startUpload({ repository: repositoryId })}
                  type="button"
                >
                  全部上传
                </button>
              </div>
            </div>
          )}
          <div className="repository-table">
          <div className="repository-table-head">
            <span></span>
            <span>商品信息</span>
            <span></span>
            <span>采集价格</span>
            <span>SKU</span>
            <span>物流信息</span>
            <span>海关编码(HS Code)</span>
            <span>状态</span>
            <span>采集时间</span>
            <span>操作</span>
          </div>
          {products.map((product) => (
            <article className="product-row" key={product.dirName}>
              <input
                aria-label={`选择 ${product.title}`}
                checked={selectedProductDirs.includes(product.dirName)}
                onChange={(event) => toggleProductSelection(product.dirName, event.target.checked)}
                type="checkbox"
              />
              <div className="product-main">
                {product.coverImage ? <img alt="" className="product-cover" src={product.coverImage} /> : <div className="product-cover product-cover-placeholder">无图</div>}
                <div className="product-copy">
                  <Link className="product-title-button" href={`/product-detail/${product.dirName.split("/").map(encodeURIComponent).join("/")}`}>
                    {product.noonSummary?.title || product.title}
                  </Link>
                  <div className="product-summary">
                    <span className="product-source-badge">1688</span>
                    <span>1688 ID： {productSourceId(product)}</span>
                  </div>
                  <div className="product-summary">
                    <span>✓ 已创建草稿</span>
                    {productOriginalLink(product) ? <a className="product-inline-link" href={productOriginalLink(product)} target="_blank">原始链接</a> : null}
                  </div>
                  <div><span className="product-adjusted-badge">已调整</span></div>
                  {product.noonSummary?.blockingCount ? <div className="warning">缺少 Noon 商品属性</div> : null}
                  {product.warnings?.length ? <div className="warning">{product.warnings.join(" / ")}</div> : null}
                </div>
              </div>
              <div className="product-health"><span className="product-health-dot">✓</span></div>
              <div className="product-price">{formatProductPrice(product.price)}</div>
              <div className="product-sku">{product.noonSummary?.variantCount || 0}<span>/{product.noonSummary?.variantCount || 0}组</span></div>
              <div className="product-logistics">{productLogisticsText(product)}</div>
              <div className="product-hs-code">{productHsCode(product)}</div>
              <div className="product-status"><div className="upload-status">{formatUploadStatus("not_uploaded")}</div></div>
              <div className="product-collected-at">{productCollectedAt(product)}</div>
              <div className="product-actions">
                <button className="product-upload-button" onClick={() => startUpload({ productDir: product.dirName })} type="button">上传</button>
                <button className="product-delete-button" type="button" title="删除" aria-label="删除">⌫</button>
              </div>
            </article>
          ))}
          </div>

          {pagination ? (
            <Pager
              onPageChange={setPage}
              onPageSizeChange={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }}
              page={pagination.page}
              pageSize={pageSize}
              totalItems={pagination.totalItems}
              totalPages={pagination.totalPages}
            />
          ) : null}
        </div>

      </div>

    </section>
  );

  async function startUpload(payload: { productDir?: string; productDirs?: string[]; repository?: string }) {
    if (!storeId) {
      setStatus("请先选择上传目标店铺。");
      return;
    }
    setStatus("正在创建上传任务...");
    setUploadJobId("");
    setUploadStatus("running");
    setUploadProgress({ message: "正在创建上传任务...", detail: "等待任务 ID", percent: 8, error: "" });
    const response = await fetch("/api/upload-jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, storeId }),
    });
    const result = await response.json() as { id: string; error?: string };
    if (!response.ok) {
      setUploadStatus("failed");
      setUploadProgress({ message: "上传任务创建失败", detail: "任务未启动", percent: 100, error: result.error || "上传任务创建失败。" });
      setStatus(result.error || "上传任务创建失败。");
      return;
    }
    setUploadJobId(result.id);
    setUploadProgress({ message: "上传任务已启动", detail: result.id, percent: 12, error: "" });
    setStatus(`上传任务已启动：${result.id}`);
  }

  function selectPageProducts(checked: boolean) {
    setSelectedProductDirs(checked ? visibleProductDirs : []);
  }

  function toggleProductSelection(productDir: string, checked: boolean) {
    setSelectedProductDirs((current) => {
      if (checked) return current.includes(productDir) ? current : [...current, productDir];
      return current.filter((dir) => dir !== productDir);
    });
  }

}

function formatProductPrice(price: unknown) {
  const value = Number(price);
  if (!Number.isFinite(value)) return "-";
  return value.toFixed(2);
}

function productLogisticsText(_product: ProductSummary) {
  return "详情查看";
}

function productHsCode(product: ProductSummary) {
  return cleanDisplayText(product.noonSummary?.hsCode) || "-";
}

function productSourceId(product: ProductSummary) {
  const sourceUrl = productOriginalLink(product);
  const offerMatch = sourceUrl.match(/offer\/(\d+)/);
  if (offerMatch) return offerMatch[1];
  return cleanDisplayText(product.dirName).split("/").filter(Boolean).pop() || "-";
}

function productOriginalLink(product: ProductSummary) {
  return cleanDisplayText(product.sourceUrl);
}

function productCollectedAt(product: ProductSummary) {
  const value = product.generatedAt || "";
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return cleanDisplayText(value);
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function formatUploadStatus(status: string) {
  if (status === "uploaded") return "已上传";
  if (status === "uploading") return "上架中";
  if (status === "failed") return "上架失败";
  return "待上架";
}

function parseUploadJobProgress(job: UploadJob): UploadProgress {
  const logs = job.logs || [];
  const productLogs = logs.filter((log) => log.line.includes("[product]"));
  const totalItems = job.productDirs?.length || (job.productDir ? 1 : 0);
  const completedItems = productLogs.filter((log) => log.line.includes(": submitted")).length;
  const failedItems = productLogs.filter((log) => log.line.includes(": failed")).length;
  const runningLog = [...productLogs].reverse().find((log) => log.line.includes(": running"));
  const lastLine = logs[logs.length - 1]?.line || "";

  if (job.status === "failed") return { message: "上传失败", detail: "任务已结束", percent: 100, error: lastLine || job.error || "上传失败。" };
  if (job.status === "cancelled") return { message: "上传已停止", detail: "任务已结束", percent: 100, error: "" };
  if (job.status === "completed") return { message: "上传完成", detail: totalItems ? `${completedItems || totalItems} / ${totalItems} 个商品` : "任务已结束", percent: 100, error: "" };
  if (totalItems) {
    const currentItem = Math.min(totalItems, completedItems + failedItems + (runningLog ? 1 : 0));
    return {
      message: runningLog?.line || lastLine || "正在上传商品...",
      detail: `第 ${Math.max(1, currentItem)} / ${totalItems} 个商品`,
      percent: Math.min(95, Math.max(12, Math.round((Math.max(completedItems + failedItems, currentItem - 1) / totalItems) * 100))),
      error: "",
    };
  }
  return { message: lastLine || "正在启动上传任务...", detail: "正在获取上传进度", percent: 12, error: "" };
}

function cleanDisplayText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
