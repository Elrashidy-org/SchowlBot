import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export const supabase = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    db: {
      schema: "public",
    },
  },
);

export async function assertSupabaseHealthy() {
  const { error } = await supabase.from("courses").select("id").limit(1);
  if (error) {
    throw error;
  }
}
