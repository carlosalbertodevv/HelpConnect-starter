# HelpConnect — Fases 1 a 4

Base do painel para atendimentos remotos autorizados: autenticação de atendentes com Supabase Auth, API Express, PostgreSQL/Prisma, cadastro de clientes, links temporários, consentimento e histórico auditável. A Fase 2 adiciona WebSocket autenticado e sinalização WebRTC.

As Fases 1 a 4 fornecem painel, backend, consentimento, captura/transmissão Android e interações remotas autorizadas. O consentimento inicial cobre compartilhamento e interações; a captura e a acessibilidade ainda exigem as autorizações oficiais e manuais do Android. A implementação requer validação em dispositivo físico para confirmar mídia e ações ponta a ponta.

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

Sirva a pasta `frontend` por um servidor estático local (por exemplo, VS Code Live Server). O link de consentimento abre no navegador Windows por padrão em `http://localhost:5500/client.html`. Para abrir esse link no emulador, configure `PUBLIC_APP_URL=http://10.0.2.2:5500` se o servidor servir `frontend` como raiz, ou acrescente `/frontend` se servir a raiz do repositório. Não abra os HTMLs por `file://`.

### Executar no Android Emulator

1. Inicie o backend na raiz do projeto com `npm run dev`. Por padrão, ele escuta em `0.0.0.0:3001`; no Windows, confirme que `http://localhost:3001/api/health` responde. Se o Firewall do Windows bloquear a conexão, permita o Node.js na rede privada local.
2. Sirva o `frontend` com o VS Code Live Server. O painel no navegador Windows continua usando `http://localhost:3001/api`; no navegador do emulador, `frontend/config.js` seleciona `http://10.0.2.2:3001/api`.
3. Inicie um Android Emulator e execute:

   ```powershell
   cd android
   .\gradlew.bat testDebugUnitTest assembleDebug installDebug
   ```

   O build `debug` usa por padrão `http://10.0.2.2:3001/api`; esse endereço aponta do emulador para o host Windows. A propriedade Gradle `helpconnectApiBaseUrl` ou a variável `HELPCONNECT_API_BASE_URL` pode substituí-lo para outros ambientes de desenvolvimento.
4. Abra o link de consentimento no navegador local do Windows. Após o consentimento, gere uma credencial Android no painel e informe o código e a credencial no app. A validação HTTP usa `POST /api/public/sessions/device-session`; a sinalização usa `ws://10.0.2.2:3001/ws`. Um ticket novo é necessário após falha ou desconexão.

Builds release exigem uma URL HTTPS fornecida por `-PhelpconnectApiBaseUrl="https://api.seudominio.com/api"` ou `HELPCONNECT_API_BASE_URL`; HTTP permanece desabilitado em release. O backend aceita as origens web listadas em `APP_ORIGINS` (ou `APP_ORIGIN` legado); CORS não é exigido pelo cliente nativo Android. A compilação e a conexão de sinalização não comprovam a transmissão: valide frames reais no painel antes de considerar o fluxo WebRTC aprovado.

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
- CORS restrito às origens locais listadas em `APP_ORIGINS` (ou `APP_ORIGIN` legado), Helmet, validação Zod, rate limiting e exigência de HTTPS quando `NODE_ENV=production`.
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
- Use URLs HTTPS em `APP_ORIGINS` (ou `APP_ORIGIN`) e `PUBLIC_APP_URL`.
- Configure `frontend/config.js` com a URL HTTPS da API e use `sslmode=require` na conexão PostgreSQL quando o provedor oferecer TLS.
- Configure o proxy reverso para encaminhar HTTPS e defina `TRUST_PROXY=1` (ou a quantidade exata de saltos confiáveis) somente quando a API estiver atrás de proxy(s) que sobrescrevam `X-Forwarded-Proto` e `X-Forwarded-For`.
- Restrinja firewall, origem web e acesso ao PostgreSQL. TLS deve terminar num proxy reverso confiável; não exponha a API sem HTTPS.

O rate limiter incluído mantém contadores em memória por processo. Em produção com múltiplas instâncias, substitua por um store compartilhado antes de escalar.

## Fase 3: aplicativo Android

O projeto Android nativo fica em `android/`. Consulte [docs/FASE3.md](./docs/FASE3.md) para o fluxo completo, configuração e limitações; [docs/ANDROID.md](./docs/ANDROID.md) para compilar e instalar; [docs/MEDIAPROJECTION.md](./docs/MEDIAPROJECTION.md) para permissões e captura; [docs/WEBRTC-ANDROID.md](./docs/WEBRTC-ANDROID.md) para mídia/sinalização; e [docs/TESTES-FASE3.md](./docs/TESTES-FASE3.md) para validação.

No build Debug, o app abre em modo de desenvolvimento para navegação local sem sessão; esse modo não cria tickets, simula consentimento nem inicia captura/transmissão. O fluxo real continua disponível mediante código público e ticket de uso único gerado pelo atendente. Release não inclui o modo de demonstração e continua exigindo as autorizações da sessão e do diálogo oficial do Android antes de capturar a tela. Esta implementação ainda precisa de validação ponta a ponta em dispositivo físico.

## Escopo das fases

A Fase 2 prepara o painel para receber uma `MediaStream` real e encaminha sinalização WebRTC. A Fase 3 adiciona captura consentida por `MediaProjection`/Foreground Service. A Fase 4 integra compartilhamento e interações remotas no consentimento da sessão, sem pedido/aprovação adicional de controle. Consulte também [docs/FASE2.md](./docs/FASE2.md), [docs/WEBSOCKET.md](./docs/WEBSOCKET.md), [docs/WEBRTC.md](./docs/WEBRTC.md), [docs/COTURN.md](./docs/COTURN.md) e [docs/TESTES-FASE2.md](./docs/TESTES-FASE2.md).

## Fase 4

A Fase 4 integra os contratos existentes, mostra vídeo e disponibilidade real das interações no painel e documenta validação e implantação. Consulte [docs/FASE4.md](./docs/FASE4.md), [docs/CONTROLE-REMOTO.md](./docs/CONTROLE-REMOTO.md), [docs/INTEGRACAO-WEBRTC.md](./docs/INTEGRACAO-WEBRTC.md), [docs/TESTES-END-TO-END.md](./docs/TESTES-END-TO-END.md) e [docs/DEPLOY.md](./docs/DEPLOY.md).

Não afirmar que a transmissão está comprovada até que um aparelho físico conectado seja observado recebendo frames reais no painel.

py -m http.server 5500 --directory frontend