import crypto from "node:crypto";

export function createRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function createSessionCode() {
  return `HC-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
