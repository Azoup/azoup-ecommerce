-- E-commerce vinculado (R$ 97/loja) — espelho no repo ecommerce
-- Rode no mesmo Supabase do Confec (idempotente).

ALTER TABLE public.assinaturas_clientes
    ADD COLUMN IF NOT EXISTS ecommerce_lojas_contratadas integer NOT NULL DEFAULT 0;

ALTER TABLE public.assinaturas_clientes
    ADD COLUMN IF NOT EXISTS stripe_item_id_ecommerce text NULL;

CREATE TABLE IF NOT EXISTS public.ecommerce_vinculo (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES public.clientes_azoup(id) ON DELETE CASCADE,
    empresa_id uuid NULL,
    marketplace_integracao_id uuid NULL,
    nome text NOT NULL,
    marketplace text NULL,
    store_external_id text NULL,
    store_name text NULL,
    ativo boolean NOT NULL DEFAULT true,
    stripe_subscription_item_id text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_vinculo_cliente
    ON public.ecommerce_vinculo (cliente_id);

CREATE INDEX IF NOT EXISTS idx_ecommerce_vinculo_cliente_ativo
    ON public.ecommerce_vinculo (cliente_id)
    WHERE ativo = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ecommerce_vinculo_loja_ativa
    ON public.ecommerce_vinculo (cliente_id, marketplace, store_external_id)
    WHERE ativo = true
      AND marketplace IS NOT NULL
      AND store_external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ecommerce_vinculo_integracao_ativa
    ON public.ecommerce_vinculo (marketplace_integracao_id)
    WHERE ativo = true
      AND marketplace_integracao_id IS NOT NULL;

ALTER TABLE public.ecommerce_vinculo ENABLE ROW LEVEL SECURITY;
