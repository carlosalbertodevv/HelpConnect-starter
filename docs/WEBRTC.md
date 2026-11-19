# Preparação WebRTC

O backend encaminha SDP Offer/Answer, ICE candidates e estados de conexão apenas entre os participantes autenticados e consentidos da mesma sessão. Ele não atua como media server e não grava SDP, candidates ou mídia.

O endpoint autenticado `GET /api/sessions/:id/ice-servers` retorna os servidores ICE aplicáveis ao painel. O `join_session` aceito do dispositivo Android inclui a mesma configuração ICE temporária. `STUN_URLS` é uma lista separada por vírgulas. TURN é opcional e configurado por `TURN_URLS` e `TURN_SECRET`; o backend cria credenciais temporárias no formato compatível com Coturn REST API. A resposta TURN inclui `expiresAt`; o segredo compartilhado nunca é enviado aos participantes.

O app Android inicializa `PeerConnectionFactory`, cria a conexão com ICE recebido no handshake, adiciona a track da tela capturada e inicia a negociação com uma Offer. O painel recebe a Offer, responde com Answer e exibe a stream real por `ontrack`. Offers de renegociação ICE do painel são respondidas pelo app. Não há stream fictícia nem controle remoto.

O app não reutiliza o ticket para reconectar: se o WebSocket cair, a conexão WebRTC/captura é encerrada e um novo ticket deve ser emitido pelo atendente. A reconexão WebSocket com backoff continua sendo responsabilidade do painel, que usa a autenticação Supabase própria.

## Variáveis de ICE

```dotenv
STUN_URLS=stun:stun.l.google.com:19302
TURN_URLS=
TURN_SECRET=
TURN_CREDENTIAL_TTL_SECONDS=3600
```

Para Coturn, veja [COTURN.md](./COTURN.md). Servidores ICE públicos podem observar metadados de rede; avalie privacidade, disponibilidade e política operacional antes do uso em produção. Em redes corporativas/restritivas, TURN pode ser necessário; a aplicação local continua iniciando sem TURN.

## Limite da autorização

O consentimento registrado na Fase 1 autoriza somente o atendimento HelpConnect. A captura Android exige autorização separada, interativa e revogável do próprio Android por `MediaProjection`, além dos requisitos da versão Android e do Foreground Service. A sinalização não concede esse acesso. Consulte [MEDIAPROJECTION.md](./MEDIAPROJECTION.md) e [WEBRTC-ANDROID.md](./WEBRTC-ANDROID.md).
