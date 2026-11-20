# Integracao WebRTC

## Participantes

- Android: publica uma unica track de tela.
- Painel: recebe a `MediaStream` e responde a ofertas.

## ICE

- A entrada do dispositivo recebe a configuracao ICE no `join_session`.
- O painel consulta `GET /api/sessions/:id/ice-servers`.
- STUN pode ser usado diretamente.
- TURN temporario usa o formato REST API do Coturn e nunca expõe `TURN_SECRET`.

## Negociacao

1. Android cria `PeerConnectionFactory`, capturador, `VideoSource` e `VideoTrack`.
2. Android cria uma Offer em Unified Plan.
3. A Offer e encaminhada ao painel.
4. O painel cria o `RTCPeerConnection`, aplica a Offer e cria a Answer.
5. Candidates locais e remotos sao trocados pelo WebSocket.
6. O painel trata `ontrack` e atribui o stream real a um elemento `<video>`.
7. Estados `connecting`, `connected`, `disconnected`, `failed` e `closed` sao publicados.

Reiniciar ICE pode usar renegociacao com Offer. A reconexao WebSocket nao reutiliza ticket consumido.

## Recursos conservadores

- Dimensao maxima: 1280 pixels.
- FPS: 15.
- Sem audio.
- Preferir TURN so quando exigido pela rede.
