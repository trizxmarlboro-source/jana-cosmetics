import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { readCms, writeCms, makeId, nowIso, publicProduct } from "../lib/cmsStore.js";
import {
  checkMisticPayTransaction,
  createMisticPayPixTransaction,
  getMisticPayBalance
} from "../payments.js";

const ADMIN_USER = env.admin.user;
const ADMIN_PASSWORD = env.admin.password;
const DEFAULT_PAYER_DOCUMENT = env.misticPay.defaultDocument;
const SESSION_COOKIE_NAME = "admin_session";
const SESSION_TTL_SECONDS = Math.min(Math.max(Number(env.admin.sessionTtlSeconds) || 1800, 60), 1800);
const SESSION_SECRET = env.admin.sessionSecret || env.admin.password || "change-this-admin-session-secret";
const JSON_BODY_CACHE_KEY = Symbol.for("jana-cosmeticos.json-body");
const PIX_DISCOUNT_RATE = env.checkout.pixDiscountRate;
const MAX_ASSET_DATA_URL_LENGTH = Number(process.env.MAX_ASSET_DATA_URL_LENGTH ?? 900000);
const MAX_PRODUCT_IMAGE_DATA_URL_LENGTH = Number(process.env.MAX_PRODUCT_IMAGE_DATA_URL_LENGTH ?? 1200000);

export function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        if (separator === -1) {
          return [cookie, ""];
        }
        return [cookie.slice(0, separator), decodeURIComponent(cookie.slice(separator + 1))];
      })
  );
}

function isSameSecret(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function adminCredentialsConfigured() {
  return Boolean(
    ADMIN_USER &&
    ADMIN_PASSWORD &&
    !ADMIN_USER.startsWith("YOUR_") &&
    !ADMIN_PASSWORD.startsWith("YOUR_")
  );
}

function shouldUseSecureCookie(request) {
  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "");
  return process.env.NODE_ENV === "production" || forwardedProto.includes("https");
}

function createSessionToken(user) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    user,
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
  return {
    token: `${encodedPayload}.${signature}`,
    payload
  };
}

