import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handleApiRequest, sendJson } from "./src/api/handler.js";

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = process.cwd();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const routeMap = new Map([
  ["/", "/index.html"],
  ["/produto", "/produto.html"],
  ["/admin", "/admin.html"],
  ["/minha-conta", "/minha-conta.html"],
  ["/pedido-confirmado", "/pedido-confirmado.html"],
  ["/auth", "/auth.html"]
]);

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = routeMap.get(requestUrl.pathname) ?? requestUrl.pathname;
  const decodedPath = decodeURIComponent(pathname);
  const filePath = normalize(join(PUBLIC_DIR, decodedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(response, 403, { error: "Acesso negado." });
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream"
    });
    response.end(content);
  } catch {
    sendJson(response, 404, { error: "Arquivo nao encontrado." });
  }
}

const server = createServer(async (request, response) => {
  if ((request.url ?? "").startsWith("/api/")) {
    await handleApiRequest(request, response);
    return;
  }

  await serveStatic(request, response);
});

server.listen(PORT, () => {
  console.log(`Servidor Jana Cosmeticos rodando em http://localhost:${PORT}`);
});
