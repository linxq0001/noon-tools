import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { listRepositoryProducts } from "./products";
import { projectRoot } from "./settings";
import { findStore, findStoreSecret, noonStoreProfile, noonStoreUrl } from "./stores";

type JobStatus = "running" | "completed" | "failed" | "cancelled";

export type JobLog = {
  time: string;
  line: string;
};

export type Job = {
  id: string;
  kind: "collect1688" | "login1688" | "loginNoon" | "uploadNoon" | "syncNoonCatalog";
  status: JobStatus;
  url: string;
  productDir?: string;
  productDirs?: string[];
  repository?: string;
  storeId?: string;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  logs: JobLog[];
  child: ChildProcessWithoutNullStreams | null;
};

const globalJobStores = globalThis as typeof globalThis & {
  __noonToolsJobs?: Map<string, Job>;
  __noonToolsUploadJobs?: Map<string, Job>;
};

const jobs = globalJobStores.__noonToolsJobs || (globalJobStores.__noonToolsJobs = new Map<string, Job>());
const uploadJobs = globalJobStores.__noonToolsUploadJobs || (globalJobStores.__noonToolsUploadJobs = new Map<string, Job>());
const default1688Profile = ".cloakbrowser-profile";

export function listJobs() {
  return [...jobs.values()].map(serializeJob);
}

export function listUploadJobs() {
  return [...uploadJobs.values()].map(serializeJob);
}

export function getJob(id: string) {
  const job = jobs.get(id);
  return job ? serializeJob(job) : null;
}

export function getUploadJob(id: string) {
  const job = uploadJobs.get(id);
  return job ? serializeJob(job) : null;
}

export function cancelJob(id: string) {
  return cancelJobInStore(jobs, id);
}

export function cancelUploadJob(id: string) {
  return cancelJobInStore(uploadJobs, id);
}

function cancelJobInStore(store: Map<string, Job>, id: string) {
  const job = store.get(id);
  if (!job) return null;
  if (job.status !== "running") return serializeJob(job);

  job.status = "cancelled";
  job.exitCode = null;
  job.finishedAt = new Date().toISOString();
  appendLog(job, "任务已手动停止。");
  job.child?.kill("SIGTERM");

  setTimeout(() => {
    if (job.child && !job.child.killed) job.child.kill("SIGKILL");
  }, 5000).unref();

  return serializeJob(job);
}

export function startCollectJob(body: unknown) {
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const url = String(values.url || "").trim();

  if (url && !/^https?:\/\/.+1688\.com\//i.test(url)) {
    throw new Error("请输入有效的 1688 链接。");
  }

  const runningJob = findRunning1688Job();
  if (runningJob) throw new Error(`已有 1688 任务正在运行：${runningJob.kind}。请等待完成或先停止当前任务。`);

  const args = ["scripts/collect-1688.js"];
  if (url) args.push(url);
  args.push("--out", "products");
  if (values.limit !== undefined) args.push("--limit", String(values.limit));
  if (values.delaySeconds) args.push("--delay-seconds", String(values.delaySeconds));
  if (values.repository) args.push("--repository", String(values.repository));
  if (values.headless === false) args.push("--headless", "false");
  if (values.deepSeekApiKey) args.push("--deepseek", "true");
  args.push("--profile", default1688Profile);
  if (values.proxy) args.push("--proxy", String(values.proxy));

  const env = { ...process.env };
  if (values.deepSeekApiKey) env.DEEPSEEK_API_KEY = String(values.deepSeekApiKey);
  if (values.deepSeekModel) env.DEEPSEEK_MODEL = String(values.deepSeekModel);

  return startJob({
    kind: "collect1688",
    url: url || "collection-queue.json",
    args,
    env,
  });
}

export function startLogin1688Job(body: unknown) {
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const runningJob = findRunning1688Job();
  if (runningJob) throw new Error(`已有 1688 任务正在运行：${runningJob.kind}。请等待完成或先停止当前任务。`);

  const inputUrl = String(values.url || "").trim();
  const loginUrl = inputUrl && /^https?:\/\/.+1688\.com\//i.test(inputUrl) ? inputUrl : "https://www.1688.com/";
  return startJob({
    kind: "login1688",
    url: loginUrl,
    args: ["scripts/login-1688.js", "--url", loginUrl, "--profile", default1688Profile],
    env: process.env,
  });
}

export async function startNoonStoreLoginJob(storeId: string) {
  const rootDir = projectRoot();
  const store = await findStore(storeId, rootDir);
  if (!store) throw new Error("找不到 noon 店铺。");

  return startJob({
    kind: "loginNoon",
    url: noonStoreUrl(store),
    args: ["scripts/login-noon.js", "--noon-url", noonStoreUrl(store), "--profile", noonStoreProfile(rootDir, store.id)],
    env: process.env,
  });
}