function parseSessionToken(token) {
  if (!token || typeof token !== "string") {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", SESSION_SECRET).update(encodedPayload).digest("base64url");
  if (!isSameSecret(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload?.user || !payload?.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(response, request, token, maxAgeSeconds) {
  const secure = shouldUseSecureCookie(request) ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`
  );
}

function createSession(response, request) {
  const session = createSessionToken(ADMIN_USER);
  setSessionCookie(response, request, session.token, SESSION_TTL_SECONDS);
  return session.payload;
}

function clearSession(response, request) {
  setSessionCookie(response, request, "", 0);
}

function authenticatedSession(request) {
  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  const payload = parseSessionToken(token);
  if (payload?.user && payload.user === ADMIN_USER) {
    return payload;
  }
  return null;
}

function isAuthenticated(request) {
  return Boolean(authenticatedSession(request));
}

function sessionResponse(payload) {
  const now = Math.floor(Date.now() / 1000);
  return {
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    expiresInSeconds: Math.max(0, payload.exp - now),
    maxAgeSeconds: SESSION_TTL_SECONDS
  };
}

function requireAuth(request, response) {
  if (isAuthenticated(request)) {
    return true;
  }

  sendJson(response, 401, { error: "Autenticacao obrigatoria." });
  return false;
}

async function readJsonBody(request) {
  if (request[JSON_BODY_CACHE_KEY] !== undefined) {
    return request[JSON_BODY_CACHE_KEY];
  }

  let bodyContent = "";
  const rawBody = request.body;

  if (rawBody !== undefined && rawBody !== null) {
    if (typeof rawBody === "string") {
      bodyContent = rawBody;
    } else if (Buffer.isBuffer(rawBody)) {
      bodyContent = rawBody.toString("utf8");
    } else if (typeof rawBody === "object") {
      request[JSON_BODY_CACHE_KEY] = rawBody;
      return rawBody;
    }
  } else if (typeof request[Symbol.asyncIterator] === "function") {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    bodyContent = Buffer.concat(chunks).toString("utf8");
  }

  const trimmed = bodyContent.trim();
  if (!trimmed) {
    request[JSON_BODY_CACHE_KEY] = {};
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    request[JSON_BODY_CACHE_KEY] = parsed;
    return parsed;
  } catch {
    const error = new Error("JSON invalido.");
    error.status = 400;
    throw error;
  }
}

function validateCategory(input, existingCategories, currentId) {
  const name = String(input.name ?? "").trim();
  if (!name) {
    return "Nome da categoria e obrigatorio.";
  }

  const duplicate = existingCategories.find(
    (category) => category.name.toLowerCase() === name.toLowerCase() && category.id !== currentId
  );
  if (duplicate) {
    return "Ja existe uma categoria com esse nome.";
  }

  return "";
}

function validateProduct(input, categories) {
  if (!String(input.name ?? "").trim()) return "Nome do produto e obrigatorio.";
  if (!String(input.description ?? "").trim()) return "Descricao do produto e obrigatoria.";
  if (!Number(input.price) || Number(input.price) <= 0) return "Preco deve ser maior que zero.";
  const imageUrl = String(input.imageUrl ?? "").trim();
  if (!imageUrl) return "Imagem do produto e obrigatoria.";
  if (imageUrl.startsWith("data:image/")) {
    if (!imageUrl.startsWith("data:image/png;") && !imageUrl.startsWith("data:image/jpeg;")) {
      return "Imagem do produto deve ser PNG ou JPG.";
    }
    if (imageUrl.length > MAX_PRODUCT_IMAGE_DATA_URL_LENGTH) {
      return "Imagem do produto excede o limite permitido.";
    }
  }
  if (!categories.some((category) => category.id === input.categoryId)) return "Categoria invalida.";
  return "";
}

function productPayload(input, categories) {
  const categoryId = input.categoryId || categories[0]?.id;
  return {
    name: String(input.name ?? "").trim(),
    description: String(input.description ?? "").trim(),
    price: Number(input.price),
    imageUrl: String(input.imageUrl ?? "").trim(),
    categoryId,
    status: Boolean(input.status),
    badge: String(input.badge ?? "").trim()
  };
}

function defaultSettings() {
  return {
    logoUrl: "assets/logo-jana-cosmeticos.svg",
    faviconUrl: "assets/logo-jana-cosmeticos.svg",
    updatedAt: nowIso()
  };
}

function publicSettings(data) {
  return {
    ...defaultSettings(),
    ...(data.settings ?? {})
  };
}

function settingsPayload(input, currentSettings) {
  const nextSettings = {
    ...defaultSettings(),
    ...currentSettings,
    updatedAt: nowIso()
  };

  for (const key of ["logoUrl", "faviconUrl"]) {
    const value = String(input[key] ?? "").trim();
    if (!value) {
      continue;
    }
    if (value.length > MAX_ASSET_DATA_URL_LENGTH) {
      const error = new Error(`${key} excede o limite permitido.`);
      error.status = 400;
      throw error;
    }
    if (!value.startsWith("data:image/") && !value.startsWith("assets/") && !value.startsWith("http")) {
      const error = new Error(`${key} deve ser uma imagem valida.`);
      error.status = 400;
      throw error;
    }
    nextSettings[key] = value;
  }

  return nextSettings;
}

function ensureMetrics(data) {
  data.metrics = {
    totalSales: Number(data.metrics?.totalSales ?? 0),
    orderCount: Number(data.metrics?.orderCount ?? 0),
    pixInitiated: Number(data.metrics?.pixInitiated ?? 0),
    pixCompleted: Number(data.metrics?.pixCompleted ?? 0),
    pixRevenue: Number(data.metrics?.pixRevenue ?? data.metrics?.totalSales ?? 0),
    pixDiscounts: Number(data.metrics?.pixDiscounts ?? 0)
  };

  return data.metrics;
}

function ensureOrders(data) {
  if (!Array.isArray(data.orders)) {
    data.orders = [];
  }

  return data.orders;
}

function pixConversionRate(metrics) {
  return metrics.pixInitiated > 0 ? Number(((metrics.pixCompleted / metrics.pixInitiated) * 100).toFixed(1)) : 0;
}

function moneyValue(value) {
  return Number(Number(value).toFixed(2));
}

async function handleCatalogApi(request, response, requestUrl) {
  const data = await readCms();
  const categoriesById = new Map(data.categories.map((category) => [category.id, category]));

  if (request.method === "GET" && requestUrl.pathname === "/api/catalog/products") {
    const products = data.products
      .filter((product) => product.status)
      .map((product) => publicProduct(product, categoriesById.get(product.categoryId)));
    sendJson(response, 200, { products, categories: data.categories });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/catalog/categories") {
    sendJson(response, 200, { categories: data.categories });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/site/settings") {
    sendJson(response, 200, { settings: publicSettings(data) });
    return true;
  }

  return false;
}

async function handleAdminApi(request, response, requestUrl) {
  if (request.method === "POST" && requestUrl.pathname === "/api/admin/login") {
    const body = await readJsonBody(request);
    if (!adminCredentialsConfigured()) {
      sendJson(response, 503, { error: "Credenciais admin nao configuradas no servidor." });
      return true;
    }

    if (isSameSecret(body.user ?? "", ADMIN_USER) && isSameSecret(body.password ?? "", ADMIN_PASSWORD)) {
      const session = createSession(response, request);
      sendJson(response, 200, { ok: true, ...sessionResponse(session) });
      return true;
    }

    sendJson(response, 401, { error: "Usuario ou senha invalidos." });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/logout") {
    clearSession(response, request);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/me") {
    const session = authenticatedSession(request);
    const authenticated = Boolean(session);
    sendJson(response, 200, {
      authenticated,
      user: authenticated ? ADMIN_USER : null,
      ...(session ? sessionResponse(session) : { expiresAt: null, expiresInSeconds: 0, maxAgeSeconds: SESSION_TTL_SECONDS })
    });
    return true;
  }

  if (!requestUrl.pathname.startsWith("/api/admin/")) {
    return false;
  }

  if (!requireAuth(request, response)) {
    return true;
  }

  const data = await readCms();

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/dashboard") {
    const activeProducts = data.products.filter((product) => product.status).length;
    const categories = data.categories.length;
    const metrics = ensureMetrics(data);
    const recentOrders = ensureOrders(data)
      .slice()
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 8);
    const productsByCategory = data.categories.map((category) => ({
      category: category.name,
      total: data.products.filter((product) => product.categoryId === category.id).length
    }));

    sendJson(response, 200, {
      totalSales: metrics.totalSales,
      orderCount: metrics.orderCount,
      pixInitiated: metrics.pixInitiated,
      pixCompleted: metrics.pixCompleted,
      pixRevenue: metrics.pixRevenue,
      pixDiscounts: metrics.pixDiscounts,
      pixConversionRate: pixConversionRate(metrics),
      activeProducts,
      categories,
      topProducts: data.products.slice(0, 5).map((product) => ({ name: product.name, sales: 0 })),
      productsByCategory,
      recentOrders
    });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/products") {
    sendJson(response, 200, { products: data.products, categories: data.categories });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/products") {
    const body = await readJsonBody(request);
    const payload = productPayload(body, data.categories);
    const error = validateProduct(payload, data.categories);
    if (error) return sendJson(response, 400, { error }), true;

    const product = { id: makeId("prod"), ...payload, createdAt: nowIso(), updatedAt: nowIso() };
    data.products.push(product);
    await writeCms(data);
    sendJson(response, 201, { product });
    return true;
  }

  if (requestUrl.pathname.startsWith("/api/admin/products/")) {
    const id = decodeURIComponent(requestUrl.pathname.split("/").pop());
    const index = data.products.findIndex((product) => product.id === id);
    if (index === -1) return sendJson(response, 404, { error: "Produto nao encontrado." }), true;

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const payload = productPayload(body, data.categories);
      const error = validateProduct(payload, data.categories);
      if (error) return sendJson(response, 400, { error }), true;

      data.products[index] = { ...data.products[index], ...payload, updatedAt: nowIso() };
      await writeCms(data);
      sendJson(response, 200, { product: data.products[index] });
      return true;
    }

    if (request.method === "DELETE") {
      const [product] = data.products.splice(index, 1);
      await writeCms(data);
      sendJson(response, 200, { product });
      return true;
    }
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/settings") {
    sendJson(response, 200, { settings: publicSettings(data) });
    return true;
  }

  if (request.method === "PUT" && requestUrl.pathname === "/api/admin/settings") {
    const body = await readJsonBody(request);
    data.settings = settingsPayload(body, data.settings);
    await writeCms(data);
    sendJson(response, 200, { settings: publicSettings(data) });
    return true;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/admin/categories") {
    sendJson(response, 200, { categories: data.categories });
    return true;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/admin/categories") {
    const body = await readJsonBody(request);
    const error = validateCategory(body, data.categories);
    if (error) return sendJson(response, 400, { error }), true;

    const category = {
      id: makeId("cat"),
      name: String(body.name).trim(),
      description: String(body.description ?? "").trim(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    data.categories.push(category);
    await writeCms(data);
    sendJson(response, 201, { category });
    return true;
  }

  if (requestUrl.pathname.startsWith("/api/admin/categories/")) {
    const id = decodeURIComponent(requestUrl.pathname.split("/").pop());
    const index = data.categories.findIndex((category) => category.id === id);
    if (index === -1) return sendJson(response, 404, { error: "Categoria nao encontrada." }), true;

    if (request.method === "PUT") {
      const body = await readJsonBody(request);
      const error = validateCategory(body, data.categories, id);
      if (error) return sendJson(response, 400, { error }), true;

      data.categories[index] = {
        ...data.categories[index],
        name: String(body.name).trim(),
        description: String(body.description ?? "").trim(),
        updatedAt: nowIso()
      };
      await writeCms(data);
      sendJson(response, 200, { category: data.categories[index] });
      return true;
    }

    if (request.method === "DELETE") {
      const productsUsingCategory = data.products.some((product) => product.categoryId === id);
      if (productsUsingCategory) {
        sendJson(response, 400, {
          error: "Reassocie ou exclua os produtos desta categoria antes de remove-la."
        });
        return true;
      }

      const [category] = data.categories.splice(index, 1);
      await writeCms(data);
      sendJson(response, 200, { category });
      return true;
    }
  }

  return false;
}

function normalizeCheckoutItems(body) {
  if (Array.isArray(body.items) && body.items.length > 0) {
    return body.items.map((item) => ({
      productId: String(item.productId ?? item.id ?? "").trim(),
      quantity: Math.max(1, Math.min(99, Number.parseInt(item.quantity ?? 1, 10) || 1))
    }));
  }

  const productId = String(body.productId ?? "").trim();
  return productId ? [{ productId, quantity: 1 }] : [];
}

function formatCheckoutAddress(body) {
  const noNumber = Boolean(body.noNumber);
  const number = noNumber ? "S/N" : String(body.number ?? "").trim();

  return {
    cep: String(body.cep ?? "").trim(),
    street: String(body.street ?? body.buyerStreet ?? "").trim(),
    number,
    noNumber,
    complement: String(body.complement ?? "").trim(),
    reference: String(body.reference ?? "").trim(),
    neighborhood: String(body.neighborhood ?? "").trim(),
    city: String(body.city ?? "").trim(),
    uf: String(body.uf ?? "").trim().toUpperCase().slice(0, 2)
  };
}

async function handleCheckoutApi(request, response, requestUrl) {
  if (request.method !== "POST" || requestUrl.pathname !== "/api/checkout/pix") {
    return false;
  }

  const body = await readJsonBody(request);
  const buyerName = String(body.buyerName ?? "").trim();
  const address = formatCheckoutAddress(body);
  const requestedItems = normalizeCheckoutItems(body);

  if (!buyerName || !address.cep || !address.street || !address.city || !address.uf || requestedItems.length === 0) {
    sendJson(response, 400, {
      error: "Nome, CEP, rua, cidade, UF e pelo menos um produto sao obrigatorios."
    });
    return true;
  }

  if (!address.noNumber && !address.number) {
    sendJson(response, 400, { error: "Informe o numero do endereco ou marque S/N." });
    return true;
  }

  const data = await readCms();
  const productsById = new Map(data.products.filter((product) => product.status).map((product) => [product.id, product]));
  const checkoutItems = [];

  for (const item of requestedItems) {
    const product = productsById.get(item.productId);
    if (!product) {
      sendJson(response, 404, { error: `Produto indisponivel: ${item.productId}` });
      return true;
    }

    checkoutItems.push({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      quantity: item.quantity,
      subtotal: Number(product.price) * item.quantity
    });
  }

  const subtotal = moneyValue(checkoutItems.reduce((sum, item) => sum + item.subtotal, 0));
  const pixDiscountRate = Math.max(0, Math.min(0.8, PIX_DISCOUNT_RATE));
  const pixDiscount = moneyValue(subtotal * pixDiscountRate);
  const total = moneyValue(subtotal - pixDiscount);
  const itemSummary = checkoutItems.map((item) => `${item.quantity}x ${item.name}`).join(", ");
  const addressSummary = `${address.street}, ${address.number} - ${address.neighborhood || "Bairro nao informado"} - ${address.city}/${address.uf} - CEP ${address.cep}`;
  const transactionId = `jana-${Date.now()}-${checkoutItems.length}itens`.replace(/[^a-zA-Z0-9-]/g, "-");
  const metrics = ensureMetrics(data);
  metrics.pixInitiated += 1;
  await writeCms(data);

  const payment = await createMisticPayPixTransaction({
    amount: total,
    payerName: buyerName,
    payerDocument: String(body.payerDocument ?? DEFAULT_PAYER_DOCUMENT).replace(/\D/g, ""),
    transactionId,
    description: `${itemSummary} | Comprador: ${buyerName} | Endereco: ${addressSummary}`
  });

  metrics.pixCompleted += 1;
  metrics.orderCount += 1;
  metrics.totalSales = moneyValue(metrics.totalSales + total);
  metrics.pixRevenue = moneyValue(metrics.pixRevenue + total);
  metrics.pixDiscounts = moneyValue(metrics.pixDiscounts + pixDiscount);
  ensureOrders(data).unshift({
    id: transactionId,
    items: checkoutItems.map((item) => ({
      name: item.name,
      quantity: item.quantity
    })),
    total,
    paymentMethod: "pix",
    status: "Pix gerado",
    buyerName,
    createdAt: nowIso()
  });
  data.orders = data.orders.slice(0, 50);
  await writeCms(data);

  sendJson(response, 201, {
    transactionId,
    items: checkoutItems,
    subtotal,
    pixDiscountRate,
    pixDiscount,
    total,
    buyer: {
      name: buyerName,
      ...address
    },
    payment
  });
  return true;
}

export async function handleApiRequest(request, response) {
  const host = request.headers.host ?? "localhost";
  const requestUrl = new URL(request.url ?? "/", `http://${host}`);

  try {
    if (await handleCatalogApi(request, response, requestUrl)) {
      return;
    }

    if (await handleAdminApi(request, response, requestUrl)) {
      return;
    }

    if (await handleCheckoutApi(request, response, requestUrl)) {
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/health") {
      sendJson(response, 200, { status: "ok", service: "jana-cosmeticos" });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/api/misticpay/balance") {
      const balance = await getMisticPayBalance();
      sendJson(response, 200, balance);
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Metodo nao permitido." });
      return;
    }

    const body = await readJsonBody(request);

    if (requestUrl.pathname === "/api/misticpay/pix") {
      const payment = await createMisticPayPixTransaction(body);
      sendJson(response, 201, payment);
      return;
    }

    if (requestUrl.pathname === "/api/misticpay/check") {
      const paymentStatus = await checkMisticPayTransaction(body.transactionId);
      sendJson(response, 200, paymentStatus);
      return;
    }

    sendJson(response, 404, { error: "Endpoint nao encontrado." });
  } catch (error) {
    const statusCode = error.status ?? 500;
    sendJson(response, statusCode, {
      error: error.message,
      provider: error.provider,
      details: error.responseBody
    });
  }
}

export default handleApiRequest;
