-- Sincronização automática de estoque Azoup → Nuvemshop (e outros marketplaces)
--
-- PRÉ-REQUISITOS (rodar antes, no mesmo Supabase do ERP):
--   1. database/marketplace_schema.sql
--   2. database/marketplace_stock_sync_config_migration.sql
--   3. database/marketplace_webhook_settings_migration.sql  ← config (sem ALTER DATABASE)
--   4. Extensão pg_net habilitada (Supabase → Database → Extensions)
--   5. Backend e-commerce: MARKETPLACE_WEBHOOK_SECRET = mesmo valor da tabela abaixo
--
-- CONFIGURAR URL e segredo (SQL Editor — funciona no Supabase):
--
--   INSERT INTO public.marketplace_webhook_settings (id, backend_url, webhook_secret)
--   VALUES (1, 'https://SUA-API-PUBLICA', 'seu-segredo')
--   ON CONFLICT (id) DO UPDATE SET
--     backend_url = EXCLUDED.backend_url,
--     webhook_secret = EXCLUDED.webhook_secret,
--     updated_at = now();
--
-- ALTERNATIVA sem pg_net: Supabase Dashboard → Database → Webhooks
--   Tabela estoque_movimentacao | INSERT
--   URL: https://SUA-API/api/marketplace/webhooks/stock-changed
--   Header: x-marketplace-webhook-secret
--
-- IMPORTANTE: localhost NÃO funciona — a API precisa ser HTTPS pública na internet.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.marketplace_is_origem_ecommerce(p_observacao text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    lower(trim(p_observacao)) LIKE '%nuvemshop%'
    OR lower(trim(p_observacao)) LIKE '%e-commerce sync%'
    OR lower(trim(p_observacao)) LIKE '%ecommerce sync%'
    OR lower(trim(p_observacao)) LIKE '%marketplace sync%',
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.marketplace_tem_map_estoque_ativo(
  p_cliente_id uuid,
  p_variacao_id uuid,
  p_ponta_estoque_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.marketplace_produto_map') IS NULL
     OR to_regclass('public.marketplace_integracao') IS NULL THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM marketplace_produto_map mpm
    JOIN marketplace_integracao mi ON mi.id = mpm.integracao_id
    WHERE mpm.cliente_id = p_cliente_id
      AND mpm.produto_cor_tamanho_id = p_variacao_id
      AND mi.cliente_id = p_cliente_id
      AND mi.status = 'connected'
      AND COALESCE(mi.sync_estoque, true) = true
      AND (
        mi.ponta_estoque_id IS NULL
        OR mi.ponta_estoque_id = p_ponta_estoque_id
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.marketplace_notify_stock_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net
AS $$
DECLARE
  cfg record;
  backend_url text;
  webhook_secret text;
  target_produto_id uuid := COALESCE(NEW.produto_id, NEW.item_id);
BEGIN
  SELECT * INTO cfg FROM public.marketplace_get_webhook_config() LIMIT 1;

  backend_url := cfg.backend_url;
  webhook_secret := cfg.webhook_secret;

  IF backend_url IS NULL OR webhook_secret IS NULL THEN
    RETURN NEW;
  END IF;

  IF cfg.stock_sync_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.tipo_item IS DISTINCT FROM 'produto' THEN
    RETURN NEW;
  END IF;

  IF NEW.variacao_id IS NULL OR target_produto_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ponta_estoque_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.marketplace_is_origem_ecommerce(NEW.observacao) THEN
    RETURN NEW;
  END IF;

  IF NOT public.marketplace_tem_map_estoque_ativo(
    NEW.cliente_id_tenant,
    NEW.variacao_id,
    NEW.ponta_estoque_id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := rtrim(backend_url, '/') || '/api/marketplace/webhooks/stock-changed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-marketplace-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object(
      'clienteId', NEW.cliente_id_tenant,
      'produtoId', target_produto_id,
      'variacaoId', NEW.variacao_id,
      'pontaEstoqueId', NEW.ponta_estoque_id,
      'observacao', NEW.observacao
    ),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
EXCEPTION
  WHEN undefined_function THEN
    RAISE WARNING 'marketplace_notify_stock_change: pg_net indisponível (habilite a extension pg_net).';
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE WARNING 'marketplace_notify_stock_change: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_stock_change ON public.estoque_movimentacao;

CREATE TRIGGER trg_marketplace_stock_change
  AFTER INSERT ON public.estoque_movimentacao
  FOR EACH ROW
  EXECUTE FUNCTION public.marketplace_notify_stock_change();

COMMENT ON FUNCTION public.marketplace_notify_stock_change() IS
  'Dispara POST para API e-commerce após movimentação manual de estoque de produto (ledger).';
