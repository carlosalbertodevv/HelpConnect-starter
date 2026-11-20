import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { createSessionCode, hashToken } from "../utils/tokens.js";
import { isValidEntryKeyword, findDeviceSessions } from "../services/deviceSessions.js";
import { createOrRefreshPairingRequest } from "../services/devicePairing.js";
import { createDeviceChallenge, verifyDeviceProof } from "../services/deviceIdentity.js";
import { issueDeviceTicket, revokeDeviceTickets } from "../services/deviceTickets.js";
import { findAuthorizedSession } from "../services/sessionAccess.js";
import { terminateSessionConnections } from "../websocket/sessionRegistry.js";

const router = Router();
const tokenSchema = z.string().min(30).max(100);
const lookupSchema = z.object({ token: tokenSchema }).strict();
const deviceProofSchema = z.object({
  keyword: z.string().refine(isValidEntryKeyword),
  publicKey: z.string().min(100).max(400),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  signature: z.string().regex(/^[A-Za-z0-9_-]{80,120}$/)
}).strict();
const deviceConsentSchema = deviceProofSchema.extend({
  sessionId: z.uuid(),
  accepted: z.literal(true)
}).strict();
const consentSchema = z.object({
  token: tokenSchema,
  accepted: z.literal(true)
}).strict();
const activeStatuses = ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"];

router.post("/device-challenge", (_req, res, next) => {
  try {
    res.json({ challenge: createDeviceChallenge() });
  } catch (error) {
    next(error);
  }
});

async function authenticateDevice(res, parsed) {
  if (!verifyDeviceProof(parsed, Date.now())) {
    res.status(401).json({ error: "Autenticação do aparelho inválida ou expirada." });
    return null;
  }
  const result = await createOrRefreshPairingRequest(prisma, parsed.publicKey);
  if (result.status === "pending") {
    res.status(428).json({
      error: "Este aparelho precisa ser vinculado ao cadastro do cliente.",
      pairingCode: result.pairingCode,
      expiresAt: result.expiresAt
    });
    return null;
  }
  if (result.status === "revoked") {
    res.status(403).json({ error: "O acesso deste aparelho foi revogado." });
    return null;
  }
  return result.device;
}

router.post("/device-session", async (req, res, next) => {
  try {
    const parsed = deviceProofSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Palavra-chave ou autenticação inválida." });
    const device = await authenticateDevice(res, parsed.data);
    if (!device) return;

    const sessions = await findDeviceSessions(prisma, device.clientId, device.id);
    let session;
    if (!sessions.length) {
      const client = await prisma.client.findUnique({
        where: { id: device.clientId },
        select: { id: true, operatorId: true, name: true, isActive: true }
      });
      if (!client?.isActive) {
        return res.status(404).json({ error: "Cliente indisponível para atendimento." });
      }
      const expiresAt = new Date(Date.now() + config.sessionTtlMinutes * 60_000);
      session = await prisma.$transaction(async (tx) => {
        const created = await tx.remoteSession.create({
          data: {
            operatorId: client.operatorId,
            clientId: client.id,
            clientName: client.name,
            deviceId: device.id,
            publicCode: createSessionCode(),
            expiresAt
          },
          select: {
            id: true,
            publicCode: true,
            clientName: true,
            status: true,
            expiresAt: true
          }
        });
        await tx.sessionLog.create({
          data: { sessionId: created.id, event: "SESSION_CREATED_BY_DEVICE" }
        });
        return created;
      });
    } else {
    if (sessions.length > 1) {
      return res.status(409).json({ error: "Há mais de um atendimento ativo para este cliente. Peça ao atendente para encerrar o excedente." });
    }
      session = sessions[0];
    }
    if (session.status !== "PENDING" && !await findAuthorizedSession(prisma, session.id)) {
      return res.status(404).json({ error: "Atendimento sem consentimento, expirado ou encerrado." });
    }
    const bound = await prisma.remoteSession.updateMany({
      where: {
        id: session.id,
        clientId: device.clientId,
        OR: [{ deviceId: null }, { deviceId: device.id }],
        status: session.status,
        expiresAt: { gt: new Date() }
      },
      data: { deviceId: device.id }
    });
    if (!bound.count) return res.status(409).json({ error: "O atendimento foi alterado. Tente novamente." });
    res.json({
      sessionId: session.id,
      publicCode: session.publicCode,
      clientName: session.clientName,
      status: session.status,
      expiresAt: session.expiresAt
    });
  } catch (error) {
    next(error);
  }
});

