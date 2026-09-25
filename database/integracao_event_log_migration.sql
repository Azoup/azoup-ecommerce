-- Log unificado de eventos do e-commerce / integração
CREATE TABLE IF NOT EXISTS integracao_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes_azoup(id) ON DELETE CASCADE,
  categoria VARCHAR(40) NOT NULL,
  nivel VARCHAR(20) NOT NULL DEFAULT 'info',
  acao VARCHAR(80) NOT NULL,
  marketplace VARCHAR(50) NOT NULL DEFAULT 'nuvemshop',
  integracao_id UUID REFERENCES marketplace_integracao(id) ON DELETE SET NULL,
  loja_nome VARCHAR(255),
  titulo VARCHAR(300) NOT NULL,
  mensagem TEXT,
  referencia_tipo VARCHAR(50),
  referencia_id VARCHAR(100),
  usuario_id UUID,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integracao_event_log_cliente_created
  ON integracao_event_log (cliente_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integracao_event_log_categoria
  ON integracao_event_log (cliente_id, categoria, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_integracao_event_log_integracao
  ON integracao_event_log (integracao_id, created_at DESC);

ALTER TABLE integracao_event_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'integracao_event_log'
       AND policyname = 'integracao_event_log_select'
  ) THEN
    CREATE POLICY integracao_event_log_select ON integracao_event_log
      FOR SELECT USING (cliente_id = get_my_cliente_id());
  END IF;
END $$;
