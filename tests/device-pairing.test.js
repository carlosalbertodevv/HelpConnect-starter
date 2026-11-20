import test from "node:test";
import assert from "node:assert/strict";
import { createOrRefreshPairingRequest } from "../backend/src/services/devicePairing.js";

test("unpaired devices receive short-lived one-time codes while only the code hash is stored", async () => {
  const devices = new Map();
  const prisma = {
    device: {
      findUnique: async ({ where }) => devices.get(where.publicKey) ?? null,
      create: async ({ data }) => {
        const device = { id: "device-1", ...data, clientId: null, pairedAt: null, isActive: true };
        devices.set(data.publicKey, device);
        return device;
      },
      updateMany: async ({ where, data }) => {
        const device = [...devices.values()].find((item) => item.id === where.id);
        if (!device || device.clientId || device.pairedAt || !device.isActive) return { count: 0 };
        Object.assign(device, data);
        return { count: 1 };
      }
    }
  };

  const first = await createOrRefreshPairingRequest(prisma, "encoded-public-key", 1_000);
  const stored = devices.get("encoded-public-key");
  assert.equal(first.status, "pending");
  assert.match(first.pairingCode, /^[A-F0-9]{8}$/);
  assert.notEqual(stored.pairingCodeHash, first.pairingCode);
  assert.equal(stored.pairingExpiresAt.getTime(), 601_000);

  const second = await createOrRefreshPairingRequest(prisma, "encoded-public-key", 2_000);
  assert.notEqual(second.pairingCode, first.pairingCode);
  assert.equal(stored.pairingExpiresAt.getTime(), 602_000);
});
