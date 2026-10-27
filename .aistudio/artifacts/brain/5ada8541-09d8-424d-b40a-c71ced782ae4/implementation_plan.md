# Venda e Controle de Estoque por Caixa Fechada (Engradado)

Habilita a venda e movimentação de estoque por **Caixa Fechada (engradado)** além da unidade avulsa em todos os canais de venda (Loja Online, Balcão PDV e Mesas/Comandas), mantendo a contagem de estoque unificada em unidades no servidor.

## User Review & Critical Decisions

> [!IMPORTANT]
> As decisões abaixo foram confirmadas e orientam o comportamento do servidor e das telas do painel e da loja:

- **Ajuste e Entrada de Estoque no Painel**: Na aba Estoque, cada produto contará tanto com botões rápidos na própria linha (alternando entre Unidades e Caixas quando o produto tiver caixa configurada) quanto com a opção de digitar uma quantidade livre em Unidades ou Caixas, enviando a escolha ao servidor para conversão (`quantidade × case_size`).
- **Devolução de Estoque na Exclusão de Pedido**: Ao excluir um pedido (`DELETE /api/orders/:id`) que ainda não esteja com o status `cancelado`, o servidor devolverá automaticamente o estoque correspondente (`quantity × unitsPerSale`) via `restore_stock` antes de remover o registro.
- **Cálculo e Validação Exclusivos no Servidor**: O navegador envia apenas `productId`, `quantity` e `saleUnit` (`'unit'` | `'case'`). O servidor valida se o produto aceita venda em caixa, aplica `case_price` (ou o preço efetivo unitário na venda avulsa, já que promoções valem apenas para a unidade) e verifica a disponibilidade somando todas as unidades exigidas pelo mesmo produto no pedido.

---

## 1. Overview & Core Concept

- **What It Does**: Permite configurar quais produtos possuem venda em caixa fechada (`caseSize` de 2 a 100 unidades e `casePrice` próprio), exibir a equivalência do estoque em caixas e unidades avulsas (`490 un (40 cx + 10 avulsas)`), dar entrada/baixa em caixas ou unidades, e vender caixas fechadas ou unidades avulsas na Loja Online, no Balcão (PDV) e nas Comandas de Mesa.
- **Target Audience / Persona**: Gestores e atendentes do depósito de bebidas (controle de estoque, PDV de balcão e atendimento de mesas) e clientes finais comprando pelo catálogo online.
- **Key Value**: Elimina a criação de cadastros duplicados para o mesmo produto (lata avulsa vs. fardo/engradado), mantendo um único saldo real em unidades no banco de dados com precificação diferenciada para a caixa fechada.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Cadastro de Produto**: Ao ativar a chave *"Vende caixa fechada?"*, o formulário exibe os campos obrigatórios *"Unidades por caixa"* (2 a 100) e *"Preço da caixa"*, calculando em tempo real o valor unitário dentro da caixa e a economia por unidade e total em relação à unidade avulsa.
  2. **Gestão de Estoque**: Na listagem de estoque, produtos com caixa exibem o saldo detalhado (`490 un (40 cx + 10 avulsas)`). O operador pode alternar entre **Unidades** e **Caixas** para usar os botões rápidos ou informar uma quantidade específica para entrada/saída.
  3. **Vitrine Online e Carrinho**: Nos cards de produtos que vendem caixa, um seletor segmentado permite alternar entre `Unidade` e `Caixa c/N`, exibindo os respectivos preços (promoções aplicam-se somente à unidade; caso o estoque seja inferior a `caseSize`, a opção de caixa fica desabilitada com o aviso *"sem caixa fechada no estoque"*). No carrinho, a unidade avulsa e a caixa fechada do mesmo produto entram como linhas independentes (`Heineken 600 — Caixa c/12`).
  4. **Balcão (PDV) e Comandas de Mesa**: Tanto no lançamento de itens da comanda quanto no PDV do painel, o operador escolhe `Unidade | Caixa c/N` antes de adicionar. Na comanda aberta, itens em caixa exibem `2 cx Heineken 600 (24 un)`.
  5. **Comprovantes, Pedidos e WhatsApp**: Na lista de pedidos do painel, nos cupons impressos (mesa e delivery/balcão) e na mensagem de confirmação do WhatsApp, itens vendidos em caixa são formatados como `2 cx Heineken 600 (c/12)`.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitário comercial de alta legibilidade, preservando a identidade visual do depósito (superfícies claras em `neutral-50`/`white`, cabeçalhos em `neutral-900` e destaques acionáveis em `amber-500`).
  - *Typography & Hierarchy*: Números de estoque, preços por caixa/unidade e subtotais alinhados com `font-mono tabular-nums` para leitura imediata em tabelas e comprovantes.
  - *Component Styling & Layout*: Seletores `Unidade | Caixa c/N` construídos como controles segmentados compactos de linha única (`whitespace-nowrap`), mantendo a altura uniforme dos cards na vitrine e nos modais operacionais.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unificação de Estoque em Unidades com Conversão Server-Side**
  - *Chosen Approach*: Todo saldo em `products.stock` permanece em unidades individuais, e toda operação de baixa, estorno ou ajuste converte caixas em unidades (`quantity × unitsPerSale` ou `delta × case_size`) exclusivamente no servidor.
  - *Why*: Garante integridade transacional no Supabase quando o mesmo produto é vendido simultaneamente em unidades avulsas e caixas fechadas em canais diferentes.
  - *Alternatives Considered*: Manter estoques separados para caixas e unidades exigiria "desmembrar" caixas manualmente a cada venda avulsa.

