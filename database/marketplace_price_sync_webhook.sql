-- Sincronização automática de preços Azoup → Nuvemshop
-- Requer: extensão pg_net (Supabase) e MARKETPLACE_WEBHOOK_SECRET no backend/.env
--
-- Configure via database/marketplace_webhook_settings_migration.sql (INSERT na tabela).
-- NÃO use ALTER DATABASE no Supabase (permission denied).
--
-- Ou use Database Webhooks no painel Supabase:
--   Tabela: produto_cor_tamanho_tabela_preco
--   Eventos: INSERT, UPDATE
--   URL: https://SUA-API/api/marketplace/webhooks/product-price-changed
--   Header: x-marketplace-webhook-secret = MARKETPLACE_WEBHOOK_SECRET
--   Body: { "clienteId": "{{ record.produto_id }} via join", "produtoId": "{{ record.produto_id }}" }
--   (Database Webhook precisa incluir cliente_id via join com produtos — ver documentação Supabase)

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION marketplace_notify_product_price_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg record;
  backend_url text;
  webhook_secret text;
  target_produto_id uuid := COALESCE(NEW.produto_id, OLD.produto_id);
  target_cliente_id uuid;
BEGIN
  SELECT * INTO cfg FROM public.marketplace_get_webhook_config() LIMIT 1;
  backend_url := cfg.backend_url;
  webhook_secret := cfg.webhook_secret;

  IF backend_url IS NULL OR webhook_secret IS NULL OR target_produto_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF cfg.price_sync_enabled IS NOT TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT p.cliente_id
    INTO target_cliente_id
    FROM produtos p
   WHERE p.id = target_produto_id;

  IF target_cliente_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM net.http_post(
    url := rtrim(backend_url, '/') || '/api/marketplace/webhooks/product-price-changed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-marketplace-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'clienteId', target_cliente_id,
      'produtoId', target_produto_id
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_product_price_change
  ON produto_cor_tamanho_tabela_preco;

CREATE TRIGGER trg_marketplace_product_price_change
  AFTER INSERT OR UPDATE OF preco ON produto_cor_tamanho_tabela_preco
  FOR EACH ROW
  EXECUTE FUNCTION marketplace_notify_product_price_change();
