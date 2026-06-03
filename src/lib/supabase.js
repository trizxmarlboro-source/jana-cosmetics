import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

if (!env.supabase.url || !env.supabase.anonKey || !env.supabase.serviceKey) {
  console.warn("Supabase configuration is missing. Please check your .env file.");
}

// Client for backend tasks (bypasses RLS if needed, or has full access)
export const supabaseAdmin = createClient(
  env.supabase.url || "https://placeholder.supabase.co",
  env.supabase.serviceKey || "placeholder-key",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);
