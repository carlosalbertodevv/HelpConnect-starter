# Aplicativo HelpConnect Android

## Requisitos

- Android Studio estável com suporte a Gradle 8.13 e JDK 17 ou superior.
- Android SDK Platform 36 e ferramentas de build compatíveis.
- Android 8.0/API 26 ou superior.
- Backend HelpConnect Fases 1/2/3 em execução; produção deve usar HTTPS/WSS.

O app usa Kotlin, Kotlin DSL, AndroidX, Material Components, OkHttp 4.12.0, Coroutines 1.10.2 e WebRTC Android 1.3.10 (`io.getstream:stream-webrtc-android`). O WebRTC selecionado publica AAR no Maven Central; a distribuição declara suporte Android API 21+. O projeto configura minSdk 26, compileSdk 36 e targetSdk 35. Compilar contra 36 não opta automaticamente a aplicação pelas mudanças de comportamento de target 36.

## Configuração da API

Defina a URL base com o sufixo `/api` por uma propriedade Gradle:

```powershell
cd android
.\gradlew.bat assembleDebug -PhelpconnectApiBaseUrl="http://10.0.2.2:3001/api"
```

Use `10.0.2.2` para alcançar o host a partir do emulador Android. Em aparelho físico, substitua por endereço LAN acessível ou domínio HTTPS. A API e o WebSocket precisam estar alcançáveis pela rede do dispositivo.

Também é possível definir a variável `HELPCONNECT_API_BASE_URL`. Não coloque tokens, senhas ou segredos nessa propriedade. O endpoint deve terminar em `/api`; o app deriva `/ws` da mesma origem.

O build `debug` permite HTTP para desenvolvimento local. O build `release` rejeita API que não use HTTPS e não permite cleartext. Não publique builds de depuração nem use HTTP em produção.

## Compilar e executar

```powershell
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug -PhelpconnectApiBaseUrl="https://api.exemplo.com/api"
```

Abra a pasta `android/` no Android Studio para sincronizar Gradle, executar testes e implantar em emulador/dispositivo. Não é necessário configurar Supabase Auth no app: o dispositivo usa somente o ticket temporário.

## Uso

1. No painel, aguarde o consentimento e gere um ticket Android para a sessão.
2. Transfira código e ticket por um canal privado/seguro.
3. No app, informe ambos e valide. A credencial é removida do campo após o envio.
4. Aguarde o atendente conectar a sinalização.
5. Toque em **Autorizar compartilhamento de tela** e aceite o prompt Android.
6. A notificação persistente oferece uma ação para interromper a captura; o app também mantém um botão de parada.

Ticket de uso único e código não devem ser incluídos em logs, capturas de suporte ou mensagens públicas. Se a tentativa falhar ou a rede cair, gere novo ticket no painel.

## Permissões

O manifesto declara `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` e `POST_NOTIFICATIONS`. Não declara permissões de câmera, microfone, acessibilidade, armazenamento amplo ou identificação de hardware. O app bloqueia o início da captura se a permissão de notificações do Android 13+ não for concedida.

Para comportamento de captura/Foreground Service e revogação, consulte [MEDIAPROJECTION.md](./MEDIAPROJECTION.md).
