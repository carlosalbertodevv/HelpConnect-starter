import crypto from "node:crypto";

const challenges = new Map();
const challengeTtlMs = 60_000;
const maxChallenges = 10_000;

function signaturePayload(challenge, keyword, sessionId) {
  const sessionContext = sessionId ? `:SESSION:${sessionId.toLowerCase()}` : "";
  const consentContext = sessionId ? ":CONSENT:ACCEPTED" : "";
  return `HELPCONNECT:DEVICE_SESSION:${challenge}:${keyword.trim().toUpperCase()}${sessionContext}${consentContext}`;
}

export function createDeviceChallenge(now = Date.now()) {
  for (const [challenge, expiresAt] of challenges) {
    if (expiresAt <= now) challenges.delete(challenge);
  }
  if (challenges.size >= maxChallenges) throw new Error("Device challenge capacity reached.");

  const challenge = crypto.randomBytes(32).toString("base64url");
  challenges.set(challenge, now + challengeTtlMs);
  return challenge;
}

export function verifyDeviceProof({ publicKey, challenge, keyword, signature, sessionId }, now = Date.now()) {
  const expiresAt = challenges.get(challenge);
  challenges.delete(challenge);
  if (!expiresAt || expiresAt <= now) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(signature)) return false;

  let key;
  try {
    const encodedKey = Buffer.from(publicKey, "base64");
    if (encodedKey.length < 64 || encodedKey.length > 256 || encodedKey.toString("base64") !== publicKey) {
      return false;
    }
    key = crypto.createPublicKey({ key: encodedKey, format: "der", type: "spki" });
  } catch {
    return false;
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    return false;
  }

  const signatureBytes = Buffer.from(signature, "base64url");
  if (signatureBytes.length < 64 || signatureBytes.length > 80 ||
      signatureBytes.toString("base64url") !== signature) {
    return false;
  }
  try {
    return crypto.verify(
      "sha256",
      Buffer.from(signaturePayload(challenge, keyword, sessionId)),
      key,
      signatureBytes
    );
  } catch {
    return false;
  }
}

export function createPairingCode() {
  return crypto.randomBytes(4).toString("hex").toUpperCase();
}

export function deviceProofPayload(challenge, keyword, sessionId) {
  return signaturePayload(challenge, keyword, sessionId);
}
