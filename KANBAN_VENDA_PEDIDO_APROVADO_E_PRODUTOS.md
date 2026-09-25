# Kanban de Venda (Pedido Aprovado) e telas de Produtos

Documento de referência para **integração de outro sistema** com o Azoup: inserir pedidos já aprovados no Kanban de Vendas e replicar o modelo de **consulta/cadastro de produtos**.

**Fontes no código:** `frontend/src/components/VendaKanban.js`, `VendaForm.js`, `ProductList.js`, `ProductForm.js`, `frontend/database/`.

---

## 1. Conceito central — coluna "Pedido Aprovado"

No Azoup, **não existe tabela separada de status do Kanban**. A coluna em que o card aparece é determinada pelos campos **`venda.tipo`** e **`venda.etapa`**.

| Coluna no Kanban | Valor em `venda.tipo` e `venda.etapa` |
|------------------|----------------------------------------|
| Orçamento | `Orçamento` |
| Pedido em Analise | `Pedido em Analise` (legado: `Pedido` é mapeado para esta coluna) |
| **Pedido Aprovado** | **`Pedido Aprovado`** |
| Faturamento | *virtual* — não grava em `venda`; usa `venda_faturamento` |
| Cancelados | `Cancelados` |

### Regra para o sistema externo inserir pedido aprovado

1. Inserir registro em **`venda`** com **`tipo = 'Pedido Aprovado'`** e **`etapa = 'Pedido Aprovado'`** (os dois campos com o mesmo texto).
2. Inserir linhas em **`venda_itens`** vinculadas ao `venda.id`.
3. Preencher **`cliente_id_tenant`** (tenant SaaS / `clientes_azoup.id`) — obrigatório para o Kanban listar o pedido.
4. Garantir que **`produto_id`** e, preferencialmente, **`produto_cor_tamanho_id`** existam e pertençam ao mesmo tenant.

**Importante:** mover um card para "Pedido Aprovado" no Kanban **apenas faz UPDATE** em `venda`. Não há trigger automática que crie OP, faturamento ou estoque. Essas ações são manuais depois.

---

## 2. Colunas fixas do Kanban de Vendas

Definidas em `VendaKanban.js` (`KANBAN_COLUNAS_FIXAS`):

| Ordem | Coluna | Ícone (Ionicons) | Observação |
|------:|--------|------------------|------------|
| 1 | Orçamento | `document-text-outline` | |
| 2 | Pedido em Analise | `hourglass-outline` | Valor legado `Pedido` → esta coluna |
| 3 | **Pedido Aprovado** | `checkmark-circle-outline` | Ações: Gerar OP, Faturar, Romaneio, Pendentes |
| 4 | Faturamento | `receipt-outline` | Cards de `venda_faturamento`, não de `venda.tipo` |
| 5 | Cancelados | `close-circle-outline` | |

Existe também a tabela opcional **`venda_kanban_coluna`** (configuração por tenant), mas a tela principal usa as colunas fixas acima.

---

## 3. Como o app resolve a coluna de um pedido

```javascript
// VendaKanban.js — simplificado
function getColunaVenda(v, colunas) {
    const raw = mapValorKanbanAntigoParaAtual(v.tipo || v.etapa || 'Pedido');
    // 'Pedido' legado → 'Pedido em Analise'
    const colEncontrada = colunas.find(c => normalizeTexto(c.nome) === normalizeTexto(raw));
    return colEncontrada ? colEncontrada.nome : colunas[0].nome;
}
```

- Comparação **case-insensitive** e **sem acentos**.
- Usa `tipo` com fallback para `etapa`.
- Para aparecer em **Pedido Aprovado**, ambos devem ser exatamente o texto esperado (recomendado: gravar os dois iguais).

### Regra de exibição na coluna Pedido Aprovado

Um card só aparece na coluna se:

1. `getColunaVenda(v) === 'Pedido Aprovado'`, **e**
2. `qtdPendenteTotal > 0` (ainda há quantidade não faturada nos itens).

`qtdPendenteTotal` = soma de `(quantidade - quantidade já faturada)` por item, considerando `venda_faturamento_itens`.

Se todo o pedido já foi faturado, o card **some** da coluna (mesmo com `tipo/etapa` ainda em Pedido Aprovado).

---

## 4. Tabelas do Kanban de Venda

