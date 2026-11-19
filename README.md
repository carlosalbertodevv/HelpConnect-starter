# HelpConnect — primeira etapa

Este starter implementa a base inicial: autenticação de atendentes com Supabase, API Express, PostgreSQL/Prisma, criação de links temporários, registro de consentimento e painel web.

**Ainda não transmite tela nem envia comandos de controle.** Essa parte depende do aplicativo Android nativo (Kotlin), MediaProjection, AccessibilityService devidamente declarado/autorizado, WebRTC e infraestrutura STUN/TURN. O consentimento web sozinho não concede permissões Android.

## Requisitos
- Node.js 20+
- PostgreSQL
- Projeto Supabase (Auth habilitado)
- Navegador moderno

## Instalação no Windows / PowerShell

```powershell
cd HelpConnect
Copy-Item .env.example .env
npm install
```

Edite `.env` com PostgreSQL e credenciais Supabase. Depois:

```powershell
npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

Em outro terminal, sirva a pasta `frontend` por um servidor estático local (por exemplo, VS Code Live Server na porta 5500). Não abra `index.html` diretamente como `file://`.

## Configuração do painel
Edite `frontend/app.js` e informe:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `API_URL` (local: `http://localhost:3001/api`)

Crie o usuário atendente no Supabase Auth. Não coloque `service_role` no navegador.

## Fluxos implementados
- `POST /api/sessions` — cria sessão autenticada e devolve link de uso único/temporário.
- `GET /api/sessions` — lista sessões do atendente autenticado.
- `POST /api/sessions/:id/end` — encerra sessão.
- `GET /api/public/sessions/:token` — verifica link.
- `POST /api/public/sessions/:token/consent` — registra consentimento explícito.

O token bruto só é entregue na criação do link; no banco é armazenado apenas seu SHA-256. A URL usa fragmento (`#token`) para evitar que o token seja enviado automaticamente no cabeçalho HTTP/referer.

## Antes de produção
1. Coloque API e banco atrás de HTTPS.
2. Restrinja CORS ao domínio real.
3. Use rate limiting, proteção contra abuso e monitoramento.
4. Adicione política de privacidade, retenção e auditoria.
5. Implemente expiração/revogação robusta e notificações em tempo real.
6. Configure VPS para WebSocket e TURN (Coturn), além de firewall.
7. Faça revisão de segurança e teste com dispositivos próprios antes de atender clientes.

O link temporário não substitui o consentimento dentro do Android. O cliente deve iniciar explicitamente a captura de tela pelo diálogo oficial do sistema e poder interromper o compartilhamento.
