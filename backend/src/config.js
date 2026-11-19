import "dotenv/config";

const required = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_ANON_KEY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const isProduction = process.env.NODE_ENV === "production";
let supabaseUrl;
try {
  supabaseUrl = new URL(process.env.SUPABASE_URL);
  if (!["http:", "https:"].includes(supabaseUrl.protocol)) {
    throw new TypeError("Only HTTP(S) URLs are supported.");
  }
} catch (error) {
  throw new Error("SUPABASE_URL must be a valid absolute HTTP(S) URL.", { cause: error });
}
if (isProduction && supabaseUrl.protocol !== "https:") {
  throw new Error("SUPABASE_URL must use HTTPS in production.");
}

const configuredOrigin = process.env.APP_ORIGIN || "http://localhost:5500";
const configuredPublicUrl = process.env.PUBLIC_APP_URL || "http://localhost:5500";
let appOrigin;
let publicAppUrl;
try {
  const originUrl = new URL(configuredOrigin);
  const publicUrl = new URL(configuredPublicUrl);
  if (!["http:", "https:"].includes(originUrl.protocol) || !["http:", "https:"].includes(publicUrl.protocol)) {
    throw new TypeError("Only HTTP(S) URLs are supported.");
  }
  appOrigin = originUrl.origin;
  publicAppUrl = publicUrl.toString().replace(/\/$/, "");
} catch (error) {
  throw new Error("APP_ORIGIN and PUBLIC_APP_URL must be valid absolute HTTP(S) URLs.", { cause: error });
}
if (isProduction && (!appOrigin.startsWith("https://") || !publicAppUrl.startsWith("https://"))) {
  throw new Error("APP_ORIGIN and PUBLIC_APP_URL must use HTTPS in production.");
}

const sessionTtlMinutes = Number(process.env.SESSION_TTL_MINUTES || 30);
if (!Number.isFinite(sessionTtlMinutes)) throw new Error("SESSION_TTL_MINUTES must be a number.");

function parseIceUrls(name, value) {
  const urls = value.split(",").map((url) => url.trim()).filter(Boolean);
  for (const url of urls) {
    if (!/^(stun|stuns|turn|turns):[^\s]+$/i.test(url)) {
      throw new Error(`${name} contains an invalid ICE URL.`);
    }
  }
  return urls;
}

const stunUrls = parseIceUrls("STUN_URLS", process.env.STUN_URLS || "stun:stun.l.google.com:19302");
const turnUrls = parseIceUrls("TURN_URLS", process.env.TURN_URLS || "");
const turnSecret = process.env.TURN_SECRET || "";
const turnCredentialTtlSeconds = Number(process.env.TURN_CREDENTIAL_TTL_SECONDS || 3600);
const deviceTicketTtlSeconds = Number(process.env.DEVICE_TICKET_TTL_SECONDS || 120);
if (turnUrls.length && turnSecret.length < 32) {
  throw new Error("TURN_SECRET must contain at least 32 characters when TURN_URLS is configured.");
}
if (!Number.isInteger(turnCredentialTtlSeconds) || turnCredentialTtlSeconds < 60 || turnCredentialTtlSeconds > 86400) {
  throw new Error("TURN_CREDENTIAL_TTL_SECONDS must be an integer between 60 and 86400.");
}
if (!Number.isInteger(deviceTicketTtlSeconds) || deviceTicketTtlSeconds < 30 || deviceTicketTtlSeconds > 600) {
  throw new Error("DEVICE_TICKET_TTL_SECONDS must be an integer between 30 and 600.");
}

const trustProxySetting = process.env.TRUST_PROXY ?? (isProduction ? "1" : "false");
let trustProxy = false;
if (trustProxySetting !== "false") {
  const proxyHops = Number(trustProxySetting);
  if (!Number.isInteger(proxyHops) || proxyHops < 1) {
    throw new Error("TRUST_PROXY must be false or a positive trusted proxy hop count.");
  }
  trustProxy = proxyHops;
}

export const config = {
  port: Number(process.env.PORT || 3001),
  appOrigin,
  publicAppUrl,
  sessionTtlMinutes: Math.min(Math.max(sessionTtlMinutes, 5), 60),
  supabaseUrl: supabaseUrl.toString().replace(/\/$/, ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  requireHttps: isProduction,
  trustProxy,
  stunUrls,
  turnUrls,
  turnSecret,
  turnCredentialTtlSeconds,
  deviceTicketTtlSeconds
};
