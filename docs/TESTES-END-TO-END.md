# Testes End-to-End

## Automatizados

```powershell
npm test
npx prisma validate --schema backend/prisma/schema.prisma
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug
.\gradlew.bat lintDebug
```

Os testes existentes cobrem tokens, ICE, resolucao de tickets e sinalizacao WebSocket. Os testes do painel devem validar estados sem usar stream ficticio.

## Cenarios de sinalizacao

- Login do atendente e acesso somente a sua sessao.
- Consentimento antes da emissao de ticket.
- Ticket expirado, consumido e revogado.
- Offer/Answer e candidates em ambas as direcoes.
- Sequence e nonce contra replay.
- Segunda conexao substituindo o mesmo papel.
- Encerramento por atendente e revogacao.
- Expiracao e falha de rede.

## Teste em aparelho fisico

1. Ative Opcoes do desenvolvedor e Depuracao USB.
2. Conecte o aparelho e aceite a depuracao.
3. Configure `helpconnectApiBaseUrl` com HTTPS ou uma URL LAN acessivel.
4. Compile e instale o APK debug.
5. Conceda notificacoes no Android 13+.
6. No painel, registre consentimento e gere ticket/codigo.
7. Informe codigo e ticket no app.
8. Aguarde o atendente conectar.
9. Aceite o dialogo oficial de MediaProjection.
10. Confirme no painel `ontrack`, `<video>` e indicadores de WebRTC.
11. Interrompa pelo app, notificacao ou painel e confirme que a captura para.

Nao declarar validacao fisica sem um aparelho conectado e frames recebidos observados no painel.