### 4.1 `venda` (cabeçalho do pedido/orçamento)

**Schema base:** `frontend/database/origem_pedido_venda_schema.sql`  
**Kanban livre em tipo/etapa:** `frontend/database/venda_tipo_kanban_migration.sql`

| Campo | Tipo | Obrigatório integração | Descrição |
|-------|------|------------------------|-----------|
| `id` | BIGSERIAL PK | auto | ID do pedido |
| `cliente_id_tenant` | UUID → `clientes_azoup` | **sim** | Tenant (filtro do Kanban) |
| `empresa_id` | UUID → `empresas` | recomendado | CNPJ emitente |
| `cliente_id` | UUID → `clientes_cadastros` | recomendado | Cliente comprador |
| **`tipo`** | VARCHAR(100) | **sim** | Nome da coluna Kanban |
| **`etapa`** | VARCHAR(100) | **sim** | Nome da coluna Kanban |
| `codigo_pedido` | VARCHAR(50) | recomendado | Número exibido no card |
| `vendedor_id` | UUID → `usuarios` | opcional | |
| `origem_pedido_id` | UUID → `origem_pedido` | opcional | Canal de venda |
| `tipo_operacao_id` | UUID → `tipo_operacao` | opcional | Tipo operação NF-e |
| `tabela_preco_id` | UUID → `tabela_precos` | opcional | Tabela de preço usada |
| `prazo_entrega` | VARCHAR/TEXT | opcional | Ex.: `15 dias (25/07/2026)` |
| `observacao` | TEXT | opcional | |
| `desconto_tipo` | VARCHAR | opcional | `percentual` ou `valor` |
| `desconto_valor` | NUMERIC | opcional | |
| `frete` | NUMERIC | opcional | |
| **`valor_total`** | NUMERIC | **sim** | Total do pedido |
| `plano_contas_id`, `centro_custo_id` | UUID | opcional | DRE |
| Campos NF-e transporte | vários | opcional | `migration_nfe_campos.sql` |
| `created_at`, `updated_at` | TIMESTAMPTZ | auto | |

### 4.2 `venda_itens` (linhas do pedido)

| Campo | Tipo | Obrigatório integração | Descrição |
|-------|------|------------------------|-----------|
| `id` | UUID PK | auto | |
| `venda_id` | BIGINT → `venda` | **sim** | |
| `produto_id` | UUID → `produtos` | **sim** | |
| `produto_cor_tamanho_id` | UUID → `produto_cor_tamanho` | **fortemente recomendado** | Variação cor/tamanho |
| `cor` | VARCHAR(100) | recomendado | Cópia textual da cor |
| `tamanho` | VARCHAR(50) | recomendado | Cópia textual do tamanho |
| `quantidade` | NUMERIC(12,3) | **sim** | |
| `valor_unitario` | NUMERIC(12,2) | **sim** | |
| `valor_total` | NUMERIC(12,2) | **sim** | `quantidade × valor_unitario` |
| `valor_unitario_base` | NUMERIC | opcional | Preço base antes de desconto |
| `quantidade_expedicao` | NUMERIC | opcional | Qtd já romaneada/expedida |
| `item_pedido_compra` | — | opcional | Vínculo compra |

### 4.3 Tabelas relacionadas (não criadas ao aprovar)

| Tabela | Quando é usada |
|--------|----------------|
| `venda_faturamento` | Ao clicar **Faturar** na coluna Pedido Aprovado |
| `venda_faturamento_itens` | Itens de cada faturamento parcial |
| `venda_forma_pagamento` / `venda_parcela` | Condições de pagamento (cadastro de venda) |
| `contas_receber` / `parcelas_contas_receber` | Financeiro gerado no faturamento |
| `producao_op` / `producao_op_item` | Ao clicar **Gerar OP** |
| `estoque_movimentacao` | Romaneio, cancelamento com expedição, etc. |
| `origem_pedido` | Cadastro de canais de venda por tenant |
| `venda_adicional` | Adicionais do pedido |
| `venda_imagem_ia` / `venda_imagem_externa` | Imagens anexadas à venda |

### 4.4 Diagrama simplificado

```
clientes_azoup (tenant)
  └── venda (cliente_id_tenant)
        ├── venda_itens → produtos, produto_cor_tamanho
        ├── venda_faturamento → venda_faturamento_itens
        ├── venda_forma_pagamento → venda_parcela
        └── producao_op (pedido_id → venda.id)
```

