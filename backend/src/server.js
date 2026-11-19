import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { prisma } from "./db.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import clientRoutes from "./routes/clientRoutes.js";
import publicSessionRoutes from "./routes/publicSessionRoutes.js";
import { createSignalingServer } from "./websocket/signalingServer.js";
import { registerSessionTerminator } from "./websocket/sessionRegistry.js";
import { consumeDeviceTicket } from "./services/deviceTickets.js";
import { createIceServers } from "./services/iceConfig.js";
import { supabase } from "./supabase.js";

const app = express();
app.set("trust proxy", config.trustProxy);
app.use(helmet());
app.use(cors({
  origin: [config.appOrigin],
  methods: ["GET", "POST", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "20kb" }));
app.use((req, res, next) => {
  if (config.requireHttps && !req.secure) {
    return res.status(400).json({ error: "Conexões HTTPS são obrigatórias." });
  }
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
const publicSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente mais tarde." }
});
app.use("/api", apiLimiter);
app.use("/api/public/sessions", publicSessionLimiter);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "HelpConnect API" }));
app.use("/api/sessions", sessionRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/public/sessions", publicSessionRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "JSON inválido." });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Corpo da solicitação muito grande." });
  }
  res.status(500).json({ error: "Erro interno do servidor." });
});

const server = createServer(app);
const isTrustedProxy = app.get("trust proxy fn");
const signalingServer = createSignalingServer({
  server,
  prisma,
  supabase,
  appOrigin: config.appOrigin,
  requireHttps: config.requireHttps,
  isTrustedProxy: (address) => isTrustedProxy(address, 0),
  getClientAddress: (request) => {
    const remoteAddress = request.socket.remoteAddress || "unknown";
    const forwardedFor = request.headers["x-forwarded-for"];
    const addresses = [
      remoteAddress,
      ...(typeof forwardedFor === "string" ? forwardedFor.split(",").reverse().map((address) => address.trim()) : [])
    ];
    let index = 0;
    while (index < addresses.length - 1 && isTrustedProxy(addresses[index], index)) index += 1;
    return addresses[index];
  },
  consumeTicket: consumeDeviceTicket,
  getIceServers: (sessionId) => createIceServers(config, sessionId),
  onConnection: ({ sessionId, participant, event }) => prisma.sessionLog.create({
    data: { sessionId, event: `WS_${event.toUpperCase()}_${participant.toUpperCase()}` }
  })
});
registerSessionTerminator(signalingServer.terminateSession);

server.listen(config.port, () => {
  console.log(`HelpConnect API running on http://localhost:${config.port}`);
});

async function shutdown() {
  signalingServer.close();
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await prisma.$disconnect();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
