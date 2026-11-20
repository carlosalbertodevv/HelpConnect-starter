# Aplicativo HelpConnect Android

## Requisitos

- Android Studio estável com suporte a Gradle 8.13 e JDK 17 ou superior.
- Android SDK Platform 36 e ferramentas de build compatíveis.
- Android 8.0/API 26 ou superior.
- Backend HelpConnect Fases 1/2/3 em execução; produção deve usar HTTPS/WSS.

O app usa Kotlin, Kotlin DSL, AndroidX, Material Components, OkHttp 4.12.0, Coroutines 1.10.2 e WebRTC Android 1.3.10 (`io.getstream:stream-webrtc-android`). A identidade do aparelho usa uma chave EC P-256 criada no Android Keystore; a chave privada não é armazenada no APK nem em preferências do app. O projeto configura minSdk 26, compileSdk 36 e targetSdk 35.

## Configuração da API

O build `debug` seleciona a API automaticamente: emuladores Android usam `http://10.0.2.2:3001/api`; celulares físicos usam o IP LAN do computador que compilou o APK (detectado no build). O emulador usa `10.0.2.2` para alcançar o host; celulares físicos devem estar na mesma rede Wi-Fi do computador. O backend escuta em `0.0.0.0:3001` por padrão. Libere a porta TCP 3001 no Firewall do Windows para a rede privada, se solicitado. O app e o WebSocket derivam a conexão da URL selecionada.

Se necessário, configure os endereços separadamente (ambos devem terminar em `/api`):

```powershell
cd android
.\gradlew.bat assembleDebug `
  -PhelpconnectEmulatorApiBaseUrl="http://10.0.2.2:3001/api" `
  -PhelpconnectLanApiBaseUrl="http://192.168.2.12:3001/api"
```

As propriedades Gradle também podem ser fornecidas pelas variáveis `HELPCONNECT_EMULATOR_API_BASE_URL` e `HELPCONNECT_LAN_API_BASE_URL`. Para compatibilidade, `helpconnectApiBaseUrl`/`HELPCONNECT_API_BASE_URL` define o mesmo endereço para ambos. O IP LAN pode mudar quando o computador troca de rede; gere novamente o APK com o IP correto. A API e o WebSocket precisam estar alcançáveis pela rede do dispositivo.

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

O backend escuta em `0.0.0.0:3001` por padrão; mantenha-o em execução no computador durante os testes. O app escolhe `10.0.2.2` no emulador ou o IP LAN no celular físico, sem precisar abrir link nem configurar `PUBLIC_APP_URL`. O frontend web ainda pode usar a página legada de consentimento em `client.html`, mas esse fluxo não é usado pelo app Android. Abra `android/` no Android Studio para sincronizar Gradle, executar testes e instalar em emulador/dispositivo. Não é necessário configurar Supabase Auth no app: a identidade é uma chave gerada no Android Keystore, e cada requisição é autenticada por desafio assinado.

## Uso

O app abre diretamente em um único campo. Um aparelho novo mostra um código de pareamento após a primeira tentativa; o atendente verifica o cliente e associa o código uma única vez na tela **Clientes**. Esse pareamento não concede acesso a atendimentos por si só.

1. Cadastre o cliente e pareie o aparelho uma vez. O atendente deve confirmar a identidade do cliente antes de associá-lo.
2. No painel, crie um atendimento para esse cliente cadastrado.
3. No app já pareado, o cliente digita `EUQUERO`. O backend valida a palavra-chave e a assinatura da chave privada do aparelho, e só localiza a sessão ativa do cliente pareado.
4. Confira o nome do cliente e o código do atendimento apresentados no app; confirme ou cancele.
5. Aguarde o atendente conectar a sinalização; confirme o diálogo oficial do Android para `MediaProjection` para iniciar a captura.
6. Se o serviço de acessibilidade ainda não estiver ativo, toque em **Configurar acessibilidade** e habilite HelpConnect manualmente nas configurações. O compartilhamento pode continuar sem interações; o app não ativa o serviço automaticamente.
7. O app e a notificação persistente permitem interromper o compartilhamento. O atendente pode encerrar a sessão ou revogar o pareamento no painel.

O código de pareamento é temporário e de uso único. O ticket WebSocket é criado automaticamente depois da confirmação e permanece de uso único. Se houver mais de um atendimento ativo para o cliente, o app não escolherá um deles: o atendente deve encerrar os excedentes. O build Debug executa esse mesmo fluxo real; ele não simula consentimento nem inicia captura automaticamente.

## Permissões

O manifesto declara `INTERNET`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PROJECTION` e `POST_NOTIFICATIONS`. Não declara permissões de câmera, microfone, acessibilidade, armazenamento amplo ou identificação de hardware. O app bloqueia o início da captura se a permissão de notificações do Android 13+ não for concedida.

Para comportamento de captura/Foreground Service e revogação, consulte [MEDIAPROJECTION.md](./MEDIAPROJECTION.md).

## Interações remotas

O consentimento no link cobre compartilhamento e interações. O diálogo `MediaProjection` e a habilitação manual do AccessibilityService são autorizações distintas exigidas pelo Android, não uma aprovação adicional do atendente. Com captura, acessibilidade e WebRTC ativos, o painel habilita toques, gestos, navegação e texto em campos editáveis. Campos de senha são bloqueados. Consulte [CONTROLE-REMOTO.md](./CONTROLE-REMOTO.md) para limites e validação em aparelho real.
