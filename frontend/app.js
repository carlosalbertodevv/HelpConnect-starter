// Preencha com a URL e a anon/publishable key do seu projeto Supabase.
const SUPABASE_URL = "https://SEU_PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "SUA_CHAVE_PUBLICA";
const API_URL = "http://localhost:3001/api";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let accessToken = null;

const $ = (id) => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle("hidden", !visible);
const message = (id, text) => $(id).textContent = text;

async function api(path, options={}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type":"application/json", ...(accessToken ? {Authorization:`Bearer ${accessToken}`} : {}), ...(options.headers||{}) }
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new Error(data.error || "Falha na solicitação.");
  return data;
}
async function enter(userSession) {
  accessToken = userSession.access_token;
  show("login", false); show("dashboard", true); show("logout", true);
  await loadSessions();
}
$("loginBtn").onclick = async () => {
  message("loginMessage", "Entrando...");
  const {data,error} = await sb.auth.signInWithPassword({email:$("email").value,password:$("password").value});
  if(error){message("loginMessage",error.message);return;}
  await enter(data.session);
};
$("logout").onclick = async () => { await sb.auth.signOut(); accessToken=null; show("dashboard",false);show("login",true);show("logout",false); };
$("newSession").onclick = () => show("newSessionPanel", $("newSessionPanel").classList.contains("hidden"));
$("createSession").onclick = async () => {
  try {
    const data = await api("/sessions",{method:"POST",body:JSON.stringify({clientName:$("clientName").value.trim()||undefined})});
    $("generatedLink").innerHTML = "";
    const link = document.createElement("a"); link.href=data.link; link.textContent=data.link; link.target="_blank"; link.rel="noopener";
    $("generatedLink").append("Link temporário: ",link);
    show("generatedLink",true); await loadSessions();
  } catch(e) { alert(e.message); }
};
$("refresh").onclick = loadSessions;
async function loadSessions() {
  try {
    const {sessions} = await api("/sessions");
    const root=$("sessions"); root.innerHTML="";
    if(!sessions.length){root.textContent="Nenhum atendimento criado.";return;}
    for(const s of sessions){
      const row=document.createElement("div");row.className="session";
      const info=document.createElement("div");
      const title=document.createElement("strong");title.textContent=s.clientName||"Cliente sem identificação";
      const detail=document.createElement("small");detail.textContent=`${new Date(s.createdAt).toLocaleString("pt-BR")} · Expira ${new Date(s.expiresAt).toLocaleString("pt-BR")}`;
      const status=document.createElement("span");status.className="status";status.textContent=s.status;
      info.append(title,detail);row.append(info,status);
      if(["PENDING","CONSENTED","CONNECTING","ACTIVE"].includes(s.status)){
        const end=document.createElement("button");end.className="ghost";end.textContent="Encerrar";
        end.onclick=async()=>{try{await api(`/sessions/${s.id}/end`,{method:"POST"});await loadSessions();}catch(e){alert(e.message);}};
        row.append(end);
      }
      root.append(row);
    }
  } catch(e) { $("sessions").textContent=e.message; }
}
(async()=>{const {data}=await sb.auth.getSession();if(data.session)await enter(data.session);})();
