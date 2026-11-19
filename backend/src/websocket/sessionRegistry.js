let terminateSessionHandler = () => {};

export function registerSessionTerminator(handler) {
  terminateSessionHandler = handler;
}

export function terminateSessionConnections(sessionId, reason) {
  terminateSessionHandler(sessionId, reason);
}
