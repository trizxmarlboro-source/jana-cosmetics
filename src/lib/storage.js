import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { env } from "../config/env.js";
import { isSupabaseStorageConfigured, supabaseAdmin } from "./supabase.js";

const MAX_UPLOAD_BYTES = 850 * 1024;
const KIND_RULES = {
  product: {
    folder: "products",
    types: new Set(["image/png", "image/jpeg"]),
    message: "Imagem do produto deve ser PNG ou JPG."
  },
  logo: {
    folder: "logos",
    types: new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml"
    ]),
    message: "Logo deve ser PNG, JPG, WEBP ou SVG."
  },
  favicon: {
    folder: "favicons",
    types: new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/svg+xml",
      "image/x-icon",
      "image/vnd.microsoft.icon"
    ]),
    message: "Favicon deve ser PNG, JPG, WEBP, SVG ou ICO."
  }
};

const EXTENSION_BY_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico"
};

function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(String(dataUrl ?? "").trim());

  if (!match) {
    const error = new Error("Arquivo invalido. Tente selecionar a imagem novamente.");
    error.status = 400;
    throw error;
  }

  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");

  if (!buffer.length) {
    const error = new Error("Imagem vazia. Tente novamente.");
    error.status = 400;
    throw error;
  }

  return { contentType, buffer };
}

function resolveExtension(filename, contentType) {
  const sanitizedExtension = extname(String(filename ?? "").trim()).toLowerCase();

  if (sanitizedExtension) {
    return sanitizedExtension;
  }

  return EXTENSION_BY_TYPE[contentType] ?? ".bin";
}

function assertAllowedUpload(kind, contentType, bufferSize) {
  const rule = KIND_RULES[kind];
  if (!rule) {
    const error = new Error("Tipo de upload invalido.");
    error.status = 400;
    throw error;
  }

  if (!rule.types.has(contentType)) {
    const error = new Error(rule.message);
    error.status = 400;
    throw error;
  }

  if (bufferSize > MAX_UPLOAD_BYTES) {
    const error = new Error("Use uma imagem com ate 850 KB.");
    error.status = 400;
    throw error;
  }

  return rule;
}

export async function uploadAdminImage({ kind, filename, dataUrl }) {
  if (!isSupabaseStorageConfigured()) {
    const error = new Error("Supabase Storage nao configurado no servidor.");
    error.status = 503;
    throw error;
  }

  const { contentType, buffer } = parseDataUrl(dataUrl);
  const rule = assertAllowedUpload(kind, contentType, buffer.length);
  const extension = resolveExtension(filename, contentType);
  const objectPath = `${rule.folder}/${Date.now()}-${randomUUID()}${extension}`;
  const bucket = env.supabase.storageBucket;

  const { error: uploadError } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, buffer, {
      contentType,
      cacheControl: "31536000",
      upsert: false
    });

  if (uploadError) {
    const error = new Error(uploadError.message || "Nao foi possivel enviar a imagem ao Storage.");
    error.status = 502;
    throw error;
  }

  const { data } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);

  return {
    bucket,
    path: objectPath,
    url: data.publicUrl
  };
}
