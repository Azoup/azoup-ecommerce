-- Seed de lookups globais/tenant para cadastro de produtos (Azoup E-commerce)
-- Execute no Supabase SQL Editor se origens ou grupos fiscais estiverem vazios.

-- Origens NFe (global)
INSERT INTO origens_produtos (codigo, descricao) VALUES
('0', 'Nacional'),
('1', 'Estrangeira - Importação direta, exceto a indicada no código 6'),
('2', 'Estrangeira - Adquirida no mercado interno, exceto a indicada no código 7'),
('3', 'Nacional, mercadoria ou bem com Conteúdo de Importação superior a 40% e inferior ou igual a 70%'),
('4', 'Nacional, cuja produção tenha sido feita em conformidade com os processos produtivos básicos'),
('5', 'Nacional, mercadoria ou bem com Conteúdo de Importação inferior ou igual a 40%'),
('6', 'Estrangeira - Importação direta, sem similar nacional, constante em lista da CAMEX'),
('7', 'Estrangeira - Adquirida no mercado interno, sem similar nacional, constante em lista da CAMEX'),
('8', 'Nacional, mercadoria ou bem com Conteúdo de Importação superior a 70%')
ON CONFLICT DO NOTHING;

-- Grupos fiscais padrão por tenant (substitua :cliente_id pelo UUID do tenant)
-- INSERT INTO grupos_fiscais (cliente_id, nome) VALUES
-- ('00000000-0000-0000-0000-000000000000', 'Tributado Integralmente'),
-- ('00000000-0000-0000-0000-000000000000', 'Simples Nacional'),
-- ('00000000-0000-0000-0000-000000000000', 'Substituição Tributária');
