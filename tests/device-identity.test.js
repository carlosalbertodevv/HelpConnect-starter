import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createDeviceChallenge, deviceProofPayload, verifyDeviceProof } from "../backend/src/services/deviceIdentity.js";

test("device proof requires a fresh signature from a P-256 device key", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const challenge = createDeviceChallenge();
  const keyword = "EUQUERO";
  const payload = deviceProofPayload(challenge, keyword);
  const proof = {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    challenge,
    keyword,
    signature: crypto.sign("sha256", Buffer.from(payload), privateKey).toString("base64url")
  };

  assert.equal(verifyDeviceProof(proof), true);
  assert.equal(verifyDeviceProof(proof), false);
});

test("device proof rejects a different keyword and an expired challenge", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const challenge = createDeviceChallenge();
  const proof = {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    challenge,
    keyword: "EUQUERO",
    signature: crypto.sign(
      "sha256",
      Buffer.from(deviceProofPayload(challenge, "EUQUERO")),
      privateKey
    ).toString("base64url")
  };

  assert.equal(verifyDeviceProof({ ...proof, keyword: "OUTRA" }), false);
  const expiredChallenge = createDeviceChallenge();
  assert.equal(verifyDeviceProof({ ...proof, challenge: expiredChallenge }, Date.now() + 61_000), false);
});

test("device consent proof is bound to the selected session", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const challenge = createDeviceChallenge();
  const sessionId = crypto.randomUUID();
  const proof = {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    challenge,
    keyword: "EUQUERO",
    sessionId,
    signature: crypto.sign(
      "sha256",
      Buffer.from(deviceProofPayload(challenge, "EUQUERO", sessionId)),
      privateKey
    ).toString("base64url")
  };

  assert.equal(verifyDeviceProof(proof), true);
  const secondChallenge = createDeviceChallenge();
  const secondProof = {
    ...proof,
    challenge: secondChallenge,
    signature: crypto.sign(
      "sha256",
      Buffer.from(deviceProofPayload(secondChallenge, "EUQUERO", sessionId)),
      privateKey
    ).toString("base64url")
  };
  assert.equal(verifyDeviceProof(secondProof), true);
  assert.equal(verifyDeviceProof({ ...secondProof, sessionId: crypto.randomUUID() }), false);
});
