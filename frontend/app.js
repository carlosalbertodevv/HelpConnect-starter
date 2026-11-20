const { supabaseUrl, supabaseAnonKey, apiUrl } = window.HELPCONNECT_CONFIG || {};
const configured = Boolean(
  supabaseUrl && !supabaseUrl.includes("SEU_PROJETO") &&
  supabaseAnonKey && !supabaseAnonKey.includes("SUA_CHAVE") &&
  apiUrl
);
const sb = configured ? window.supabase.createClient(supabaseUrl, supabaseAnonKey) : null;
let accessToken = null;
let editingClientId = null;
const realtimeConnections = new Map();
let cachedSessions = [];
let deviceControlSessionId = null;

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle("hidden", !visible);
const message = (id, text) => { $(id).textContent = text; };
const themeStorageKey = "helpconnect-theme";

async function api(path, options = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Falha na solicitação.");
  return data;
}

function setView(view) {
  const views = {
    dashboard: ["dashboardView", "Visão geral", "PAINEL"],
    devices: ["devicesView", "Aparelhos vinculados", "APARELHOS"],
    clients: ["clientsView", "Clientes", "CLIENTES"],
    settings: ["settingsView", "Configurações", "PREFERÊNCIAS"]
  };
  const selected = views[view] ? view : "dashboard";
  for (const [name, [elementId]] of Object.entries(views)) {
    show(elementId, name === selected);
    const navigation = $("nav" + name[0].toUpperCase() + name.slice(1));
    navigation.classList.toggle("active", name === selected);
    if (name === selected) navigation.setAttribute("aria-current", "page");
    else navigation.removeAttribute("aria-current");
  }
  $("pageTitle").textContent = views[selected][1];
  $("pageSection").textContent = views[selected][2];
}

async function enter(userSession) {
  accessToken = userSession.access_token;
  show("publicHeader", false);
  show("login", false);
  show("dashboard", true);
  show("logout", true);
  setView("dashboard");
  await Promise.all([loadSessions(), loadClients(), loadDevices(), loadDashboard()]);
}

function applyTheme(theme) {
  const selectedTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selectedTheme;
  $("themeSelect").value = selectedTheme;
}

function initializeTheme() {
  let savedTheme = "light";
  try {
    const storedTheme = localStorage.getItem(themeStorageKey);
    if (storedTheme === "light" || storedTheme === "dark") savedTheme = storedTheme;
  } catch {
    message("settingsMessage", "O tema padrão foi aplicado, mas não foi possível ler preferências salvas neste navegador.");
  }
  applyTheme(savedTheme);
}

initializeTheme();

function updateClientForm(client = null) {
  editingClientId = client?.id ?? null;
  $("clientNameInput").value = client?.name ?? "";
  $("clientEmailInput").value = client?.email ?? "";
  $("clientPhoneInput").value = client?.phone ?? "";
  $("clientFormTitle").textContent = client ? "Editar cliente" : "Cadastrar cliente";
  $("saveClient").textContent = client ? "Salvar alterações" : "Cadastrar cliente";
  show("cancelEditClient", Boolean(client));
}

$("loginBtn").onclick = async () => {
  if (!configured) {
    message("loginMessage", "Configure Supabase e API em frontend/config.js antes de entrar.");
    return;
  }
  message("loginMessage", "Entrando...");
  const { data, error } = await sb.auth.signInWithPassword({
    email: $("email").value,
    password: $("password").value
  });
  if (error) {
    message("loginMessage", error.message);
    return;
  }
  try {
    await enter(data.session);
    message("loginMessage", "");
  } catch (error) {
    message("loginMessage", error.message);
  }
};

$("logout").onclick = async () => {
  await sb?.auth.signOut();
  accessToken = null;
  setView("dashboard");
  show("publicHeader", true);
  show("dashboard", false);
  show("login", true);
  show("logout", false);
};

sb?.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null;
});

