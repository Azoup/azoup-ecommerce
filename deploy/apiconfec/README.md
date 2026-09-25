# Deploy marketplace no apiconfec (sem quebrar o ERP)

Copie a pasta **`marketplace-ecommerce/`** deste diretório para dentro do backend do Confec:

```
RNWebSupabase/backend/marketplace-ecommerce/
```

O módulo é **ESM isolado** (`package.json` com `"type": "module"`) — não altera o restante do `apiconfec` (CommonJS).

## 1. Arquivos que vão para o servidor

Após rodar o script de cópia (abaixo), o apiconfec terá:

```
backend/marketplace-ecommerce/
  package.json
  routes/
    marketplaceWebhookRoutes.js
  lib/
    supabaseAdmin.js, tokenCrypto.js, marketplaceConfig.js
    marketplaceIntegration.js, marketplaceIntegrationRead.js
    marketplaceWebhookAuth.js, marketplaceWebhookBody.js, marketplaceWebhooks.js
    estoqueLedger.js, nuvemshopClient.js, nuvemshopOrderStatuses.js, trayOrderStatuses.js
    marketplaceStockSync.js, marketplaceOrderSync.js
    marketplaceProductMap.js, integracaoEventLog.js, trayConfig.js
```

**Não copie** `marketplaceRoutes.js` completo — evita OAuth/painel no apiconfec. O pacote inclui **estoque** (Supabase) e **pedidos** (Nuvemshop → Pedido Aprovado).

## 2. Script de cópia (no PC)

```powershell
cd C:\NewDevelopment\azoup-ecommerce
.\deploy\apiconfec\copy-to-apiconfec.ps1 -Destino "C:\caminho\RNWebSupabase\backend\marketplace-ecommerce"
```

## 3. Alteração no `backend/index.js` do apiconfec

Adicione **uma vez**, depois das rotas existentes e **antes** de `app.listen`:

```javascript
// Webhooks e-commerce (opcional — só ativa com MARKETPLACE_WEBHOOK_SECRET)
void (async () => {
  if (!process.env.MARKETPLACE_WEBHOOK_SECRET?.trim()) {
    return;
  }
  try {
    const { default: marketplaceWebhookRoutes } = await import(
      './marketplace-ecommerce/routes/marketplaceWebhookRoutes.js'
    );
    app.use('/api/marketplace', marketplaceWebhookRoutes);
    console.log('[marketplace] Webhooks em /api/marketplace (stock-changed)');
  } catch (err) {
    console.error('[marketplace] Falha ao montar webhooks:', err.message);
  }
})();
```

**Nada mais do index.js precisa mudar.** NF-e, billing, storage, etc. continuam iguais.

## 4. Variáveis no `backend/.env` do apiconfec (produção)

Adicione (não remova as existentes):

```env
# Mesmo projeto Supabase do ERP
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Webhook estoque (igual à tabela marketplace_webhook_settings)
MARKETPLACE_WEBHOOK_SECRET=segredo-forte-igual-no-supabase

# App Nuvemshop (developer)
NUVEMSHOP_CLIENT_ID=...
NUVEMSHOP_CLIENT_SECRET=...

# Tokens OAuth das lojas (mesma chave do azoup-ecommerce)
TOKEN_ENCRYPTION_KEY=...

# Opcional — mesma URL pública do apiconfec
BACKEND_URL=https://apiconfec.azoup.com.br
```

`BACKEND_URL` é **obrigatório** para webhooks de **pedidos** Nuvemshop apontarem ao apiconfec.

## 5. SQL no Supabase (mesmo banco do Confec)

Rodar na ordem, no SQL Editor:

1. `database/marketplace_schema.sql` (se ainda não rodou)
2. `database/marketplace_stock_sync_config_migration.sql`
3. `database/marketplace_webhook_settings_migration.sql`
4. `database/marketplace_stock_sync_webhook.sql`

Configurar URL apontando para o **apiconfec**:

```sql
INSERT INTO public.marketplace_webhook_settings (id, backend_url, webhook_secret, stock_sync_enabled)
VALUES (
  1,
  'https://apiconfec.azoup.com.br',
  'MESMO-MARKETPLACE_WEBHOOK_SECRET',
  true
)
ON CONFLICT (id) DO UPDATE SET
  backend_url = EXCLUDED.backend_url,
  webhook_secret = EXCLUDED.webhook_secret,
  stock_sync_enabled = EXCLUDED.stock_sync_enabled,
  updated_at = now();
```

## 6. Registrar webhooks Nuvemshop (uma vez após deploy)

Com `BACKEND_URL=https://apiconfec.azoup.com.br` no `.env` e PM2 reiniciado:

```bash
curl -X POST https://apiconfec.azoup.com.br/api/marketplace/webhooks/nuvemshop/register \
  -H "x-marketplace-webhook-secret: SEU-MARKETPLACE_WEBHOOK_SECRET"
```

Resposta esperada: `webhookUrl` com apiconfec e eventos `order/created`, `order/paid`, etc. registrados.

## 7. Testes após deploy

```bash
curl -s https://apiconfec.azoup.com.br/api/marketplace/webhooks/ping
```

Movimente estoque no Confec (mesma **ponta** da loja Nuvemshop, observação **sem** "Nuvemshop").

Logs PM2:

```bash
pm2 logs
# Procure: [stock-changed] ou [webhooks/nuvemshop] Pedido ... importado
```

Teste de pedido: faça uma venda de teste na Nuvemshop (produtos **vinculados**, status/pagamento nas regras de importação em **Vendas → configurações** no painel e-commerce).

## 8. O que o ERP **não** precisa mudar

- Telas de estoque, venda, OP — já gravam `estoque_movimentacao`.
- `EXPO_PUBLIC_BACKEND_URL` do frontend — continua `apiconfec`.
- Nenhuma chamada manual do frontend ao webhook.

O trigger no Supabase chama o apiconfec após cada INSERT válido de estoque.
A Nuvemshop chama o apiconfec quando há pedido novo/atualizado/pago.

## 9. Painel e-commerce (azoup-ecommerce)

OAuth, comparar catálogo e **regras de importação de pedidos** continuam no app **azoup-ecommerce**. Em produção, **estoque e pedidos automáticos** rodam no apiconfec.

### Regras de pedido (importante)

No painel → **Vendas** → configurações: marque status de **pedido** e **pagamento** que devem virar **Pedido Aprovado** (padrão exige pedido `open`/`closed` **e** pagamento `paid`).
