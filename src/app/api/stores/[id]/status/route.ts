import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { projectRoot } from "@/lib/settings";
import { findStore, noonStoreProfile, noonStoreUrl } from "@/lib/stores";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const rootDir = projectRoot();
    const store = await findStore(decodeURIComponent(id), rootDir);
    if (!store) return NextResponse.json({ error: "找不到 noon 店铺。" }, { status: 404 });

    const result = await checkNoonStoreStatus(rootDir, store);
    return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
  } catch (error) {
    return NextResponse.json(
      { status: "error", loggedIn: false, uploadPageReachable: false, error: error instanceof Error ? error.message : "检测失败。" },
      { status: 500 },
    );
  }
}

function checkNoonStoreStatus(rootDir: string, store: { id: string; projectId: string }) {
  return new Promise<Record<string, unknown>>((resolve) => {
    const child = spawn(process.execPath, [
      "scripts/check-noon-status.js",
      "--noon-url",
      noonStoreUrl(store),
      "--profile",
      noonStoreProfile(rootDir, store.id),
    ], {
      cwd: rootDir,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", () => {
      const jsonLine = stdout.split(/\r?\n/).filter(Boolean).reverse().find((line) => line.trim().startsWith("{"));
      if (!jsonLine) {
        resolve({ status: "error", loggedIn: false, uploadPageReachable: false, error: stderr || stdout });
        return;
      }

      try {
        resolve(JSON.parse(jsonLine) as Record<string, unknown>);
      } catch {
        resolve({ status: "error", loggedIn: false, uploadPageReachable: false, error: jsonLine });
      }
    });
  });
}