$("navDashboard").onclick = () => setView("dashboard");
$("navDevices").onclick = () => setView("devices");
$("navClients").onclick = () => setView("clients");
$("navSettings").onclick = () => setView("settings");
$("dashboardDevices").onclick = () => setView("devices");
$("dashboardClients").onclick = () => setView("clients");
$("disconnectDeviceControl").addEventListener("click", () => {
  if (deviceControlSessionId) {
    realtimeConnections.get(deviceControlSessionId)?.stop();
    realtimeConnections.delete(deviceControlSessionId);
  }
  deviceControlSessionId = null;
  $("remoteScreen").srcObject = null;
  $("remoteScreen").hidden = true;
  $("remoteScreen").classList.remove("remote-control-active");
  $("deviceControlActions").classList.add("hidden");
  $("disconnectDeviceControl").classList.add("hidden");
  $("deviceControlActions").querySelectorAll("button, input").forEach((control) => {
    control.disabled = true;
  });
  message("deviceControlStatus", "Controle remoto desconectado.");
});
$("deviceControlActions").querySelectorAll("[data-device-action]").forEach((button) => {
  button.addEventListener("click", () => {
    sendDeviceControlCommand({ kind: "global", action: button.dataset.deviceAction });
  });
});
$("sendDeviceControlText").addEventListener("click", () => {
  const input = $("deviceControlText");
  if (!input.value) return;
  if (sendDeviceControlCommand({ kind: "type_text", text: input.value })) input.value = "";
});
$("deviceControlText").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("sendDeviceControlText").click();
});
$("remoteScreen").addEventListener("pointerdown", (event) => {
  const video = $("remoteScreen");
  if (!event.isPrimary || !video.classList.contains("remote-control-active")) return;
  const point = remoteVideoPoint(event, video);
  if (!point) return;
  event.preventDefault();
  video.setPointerCapture(event.pointerId);
  video._activeRemotePointer = {
    ...point,
    startX: point.x,
    startY: point.y,
    startClientX: event.clientX,
    startClientY: event.clientY,
    moved: false,
    longPressSent: false,
    timer: setTimeout(() => {
      const pointer = video._activeRemotePointer;
      if (!pointer || pointer.moved) return;
      pointer.longPressSent = true;
      sendDeviceControlCommand({ kind: "long_press", x: pointer.x, y: pointer.y, durationMs: 700 });
    }, 700)
  };
});
$("remoteScreen").addEventListener("pointermove", (event) => {
  const video = $("remoteScreen");
  const pointer = video._activeRemotePointer;
  if (!pointer || !video.hasPointerCapture(event.pointerId)) return;
  const point = remoteVideoPoint(event, video);
  if (point) {
    pointer.x = point.x;
    pointer.y = point.y;
  }
  if (Math.hypot(event.clientX - pointer.startClientX, event.clientY - pointer.startClientY) > 10) {
    pointer.moved = true;
    clearTimeout(pointer.timer);
  }
});
$("remoteScreen").addEventListener("pointerup", (event) => {
  const video = $("remoteScreen");
  if (!video.classList.contains("remote-control-active")) return;
  const pointer = video._activeRemotePointer;
  video._activeRemotePointer = null;
  if (!pointer) return;
  clearTimeout(pointer.timer);
  if (pointer.longPressSent) return;
  const end = remoteVideoPoint(event, video) || { x: pointer.x, y: pointer.y };
  sendDeviceControlCommand(pointer.moved
    ? {
        kind: "drag",
        fromX: pointer.startX,
        fromY: pointer.startY,
        toX: end.x,
        toY: end.y,
        durationMs: 300
      }
    : { kind: "tap", x: pointer.startX, y: pointer.startY });
});
$("remoteScreen").addEventListener("pointercancel", () => {
  const video = $("remoteScreen");
  clearTimeout(video._activeRemotePointer?.timer);
  video._activeRemotePointer = null;
});
$("themeSelect").onchange = () => {
  applyTheme($("themeSelect").value);
  try {
    localStorage.setItem(themeStorageKey, $("themeSelect").value);
    message("settingsMessage", "Preferência salva neste navegador.");
  } catch {
    message("settingsMessage", "Tema aplicado, mas não foi possível salvar a preferência neste navegador.");
  }
};