- **Decision 2: Linhas Independentes por Modalidade de Venda no Carrinho e nos Pedidos**
  - *Chosen Approach*: Identificar itens no carrinho da loja e do PDV pela combinação `(productId, saleUnit)`, mantendo linhas separadas para unidade e caixa do mesmo produto, porém consolidando a necessidade total de unidades por `productId` ao validar o limite de estoque.
  - *Why*: Permite que o mesmo cliente compre, por exemplo, 1 caixa fechada + 4 unidades avulsas no mesmo pedido com clareza nos preços e sem permitir que a soma ultrapasse o estoque total disponível.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌────────────────────────────────────────────────────────────────────────────┐
│                         CANAIS DE VENDA & GESTÃO                            │
├──────────────────────┬───────────────────────────┬─────────────────────────┤
│     Loja Online      │     Painel Admin / PDV    │    Módulo de Mesas      │
│  ┌────────────────┐  │  ┌─────────────────────┐  │  ┌───────────────────┐  │
│  │ Seletor Card   │  │  │ Modal Produto       │  │  │ Lançar Item Mesa  │  │
│  │ Unidade|Caixa  │  │  │ (caseSize/casePrice)│  │  │ Unidade | Caixa   │  │
│  └───────┬────────┘  │  └──────────┬──────────┘  │  └─────────┬─────────┘  │
│          ▼           │             ▼             │            ▼            │
│  ┌────────────────┐  │  ┌─────────────────────┐  │  ┌───────────────────┐  │
│  │ Carrinho Duplo │  │  │ Estoque: Un / Cx    │  │  │ Comanda & Cupom   │  │
│  │ (id + saleUnit)│  │  │ + Balcão PDV        │  │  │ "2 cx Nome (24un)"│  │
│  └───────┬────────┘  │  └──────────┬──────────┘  │  └─────────┬─────────┘  │
└──────────┼───────────┴─────────────┼─────────────┴────────────┼────────────┘
           │                         │                          │
           └─────────────────────────┼──────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                     SERVIDOR EXPRESS (API & REGRAS)                        │
├────────────────────────────────────────────────────────────────────────────┤
│  • POST/PUT /products        -> Valida case_size (2..100) e case_price > 0 │
│  • POST /products/:id/stock  -> Se unit='case', multiplica delta×case_size │
│  • POST /orders              -> Valida saleUnit, soma unidades por produto,│
│                                 aplica case_price e baixa qty×unitsPerSale │
│  • PATCH /orders/:id/status  -> Cancelar/Reativar usa qty×unitsPerSale     │
│  • DELETE /orders/:id        -> Se status != cancelado, devolve estoque    │
│  • POST /admin/tabs/:id/items-> Passa p_sale_unit e p_units_per_sale à RPC │
│  • POST /admin/tabs/:id/close-> Gera OrderItem com saleUnit e unitsPerSale │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         SUPABASE POSTGRESQL & RPCs                         │
│  • products (case_size, case_price)                                        │
│  • table_tab_items (sale_unit, units_per_sale)                             │
│  • RPCs: add_table_tab_item, cancel_table_tab_item, cancel_table_tab,      │
│          decrement_stock, restore_stock, finish_table_tab_close            │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `Product`: adiciona `caseSize?: number | null` e `casePrice?: number | null` (mapeados de/para `case_size` e `case_price` no banco e incluídos tanto no estado público quanto no estado admin).
  - `OrderItem`: adiciona `saleUnit?: 'unit' | 'case'` (padrão `'unit'`) e `unitsPerSale?: number` (padrão `1`).
  - `TableTabItem`: adiciona `saleUnit: 'unit' | 'case'` e `unitsPerSale: number`.

- **Interactive Component & State Mapping**:
  - **Validação de Estoque Combinado (Loja, PDV e Servidor)**: Quando um carrinho ou pedido contém tanto unidades quanto caixas do mesmo `productId`, o total de unidades exigidas (`sum(quantity × unitsPerSale)`) é validado contra `product.stock`, impedindo adicionar mais itens na interface ou aprovar o pedido no servidor caso ultrapasse o saldo total.
  - **Pontos de Baixa e Devolução de Estoque no Servidor**:
    1. `POST /api/products/:id/stock`: aceita `{ delta, unit: 'unit' | 'case' }`, valida se o produto possui `case_size` quando `unit === 'case'`, converte para unidades (`delta × case_size`) e chama `restore_stock` ou `decrement_stock`.
    2. `POST /api/orders`: agrupa por `productId` para validar o estoque total em unidades e monta o payload de `decrement_stock` (e o rollback em `restore_stock` caso falhe cupom/inserção) com `qty = quantity × unitsPerSale`.
    3. `PATCH /api/orders/:id/status`: ao transicionar para `cancelado` (ou sair de `cancelado`), calcula `qty = item.quantity × (item.unitsPerSale || 1)` para cada item antes de chamar `restore_stock` ou `decrement_stock`.
    4. `DELETE /api/orders/:id`: busca o pedido antes de excluir; se o status atual for diferente de `'cancelado'`, executa `restore_stock` com `qty = item.quantity × (item.unitsPerSale || 1)`.
    5. `POST /api/coupons/validate`: ao recalcular o subtotal dos itens no servidor para validação de pedido mínimo do cupom, considera `saleUnit === 'case'` usando `casePrice` e `getEffectivePrice` para `'unit'`.
    6. `POST /api/admin/tabs/:id/items`: valida `sale_unit`, define `unitPrice = casePrice` e `unitsPerSale = caseSize` quando `'case'`, chama `add_table_tab_item` com `p_sale_unit` e `p_units_per_sale`, e traduz o erro `'UNIDADE_INVALIDA'` para *"Este produto não é vendido em caixa fechada."*
