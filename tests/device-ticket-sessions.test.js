import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { consumeDeviceTicket, issueDeviceTicket, revokeDeviceTickets } from "../backend/src/services/deviceTickets.js";
import { findDeviceSessions, isValidEntryKeyword } from "../backend/src/services/deviceSessions.js";

test("a paired device only searches active sessions of its own client", async () => {
  let query;
  const expected = [{ id: randomUUID(), clientId: "client-a", deviceId: "device-a" }];
  const prisma = {
    remoteSession: {
      findMany: async (value) => {
        query = value;
        return expected;
      }
    }
  };
  const now = new Date();
  const result = await findDeviceSessions(prisma, "client-a", "device-a", now);

  assert.deepEqual(result, expected);
  assert.equal(query.where.clientId, "client-a");
  assert.deepEqual(query.where.OR, [{ deviceId: null }, { deviceId: "device-a" }]);
  assert.deepEqual(query.where.status.in, ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"]);
  assert.equal(query.where.expiresAt.gt, now);
  assert.equal(query.take, 2);
});

test("validates the entry keyword but does not use it as session identity", () => {
  assert.equal(isValidEntryKeyword("EUQUERO"), true);
  assert.equal(isValidEntryKeyword("  euquero  "), true);
  assert.equal(isValidEntryKeyword("EUQUERO-OUTRA"), false);
  assert.equal(isValidEntryKeyword(""), false);
});

test("revoking a session invalidates pending tickets and prevents replay", () => {
  const sessionId = randomUUID();
  const ticket = issueDeviceTicket(sessionId, 120);

  assert.deepEqual(revokeDeviceTickets(sessionId), 1);
  assert.equal(consumeDeviceTicket(ticket.token), null);
});