**Dois tipos de "cliente":**

- `cliente_id_tenant` → conta Azoup (`clientes_azoup`)
- `cliente_id` → cliente final da confecção (`clientes_cadastros`)

---

## 5. Inserção de pedido aprovado (guia para sistema externo)

### 5.1 Payload mínimo recomendado

**Passo 1 — `venda`:**

```json
{
  "cliente_id_tenant": "<uuid-do-tenant>",
  "empresa_id": "<uuid-empresa>",
  "cliente_id": "<uuid-cliente-cadastro>",
  "tipo": "Pedido Aprovado",
  "etapa": "Pedido Aprovado",
  "codigo_pedido": "EXT-2026-00042",
  "valor_total": 1500.00,
  "frete": 0,
  "desconto_valor": 0,
  "observacao": "Pedido importado do sistema externo"
}
```

**Passo 2 — `venda_itens` (uma linha por variação):**

```json
{
  "venda_id": 12345,
  "produto_id": "<uuid-produto>",
  "produto_cor_tamanho_id": "<uuid-variacao>",
  "cor": "Azul",
  "tamanho": "M",
  "quantidade": 10,
  "valor_unitario": 75.00,
  "valor_unitario_base": 75.00,
  "valor_total": 750.00,
  "quantidade_expedicao": 0
}
```

### 5.2 Exemplo SQL (ilustrativo)

```sql
-- 1) Cabeçalho
INSERT INTO venda (
  cliente_id_tenant, empresa_id, cliente_id,
  tipo, etapa, codigo_pedido, valor_total, frete, desconto_valor
) VALUES (
  '...tenant...', '...empresa...', '...cliente...',
  'Pedido Aprovado', 'Pedido Aprovado', 'EXT-001', 750.00, 0, 0
)
RETURNING id;

-- 2) Itens (repetir por linha)
INSERT INTO venda_itens (
  venda_id, produto_id, produto_cor_tamanho_id,
  cor, tamanho, quantidade, valor_unitario, valor_unitario_base, valor_total
) VALUES (
  12345, '...produto...', '...variacao...',
  'Azul', 'M', 10, 75.00, 75.00, 750.00
);
```

### 5.3 O que o Azoup faz ao receber esse pedido

| Ação automática | Ocorre? |
|-----------------|--------|
| Card aparece em Pedido Aprovado | Sim, se `qtdPendenteTotal > 0` |
| Cria OP de produção | Não |
| Cria faturamento / NF-e | Não |
| Baixa estoque | Não |
| Cria contas a receber | Não (só se cadastrar formas de pagamento no fluxo completo) |

### 5.4 Atualizar estágio depois (equivalente ao arrastar no Kanban)

```sql
UPDATE venda
SET tipo = 'Pedido Aprovado', etapa = 'Pedido Aprovado', updated_at = NOW()
WHERE id = 12345;
```

Outros destinos comuns: `'Pedido em Analise'`, `'Orçamento'`, `'Cancelados'`.

---

## 6. Consulta usada pelo Kanban (referência)

Arquivo: `frontend/src/components/VendaKanban.js` → `fetchVendas()`

```sql
-- Conceitual (Supabase select)
SELECT v.id, v.tipo, v.etapa, v.codigo_pedido, v.valor_total, ...
FROM venda v
WHERE v.cliente_id_tenant = :tenant
ORDER BY v.created_at DESC;

-- Itens aninhados
SELECT id, quantidade, quantidade_expedicao, valor_unitario, cor, tamanho,
       produtos(nome, sku, categorias(nome), subcategorias(nome))
FROM venda_itens WHERE venda_id = v.id;
```

Complementos carregados em paralelo:

- `producao_op` (`pedido_id`, `status`) — pill de produção no card
- `venda_faturamento` + `venda_faturamento_itens` — coluna Faturamento e cálculo de pendente
- `nota_fiscal` — número da NF no card de faturamento

### Ações disponíveis no card em Pedido Aprovado

| Botão | Efeito |
|-------|--------|
| Gerar OP | INSERT em `producao_op` + `producao_op_item` |
| Faturar | Abre tela de faturamento parcial |
| Pendentes | Modal com saldo não faturado por item |
| Romaneio | Atualiza `venda_itens.quantidade_expedicao` |
| Visualizar / Editar | Abre `VendaForm` |

