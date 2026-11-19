import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashToken } from "../utils/tokens.js";
import { resolveDeviceTicketSession } from "../services/deviceTicketSessions.js";
import { terminateSessionConnections } from "../websocket/sessionRegistry.js";

const router = Router();
const tokenSchema = z.string().min(30).max(100);
const lookupSchema = z.object({ token: tokenSchema }).strict();
const deviceSessionSchema = z.object({
  publicCode: z.string().regex(/^HC-[A-F0-9]{12}$/),
  deviceToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/)
}).strict();
const consentSchema = z.object({
  token: tokenSchema,
  accepted: z.literal(true)
}).strict();
const activeStatuses = ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"];

router.post("/device-session", async (req, res, next) => {
  try {
    const parsed = deviceSessionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Código ou credencial inválida." });

    const session = await resolveDeviceTicketSession(
      prisma,
      parsed.data.publicCode,
      parsed.data.deviceToken
    );
    if (!session) return res.status(404).json({ error: "Sessão ou credencial indisponível." });
    res.json(session);
  } catch (error) {
    next(error);
  }
});

async function findValidSession(rawToken) {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) return null;
  const session = await prisma.remoteSession.findUnique({
    where: { accessTokenHash: hashToken(parsed.data) }
  });
  if (!session || !activeStatuses.includes(session.status)) return null;
  if (session.expiresAt <= new Date()) {
    const now = new Date();
    let expired = false;
    await prisma.$transaction(async (tx) => {
      const result = await tx.remoteSession.updateMany({
        where: { id: session.id, status: { in: activeStatuses }, expiresAt: { lte: now } },
        data: { status: "EXPIRED", endedAt: now }
      });
      if (result.count) {
        expired = true;
        await tx.sessionLog.create({
          data: { sessionId: session.id, event: "SESSION_EXPIRED" }
        });
      }
    });
    if (expired) terminateSessionConnections(session.id, "expired");
    return null;
  }
  return session;
}

router.post("/lookup", async (req, res, next) => {
  try {
    const parsed = lookupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Link inválido." });
    const session = await findValidSession(parsed.data.token);
    if (!session) return res.status(404).json({ error: "Link inválido, expirado ou encerrado." });
    res.json({
      session: {
        publicCode: session.publicCode,
        clientName: session.clientName,
        status: session.status,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post("/consent", async (req, res, next) => {
  try {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "É necessário aceitar o consentimento." });
    const session = await findValidSession(parsed.data.token);
    if (!session || session.status !== "PENDING") {
      return res.status(404).json({ error: "Sessão indisponível." });
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.remoteSession.updateMany({
        where: {
          id: session.id,
          status: "PENDING",
          expiresAt: { gt: now }
        },
        data: {
          status: "CONSENTED",
          consentedAt: now
        }
      });
      if (!result.count) return false;
      await tx.sessionPermission.create({
        data: {
          sessionId: session.id,
          permission: "SUPPORT_SESSION",
          granted: true,
          grantedAt: now
        }
      });
      await tx.sessionLog.create({
        data: { sessionId: session.id, event: "SUPPORT_CONSENT_GRANTED" }
      });
      return true;
    });
    if (!updated) return res.status(404).json({ error: "Sessão indisponível." });
    res.json({
      ok: true,
      message: "Consentimento registrado. O compartilhamento de tela só poderá começar no aplicativo Android, após as permissões do sistema."
    });
  } catch (error) {
    next(error);
  }
});

router.post("/reject", async (req, res, next) => {
  try {
    const parsed = lookupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Link inválido." });
    const session = await findValidSession(parsed.data.token);
    if (!session || session.status !== "PENDING") {
      return res.status(404).json({ error: "Sessão indisponível." });
    }

    const now = new Date();
    const rejected = await prisma.$transaction(async (tx) => {
      const result = await tx.remoteSession.updateMany({
        where: {
          id: session.id,
          status: "PENDING",
          expiresAt: { gt: now }
        },
        data: { status: "REJECTED", endedAt: now }
      });
      if (!result.count) return false;
      await tx.sessionPermission.create({
        data: {
          sessionId: session.id,
          permission: "SUPPORT_SESSION",
          granted: false
        }
      });
      await tx.sessionLog.create({
        data: { sessionId: session.id, event: "SUPPORT_CONSENT_REJECTED" }
      });
      return true;
    });
    if (!rejected) return res.status(404).json({ error: "Sessão indisponível." });
    res.json({ ok: true, message: "Atendimento recusado. Nenhum compartilhamento foi iniciado." });
  } catch (error) {
    next(error);
  }
});

router.post("/revoke", async (req, res, next) => {
  try {
    const parsed = lookupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Link inválido." });
    const session = await findValidSession(parsed.data.token);
    if (!session || !["CONSENTED", "CONNECTING", "ACTIVE"].includes(session.status)) {
      return res.status(404).json({ error: "Sessão indisponível para revogação." });
    }

    const now = new Date();
    const revoked = await prisma.$transaction(async (tx) => {
      const result = await tx.remoteSession.updateMany({
        where: {
          id: session.id,
          status: { in: ["CONSENTED", "CONNECTING", "ACTIVE"] },
          expiresAt: { gt: now }
        },
        data: { status: "ENDED", endedAt: now }
      });
      if (!result.count) return false;
      await tx.sessionPermission.create({
        data: {
          sessionId: session.id,
          permission: "SUPPORT_SESSION",
          granted: false
        }
      });
      await tx.sessionLog.create({
        data: { sessionId: session.id, event: "SUPPORT_CONSENT_REVOKED" }
      });
      return true;
    });
    if (!revoked) return res.status(404).json({ error: "Sessão indisponível para revogação." });
    terminateSessionConnections(session.id, "consent_revoked");
    res.json({ ok: true, message: "Consentimento revogado. A comunicação foi encerrada." });
  } catch (error) {
    next(error);
  }
});

export default router;
