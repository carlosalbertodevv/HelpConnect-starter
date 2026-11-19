import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { findAuthorizedSession } from "../services/sessionAccess.js";

const messageLimit = 16 * 1024;
const messagesPerWindow = 30;
const messageWindowMs = 10_000;
const authTimeoutMs = 5_000;
const heartbeatMs = 30_000;
const sessionCheckMs = 5_000;
const maxConnections = 500;
const connectionAttemptsLimit = 30;
const connectionAttemptsWindowMs = 10 * 60_000;
const participants = ["operator", "device"];
const uuid = z.uuid();

const joinMessage = z.object({
  type: z.literal("join_session"),
  sessionId: uuid,
  accessToken: z.string().min(20).max(4096).optional(),
  deviceToken: z.string().min(30).max(100).optional()
}).strict().refine(
  (message) => Boolean(message.accessToken) !== Boolean(message.deviceToken),
  "Provide exactly one participant credential."
);
const sequencedMessage = z.object({
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  connectionNonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/)
});
const sdpDescription = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().min(1).max(12_000)
}).strict();
const iceCandidate = z.object({
  candidate: z.string().max(4096),
  sdpMid: z.string().max(256).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(1000).nullable().optional(),
  usernameFragment: z.string().max(256).nullable().optional()
}).strict();
const signalMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("leave_session"), ...sequencedMessage.shape }).strict(),
  z.object({
    type: z.literal("offer"),
    ...sequencedMessage.shape,
    recipient: z.enum(participants),
    sdp: sdpDescription.extend({ type: z.literal("offer") })
  }).strict(),
  z.object({
    type: z.literal("answer"),
    ...sequencedMessage.shape,
    recipient: z.enum(participants),
    sdp: sdpDescription.extend({ type: z.literal("answer") })
  }).strict(),
  z.object({
    type: z.literal("ice_candidate"),
    ...sequencedMessage.shape,
    recipient: z.enum(participants),
    candidate: iceCandidate.nullable()
  }).strict(),
  z.object({
    type: z.literal("connection_state"),
    ...sequencedMessage.shape,
    recipient: z.enum(participants),
    transport: z.literal("webrtc"),
    state: z.enum(["new", "connecting", "connected", "disconnected", "failed", "closed"])
  }).strict()
]);

