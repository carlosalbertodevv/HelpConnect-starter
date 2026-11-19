const API_URL = "http://localhost:3001/api";
const token = location.hash.slice(1);
const $ = id => document.getElementById(id);
const status = text => $("status").textContent=text;
async function request(path,options={}) {
  const r=await fetch(`${API_URL}${path}`,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Não foi possível concluir.");
  return d;
}
$("agree").onchange=()=>{$("accept").disabled=!$("agree").checked;};
(async()=>{
  if(!token){status("Link ausente ou inválido.");return;}
  try{const data=await request(`/public/sessions/${encodeURIComponent(token)}`);status(`Atendimento disponível${data.session.clientName?` para ${data.session.clientName}`:""}.`);$("consentArea").classList.remove("hidden");}
  catch(e){status(e.message);}
})();
$("accept").onclick=async()=>{
  $("accept").disabled=true;
  try{
    const data=await request(`/public/sessions/${encodeURIComponent(token)}/consent`,{method:"POST",body:JSON.stringify({accepted:true})});
    status(data.message);$("consentArea").classList.add("hidden");
  }catch(e){$("result").textContent=e.message;$("accept").disabled=false;}
};
