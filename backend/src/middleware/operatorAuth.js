import { supabase } from "../supabase.js";
import { prisma } from "../db.js";

export async function requireOperator(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Autenticação necessária." });

  let user;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Sessão inválida." });
    user = data.user;
  } catch {
    return res.status(401).json({ error: "Não foi possível validar a sessão." });
  }

  try {
    await prisma.user.upsert({
      where: { id: user.id },
      create: { id: user.id, email: user.email ?? null },
      update: { email: user.email ?? null }
    });
    req.operator = { id: user.id, email: user.email ?? null };
    return next();
  } catch (error) {
    return next(error);
  }
}
