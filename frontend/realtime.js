(() => {
  const activeConnections = new Map();
  const websocketUrl = (apiUrl) => {
    const url = new URL(apiUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/api\/?$/, "")}/ws`;
    url.search = "";
    url.hash = "";
    return url.toString();
  };

  function connect({ sessionId, apiUrl, getAccessToken, getIceServers, onMessage, onState, onStream, onError }) {
    let socket;
    let peerConnection;
    let sequence = 0;
    let connectionNonce;
    let reconnectAttempts = 0;
    let reconnectTimer;
    let restartTimer;
    let stopped = false;
    let deviceConnected = false;
    let queue = Promise.resolve();
    const pendingCandidates = [];

    const updateState = (transport, state) => onState?.(transport, state);
    const reportError = (text) => onError?.(text);

    function send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ ...message, sequence: ++sequence, connectionNonce }));
      return true;
    }

    async function setupPeerConnection() {
      if (peerConnection) return peerConnection;
      const { iceServers } = await getIceServers(sessionId);
      if (stopped) return null;
      const peer = new RTCPeerConnection({ iceServers });
      peerConnection = peer;
      peer.ontrack = (event) => onStream?.(event.streams[0] || new MediaStream([event.track]));
      peer.onicecandidate = (event) => {
        send({ type: "ice_candidate", recipient: "device", candidate: event.candidate?.toJSON() ?? null });
      };
      peer.onconnectionstatechange = () => {
        updateState("webrtc", peer.connectionState);
        send({
          type: "connection_state",
          recipient: "device",
          transport: "webrtc",
          state: peer.connectionState
        });
        if (["failed", "disconnected"].includes(peer.connectionState)) {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => { void restartIce(); }, 2_000);
        } else {
          clearTimeout(restartTimer);
        }
      };
      return peer;
    }

    async function restartIce() {
      if (!deviceConnected || !peerConnection || stopped) return;
      try {
        const offer = await peerConnection.createOffer({ iceRestart: true });
        await peerConnection.setLocalDescription(offer);
        send({ type: "offer", recipient: "device", sdp: peerConnection.localDescription });
      } catch {
        reportError("Não foi possível renegociar a conexão WebRTC.");
      }
    }

    async function handleMessage(event) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        reportError("O servidor enviou uma mensagem inválida.");
        return;
      }
      if (message.type === "error") {
        reportError(message.message || "Erro de comunicação.");
        if (message.code === "SESSION_FORBIDDEN" || message.code === "UNAUTHENTICATED") {
          stopped = true;
          socket?.close(4403, "Session unavailable");
          updateState("device", "disconnected");
          updateState("webrtc", "closed");
          peerConnection?.close();
          peerConnection = null;
          onStream?.(null);
        }
        return;
      }
      if (message.type === "session_ended") {
        stopped = true;
        clearTimeout(reconnectTimer);
        clearTimeout(restartTimer);
        updateState("websocket", "closed");
        updateState("device", "disconnected");
        updateState("webrtc", "closed");
        reportError("O atendimento foi encerrado ou o consentimento foi revogado.");
        peerConnection?.close();
        peerConnection = null;
        onStream?.(null);
        activeConnections.delete(sessionId);
        return;
      }
      if (message.type === "join_session" && message.accepted) {
        reconnectAttempts = 0;
        if (Number.isSafeInteger(message.nextSequence)) {
          sequence = Math.max(sequence, message.nextSequence - 1);
        }
        connectionNonce = message.connectionNonce;
        updateState("websocket", "connected");
        return;
      }
      if (message.type === "connection_state" && message.transport === "websocket") {
        if (message.participant === "device") {
          deviceConnected = message.state === "connected";
          updateState("device", message.state);
        }
        return;
      }
      if (message.type === "connection_state" && message.transport === "webrtc") {
        updateState("webrtc", message.state);
        return;
      }
      if (message.type === "offer" || message.type === "answer") {
        const peer = await setupPeerConnection();
        if (!peer) return;
        await peer.setRemoteDescription(message.sdp);
        while (pendingCandidates.length) {
          await peer.addIceCandidate(pendingCandidates.shift());
        }
        if (message.type === "offer") {
          const answer = await peer.createAnswer();
          await peer.setLocalDescription(answer);
          send({ type: "answer", recipient: "device", sdp: peer.localDescription });
        }
        return;
      }
      if (message.type === "ice_candidate") {
        const peer = await setupPeerConnection();
        if (!peer) return;
        if (!peer.remoteDescription) pendingCandidates.push(message.candidate);
        else await peer.addIceCandidate(message.candidate);
        return;
      }
      onMessage?.(message);
    }

    function openSocket() {
      if (stopped) return;
      updateState("websocket", reconnectAttempts ? "reconnecting" : "connecting");
      socket = new WebSocket(websocketUrl(apiUrl));
      socket.onopen = () => {
        const accessToken = getAccessToken();
        if (!accessToken) {
          stopped = true;
          reportError("A sessão do atendente expirou. Entre novamente.");
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "join_session", sessionId, accessToken }));
      };
      socket.onmessage = (event) => {
        queue = queue.then(() => handleMessage(event)).catch(() => {
          reportError("Falha ao processar a sinalização WebRTC.");
        });
      };
      socket.onerror = () => reportError("Falha na conexão WebSocket.");
      socket.onclose = () => {
        if (stopped) return;
        updateState("websocket", "disconnected");
        if (reconnectAttempts >= 5) return;
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(openSocket, Math.min(500 * (2 ** (reconnectAttempts - 1)), 8_000));
      };
    }

    openSocket();
    const connection = {
      stop() {
        stopped = true;
        clearTimeout(reconnectTimer);
        clearTimeout(restartTimer);
        peerConnection?.close();
        peerConnection = null;
        if (socket && socket.readyState < WebSocket.CLOSING) {
          if (socket.readyState === WebSocket.OPEN) send({ type: "leave_session" });
          socket.close(1000, "Operator left");
        }
        updateState("websocket", "disconnected");
        updateState("device", "disconnected");
        updateState("webrtc", "closed");
        onStream?.(null);
      }
    };
    activeConnections.set(sessionId, connection);
    return connection;
  }

  function disconnect(sessionId) {
    activeConnections.get(sessionId)?.stop();
    activeConnections.delete(sessionId);
  }

  window.HelpConnectRealtime = { connect, disconnect };
})();
