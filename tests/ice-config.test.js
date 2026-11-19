import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createIceServers } from "../backend/src/services/iceConfig.js";

test("ICE configuration uses temporary Coturn REST credentials", () => {
  const sessionId = "support-session";
  const now = 1_800_000_000_000;
  const config = {
    stunUrls: ["stun:stun.example.test:3478"],
    turnUrls: ["turn:turn.example.test:3478?transport=udp"],
    turnSecret: "a-secure-shared-secret-that-is-long-enough",
    turnCredentialTtlSeconds: 300
  };

  const result = createIceServers(config, sessionId, now);
  const username = `${Math.floor(now / 1000) + 300}:${sessionId}`;
  const credential = createHmac("sha1", config.turnSecret).update(username).digest("base64");
  assert.deepEqual(result.iceServers[0], { urls: config.stunUrls });
  assert.deepEqual(result.iceServers[1], {
    urls: config.turnUrls,
    username,
    credential
  });
  assert.equal(result.expiresAt, new Date((Math.floor(now / 1000) + 300) * 1000).toISOString());
});

test("TURN is optional while configured STUN remains available", () => {
  const result = createIceServers({
    stunUrls: ["stun:stun.example.test:3478"],
    turnUrls: [],
    turnSecret: "",
    turnCredentialTtlSeconds: 3600
  }, "support-session");

  assert.deepEqual(result, {
    iceServers: [{ urls: ["stun:stun.example.test:3478"] }],
    expiresAt: null
  });
});
