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

Os testes existentes cobrem pareamento, prova criptográfica do aparelho, palavra-chave, isolamento por cliente, tickets, ICE e sinalização WebSocket. Os testes do painel devem validar estados sem usar stream fictício.

## Cenarios de sinalizacao

- Login do atendente e acesso somente a sua sessao.
- Aparelho não pareado recebe código temporário; códigos inválidos ou expirados não podem ser associados.
- Prova de chave inválida, desafio expirado/repetido e palavra-chave incorreta são rejeitados.
- Aparelho pareado só localiza sessões do cliente associado; zero ou múltiplas sessões não autorizam entrada.
- Confirmação explícita antes da emissão de ticket; ticket expirado, consumido e revogado.
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
6. No painel, associe o código de pareamento ao cliente e crie uma sessão para esse cliente.
7. No app, digite `EUQUERO`, confira a identificação e confirme o atendimento.
8. Aguarde o atendente conectar.
9. Aceite o diálogo oficial de MediaProjection.
10. Confirme no painel `ontrack`, `<video>` e indicadores de WebRTC.
11. Interrompa pelo app, notificação ou painel; revogue também o pareamento e confirme que as sessões associadas são encerradas.

Nao declarar validacao fisica sem um aparelho conectado e frames recebidos observados no painel.
