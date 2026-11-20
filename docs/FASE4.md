# HelpConnect - Fase 4: Integracao e Validacao

Esta fase integra a sinalizacao existente da Fase 2 ao aplicativo Android da Fase 3 e ao painel Web.

## Contrato preservado

- WebSocket: `ws(s)://<origem-da-api>/ws`.
- Entrada do atendente: `join_session` com token Supabase.
- Entrada do dispositivo: `join_session` com ticket temporário de uso único emitido após o consentimento no app.
- Sinalizacao: `offer`, `answer`, `ice_candidate`, `connection_state` e `leave_session`.
- O servidor encaminha somente mensagens autenticadas entre os dois participantes da mesma sessao.

## Fluxo integrado

1. O atendente cadastra o cliente e associa ao cadastro o código temporário de pareamento exibido por um aparelho novo.
2. O atendente cria a sessão para esse cliente.
3. O app assina um desafio do backend e, após digitar `EUQUERO`, localiza somente uma sessão do cliente pareado.
4. O cliente confere os dados do atendimento e confirma no app; o backend registra consentimento e emite o ticket WebSocket.
5. O ticket é consumido uma única vez no handshake WebSocket, e o app aguarda o atendente entrar.
6. O app exige a ativação manual do AccessibilityService e solicita a autorização oficial de MediaProjection.
7. A tela gera uma track de video, Offer SDP e candidates ICE.
8. O painel responde com Answer SDP e candidates.
9. O painel recebe o MediaStream pelo evento `ontrack` e habilita as interacoes após disponibilidade Android confirmada.

Nao ha solicitacao/aprovacao adicional de controle remoto; o consentimento inicial cobre as interacoes, sujeitas as permissoes obrigatorias do Android.

## Encerramento

Encerramento do atendente, revogação do consentimento, revogação do pareamento e expiração invalidam tickets pendentes e fecham as conexões. O Android interrompe capturador, tracks, PeerConnection e Foreground Service antes de finalizar a atividade da sessão.
