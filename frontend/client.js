const { apiUrl } = window.HELPCONNECT_CONFIG || {};
const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
let sessionAvailable = false;
let sessionCanRevoke = false;

if (token) history.replaceState(null, "", `${location.pathname}${location.search}`);

async function request(path, body) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir.");
  return data;
}

$("agree").onchange = () => { $("accept").disabled = !$("agree").checked; };

(async () => {
  if (!apiUrl) {
    $("status").textContent = "O serviço não está configurado.";
    return;
  }
  if (!token) {
    $("status").textContent = "Link ausente ou inválido.";
    return;
  }
  try {
    const data = await request("/public/sessions/lookup", { token });
    const client = data.session.clientName ? ` para ${data.session.clientName}` : "";
    $("status").textContent = `Atendimento ${data.session.publicCode}${client}, válido até ${new Date(data.session.expiresAt).toLocaleString("pt-BR")}.`;
    if (data.session.status === "PENDING") {
      sessionAvailable = true;
      $("consentArea").classList.remove("hidden");
    } else if (["CONSENTED", "CONNECTING", "ACTIVE"].includes(data.session.status)) {
      sessionCanRevoke = true;
      $("revokeArea").classList.remove("hidden");
    } else if (data.session.status === "ENDED") {
      $("status").textContent = "Este atendimento foi encerrado.";
    } else {
      $("status").textContent += " O consentimento já foi registrado.";
    }
  } catch (error) {
    $("status").textContent = error.message;
  }
})();

$("accept").onclick = async () => {
  if (!sessionAvailable || !$("agree").checked) return;
  $("accept").disabled = true;
  try {
    const data = await request("/public/sessions/consent", { token, accepted: true });
    sessionAvailable = false;
    sessionCanRevoke = true;
    $("status").textContent = data.message;
    $("consentArea").classList.add("hidden");
    $("revokeArea").classList.remove("hidden");
  } catch (error) {
    $("result").textContent = error.message;
    $("accept").disabled = false;
  }
};

$("revoke").onclick = async () => {
  if (!sessionCanRevoke) return;
  $("revoke").disabled = true;
  try {
    const data = await request("/public/sessions/revoke", { token });
    sessionCanRevoke = false;
    $("status").textContent = data.message;
    $("revokeArea").classList.add("hidden");
  } catch (error) {
    $("result").textContent = error.message;
    $("revoke").disabled = false;
  }
};

$("decline").onclick = async () => {
  if (!sessionAvailable) return;
  $("decline").disabled = true;
  $("accept").disabled = true;
  try {
    const data = await request("/public/sessions/reject", { token });
    sessionAvailable = false;
    $("status").textContent = data.message;
    $("consentArea").classList.add("hidden");
  } catch (error) {
    $("result").textContent = error.message;
    $("decline").disabled = false;
    $("accept").disabled = !$("agree").checked;
  }
};
