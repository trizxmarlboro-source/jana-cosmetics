import { env } from "../config/env.js";
import { supabaseAdmin } from "./supabase.js";
import { createOrderTrackToken } from "./orderUtils.js";

function normalizeWhatsapp(number) {
  return String(number ?? "").replace(/\D/g, "");
}

function orderConfirmationUrl(order) {
  const base = String(env.app.publicBaseUrl || "http://localhost:3000").replace(/\/+$/, "");
  const token = createOrderTrackToken(order.id, order.buyerEmail);
  return `${base}/pedido-confirmado.html?id=${encodeURIComponent(order.id)}&token=${encodeURIComponent(token)}`;
}

function whatsappUrl(order) {
  const phone = normalizeWhatsapp(env.store.whatsappNumber);
  if (!phone) {
    return "";
  }

  const message = encodeURIComponent(
    `Oi! Meu pagamento foi confirmado. Pedido ${order.id}. Quero acompanhar minha compra na Jana Cosmeticos.`
  );
  return `https://wa.me/${phone}?text=${message}`;
}

async function notificationSent(orderId) {
  const { data, error } = await supabaseAdmin
    .from("order_notifications")
    .select("orderId")
    .eq("orderId", orderId)
    .maybeSingle();

  if (error) {
    if (error.message?.toLowerCase().includes("relation") || error.code === "42P01") {
      return { missingTable: true, sent: false };
    }

    throw error;
  }

  return { missingTable: false, sent: Boolean(data?.orderId) };
}

async function markNotificationSent(orderId, buyerEmail) {
  const { error } = await supabaseAdmin
    .from("order_notifications")
    .upsert({
      orderId,
      buyerEmail,
      provider: "resend",
      status: "sent",
      sentAt: new Date().toISOString()
    }, { onConflict: "orderId" });

  if (error) {
    throw error;
  }
}

function orderItemsHtml(order) {
  return (Array.isArray(order.items) ? order.items : [])
    .map((item) => `<li style="margin-bottom:6px">${Number(item.quantity || 1)}x ${item.name}</li>`)
    .join("");
}

export async function sendConfirmedOrderEmail(order) {
  if (!order?.buyerEmail || !env.resend.apiKey || !env.resend.fromEmail) {
    return { sent: false, skipped: true, reason: "missing-config" };
  }

  const notification = await notificationSent(order.id);
  if (notification.missingTable) {
    return { sent: false, skipped: true, reason: "missing-order-notifications-table" };
  }

  if (notification.sent) {
    return { sent: false, skipped: true, reason: "already-sent" };
  }

  const confirmationUrl = orderConfirmationUrl(order);
  const waUrl = whatsappUrl(order);
  const itemsHtml = orderItemsHtml(order);
  const html = `
    <div style="font-family:Arial,sans-serif;background:#fff7fb;padding:24px;color:#2f2430">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #f0dce8;border-radius:24px;padding:32px">
        <p style="margin:0 0 8px;color:#e21b70;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Jana Cosmeticos</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15">Seu pagamento foi confirmado</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6">Seu pagamento foi confirmado, seu pedido <strong>${order.id}</strong>. Para saber mais sobre seu produto e acompanhar o pedido, chame a gente no WhatsApp.</p>
        <div style="background:#fff7fb;border:1px solid #f3d7e7;border-radius:18px;padding:18px;margin:20px 0">
          <p style="margin:0 0 10px;font-weight:700">Itens do pedido</p>
          <ul style="padding-left:18px;margin:0">${itemsHtml}</ul>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px">
          <a href="${confirmationUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#e21b70;color:#fff;text-decoration:none;font-weight:700">Ver meu pedido</a>
          ${waUrl ? `<a href="${waUrl}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#22c55e;color:#fff;text-decoration:none;font-weight:700">Chamar no WhatsApp</a>` : ""}
        </div>
      </div>
    </div>
  `;

  const text = `Seu pagamento foi confirmado, seu pedido ${order.id}. Para saber mais sobre seu produto e acompanhar o pedido, chame a gente no WhatsApp: ${waUrl || "configure o WhatsApp da loja"}. Acompanhe aqui: ${confirmationUrl}`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resend.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.resend.fromEmail,
      to: [order.buyerEmail],
      subject: `Pagamento confirmado - Pedido ${order.id}`,
      html,
      text
    })
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`Falha ao enviar email transacional: ${body}`);
    error.status = 502;
    throw error;
  }

  await markNotificationSent(order.id, order.buyerEmail);
  return { sent: true };
}
