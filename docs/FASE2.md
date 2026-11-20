# HelpConnect — Fase 2: comunicação em tempo real

A Fase 2 adiciona sinalização autenticada ao servidor HTTP existente, sem alterar o esquema ou as migrations da Fase 1. O servidor usa `ws`, autenticação Supabase do atendente, autorização da sessão no PostgreSQL e consentimento `SUPPORT_SESSION` ainda válido. As conexões são encerradas quando a sessão termina, expira ou o cliente revoga o consentimento.

Esta fase **não captura nem transmite tela por si só**, não executa ações remotas e não substitui a autorização Android do `MediaProjection`. A área de vídeo do painel só recebe uma `MediaStream` real quando um futuro aplicativo Android autorizado enviar mídia WebRTC.

## Arquitetura e limites

- O `WebSocketServer` compartilha o servidor HTTP da API no caminho `/ws`.
- O atendente autentica com token Supabase; o servidor confirma que é dono da sessão.
- O ticket Android é curto e de uso único. No fluxo atual, o backend o emite após a confirmação explícita do aparelho pareado; não é copiado nem enviado manualmente pelo atendente.
- Os dois participantes precisam estar na mesma sessão, não expirada, com consentimento ativo. A autorização é revalidada nas mensagens e periodicamente durante a conexão.
- Offer, answer, ICE candidate e estados WebRTC são encaminhados ao outro participante; SDP e candidates não são armazenados.
- As credenciais e limites de conexões/tickets são locais ao processo. Reiniciar o processo invalida tickets e conexões. Antes de escalar para várias instâncias, será necessário um serviço compartilhado atômico para tickets, limites e sequências anti-replay.
- Não são necessárias novas tabelas ou migrations.

## Instalação e execução no Windows

Mantenha os valores existentes do `.env` da Fase 1. Adicione somente as variáveis opcionais abaixo quando necessário:

```dotenv
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_SECRET=
TURN_CREDENTIAL_TTL_SECONDS=3600
DEVICE_TICKET_TTL_SECONDS=120
```

`TURN_SECRET` é um segredo compartilhado com o Coturn e deve conter pelo menos 32 caracteres. Não o coloque no frontend, no Git ou em tickets/issues. Sem `TURN_URLS`, o servidor usa STUN e não exige Coturn.

No PowerShell:

```powershell
npm install
npm run prisma:generate
npm run dev
```

Sirva `frontend/` em `http://localhost:5500` e configure `frontend/config.js` com a URL da API para o painel web. O app Android não abre link: no emulador, usa `http://10.0.2.2:3001/api`. A comunicação local usa `ws://`; produção exige HTTPS/WSS por meio de um proxy reverso confiável e `TRUST_PROXY` configurado conforme a implantação.

## Rotas adicionais

- `POST /api/public/sessions/device-challenge` e `/device-session` — desafio assinado, validação de `EUQUERO` e resolução da sessão limitada ao cliente do aparelho pareado.
- `POST /api/public/sessions/device-consent` — registra confirmação no app e emite o ticket efêmero consumido pelo handshake WebSocket.
- `GET /api/sessions/:id/ice-servers` — autenticada; retorna STUN e credenciais TURN temporárias, quando Coturn está configurado.
- `POST /api/public/sessions/revoke` — recebe o token do link no corpo, revoga o consentimento, encerra o atendimento e desconecta participantes.

O painel oferece conexão de sinalização, estado do dispositivo/WebRTC, visualização de `MediaStream` e botão de encerramento. Esta documentação descreve a evolução da sinalização na Fase 2; o fluxo de pareamento e entrada Android atual está em [FASE3.md](./FASE3.md).

## Ubuntu

Use Node.js 20+, PostgreSQL e as instruções de proxy/TLS para produção descritas na documentação da Fase 1. No diretório do projeto:

```bash
npm ci
npm run prisma:generate
npm run db:deploy
npm start
```

Configure o serviço para carregar as mesmas variáveis da Fase 1, defina `NODE_ENV=production`, `APP_ORIGIN` e `PUBLIC_APP_URL` em HTTPS e encaminhe WebSocket (`Upgrade`/`Connection`) para a API. Consulte [COTURN.md](./COTURN.md) para relay TURN opcional.

## Testes

```powershell
npm test
npx prisma validate
npm audit
```

Os testes WebSocket usam um servidor HTTP local e dependências simuladas; não iniciam transmissão de mídia nem requerem Supabase/PostgreSQL ativos. Confira [TESTES-FASE2.md](./TESTES-FASE2.md) para os cenários e limitações.

## Próxima fase

A Fase 3 adiciona o app Android, o pareamento do aparelho e a captura somente via diálogo oficial de `MediaProjection`/Foreground Service. Consulte [FASE3.md](./FASE3.md) e [ANDROID.md](./ANDROID.md). Nenhum bypass de permissão é previsto.
