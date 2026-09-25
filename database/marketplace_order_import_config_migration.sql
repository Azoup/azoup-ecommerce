-- Regras de importação de pedidos Nuvemshop → Pedido Aprovado (por loja)
-- JSON: { "order_statuses": ["open","closed","cancelled"], "payment_statuses": ["paid", ...] }
-- NULL = todos os status (padrão do sistema)

ALTER TABLE marketplace_integracao
  ADD COLUMN IF NOT EXISTS import_order_statuses JSONB;