router.post("/device-consent", async (req, res, next) => {
  try {
    const parsed = deviceConsentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Confirmação ou autenticação inválida." });
    const device = await authenticateDevice(res, parsed.data);
    if (!device) return;

    const session = await prisma.remoteSession.findFirst({
      where: {
        id: parsed.data.sessionId,
        clientId: device.clientId,
        deviceId: device.id,
        status: { in: activeStatuses },
        expiresAt: { gt: new Date() }
      },
      select: { id: true, status: true }
    });
    if (!session) return res.status(404).json({ error: "Atendimento indisponível para este aparelho." });

    if (session.status === "PENDING") {
      const now = new Date();
      try {
        const consented = await prisma.$transaction(async (tx) => {
          const updated = await tx.remoteSession.updateMany({
            where: {
              id: session.id,
              clientId: device.clientId,
              deviceId: device.id,
              status: "PENDING",
              expiresAt: { gt: now }
            },
            data: { status: "CONSENTED", consentedAt: now }
          });
          if (!updated.count) return false;
          await tx.sessionPermission.create({
            data: {
              sessionId: session.id,
              permission: "SUPPORT_SESSION",
              granted: true,
              grantedAt: now
            }
          });
          await tx.sessionLog.create({
            data: { sessionId: session.id, event: "SUPPORT_CONSENT_GRANTED_ANDROID" }
          });
          return true;
        });
        if (!consented) return res.status(409).json({ error: "O atendimento foi alterado. Tente novamente." });
      } catch (error) {
        if (error?.code === "P2002") {
          return res.status(409).json({ error: "Este cliente já possui outro atendimento autorizado ativo." });
        }
        throw error;
      }
    } else if (!await findAuthorizedSession(prisma, session.id)) {
      return res.status(404).json({ error: "Atendimento sem consentimento válido." });
    }

    const authorized = await findAuthorizedSession(prisma, session.id);
    if (!authorized) return res.status(404).json({ error: "Atendimento indisponível." });
    const ticket = issueDeviceTicket(session.id, config.deviceTicketTtlSeconds);
    await prisma.sessionLog.create({
      data: { sessionId: session.id, event: "DEVICE_TICKET_ISSUED" }
    });
    res.json({
      sessionId: authorized.id,
      publicCode: authorized.publicCode,
      clientName: authorized.clientName,
      expiresAt: authorized.expiresAt,
      deviceToken: ticket.token
    });
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
    if (expired) {
      revokeDeviceTickets(session.id);
      terminateSessionConnections(session.id, "expired");
    }
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
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
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
    } catch (error) {
      if (error?.code === "P2002") {
        return res.status(409).json({ error: "Este cliente já possui outro atendimento autorizado ativo." });
      }
      throw error;
    }
    if (!updated) return res.status(404).json({ error: "Sessão indisponível." });
    res.json({
      ok: true,
      message: "Consentimento registrado para compartilhamento de tela e interações remotas. A captura ainda exige sua autorização no Android; as interações dependem da ativação manual da acessibilidade."
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
    revokeDeviceTickets(session.id);
    terminateSessionConnections(session.id, "consent_revoked");
    res.json({ ok: true, message: "Consentimento revogado. A comunicação foi encerrada." });
  } catch (error) {
    next(error);
  }
});

export default router;
