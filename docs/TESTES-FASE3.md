# Testes da Fase 3

## Testes automatizados

Backend, na raiz:

```powershell
npm test
npx prisma validate --schema backend/prisma/schema.prisma
```

Android, em `android/`:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug assembleRelease
.\gradlew.bat assembleDebug -PhelpconnectApiBaseUrl="https://api.exemplo.com/api"
```

Cobertura adicionada:

- Backend: resolução de ticket válido apenas para código correspondente, sessão ativa/consentida e ticket não expirado; consulta não consome ticket. Testes WebSocket cobrem presença do atendente para um dispositivo que entra depois.
- Android: validação/formato do código e ticket; consulta HTTP, credenciais rejeitadas e falhas de rede; derivação `wss`; parser de join/ICE, SDP, candidatos e encerramento/revogação; cursor de sequência e cleanup idempotente.
- A suíte pré-existente das Fases 1 e 2 não foi removida nem enfraquecida.

## Resultado da validação automatizada

- Backend: `npm test` passou (25 testes); `npx prisma validate --schema backend/prisma/schema.prisma` passou.
- Android: 12 testes unitários passaram; `lintDebug`, `assembleDebug` e `assembleRelease` passaram.
- Lint Android reportou 0 erros e 10 avisos, incluindo avisos de versão mais recente disponível e `targetSdk` 35. O app usa `compileSdk` 36, mas permanece em `targetSdk` 35 para não ativar mudanças de comportamento do target 36 antes de validá-las em dispositivos.
- O build local usa `https://api.example.invalid/api` como valor padrão; configure a URL real antes de instalar para testes.

## Verificação manual obrigatória

1. Inicie backend e painel com banco/Supabase disponíveis; crie sessão e registre consentimento do cliente na web.
2. Mantenha o atendente conectado à sinalização e gere um novo ticket. Transfira o ticket por canal seguro.
3. Instale o APK em dispositivo físico Android 8+ e informe URL alcançável da API.
4. Abra o app, informe código/ticket e aguarde conexão WebSocket do atendente.
5. Conceda notificações Android 13+ e aceite explicitamente o diálogo de captura.
6. Confirme no painel que o elemento de vídeo recebe frames reais (`ontrack`), observe estados WebRTC/ICE e confirme que não há transmissão antes do prompt do sistema.
7. Pare pelo app e pela ação da notificação; repita e encerre pelo painel, revogue consentimento pela página do cliente e encerre via Android.
8. Teste ticket expirado, ticket repetido, código de outra sessão, rejeição do diálogo, perda de rede, troca de Wi-Fi e bloqueio/retorno do app.
9. Repita em Samsung, Motorola, Xiaomi e Pixel e nas versões Android suportadas.

## Resultado deste workspace

Os testes automatizados e builds foram executados neste workspace. Não havia dispositivo Android conectado; a captura real de `MediaProjection`, negociação WebRTC com browser e recebimento de vídeo não foram realizados. Portanto, não há confirmação de transmissão real ponta a ponta.
