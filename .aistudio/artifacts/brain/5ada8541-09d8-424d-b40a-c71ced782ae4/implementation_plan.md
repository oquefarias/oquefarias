# Correção da Barra Fixa de Categorias e Arraste Horizontal na Loja

Ajuste na loja pública de delivery para que a barra de busca e categorias acompanhe a rolagem fixa no topo da tela (`sticky top-0`) sem interferência da barra escura antiga, além de permitir arrastar categorias e destaques segurando o clique do mouse no computador (pré-visualização) e usar botões de setas nas laterais.

## User Review & Critical Decisions

> [!IMPORTANT]
> As decisões abaixo foram confirmadas para deixar a navegação idêntica aos aplicativos de delivery tanto no celular quanto no computador (pré-visualização):

- **Topo da Loja Pública**: Remover a barra superior escura antiga na rota pública dos clientes (mantendo-a apenas no `/control-panel` do dono) e trocar `overflow-x-hidden` por `overflow-x-clip` no contêiner principal para que a barra de busca + categorias fique fixa (`sticky top-0 z-30`) perfeitamente durante toda a rolagem da página.
- **Arraste Horizontal e Setas Laterais**: Adicionar suporte a arraste segurando com o mouse (*click-and-drag*) sem disparar clique acidental ao soltar, aliado a botões de setas (`‹` e `›`) nas laterais da barra de categorias e do carrossel de destaques no computador.

---

## 1. Overview & Core Concept

- **What It Does**: Corrige o comportamento `sticky` da barra de busca e categorias ao descer a página e habilita o deslizamento horizontal fluido por toque, arraste de mouse e botões de seta.
- **Target Audience / Persona**: Clientes comprando pelo celular ou computador e o dono testando a loja na pré-visualização.
- **Key Value**: Navegação rápida entre categorias em qualquer ponto da página e facilidade para percorrer todas as categorias e promoções mesmo usando mouse no computador.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. Ao abrir a loja, o cliente vê diretamente o cabeçalho compacto estilo app de delivery (logo, nome, status Aberto/Fechado, tempo estimado, pedido mínimo e bairros atendidos), sem a antiga barra preta duplicada no topo.
  2. Ao rolar a página para baixo, o cabeçalho compacto e o carrossel sobem normalmente, enquanto o bloco de **Busca + Super Geladas + Pílulas de Categorias** trava no topo da janela (`sticky top-0 z-30`) e acompanha toda a descida pelo catálogo.
  3. À medida que o cliente desce pelas seções de produtos, a categoria correspondente é destacada automaticamente na barra fixa e centralizada suavemente.
  4. Para navegar horizontalmente pelas categorias ou pelo carrossel de destaques no computador, o usuário pode tanto **clicar e arrastar para os lados com o mouse** (`cursor-grab` / `cursor-grabbing`) quanto clicar nas **setas laterais (`‹` / `›`)**.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitário de alta conversão (estilo iFood / Yooga), limpo e sem cabeçalhos duplicados.
  - *Color Palette & Mood*: Superfície fixa com `bg-neutral-100/95 backdrop-blur-md`, pílula ativa em `bg-neutral-900 text-amber-400` e botões de seta discretos em `bg-white border-neutral-200 shadow-xs`.
- **Interactive Feedback & Motion**:
  - Ao arrastar com o mouse por mais de `5px`, o cursor muda para `grabbing` e o clique acidental no botão ao soltar o mouse é bloqueado, garantindo que arrastar nunca troque de categoria ou adicione produto sem intenção.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Substituição de `overflow-x-hidden` por `overflow-x-clip` e remoção da barra escura na visão do cliente**
  - *Chosen Approach*: No CSS dos navegadores, qualquer elemento pai com `overflow-x: hidden` cria um contexto de rolagem próprio que impede o funcionamento de `position: sticky` nos elementos filhos em relação à janela. Além disso, a antiga barra escura ocupava o topo com `sticky top-0 z-40`. Remover a barra escura na visão pública e usar `overflow-x-clip` resolve ambos os problemas de uma só vez.
  - *Why*: Elimina a duplicação visual do nome/logo da loja e garante que a barra de busca e categorias fique 100% visível no topo durante toda a rolagem.
- **Decision 2: Arraste por Mouse (Pointer/Mouse Drag) com Prevenção de Clique Acidental + Setas Laterais**
  - *Chosen Approach*: Controladores de arraste (`onMouseDown`, `onMouseMove`, `onMouseUp`, `onMouseLeave`) combinados com uma flag de movimento (`draggedDistance > 5px`) e botões `<` / `>` que deslocam a lista suavemente (`scrollBy({ left: ±220, behavior: 'smooth' })`).
  - *Why*: Funciona imediatamente na pré-visualização com mouse sem prejudicar o toque nativo no celular.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Contêiner Principal da Loja Pública (min-h-screen overflow-x-clip)       │
├─────────────────────────────────────────────────────────────────────────┤
│  ├─ Cabeçalho Compacto da Loja (Logo, Status, Tempo, Mínimo, Endereço)  │
│  ├─ Carrossel de Destaques & Promoções                                  │
│  │    ├── Botão Seta Esquerda (‹)                                       │
│  │    ├── Trilha Horizontal com Mouse Drag-to-Scroll + Touch Scroll     │
│  │    └── Botão Seta Direita (›)                                        │
│  ├─ Barra Fixa no Topo (sticky top-0 z-30)                              │
│  │    ├── Busca Rápida + Filtro "❄️ Super Geladas"                      │
│  │    └── Barra de Categorias                                           │
│  │          ├── Botão Seta Esquerda (‹)                                 │
│  │          ├── Pílulas de Categorias (Mouse Drag + Auto-Highlight)     │
│  │          └── Botão Seta Direita (›)                                  │
│  └─ Catálogo Contínuo por Categoria (#cat-section-*)                    │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Interactive Component & State Mapping**:
  - **Mouse Drag-to-Scroll**: Ao pressionar o botão do mouse sobre a barra de categorias ou carrossel, armazena `startX` e `scrollLeft`. Durante o movimento, atualiza `container.scrollLeft` proporcionalmente ao deslocamento e marca `hasDraggedRef.current = true` quando o movimento passa de `5px`, ignorando o evento `onClick` subsequente para evitar seleção acidental ao terminar de arrastar.
  - **Setas Laterais (`‹` / `›`)**: Botões posicionados nas extremidades da barra de categorias e no cabeçalho do carrossel que executam `scrollBy({ left: direction * 240, behavior: 'smooth' })`.
  - **Sincronização na Rolagem Vertical**: O `IntersectionObserver` e o `scroll-mt-28` ajustados para a altura exata da barra `sticky top-0`, mantendo a pílula ativa sincronizada ao subir e descer a página.
