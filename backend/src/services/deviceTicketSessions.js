import { getDeviceTicketSessionId } from "./deviceTickets.js";
import { findAuthorizedSession } from "./sessionAccess.js";

const sessionCodePattern = /^HC-[A-F0-9]{12}$/;
const deviceTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export async function resolveDeviceTicketSession(prisma, publicCode, deviceToken, now = Date.now()) {
  if (!sessionCodePattern.test(publicCode) || !deviceTokenPattern.test(deviceToken)) return null;

  const sessionId = getDeviceTicketSessionId(deviceToken, now);
  if (!sessionId) return null;

  const session = await findAuthorizedSession(prisma, sessionId);
  if (!session || session.publicCode !== publicCode) return null;
  return { sessionId: session.id, expiresAt: session.expiresAt };
}
