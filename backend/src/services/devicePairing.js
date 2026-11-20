import { createPairingCode } from "./deviceIdentity.js";
import { hashToken } from "../utils/tokens.js";

const pairingTtlMs = 10 * 60_000;

export async function createOrRefreshPairingRequest(prisma, publicKey, now = Date.now()) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await prisma.device.findUnique({
      where: { publicKey },
      select: {
        id: true,
        clientId: true,
        pairedAt: true,
        isActive: true
      }
    });
    if (existing && !existing.isActive) {
      return { status: "revoked", device: existing };
    }
    if (existing?.clientId && existing.pairedAt) {
      return { status: existing.isActive ? "paired" : "revoked", device: existing };
    }

    const pairingCode = createPairingCode();
    const pairingCodeHash = hashToken(pairingCode);
    const pairingExpiresAt = new Date(now + pairingTtlMs);
    if (existing) {
      const updated = await prisma.device.updateMany({
        where: {
          id: existing.id,
          clientId: null,
          pairedAt: null,
          isActive: true
        },
        data: { pairingCodeHash, pairingExpiresAt }
      });
      if (updated.count) return { status: "pending", pairingCode, expiresAt: pairingExpiresAt };
      continue;
    }

    try {
      await prisma.device.create({
        data: { publicKey, pairingCodeHash, pairingExpiresAt }
      });
      return { status: "pending", pairingCode, expiresAt: pairingExpiresAt };
    } catch (error) {
      if (error?.code === "P2002") continue;
      throw error;
    }
  }
  throw new Error("Could not create device pairing request.");
}