export async function startUploadJob(body: unknown) {
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const storeId = String(values.storeId || "").trim();
  if (!storeId) throw new Error("请选择一个 noon 店铺。");

  const rootDir = projectRoot();
  const store = await findStore(storeId, rootDir);
  if (!store) throw new Error("找不到 noon 店铺。");

  const repository = cleanPathSegment(values.repository);
  let productDirs = Array.isArray(values.productDirs) ? values.productDirs.map(String).filter(Boolean) : [];
  const productDir = cleanPathSegment(values.productDir);
  const all = values.all === true;

  if (!all && repository && productDirs.length === 0 && !productDir) {
    productDirs = await collectRepositoryProductDirs(repository, rootDir);
  }

  if (!all && !productDir && productDirs.length === 0) {
    throw new Error("请选择一个商品目录、仓库，或选择全部上传。");
  }

  const args = ["scripts/upload-noon.js", "--noon-url", noonStoreUrl(store), "--profile", noonStoreProfile(rootDir, store.id), "--store-id", store.id];
  if (all) {
    args.push("--all");
  } else if (productDirs.length > 0) {
    args.push("--product-dirs", JSON.stringify(productDirs.map((dir) => `products/${dir}`)));
  } else {
    args.push("--product-dir", `products/${productDir}`);
  }
  args.push("--browser", String(values.noonBrowser || "cloak"));
  if (values.noonCloakTyping === true || values.noonCloakTyping === "true") args.push("--cloak-typing", "true");
  if (values.headless === true || values.headless === "true") args.push("--headless", "true");

  return startJob({
    kind: "uploadNoon",
    url: noonStoreUrl(store),
    args,
    env: process.env,
    store: uploadJobs,
    extra: {
      productDir,
      productDirs,
      repository: all ? "" : repository || repositoryFromProductDir(productDirs[0] || productDir),
      storeId: store.id,
    },
  });
}

async function collectRepositoryProductDirs(repositoryId: string, rootDir: string) {
  const productDirs: string[] = [];
  let pageNumber = 1;
  let totalPages = 1;

  do {
    const page = await listRepositoryProducts({ repositoryId, page: pageNumber, pageSize: 100, rootDir });
    if (!page) break;
    productDirs.push(...page.products.map((product) => product.dirName));
    totalPages = page.pagination.totalPages;
    pageNumber += 1;
  } while (pageNumber <= totalPages);

  return productDirs;
}

export async function startNoonCatalogSyncJob(body: unknown) {
  const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const source = String(values.source || "").trim();
  if (source !== "internal_api" && source !== "export") {
    throw new Error("同步方案必须是 internal_api 或 export。");
  }
  const storeId = String(values.storeId || "").trim();
  if (!storeId) throw new Error("请选择一个 noon 店铺。");
  const mode = normalizeCatalogMode(values.mode || "global");
  if (source === "export" && mode !== "global") {
    throw new Error("导出同步仅支持 Global 模式。");
  }
  if ([...uploadJobs.values()].some((job) => job.kind === "syncNoonCatalog" && job.storeId === storeId && job.status === "running")) {
    throw new Error("该店铺已有正在运行的目录同步任务。");
  }

  const rootDir = projectRoot();
  const store = await findStore(storeId, rootDir);
  if (!store) throw new Error("找不到 noon 店铺。");
  const storeSecret = source === "export" ? await findStoreSecret(storeId, rootDir) : null;

  const country = String(values.country || "sa").trim().toLowerCase();
  const noonStatus = String(values.noonStatus || "all").trim();
  const script = source === "internal_api"
    ? "scripts/sync-noon-catalog-internal-api.js"
    : "scripts/sync-noon-catalog-api.js";
  const args = source === "internal_api"
    ? [script, "--store-id", store.id, "--mode", mode, "--catalog-url", noonStoreUrl(store), "--profile", noonStoreProfile(rootDir, store.id)]
    : [script, "--store-id", store.id, "--mode", mode, "--country", country, "--noon-status", noonStatus];
  const jobEnv = { ...process.env };
  if (source !== "export") delete jobEnv.NOON_API_TOKEN;
  else if (storeSecret?.apiToken) jobEnv.NOON_API_TOKEN = storeSecret.apiToken;
  return startJob({
    kind: "syncNoonCatalog",
    url: source === "internal_api" ? noonStoreUrl(store) : "/impex/v1/export/create",
    args,
    env: jobEnv,
    store: uploadJobs,
    extra: { storeId: store.id },
  });
}

function startJob(options: { kind: Job["kind"]; url: string; args: string[]; env: NodeJS.ProcessEnv; store?: Map<string, Job>; extra?: Partial<Job> }) {
  const rootDir = projectRoot();
  const job: Job = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind: options.kind,
    status: "running",
    url: options.url,
    ...options.extra,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    child: null,
  };

  const store = options.store || jobs;
  store.set(job.id, job);
  const child = spawn(process.execPath, options.args, { cwd: rootDir, env: options.env });
  job.child = child;
  child.stdout.on("data", (chunk) => appendLog(job, chunk));
  child.stderr.on("data", (chunk) => appendLog(job, chunk));
  child.on("close", (code) => {
    if (job.status === "cancelled") return;
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });

  return serializeJob(job);
}

function findRunning1688Job() {
  return [...jobs.values()].find((job) => job.status === "running");
}

function appendLog(job: Job, chunk: unknown) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  job.logs.push(...lines.map((line) => ({ time: new Date().toISOString(), line })));
  job.logs = job.logs.slice(-300);
}

function serializeJob(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    url: job.url,
    productDir: job.productDir,
    productDirs: job.productDirs,
    repository: job.repository,
    storeId: job.storeId,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    logs: job.logs,
  };
}

function cleanPathSegment(value: unknown) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function repositoryFromProductDir(value: string) {
  const parts = cleanPathSegment(value).split("/").filter(Boolean);
  if (!parts.length) return "";
  if (parts[0] === "1688") return parts[1] || "default";
  if (parts.length === 1) return "default";
  return parts[0];
}

function normalizeCatalogMode(value: unknown) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "fbn" || mode === "fbp" || mode === "fbn_fbp") return "fbn";
  if (mode === "global" || mode === "ngs") return "global";
  throw new Error("Noon Catalog 模式不合法。");
}
