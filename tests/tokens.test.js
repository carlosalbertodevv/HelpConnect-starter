import test from "node:test";
import assert from "node:assert/strict";
import { createRawToken, createSessionCode, hashToken } from "../backend/src/utils/tokens.js";

test("access tokens are high-entropy URL-safe values and only their hash is persisted", () => {
  const token = createRawToken();
  const digest = hashToken(token);

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(hashToken(token), digest);
  assert.notEqual(createRawToken(), token);
});

test("session identification codes use the public HelpConnect format", () => {
  assert.match(createSessionCode(), /^HC-[A-F0-9]{12}$/);
});
