import "dotenv/config";

const required = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

export const config = {
  port: Number(process.env.PORT || 3001),
  appOrigin: process.env.APP_ORIGIN || "http://localhost:5500",
  publicAppUrl: process.env.PUBLIC_APP_URL || "http://localhost:5500",
  sessionTtlMinutes: Math.min(Math.max(Number(process.env.SESSION_TTL_MINUTES || 30), 5), 60),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY
};