---

## 7. Telas de Produtos — arquitetura

Não há `ProductsScreen.js` separado. O menu **Products** no `DashboardScreen.js` usa o componente interno **`ProductsView`** com três modos:

| Modo | Componente | Função |
|------|------------|--------|
| `list` | `ProductList.js` | Consulta / listagem |
| `form` | `ProductForm.js` | Cadastro e edição |
| `dashboard` | `ProdutoDashboardScreen.js` | Drill-down analítico |

**Arquivos:**

- `frontend/src/screens/DashboardScreen.js` (roteamento `activeMenu === 'Products'`)
- `frontend/src/components/ProductList.js`
- `frontend/src/components/ProductForm.js`
- `frontend/src/components/ProdutoDashboardScreen.js`

---

## 8. Tela de consulta de produtos (`ProductList`)

### Layout

| Área | Conteúdo |
|------|----------|
| Cabeçalho | Título **"Consulta de Produtos"** + botão **Novo Produto** |
| Filtro | Campo único de busca (nome ou SKU, client-side) |
| Desktop (≥768px) | Tabela horizontal com scroll |
| Mobile | Cards empilhados |

### Colunas da tabela (desktop)

| Coluna | Origem |
|--------|--------|
| Produto | `produtos.nome` + badge ativo/inativo |
| Categoria / Subcategoria | `categorias.nome` / `subcategorias.nome` |
| SKU | `produtos.sku` |
| Variações | count de `produto_cor_tamanho` |
| Ações | Editar, Duplicar, Excluir |

### Query Supabase

```javascript
supabase.from('produtos').select(`
  *,
  categorias(nome),
  subcategorias(nome),
  produto_cor_tamanho(count)
`)
.eq('cliente_id', userData.cliente_id)
.order('nome', { ascending: true });
```

### Interações

- **Toque na linha** → abre dashboard do produto
- **Editar** → `ProductForm` em modo edição
- **Duplicar** → novo produto com dados copiados
- **Excluir** → bloqueado se houver FK (vendas, estoque); orienta inativar

---

## 9. Tela de cadastro de produtos (`ProductForm`)

### Abas (`GlowTabBar`)

| ID | Label | Ícone | Cor destaque | Quando habilitada |
|----|-------|-------|--------------|-------------------|
| `dados` | Dados Principais | `document-text-outline` | Azul `#3B82F6` | Sempre |
| `imagens` | Imagens | `images-outline` | Laranja `#F97316` | Após salvar + campos obrigatórios |
| `ficha` | Ficha Técnica | `clipboard-outline` | Verde `#22C55E` | Idem |
| `produção` | Produção | `construct-outline` | Roxo `#8B5CF6` | Idem |
| `custos` | Custos | `cash-outline` | Vermelho `#EF4444` | Idem |

Abas secundárias ficam desabilitadas até `principalFieldsReady`:

- Nome, SKU, unidade, NCM válido, grupo fiscal, origem
- Pelo menos 1 cor e 1 tamanho
- EAN13 válido (se preenchido)

### Aba: Dados Principais

| Seção | Campos | Tabela(s) |
|-------|--------|-----------|
| Dados gerais | Nome*, SKU*, checkbox Inativo | `produtos` |
| Fiscal | NCM*, Unidade* | `produtos.ncm`, `produtos.unidade`, `produtos.cest` (auto) |
| Classificação | Categoria, Subcategoria | `categorias`, `subcategorias` |
| Fiscal/NF-e | Grupo Fiscal*, Origem* | `grupos_fiscais`, `origens_produtos` |
| Variações | Cores, tamanhos, ordem | `produto_cor_tamanho` |
| Matriz de preços | Tabela de preço, preço por cor×tamanho, EAN13, SKU variação | `produto_cor_tamanho`, `produto_cor_tamanho_tabela_preco` |

**Observação:** preços ficam em `produto_cor_tamanho_tabela_preco`, não na coluna legada `produto_cor_tamanho.preco_venda`.

### Aba: Imagens

- Upload → storage + `produto_imagem` (`url_imagem`, `observacao`)
- Grid com preview modal

### Aba: Ficha Técnica

