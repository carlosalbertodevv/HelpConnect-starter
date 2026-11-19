import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireOperator } from "../middleware/operatorAuth.js";

const router = Router();
const idSchema = z.string().uuid();
const emailSchema = z.string().trim().email().max(254);
const phoneSchema = z.string().trim().max(40);
const clientFields = {
  name: z.string().trim().min(1).max(100),
  email: emailSchema.optional(),
  phone: phoneSchema.optional()
};
const createSchema = z.object(clientFields).strict();
const updateSchema = z.object({
  name: clientFields.name,
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  isActive: z.boolean()
}).strict().partial().refine((value) => Object.keys(value).length > 0);

router.get("/", requireOperator, async (req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      where: { operatorId: req.operator.id },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: 200,
      select: {
        id: true, name: true, email: true, phone: true, isActive: true,
        createdAt: true, updatedAt: true
      }
    });
    res.json({ clients });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireOperator, async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Dados inválidos." });
    const client = await prisma.client.create({
      data: { ...parsed.data, operatorId: req.operator.id },
      select: {
        id: true, name: true, email: true, phone: true, isActive: true,
        createdAt: true, updatedAt: true
      }
    });
    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireOperator, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    const parsed = updateSchema.safeParse(req.body);
    if (!id.success || !parsed.success) return res.status(400).json({ error: "Dados inválidos." });

    const result = await prisma.client.updateMany({
      where: { id: id.data, operatorId: req.operator.id },
      data: parsed.data
    });
    if (!result.count) return res.status(404).json({ error: "Cliente não encontrado." });
    const client = await prisma.client.findUnique({
      where: { id: id.data },
      select: {
        id: true, name: true, email: true, phone: true, isActive: true,
        createdAt: true, updatedAt: true
      }
    });
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireOperator, async (req, res, next) => {
  try {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) return res.status(400).json({ error: "Identificador inválido." });
    const result = await prisma.client.updateMany({
      where: { id: id.data, operatorId: req.operator.id, isActive: true },
      data: { isActive: false }
    });
    if (!result.count) return res.status(404).json({ error: "Cliente não encontrado ou já arquivado." });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
