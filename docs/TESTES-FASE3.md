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

- Backend: desafios e assinaturas EC P-256, validação da palavra-chave, código de pareamento temporário, isolamento por cliente, sessão única, consentimento e tickets de uso único. Testes WebSocket cobrem presença do atendente para um dispositivo que entra depois.
- Android: chave privada no Android Keystore, chamadas HTTP assinadas, código de pareamento, rejeições e falhas de rede; derivação `wss`; parser de join/ICE, SDP, candidatos e encerramento/revogação; cursor de sequência e cleanup idempotente.
- A suíte pré-existente das Fases 1 e 2 não foi removida nem enfraquecida.

## Resultado da validação automatizada

- Backend: `npm test` passou (41 testes); geração do Prisma Client e `npx prisma validate --schema backend/prisma/schema.prisma` passaram.
- Android: 16 testes unitários passaram e `assembleDebug` foi concluído com sucesso. APK: `android/app/build/outputs/apk/debug/app-debug.apk`.
- O build debug usa `http://10.0.2.2:3001/api` por padrão. Em aparelho físico, configure a URL LAN ou HTTPS.

## Verificação manual obrigatória

1. Inicie backend e painel com a migration aplicada no ambiente de teste; cadastre o cliente.
2. Instale o APK em dispositivo físico Android 8+ e informe URL alcançável da API.
3. No primeiro uso, digite `EUQUERO`; associe o código exibido ao cliente no painel.
4. Crie uma sessão para esse cliente; no app, digite `EUQUERO` novamente e confirme a identidade exibida.
5. Aguarde conexão WebSocket do atendente.
6. Conceda notificações Android 13+ e aceite explicitamente o diálogo de captura.
7. Confirme no painel que o elemento de vídeo recebe frames reais (`ontrack`), observe estados WebRTC/ICE e confirme que não há transmissão antes do prompt do sistema.
8. Pare pelo app e pela ação da notificação; repita e encerre pelo painel e revogue o pareamento.
9. Teste chave/desafio inválidos ou repetidos, código expirado, sessão de outro cliente, múltiplas sessões, rejeição do diálogo, perda de rede, troca de Wi-Fi e bloqueio/retorno do app.
10. Repita em Samsung, Motorola, Xiaomi e Pixel e nas versões Android suportadas.

## Resultado deste workspace

Os testes automatizados e builds foram executados neste workspace. Não havia dispositivo Android conectado; a captura real de `MediaProjection`, negociação WebRTC com browser e recebimento de vídeo não foram realizados. Portanto, não há confirmação de transmissão real ponta a ponta.
