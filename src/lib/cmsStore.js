import { supabaseAdmin } from "./supabase.js";
import { randomUUID } from "node:crypto";

export async function readCms() {
  const [cat, prod, set, ord, met] = await Promise.all([
    supabaseAdmin.from('categories').select('*'),
    supabaseAdmin.from('products').select('*'),
    supabaseAdmin.from('settings').select('*').eq('id', 1).maybeSingle(),
    supabaseAdmin.from('orders').select('*'),
    supabaseAdmin.from('metrics').select('*').eq('id', 1).maybeSingle()
  ]);

  return {
    categories: cat.data || [],
    products: prod.data || [],
    settings: set.data || {},
    orders: ord.data || [],
    metrics: met.data || { id: 1, totalSales: 0, orderCount: 0, pixInitiated: 0, pixCompleted: 0, pixRevenue: 0, pixDiscounts: 0 }
  };
}

export async function writeCms(data) {
  // Use Promise.all to write concurrently for speed
  const promises = [];
  if (data.categories?.length) promises.push(supabaseAdmin.from('categories').upsert(data.categories, { onConflict: 'id' }));
  if (data.products?.length) promises.push(supabaseAdmin.from('products').upsert(data.products, { onConflict: 'id' }));
  if (data.settings) promises.push(supabaseAdmin.from('settings').upsert({ id: 1, ...data.settings }, { onConflict: 'id' }));
  if (data.orders?.length) promises.push(supabaseAdmin.from('orders').upsert(data.orders, { onConflict: 'id' }));
  if (data.metrics) promises.push(supabaseAdmin.from('metrics').upsert({ id: 1, ...data.metrics }, { onConflict: 'id' }));
  
  await Promise.all(promises);
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