| Seção | Tabelas |
|-------|---------|
| Observação, dificuldade 1–5, partes (Camisa/Calça…) | `produto_ficha_tecnica`, `produto_ficha_tecnica_partes` |
| Consumo de tecidos | `ficha_tecnica_consumo_tecido`, `ficha_tecnica_consumo_tecido_tamanho` |
| Consumo de aviamentos | `ficha_tecnica_consumo_aviamento`, `ficha_tecnica_consumo_aviamento_tamanho` |

Tipos de consumo: `geral`, `tamanho`, `tamanho_cor`.

### Aba: Produção

| Seção | Tabelas |
|-------|---------|
| Roteiro de produção | `produtos.roteiro_id` → `roteiros_producao` |
| Custo mão de obra por fase | `produto_fase_custo` + `roteiro_producao_fases` |

### Aba: Custos (análise)

- Calcula custo médio (tecido + aviamento + MO) por cor×tamanho
- Permite aplicar preço sugerido na tabela selecionada
- Somente leitura + botão "Atualizar Preço na Tabela"

### Ordem de gravação no save (`handleSave`)

1. `produtos` (insert/update)
2. `produto_cor_tamanho` (diff preservando IDs — importante para `venda_itens`)
3. `produto_cor_tamanho_tabela_preco` (replace por produto)
4. `produto_fase_custo` (se houver)
5. Ficha técnica via botão próprio na aba

---

## 10. Tabelas de produtos (modelo de dados)

### 10.1 Núcleo

#### `produtos`

| Campo | Descrição |
|-------|-----------|
| `id` | UUID PK |
| `cliente_id` | UUID → `clientes_azoup` (tenant) |
| `nome` | Nome do produto |
| `sku` | SKU numérico único por tenant |
| `categoria_id`, `subcategoria_id` | Classificação |
| `inativo` | BOOLEAN |
| `unidade`, `ncm`, `cest` | Fiscal |
| `origem_id` | → `origens_produtos` |
| `grupo_fiscal_id` | → `grupos_fiscais` |
| `roteiro_id` | → `roteiros_producao` |

**Schema:** `frontend/database/products_schema.sql`

#### `produto_cor_tamanho` (variações — não existe tabela `variacoes`)

| Campo | Descrição |
|-------|-----------|
| `id` | UUID PK — **usado em `venda_itens.produto_cor_tamanho_id`** |
| `produto_id` | FK produto |
| `cor`, `tamanho` | UNIQUE `(produto_id, cor, tamanho)` |
| `sku_variacao`, `ean13` | Identificadores |
| `ordem` | Ordem de exibição dos tamanhos |
| `estoque` | Saldo (não editado no form; vem da movimentação) |
| `preco_venda` | Legado; preços atuais na tabela abaixo |

#### `produto_cor_tamanho_tabela_preco` (preços)

| Campo | Descrição |
|-------|-----------|
| `produto_id`, `cor`, `tamanho` | Identifica variação |
| `tabela_preco_id` | → `tabela_precos` |
| `preco` | Preço na tabela |

#### `tabela_precos`

| Campo | Descrição |
|-------|-----------|
| `id`, `cliente_id`, `descricao`, `ativo` | Cada tenant tem tabela "Padrão" (trigger automático) |

### 10.2 Imagens e ficha técnica

| Tabela | Relação |
|--------|---------|
| `produto_imagem` | N imagens por produto |
| `produto_ficha_tecnica` | 1 por produto |
| `produto_ficha_tecnica_partes` | Partes da peça (kit) |
| `ficha_tecnica_consumo_tecido` + `_tamanho` | BOM tecido |
| `ficha_tecnica_consumo_aviamento` + `_tamanho` | BOM aviamento |

### 10.3 Produção e custos

| Tabela | Relação |
|--------|---------|
| `roteiros_producao` | Cabeçalho do roteiro |
| `roteiro_producao_fases` | Fases/colunas do Kanban produção |
| `produto_fase_custo` | Custo MO por fase × produto |

### 10.4 Lookups usados no cadastro

| Tabela | Uso |
|--------|-----|
| `categorias` / `subcategorias` | Classificação |
| `origens_produtos` | Origem mercadoria (global) |
| `grupos_fiscais` | Regras fiscais por tenant |
| `tecidos` / `tecido_cor` | Ficha técnica |
| `aviamentos` / `aviamento_cor_tamanho` | Ficha técnica |

### 10.5 RPC útil

- `get_next_produto_sku()` — próximo SKU numérico (`update_sku_schema.sql`)

