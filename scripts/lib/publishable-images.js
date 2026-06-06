import { createSign } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const GOOGLE_TOKEN_SCOPE = "https://www.googleapis.com/auth/drive";

export async function publishProductImages({ productsDir, outputPath, credentialsPath, folderId, folderName, dryRun = false, fetchImpl = null }) {
  if (!productsDir) throw new Error("Missing productsDir.");
  if (!outputPath) throw new Error("Missing outputPath.");
  if (!dryRun && !credentialsPath) throw new Error("Missing Google service account credentials path.");
  if (!dryRun && !folderId && !folderName) throw new Error("Missing Google Drive folder id or folder name.");

  const products = await collectProductImageInputs(productsDir);
  const token = dryRun ? "" : await googleAccessToken(credentialsPath, fetchImpl);
  const resolvedFolderId = dryRun ? folderId : folderId || await findDriveFolderId({ token, folderName, fetchImpl });
  const manifest = {
    generatedAt: new Date().toISOString(),
    storage: dryRun ? "local-dry-run" : "google-drive",
    folderId: resolvedFolderId || "",
    products: {},
  };

  for (const product of products) {
    const publishedImages = [];
    for (const [index, image] of product.images.entries()) {
      const localPath = await ensureJpegImage(product.productDir, image.path);
      const name = `${product.sku}-${String(index + 1).padStart(3, "0")}.jpg`;
      const uploaded = dryRun
        ? {
            id: "",
            url: `file://${localPath}`,
            webViewLink: "",
          }
        : await uploadDriveImage({ token, folderId: resolvedFolderId, localPath, name, fetchImpl });

      publishedImages.push({
        source: image.path,
        localPath,
        contentType: "image/jpeg",
        driveFileId: uploaded.id,
        url: uploaded.url,
        webViewLink: uploaded.webViewLink,
      });
    }

    manifest.products[product.sku] = {
      productId: product.productId,
      productDir: product.productDir,
      images: publishedImages,
    };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

async function findDriveFolderId({ token, folderName, fetchImpl }) {
  const escapedName = folderName.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and name='${escapedName}'`;
  const response = await requestJson(
    `https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,webViewLink)&q=${encodeURIComponent(query)}`,
    {
      headers: { authorization: `Bearer ${token}` },
    },
    fetchImpl,
  );
  const body = response.body;
  if (!response.ok) throw new Error(`Google Drive folder lookup failed: ${body.error?.message || response.status}`);
  if (body.files.length === 0) throw new Error(`Google Drive folder not found or not shared with service account: ${folderName}`);
  if (body.files.length > 1) throw new Error(`Multiple Google Drive folders named ${folderName}; use --drive-folder with the folder id.`);
  return body.files[0].id;
}

export function imageUrlsForSku(manifest, sku) {
  if (!manifest || !sku) return [];
  return (manifest.products?.[sku]?.images ?? []).map((image) => cleanText(image.url)).filter(isPublicHttpUrl);
}

async function collectProductImageInputs(productsDir) {
  const entries = await readdir(productsDir, { withFileTypes: true });
  const products = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const productDir = path.join(productsDir, entry.name);
    const meta = await readJsonIfExists(path.join(productDir, "meta.json"));
    if (!meta) continue;
    const noonAttributes = (await readJsonIfExists(path.join(productDir, "noon-product-attributes.json"))) ?? {};
    const sku = firstSku(noonAttributes, meta);
    const images = await localProductImages(productDir, noonAttributes);
    if (sku && images.length) products.push({ sku, productId: cleanText(meta.productId), productDir, images });
  }

  return products.sort((left, right) => left.sku.localeCompare(right.sku));
}

function firstSku(noonAttributes, meta) {
  return cleanText(
    noonAttributes.productIdentity?.partnerSku ||
      noonAttributes.variants?.[0]?.partner_sku ||
      (meta.productId ? `1688-${meta.productId}` : ""),
  );
}

async function localProductImages(productDir, noonAttributes) {
  const namedImages = [
    ...(noonAttributes.productIdentity?.productImages ?? []),
    ...((noonAttributes.variants?.[0]?.images ?? []).map((image) => (typeof image === "string" ? image : image?.path))),
  ]
    .map(cleanText)
    .filter(Boolean);
  const candidates = namedImages.length ? namedImages : await imageFilesInDir(productDir);
  const existing = [];

  for (const fileName of candidates) {
    const filePath = path.resolve(productDir, fileName);
    await access(filePath).then(
      () => existing.push({ path: path.relative(productDir, filePath) }),
      () => {},
    );
  }

  return uniqueBy(existing, (image) => image.path).slice(0, 7);
}

async function imageFilesInDir(productDir) {
  const entries = await readdir(productDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|gif|webp)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function ensureJpegImage(productDir, relativeImagePath) {
  const sourcePath = path.resolve(productDir, relativeImagePath);
  if (/\.(?:jpe?g)$/i.test(sourcePath)) return sourcePath;

  const outDir = path.join(productDir, "publishable-images");
  const outPath = path.join(outDir, `${path.parse(relativeImagePath).name}.jpg`);
  await mkdir(outDir, { recursive: true });
  await run("sips", ["-s", "format", "jpeg", sourcePath, "--out", outPath]);
  return outPath;
}

async function googleAccessToken(credentialsPath, fetchImpl) {
  const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: credentials.client_email,
    scope: GOOGLE_TOKEN_SCOPE,
    aud: credentials.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const assertion = signJwt({ alg: "RS256", typ: "JWT" }, claim, credentials.private_key);
  const response = await requestJson(claim.aud, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  }, fetchImpl);
  const body = response.body;
  if (!response.ok) throw new Error(`Google token request failed: ${body.error_description || body.error || response.status}`);
  return body.access_token;
}

function signJwt(header, claim, privateKey) {
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function uploadDriveImage({ token, folderId, localPath, name, fetchImpl }) {
  const metadata = { name, parents: [folderId] };
  const bytes = await readFile(localPath);
  const boundary = `noon-tools-${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploadResponse = await requestJson(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webContentLink,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
    fetchImpl,
  );
  const file = uploadResponse.body;
  if (!uploadResponse.ok) throw new Error(`Google Drive upload failed: ${file.error?.message || uploadResponse.status}`);

  const permissionResponse = await requestJson(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions?supportsAllDrives=true`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  }, fetchImpl);
  if (!permissionResponse.ok) {
    const error = permissionResponse.body;
    throw new Error(`Google Drive sharing failed: ${error.error?.message || permissionResponse.status}`);
  }

  return {
    id: file.id,
    url: `https://drive.google.com/uc?export=download&id=${file.id}`,
    webViewLink: file.webViewLink || "",
  };
}

async function requestJson(url, options = {}, fetchImpl) {
  if (fetchImpl) {
    const response = await fetchImpl(url, options);
    return { ok: response.ok, status: response.status, body: await response.json() };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "google-drive-request-"));
  try {
    const args = ["-sS", "-X", options.method || "GET"];
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      args.push("-H", `${name}: ${value}`);
    }
    if (options.body != null) {
      const bodyPath = path.join(tempDir, "body");
      await writeFile(bodyPath, Buffer.isBuffer(options.body) ? options.body : String(options.body));
      args.push("--data-binary", `@${bodyPath}`);
    }
    args.push("-w", "\nNOON_TOOLS_HTTP_STATUS:%{http_code}", url);
    const { stdout } = await run("curl", args, { maxBuffer: 1024 * 1024 * 20 });
    const marker = "\nNOON_TOOLS_HTTP_STATUS:";
    const markerIndex = stdout.lastIndexOf(marker);
    if (markerIndex === -1) throw new Error("curl response did not include HTTP status.");
    const rawBody = stdout.slice(0, markerIndex);
    const status = Number(stdout.slice(markerIndex + marker.length).trim());
    return {
      ok: status >= 200 && status < 300,
      status,
      body: rawBody ? JSON.parse(rawBody) : {},
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function isPublicHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  return values.filter((value) => {
    const key = keyFn(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function cleanText(value) {
  return value == null ? "" : String(value).trim();
}
