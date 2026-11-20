# HelpConnect — Fases 1 a 4

Base do painel para atendimentos remotos autorizados: autenticação de atendentes com Supabase Auth, API Express, PostgreSQL/Prisma, cadastro de clientes, pareamento de aparelhos, consentimento e histórico auditável. A Fase 2 adiciona WebSocket autenticado e sinalização WebRTC.

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

Sirva `frontend/` por um servidor estático local (por exemplo, VS Code Live Server) para usar o painel e a página web legada de consentimento. O app Android não abre link nem depende de `PUBLIC_APP_URL`; seleciona `http://10.0.2.2:3001/api` no emulador e o IP LAN do computador no celular físico (ambos na mesma Wi-Fi). Não abra os HTMLs por `file://`.

### Executar no Android Emulator

1. Inicie o backend na raiz do projeto com `npm run dev`. Por padrão, ele escuta em `0.0.0.0:3001`; no Windows, confirme que `http://localhost:3001/api/health` responde. Se o Firewall do Windows bloquear a conexão, permita o Node.js na rede privada local.
2. Sirva o `frontend` com o VS Code Live Server. O painel no navegador Windows continua usando `http://localhost:3001/api`; no navegador do emulador, `frontend/config.js` seleciona `http://10.0.2.2:3001/api`.
3. Inicie um Android Emulator e execute:

   ```powershell
   cd android
   .\gradlew.bat testDebugUnitTest assembleDebug installDebug
   ```

   O build `debug` seleciona a API do emulador (`10.0.2.2`) ou do celular físico (IP LAN detectado ao compilar). Se a detecção não corresponder à sua Wi-Fi, informe `-PhelpconnectLanApiBaseUrl="http://IP_DO_COMPUTADOR:3001/api"`. No Windows, permita Node.js/porta TCP 3001 na rede privada do Firewall.
4. Cadastre o cliente e pareie o aparelho uma vez na tela **Clientes**. No primeiro uso, o app exibirá um código de pareamento; o atendente verifica a identidade do cliente e associa o código ao cadastro. Depois, crie um atendimento para esse cliente. No Android, o cliente digita somente `EUQUERO`, confere o atendimento e confirma. A captura ainda depende da autorização nativa do Android. A validação usa `POST /api/public/sessions/device-session` e `POST /api/public/sessions/device-consent`; a sinalização usa o host correspondente (`10.0.2.2` no emulador ou IP LAN no celular).

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
- WebSocket com autenticação Supabase para atendentes, tickets Android temporários emitidos após consentimento, autorização por sessão/consentimento, sinalização WebRTC e encerramento por expiração/revogação.
- Configuração STUN/TURN opcional com credenciais temporárias; nenhuma senha TURN no frontend.

## Rotas principais

- `GET /api/health` — verificação básica do processo.
- `GET /api/sessions/dashboard` — indicadores do atendente autenticado.
- `GET /api/sessions` — histórico do atendente autenticado.
- `POST /api/sessions` — cria sessão pendente para um cliente cadastrado; retorna código.
- `POST /api/sessions/:id/end` — encerra sessão própria.
- `GET/POST/PATCH/DELETE /api/clients` — lista, cadastra, atualiza e arquiva clientes próprios.
- `GET /api/devices` — lista aparelhos pareados aos clientes do atendente.
- `POST /api/devices/pair` — associa um código de pareamento temporário a um cliente próprio.
- `POST /api/devices/:id/revoke` — revoga o pareamento e encerra sessões ativas do aparelho.
- `POST /api/public/sessions/lookup` — valida link de consentimento web legado, recebendo `{ "token": "..." }`.
- `POST /api/public/sessions/device-challenge` — emite desafio curto para prova criptográfica do aparelho.
- `POST /api/public/sessions/device-session` — valida `EUQUERO`, a chave do aparelho pareado e localiza a única sessão ativa do cliente.
- `POST /api/public/sessions/device-consent` — registra a confirmação explícita no Android e emite ticket WebSocket de uso único.
- `POST /api/public/sessions/consent` — registra consentimento explícito.
- `POST /api/public/sessions/reject` — registra recusa.
- `POST /api/public/sessions/revoke` — revoga consentimento e encerra a comunicação.
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

`db:migrate` e `db:deploy` alteram o banco apontado por `DATABASE_URL`. Confira o destino antes de executar qualquer migration; não aplique a migration de pareamento em banco remoto/compartilhado sem autorização explícita. Se você já tinha um banco da versão anterior sem migrations versionadas no repositório, faça backup e confira o histórico/schema antes de aplicar esta cadeia; não marque migrations como aplicadas sem verificar equivalência.

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

No build Debug, o app abre diretamente na entrada por palavra-chave. O primeiro uso de um aparelho exige pareamento aprovado pelo atendente; depois, `EUQUERO` localiza o atendimento vinculado ao cliente. A confirmação no app registra o consentimento, e a captura continua exigindo autorização oficial do Android. A chave privada de identidade é gerada no Android Keystore e nunca é embutida no APK. A nova migration de pareamento está versionada, mas não foi aplicada a nenhum banco remoto.

## Escopo das fases

A Fase 2 prepara o painel para receber uma `MediaStream` real e encaminha sinalização WebRTC. A Fase 3 adiciona captura consentida por `MediaProjection`/Foreground Service. A Fase 4 integra compartilhamento e interações remotas no consentimento da sessão, sem pedido/aprovação adicional de controle. Consulte também [docs/FASE2.md](./docs/FASE2.md), [docs/WEBSOCKET.md](./docs/WEBSOCKET.md), [docs/WEBRTC.md](./docs/WEBRTC.md), [docs/COTURN.md](./docs/COTURN.md) e [docs/TESTES-FASE2.md](./docs/TESTES-FASE2.md).

## Fase 4

A Fase 4 integra os contratos existentes, mostra vídeo e disponibilidade real das interações no painel e documenta validação e implantação. Consulte [docs/FASE4.md](./docs/FASE4.md), [docs/CONTROLE-REMOTO.md](./docs/CONTROLE-REMOTO.md), [docs/INTEGRACAO-WEBRTC.md](./docs/INTEGRACAO-WEBRTC.md), [docs/TESTES-END-TO-END.md](./docs/TESTES-END-TO-END.md) e [docs/DEPLOY.md](./docs/DEPLOY.md).

Não afirmar que a transmissão está comprovada até que um aparelho físico conectado seja observado recebendo frames reais no painel.

py -m http.server 5500 --directory frontend