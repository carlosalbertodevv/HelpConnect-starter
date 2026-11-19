import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashToken } from "../utils/tokens.js";

const router = Router();
const tokenSchema = z.string().min(30).max(100);

async function findValidSession(rawToken) {
  const parsed = tokenSchema.safeParse(rawToken);
  if (!parsed.success) return null;
  const session = await prisma.remoteSession.findUnique({
    where: { accessTokenHash: hashToken(parsed.data) }
  });
  if (!session || session.expiresAt <= new Date() ||
      !["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"].includes(session.status)) return null;
  return session;
}

router.get("/:token", async (req, res, next) => {
  try {
    const session = await findValidSession(req.params.token);
    if (!session) return res.status(404).json({ error: "Link inválido, expirado ou encerrado." });
    res.json({
      session: {
        id: session.id,
        clientName: session.clientName,
        status: session.status,
        expiresAt: session.expiresAt
      }
    });
  } catch (error) { next(error); }
});

const consentSchema = z.object({
  accepted: z.literal(true),
  deviceModel: z.string().trim().max(120).optional(),
  androidVersion: z.string().trim().max(40).optional()
}).strict();

router.post("/:token/consent", async (req, res, next) => {
  try {
    const parsed = consentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "É necessário aceitar o consentimento." });
    const session = await findValidSession(req.params.token);
    if (!session || session.status !== "PENDING") {
      return res.status(404).json({ error: "Sessão indisponível." });
    }
    await prisma.remoteSession.update({
      where: { id: session.id },
      data: {
        status: "CONSENTED",
        consentedAt: new Date(),
        deviceModel: parsed.data.deviceModel || null,
        androidVersion: parsed.data.androidVersion || null
      }
    });
    res.json({ ok: true, message: "Consentimento registrado. O aplicativo Android será necessário para compartilhar a tela." });
  } catch (error) { next(error); }
});

export default router;
