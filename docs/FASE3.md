# HelpConnect — Fase 3: aplicativo Android nativo

## Escopo e estado

O projeto `android/` implementa um cliente Kotlin para compartilhar a tela e, após o consentimento da sessão, executar interações remotas suportadas pelo Android. A captura exige consentimento HelpConnect e aprovação explícita do diálogo oficial `MediaProjection`; as interações também exigem a habilitação manual do AccessibilityService. Não há root, captura oculta, instalação silenciosa ou coleta de identificadores permanentes.

O código e os testes automatizados estão presentes, mas a Fase 3 **não está validada ponta a ponta**: este workspace não tem um dispositivo Android conectado e a mídia real deve ser confirmada com dispositivo físico e painel.

## Fluxo e compatibilidade com o backend

1. O atendente cadastra o cliente e pareia o aparelho uma única vez, associando ao cliente o código temporário que o app exibe.
2. O atendente cria uma sessão pendente para esse cliente cadastrado.
3. O cliente digita `EUQUERO`. O app prova posse da chave gerada no Android Keystore; o backend só pesquisa sessões do cliente associado ao aparelho e rejeita nenhuma ou múltiplas sessões.
4. O app mostra nome e código do atendimento. O cliente confirma; `POST /api/public/sessions/device-consent` registra consentimento e emite um ticket WebSocket curto e de uso único.
5. O app abre `wss://<host>/ws` e envia `join_session` com `{ sessionId, deviceToken }`. O servidor consome o ticket no handshake e revalida sessão e consentimento.
6. O app espera o atendente entrar na mesma sessão. Só então permite iniciar a captura e apresenta o diálogo oficial do Android.
7. Com acessibilidade habilitada e WebRTC ativo, o painel pode executar gestos, navegação e texto em campos editáveis.
8. Cancelamento, revogação/encerramento, falha ou desconexão encerram captura e recursos WebRTC. A revogação do pareamento encerra as sessões ativas vinculadas ao aparelho.

### Ajustes necessários no backend

- Adicionados desafios de uso único e validação de assinaturas EC P-256 para identificar aparelhos pareados. A chave privada fica somente no Android Keystore.
- O código de pareamento é aleatório, armazenado como hash, expira e só pode ser aplicado por um atendente autenticado a um cliente próprio.
- A sessão precisa estar associada ao mesmo cliente do aparelho. A palavra-chave universal não é uma credencial; o endpoint exige prova criptográfica e limita a resolução a uma única sessão.
- O consentimento Android é registrado somente após confirmação explícita do cliente. Um índice parcial impede múltiplas sessões consentidas ativas para o mesmo cliente.
- Ao entrar o segundo participante, o servidor envia a ambos um `connection_state` WebSocket informando a presença do peer. Isso permite aguardar o atendente antes de abrir o diálogo de captura.
- Nenhuma migration histórica, autenticação do atendente ou formato de SDP/ICE foi removido.

O código `HC-...` e `EUQUERO` não autorizam acesso isoladamente. A chave pública é associada a um cadastro pelo atendente; cada pedido exige assinatura fresca de um desafio. A confirmação explícita no app envia `accepted: true`, vinculada pela assinatura ao desafio e ao atendimento selecionado; o backend registra essa decisão, mas a chave identifica o aparelho pareado, não comprova sozinha a identidade civil de quem o está usando. O app não coleta IMEI, serial, MAC ou Android ID.

## Pacotes e dependências Android

- `presentation`: tela Android nativa com componentes Material.
- `domain`: normalização/validação da palavra-chave e estados de sessão.
- `data`: chave do Android Keystore, prova assinada e chamadas de desafio, resolução e consentimento.
- `signaling`: WebSocket OkHttp, mensagens tipadas e sequência/nonce anti-replay.
- `projection`: construção e validação do resultado do diálogo MediaProjection.
- `webrtc`: PeerConnection, captura de vídeo, SDP/ICE e liberação idempotente.
- `service`: coordenação de sessão e Foreground Service com notificação.

Não há tokens Supabase, credenciais permanentes, segredo TURN ou chave de servidor no APK. A configuração contém somente a URL pública da API.

## Comandos

Abra `android/` no Android Studio ou use:

```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug -PhelpconnectApiBaseUrl="https://api.exemplo.com/api"
```

Para rede de desenvolvimento em emulador, a API local costuma ser acessível em `http://10.0.2.2:3001/api`; em aparelho físico, use um endereço alcançável na LAN. HTTP e tráfego sem TLS são permitidos somente no build `debug`; builds de produção rejeitam API sem HTTPS. A API deve aceitar tráfego do dispositivo e WSS deve estar encaminhado pelo proxy de produção.

Consulte [ANDROID.md](./ANDROID.md), [MEDIAPROJECTION.md](./MEDIAPROJECTION.md), [WEBRTC-ANDROID.md](./WEBRTC-ANDROID.md) e [TESTES-FASE3.md](./TESTES-FASE3.md).

## Limitações

- O ticket fica em memória no backend e é invalidado por uso ou reinício do processo; não funciona como ticket compartilhado entre instâncias.
- Ticket consumido não pode ser reaproveitado após falha do socket. O cliente pode repetir `EUQUERO` e confirmar novamente para obter uma nova credencial temporária.
- Uma sessão requer que o atendente mantenha a sinalização conectada antes de o cliente começar a capturar.
- O pareamento associa uma chave pública persistente do app a um cadastro; a chave privada não sai do Android Keystore. O pareamento pode ser revogado pelo atendente.
- Android, fabricante, conteúdo protegido, economia de bateria e políticas corporativas podem limitar captura ou codificação. Consulte os documentos de Android e teste os fabricantes-alvo.