function sendDeviceControlCommand(action) {
  const connection = realtimeConnections.get(deviceControlSessionId);
  if (!connection?.sendRemoteControlCommand(action)) {
    message("deviceControlStatus", "Comando não enviado. Aguarde a conexão e a autorização do dispositivo.");
    return false;
  }
  return true;
}

function remoteVideoPoint(event, video) {
  if (!video.videoWidth || !video.videoHeight) return null;
  const rect = video.getBoundingClientRect();
  const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const width = video.videoWidth * scale;
  const height = video.videoHeight * scale;
  const x = (event.clientX - (rect.left + (rect.width - width) / 2)) / width;
  const y = (event.clientY - (rect.top + (rect.height - height) / 2)) / height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10_000), y: Math.round(y * 10_000) };
}
$("refreshDevices").onclick = async () => {
  await Promise.all([loadSessions(), loadDevices(), loadDashboard()]);
};
setInterval(() => {
  if (accessToken && !$("devicesView").classList.contains("hidden")) {
    void loadDevices();
  }
}, 10_000);

async function loadDashboard() {
  const metricsContainer = document.querySelector(".metrics");
  metricsContainer.setAttribute("aria-busy", "true");
  message("dashboardMessage", "Carregando indicadores...");
  try {
    const [{ devices }, { metrics }] = await Promise.all([api("/devices"), api("/sessions/dashboard")]);
    const activeDevices = devices.filter((device) => device.isActive).length;
    const controllable = cachedSessions.filter((session) =>
      ["CONSENTED", "CONNECTING", "ACTIVE"].includes(session.status)
    ).length;
    $("metricDevices").textContent = devices.length;
    $("metricActiveDevices").textContent = activeDevices;
    $("metricControlAvailable").textContent = controllable;
    $("metricClients").textContent = metrics.clients;
    message("dashboardMessage", "");
  } catch (error) {
    message("dashboardMessage", error.message);
  } finally {
    metricsContainer.setAttribute("aria-busy", "false");
  }
}

