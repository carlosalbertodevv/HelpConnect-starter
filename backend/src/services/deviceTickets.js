import crypto from "node:crypto";

const tickets = new Map();
const maxTickets = 10_000;

function digest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function issueDeviceTicket(sessionId, ttlSeconds) {
  const now = Date.now();
  for (const [hash, entry] of tickets) {
    if (entry.expiresAt <= now || entry.sessionId === sessionId) tickets.delete(hash);
  }
  if (tickets.size >= maxTickets) throw new Error("Device ticket capacity reached.");

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + ttlSeconds * 1000;
  tickets.set(digest(token), { sessionId, expiresAt });
  return { token, expiresAt: new Date(expiresAt) };
}

export function consumeDeviceTicket(token) {
  const hash = digest(token);
  const ticket = tickets.get(hash);
  if (!ticket) return null;
  tickets.delete(hash);
  if (ticket.expiresAt <= Date.now()) return null;
  return { sessionId: ticket.sessionId };
}

export function revokeDeviceTickets(sessionId) {
  let revoked = 0;
  for (const [hash, entry] of tickets) {
    if (entry.sessionId === sessionId) {
      tickets.delete(hash);
      revoked += 1;
    }
  }
  return revoked;
}

export function getDeviceTicketSessionId(token, now = Date.now()) {
  const ticket = tickets.get(digest(token));
  if (!ticket || ticket.expiresAt <= now) return null;
  return ticket.sessionId;
}
