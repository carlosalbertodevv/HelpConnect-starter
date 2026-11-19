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

A credencial de dispositivo é emitida pelo endpoint autenticado `POST /api/sessions/:id/device-ticket`, apenas para atendimentos próprios com consentimento vigente. Ela expira em `DEVICE_TICKET_TTL_SECONDS` (padrão 120 s), só pode ser consumida uma vez e é invalidada ao reiniciar o processo. Não é o token do link do cliente.

Antes do handshake, o app envia `POST /api/public/sessions/device-session` com `{ "publicCode": "HC-...", "deviceToken": "..." }`. O backend só retorna o `sessionId` se o ticket ainda for válido e estiver vinculado ao código informado e a uma sessão ativa, não expirada e consentida. Essa consulta não consome o ticket; o consumo ocorre uma única vez no `join_session`. O código público não é credencial nem substitui o ticket. Transfira o ticket ao cliente por canal seguro.

Uma entrada aceita retorna `join_session` com `participant`, `nextSequence` e um nonce aleatório exclusivo da conexão. A entrada do dispositivo também inclui `iceServers` com TURN temporário, se configurado. Uma segunda conexão do mesmo papel substitui a anterior. Cada mensagem depois da entrada tem esse `connectionNonce` e um `sequence` inteiro crescente, mantido por sessão/papel durante a vida do processo. O nonce impede replay de mensagens capturadas em uma conexão anterior.

Quando o segundo participante entra, ambos recebem um `connection_state` WebSocket indicando a presença do peer. Isso permite que o app aguarde o atendente antes de solicitar a captura; não altera a autorização nem os formatos das mensagens de mídia.

## Mensagens suportadas

- `leave_session`: encerra a participação do remetente.
- `offer` e `answer`: incluem `recipient` (`operator` ou `device`) e descrição SDP com tipo correspondente.
- `ice_candidate`: inclui destinatário e candidate ICE (também aceita `null` para fim de gathering).
- `connection_state`: estado WebRTC (`new`, `connecting`, `connected`, `disconnected`, `failed`, `closed`) e destinatário.
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
- Heartbeat ping/pong detecta sockets mortos. Sessão e consentimento são verificados na entrada, em cada mensagem e a cada cinco segundos.
- O encerramento, expiração ou revogação fecha os sockets e emite `session_ended`.
- Credenciais, SDP e candidates não são registrados. O log de auditoria registra somente eventos de conexão/saída e emissão de credencial.

Os limitadores e sequências anti-replay são em memória e por processo. Deploy com múltiplas instâncias requer um armazenamento compartilhado apropriado antes de escalar.
