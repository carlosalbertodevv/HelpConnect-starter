# Coturn (STUN/TURN)

Coturn é opcional no desenvolvimento local. Use TURN quando a conectividade direta por ICE/STUN não funcionar ou quando a implantação exigir relay. Nunca coloque o segredo estático do Coturn no frontend ou no repositório.

## Instalação em Ubuntu Server

Instale uma versão suportada pelo Ubuntu:

```bash
sudo apt update
sudo apt install coturn
```

Gere um segredo forte fora do repositório e configure o mesmo valor no serviço Coturn e no backend:

```bash
openssl rand -base64 48
```

Guarde o resultado em um gestor de segredos. Crie `/etc/turnserver.conf` com proprietário root e permissões restritas. Ajuste domínio, endereços e caminhos de certificado:

```ini
listening-port=3478
tls-listening-port=5349
realm=turn.example.com
fingerprint
use-auth-secret
static-auth-secret=COLOQUE_O_SEGREDO_FORA_DO_REPOSITORIO
no-cli
no-multicast-peers
no-loopback-peers
min-port=49160
max-port=49200
# Para TLS, configure certificados válidos:
cert=/etc/letsencrypt/live/turn.example.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.com/privkey.pem
```

Proteja o arquivo e habilite o serviço:

```bash
sudo chown root:root /etc/turnserver.conf
sudo chmod 600 /etc/turnserver.conf
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable --now coturn
sudo systemctl status coturn
```

Configure firewall e regras de rede para UDP/TCP 3478, TLS TCP 5349 e o intervalo UDP de relay configurado (`49160-49200` neste exemplo). Restrinja administração; não exponha a interface CLI do Coturn. Para TLS, use domínio público e certificados renovados. Verifique também regras do firewall/provedor de nuvem.

## Backend HelpConnect

Defina estas variáveis no ambiente do processo backend, usando exatamente o segredo provisionado para Coturn:

```dotenv
STUN_URLS=stun:turn.example.com:3478
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SECRET=<segredo-forte-do-gestor-de-segredos>
TURN_CREDENTIAL_TTL_SECONDS=3600
```

`TURN_SECRET` deve ter pelo menos 32 caracteres; a validade aceita é de 60 a 86.400 segundos. Coturn e backend precisam compartilhar o segredo HMAC. O backend retorna usuário temporário (timestamp + sessão) e senha HMAC-SHA1 para o cliente WebRTC. O browser recebe apenas essas credenciais temporárias, nunca o segredo de longo prazo. Use HTTPS/WSS em produção.

Em desenvolvimento local, deixe `TURN_URLS` e `TURN_SECRET` vazios. `STUN_URLS` tem um servidor STUN padrão e pode ser esvaziado; nenhuma VPS é necessária para iniciar a API.

## Operação segura

- Nunca publique `static-auth-secret`, `TURN_SECRET`, chaves privadas ou senhas em logs, frontend, commits ou suporte.
- Restrinja as portas de relay ao necessário e monitore abuso/banda/custos.
- Rotacione o segredo coordenadamente no Coturn e no backend.
- Não trate credenciais temporárias como autorização de captura de tela; Android continua exigindo seu próprio consentimento de `MediaProjection`.
