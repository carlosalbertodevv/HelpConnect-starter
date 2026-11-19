import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { createSignalingServer } from "../backend/src/websocket/signalingServer.js";

const operatorId = randomUUID();

function createHarness({ sessionOverrides = {}, sessions: additionalSessions = [] } = {}) {
  const sessionId = randomUUID();
  const sessions = new Map([
    [sessionId, {
      id: sessionId,
      operatorId,
      status: "CONSENTED",
      expiresAt: new Date(Date.now() + 60_000),
      permissions: [{ granted: true }],
      ...sessionOverrides
    }],
    ...additionalSessions.map((session) => [session.id, session])
  ]);
  const tickets = new Map();
  const prisma = {
    remoteSession: {
      findUnique: async ({ where }) => sessions.get(where.id) ?? null,
      updateMany: async ({ where, data }) => {
        const session = sessions.get(where.id);
        if (!session) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      }
    },
    sessionLog: { create: async () => ({}) }
  };
  const supabase = {
    auth: {
      getUser: async (token) => token === "valid-operator-token"
        ? { data: { user: { id: operatorId } }, error: null }
        : { data: { user: null }, error: new Error("invalid token") }
    }
  };
  const server = createServer();
  const signaling = createSignalingServer({
    server,
    prisma,
    supabase,
    appOrigin: "http://localhost:5500",
    getIceServers: () => ({ iceServers: [{ urls: "stun:stun.example.test:3478" }] }),
    consumeTicket(token) {
      const ticket = tickets.get(token);
      tickets.delete(token);
      return ticket ?? null;
    }
  });
  const ready = new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const sockets = new Set();
  return {
    sessionId,
    sessions,
    tickets,
    signaling,
    sockets,
    async start() {
      await ready;
      return `ws://127.0.0.1:${server.address().port}/ws`;
    },
    async connect(url = `ws://127.0.0.1:${server.address().port}/ws`) {
      const socket = new WebSocket(url);
      sockets.add(socket);
      await new Promise((resolve, reject) => {
        socket.once("open", resolve);
        socket.once("error", reject);
      });
      return socket;
    },
    async close() {
      for (const socket of sockets) {
        if (socket.readyState === WebSocket.OPEN) socket.close();
        else if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
      }
      signaling.close();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

function waitForMessage(socket, type, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for ${type}.`));
    }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== type && type !== "*") return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

function waitForErrorCode(socket, code, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error(`Timed out waiting for error ${code}.`));
    }, timeoutMs);
    const onMessage = (data) => {
      const message = JSON.parse(data.toString());
      if (message.type !== "error" || message.code !== code) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
  });
}

async function joinOperator(harness, socket, sessionId = harness.sessionId) {
  const response = waitForMessage(socket, "*");
  socket.send(JSON.stringify({
    type: "join_session",
    sessionId,
    accessToken: "valid-operator-token"
  }));
  const joined = await response;
  assert.equal(joined.accepted, true, joined.message);
  socket.connectionNonce = joined.connectionNonce;
  return joined;
}

async function joinDevice(harness, socket, sessionId = harness.sessionId, token = "device-ticket-token-abcdefghijklmnopqrstuvwxyz") {
  const response = waitForMessage(socket, "*");
  socket.send(JSON.stringify({ type: "join_session", sessionId, deviceToken: token }));
  const joined = await response;
  assert.equal(joined.accepted, true, joined.message);
  socket.connectionNonce = joined.connectionNonce;
  return joined;
}

function sendSignal(socket, message) {
  socket.send(JSON.stringify({ ...message, connectionNonce: socket.connectionNonce }));
}

async function withHarness(options, run) {
  const harness = createHarness(options);
  await harness.start();
  try {
    await run(harness);
  } finally {
    await harness.close();
  }
}

test("WebSocket server accepts a valid operator connection", async () => {
  await withHarness({}, async (harness) => {
    const socket = await harness.connect();
    const joined = await joinOperator(harness, socket);
    assert.equal(joined.accepted, true);
    assert.equal(joined.participant, "operator");
  });
});

test("WebSocket server rejects an invalid operator token", async () => {
  await withHarness({}, async (harness) => {
    const socket = await harness.connect();
    const error = waitForMessage(socket, "error");
    socket.send(JSON.stringify({
      type: "join_session",
      sessionId: harness.sessionId,
      accessToken: "invalid-operator-token"
    }));
    assert.equal((await error).code, "UNAUTHENTICATED");
  });
});

test("device ticket authenticates a device and cannot be replayed", async () => {
  await withHarness({}, async (harness) => {
    harness.tickets.set("device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: harness.sessionId });
    const socket = await harness.connect();
    const joined = await joinDevice(harness, socket);
    assert.equal(joined.participant, "device");
    assert.equal(joined.iceServers[0].urls, "stun:stun.example.test:3478");

    const replay = await harness.connect();
    const error = waitForMessage(replay, "error");
    replay.send(JSON.stringify({
      type: "join_session",
      sessionId: harness.sessionId,
      deviceToken: "device-ticket-token-abcdefghijklmnopqrstuvwxyz"
    }));
    assert.equal((await error).code, "UNAUTHENTICATED");
  });
});

test("authorized participants receive same-session presence", async () => {
  await withHarness({}, async (harness) => {
    harness.tickets.set("device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: harness.sessionId });
    const operator = await harness.connect();
    const device = await harness.connect();
    await joinOperator(harness, operator);
    const peerState = waitForMessage(operator, "connection_state");
    await joinDevice(harness, device);
    assert.equal((await peerState).participant, "device");
  });
});

test("a device joining an existing operator receives operator presence", async () => {
  await withHarness({}, async (harness) => {
    harness.tickets.set("device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: harness.sessionId });
    const operator = await harness.connect();
    const device = await harness.connect();
    await joinOperator(harness, operator);
    const state = waitForMessage(device, "connection_state");
    await joinDevice(harness, device);

    const operatorState = await state;
    assert.equal(operatorState.transport, "websocket");
    assert.equal(operatorState.participant, "operator");
    assert.equal(operatorState.state, "connected");
  });
});

test("operator cannot join a session owned by another operator", async () => {
  await withHarness({ sessionOverrides: { operatorId: randomUUID() } }, async (harness) => {
    const socket = await harness.connect();
    const error = waitForMessage(socket, "error");
    socket.send(JSON.stringify({
      type: "join_session",
      sessionId: harness.sessionId,
      accessToken: "valid-operator-token"
    }));
    assert.equal((await error).code, "SESSION_FORBIDDEN");
  });
});

test("session without active consent is rejected", async () => {
  await withHarness({ sessionOverrides: { permissions: [{ granted: false }] } }, async (harness) => {
    const socket = await harness.connect();
    const error = waitForMessage(socket, "error");
    socket.send(JSON.stringify({
      type: "join_session",
      sessionId: harness.sessionId,
      accessToken: "valid-operator-token"
    }));
    assert.equal((await error).code, "SESSION_FORBIDDEN");
  });
});

test("offers and answers are relayed only to the other participant", async () => {
  await withHarness({}, async (harness) => {
    harness.tickets.set("device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: harness.sessionId });
    const operator = await harness.connect();
    const device = await harness.connect();
    await joinOperator(harness, operator);
    await joinDevice(harness, device);

    const offer = waitForMessage(device, "offer");
    sendSignal(operator, {
      type: "offer",
      sequence: 1,
      recipient: "device",
      sdp: { type: "offer", sdp: "v=0\r\n" }
    });
    assert.equal((await offer).sender, "operator");

    const answer = waitForMessage(operator, "answer");
    sendSignal(device, {
      type: "answer",
      sequence: 1,
      recipient: "operator",
      sdp: { type: "answer", sdp: "v=0\r\n" }
    });
    assert.equal((await answer).sender, "device");
  });
});

test("ICE candidates are relayed without changing their payload", async () => {
  await withHarness({}, async (harness) => {
    harness.tickets.set("device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: harness.sessionId });
    const operator = await harness.connect();
    const device = await harness.connect();
    await joinOperator(harness, operator);
    await joinDevice(harness, device);
    const candidate = waitForMessage(device, "ice_candidate");
    const error = waitForMessage(operator, "error");
    const value = { candidate: "candidate:1 1 UDP 1 127.0.0.1 9 typ host", sdpMid: "0" };
    sendSignal(operator, {
      type: "ice_candidate",
      sequence: 1,
      recipient: "device",
      candidate: value
    });
    const relayed = await Promise.race([candidate, error]);
    assert.equal(relayed.type, "ice_candidate", relayed.message);
    assert.deepEqual(relayed.candidate, value);
  });
});

test("expired sessions are rejected and active sockets are closed on expiry", async () => {
  await withHarness({ sessionOverrides: { expiresAt: new Date(Date.now() + 150) } }, async (harness) => {
    const socket = await harness.connect();
    await joinOperator(harness, socket);
    const ended = await waitForMessage(socket, "session_ended", 1_500);
    assert.equal(ended.reason, "expired");
    assert.equal(harness.sessions.get(harness.sessionId).status, "EXPIRED");
  });
});

test("revoked consent closes both participants before further signaling", async () => {
  await withHarness({}, async (harness) => {
    harness.tickets.set("device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: harness.sessionId });
    const operator = await harness.connect();
    const device = await harness.connect();
    await joinOperator(harness, operator);
    await joinDevice(harness, device);
    harness.sessions.get(harness.sessionId).permissions = [{ granted: false }];
    const ended = waitForMessage(operator, "session_ended");
    sendSignal(operator, {
      type: "connection_state",
      sequence: 1,
      recipient: "device",
      transport: "webrtc",
      state: "connected"
    });
    assert.equal((await ended).reason, "session_unavailable");
  });
});

test("ending a session notifies and closes connected participants", async () => {
  await withHarness({}, async (harness) => {
    const socket = await harness.connect();
    await joinOperator(harness, socket);
    const ended = waitForMessage(socket, "session_ended");
    harness.signaling.terminateSession(harness.sessionId, "operator_ended");
    assert.equal((await ended).reason, "operator_ended");
  });
});

test("a reconnecting operator replaces the previous connection", async () => {
  await withHarness({}, async (harness) => {
    const first = await harness.connect();
    await joinOperator(harness, first);
    const replaced = waitForMessage(first, "error");
    const second = await harness.connect();
    const joined = await joinOperator(harness, second);
    assert.equal(joined.accepted, true);
    assert.equal((await replaced).code, "REPLACED");
  });
});

test("invalid signaling payloads are rejected", async () => {
  await withHarness({}, async (harness) => {
    const socket = await harness.connect();
    await joinOperator(harness, socket);
    const error = waitForMessage(socket, "error");
    socket.send(JSON.stringify({ type: "execute_remote_action", sequence: 1 }));
    assert.equal((await error).code, "INVALID_MESSAGE");
  });
});

test("replayed sequence numbers are blocked across reconnects", async () => {
  await withHarness({}, async (harness) => {
    const first = await harness.connect();
    await joinOperator(harness, first);
    sendSignal(first, { type: "leave_session", sequence: 1 });
    await waitForMessage(first, "leave_session");

    const second = await harness.connect();
    const joined = await joinOperator(harness, second);
    assert.equal(joined.nextSequence, 2);
    const error = waitForMessage(second, "error");
    sendSignal(second, { type: "leave_session", sequence: 1 });
    assert.equal((await error).code, "REPLAYED_MESSAGE");
  });
});

test("messages from a previous connection nonce cannot be replayed", async () => {
  await withHarness({}, async (harness) => {
    const first = await harness.connect();
    await joinOperator(harness, first);
    const closed = new Promise((resolve) => first.once("close", resolve));
    first.close();
    await closed;

    const second = await harness.connect();
    await joinOperator(harness, second);
    const error = waitForMessage(second, "error");
    second.send(JSON.stringify({
      type: "leave_session",
      sequence: 1,
      connectionNonce: first.connectionNonce
    }));
    assert.equal((await error).code, "REPLAYED_MESSAGE");
  });
});

test("message rate limiting closes an abusive connection", async () => {
  await withHarness({}, async (harness) => {
    const socket = await harness.connect();
    await joinOperator(harness, socket);
    const error = waitForErrorCode(socket, "RATE_LIMITED");
    for (let index = 0; index < 31; index += 1) {
      socket.send(JSON.stringify({ type: "invalid" }));
    }
    assert.equal((await error).code, "RATE_LIMITED");
  });
});

test("sessions do not relay signaling across session boundaries", async () => {
  const otherSessionId = randomUUID();
  await withHarness({
    sessions: [{
      id: otherSessionId,
      operatorId,
      status: "CONSENTED",
      expiresAt: new Date(Date.now() + 60_000),
      permissions: [{ granted: true }]
    }]
  }, async (harness) => {
    harness.tickets.set("other-device-ticket-token-abcdefghijklmnopqrstuvwxyz", { sessionId: otherSessionId });
    const operator = await harness.connect();
    const device = await harness.connect();
    await joinOperator(harness, operator, harness.sessionId);
    await joinDevice(harness, device, otherSessionId, "other-device-ticket-token-abcdefghijklmnopqrstuvwxyz");
    const error = waitForMessage(operator, "error");
    sendSignal(operator, {
      type: "ice_candidate",
      sequence: 1,
      recipient: "device",
      candidate: null
    });
    assert.equal((await error).code, "PEER_UNAVAILABLE");
  });
});

test("oversized messages are rejected by the WebSocket server", async () => {
  await withHarness({}, async (harness) => {
    const socket = await harness.connect();
    const closed = new Promise((resolve) => socket.once("close", (code) => resolve(code)));
    socket.send("x".repeat(17 * 1024));
    assert.equal(await closed, 1009);
  });
});
