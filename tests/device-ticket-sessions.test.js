import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { issueDeviceTicket } from "../backend/src/services/deviceTickets.js";
import { resolveDeviceTicketSession } from "../backend/src/services/deviceTicketSessions.js";

function createPrisma(session) {
  return {
    remoteSession: {
      findUnique: async ({ where }) => where.id === session.id ? {
        ...session,
        permissions: [{ granted: session.granted }]
      } : null
    }
  };
}

test("resolves a valid ticket only for its matching active, consented session", async () => {
  const session = {
    id: randomUUID(),
    publicCode: "HC-ABCDEF012345",
    status: "CONSENTED",
    expiresAt: new Date(Date.now() + 60_000),
    granted: true
  };
  const ticket = issueDeviceTicket(session.id, 120);

  const result = await resolveDeviceTicketSession(
    createPrisma(session),
    session.publicCode,
    ticket.token
  );

  assert.deepEqual(result, { sessionId: session.id, expiresAt: session.expiresAt });
  assert.equal(await resolveDeviceTicketSession(createPrisma(session), "HC-000000000000", ticket.token), null);
  assert.deepEqual(
    await resolveDeviceTicketSession(createPrisma(session), session.publicCode, ticket.token),
    { sessionId: session.id, expiresAt: session.expiresAt }
  );
});

test("does not resolve expired, unconsented, or invalid tickets", async () => {
  const session = {
    id: randomUUID(),
    publicCode: "HC-ABCDEF012345",
    status: "CONSENTED",
    expiresAt: new Date(Date.now() + 60_000),
    granted: true
  };
  const ticket = issueDeviceTicket(session.id, 30);

  assert.equal(
    await resolveDeviceTicketSession(createPrisma(session), session.publicCode, ticket.token, Date.now() + 31_000),
    null
  );
  assert.equal(
    await resolveDeviceTicketSession(
      createPrisma({ ...session, granted: false }),
      session.publicCode,
      ticket.token
    ),
    null
  );
  assert.equal(
    await resolveDeviceTicketSession(createPrisma(session), session.publicCode, "not-a-ticket"),
    null
  );
});
