-- Campos específicos da integração Tray Commerce
-- Execute no Supabase e recarregue o schema cache se necessário.

ALTER TABLE marketplace_integracao
  ADD COLUMN IF NOT EXISTS store_url VARCHAR(512),
  ADD COLUMN IF NOT EXISTS api_address VARCHAR(512),
  ADD COLUMN IF NOT EXISTS refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN marketplace_integracao.store_url IS 'URL pública da loja Tray (ex.: https://loja.commercesuite.com.br)';
COMMENT ON COLUMN marketplace_integracao.api_address IS 'Base da API Tray retornada no OAuth (ex.: https://loja.commercesuite.com.br/web_api)';
COMMENT ON COLUMN marketplace_integracao.refresh_token IS 'Refresh token Tray criptografado (TOKEN_ENCRYPTION_KEY)';
COMMENT ON COLUMN marketplace_integracao.token_expires_at IS 'Expiração do access_token Tray';
