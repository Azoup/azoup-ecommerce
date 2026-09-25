-- RLS Reference — Azoup E-commerce Integration
-- Este arquivo documenta as políticas RLS esperadas no Supabase compartilhado.
-- NÃO executar em produção sem revisão — as políticas já devem existir no ERP principal.

-- ============================================================
-- 1. Função central de tenant
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_cliente_id()
RETURNS uuid AS $$
  SELECT cliente_id FROM usuarios WHERE auth_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 2. Tabela usuarios
-- ============================================================
-- SELECT/UPDATE/DELETE: cliente_id = get_my_cliente_id()
-- INSERT: auth.uid() = auth_id (auto-cadastro)

-- ============================================================
-- 3. Tabelas operacionais (produtos, categorias, etc.)
-- ============================================================
-- Padrão: cliente_id = get_my_cliente_id()
-- Exemplos:
--   produtos, categorias, subcategorias, grupos_fiscais
--   produto_cor_tamanho (via join produtos.cliente_id)
--   produto_cor_tamanho_tabela_preco
--   produto_imagem, produto_ficha_tecnica
--   tabela_precos, roteiros_producao
--   marketplace_produto_map, marketplace_sync_log (integracao via service role only)

-- ============================================================
-- 4. Tabelas marketplace (integração e-commerce)
-- ============================================================
-- marketplace_config — legado/opcional; credenciais do app ficam no backend/.env
-- marketplace_integracao — token OAuth por loja/cliente (clientes_azoup)
-- marketplace_produto_map — cliente_id = get_my_cliente_id()
-- marketplace_pedido_map — SELECT por tenant; INSERT via backend (service role)
-- marketplace_sync_log — SELECT por tenant; INSERT via backend

-- ============================================================
-- 5. Tabelas globais (sem filtro tenant)
-- ============================================================
-- origens_produtos — leitura para todos autenticados

-- ============================================================
-- 5. Storage bucket "produtos"
-- ============================================================
-- Upload/delete via backend com service role + validação JWT
-- Path pattern: {cliente_id}/{produto_id}/{filename}

-- ============================================================
-- 6. Checklist de verificação pós-deploy
-- ============================================================
-- [ ] Usuário tenant A não vê produtos do tenant B
-- [ ] INSERT produtos exige cliente_id = get_my_cliente_id()
-- [ ] Upload sem JWT retorna 401
-- [ ] Upload com produto de outro tenant retorna 403
-- [ ] Usuário ativo=false é rejeitado no login
-- [ ] password_reset_challenges acessível apenas via service role

-- ============================================================
-- 7. Exemplo de política para produtos
-- ============================================================
/*
ALTER TABLE produtos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "produtos_select_own_tenant" ON produtos
  FOR SELECT USING (cliente_id = get_my_cliente_id());

CREATE POLICY "produtos_insert_own_tenant" ON produtos
  FOR INSERT WITH CHECK (cliente_id = get_my_cliente_id());

CREATE POLICY "produtos_update_own_tenant" ON produtos
  FOR UPDATE USING (cliente_id = get_my_cliente_id());

CREATE POLICY "produtos_delete_own_tenant" ON produtos
  FOR DELETE USING (cliente_id = get_my_cliente_id());
*/
