# WebSocket e protocolo de sinalização

## Conexão e autenticação

Endpoint: `ws(s)://<api-host>/ws`. A conexão é anexada ao mesmo servidor HTTP da API. Navegadores devem enviar a origem `APP_ORIGIN`; conexões nativas sem cabeçalho `Origin` são autenticadas pela credencial. Em produção, use WSS através de proxy TLS confiável.

A primeira mensagem, dentro de cinco segundos, deve ser uma única solicitação `join_session`:

```json
{"type":"join_session","sessionId":"<uuid>","accessToken":"<supabase-access-token>"}
```

O servidor valida o token com Supabase e compara o proprietário da sessão. O app Android usa, em vez disso:

```json
{"type":"join_session","sessionId":"<uuid>","deviceToken":"<credencial-de-uso-unico>"}
```

A credencial de dispositivo é emitida automaticamente depois que um aparelho pareado confirma um atendimento. Ela expira em `DEVICE_TICKET_TTL_SECONDS` (padrão 120 s), só pode ser consumida uma vez e é invalidada ao reiniciar o processo.

Antes do handshake, o app obtém um desafio em `POST /api/public/sessions/device-challenge` e envia `EUQUERO`, chave pública, desafio e assinatura a `POST /api/public/sessions/device-session`. O backend valida a assinatura com a chave pública pareada e localiza somente uma sessão do cliente associado. Após a confirmação explícita no Android, `POST /api/public/sessions/device-consent` registra o consentimento e emite o ticket de uso único para o `join_session`.

Uma entrada aceita retorna `join_session` com `participant`, `nextSequence` e um nonce aleatório exclusivo da conexão. A entrada do dispositivo também inclui `iceServers` com TURN temporário, se configurado. Uma segunda conexão do mesmo papel substitui a anterior. Cada mensagem depois da entrada tem esse `connectionNonce` e um `sequence` inteiro crescente, mantido por sessão/papel durante a vida do processo. O nonce impede replay de mensagens capturadas em uma conexão anterior.

Quando o segundo participante entra, ambos recebem um `connection_state` WebSocket indicando a presença do peer. Isso permite que o app aguarde o atendente antes de solicitar a captura; não altera a autorização nem os formatos das mensagens de mídia.

## Mensagens suportadas

- `leave_session`: encerra a participação do remetente.
- `offer` e `answer`: incluem `recipient` (`operator` ou `device`) e descrição SDP com tipo correspondente.
- `ice_candidate`: inclui destinatário e candidate ICE (também aceita `null` para fim de gathering).
- `connection_state`: estado WebRTC (`new`, `connecting`, `connected`, `disconnected`, `failed`, `closed`) e destinatário.
- `remote_control_state`, `remote_control_command` e `remote_control_result`: disponibilidade confirmada pelo dispositivo e interações autorizadas pelo consentimento da sessão, descritas em [CONTROLE-REMOTO.md](./CONTROLE-REMOTO.md). Não existe pedido ou aprovação adicional de controle.
- Mensagens do servidor: `join_session`, `connection_state` (também indica conectividade WebSocket do peer), `session_ended` e `error`.

Exemplo de offer:

```json
{
  "type":"offer",
  "sequence":1,
  "connectionNonce":"<nonce-aleatorio-retornado-na-entrada>",
  "recipient":"device",
  "sdp":{"type":"offer","sdp":"<SDP>"}
}
```

O cliente não escolhe o ID de destino ou a sessão nas mensagens de sinalização. A sessão vem da autenticação de entrada; o servidor valida o papel e só encaminha ao outro participante dessa sessão. O servidor nunca encaminha mensagens entre sessões diferentes. `session_ended` é exclusivamente do servidor.

## Limites e encerramento

- Payload máximo: 16 KiB; SDP: 12 KiB; candidate: 4 KiB.
- Máximo de 30 mensagens por conexão a cada 10 segundos; máximo de conexões e tentativas de handshake por IP também é limitado.
- Comandos têm limite adicional de 8 por segundo, 2.000 IDs únicos por conexão de atendente e até 64 comandos pendentes por conexão Android.
- Heartbeat ping/pong detecta sockets mortos. Sessão e consentimento são verificados na entrada, em cada mensagem e a cada cinco segundos.
- O encerramento, expiração ou revogação fecha os sockets e emite `session_ended`.
- Credenciais, SDP, candidates, coordenadas e conteúdo digitado não são registrados. A auditoria registra eventos de conexão/saída, emissão de credencial, disponibilidade de interações, tipos de ação e resultados.

Os limitadores e sequências anti-replay são em memória e por processo. Deploy com múltiplas instâncias requer um armazenamento compartilhado apropriado antes de escalar.