### 10.6 Diagrama ER (produto)

```
clientes_azoup
  └── produtos
        ├── produto_cor_tamanho ── produto_cor_tamanho_tabela_preco ── tabela_precos
        ├── produto_imagem
        ├── produto_ficha_tecnica
        │     ├── produto_ficha_tecnica_partes
        │     ├── ficha_tecnica_consumo_tecido → tecidos
        │     └── ficha_tecnica_consumo_aviamento → aviamentos
        └── produto_fase_custo → roteiro_producao_fases
```

---

## 11. Design visual (referência para replicar telas)

Paleta e tema: `frontend/src/contexts/ThemeContext.js`, `frontend/src/constants/colors.js`.

| Token | Uso típico |
|-------|------------|
| `primary` `#FF8B17` | Botões principais, destaques |
| `secondary` `#0F0F41` | Textos, sidebar |
| `background` `#F7F7F7` | Fundo das telas |
| `surface` `#FFFFFF` | Cards e formulários |
| `cadastroAction` | Botões de ação em cadastros |

### Padrões de UI

- **Cards** com `borderRadius: 14`, borda `theme.border`
- **Formulários:** `FormInput`, `getStandardPickerStyles`
- **Listas:** `CadastroListActionsMenu` (menu ⋮ com Editar/Duplicar/Excluir)
- **Abas do produto:** `GlowTabBar` com gradiente radial por aba
- **Kanban vendas:** colunas horizontais, cards arrastáveis (web: drag HTML5), pills de status
- **Responsivo:** breakpoint principal `768px` (mobile vs desktop)

Documento de design do Kanban de **produção** (referência de estilo): `frontend/docs/KANBAN_PRODUCAO_E_DESIGN.md`.

---

## 12. Checklist integração — sistema externo

### Pedido aprovado

- [ ] `cliente_id_tenant` válido e mesmo ambiente Supabase
- [ ] `tipo` e `etapa` = `'Pedido Aprovado'` (texto exato)
- [ ] `valor_total` coerente com soma dos itens
- [ ] Cada item com `produto_id` existente no tenant
- [ ] Cada item com `produto_cor_tamanho_id` quando possível
- [ ] `quantidade_expedicao` = 0 em pedidos novos
- [ ] `codigo_pedido` único/legível para rastreio

### Produtos (se o outro sistema também cadastrar)

- [ ] Criar `produtos` + `produto_cor_tamanho` antes de vincular em `venda_itens`
- [ ] Gravar preços em `produto_cor_tamanho_tabela_preco`
- [ ] NCM, grupo fiscal e origem preenchidos (exigidos no form Azoup)
- [ ] Não deletar variação com vendas vinculadas — inativar produto

---

## 13. Migrations e arquivos de referência

| Assunto | Arquivo |
|---------|---------|
| Schema venda/itens | `frontend/database/origem_pedido_venda_schema.sql` |
| Kanban tipo livre | `frontend/database/venda_tipo_kanban_migration.sql` |
| Colunas configuráveis | `frontend/database/venda_kanban_coluna_schema.sql` |
| Faturamento | `frontend/database/migration_venda_faturamento_schema.sql` |
| Expedição | `frontend/database/migration_quantidade_expedicao_venda_itens.sql` |
| OP produção | `frontend/database/migration_producao_op_kanban.sql` |
| Schema produtos | `frontend/database/products_schema.sql` |
| Preços múltiplos | `frontend/database/update_multi_price_tables.sql` |
| Ficha técnica | `frontend/database/produto_imagens_ficha_schema.sql` |
| Schema consolidado | `frontend/database/SUPABASE_FULL_SCHEMA.sql` |
| Kanban UI vendas | `frontend/src/components/VendaKanban.js` |
| Form venda | `frontend/src/components/VendaForm.js` |
| Lista produtos | `frontend/src/components/ProductList.js` |
| Form produtos | `frontend/src/components/ProductForm.js` |

---

## 14. Nomenclatura — equivalências

| Nome comum | Nome real no Azoup |
|------------|-------------------|
| Status do Kanban | `venda.tipo` + `venda.etapa` |
| Variações | `produto_cor_tamanho` |
| Preços | `produto_cor_tamanho_tabela_preco` + `tabela_precos` |
| Tela de produtos | `ProductsView` em `DashboardScreen.js` |
