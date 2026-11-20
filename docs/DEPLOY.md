# Implantacao

## Backend

- Use Node.js 20+, PostgreSQL gerenciado, HTTPS e WSS.
- Configure `DATABASE_URL` com TLS.
- Defina `NODE_ENV=production` e configure `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_ANON_KEY`. No Render, `RENDER_EXTERNAL_URL` é incluída automaticamente como origem do painel e como URL pública, caso `APP_ORIGINS`, `APP_ORIGIN` ou `PUBLIC_APP_URL` não sejam informadas.
- Se o painel estiver em outro domínio, defina `APP_ORIGINS` com as origens confiáveis em HTTPS e `PUBLIC_APP_URL` com a URL HTTPS desse painel.
- Configure `TRUST_PROXY` com a quantidade real de proxies confiaveis.
- Configure COTURN quando NAT/firewall exigir relay.
- Execute migrations com `npm run db:deploy`.

## Painel

O backend serve o painel e `client.html` na raiz do mesmo domínio da API. Assim, `frontend/config.js` seleciona automaticamente `/api` em produção. Para desenvolvimento local, ele mantém a API em `localhost:3001` ou `10.0.2.2:3001`.

O arquivo contém a URL e a chave anon/publishable do Supabase. Nunca use `service_role` no navegador.

## Android

Compile release somente com HTTPS:

```powershell
cd android
.\gradlew.bat assembleRelease -PhelpconnectApiBaseUrl="https://api.seudominio.com/api"
```

O build release falha sem HTTPS e sem segredo permanente no APK. Para debug local, use LAN ou `10.0.2.2` no emulador.

## Limites conhecidos

- Tickets, limites, monitoramento e sequencias anti-replay sao locais ao processo.
- Multiplas instancias exigem Redis/armazenamento compartilhado antes do deploy escalado.
- O heartbeat detecta socket morto, mas reconexão segura do dispositivo requer nova confirmação no app para emitir outro ticket.
- TURN e HTTPS sao requisitos operacionais para muitos ambientes NAT.
- Ainda nao existe evidenca de frames reais sem teste em aparelho fisico.
