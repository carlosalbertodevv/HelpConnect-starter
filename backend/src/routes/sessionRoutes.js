import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { createSessionCode } from "../utils/tokens.js";
import { findAuthorizedSession } from "../services/sessionAccess.js";
import { revokeDeviceTickets } from "../services/deviceTickets.js";
import { createIceServers } from "../services/iceConfig.js";
import { terminateSessionConnections } from "../websocket/sessionRegistry.js";

const router = Router();
const activeStatuses = ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"];
const createSchema = z.object({
  clientId: z.uuid()
}).strict();
const idSchema = z.uuid();

async function expireSessions(operatorId) {
  const now = new Date();
  while (true) {
    const expired = await prisma.remoteSession.findMany({
      where: { operatorId, status: { in: activeStatuses }, expiresAt: { lte: now } },
      select: { id: true },
      take: 500
    });
    if (!expired.length) return;

    const terminatedIds = [];
    await prisma.$transaction(async (tx) => {
      for (const { id } of expired) {
        const updated = await tx.remoteSession.updateMany({
          where: { id, operatorId, status: { in: activeStatuses }, expiresAt: { lte: now } },
          data: { status: "EXPIRED", endedAt: now }
        });
        if (updated.count) {
          terminatedIds.push(id);
          await tx.sessionLog.create({
            data: { sessionId: id, event: "SESSION_EXPIRED", actorId: operatorId }
          });
        }
      }
    });
    for (const id of terminatedIds) {
      revokeDeviceTickets(id);
      terminateSessionConnections(id, "expired");
    }
    if (expired.length < 500) return;
  }
}

router.get("/dashboard", requireOperator, async (req, res, next) => {
  try {
    await expireSessions(req.operator.id);
    const [total, pending, consented, active, clients] = await Promise.all([
      prisma.remoteSession.count({ where: { operatorId: req.operator.id } }),
      prisma.remoteSession.count({ where: { operatorId: req.operator.id, status: "PENDING" } }),
      prisma.remoteSession.count({ where: { operatorId: req.operator.id, status: "CONSENTED" } }),
      prisma.remoteSession.count({ where: { operatorId: req.operator.id, status: { in: ["CONNECTING", "ACTIVE"] } } }),
      prisma.client.count({ where: { operatorId: req.operator.id, isActive: true } })
    ]);
    res.json({ metrics: { total, pending, consented, active, clients } });
  } catch (error) {
    next(error);
  }
});

router.get("/", requireOperator, async (req, res, next) => {
  try {
    await expireSessions(req.operator.id);
    const sessions = await prisma.remoteSession.findMany({
      where: { operatorId: req.operator.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, publicCode: true, clientId: true, clientName: true,
        deviceModel: true, androidVersion: true, status: true, expiresAt: true,
        consentedAt: true, startedAt: true, endedAt: true, createdAt: true
      }
    });
    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireOperator, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, operatorId: req.operator.id, isActive: true },
      select: { id: true, name: true }
    });
    if (!client) return res.status(404).json({ error: "Cliente não encontrado." });

    const expiresAt = new Date(Date.now() + config.sessionTtlMinutes * 60_000);
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.remoteSession.create({
        data: {
          operatorId: req.operator.id,
          clientId: client.id,
          clientName: client.name,
          publicCode: createSessionCode(),
          expiresAt
        },
        select: {
          id: true, publicCode: true, clientId: true, clientName: true,
          status: true, expiresAt: true, createdAt: true
        }
      });
      await tx.sessionLog.create({
        data: { sessionId: created.id, event: "SESSION_CREATED", actorId: req.operator.id }
      });
      return created;
    });

    res.status(201).json({ session });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/end", requireOperator, async (req, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: "Identificador inválido." });

    const now = new Date();
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.remoteSession.updateMany({
        where: {
          id: parsedId.data,
          operatorId: req.operator.id,
          status: { in: activeStatuses }
        },
        data: { status: "ENDED", endedAt: now }
      });
      if (updated.count) {
        await tx.sessionLog.create({
          data: {
            sessionId: parsedId.data,
            event: "SESSION_ENDED_BY_OPERATOR",
            actorId: req.operator.id
          }
        });
      }
      return updated;
    });
    if (!result.count) return res.status(404).json({ error: "Sessão não encontrada ou já encerrada." });
    revokeDeviceTickets(parsedId.data);
    terminateSessionConnections(parsedId.data, "operator_ended");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/:id/ice-servers", requireOperator, async (req, res, next) => {
  try {
    const parsedId = idSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: "Identificador inválido." });
    const session = await findAuthorizedSession(prisma, parsedId.data, req.operator.id);
    if (!session) return res.status(404).json({ error: "Sessão não encontrada, sem consentimento ou expirada." });
    res.json(createIceServers(config, parsedId.data));
  } catch (error) {
    next(error);
  }
});

export default router;
