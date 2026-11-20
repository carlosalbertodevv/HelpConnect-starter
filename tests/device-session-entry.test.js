import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import publicSessionRoutes from "../backend/src/routes/publicSessionRoutes.js";

test("the public device-session endpoint requires EUQUERO and a signed paired-device identity", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api/public/sessions", publicSessionRoutes);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/public/sessions/device-session`;

  const wrongKeyword = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keyword: "EUQUER",
      publicCode: "HC-ABCDEF012345",
      deviceToken: "A".repeat(43)
    })
  });
  assert.equal(wrongKeyword.status, 400);

  const keywordOnly = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyword: "EUQUERO" })
  });
  assert.equal(keywordOnly.status, 400);

  const { publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const invalidProof = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keyword: "EUQUERO",
      publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
      challenge: "C".repeat(43),
      signature: "A".repeat(90)
    })
  });
  assert.equal(invalidProof.status, 401);
});

test("the public device-consent endpoint requires an explicit accepted decision", async (t) => {
  const app = express();
  app.use(express.json());
  app.use("/api/public/sessions", publicSessionRoutes);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const response = await fetch(`http://127.0.0.1:${address.port}/api/public/sessions/device-consent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keyword: "EUQUERO",
      publicKey: "A".repeat(120),
      challenge: "C".repeat(43),
      signature: "A".repeat(90),
      sessionId: crypto.randomUUID(),
      accepted: false
    })
  });
  assert.equal(response.status, 400);
});
