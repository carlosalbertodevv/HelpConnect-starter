const activeSessionStatuses = ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"];

export function isValidEntryKeyword(keyword) {
  return typeof keyword === "string" && keyword.trim().toUpperCase() === "EUQUERO";
}

export async function findDeviceSessions(prisma, clientId, deviceId, now = new Date()) {
  return prisma.remoteSession.findMany({
    where: {
      clientId,
      OR: [{ deviceId: null }, { deviceId }],
      status: { in: activeSessionStatuses },
      expiresAt: { gt: now }
    },
    orderBy: { createdAt: "desc" },
    take: 2,
    select: {
      id: true,
      publicCode: true,
      clientId: true,
      clientName: true,
      deviceId: true,
      status: true,
      expiresAt: true
    }
  });
}
