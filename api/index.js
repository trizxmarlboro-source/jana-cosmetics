import handleApiRequest from "../src/api/handler.js";

function normalizeRewrittenUrl(request) {
  const rawPath = request.query?.path;
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;

  if (!path) {
    return;
  }

  const url = new URL(request.url ?? "/api", `https://${request.headers.host ?? "localhost"}`);
  url.searchParams.delete("path");
  request.url = `/api/${String(path).replace(/^\/+/, "")}${url.search}`;
}

export default async function handler(request, response) {
  normalizeRewrittenUrl(request);
  await handleApiRequest(request, response);
}
