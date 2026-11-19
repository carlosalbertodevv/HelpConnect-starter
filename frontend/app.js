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

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle("hidden", !visible);
const message = (id, text) => { $(id).textContent = text; };

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
  const clients = view === "clients";
  show("sessionsView", !clients);
  show("clientsView", clients);
  $("showSessions").classList.toggle("selected", !clients);
  $("showClients").classList.toggle("selected", clients);
}

async function enter(userSession) {
  accessToken = userSession.access_token;
  show("login", false);
  show("dashboard", true);
  show("logout", true);
  await Promise.all([loadSessions(), loadClients(), loadDashboard()]);
}

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
  show("dashboard", false);
  show("login", true);
  show("logout", false);
};

sb?.auth.onAuthStateChange((_event, session) => {
  accessToken = session?.access_token ?? null;
});

$("newSession").onclick = () => show("newSessionPanel", $("newSessionPanel").classList.contains("hidden"));
$("showSessions").onclick = () => setView("sessions");
$("showClients").onclick = () => setView("clients");
$("refresh").onclick = async () => {
  await Promise.all([loadSessions(), loadDashboard()]);
};

$("createSession").onclick = async () => {
  const clientId = $("sessionClient").value;
  const clientName = $("clientName").value.trim();
  const payload = clientId ? { clientId } : (clientName ? { clientName } : {});
  $("createSession").disabled = true;
  try {
    const data = await api("/sessions", { method: "POST", body: JSON.stringify(payload) });
    const linkArea = $("generatedLink");
    linkArea.replaceChildren();
    const code = document.createElement("strong");
    code.textContent = `Código: ${data.session.publicCode}`;
    const link = document.createElement("a");
    link.href = data.link;
    link.textContent = data.link;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "ghost";
    copy.textContent = "Copiar link";
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.link);
        copy.textContent = "Link copiado";
      } catch {
        message("sessionMessage", "Não foi possível copiar automaticamente; selecione o link para copiá-lo.");
      }
    };
    const note = document.createElement("small");
    note.textContent = "Guarde este link: o token não será exibido novamente. O link expira automaticamente.";
    linkArea.append(code, link, copy, note);
    show("generatedLink", true);
    message("sessionMessage", "");
    await Promise.all([loadSessions(), loadDashboard()]);
  } catch (error) {
    message("sessionMessage", error.message);
  } finally {
    $("createSession").disabled = false;
  }
};

async function loadDashboard() {
  try {
    const { metrics } = await api("/sessions/dashboard");
    $("metricTotal").textContent = metrics.total;
    $("metricPending").textContent = metrics.pending;
    $("metricConsented").textContent = metrics.consented;
    $("metricClients").textContent = metrics.clients;
  } catch (error) {
    message("sessionMessage", error.message);
  }
}

async function loadSessions() {
  try {
    const { sessions } = await api("/sessions");
    const root = $("sessions");
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
                if (video) video.srcObject = stream;
                if (placeholder) placeholder.classList.toggle("hidden", Boolean(stream));
              },
              onError: (text) => {
                const error = document.getElementById(`realtime-${session.id}-error`);
                if (error) error.textContent = text;
              }
            });
            realtimeConnections.set(session.id, connection);
            connect.textContent = "Desconectar";
          } catch (error) {
            message(`realtime-${session.id}-error`, error.message);
          }
        };
        const ticketButton = document.createElement("button");
        ticketButton.type = "button";
        ticketButton.className = "ghost";
        ticketButton.textContent = "Gerar credencial Android";
        const ticketOutput = document.createElement("code");
        ticketOutput.className = "device-ticket";
        const copyTicket = document.createElement("button");
        copyTicket.type = "button";
        copyTicket.className = "ghost hidden";
        copyTicket.textContent = "Copiar credencial";
        copyTicket.onclick = async () => {
          try {
            await navigator.clipboard.writeText(ticketOutput.textContent);
            copyTicket.textContent = "Credencial copiada";
          } catch {
            message(`realtime-${session.id}-error`, "Não foi possível copiar a credencial; selecione-a manualmente.");
          }
        };
        ticketButton.onclick = async () => {
          ticketButton.disabled = true;
          try {
            const result = await api(`/sessions/${session.id}/device-ticket`, { method: "POST" });
            ticketOutput.textContent = result.deviceToken;
            copyTicket.classList.remove("hidden");
            message(`realtime-${session.id}-error`, `Credencial válida até ${new Date(result.expiresAt).toLocaleTimeString("pt-BR")}. ${result.message}`);
          } catch (error) {
            message(`realtime-${session.id}-error`, error.message);
          } finally {
            ticketButton.disabled = false;
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
        placeholder.textContent = "A tela só será exibida quando o aplicativo Android autorizado iniciar a captura com a permissão oficial do sistema. Nenhuma tela está sendo simulada.";
        const error = document.createElement("p");
        error.id = `realtime-${session.id}-error`;
        error.className = "message";
        error.setAttribute("aria-live", "polite");
        actions.append(connect, ticketButton, copyTicket);
        panel.append(heading, states, actions, ticketOutput, video, placeholder, error);
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
    const select = $("sessionClient");
    const selected = select.value;
    select.replaceChildren(new Option("Atendimento avulso", ""));
    root.replaceChildren();
    if (!clients.length) root.textContent = "Nenhum cliente cadastrado.";

    for (const client of clients) {
      if (client.isActive) select.add(new Option(client.name, client.id));
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
    if (selected && [...select.options].some((option) => option.value === selected)) select.value = selected;
  } catch (error) {
    $("clients").textContent = error.message;
  }
}

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
