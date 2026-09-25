-- Migração: credenciais Nuvemshop por tenant (clientes_azoup)
-- Execute se marketplace_schema.sql já foi aplicado sem marketplace_config

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

ALTER TABLE marketplace_config ENABLE ROW LEVEL SECURITY;
