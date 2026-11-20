import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static instances = [];

  constructor() {
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen();
  }

  receive(message) {
    this.onmessage({ data: JSON.stringify(message) });
  }

  close() {
    this.readyState = 3;
  }
}

class FakePeerConnection {
  static instances = [];

  constructor() {
    this.connectionState = "new";
    this.localDescription = null;
    this.remoteDescription = null;
    FakePeerConnection.instances.push(this);
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
    this.connectionState = "connected";
    this.onconnectionstatechange();
  }

  async createAnswer() {
    return { type: "answer", sdp: "answer" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async addIceCandidate() {}

  close() {
    this.connectionState = "closed";
  }

  emitTrack() {
    this.ontrack({
      streams: [{}],
      track: { addEventListener() {} }
    });
  }
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test("remote commands stay disabled until Android advertises ready with an active video", async () => {
  FakeWebSocket.instances.length = 0;
  FakePeerConnection.instances.length = 0;
  const source = await readFile(new URL("../frontend/realtime.js", import.meta.url), "utf8");
  const window = {};
  vm.runInNewContext(source, {
    window,
    WebSocket: FakeWebSocket,
    RTCPeerConnection: FakePeerConnection,
    crypto: webcrypto,
    URL,
    setTimeout,
    clearTimeout,
    MediaStream: class {}
  });

  const states = [];
  const connection = window.HelpConnectRealtime.connect({
    sessionId: "123e4567-e89b-42d3-a456-426614174000",
    apiUrl: "http://localhost:3001/api",
    getAccessToken: () => "operator-token",
    getIceServers: async () => ({ iceServers: [] }),
    onControlState: (state) => states.push(state)
  });
  const socket = FakeWebSocket.instances[0];
  socket.open();
  socket.receive({
    type: "join_session",
    accepted: true,
    nextSequence: 1,
    connectionNonce: "0123456789012345678901"
  });
  await flush();
  assert.equal(connection.sendRemoteControlCommand({ kind: "global", action: "BACK" }), false);

  socket.receive({
    type: "connection_state",
    transport: "websocket",
    participant: "device",
    state: "connected"
  });
  socket.receive({ type: "offer", sdp: { type: "offer", sdp: "offer" } });
  await flush();
  socket.receive({
    type: "remote_control_state",
    available: true,
    sender: "device"
  });
  await flush();
  assert.equal(connection.sendRemoteControlCommand({ kind: "global", action: "BACK" }), false);

  FakePeerConnection.instances[0].emitTrack();
  assert.equal(states.at(-1), "available");
  assert.equal(connection.sendRemoteControlCommand({ kind: "type_text", text: "hello" }), true);
  const command = socket.sent.find((message) => message.type === "remote_control_command");
  assert.equal(command.action.text, "hello");
  assert.equal("requestId" in command, false);
  assert.equal("requestRemoteControl" in connection, false);

  socket.receive({
    type: "remote_control_state",
    available: false,
    sender: "server"
  });
  await flush();
  assert.equal(states.at(-1), "unavailable");
  assert.equal(connection.sendRemoteControlCommand({ kind: "global", action: "BACK" }), false);
  connection.stop();
});
