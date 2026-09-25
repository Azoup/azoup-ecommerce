-- Marketplace integration schema — Azoup E-commerce
-- Cada registro é vinculado ao tenant em clientes_azoup (cliente_id).
-- Execute no Supabase do tenant (revisar antes de produção)

CREATE TABLE IF NOT EXISTS marketplace_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes_azoup(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL DEFAULT 'nuvemshop',
  client_id VARCHAR(255) NOT NULL,
  client_secret TEXT NOT NULL,
  redirect_uri VARCHAR(512),
  user_agent VARCHAR(255),
  api_version VARCHAR(20) NOT NULL DEFAULT '2025-03',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_id, marketplace)
);

CREATE TABLE IF NOT EXISTS marketplace_integracao (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes_azoup(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL DEFAULT 'nuvemshop',
  store_id VARCHAR(50) NOT NULL,
  access_token TEXT NOT NULL,
  scopes TEXT,
  store_name VARCHAR(255),
  nome VARCHAR(255) NOT NULL DEFAULT 'Loja',
  tabela_preco_id UUID REFERENCES tabela_precos(id) ON DELETE SET NULL,
  ponta_estoque_id UUID REFERENCES pontas_estoque(id) ON DELETE SET NULL,
  import_order_statuses JSONB,
  status VARCHAR(30) NOT NULL DEFAULT 'connected',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_id, marketplace, store_id)
);

CREATE TABLE IF NOT EXISTS marketplace_produto_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes_azoup(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL DEFAULT 'nuvemshop',
  integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  produto_cor_tamanho_id UUID REFERENCES produto_cor_tamanho(id) ON DELETE CASCADE,
  external_product_id VARCHAR(50) NOT NULL,
  external_variant_id VARCHAR(50) NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_sync_direction VARCHAR(30),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (integracao_id, external_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_map_integracao
  ON marketplace_produto_map (integracao_id, produto_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_integracao_cliente
  ON marketplace_integracao (cliente_id, status);

CREATE INDEX IF NOT EXISTS idx_marketplace_map_produto
  ON marketplace_produto_map (cliente_id, marketplace, produto_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_map_variacao
  ON marketplace_produto_map (cliente_id, produto_cor_tamanho_id);

CREATE TABLE IF NOT EXISTS marketplace_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes_azoup(id) ON DELETE CASCADE,
  marketplace VARCHAR(50) NOT NULL DEFAULT 'nuvemshop',
  integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE SET NULL,
  action VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL,
  external_product_id VARCHAR(50),
  produto_id UUID,
  payload JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_sync_log_cliente
  ON marketplace_sync_log (cliente_id, created_at DESC);

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
  customer_document VARCHAR(20),
  order_created_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (cliente_id, marketplace, external_order_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_pedido_venda
  ON marketplace_pedido_map (cliente_id, venda_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_pedido_created
  ON marketplace_pedido_map (cliente_id, order_created_at DESC);

-- RLS
ALTER TABLE marketplace_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_integracao ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_produto_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_pedido_map ENABLE ROW LEVEL SECURITY;

-- Frontend pode ler map e logs; tokens só via service role (sem policy SELECT em integracao para anon)
CREATE POLICY marketplace_map_select ON marketplace_produto_map
  FOR SELECT USING (cliente_id = get_my_cliente_id());

CREATE POLICY marketplace_map_all ON marketplace_produto_map
  FOR ALL USING (cliente_id = get_my_cliente_id())
  WITH CHECK (cliente_id = get_my_cliente_id());

CREATE POLICY marketplace_sync_log_select ON marketplace_sync_log
  FOR SELECT USING (cliente_id = get_my_cliente_id());

CREATE POLICY marketplace_pedido_map_select ON marketplace_pedido_map
  FOR SELECT USING (cliente_id = get_my_cliente_id());

-- marketplace_config / marketplace_integracao — secrets via service role only (sem policy SELECT)
-- marketplace_produto_map — cliente_id = get_my_cliente_id()
