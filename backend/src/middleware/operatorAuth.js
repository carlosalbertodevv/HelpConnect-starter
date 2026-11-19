import { supabase } from "../supabase.js";

export async function requireOperator(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Autenticação necessária." });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Sessão inválida." });

    req.operator = { id: data.user.id, email: data.user.email ?? null };
    next();
  } catch {
    return res.status(401).json({ error: "Não foi possível validar a sessão." });
  }
}
