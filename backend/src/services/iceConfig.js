import crypto from "node:crypto";

export function createIceServers(config, sessionId, now = Date.now()) {
  const iceServers = config.stunUrls.length
    ? [{ urls: config.stunUrls }]
    : [];
  let expiresAt = null;

  if (config.turnUrls.length) {
    const expires = Math.floor(now / 1000) + config.turnCredentialTtlSeconds;
    const username = `${expires}:${sessionId}`;
    const credential = crypto
      .createHmac("sha1", config.turnSecret)
      .update(username)
      .digest("base64");
    iceServers.push({ urls: config.turnUrls, username, credential });
    expiresAt = new Date(expires * 1000).toISOString();
  }

  return { iceServers, expiresAt };
}
