# Implantacao

## Backend

- Use Node.js 20+, PostgreSQL gerenciado, HTTPS e WSS.
- Configure `DATABASE_URL` com TLS.
- Defina `NODE_ENV=production`, `APP_ORIGINS` (ou `APP_ORIGIN`) e `PUBLIC_APP_URL` em HTTPS. Em `APP_ORIGINS`, liste somente origens confiáveis separadas por vírgula.
- Configure `TRUST_PROXY` com a quantidade real de proxies confiaveis.
- Configure COTURN quando NAT/firewall exigir relay.
- Execute migrations com `npm run db:deploy`.

## Painel

Configure `frontend/config.js` com:

- URL HTTPS do projeto Supabase.
- Chave anon/publishable do Supabase.
- URL da API, terminando em `/api`.

Nunca use `service_role` no navegador.

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
- O heartbeat detecta socket morto, mas reconexao segura requer novo ticket.
- TURN e HTTPS sao requisitos operacionais para muitos ambientes NAT.
- Ainda nao existe evidenca de frames reais sem teste em aparelho fisico.
