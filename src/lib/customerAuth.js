import { supabaseAdmin } from "./supabase.js";

function bearerToken(request) {
  const header = String(request.headers.authorization ?? "");
  if (!header.toLowerCase().startsWith("bearer ")) {
    return "";
  }

  return header.slice(7).trim();
}

export async function getCustomerFromRequest(request) {
  const token = bearerToken(request);
  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }

  return data.user;
}
