import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireOperator } from "../middleware/operatorAuth.js";
import { createRawToken, hashToken } from "../utils/tokens.js";

const router = Router();
const createSchema = z.object({
  clientName: z.string().trim().max(100).optional(),
}).strict();

router.post("/", requireOperator, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });

    const rawToken = createRawToken();
    const expiresAt = new Date(Date.now() + config.sessionTtlMinutes * 60_000);
    const session = await prisma.remoteSession.create({
      data: {
        operatorId: req.operator.id,
        clientName: parsed.data.clientName || null,
        accessTokenHash: hashToken(rawToken),
        expiresAt
      },
      select: { id: true, clientName: true, status: true, expiresAt: true, createdAt: true }
    });

    const link = `${config.publicAppUrl.replace(/\/$/, "")}/client.html#${rawToken}`;
    res.status(201).json({ session, link });
  } catch (error) { next(error); }
});

router.get("/", requireOperator, async (req, res, next) => {
  try {
    const sessions = await prisma.remoteSession.findMany({
      where: { operatorId: req.operator.id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, clientName: true, deviceModel: true, androidVersion: true,
        status: true, expiresAt: true, consentedAt: true, startedAt: true,
        endedAt: true, createdAt: true
      }
    });
    res.json({ sessions });
  } catch (error) { next(error); }
});

router.post("/:id/end", requireOperator, async (req, res, next) => {
  try {
    const result = await prisma.remoteSession.updateMany({
      where: { id: req.params.id, operatorId: req.operator.id, status: { in: ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"] } },
      data: { status: "ENDED", endedAt: new Date() }
    });
    if (!result.count) return res.status(404).json({ error: "Sessão não encontrada ou já encerrada." });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

export default router;
