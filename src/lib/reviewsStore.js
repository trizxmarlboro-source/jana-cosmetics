import { supabaseAdmin } from "./supabase.js";

function isMissingTable(error) {
  return Boolean(error?.code === "42P01" || error?.message?.toLowerCase().includes("relation"));
}

export async function loadReviewsByEmail(email) {
  const { data, error } = await supabaseAdmin
    .from("customer_reviews")
    .select("*")
    .eq("buyerEmail", email)
    .order("createdAt", { ascending: false });

  if (error) {
    if (isMissingTable(error)) {
      return { reviews: [], enabled: false };
    }

    throw error;
  }

  return { reviews: data || [], enabled: true };
}

export async function upsertReview(review) {
  const payload = {
    orderId: review.orderId,
    productId: review.productId,
    buyerEmail: review.buyerEmail,
    buyerName: review.buyerName,
    rating: review.rating,
    comment: review.comment,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt
  };

  const { data, error } = await supabaseAdmin
    .from("customer_reviews")
    .upsert(payload, { onConflict: "orderId,productId,buyerEmail" })
    .select("*")
    .single();

  if (error) {
    if (isMissingTable(error)) {
      const missing = new Error("Tabela customer_reviews ausente. Rode o SQL de migracao no Supabase.");
      missing.status = 503;
      throw missing;
    }

    throw error;
  }

  return data;
}
