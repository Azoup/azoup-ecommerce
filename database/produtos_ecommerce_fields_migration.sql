-- Campos de catálogo e-commerce na tabela produtos
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS descricao TEXT;
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS peso NUMERIC(12, 3);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS altura NUMERIC(10, 2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS largura NUMERIC(10, 2);
ALTER TABLE produtos ADD COLUMN IF NOT EXISTS comprimento NUMERIC(10, 2);
