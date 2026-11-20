# Interações remotas autorizadas

## Consentimento e disponibilidade

O consentimento registrado para o atendimento cobre compartilhamento de tela e interações remotas. Não há pedido nem aprovação adicional durante a sessão. O backend usa o consentimento existente `SUPPORT_SESSION`; a opção `REMOTE_CONTROL` da migration antiga permanece apenas por compatibilidade histórica e não é mais gravada.

1. O atendente pareia o aparelho ao cadastro do cliente e cria a sessão para esse cliente.
2. O usuário digita `EUQUERO`, confere o atendimento e confirma explicitamente no app.
3. O backend valida a identidade pareada e o consentimento; o app aguarda o atendente.
4. Ao iniciar o compartilhamento, o usuário aceita o diálogo oficial do Android para `MediaProjection`.
5. Se o usuário também habilitar HelpConnect manualmente em **Configurações > Acessibilidade**, as interações são ativadas automaticamente quando o vídeo/WebRTC estiver conectado. O app pode abrir essa tela após ação do usuário, mas nunca ativa o serviço automaticamente; o compartilhamento pode continuar sem interações.
6. Toques, gestos, navegação e texto em campo editável ficam disponíveis automaticamente somente enquanto o serviço de acessibilidade e a conexão de vídeo estão ativos.

Interromper a captura, desativar acessibilidade, perder a conexão, encerrar a sessão ou revogar o consentimento desabilita as interações. Campos de senha e dispositivo bloqueado são recusados. A revogação geral encerra a sessão e os sockets.

## Protocolo WebSocket

Todas as mensagens usam autenticação existente, nonce da conexão, sequência crescente e payload limitado a 16 KiB.

- `remote_control_state`: o dispositivo informa `available: true` somente após consentimento, acessibilidade habilitada e WebRTC ativo. O servidor só encaminha esse estado para o atendente após validar sessão e participantes.
- `remote_control_command`: somente o atendente autenticado envia ações à conexão Android atual da mesma sessão.
- `remote_control_result`: o dispositivo responde a um comando ainda pendente com um código de resultado limitado.

Não são mais aceitos `remote_control_request`, `remote_control_grant` nem `remote_control_revoke`. A lista de ações inclui toque, pressionamento longo, arrastar, Voltar/Início/Recentes e texto (máximo de 512 caracteres) para o campo de entrada editável atualmente focado. Texto e coordenadas não são gravados; a auditoria registra somente tipo de ação e resultado.

O backend verifica a cada mensagem sessão vigente, consentimento, identidade do atendente, ticket associado à conexão do dispositivo, papel, destinatário, conexão WebRTC, disponibilidade reportada pelo Android, nonce, sequência, IDs de comando e limites. Comandos são limitados a 8 por segundo, 2.000 IDs únicos por conexão de atendente e até 64 comandos pendentes por conexão Android. Respostas sem comando pendente e mensagens de sessões diferentes são rejeitadas.

Estado de disponibilidade e sockets são mantidos em memória por processo. Reiniciar ou substituir uma conexão não restaura disponibilidade; implantações multi-instância exigem coordenação compartilhada antes de escalar.

## Android

`RemoteControlAccessibilityService` usa `dispatchGesture`, `performGlobalAction` e `ACTION_SET_TEXT`, somente com autorização local durante compartilhamento consentido e WebRTC ativo. A digitação requer um campo focado e editável; a árvore de acessibilidade e o campo de senha são verificados antes de executar a ação. O serviço falha fechado se não houver janela ativa ou se a permissão for desativada.

O app não injeta eventos fora das APIs públicas, não contorna as configurações do Android e não captura a tela até o usuário aceitar a autorização do sistema. Texto da ação não é incluído em logs ou na auditoria.

## Limitações e validação pendente

- Fabricantes/versões do Android e aplicativos podem rejeitar gestos ou `ACTION_SET_TEXT`; interfaces customizadas podem não expor campos de entrada acessíveis.
- A árvore de acessibilidade não identifica universalmente janelas `FLAG_SECURE` ou protegidas por DRM. A captura dessas superfícies pode ficar preta, mas isso não garante que o sistema impeça todos os gestos. Bloquear senha e tela bloqueada não é uma garantia de detecção de todo conteúdo protegido.
- Confirme em aparelho físico que o serviço permanece desabilitado até o usuário ativá-lo manualmente; teste revogação, parada, desconexão, rotação, tela bloqueada, campos de senha e texto.
- Testes automatizados validam protocolo, isolamento, disponibilidade, auditoria, limites e parsing; não exercitam o diálogo de `MediaProjection` nem ações reais em outros apps.

## Checklist para dispositivo real

1. Abrir o consentimento, confirmar que ele descreve tela e interações, e aceitar.
2. Ativar HelpConnect manualmente em Acessibilidade e aceitar a captura no diálogo oficial do Android.
3. Confirmar que o painel só habilita interações após WebRTC ativo e que não há aprovação adicional.
4. Testar toque, arrasto, pressionamento longo, navegação e texto em campo não sensível; confirmar que campo de senha é bloqueado.
5. Desativar acessibilidade, interromper captura, perder rede, revogar consentimento e encerrar sessão; confirmar desativação imediata.
6. Confirmar no painel que a tela mostra frames reais e que o texto enviado não aparece em logs/auditoria.
