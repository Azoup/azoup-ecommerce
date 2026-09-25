-- Sincronização de estoque Azoup ↔ Nuvemshop por loja (padrão: ativa)
ALTER TABLE marketplace_integracao
  ADD COLUMN IF NOT EXISTS sync_estoque BOOLEAN NOT NULL DEFAULT true;

UPDATE marketplace_integracao
SET sync_estoque = true
WHERE sync_estoque IS NULL;
