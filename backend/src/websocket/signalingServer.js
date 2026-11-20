import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { findAuthorizedSession } from "../services/sessionAccess.js";
import { revokeDeviceTickets } from "../services/deviceTickets.js";

const messageLimit = 16 * 1024;
const messagesPerWindow = 30;
const messageWindowMs = 10_000;
const authTimeoutMs = 5_000;
const heartbeatMs = 30_000;
const sessionCheckMs = 5_000;
const maxConnections = 500;
const connectionAttemptsLimit = 30;
const connectionAttemptsWindowMs = 10 * 60_000;
const remoteCommandsPerSecond = 8;
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
  }).strict(),
  z.object({
    type: z.literal("remote_control_state"),
    ...sequencedMessage.shape,
    recipient: z.literal("operator"),
    available: z.boolean()
  }).strict(),
  z.object({
    type: z.literal("remote_control_command"),
    ...sequencedMessage.shape,
    recipient: z.literal("device"),
    commandId: uuid,
    action: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("tap"),
        x: z.number().int().min(0).max(10_000),
        y: z.number().int().min(0).max(10_000)
      }).strict(),
      z.object({
        kind: z.literal("long_press"),
        x: z.number().int().min(0).max(10_000),
        y: z.number().int().min(0).max(10_000),
        durationMs: z.number().int().min(500).max(2_000)
      }).strict(),
      z.object({
        kind: z.literal("drag"),
        fromX: z.number().int().min(0).max(10_000),
        fromY: z.number().int().min(0).max(10_000),
        toX: z.number().int().min(0).max(10_000),
        toY: z.number().int().min(0).max(10_000),
        durationMs: z.number().int().min(100).max(1_500)
      }).strict(),
      z.object({
        kind: z.literal("global"),
        action: z.enum(["BACK", "HOME", "RECENTS"])
      }).strict(),
      z.object({
        kind: z.literal("type_text"),
        text: z.string().min(1).max(512)
      }).strict()
    ])
  }).strict(),
  z.object({
    type: z.literal("remote_control_result"),
    ...sequencedMessage.shape,
    recipient: z.literal("operator"),
    commandId: uuid,
    status: z.enum(["succeeded", "failed"]),
    errorCode: z.enum([
      "accessibility_disabled",
      "sensitive_field_blocked",
      "text_field_unavailable",
      "gesture_rejected",
      "action_unsupported",
      "command_cancelled"
    ]).optional()
  }).strict().refine(
    (message) => (message.status === "failed") === Boolean(message.errorCode),
    "A failed command requires a bounded error code."
  )
]);

