# HelpConnect — Fases 1 a 3

Base do painel para atendimentos remotos autorizados: autenticação de atendentes com Supabase Auth, API Express, PostgreSQL/Prisma, cadastro de clientes, links temporários, consentimento e histórico auditável. A Fase 2 adiciona WebSocket autenticado e sinalização WebRTC.

As Fases 1 e 2 fornecem o painel, backend, consentimento e sinalização. A Fase 3 acrescenta o cliente Android para captura e transmissão de tela após autorizações separadas da sessão e do Android. A implementação ainda requer validação em dispositivo físico para confirmar a captura e a mídia ponta a ponta. Não há controle remoto.

## Requisitos

- Node.js 20+
- PostgreSQL
- Projeto Supabase com Auth habilitado
- Navegador moderno

## Configuração local (PowerShell)

```powershell
npm install
```

Use o `.env` local existente; não o sobrescreva. Se ainda não estiver configurado, crie-o com `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_ANON_KEY` antes de iniciar. Depois:

```powershell
npm run prisma:generate
npm run db:migrate
npm run dev
```

Sirva a pasta `frontend` por um servidor estático local (por exemplo, VS Code Live Server). Se o servidor usar a raiz do repositório, configure `PUBLIC_APP_URL` com o sufixo `/frontend` (ex.: `http://127.0.0.1:5500/frontend`); se a raiz servida já for a pasta `frontend`, use somente a origem (ex.: `http://127.0.0.1:5500`). Não abra os HTMLs por `file://`.

Configure `frontend/config.js` com:

- URL do projeto Supabase.
- Chave anon/publishable do Supabase. Essa chave é pública por definição; nunca use `service_role` no navegador.
- URL da API (`http://localhost:3001/api` no desenvolvimento).

Após alterar `PUBLIC_APP_URL`, reinicie a API e gere um novo atendimento: links já criados mantêm a URL anterior.

Crie o usuário atendente no Supabase Auth. O perfil correspondente é sincronizado no banco na primeira chamada autenticada.

## Funcionalidades da Fase 1

- Login e logout de atendentes via Supabase Auth.
- Painel responsivo com indicadores, histórico, status e código de atendimento.
- Cadastro, edição, arquivamento e reativação de clientes.
- Criação e encerramento de atendimentos.
- Link aleatório e temporário; token bruto exibido somente ao gerar o link e armazenado no banco somente como SHA-256.
- Token enviado no corpo das requisições públicas, não em parâmetros de URL. O link usa fragmento (`#token`) para que o navegador não envie o token ao servidor web no carregamento inicial.
- Consentimento ou recusa explícitos, registrados com data e evento de auditoria. O consentimento é aceito uma única vez.
- Autorização por atendente nos dados e nas ações de clientes/sessões.
- CORS restrito à origem configurada, Helmet, validação Zod, rate limiting e exigência de HTTPS quando `NODE_ENV=production`.
- Migrations versionadas e testes automatizados para geração/hash de tokens e formato do código.
- WebSocket com autenticação Supabase para atendentes, credenciais Android temporárias de uso único, autorização por sessão/consentimento, sinalização WebRTC e encerramento por expiração/revogação.
- Configuração STUN/TURN opcional com credenciais temporárias; nenhuma senha TURN no frontend.

## Rotas principais

- `GET /api/health` — verificação básica do processo.
- `GET /api/sessions/dashboard` — indicadores do atendente autenticado.
- `GET /api/sessions` — histórico do atendente autenticado.
- `POST /api/sessions` — cria sessão; retorna link e código.
- `POST /api/sessions/:id/end` — encerra sessão própria.
- `GET/POST/PATCH/DELETE /api/clients` — lista, cadastra, atualiza e arquiva clientes próprios.
- `POST /api/public/sessions/lookup` — valida link, recebendo `{ "token": "..." }`.
- `POST /api/public/sessions/device-session` — resolve código público e ticket temporário em um `sessionId`; não consome o ticket.
- `POST /api/public/sessions/consent` — registra consentimento explícito.
- `POST /api/public/sessions/reject` — registra recusa.
- `POST /api/public/sessions/revoke` — revoga consentimento e encerra a comunicação.
- `POST /api/sessions/:id/device-ticket` — emite credencial Android curta, de uso único e somente após consentimento.
- `GET /api/sessions/:id/ice-servers` — configura ICE; credenciais TURN são temporárias.
- `ws(s)://<api-host>/ws` — autenticação/participação e sinalização da sessão.

As rotas autenticadas esperam `Authorization: Bearer <supabase_access_token>`. Operações e dados de clientes são isolados pelo identificador do atendente autenticado.

## Testes e migrations

```powershell
npm test
npx prisma validate --schema backend/prisma/schema.prisma
npm run prisma:generate
```

Em desenvolvimento, aplique migrations com `npm run db:migrate`; em produção, use `npm run db:deploy`.

Se você já tinha um banco da versão anterior sem migrations versionadas no repositório, faça backup e confira o histórico/schema antes de aplicar esta cadeia de migrations; não marque migrations como aplicadas sem verificar equivalência.

## Variáveis de ambiente do backend

Veja `.env.example`. `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_ANON_KEY` são obrigatórias. Em produção:

- Defina `NODE_ENV=production`.
- Use URLs HTTPS em `APP_ORIGIN` e `PUBLIC_APP_URL`.
- Configure `frontend/config.js` com a URL HTTPS da API e use `sslmode=require` na conexão PostgreSQL quando o provedor oferecer TLS.
- Configure o proxy reverso para encaminhar HTTPS e defina `TRUST_PROXY=1` (ou a quantidade exata de saltos confiáveis) somente quando a API estiver atrás de proxy(s) que sobrescrevam `X-Forwarded-Proto` e `X-Forwarded-For`.
- Restrinja firewall, origem web e acesso ao PostgreSQL. TLS deve terminar num proxy reverso confiável; não exponha a API sem HTTPS.

O rate limiter incluído mantém contadores em memória por processo. Em produção com múltiplas instâncias, substitua por um store compartilhado antes de escalar.

## Fase 3: aplicativo Android

O projeto Android nativo fica em `android/`. Consulte [docs/FASE3.md](./docs/FASE3.md) para o fluxo completo, configuração e limitações; [docs/ANDROID.md](./docs/ANDROID.md) para compilar e instalar; [docs/MEDIAPROJECTION.md](./docs/MEDIAPROJECTION.md) para permissões e captura; [docs/WEBRTC-ANDROID.md](./docs/WEBRTC-ANDROID.md) para mídia/sinalização; e [docs/TESTES-FASE3.md](./docs/TESTES-FASE3.md) para validação.

O aplicativo pede o código público e o ticket de uso único gerado pelo atendente. O ticket deve ser transferido por canal seguro. A captura exige uma confirmação separada no diálogo oficial do Android e uma notificação de foreground service. Esta implementação ainda precisa de validação ponta a ponta em dispositivo físico.

## Escopo das fases

A Fase 2 prepara o painel para receber uma `MediaStream` real e encaminha sinalização WebRTC. A Fase 3 adiciona o aplicativo Android, captura consentida por `MediaProjection`/Foreground Service e transmissão de tela. Nenhuma fase implementa controle remoto. Consulte também [docs/FASE2.md](./docs/FASE2.md), [docs/WEBSOCKET.md](./docs/WEBSOCKET.md), [docs/WEBRTC.md](./docs/WEBRTC.md), [docs/COTURN.md](./docs/COTURN.md) e [docs/TESTES-FASE2.md](./docs/TESTES-FASE2.md).
