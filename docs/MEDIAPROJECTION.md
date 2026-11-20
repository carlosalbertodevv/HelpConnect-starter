# MediaProjection e Foreground Service

## Autorização e ciclo de vida

- A Activity solicita `MediaProjectionManager.createScreenCaptureIntent()` somente após a sessão e a presença do atendente serem validadas.
- O resultado é aceito apenas com `Activity.RESULT_OK` e dados retornados pelo Android. Cancelar o diálogo não inicia serviço nem captura.
- Após o consentimento, o `HelpConnectService` chama `startForeground()` com tipo `mediaProjection` e notificação persistente antes de criar `ScreenCapturerAndroid`.
- `ScreenCapturerAndroid` recebe o resultado de consentimento uma única vez. A biblioteca registra o callback de `MediaProjection`; `onStop()` encerra publicação e recursos imediatamente.
- Interrupção pelo app/notification, revogação, sessão encerrada, falha WebRTC ou fechamento do WebSocket para a captura e remove a notificação. Não há reconexão automática com ticket consumido.

O conteúdo do `Intent` de autorização permanece apenas em memória durante o início da captura. Não é gravado em preferências, banco, arquivo ou logs.

## Requisitos por versão

- **API 26–28:** serviço iniciado a partir do app visível; notificação de foreground obrigatória durante a captura.
- **API 29–32:** serviço declara o tipo `mediaProjection` e sobe em foreground antes do início da projeção.
- **API 33:** `POST_NOTIFICATIONS` é runtime permission. Este app exige a permissão para mostrar o indicador persistente ao usuário antes de iniciar.
- **API 34+:** o manifesto declara `FOREGROUND_SERVICE_MEDIA_PROJECTION`; o serviço chama `startForeground` com o tipo. O usuário deve aprovar cada sessão de captura. Não reutilize o resultado ou chame novamente `getMediaProjection` com o mesmo grant.
- **Versões futuras/OEM:** mantenha o app iniciado pelo cliente em primeiro plano e valide em cada versão/fabricante. Restrições de economia de bateria podem interromper serviços e rede.

Referências oficiais: [MediaProjection](https://developer.android.com/guide/topics/large-screens/media-projection), [mudanças do Android 14](https://developer.android.com/about/versions/14/behavior-changes-14#media-projection) e [tipos de Foreground Service](https://developer.android.com/develop/background-work/services/fgs/service-types#media-projection).

## Limitações e comportamento esperado

- A autorização web não substitui nem antecipa o diálogo Android.
- O Android pode exibir aviso próprio de compartilhamento/privacidade e interromper a projeção a qualquer momento.
- Sair da Activity não encerra a sessão: ela apenas remove o listener visual; o `HelpConnectService` mantém a captura em foreground. Se a transmissão parar, investigue os eventos de revogação da projeção, desconexão WebSocket/ICE ou destruição do serviço antes de atribuir a causa à troca de aplicativo.
- Telas/áreas protegidas por `FLAG_SECURE` ou DRM podem aparecer vazias/pretas; o app não tenta contorná-las.
- Mudança de orientação, janelas flutuantes, perfis de trabalho e políticas do fabricante podem alterar o que é capturado.
- Samsung, Motorola, Xiaomi e Pixel usam APIs oficiais idênticas, mas podem impor otimização de bateria e notificações distintas. Validar em cada fabricante é necessário.
- O sistema pode encerrar o processo. Nesse caso, a conexão termina; não existe serviço para reiniciar captura sem nova ação e consentimento do cliente.

Para diagnosticar uma interrupção em um dispositivo conectado, filtre o Logcat por `HelpConnectService`, `DeviceSignaling` e `WebRtcScreenPublisher`. Os eventos registram estado e causa técnica sem incluir credenciais, SDP ou conteúdo da tela. A automação de build não substitui os testes de captura e conexão em aparelho real.
