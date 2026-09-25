-- Múltiplas lojas por marketplace + configuração por vínculo
-- Execute no Supabase (instalação nova OU banco que já tinha marketplace_schema antigo).
-- Idempotente: pode rodar mais de uma vez.

-- ---------------------------------------------------------------------------
-- marketplace_integracao — colunas por loja
-- ---------------------------------------------------------------------------
ALTER TABLE marketplace_integracao
  ADD COLUMN IF NOT EXISTS nome VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tabela_preco_id UUID REFERENCES tabela_precos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ponta_estoque_id UUID REFERENCES pontas_estoque(id) ON DELETE SET NULL;

UPDATE marketplace_integracao
   SET nome = COALESCE(NULLIF(TRIM(nome), ''), store_name, 'Loja ' || store_id)
 WHERE nome IS NULL OR TRIM(nome) = '';

ALTER TABLE marketplace_integracao
  ALTER COLUMN nome SET DEFAULT 'Loja';

-- Permite várias lojas do mesmo marketplace por tenant
ALTER TABLE marketplace_integracao
  DROP CONSTRAINT IF EXISTS marketplace_integracao_cliente_id_marketplace_key;

ALTER TABLE marketplace_integracao
  DROP CONSTRAINT IF EXISTS marketplace_integracao_cliente_marketplace_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_integracao_store
  ON marketplace_integracao (cliente_id, marketplace, store_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_integracao_cliente
  ON marketplace_integracao (cliente_id, status);

-- ---------------------------------------------------------------------------
-- marketplace_produto_map — vínculo por loja (integracao_id)
-- ---------------------------------------------------------------------------
ALTER TABLE marketplace_produto_map
  ADD COLUMN IF NOT EXISTS integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE CASCADE;

UPDATE marketplace_produto_map m
   SET integracao_id = i.id
  FROM marketplace_integracao i
 WHERE m.integracao_id IS NULL
   AND m.cliente_id = i.cliente_id
   AND m.marketplace = i.marketplace
   AND i.status = 'connected';

ALTER TABLE marketplace_produto_map
  DROP CONSTRAINT IF EXISTS marketplace_produto_map_cliente_id_marketplace_external_variant_id_key;

DROP INDEX IF EXISTS marketplace_produto_map_cliente_id_marketplace_external_variant_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_marketplace_map_integracao_variant
  ON marketplace_produto_map (integracao_id, external_variant_id)
  WHERE integracao_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_marketplace_map_integracao
  ON marketplace_produto_map (integracao_id, produto_id);

-- ---------------------------------------------------------------------------
-- marketplace_sync_log — integracao_id (opcional)
-- ---------------------------------------------------------------------------
ALTER TABLE marketplace_sync_log
  ADD COLUMN IF NOT EXISTS integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- marketplace_pedido_map — criar tabela se ainda não existir (schema antigo)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplace_pedido_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes_azoup(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL DEFAULT 'nuvemshop',
  integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE SET NULL,
  external_order_id VARCHAR(50) NOT NULL,
  external_order_number VARCHAR(50),
  venda_id BIGINT REFERENCES venda(id) ON DELETE SET NULL,
  payment_status VARCHAR(50),
  order_status VARCHAR(50),
  sync_status VARCHAR(30) NOT NULL DEFAULT 'imported',
  error_message TEXT,
  order_total NUMERIC(12, 2),
  customer_name VARCHAR(255),
  customer_email VARCHAR(255),
  order_created_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_id, marketplace, external_order_id)
);

ALTER TABLE marketplace_pedido_map
  ADD COLUMN IF NOT EXISTS integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE SET NULL;

ALTER TABLE marketplace_pedido_map
  ADD COLUMN IF NOT EXISTS customer_document VARCHAR(20);

ALTER TABLE marketplace_integracao
  ADD COLUMN IF NOT EXISTS import_order_statuses JSONB;

CREATE INDEX IF NOT EXISTS idx_marketplace_pedido_venda
  ON marketplace_pedido_map (cliente_id, venda_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_pedido_created
  ON marketplace_pedido_map (cliente_id, order_created_at DESC);

ALTER TABLE marketplace_pedido_map ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'marketplace_pedido_map'
       AND policyname = 'marketplace_pedido_map_select'
  ) THEN
    CREATE POLICY marketplace_pedido_map_select ON marketplace_pedido_map
      FOR SELECT USING (cliente_id = get_my_cliente_id());
  END IF;
END $$;
