import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { prisma } from "./db.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import publicSessionRoutes from "./routes/publicSessionRoutes.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: [config.appOrigin], methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "20kb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "HelpConnect API" }));
app.use("/api/sessions", sessionRoutes);
app.use("/api/public/sessions", publicSessionRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

const server = app.listen(config.port, () => {
  console.log(`HelpConnect API running on http://localhost:${config.port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
