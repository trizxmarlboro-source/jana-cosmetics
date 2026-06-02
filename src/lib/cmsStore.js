import { readFile, writeFile, mkdir, access, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_CMS_PATH = resolve(process.cwd(), "data", "cms.json");
const configuredCmsPath = (process.env.CMS_DATA_PATH ?? "").trim();
const isVercelRuntime = Boolean(
  process.env.VERCEL ||
  process.env.VERCEL_ENV ||
  process.env.NOW_REGION ||
  process.cwd().startsWith("/var/task")
);
const runtimeCmsPath = isVercelRuntime && !configuredCmsPath ? "/tmp/jana-cms.json" : "";
const selectedCmsPath = runtimeCmsPath || configuredCmsPath || DEFAULT_CMS_PATH;
const CMS_PATH = isAbsolute(selectedCmsPath) ? selectedCmsPath : resolve(process.cwd(), selectedCmsPath);

async function ensureStore() {
  await mkdir(dirname(CMS_PATH), { recursive: true });
}

async function ensureSeedData() {
  try {
    await access(CMS_PATH, constants.F_OK);
    return;
  } catch {
    // segue para seed inicial
  }

  if (CMS_PATH !== DEFAULT_CMS_PATH) {
    await copyFile(DEFAULT_CMS_PATH, CMS_PATH);
    return;
  }

  throw new Error(`Arquivo de dados nao encontrado em ${CMS_PATH}.`);
}

export async function readCms() {
  await ensureStore();
  await ensureSeedData();
  const content = await readFile(CMS_PATH, "utf8");
  return JSON.parse(content);
}

export async function writeCms(data) {
  await ensureStore();
  await ensureSeedData();
  await writeFile(CMS_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return data;
}

export function makeId(prefix) {
  return `${prefix}-${randomUUID()}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function publicProduct(product, category) {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    imageUrl: product.imageUrl,
    categoryId: product.categoryId,
    categoryName: category?.name ?? "Sem categoria",
    status: Boolean(product.status),
    badge: product.badge ?? ""
  };
}
