import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type NoonCatalogRow = {
  cells: string[];
  imageUrl: string;
  title: string;
  psku: string;
  sku: string;
  price: string;
  inventory: string;
  issues: string;
};

export type NoonCatalogSync = {
  synced: boolean;
  storeId: string;
  mode: string;
  catalogUrl: string;
  title: string;
  headers: string[];
  rows: NoonCatalogRow[];
  output: string;
  fileName: string;
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

export async function readLatestNoonCatalogSync({ rootDir = process.cwd(), storeId = "", mode = "global", page = 1, pageSize = 50 } = {}): Promise<NoonCatalogSync> {
  const normalizedMode = normalizeCatalogMode(mode);
  const normalizedStoreId = String(storeId || "").trim().toUpperCase();
  const normalizedPageSize = Math.min(100, Math.max(1, Math.trunc(Number(pageSize)) || 50));
  const requestedPage = Math.max(1, Math.trunc(Number(page)) || 1);
  const syncDir = path.join(rootDir, "exports", "noon-catalog-sync");

  let fileNames: string[] = [];
  try {
    fileNames = await readdir(syncDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const candidates = fileNames
    .filter((fileName) => fileName.endsWith(`-${normalizedMode}.json`))
    .sort()
    .reverse();

  for (const fileName of candidates) {
    try {
      const sync = JSON.parse(await readFile(path.join(syncDir, fileName), "utf8")) as Record<string, unknown>;
      if (normalizedStoreId && String(sync.storeId || "").toUpperCase() !== normalizedStoreId) continue;
      if (normalizeCatalogMode(sync.mode || normalizedMode) !== normalizedMode) continue;
      const headers = Array.isArray(sync.headers) ? sync.headers.map(cleanCatalogCellText) : [];
      const allRows = sanitizeNoonCatalogRows(sync.rows, headers);
      const totalItems = allRows.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / normalizedPageSize));
      const currentPage = Math.min(requestedPage, totalPages);
      const start = (currentPage - 1) * normalizedPageSize;
      return {
        synced: true,
        storeId: String(sync.storeId || normalizedStoreId),
        mode: normalizedMode,
        catalogUrl: String(sync.catalogUrl || ""),
        title: String(sync.title || ""),
        headers,
        rows: allRows.slice(start, start + normalizedPageSize),
        output: `/exports/noon-catalog-sync/${encodeURIComponent(fileName)}`,
        fileName,
        pagination: { page: currentPage, pageSize: normalizedPageSize, totalItems, totalPages },
      };
    } catch {
      // Ignore broken snapshots and keep looking for an older usable one.
    }
  }

  return emptyCatalogSync(normalizedStoreId, normalizedMode, normalizedPageSize);
}

function sanitizeNoonCatalogRows(rows: unknown, headers: string[]) {
  const headerText = headers.map(cleanCatalogCellText).join("|");
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeNoonCatalogRow)
    .filter((row): row is NoonCatalogRow => Boolean(row))
    .filter((row) => row.cells.length > 0)
    .filter((row) => row.cells.join("|") !== headerText);
}

function normalizeNoonCatalogRow(row: unknown): NoonCatalogRow | null {
  const rawCells = Array.isArray(row)
    ? row
    : row && typeof row === "object" && Array.isArray((row as { cells?: unknown[] }).cells)
      ? (row as { cells: unknown[] }).cells
      : [];
  const cells = rawCells.map(cleanCatalogCellText).filter(Boolean);
  if (!cells.length) return null;
  const productText = cells[0] || "";
  const details = parseNoonCatalogDetails(productText);
  return {
    cells,
    imageUrl: normalizeNoonCatalogImageUrl(row && typeof row === "object" ? cleanCatalogCellText((row as { imageUrl?: unknown }).imageUrl) : ""),
    title: details.title,
    psku: details.psku,
    sku: details.sku,
    price: cells[1] || "",
    inventory: cells[2] || "",
    issues: cells[4] || "",
  };
}

function parseNoonCatalogDetails(value: string) {
  const pskuMatch = value.match(/\bPSKU:\s*(\S+)/i);
  const skuMatch = value.match(/\bSKU:\s*(\S+)/i);
  return {
    title: value.replace(/\s*PSKU:\s*\S+\s*SKU:\s*\S+.*/i, "").trim() || value,
    psku: pskuMatch?.[1] || "",
    sku: skuMatch?.[1] || "",
  };
}

function cleanCatalogCellText(value: unknown) {
  return String(value ?? "").replace(/^\uE000\s*/, "").replace(/\s+/g, " ").trim();
}

function normalizeNoonCatalogImageUrl(value: string) {
  if (!value.includes("/_next/image")) return value;
  try {
    const url = new URL(value);
    return url.searchParams.get("url") || value;
  } catch {
    return value;
  }
}

function emptyCatalogSync(storeId: string, mode: string, pageSize: number): NoonCatalogSync {
  return {
    synced: false,
    storeId,
    mode,
    catalogUrl: "",
    title: "",
    headers: [],
    rows: [],
    output: "",
    fileName: "",
    pagination: { page: 1, pageSize, totalItems: 0, totalPages: 1 },
  };
}

function normalizeCatalogMode(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "fbn" || normalized === "fbp" || normalized === "fbn_fbp") return "fbn";
  return "global";
}