function safeSend(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
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
  appOrigins,
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

  const allowedOrigins = new Set(appOrigins ?? [appOrigin].filter(Boolean));
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
    const device = session.get("device");
    if (device?.remoteControlReady) {
      device.remoteControlReady = false;
      device.pendingRemoteCommands.clear();
      void prisma.sessionLog.create({
        data: { sessionId, event: "REMOTE_CONTROL_DISABLED", actorId: "system" }
      }).catch((error) => console.error("Could not persist remote interaction state.", error));
    }
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
    revokeDeviceTickets(sessionId);
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

  function register(socket, sessionId, participant, iceServers, operatorId) {
    const session = getParticipants(sessionId);
    const existing = session.get(participant);
    if (existing && existing !== socket) {
      const wasAvailable = existing.remoteControlReady === true ||
        (participant === "operator" && session.get("device")?.remoteControlReady === true);
      existing.remoteControlReady = false;
      existing.pendingRemoteCommands?.clear();
      const device = participant === "device" ? null : session.get("device");
      if (device) {
        device.remoteControlReady = false;
        device.pendingRemoteCommands?.clear();
        safeSend(device, {
          type: "remote_control_state",
          sessionId,
          available: false,
          sender: "server"
        });
      } else if (wasAvailable) {
        safeSend(session.get("operator"), {
          type: "remote_control_state",
          sessionId,
          available: false,
          sender: "server"
        });
      }
      if (wasAvailable) {
        void prisma.sessionLog.create({
          data: { sessionId, event: "REMOTE_CONTROL_DISABLED", actorId: "system" }
        }).catch((error) => console.error("Could not persist remote interaction state.", error));
      }
      safeSend(existing, { type: "error", code: "REPLACED", message: "Uma conexão mais recente substituiu esta conexão." });
      existing.close(4001, "Connection replaced");
    }
    socket.sessionId = sessionId;
    socket.participant = participant;
    socket.operatorId = operatorId || null;
    socket.webrtcConnected = false;
    socket.remoteControlReady = false;
    socket.pendingRemoteCommands = new Map();
    socket.seenRemoteCommandIds = new Set();
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
      void prisma.remoteSession.updateMany({
        where: { id: sessionId, status: { in: ["CONSENTED", "CONNECTING"] } },
        data: { status: "CONNECTING", startedAt: new Date() }
      }).catch(() => console.error("Could not persist signaling connection state."));
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
    register(socket, sessionId, participant, iceServers, operatorId);
  }

  async function handleMessage(socket, buffer) {
    let message;
    try {
      message = JSON.parse(buffer.toString());
    } catch {
      safeSend(socket, { type: "error", code: "INVALID_JSON", message: "Mensagem JSON inválida." });
      socket.close(4400, "Invalid JSON");
      return;
    }
    if (message?.type === "remote_control_command") {
      const now = Date.now();
      if (now - socket.remoteCommandWindowStartedAt >= 1_000) {
        socket.remoteCommandWindowStartedAt = now;
        socket.remoteCommandCount = 0;
      }
      socket.remoteCommandCount += 1;
      if (socket.remoteCommandCount > remoteCommandsPerSecond) {
        safeSend(socket, { type: "error", code: "RATE_LIMITED", message: "Limite de comandos de controle excedido." });
        return;
      }
    } else {
      socket.messageCount += 1;
      if (socket.messageCount > messagesPerWindow) {
        safeSend(socket, { type: "error", code: "RATE_LIMITED", message: "Limite de mensagens excedido." });
        socket.close(4408, "Rate limited");
        return;
      }
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

    const session = await findAuthorizedSession(prisma, socket.sessionId, socket.operatorId);
    if (!session) {
      terminateSession(socket.sessionId, "session_unavailable");
      return;
    }
    socket.lastSequence = signal.sequence;
    signalSequences.set(`${socket.sessionId}:${socket.participant}`, signal.sequence);
    if (signal.type.startsWith("remote_control_")) {
      await handleRemoteControlMessage(socket, signal, session);
      return;
    }
    if (signal.type === "connection_state" && signal.transport === "webrtc" && signal.state === "connected") {
      socket.webrtcConnected = true;
      try {
        await prisma.remoteSession.updateMany({
          where: { id: socket.sessionId, status: { in: ["CONSENTED", "CONNECTING"] } },
          data: { status: "ACTIVE" }
        });
      } catch (error) {
        console.error("Could not persist active WebRTC state.", error);
      }
    } else if (signal.type === "connection_state" && signal.transport === "webrtc") {
      socket.webrtcConnected = false;
      const device = sessions.get(socket.sessionId)?.get("device");
      if (device?.remoteControlReady) {
        device.remoteControlReady = false;
        device.pendingRemoteCommands.clear();
        safeSend(sessions.get(socket.sessionId)?.get("operator"), {
          type: "remote_control_state",
          sessionId: socket.sessionId,
          available: false,
          sender: "server"
        });
        void prisma.sessionLog.create({
          data: { sessionId: socket.sessionId, event: "REMOTE_CONTROL_DISABLED", actorId: "system" }
        }).catch((error) => console.error("Could not persist remote interaction state.", error));
      }
    }
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

  async function handleRemoteControlMessage(socket, signal, session) {
    const sessionId = socket.sessionId;
    const isCurrentParticipant = sessions.get(sessionId)?.get(socket.participant) === socket;
    const peerParticipant = socket.participant === "operator" ? "device" : "operator";
    const peer = sessions.get(sessionId)?.get(peerParticipant);
    const reject = (code, message) => safeSend(socket, { type: "error", code, message });

    if (!isCurrentParticipant || !peer || peer.readyState !== WebSocket.OPEN) {
      reject("PEER_UNAVAILABLE", "O outro participante não está conectado.");
      return;
    }
    const requiredSender = {
      remote_control_state: "device",
      remote_control_command: "operator",
      remote_control_result: "device"
    }[signal.type];
    if (requiredSender && socket.participant !== requiredSender) {
      reject("CONTROL_FORBIDDEN", "Este participante não pode enviar esta mensagem de controle.");
      return;
    }
    const expectedRecipient = socket.participant === "operator" ? "device" : "operator";
    if (signal.recipient !== expectedRecipient) {
      reject("INVALID_RECIPIENT", "Destinatário de controle não autorizado.");
      return;
    }
    if (session.status !== "ACTIVE") {
      reject("CONTROL_SESSION_INACTIVE", "As interações exigem consentimento e sessão ativa.");
      return;
    }

    if (signal.type === "remote_control_state") {
      if (socket.participant !== "device" || !socket.webrtcConnected || !peer.webrtcConnected) {
        if (signal.available) {
          reject("CONTROL_NOT_AUTHORIZED", "O Android e a conexão WebRTC ainda não estão prontos.");
          return;
        }
      }
      if (socket.remoteControlReady === signal.available) return;
      socket.remoteControlReady = signal.available;
      if (!signal.available) socket.pendingRemoteCommands.clear();
      try {
        await prisma.sessionLog.create({
          data: {
            sessionId,
            event: signal.available ? "REMOTE_CONTROL_ENABLED" : "REMOTE_CONTROL_DISABLED",
            actorId: "device"
          }
        });
      } catch (error) {
        socket.remoteControlReady = false;
        console.error("Could not persist remote interaction state.", error);
        reject("CONTROL_AUDIT_FAILED", "Não foi possível registrar a disponibilidade de interações.");
        return;
      }
      if (
        sessions.get(sessionId)?.get("device") === socket &&
        socket.remoteControlReady &&
        session.status === "ACTIVE"
      ) {
        safeSend(peer, { ...signal, sessionId, sender: "device" });
      } else {
        safeSend(peer, {
          type: "remote_control_state",
          sessionId,
          available: false,
          sender: "server"
        });
      }
      return;
    }

    const device = sessions.get(sessionId)?.get("device");
    if (
      !device ||
      !device.webrtcConnected ||
      !socket.webrtcConnected ||
      !device.remoteControlReady ||
      (socket.participant === "operator" && session.operatorId !== socket.operatorId)
    ) {
      reject("CONTROL_NOT_AUTHORIZED", "As interações não estão disponíveis nesta sessão.");
      return;
    }

    if (signal.type === "remote_control_command") {
      if (socket.participant !== "operator") {
        reject("CONTROL_FORBIDDEN", "Somente o atendente autenticado pode enviar comandos.");
        return;
      }
      if (socket.seenRemoteCommandIds.has(signal.commandId)) {
        reject("DUPLICATE_COMMAND", "O comando já foi processado.");
        return;
      }
      if (socket.seenRemoteCommandIds.size >= 2_000 || device.pendingRemoteCommands.size >= 64) {
        reject("CONTROL_COMMAND_LIMIT", "O limite de comandos desta autorização foi atingido.");
        return;
      }
      try {
        await prisma.sessionLog.create({
          data: { sessionId, event: `REMOTE_CONTROL_COMMAND_${signal.action.kind.toUpperCase()}`, actorId: session.operatorId }
        });
      } catch (error) {
        console.error("Could not persist remote-control command.", error);
        reject("CONTROL_AUDIT_FAILED", "Não foi possível registrar o comando.");
        return;
      }
      if (
        !device.remoteControlReady ||
        sessions.get(sessionId)?.get("operator") !== socket ||
        sessions.get(sessionId)?.get("device") !== device ||
        session.operatorId !== socket.operatorId
      ) {
        reject("CONTROL_NOT_AUTHORIZED", "A autorização foi revogada antes do envio.");
        return;
      }
      socket.seenRemoteCommandIds.add(signal.commandId);
      device.pendingRemoteCommands.set(signal.commandId, true);
      safeSend(device, { ...signal, sessionId, sender: socket.participant });
      return;
    }

    if (signal.type === "remote_control_result") {
      if (
        socket.participant !== "device" ||
        !socket.pendingRemoteCommands.has(signal.commandId)
      ) {
        reject("INVALID_CONTROL_RESULT", "Resultado de controle não corresponde a um comando ativo.");
        return;
      }
      socket.pendingRemoteCommands.delete(signal.commandId);
      try {
        await prisma.sessionLog.create({
          data: {
            sessionId,
            event: signal.status === "succeeded"
              ? "REMOTE_CONTROL_COMMAND_SUCCEEDED"
              : `REMOTE_CONTROL_COMMAND_FAILED_${signal.errorCode.toUpperCase()}`,
            actorId: "device"
          }
        });
      } catch (error) {
        console.error("Could not persist remote-control result.", error);
      }
      if (
        socket.remoteControlReady &&
        sessions.get(sessionId)?.get("operator") === peer &&
        session.operatorId === peer.operatorId
      ) {
        safeSend(peer, { ...signal, sessionId, sender: socket.participant });
      }
    }
  }

  function handleConnection(socket) {
    socket.isAlive = true;
    socket.messageCount = 0;
    socket.messageQueue = Promise.resolve();
    socket.remoteCommandCount = 0;
    socket.remoteCommandWindowStartedAt = Date.now();
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
      socket.messageQueue = socket.messageQueue.then(() => handleMessage(socket, data)).catch((error) => {
        console.error("WebSocket message processing failed.", error);
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
        const device = session.get("device");
        const wasRemoteControlReady = device?.remoteControlReady === true;
        if (device) {
          device.remoteControlReady = false;
          device.pendingRemoteCommands.clear();
          safeSend(session.get("operator"), {
            type: "remote_control_state",
            sessionId: socket.sessionId,
            available: false,
            sender: "server"
          });
        }
        if (wasRemoteControlReady) {
          void prisma.sessionLog.create({
            data: {
              sessionId: socket.sessionId,
              event: "REMOTE_CONTROL_DISABLED",
              actorId: socket.participant === "operator" ? socket.operatorId : "device"
            }
          }).catch((error) => console.error("Could not persist remote interaction state.", error));
        }
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
    if (origin && !allowedOrigins.has(origin)) {
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