async function loadSessions() {
  try {
    const { sessions } = await api("/sessions");
    cachedSessions = sessions;
    const root = $("sessions");
    if (!root) return;
    root.replaceChildren();
    if (!sessions.length) {
      root.textContent = "Nenhum atendimento criado.";
      return;
    }
    for (const session of sessions) {
      const entry = document.createElement("article");
      entry.className = "session-entry";
      const row = document.createElement("div");
      row.className = "session";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${session.clientName || "Cliente sem identificação"} · ${session.publicCode}`;
      const detail = document.createElement("small");
      detail.textContent = `${new Date(session.createdAt).toLocaleString("pt-BR")} · Expira ${new Date(session.expiresAt).toLocaleString("pt-BR")}`;
      const status = document.createElement("span");
      status.className = `status status-${session.status.toLowerCase()}`;
      status.textContent = session.status;
      info.append(title, detail);
      row.append(info, status);
      entry.append(row);
      if (["CONSENTED", "CONNECTING", "ACTIVE"].includes(session.status)) {
        const panel = document.createElement("section");
        panel.className = "realtime-panel";
        const heading = document.createElement("strong");
        heading.textContent = "Comunicação em tempo real";
        const states = document.createElement("div");
        states.className = "realtime-states";
        for (const [label, key] of [["WebSocket", "websocket"], ["Dispositivo Android", "device"], ["WebRTC", "webrtc"]]) {
          const state = document.createElement("span");
          state.id = `realtime-${session.id}-${key}`;
          state.textContent = `${label}: desconectado`;
          states.append(state);
        }
          const transmissionStatus = document.createElement("strong");
          transmissionStatus.id = `realtime-${session.id}-status`;
          transmissionStatus.textContent = "Aguardando dispositivo";
        const actions = document.createElement("div");
        actions.className = "actions";
        const connect = document.createElement("button");
        connect.type = "button";
        connect.textContent = realtimeConnections.has(session.id) ? "Desconectar" : "Conectar sinalização";
        connect.onclick = async () => {
          if (realtimeConnections.has(session.id)) {
            window.HelpConnectRealtime.disconnect(session.id);
            realtimeConnections.delete(session.id);
            connect.textContent = "Conectar sinalização";
            return;
          }
          message(`realtime-${session.id}-error`, "");
          try {
            const connection = window.HelpConnectRealtime.connect({
              sessionId: session.id,
              apiUrl,
              getAccessToken: () => accessToken,
              getIceServers: async (id) => api(`/sessions/${id}/ice-servers`)
                .then((response) => response),
              onState: (transport, value) => {
                const target = document.getElementById(`realtime-${session.id}-${transport}`);
                if (target) target.textContent = `${transportLabel(transport)}: ${translateRealtimeState(value)}`;
                const transmissionStatus = document.getElementById(`realtime-${session.id}-status`);
                const placeholder = document.getElementById(`realtime-${session.id}-placeholder`);
                if (transport === "device") {
                  if (value === "connected" && transmissionStatus) transmissionStatus.textContent = "Aguardando autorização no Android";
                  if (value === "disconnected" && transmissionStatus) transmissionStatus.textContent = "Dispositivo desconectado";
                  if (placeholder && value === "connected") placeholder.textContent = "Dispositivo conectado. Aguardando autorização explícita do Android e início da captura.";
                }
                if (transport === "webrtc" && transmissionStatus) {
                  if (value === "connected") transmissionStatus.textContent = "Conexão WebRTC estabelecida";
                  if (value === "connecting" || value === "new") transmissionStatus.textContent = "Conectando transmissão";
                  if (value === "failed") transmissionStatus.textContent = "Erro na transmissão";
                  if (value === "disconnected") transmissionStatus.textContent = "Transmissão desconectada";
                  if (value === "closed") transmissionStatus.textContent = "Transmissão encerrada";
                }
                if (transport === "websocket" && value === "closed") {
                  realtimeConnections.delete(session.id);
                  connect.textContent = "Conectar sinalização";
                  connect.disabled = true;
                  void loadSessions();
                }
              },
              onStream: (stream) => {
                const video = document.getElementById(`realtime-${session.id}-video`);
                const placeholder = document.getElementById(`realtime-${session.id}-placeholder`);
                const status = document.getElementById(`realtime-${session.id}-status`);
                if (video) {
                  video.srcObject = stream;
                  video.hidden = !stream;
                }
                if (placeholder) {
                  placeholder.classList.toggle("hidden", Boolean(stream));
                  if (stream) placeholder.textContent = "Transmissão ativa — recebendo frames reais do dispositivo.";
                  else placeholder.textContent = "Transmissão desconectada. As interações remotas estão desativadas.";
                }
                if (status) status.textContent = stream ? "Transmissão ativa" : "Aguardando dispositivo";
              },
              onError: (text) => {
                const error = document.getElementById(`realtime-${session.id}-error`);
                if (error) error.textContent = text;
              },
              onControlState: (value) => {
                const status = document.getElementById(`realtime-${session.id}-control-status`);
                const controls = document.getElementById(`realtime-${session.id}-control-actions`);
                const video = document.getElementById(`realtime-${session.id}-video`);
                const available = value === "available" && Boolean(video?.srcObject);
                video?.classList.toggle("remote-control-active", available);
                if (status) {
                  status.textContent = ({
                    available: "Interações ativas: toques, gestos, navegação e texto em campos editáveis.",
                    unavailable: "Aguardando acessibilidade do Android e vídeo ativo; não há aprovação adicional.",
                    closed: "Sessão desconectada; interações desativadas."
                  })[value] || value;
                }
                if (controls) {
                  controls.classList.toggle("hidden", !available);
                  controls.querySelectorAll("button, input").forEach((control) => {
                    control.disabled = !available;
                  });
                }
              },
              onControlResult: (result) => {
                const status = document.getElementById(`realtime-${session.id}-control-status`);
                if (status) {
                  status.textContent = result.status === "succeeded"
                    ? "Comando executado pelo Android."
                    : `Comando não executado (${result.errorCode || "falha"}).`;
                }
              }
            });
            realtimeConnections.set(session.id, connection);
            connect.textContent = "Desconectar";
          } catch (error) {
            message(`realtime-${session.id}-error`, error.message);
          }
        };
        const video = document.createElement("video");
        video.id = `realtime-${session.id}-video`;
        video.className = "remote-screen";
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        const placeholder = document.createElement("small");
        placeholder.id = `realtime-${session.id}-placeholder`;
        placeholder.textContent = "Aguardando dispositivo. Nenhuma tela está sendo simulada.";
        const controlPanel = document.createElement("section");
        controlPanel.className = "remote-control-panel";
        const controlTitle = document.createElement("strong");
        controlTitle.textContent = "Interações remotas";
        const controlHelp = document.createElement("small");
        controlHelp.textContent = "Após o consentimento e a autorização do Android, toque ou arraste na tela e envie texto ao campo selecionado. Campos protegidos por senha são bloqueados.";
        const controlStatus = document.createElement("p");
        controlStatus.id = `realtime-${session.id}-control-status`;
        controlStatus.textContent = "Interações ativadas automaticamente quando o Android confirmar acessibilidade e vídeo ativo.";
        const controlActions = document.createElement("div");
        controlActions.id = `realtime-${session.id}-control-actions`;
        controlActions.className = "actions hidden";
        for (const [label, action] of [["Voltar", "BACK"], ["Início", "HOME"], ["Recentes", "RECENTS"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "ghost";
          button.disabled = true;
          button.textContent = label;
          button.onclick = () => realtimeConnections.get(session.id)?.sendRemoteControlCommand({
            kind: "global",
            action
          });
          controlActions.append(button);
        }
        const textInput = document.createElement("input");
        textInput.type = "text";
        textInput.maxLength = 512;
        textInput.placeholder = "Texto para o campo selecionado";
        textInput.setAttribute("aria-label", "Texto a digitar no Android");
        textInput.disabled = true;
        const sendText = document.createElement("button");
        sendText.type = "button";
        sendText.textContent = "Enviar texto";
        sendText.disabled = true;
        sendText.onclick = () => {
          const text = textInput.value;
          if (!text) return;
          if (realtimeConnections.get(session.id)?.sendRemoteControlCommand({ kind: "type_text", text })) {
            textInput.value = "";
          } else {
            controlStatus.textContent = "Não foi possível enviar: as interações estão indisponíveis.";
          }
        };
        controlActions.append(textInput, sendText);
        controlPanel.append(controlTitle, controlHelp, controlStatus, controlActions);
        let activePointer = null;
        function normalizedPoint(event) {
          if (!video.videoWidth || !video.videoHeight) return null;
          const rect = video.getBoundingClientRect();
          const scale = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
          const width = video.videoWidth * scale;
          const height = video.videoHeight * scale;
          const left = rect.left + (rect.width - width) / 2;
          const top = rect.top + (rect.height - height) / 2;
          const x = (event.clientX - left) / width;
          const y = (event.clientY - top) / height;
          if (x < 0 || x > 1 || y < 0 || y > 1) return null;
          return {
            x: Math.round(x * 10_000),
            y: Math.round(y * 10_000)
          };
        }
        video.addEventListener("pointerdown", (event) => {
          if (!event.isPrimary || !video.classList.contains("remote-control-active")) return;
          const point = normalizedPoint(event);
          if (!point) return;
          event.preventDefault();
          video.setPointerCapture(event.pointerId);
          activePointer = {
            pointerId: event.pointerId,
            start: point,
            latest: point,
            clientX: event.clientX,
            clientY: event.clientY,
            startedAt: Date.now(),
            moved: false,
            longPressSent: false
          };
          activePointer.timer = setTimeout(() => {
            if (!activePointer || activePointer.moved) return;
            activePointer.longPressSent = true;
            realtimeConnections.get(session.id)?.sendRemoteControlCommand({
              kind: "long_press",
              ...activePointer.start,
              durationMs: 700
            });
          }, 700);
        });
        video.addEventListener("pointermove", (event) => {
          if (!activePointer || activePointer.pointerId !== event.pointerId) return;
          const point = normalizedPoint(event);
          if (point) activePointer.latest = point;
          if (Math.hypot(event.clientX - activePointer.clientX, event.clientY - activePointer.clientY) > 10) {
            activePointer.moved = true;
            clearTimeout(activePointer.timer);
          }
        });
        video.addEventListener("pointerup", (event) => {
          if (!activePointer || activePointer.pointerId !== event.pointerId) return;
          const pointer = activePointer;
          activePointer = null;
          clearTimeout(pointer.timer);
          if (!video.classList.contains("remote-control-active")) return;
          if (pointer.longPressSent) return;
          const point = normalizedPoint(event) || pointer.latest;
          if (pointer.moved) {
            realtimeConnections.get(session.id)?.sendRemoteControlCommand({
              kind: "drag",
              fromX: pointer.start.x,
              fromY: pointer.start.y,
              toX: point.x,
              toY: point.y,
              durationMs: Math.max(100, Math.min(1_500, Date.now() - pointer.startedAt))
            });
          } else {
            realtimeConnections.get(session.id)?.sendRemoteControlCommand({
              kind: "tap",
              ...pointer.start
            });
          }
        });
        video.addEventListener("pointercancel", () => {
          if (activePointer) clearTimeout(activePointer.timer);
          activePointer = null;
        });
        const error = document.createElement("p");
        error.id = `realtime-${session.id}-error`;
        error.className = "message";
        error.setAttribute("aria-live", "polite");
        actions.append(connect);
        panel.append(heading, states, transmissionStatus, actions, video, placeholder, controlPanel, error);
        entry.append(panel);
      } else {
        const existing = realtimeConnections.get(session.id);
        if (existing) {
          window.HelpConnectRealtime.disconnect(session.id);
          realtimeConnections.delete(session.id);
        }
      }
      if (["PENDING", "CONSENTED", "CONNECTING", "ACTIVE"].includes(session.status)) {
        const end = document.createElement("button");
        end.className = "ghost";
        end.textContent = "Encerrar";
        end.onclick = async () => {
          end.disabled = true;
          try {
            await api(`/sessions/${session.id}/end`, { method: "POST" });
            await Promise.all([loadSessions(), loadDashboard()]);
          } catch (error) {
            message("sessionMessage", error.message);
            end.disabled = false;
          }
        };
        row.append(end);
      }
      root.append(entry);
    }
  } catch (error) {
    $("sessions").textContent = error.message;
  }
}

function transportLabel(transport) {
  return ({ websocket: "WebSocket", device: "Dispositivo Android", webrtc: "WebRTC" })[transport] || transport;
}

function translateRealtimeState(state) {
  return ({
    connecting: "conectando",
    connected: "conectado",
    reconnecting: "reconectando",
    disconnected: "desconectado",
    failed: "falhou",
    closed: "encerrado",
    new: "aguardando",
    "operator_ended": "encerrado pelo atendente",
    "consent_revoked": "consentimento revogado"
  })[state] || state;
}

async function loadClients() {
  try {
    const { clients } = await api("/clients");
    const root = $("clients");
    const pairingSelect = $("pairingClient");
    const selectedPairingClient = pairingSelect.value;
    pairingSelect.replaceChildren(new Option("Selecione um cliente", ""));
    root.replaceChildren();
    if (!clients.length) root.textContent = "Nenhum cliente cadastrado.";

    for (const client of clients) {
      if (client.isActive) {
        pairingSelect.add(new Option(client.name, client.id));
      }
      const row = document.createElement("div");
      row.className = "session";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = client.name;
      const detail = document.createElement("small");
      detail.textContent = [client.email, client.phone, client.isActive ? "Ativo" : "Arquivado"].filter(Boolean).join(" · ");
      info.append(title, detail);
      row.append(info);
      const actions = document.createElement("div");
      actions.className = "actions";
      const edit = document.createElement("button");
      edit.className = "ghost";
      edit.textContent = "Editar";
      edit.onclick = () => {
        updateClientForm(client);
        window.scrollTo({ top: $("clientForm").offsetTop, behavior: "smooth" });
      };
      actions.append(edit);
      if (client.isActive) {
        const archive = document.createElement("button");
        archive.className = "ghost";
        archive.textContent = "Arquivar";
        archive.onclick = async () => {
          try {
            await api(`/clients/${client.id}`, { method: "DELETE" });
            await Promise.all([loadClients(), loadDashboard()]);
          } catch (error) {
            message("clientMessage", error.message);
          }
        };
        actions.append(archive);
      } else {
        const restore = document.createElement("button");
        restore.className = "ghost";
        restore.textContent = "Reativar";
        restore.onclick = async () => {
          try {
            await api(`/clients/${client.id}`, {
              method: "PATCH",
              body: JSON.stringify({ isActive: true })
            });
            await Promise.all([loadClients(), loadDashboard()]);
          } catch (error) {
            message("clientMessage", error.message);
          }
        };
        actions.append(restore);
      }
      row.append(actions);
      root.append(row);
    }
    if ([...pairingSelect.options].some((option) => option.value === selectedPairingClient)) {
      pairingSelect.value = selectedPairingClient;
    }
  } catch (error) {
    $("clients").textContent = error.message;
  }
}

async function loadDevices() {
  try {
    const [{ devices }, { sessions }] = await Promise.all([api("/devices"), api("/sessions")]);
    cachedSessions = sessions;
    const roots = [$("devices"), $("linkedDevices")].filter(Boolean);
    for (const root of roots) root.replaceChildren();
    if (!devices.length) {
      for (const root of roots) root.textContent = "Nenhum aparelho pareado.";
      return;
    }
    for (const device of devices) {
      for (const root of roots) {
        const row = document.createElement("div");
        row.className = "session";
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = device.clientName;
        const detail = document.createElement("small");
        const pairedAt = device.pairedAt
          ? new Date(device.pairedAt).toLocaleString("pt-BR")
          : "Data indisponível";
        detail.textContent = `${device.model || "Aparelho Android"} · Pareado em ${pairedAt} · ${device.isActive ? "Ativo" : "Revogado"}`;
        info.append(title, detail);
        row.append(info);
        if (device.isActive) {
          const activeSession = sessions.find((session) =>
            session.deviceId === device.id &&
            ["CONSENTED", "CONNECTING", "ACTIVE"].includes(session.status)
          );
          if (root.id === "linkedDevices") {
            const control = document.createElement("button");
            control.type = "button";
            control.textContent = activeSession ? "Controle remoto" : "Aguardando conexão";
            control.disabled = !activeSession;
            control.onclick = async () => {
              if (!activeSession) return;
              setView("devices");
              if (realtimeConnections.has(activeSession.id)) {
                deviceControlSessionId = activeSession.id;
                message("deviceControlStatus", "Este aparelho já está conectado.");
                return;
              }
              for (const [sessionId, existingConnection] of realtimeConnections) {
                existingConnection.stop();
                realtimeConnections.delete(sessionId);
              }
              deviceControlSessionId = activeSession.id;
              $("remoteScreen").srcObject = null;
              $("remoteScreen").hidden = true;
              $("deviceControlActions").classList.add("hidden");
              $("deviceControlActions").querySelectorAll("button, input").forEach((input) => {
                input.disabled = true;
              });
              $("disconnectDeviceControl").classList.remove("hidden");
              message("deviceControlStatus", "Conectando ao aparelho...");
              try {
                const connection = window.HelpConnectRealtime.connect({
                  sessionId: activeSession.id,
                  apiUrl,
                  getAccessToken: () => accessToken,
                  getIceServers: async (id) => api(`/sessions/${id}/ice-servers`).then((response) => response),
                  onState: (transport, value) => {
                    if (transport === "websocket") {
                      message("deviceControlStatus", `Sinalização: ${translateRealtimeState(value)}.`);
                      if (value === "closed") {
                        realtimeConnections.delete(activeSession.id);
                        if (deviceControlSessionId === activeSession.id) {
                          deviceControlSessionId = null;
                          $("disconnectDeviceControl").classList.add("hidden");
                          $("deviceControlActions").classList.add("hidden");
                        }
                      }
                    }
                  },
                  onStream: (stream) => {
                    const video = $("remoteScreen");
                    video.srcObject = stream;
                    video.hidden = !stream;
                    video.classList.toggle("remote-control-active", false);
                    message("deviceControlStatus", stream
                      ? "Tela ativa. Controle remoto disponível após a confirmação no Android."
                      : "Aguardando a tela do aparelho.");
                  },
                  onError: (text) => message("deviceControlStatus", text),
                  onControlState: (value) => {
                    const available = value === "available";
                    const video = $("remoteScreen");
                    video?.classList.toggle("remote-control-active", available);
                    $("deviceControlActions").classList.toggle("hidden", !available);
                    $("deviceControlActions").querySelectorAll("button, input").forEach((control) => {
                      control.disabled = !available;
                    });
                    message("deviceControlStatus", available
                      ? "Controle remoto ativo: toque, arraste ou envie texto."
                      : "Aguardando autorização de acessibilidade e vídeo ativo.");
                  },
                  onControlResult: (result) => {
                    message("deviceControlStatus", result.status === "succeeded"
                      ? "Comando executado pelo aparelho."
                      : `Comando não executado (${result.errorCode || "falha"}).`);
                  }
                });
                realtimeConnections.set(activeSession.id, connection);
              } catch (error) {
                deviceControlSessionId = null;
                $("disconnectDeviceControl").classList.add("hidden");
                message("deviceControlStatus", error.message);
              }
            };
            row.append(control);
          } else {
            const revoke = document.createElement("button");
            revoke.type = "button";
            revoke.className = "ghost";
            revoke.textContent = "Revogar aparelho";
            revoke.onclick = async () => {
              if (!window.confirm(`Revogar o aparelho pareado ao cliente ${device.clientName}?`)) return;
              revoke.disabled = true;
              try {
                await api(`/devices/${device.id}/revoke`, { method: "POST" });
                await loadDevices();
                message("devicePairingMessage", "Aparelho revogado; conexões ativas nesse aparelho foram encerradas.");
              } catch (error) {
                message("devicePairingMessage", error.message);
                revoke.disabled = false;
              }
            };
            row.append(revoke);
          }
        }
        root.append(row);
      }
    }
  } catch (error) {
    $("devices").textContent = error.message;
  }
}

$("pairingCode").addEventListener("input", () => {
  $("pairingCode").value = $("pairingCode").value.toUpperCase().replace(/[^A-F0-9]/g, "").slice(0, 8);
});

$("pairDevice").onclick = async () => {
  const pairingCode = $("pairingCode").value.trim();
  const clientId = $("pairingClient").value;
  if (!clientId || !/^[A-F0-9]{8}$/.test(pairingCode)) {
    message("devicePairingMessage", "Selecione o cliente e informe o código de 8 caracteres exibido no app.");
    return;
  }
  if (!window.confirm("Confirme que verificou a identidade do cliente antes de vincular este aparelho.")) return;
  $("pairDevice").disabled = true;
  try {
    const result = await api("/devices/pair", {
      method: "POST",
      body: JSON.stringify({ pairingCode, clientId })
    });
    $("pairingCode").value = "";
    message("devicePairingMessage", result.message);
    await loadDevices();
  } catch (error) {
    message("devicePairingMessage", error.message);
  } finally {
    $("pairDevice").disabled = false;
  }
};

$("clientForm").onsubmit = async (event) => {
  event.preventDefault();
  const payload = {
    name: $("clientNameInput").value.trim(),
    email: $("clientEmailInput").value.trim() || (editingClientId ? null : undefined),
    phone: $("clientPhoneInput").value.trim() || (editingClientId ? null : undefined)
  };
  const editing = Boolean(editingClientId);
  try {
    await api(editing ? `/clients/${editingClientId}` : "/clients", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    });
    updateClientForm();
    message("clientMessage", editing ? "Cliente atualizado." : "Cliente cadastrado.");
    await Promise.all([loadClients(), loadDashboard()]);
  } catch (error) {
    message("clientMessage", error.message);
  }
};

$("cancelEditClient").onclick = () => updateClientForm();

if (configured) {
  sb.auth.getSession().then(({ data, error }) => {
    if (error) {
      message("loginMessage", error.message);
      return;
    }
    if (data.session) enter(data.session).catch((requestError) => message("loginMessage", requestError.message));
  });
} else {
  message("loginMessage", "Configure Supabase e API em frontend/config.js antes de entrar.");
}
