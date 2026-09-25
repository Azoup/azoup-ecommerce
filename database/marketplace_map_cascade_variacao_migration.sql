-- Remove vínculos marketplace quando a variação Azoup for excluída
ALTER TABLE marketplace_produto_map
  DROP CONSTRAINT IF EXISTS marketplace_produto_map_produto_cor_tamanho_id_fkey;

ALTER TABLE marketplace_produto_map
  ADD CONSTRAINT marketplace_produto_map_produto_cor_tamanho_id_fkey
  FOREIGN KEY (produto_cor_tamanho_id)
  REFERENCES produto_cor_tamanho(id)
  ON DELETE CASCADE;
