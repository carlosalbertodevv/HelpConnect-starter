import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { hashToken } from "../utils/tokens.js";
import { revokeDeviceTickets } from "../services/deviceTickets.js";
import { terminateSessionConnections } from "../websocket/sessionRegistry.js";

const router = Router();
const pairingSchema = z.object({
  pairingCode: z.string().regex(/^[A-F0-9]{8}$/),
  clientId: z.uuid()
}).strict();
const idSchema = z.uuid();
const activeStatuses = ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"];

router.get("/", requireOperator, async (req, res, next) => {
  try {
    const devices = await prisma.device.findMany({
      where: { client: { operatorId: req.operator.id } },
      orderBy: { pairedAt: "desc" },
      select: {
        id: true,
        clientId: true,
        model: true,
        pairedAt: true,
        revokedAt: true,
        isActive: true,
        client: { select: { name: true } }
      }
    });
    res.json({
      devices: devices.map(({ client, ...device }) => ({ ...device, clientName: client.name }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/pair", requireOperator, async (req, res, next) => {
  try {
    const parsed = pairingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Código de pareamento ou cliente inválido." });

    const client = await prisma.client.findFirst({
      where: { id: parsed.data.clientId, operatorId: req.operator.id, isActive: true },
      select: { id: true, name: true }
    });
    if (!client) return res.status(404).json({ error: "Cliente não encontrado ou inativo." });

    const paired = await prisma.device.updateMany({
      where: {
        pairingCodeHash: hashToken(parsed.data.pairingCode),
        clientId: null,
        pairedAt: null,
        isActive: true,
        pairingExpiresAt: { gt: new Date() }
      },
      data: {
        clientId: client.id,
        pairedAt: new Date(),
        pairingCodeHash: null,
        pairingExpiresAt: null
      }
    });
    if (!paired.count) return res.status(404).json({ error: "Código inválido, expirado ou já utilizado." });
    res.status(201).json({ ok: true, message: `Aparelho vinculado a ${client.name}.` });
  } catch (error) {
    next(error);
  }
});

router.post("/:id/revoke", requireOperator, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Identificador inválido." });

    const now = new Date();
    const endedSessionIds = await prisma.$transaction(async (tx) => {
      const device = await tx.device.findFirst({
        where: { id: id.data, client: { operatorId: req.operator.id }, isActive: true },
        select: { id: true }
      });
      if (!device) return null;
      await tx.device.update({
        where: { id: device.id },
        data: { isActive: false, revokedAt: now }
      });

      const sessions = await tx.remoteSession.findMany({
        where: { deviceId: device.id, status: { in: activeStatuses } },
        select: { id: true }
      });
      const ended = [];
      for (const session of sessions) {
        const result = await tx.remoteSession.updateMany({
          where: { id: session.id, status: { in: activeStatuses } },
          data: { status: "ENDED", endedAt: now }
        });
        if (result.count) {
          ended.push(session.id);
          await tx.sessionLog.create({
            data: {
              sessionId: session.id,
              event: "DEVICE_PAIRING_REVOKED",
              actorId: req.operator.id
            }
          });
        }
      }
      return ended;
    });
    if (!endedSessionIds) return res.status(404).json({ error: "Aparelho não encontrado ou já revogado." });
    for (const sessionId of endedSessionIds) {
      revokeDeviceTickets(sessionId);
      terminateSessionConnections(sessionId, "device_pairing_revoked");
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
