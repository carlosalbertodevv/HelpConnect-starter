# HelpConnect - Fase 4: Integracao e Validacao

Esta fase integra a sinalizacao existente da Fase 2 ao aplicativo Android da Fase 3 e ao painel Web.

## Contrato preservado

- WebSocket: `ws(s)://<origem-da-api>/ws`.
- Entrada do atendente: `join_session` com token Supabase.
- Entrada do dispositivo: `join_session` com ticket temporario de uso unico.
- Sinalizacao: `offer`, `answer`, `ice_candidate`, `connection_state` e `leave_session`.
- O servidor encaminha somente mensagens autenticadas entre os dois participantes da mesma sessao.

## Fluxo integrado

1. O atendente cria a sessao e o cliente registra consentimento.
2. O atendente gera o ticket Android.
3. O aplicativo resolve codigo e ticket sem consumir a credencial.
4. O ticket e consumido uma unica vez no handshake WebSocket.
5. O app aguarda o atendente entrar.
6. O app exige a ativacao manual do AccessibilityService e solicita a autorizacao oficial de MediaProjection.
7. A tela gera uma track de video, Offer SDP e candidates ICE.
8. O painel responde com Answer SDP e candidates.
9. O painel recebe o MediaStream pelo evento `ontrack` e habilita as interacoes após disponibilidade Android confirmada.

Nao ha solicitacao/aprovacao adicional de controle remoto; o consentimento inicial cobre as interacoes, sujeitas as permissoes obrigatorias do Android.

## Encerramento

Encerramento do atendente, revogacao do consentimento e expiracao invalidam tickets pendentes e fecham as conexoes. O Android interrompe capturador, tracks, PeerConnection e Foreground Service antes de finalizar a atividade da sessao.
