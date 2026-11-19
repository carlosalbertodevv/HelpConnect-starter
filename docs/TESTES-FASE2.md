# Testes da Fase 2

## Executar

Na raiz do projeto:

```powershell
npm test
npx prisma validate --schema backend/prisma/schema.prisma
npm audit
```

```bash
npm test
npx prisma validate --schema backend/prisma/schema.prisma
npm audit
```

Os testes do protocolo sobem um servidor HTTP em loopback e usam Supabase/Prisma simulados. Não precisam de conta Supabase, PostgreSQL, Coturn ou permissões Android. Não simulam transmissão de tela.

## Cobertura automatizada

Os testes WebSocket exercitam conexão e handshake, autenticação do atendente e dispositivo, permissão/consentimento, sessão de outro atendente, isolamento de sessão, encaminhamento Offer/Answer e ICE, credencial de uso único e expiração, revogação/encerramento, substituição de conexão, replay e payload inválido/limite de mensagens. Os testes existentes de tokens continuam na suíte.

## Verificação manual opcional

1. Inicie API e frontend e autentique um atendente.
2. Crie um atendimento e autorize-o pela página do cliente.
3. Use “Conectar sinalização” no painel; o estado WebSocket deve mudar para conectado e o Android deve permanecer desconectado sem app.
4. Emita uma credencial de dispositivo e confirme que ela é de uso único e expira. Não a envie por canal público.
5. Encerre pelo painel ou revogue pela página do cliente; a sinalização deve encerrar imediatamente.
6. Com a Fase 3, uma imagem só deve aparecer depois de o app Android entrar com ticket válido e o cliente aprovar a captura no diálogo oficial do sistema.

Os testes desta fase não validam a transmissão de mídia. Para o teste Android ponta a ponta, siga [TESTES-FASE3.md](./TESTES-FASE3.md); não substitua a validação por imagem ou stream artificial.
