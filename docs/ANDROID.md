# Aplicativo HelpConnect Android

## Requisitos

- Android Studio estável com suporte a Gradle 8.13 e JDK 17 ou superior.
- Android SDK Platform 36 e ferramentas de build compatíveis.
- Android 8.0/API 26 ou superior.
- Backend HelpConnect Fases 1/2/3 em execução; produção deve usar HTTPS/WSS.

O app usa Kotlin, Kotlin DSL, AndroidX, Material Components, OkHttp 4.12.0, Coroutines 1.10.2 e WebRTC Android 1.3.10 (`io.getstream:stream-webrtc-android`). O WebRTC selecionado publica AAR no Maven Central; a distribuição declara suporte Android API 21+. O projeto configura minSdk 26, compileSdk 36 e targetSdk 35. Compilar contra 36 não opta automaticamente a aplicação pelas mudanças de comportamento de target 36.

## Configuração da API

O build `debug` usa `http://10.0.2.2:3001/api` por padrão. O endereço `10.0.2.2` permite ao Android Emulator alcançar o Windows host; não use `localhost` ou `127.0.0.1` no app. A URL é centralizada no `BuildConfig.API_BASE_URL` e o WebSocket deriva `/ws` da mesma origem.

Se necessário, defina outra URL base com o sufixo `/api` por uma propriedade Gradle:

```powershell
cd android
.\gradlew.bat assembleDebug -PhelpconnectApiBaseUrl="http://10.0.2.2:3001/api"
```

Também é possível usar a variável `HELPCONNECT_API_BASE_URL`; propriedade Gradle tem precedência. Em aparelho físico, substitua por endereço LAN acessível ou domínio HTTPS. A API e o WebSocket precisam estar alcançáveis pela rede do dispositivo.

Não coloque tokens, senhas ou segredos nessa propriedade. O endpoint deve terminar em `/api`.

O manifesto permite HTTP cleartext somente no build `debug`. O build `release` não permite cleartext e falha ao compilar se a URL configurada não usar HTTPS. Não publique builds de depuração nem use HTTP em produção.

## Compilar e executar

```powershell
# Na raiz do projeto, em outro terminal:
npm run dev
# Confirme no Windows: http://localhost:3001/api/health

# Com um emulador Android iniciado:
cd android
.\gradlew.bat testDebugUnitTest
.\gradlew.bat assembleDebug installDebug
```

O backend escuta em `0.0.0.0:3001` por padrão; o VS Code Live Server também fica configurado em `0.0.0.0:5500`. Se necessário, permita Node.js na rede privada do Firewall do Windows. Por padrão, o link de consentimento abre no navegador Windows em `http://localhost:5500/client.html`, enquanto o app Android usa `10.0.2.2` para acessar a API. Se preferir abrir o link no navegador do emulador, altere `PUBLIC_APP_URL` para `http://10.0.2.2:5500` (raiz `frontend`) e use `APP_ORIGINS` para permitir essa origem. A URL da API no frontend muda com o hostname; CORS não é exigido pelo cliente nativo. Abra a pasta `android/` no Android Studio para sincronizar Gradle, executar testes e implantar em emulador/dispositivo. Não é necessário configurar Supabase Auth no app: o dispositivo usa somente o ticket temporário.

## Uso

No build `debug`, a tela inicial identifica claramente o modo de desenvolvimento. **Iniciar teste** abre uma tela local para navegação; ela não cria sessões/tickets, não simula consentimento, não pede autorização de captura e não inicia WebRTC. Para validar o fluxo real no Debug, escolha **Conectar a uma sessão autorizada** e use credenciais válidas do backend.

O build `release` não contém esse modo: abre diretamente a entrada de sessão e exige código e credencial válidos. A disponibilidade da demonstração depende exclusivamente de `BuildConfig.DEBUG`, não de uma opção do usuário ou de configuração recebida da API.

1. No painel, aguarde o consentimento e gere um ticket Android para a sessão.
2. Transfira código e ticket por um canal privado/seguro.
3. No app, abra **Conectar a uma sessão autorizada**, informe ambos e valide. A credencial é removida do campo após o envio.
4. Aguarde o atendente conectar a sinalização.
5. Toque em **Sim, compartilhar tela** e aceite o diálogo oficial do Android para `MediaProjection`.
6. Se o serviço de acessibilidade ainda não estiver ativo, toque em **Configurar acessibilidade** e habilite HelpConnect manualmente nas configurações. O compartilhamento de tela pode continuar sem interações; o app não ativa o serviço automaticamente.
7. Quando o vídeo/WebRTC e a acessibilidade estiverem ativos, as interações são habilitadas automaticamente, sem outra solicitação ou aprovação. O app e a notificação persistente permitem interromper o compartilhamento; revogue o consentimento no link para encerrar toda a sessão.

Ticket de uso único e código não devem ser incluídos em logs, capturas de suporte ou mensagens públicas. Se a tentativa falhar ou a rede cair, gere novo ticket no painel.

## Permissões

O manifesto declara `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` e `POST_NOTIFICATIONS`. Não declara permissões de câmera, microfone, acessibilidade, armazenamento amplo ou identificação de hardware. O app bloqueia o início da captura se a permissão de notificações do Android 13+ não for concedida.

Para comportamento de captura/Foreground Service e revogação, consulte [MEDIAPROJECTION.md](./MEDIAPROJECTION.md).

## Interações remotas

O consentimento no link cobre compartilhamento e interações. O diálogo `MediaProjection` e a habilitação manual do AccessibilityService são autorizações distintas exigidas pelo Android, não uma aprovação adicional do atendente. Com captura, acessibilidade e WebRTC ativos, o painel habilita toques, gestos, navegação e texto em campos editáveis. Campos de senha são bloqueados. Consulte [CONTROLE-REMOTO.md](./CONTROLE-REMOTO.md) para limites e validação em aparelho real.
