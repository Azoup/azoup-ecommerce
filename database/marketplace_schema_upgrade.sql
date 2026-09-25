-- Upgrade para bancos que JÁ tinham marketplace_schema.sql (versão antiga, uma loja).
-- NÃO rode marketplace_schema.sql de novo — ele usa CREATE TABLE IF NOT EXISTS e não altera tabelas existentes.
--
-- Rode apenas este arquivo + marketplace_multi_store_migration.sql (ou só multi_store, que já inclui tudo).

-- Colunas em marketplace_integracao (se faltarem)
ALTER TABLE marketplace_integracao
  ADD COLUMN IF NOT EXISTS nome VARCHAR(255),
  ADD COLUMN IF NOT EXISTS tabela_preco_id UUID REFERENCES tabela_precos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ponta_estoque_id UUID REFERENCES pontas_estoque(id) ON DELETE SET NULL;

-- integracao_id nas tabelas de map/log
ALTER TABLE marketplace_produto_map
  ADD COLUMN IF NOT EXISTS integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE CASCADE;

ALTER TABLE marketplace_sync_log
  ADD COLUMN IF NOT EXISTS integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE SET NULL;

-- Índice em integracao_id só depois da coluna existir
CREATE INDEX IF NOT EXISTS idx_marketplace_map_integracao
  ON marketplace_produto_map (integracao_id, produto_id);
