# HelpConnect — Fase 3: aplicativo Android nativo

## Escopo e estado

O projeto `android/` implementa um cliente Kotlin para compartilhar a tela e, após o consentimento da sessão, executar interações remotas suportadas pelo Android. A captura exige consentimento HelpConnect e aprovação explícita do diálogo oficial `MediaProjection`; as interações também exigem a habilitação manual do AccessibilityService. Não há root, captura oculta, instalação silenciosa ou coleta de identificadores permanentes.

O código e os testes automatizados estão presentes, mas a Fase 3 **não está validada ponta a ponta**: este workspace não tem um dispositivo Android conectado e a mídia real deve ser confirmada com dispositivo físico e painel.

## Fluxo e compatibilidade com o backend

1. O atendente cria a sessão e obtém o código público.
2. Após o consentimento web, o atendente gera `POST /api/sessions/:id/device-ticket`. O painel mostra o ticket temporário de uso único. O atendente transfere código e ticket ao cliente por canal seguro; o ticket não é um segredo permanente.
3. O cliente informa código e ticket no app. `POST /api/public/sessions/device-session` retorna o UUID somente quando o ticket temporário ainda está na memória do backend, pertence ao código e a sessão segue ativa, não expirada e consentida. A consulta não consome o ticket.
4. O app abre `wss://<host>/ws` e envia o formato existente `join_session` com `{ sessionId, deviceToken }`. O servidor consome o ticket no handshake, revalida sessão/consentimento e retorna nonce, próxima sequência e servidores ICE temporários.
5. O app espera o atendente entrar na mesma sessão. Só então permite iniciar a captura.
6. O cliente aceita o diálogo oficial do Android; o serviço sobe em foreground com notificação permanente, cria a track de tela, envia Offer/ICE e responde a Offers de renegociação do painel.
7. Com acessibilidade habilitada e WebRTC ativo, o painel pode executar gestos, navegação e texto em campos editáveis sem uma segunda solicitação de controle.
8. Cancelamento, revogação/encerramento, falha ou desconexão encerram captura e recursos WebRTC. O ticket não é reutilizado; o atendente emite outro para uma nova tentativa.

### Ajustes necessários no backend

- Adicionado `POST /api/public/sessions/device-session`, protegido pelo ticket aleatório de 32 bytes e pelo limitador já aplicado às rotas públicas. A resposta contém somente `sessionId` e `expiresAt`; não retorna nem armazena novamente a credencial.
- A consulta de resolução não consome o ticket. A função existente de consumo único continua sendo chamada pelo handshake WebSocket, que permanece inalterado.
- Ao entrar o segundo participante, o servidor envia a ambos um `connection_state` WebSocket informando a presença do peer. Isso permite aguardar o atendente antes de abrir o diálogo de captura.
- Nenhuma migration histórica, autenticação do atendente ou formato de SDP/ICE foi removido.

O código `HC-...` não autoriza acesso. O ticket é um bearer secret efêmero; o cliente deve recebê-lo por canal seguro. A identidade do app é limitada à participação de dispositivo daquela sessão e daquele ticket. O aplicativo não coleta IMEI, serial, MAC, Android ID nem mantém credencial permanente.

## Pacotes e dependências Android

- `presentation`: tela Android nativa com componentes Material.
- `domain`: normalização/validação do código e formato do ticket.
- `data`: resolução da sessão por HTTPS/HTTP apenas em debug.
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
- Ticket consumido não pode ser reaproveitado após falha do socket. O painel precisa gerar outro.
- Uma sessão requer que o atendente mantenha a sinalização conectada antes de o cliente começar a capturar.
- A resolução de código não estabelece uma identidade de hardware. Cadastro e associação duráveis de dispositivos exigiriam um fluxo de pareamento separado, não implementado.
- Android, fabricante, conteúdo protegido, economia de bateria e políticas corporativas podem limitar captura ou codificação. Consulte os documentos de Android e teste os fabricantes-alvo.
