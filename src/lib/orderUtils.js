import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

const ORDER_TRACK_SECRET = env.customer.sessionSecret || env.admin.sessionSecret || "jana-track-secret";

export function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function signPayload(payload) {
  return createHmac("sha256", ORDER_TRACK_SECRET).update(payload).digest("base64url");
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createOrderTrackToken(orderId, buyerEmail) {
  const payload = Buffer.from(JSON.stringify({
    orderId: String(orderId ?? "").trim(),
    email: normalizeEmail(buyerEmail)
  }), "utf8").toString("base64url");

  return `${payload}.${signPayload(payload)}`;
}

export function verifyOrderTrackToken(token, orderId, buyerEmail) {
  if (!token || typeof token !== "string") {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  if (!sameSecret(signature, signPayload(payload))) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return parsed.orderId === String(orderId ?? "").trim() && parsed.email === normalizeEmail(buyerEmail);
  } catch {
    return false;
  }
}

export function paidStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized.includes("confirmado") || normalized.includes("concluido") || normalized.includes("efetuada");
}

export function pendingStatus(status) {
  const normalized = String(status ?? "").toLowerCase();
  return !paidStatus(normalized) && (
    normalized.includes("gerado") ||
    normalized.includes("pendente") ||
    normalized.includes("aguardando")
  );
}

export function statusTone(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (paidStatus(normalized)) return "success";
  if (
    normalized.includes("problema") ||
    normalized.includes("falhou") ||
    normalized.includes("falha") ||
    normalized.includes("cancelado")
  ) {
    return "danger";
  }
  return "warning";
}

function walkForProviderState(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      (normalizedKey.includes("transactionstate") || normalizedKey === "status") &&
      typeof entry === "string" &&
      entry.trim()
    ) {
      return entry.trim();
    }

    if (entry && typeof entry === "object") {
      const found = walkForProviderState(entry);
      if (found) {
        return found;
      }
    }
  }

  return "";
}

export function orderStatusFromProviderResponse(providerPayload) {
  const state = walkForProviderState(providerPayload).toUpperCase();

  if (state === "COMPLETO") return "Pix confirmado";
  if (state === "PENDENTE") return "Pix pendente";
  if (state === "CANCELADO") return "Pix cancelado";
  if (state === "FALHA") return "Pix falhou";

  return "";
}

export function syncMetricsFromOrders(data) {
  const orders = Array.isArray(data.orders) ? data.orders : [];
  const pixOrders = orders.filter((order) => String(order.paymentMethod ?? "").toLowerCase() === "pix");
  const paidOrders = pixOrders.filter((order) => paidStatus(order.status));

  data.metrics = {
    id: Number(data.metrics?.id ?? 1) || 1,
    totalSales: Number(paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2)),
    orderCount: orders.length,
    pixInitiated: pixOrders.length,
    pixCompleted: paidOrders.length,
    pixRevenue: Number(paidOrders.reduce((sum, order) => sum + Number(order.total || 0), 0).toFixed(2)),
    pixDiscounts: Number(paidOrders.reduce((sum, order) => sum + Number(order.pixDiscount || 0), 0).toFixed(2))
  };

  return data.metrics;
}

export function serializeOrderForCustomer(order) {
  return {
    id: order.id,
    items: Array.isArray(order.items) ? order.items : [],
    subtotal: Number(order.subtotal || 0),
    pixDiscount: Number(order.pixDiscount || 0),
    total: Number(order.total || 0),
    paymentMethod: order.paymentMethod || "pix",
    status: order.status || "Pix gerado",
    statusTone: statusTone(order.status),
    buyerName: order.buyerName || "",
    buyerEmail: order.buyerEmail || "",
    buyerWhatsapp: order.buyerWhatsapp || "",
    address: order.address || {},
    createdAt: order.createdAt || "",
    trackToken: createOrderTrackToken(order.id, order.buyerEmail)
  };
}

export function summarizeCustomers(orders, authUsers = []) {
  const authUsersByEmail = new Map(
    authUsers
      .map((user) => [normalizeEmail(user.email), user])
      .filter(([email]) => email)
  );
  const buckets = new Map();

  for (const order of orders) {
    const email = normalizeEmail(order.buyerEmail);
    const key = email || String(order.buyerWhatsapp || order.id);
    if (!buckets.has(key)) {
      const authUser = authUsersByEmail.get(email);
      buckets.set(key, {
        user: order.buyerName || authUser?.user_metadata?.name || authUser?.email || "Lead sem nome",
        email: order.buyerEmail || authUser?.email || "",
        whatsapp: order.buyerWhatsapp || "",
        id: authUser?.id || `lead-${buckets.size + 1}`,
        valueSpent: 0,
        orders: []
      });
    }

    const bucket = buckets.get(key);
    bucket.valueSpent += paidStatus(order.status) ? Number(order.total || 0) : 0;
    bucket.orders.push({
      id: order.id,
      status: order.status || "Pix gerado",
      total: Number(order.total || 0),
      items: Array.isArray(order.items) ? order.items : [],
      address: order.address || {},
      createdAt: order.createdAt || ""
    });
  }

  for (const user of authUsers) {
    const email = normalizeEmail(user.email);
    if (!email || authUsersByEmail.has(email) === false) {
      continue;
    }

    if (!Array.from(buckets.values()).some((entry) => normalizeEmail(entry.email) === email)) {
      buckets.set(`auth-${user.id}`, {
        user: user.user_metadata?.name || user.user_metadata?.full_name || user.email || "Usuario cadastrado",
        email: user.email || "",
        whatsapp: user.phone || "",
        id: user.id,
        valueSpent: 0,
        orders: []
      });
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => b.valueSpent - a.valueSpent)
    .map((customer) => ({
      ...customer,
      valueSpent: Number(customer.valueSpent.toFixed(2))
    }));
}
