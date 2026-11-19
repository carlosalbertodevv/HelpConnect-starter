const permittedStatuses = ["CONSENTED", "CONNECTING", "ACTIVE"];

export async function findAuthorizedSession(prisma, sessionId, operatorId, { allowExpired = false } = {}) {
  const session = await prisma.remoteSession.findUnique({
    where: { id: sessionId },
    include: {
      permissions: {
        where: { permission: "SUPPORT_SESSION" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { granted: true }
      }
    }
  });
  if (!session) return null;
  if (operatorId && session.operatorId !== operatorId) return null;
  if (!permittedStatuses.includes(session.status)) return null;
  if (!allowExpired && session.expiresAt <= new Date()) return null;
  if (!session.permissions[0]?.granted) return null;
  return session;
}
