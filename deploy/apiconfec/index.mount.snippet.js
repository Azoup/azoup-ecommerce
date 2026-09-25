// Cole no backend/index.js do apiconfec (após as rotas existentes)

// 1) No express.json existente, adicione verify para HMAC Nuvemshop (se ainda não tiver):
// const { captureNuvemshopWebhookRawBody } = await import(
//   './marketplace-ecommerce/lib/marketplaceWebhookBody.js'
// );
// app.use(express.json({ limit: '1mb', verify: captureNuvemshopWebhookRawBody }));

void (async () => {
  if (!process.env.MARKETPLACE_WEBHOOK_SECRET?.trim()) {
    return;
  }
  try {
    const { default: marketplaceWebhookRoutes } = await import(
      './marketplace-ecommerce/routes/marketplaceWebhookRoutes.js'
    );
    app.use('/api/marketplace', marketplaceWebhookRoutes);
    console.log('[marketplace] Webhooks: stock-changed + nuvemshop (pedidos)');
  } catch (err) {
    console.error('[marketplace] Falha ao montar webhooks:', err.message);
  }
})();
