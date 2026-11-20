# WebRTC no Android

## Dependências e configuração

O app usa `io.getstream:stream-webrtc-android:1.3.10`, distribuição precompilada da API WebRTC Android (`org.webrtc`), OkHttp 4.12.0 para HTTP/WebSocket e Coroutines Android 1.10.2. As versões foram verificadas em repositórios oficiais Maven/Google; use builds estáveis e atualize em revisão própria.

O dispositivo obtém `iceServers` na resposta já existente do `join_session`. TURN usa somente `username`/`credential` temporários emitidos pelo backend. `TURN_SECRET` nunca é enviado ao Android.

## Fluxo de mídia

1. Inicializa `PeerConnectionFactory` com encoder/decoder de vídeo e contexto EGL.
2. Converte cada URL ICE temporária em `PeerConnection.IceServer`.
3. Usa `ScreenCapturerAndroid` com o grant de `MediaProjection`, `VideoSource` e `VideoTrack`; a track é adicionada ao peer connection.
4. Dispositivo cria Offer, define a descrição local e envia `{ type:"offer", recipient:"operator", sdp:{type:"offer",sdp} }`.
5. ICE candidates locais são enviados como `ice_candidate`; o fim do gathering é representado por `candidate:null`.
6. O app processa Answer/Offer remoto, aplica candidates recebidos e responde a Offer de renegociação do painel.
7. A conexão publica estados WebRTC em `connection_state`. SDP e ICE não são persistidos.

O backend valida papel, consentimento, sessão, nonce e sequência e só encaminha para o peer da mesma sessão. O ticket é consumido no `join_session`; a conexão do Android não tenta reconectar com a mesma credencial. Se o WebSocket falhar, a captura é finalizada e o cliente pode repetir `EUQUERO` e confirmar novamente para emitir outro ticket.

## Limites de captura

A captura é limitada a uma dimensão máxima de 1280 pixels e 15 quadros por segundo no código atual. O bitrate/qualidade efetivos dependem do encoder, rede, ICE/TURN, fabricante e carga do aparelho. Não há áudio, câmera, stream de teste ou tela fictícia.

Para validar transmissão real, confirme `ontrack`/vídeo no painel com um dispositivo Android e uma sessão autorizada; compilação e testes de unidade não provam captura ou conectividade WebRTC. Siga [TESTES-FASE3.md](./TESTES-FASE3.md).
