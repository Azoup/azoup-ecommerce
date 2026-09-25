-- Configuração de webhooks marketplace (Supabase hospedado)
-- NÃO use ALTER DATABASE SET app.* — permission denied no Supabase.
--
-- Depois de rodar este script, configure com INSERT/UPDATE (SQL Editor):
--
--   INSERT INTO public.marketplace_webhook_settings (id, backend_url, webhook_secret)
--   VALUES (
--     1,
--     'https://SUA-API-PUBLICA',
--     'mesmo-valor-de-MARKETPLACE_WEBHOOK_SECRET-no-backend'
--   )
--   ON CONFLICT (id) DO UPDATE SET
--     backend_url = EXCLUDED.backend_url,
--     webhook_secret = EXCLUDED.webhook_secret,
--     updated_at = now();
--
-- backend_url = só a base (sem /api/...). Ex.: https://api-ecommerce.seudominio.com.br

CREATE TABLE IF NOT EXISTS public.marketplace_webhook_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  backend_url text NOT NULL,
  webhook_secret text NOT NULL,
  stock_sync_enabled boolean NOT NULL DEFAULT true,
  price_sync_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.marketplace_webhook_settings IS
  'URL base da API e-commerce e segredo para triggers pg_net (estoque/preço). Uma linha (id=1).';

ALTER TABLE public.marketplace_webhook_settings ENABLE ROW LEVEL SECURITY;

-- Sem policy para authenticated: só funções SECURITY DEFINER leem o segredo.

CREATE OR REPLACE FUNCTION public.marketplace_get_webhook_config()
RETURNS TABLE (
  backend_url text,
  webhook_secret text,
  stock_sync_enabled boolean,
  price_sync_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    nullif(trim(s.backend_url), ''),
    nullif(trim(s.webhook_secret), ''),
    s.stock_sync_enabled,
    s.price_sync_enabled
  FROM public.marketplace_webhook_settings s
  WHERE s.id = 1;
$$;

REVOKE ALL ON public.marketplace_webhook_settings FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_get_webhook_config() FROM PUBLIC;