function safeSend(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function createSignalingServer({
  server,
  prisma,
  supabase,
  appOrigin,
  requireHttps = false,
  isTrustedProxy = () => false,
  getClientAddress = (request) => request.socket.remoteAddress || "unknown",
  consumeTicket,
  getIceServers = () => null,
  onConnection = () => {}
}) {
  if (!server || !prisma || !supabase || typeof consumeTicket !== "function") {
    throw new TypeError("Signaling server dependencies are required.");
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: messageLimit });
  const sessions = new Map();
  const monitors = new Map();
  const attempts = new Map();
  const signalSequences = new Map();
  let closed = false;

  function getParticipants(sessionId) {
    let session = sessions.get(sessionId);
    if (!session) {
      session = new Map();
      sessions.set(sessionId, session);
    }
    return session;
  }

  function clearMonitorIfEmpty(sessionId) {
    if (sessions.get(sessionId)?.size) return;
    sessions.delete(sessionId);
    const monitor = monitors.get(sessionId);
    if (monitor) {
      clearInterval(monitor.interval);
      clearTimeout(monitor.expiry);
    }
    monitors.delete(sessionId);
  }

  function notifyPeer(socket, state) {
    const session = sessions.get(socket.sessionId);
    const peer = session?.get(socket.participant === "operator" ? "device" : "operator");
    if (peer && peer !== socket) {
      safeSend(peer, {
        type: "connection_state",
        sessionId: socket.sessionId,
        transport: "websocket",
        participant: socket.participant,
        state
      });
    }
  }

  function terminateSession(sessionId, reason = "session_unavailable") {
    const session = sessions.get(sessionId);
    if (!session) return;
    for (const socket of session.values()) {
      safeSend(socket, { type: "session_ended", sessionId, reason });
      socket.close(4000, "Session ended");
    }
    sessions.delete(sessionId);
    signalSequences.delete(`${sessionId}:operator`);
    signalSequences.delete(`${sessionId}:device`);
    const monitor = monitors.get(sessionId);
    if (monitor) {
      clearInterval(monitor.interval);
      clearTimeout(monitor.expiry);
    }
    monitors.delete(sessionId);
  }

  async function checkSession(sessionId) {
    const session = await findAuthorizedSession(prisma, sessionId, undefined, { allowExpired: true });
    if (!session) {
      terminateSession(sessionId, "session_unavailable");
      return;
    }
    if (session.expiresAt <= new Date()) {
      await expireSession(sessionId);
      return;
    }
    const delay = session.expiresAt.getTime() - Date.now();
    if (delay <= 0) {
      terminateSession(sessionId, "expired");
      return;
    }
    const monitor = monitors.get(sessionId);
    if (monitor?.expiry) clearTimeout(monitor.expiry);
    const expiry = setTimeout(() => {
      void expireSession(sessionId);
    }, delay);
    expiry.unref?.();
    if (monitor) monitor.expiry = expiry;
  }

  async function expireSession(sessionId) {
    const now = new Date();
    try {
      const result = await prisma.remoteSession.updateMany({
        where: {
          id: sessionId,
          status: { in: ["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"] },
          expiresAt: { lte: now }
        },
        data: { status: "EXPIRED", endedAt: now }
      });
      if (result.count) {
        await prisma.sessionLog.create({ data: { sessionId, event: "SESSION_EXPIRED" } });
      }
    } catch (error) {
      console.error("Could not persist expired signaling session.");
    }
    terminateSession(sessionId, "expired");
  }

  function startMonitor(sessionId) {
    if (monitors.has(sessionId)) return;
    const monitor = { interval: null, expiry: null };
    monitor.interval = setInterval(() => {
      void checkSession(sessionId).catch((error) => {
        console.error("Could not validate signaling session.", error);
        terminateSession(sessionId, "session_unavailable");
      });
    }, sessionCheckMs);
    monitor.interval.unref?.();
    monitors.set(sessionId, monitor);
    void checkSession(sessionId).catch((error) => {
      console.error("Could not validate signaling session.", error);
      terminateSession(sessionId, "session_unavailable");
    });
  }

  function register(socket, sessionId, participant, iceServers) {
    const session = getParticipants(sessionId);
    const existing = session.get(participant);
    if (existing && existing !== socket) {
      safeSend(existing, { type: "error", code: "REPLACED", message: "Uma conexão mais recente substituiu esta conexão." });
      existing.close(4001, "Connection replaced");
    }
    socket.sessionId = sessionId;
    socket.participant = participant;
    socket.lastSequence = signalSequences.get(`${sessionId}:${participant}`) || 0;
    socket.connectionNonce = randomBytes(16).toString("base64url");
    session.set(participant, socket);
    startMonitor(sessionId);
    safeSend(socket, {
      type: "join_session",
      sessionId,
      participant,
      accepted: true,
      nextSequence: socket.lastSequence + 1,
      connectionNonce: socket.connectionNonce,
      ...(iceServers || {})
    });
    const peerParticipant = participant === "operator" ? "device" : "operator";
    if (session.get(peerParticipant)?.readyState === WebSocket.OPEN) {
      safeSend(socket, {
        type: "connection_state",
        sessionId,
        transport: "websocket",
        participant: peerParticipant,
        state: "connected"
      });
    }
    notifyPeer(socket, "connected");
    void Promise.resolve(onConnection({ sessionId, participant, event: "joined" }))
      .catch(() => console.error("Could not record signaling connection."));
  }

  async function authenticateOperator(token) {
    const { data, error } = await supabase.auth.getUser(token);
    return !error && data?.user?.id ? data.user.id : null;
  }

  async function handleJoin(socket, rawMessage) {
    const parsed = joinMessage.safeParse(rawMessage);
    if (!parsed.success) {
      safeSend(socket, { type: "error", code: "INVALID_JOIN", message: "Autenticação ou sessão inválida." });
      socket.close(4400, "Invalid join");
      return;
    }
    const { sessionId, accessToken, deviceToken } = parsed.data;
    let participant;
    let operatorId;
    if (accessToken) {
      operatorId = await authenticateOperator(accessToken);
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!operatorId) {
        safeSend(socket, { type: "error", code: "UNAUTHENTICATED", message: "Autenticação inválida." });
        socket.close(4401, "Unauthorized");
        return;
      }
      participant = "operator";
    } else {
      const ticket = consumeTicket(deviceToken);
      if (!ticket || ticket.sessionId !== sessionId) {
        safeSend(socket, { type: "error", code: "UNAUTHENTICATED", message: "Credencial do dispositivo inválida ou expirada." });
        socket.close(4401, "Unauthorized");
        return;
      }
      participant = "device";
    }

    const session = await findAuthorizedSession(prisma, sessionId, operatorId);
    if (socket.readyState !== WebSocket.OPEN) return;
    if (!session) {
      safeSend(socket, { type: "error", code: "SESSION_FORBIDDEN", message: "Sessão não autorizada, sem consentimento ou expirada." });
      socket.close(4403, "Session forbidden");
      return;
    }
    const iceServers = participant === "device" ? getIceServers(sessionId) : null;
    register(socket, sessionId, participant, iceServers);
  }

  async function handleMessage(socket, buffer) {
    socket.messageCount += 1;
    if (socket.messageCount > messagesPerWindow) {
      safeSend(socket, { type: "error", code: "RATE_LIMITED", message: "Limite de mensagens excedido." });
      socket.close(4408, "Rate limited");
      return;
    }
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch {
      safeSend(socket, { type: "error", code: "INVALID_JSON", message: "Mensagem JSON inválida." });
      socket.close(4400, "Invalid JSON");
      return;
    }
    if (!socket.participant) {
      await handleJoin(socket, message);
      return;
    }

    const parsed = signalMessage.safeParse(message);
    if (!parsed.success) {
      safeSend(socket, { type: "error", code: "INVALID_MESSAGE", message: "Mensagem inválida." });
      return;
    }
    const signal = parsed.data;
    if (signal.connectionNonce !== socket.connectionNonce) {
      safeSend(socket, { type: "error", code: "REPLAYED_MESSAGE", message: "Mensagem repetida ou originada em outra conexão." });
      return;
    }
    if (signal.sequence <= socket.lastSequence) {
      safeSend(socket, { type: "error", code: "REPLAYED_MESSAGE", message: "Mensagem repetida ou fora de ordem." });
      return;
    }

    const session = await findAuthorizedSession(prisma, socket.sessionId);
    if (!session) {
      terminateSession(socket.sessionId, "session_unavailable");
      return;
    }
    socket.lastSequence = signal.sequence;
    signalSequences.set(`${socket.sessionId}:${socket.participant}`, signal.sequence);
    if (signal.type === "leave_session") {
      safeSend(socket, { type: "leave_session", sessionId: socket.sessionId, accepted: true });
      socket.close(1000, "Participant left");
      return;
    }

    const expectedRecipient = socket.participant === "operator" ? "device" : "operator";
    if (signal.recipient !== expectedRecipient) {
      safeSend(socket, { type: "error", code: "INVALID_RECIPIENT", message: "Destinatário não autorizado." });
      return;
    }
    const peer = sessions.get(socket.sessionId)?.get(expectedRecipient);
    if (!peer || peer.readyState !== WebSocket.OPEN) {
      safeSend(socket, { type: "error", code: "PEER_UNAVAILABLE", message: "O outro participante não está conectado." });
      return;
    }
    safeSend(peer, {
      ...signal,
      sessionId: socket.sessionId,
      sender: socket.participant
    });
  }

  function handleConnection(socket) {
    socket.isAlive = true;
    socket.messageCount = 0;
    socket.windowStartedAt = Date.now();
    socket.authenticating = false;
    const authTimer = setTimeout(() => {
      if (!socket.participant) {
        safeSend(socket, { type: "error", code: "AUTH_TIMEOUT", message: "Autenticação não recebida." });
        socket.close(4401, "Authentication timeout");
      }
    }, authTimeoutMs);
    authTimer.unref?.();

    socket.on("pong", () => { socket.isAlive = true; });
    socket.on("message", (data) => {
      if (Date.now() - socket.windowStartedAt >= messageWindowMs) {
        socket.windowStartedAt = Date.now();
        socket.messageCount = 0;
      }
      if (!socket.participant && socket.authenticating) {
        safeSend(socket, { type: "error", code: "INVALID_JOIN", message: "Envie somente uma solicitação de entrada." });
        socket.close(4400, "Invalid join");
        return;
      }
      if (!socket.participant) socket.authenticating = true;
      void handleMessage(socket, data).catch((error) => {
        console.error("WebSocket message processing failed.");
        safeSend(socket, { type: "error", code: "INTERNAL_ERROR", message: "Não foi possível processar a mensagem." });
        socket.close(1011, "Message processing failed");
      });
      if (socket.participant) clearTimeout(authTimer);
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      if (!socket.sessionId) return;
      const session = sessions.get(socket.sessionId);
      if (session?.get(socket.participant) === socket) {
        session.delete(socket.participant);
        notifyPeer(socket, "disconnected");
        void Promise.resolve(onConnection({
          sessionId: socket.sessionId,
          participant: socket.participant,
          event: "left"
        })).catch(() => console.error("Could not record signaling disconnection."));
      }
      clearMonitorIfEmpty(socket.sessionId);
    });
    socket.on("error", () => console.warn("WebSocket transport error."));
  }

  function consumeHandshakeAttempt(ip) {
    const now = Date.now();
    for (const [address, entry] of attempts) {
      if (now - entry.startedAt >= connectionAttemptsWindowMs) attempts.delete(address);
    }
    const entry = attempts.get(ip);
    if (!entry || now - entry.startedAt >= connectionAttemptsWindowMs) {
      attempts.set(ip, { startedAt: now, count: 1 });
      return true;
    }
    if (entry.count >= connectionAttemptsLimit) return false;
    entry.count += 1;
    return true;
  }

  function handleUpgrade(request, socket, head) {
    let url;
    try {
      url = new URL(request.url, "http://localhost");
    } catch {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    if (url.pathname !== "/ws" || url.search) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (closed || wss.clients.size >= maxConnections) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    const origin = request.headers.origin;
    if (origin && origin !== appOrigin) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (requireHttps) {
      const forwardedProtocol = isTrustedProxy(request.socket.remoteAddress)
        ? request.headers["x-forwarded-proto"]?.split(",")[0].trim()
        : null;
      if (!request.socket.encrypted && forwardedProtocol !== "https") {
        rejectUpgrade(socket, 400, "TLS Required");
        return;
      }
    }
    const ip = getClientAddress(request);
    if (attempts.size >= 10_000 && !attempts.has(ip)) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (!consumeHandshakeAttempt(ip)) {
      rejectUpgrade(socket, 429, "Too Many Requests");
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      wss.emit("connection", webSocket, request);
    });
  }

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  server.on("upgrade", handleUpgrade);
  wss.on("connection", handleConnection);

  return {
    terminateSession,
    close() {
      closed = true;
      server.off("upgrade", handleUpgrade);
      clearInterval(heartbeat);
      for (const monitor of monitors.values()) {
        clearInterval(monitor.interval);
        clearTimeout(monitor.expiry);
      }
      monitors.clear();
      for (const socket of wss.clients) socket.terminate();
      sessions.clear();
      signalSequences.clear();
      wss.close();
    }
  };
}
