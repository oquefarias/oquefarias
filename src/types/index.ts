export type ProductCategory = 
  | 'cervejas'
  | 'destilados'
  | 'vinhos'
  | 'nao_alcoolicos'
  | 'gelo_carvao'
  | 'petiscos'
  | (string & {});

export type SaleUnit = 'unit' | 'case';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  volume: string;
  price: number;
  promoPrice?: number | null;
  promoEndsAt?: string | null;
  caseSize?: number | null;
  casePrice?: number | null;
  costPrice: number;
  stock: number;
  minStock: number;
  isCold: boolean;
  image: string;
  imageUrl?: string;
  sku: string;
  active: boolean;
  description: string;
  updatedAt?: string;
}

export interface AdminChangesResponse {
  ordersChanged: boolean;
  productsChanged: boolean;
  tabsChanged: boolean;
  cashSessionChanged?: boolean;
  serverTime: string;
}

export function hasProductStockCase(product?: Pick<Product, 'caseSize'> | null): boolean {
  if (!product) return false;
  const size = Number(product.caseSize) || 0;
  return Number.isInteger(size) && size >= 2 && size <= 100;
}

export function hasProductCase(product?: Pick<Product, 'caseSize' | 'casePrice'> | null): boolean {
  if (!product) return false;
  const price = Number(product.casePrice) || 0;
  return hasProductStockCase(product) && price > 0;
}

export function canSellProductCase(
  product?: Pick<Product, 'id' | 'caseSize' | 'casePrice'> | null,
  settings?: Pick<StoreSettings, 'caseSaleChannels'> | null,
  channel: 'store' | 'local' = 'store'
): boolean {
  if (!product || !hasProductCase(product)) return false;
  const cfg = settings?.caseSaleChannels?.[product.id];
  if (!cfg || typeof cfg !== 'object') return true;
  return channel === 'store' ? cfg.store !== false : cfg.local !== false;
}

export function formatStockWithCases(stock: number, caseSize?: number | null): string {
  const s = Math.max(0, Math.floor(Number(stock) || 0));
  const size = Number(caseSize) || 0;
  if (size >= 2) {
    const cases = Math.floor(s / size);
    const loose = s % size;
    return `${s} un (${cases} cx + ${loose} ${loose === 1 ? 'avulsa' : 'avulsas'})`;
  }
  return `${s} un`;
}

export function isProductPromoActive(product: Pick<Product, 'price' | 'promoPrice' | 'promoEndsAt'>): boolean {
  const normalPrice = Number(product.price) || 0;
  const promoPrice = product.promoPrice !== null && product.promoPrice !== undefined ? Number(product.promoPrice) : 0;
  if (!(promoPrice > 0 && promoPrice < normalPrice)) {
    return false;
  }
  if (product.promoEndsAt) {
    const endsAtMs = new Date(product.promoEndsAt).getTime();
    if (!Number.isNaN(endsAtMs) && endsAtMs <= Date.now()) {
      return false;
    }
  }
  return true;
}

export function getEffectiveProductPrice(product: Pick<Product, 'price' | 'promoPrice' | 'promoEndsAt'>): number {
  return isProductPromoActive(product) ? Number(product.promoPrice) : Number(product.price);
}

export function getPromoDiscountPercent(product: Pick<Product, 'price' | 'promoPrice'>): number {
  const normalPrice = Number(product.price) || 0;
  const promoPrice = Number(product.promoPrice) || 0;
  if (normalPrice <= 0 || promoPrice <= 0 || promoPrice >= normalPrice) return 0;
  return Math.round(((normalPrice - promoPrice) / normalPrice) * 100);
}

export type OrderStatus = 
  | 'pendente'
  | 'em_separacao'
  | 'em_rota'
  | 'concluido'
  | 'cancelado';

export type PaymentMethod = 
  | 'pix' 
  | 'cartao_credito' 
  | 'cartao_debito' 
  | 'dinheiro';

export interface AddonOption {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

export interface AddonGroup {
  id: string;
  name: string;
  active?: boolean;
  min: number;
  max: number;
  options: AddonOption[];
  categoryIds: string[];
  productIds: string[];
}

export interface OrderItemAddon {
  groupId?: string;
  optionId?: string;
  groupName: string;
  optionName: string;
  price: number;
  quantity: number;
}

export interface ComboComponentItem {
  productId: string;
  quantity: number;
}

export interface OrderItemComboComponent {
  productId: string;
  name: string;
  quantity: number;
}

export interface OrderItem {
  productId: string;
  name: string;
  volume: string;
  price: number;
  originalPrice?: number;
  costPrice?: number;
  quantity: number;
  saleUnit?: SaleUnit;
  unitsPerSale?: number;
  isCold?: boolean;
  addons?: OrderItemAddon[];
  addonsTotal?: number;
  comboItems?: OrderItemComboComponent[];
}

export type GeoPrecision = 'exata' | 'rua' | 'aproximada';

export interface CustomerInfo {
  name: string;
  phone: string;
  email?: string;
  address: string;
  number: string;
  neighborhood: string;
  complement?: string;
  reference?: string;
  cep?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
  geoLatitude?: number | null;
  geoLongitude?: number | null;
  geoPrecision?: GeoPrecision | null;
  pinOffsetM?: number | null;
  locationVerified?: boolean;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  geo_precision?: GeoPrecision | null;
  pin_offset_m?: number | null;
  location_verified?: boolean;
  distanceKm?: number;
  isWithinDeliveryRadius?: boolean;
  deliveryAreaId?: string;
}

export interface CustomerProfile extends CustomerInfo {
  id: string;
  email?: string;
  createdAt: string;
  totalOrdersCount?: number;
  totalSpent?: number;
  lastOrderAt?: string;
}

export interface DeliveryArea {
  id: string;
  name: string;
  fee: number;
  estimatedTime: string;
  active: boolean;
}

export interface Coupon {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  minOrder?: number;
  maxDiscount?: number | null;
  active: boolean;
  expiresAt?: string | null;
  maxUses?: number | null;
  usedCount: number;
}

export interface OrderDeliveryAddressPayload {
  cep?: string;
  address: string;
  number: string;
  neighborhood: string;
  deliveryAreaId?: string;
  complement?: string;
  reference?: string;
  city?: string;
  state?: string;
  latitude?: number;
  longitude?: number;
}

export interface GuestOrderPayload extends OrderDeliveryAddressPayload {
  name: string;
  phone: string;
}

export interface Order {
  id: string;
  createdAt: string;
  source: 'online' | 'balcao' | 'mesa';
  customer: CustomerInfo;
  customerId?: string;
  clientRequestId?: string;
  couponCode?: string;
  discount?: number;
  deliveryType: 'delivery' | 'retirada' | 'local';
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  paymentMethod: PaymentMethod;
  cashChangeFor?: number;
  status: OrderStatus;
  notes?: string;
  updatedAt: string;
  guestToken?: string;
  trackingUrl?: string;
  deliveryAreaId?: string;
  deliveryAddress?: OrderDeliveryAddressPayload;
  guest?: GuestOrderPayload;
}

export interface GuestTrackedStoreInfo {
  storeName: string;
  phone: string;
  whatsapp: string;
  address: string;
  openingHours: string;
  estimatedDeliveryTime: string;
  pixKey: string;
  pixReceiver: string;
}

export interface GuestTrackedOrderResponse {
  order: Order;
  store: GuestTrackedStoreInfo;
}

export interface SavedGuestOrderLink {
  id: string;
  token: string;
  trackingUrl: string;
  createdAt: string;
  total: number;
  status: OrderStatus;
  deliveryType: 'delivery' | 'retirada' | 'local';
  itemsSummary: string;
}

export interface DiningTable {
  id: string;
  number: number;
  label?: string | null;
  seats?: number | null;
  active: boolean;
  createdAt?: string;
}

export type TabStatus = 'open' | 'closing' | 'closed' | 'merged' | 'cancelled';

export interface TableTab {
  id: string;
  tableId: string;
  status: TabStatus;
  customerName?: string | null;
  peopleCount?: number | null;
  notes?: string | null;
  mergedInto?: string | null;
  orderId?: string | null;
  openedAt: string;
  closedAt?: string | null;
  updatedAt: string;
}

export interface TableTabItem {
  id: string;
  tabId: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  saleUnit?: SaleUnit;
  unitsPerSale?: number;
  comboItems?: OrderItemComboComponent[];
  notes?: string | null;
  status: 'active' | 'cancelled';
  addedAt: string;
  cancelledAt?: string | null;
}

export interface LinkedTable {
  id: string;
  number: number;
  label?: string | null;
}

export interface TableWithTab extends DiningTable {
  currentTab?: (TableTab & {
    itemsCount: number;
    itemsSummary?: string;
    subtotal: number;
  }) | null;
  linkedTables?: LinkedTable[];
  joinedToTabId?: string;
  joinedToTableNumber?: number;
}

export interface TabDetail extends TableTab {
  tableNumber: number;
  tableLabel?: string | null;
  items: TableTabItem[];
  subtotal: number;
  linkedTables?: LinkedTable[];
}

export type ShortcutAction =
  | 'pdv'
  | 'mesas'
  | 'pedidos'
  | 'estoque'
  | 'finalizar'
  | 'busca'
  | 'fecharModal'
  | 'newProduct'
  | 'saveProduct'
  | 'saveAndNewProduct';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  pdv: 'F2',
  mesas: 'F3',
  pedidos: 'F4',
  estoque: 'F8',
  finalizar: 'F9',
  busca: '/',
  fecharModal: 'Escape',
  newProduct: 'F6',
  saveProduct: 'Ctrl+S',
  saveAndNewProduct: 'Ctrl+Enter',
};

export interface StoreCategoryItem {
  id: string;
  name: string;
}

export type ProductSortMode = 'manual' | 'az' | 'price_asc' | 'price_desc';

export interface StoreSettings {
  storeName: string;
  logoUrl?: string; // Foto de perfil / Logotipo da loja
  bannerUrl?: string; // Foto de capa opcional da loja
  cnpjOrCpf: string;
  phone: string;
  whatsapp: string;
  address: string;
  pixKey: string;
  pixKeyType: 'cnpj' | 'cpf' | 'telefone' | 'email' | 'aleatoria';
  pixReceiver: string;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  minOrderValue: number;
  isOpen: boolean; // Controle Online / Fechado em tempo real
  closedMessage?: string; // Mensagem exibida quando a loja está offline/fechada
  estimatedDeliveryTime: string;
  openingHours: string; // Horário de expediente configurável
  soundEnabled: boolean;
  deliveryRadiusKm?: number; // Raio máximo de entrega em quilômetros (ex: 5)
  storeLatitude?: number; // Coordenada Latitude da loja
  storeLongitude?: number; // Coordenada Longitude da loja
  deliveryModel?: 'radius' | 'neighborhoods' | 'both'; // Modo de validação de entrega
  pricePerKm?: number; // Taxa adicional por km (opcional)
  showOutOfStock?: boolean; // Mostrar produtos esgotados na loja (padrão false)
  featuredProductIds?: string[]; // Lista ordenada de IDs de produtos de preferência (máx 50)
  categories?: StoreCategoryItem[]; // Lista ordenada de categorias { id, name } (máx 50)
  productSortMode?: ProductSortMode; // 'manual' | 'az' | 'price_asc' | 'price_desc'
  productOrder?: Record<string, string[]>; // Ordem manual dos produtos por categoria
  shortcuts?: Record<string, string>; // Atalhos do teclado customizados no painel
  addonGroups?: AddonGroup[]; // Grupos de adicionais na escolha do produto (máx 30)
  combos?: Record<string, ComboComponentItem[]>; // Composição dos combos: { idDoProdutoCombo: [{ productId, quantity }] } (máx 100)
  hiddenFromStoreIds?: string[]; // Produtos ocultos apenas da loja online / delivery (máx 2000)
  caseSaleChannels?: Record<string, { store: boolean; local: boolean }>; // Canais onde a caixa fechada está liberada por produto
  assistantEnabled?: boolean; // Habilitar assistente com IA no painel do dono
  showFeaturedCarousel?: boolean; // Exibir carrossel de destaques na loja
}

export type StockAdjustMode = 'delta' | 'set';
export type StockAdjustReason = 'ajuste' | 'entrada' | 'perda' | 'contagem';
export type StockMovementReason =
  | 'venda'
  | 'mesa'
  | 'cancelamento'
  | 'mesa_cancelamento'
  | 'reativacao'
  | 'estorno_erro'
  | 'ajuste'
  | 'entrada'
  | 'perda'
  | 'contagem'
  | 'importacao'
  | (string & {});

export interface StockMovement {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  delta: number;
  stockAfter: number;
  reason: StockMovementReason;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  tableNumber?: number | null;
}

export interface StockMovementsSummary {
  totalIn: number;
  totalOut: number;
  balance: number;
}

export interface StockMovementsResponse {
  items: StockMovement[];
  summary: StockMovementsSummary;
  hasMore: boolean;
  nextBefore: string | null;
}

export function formatStockMovementReason(reason?: string | null): string {
  switch (String(reason || '').toLowerCase()) {
    case 'venda':
      return 'Venda delivery/balcão';
    case 'mesa':
      return 'Mesa';
    case 'cancelamento':
      return 'Cancelamento de pedido';
    case 'mesa_cancelamento':
      return 'Cancelamento na mesa';
    case 'reativacao':
      return 'Reativação de pedido';
    case 'estorno_erro':
      return 'Estorno automático';
    case 'ajuste':
      return 'Ajuste manual';
    case 'entrada':
      return 'Entrada de mercadoria';
    case 'perda':
      return 'Perda / quebra';
    case 'contagem':
      return 'Contagem de estoque';
    case 'importacao':
      return 'Importação de planilha';
    default:
      return reason || 'Ajuste';
  }
}

export function isProductHiddenFromStore(
  productOrId?: Pick<Product, 'id'> | string | null,
  settings?: StoreSettings | null
): boolean {
  if (!productOrId || !Array.isArray(settings?.hiddenFromStoreIds) || settings!.hiddenFromStoreIds.length === 0) {
    return false;
  }
  const id = typeof productOrId === 'string' ? productOrId.trim() : String(productOrId.id || '').trim();
  if (!id) return false;
  return settings!.hiddenFromStoreIds.includes(id);
}

export function isComboProduct(
  productOrId?: Pick<Product, 'id'> | string | null,
  settings?: StoreSettings | null
): boolean {
  if (!productOrId || !settings?.combos) return false;
  const id = typeof productOrId === 'string' ? productOrId.trim() : String(productOrId.id || '').trim();
  if (!id) return false;
  const items = settings.combos[id];
  return Array.isArray(items) && items.length > 0;
}

export function getComboComponentItems(
  productOrId?: Pick<Product, 'id'> | string | null,
  settings?: StoreSettings | null
): ComboComponentItem[] {
  if (!productOrId || !settings?.combos) return [];
  const id = typeof productOrId === 'string' ? productOrId.trim() : String(productOrId.id || '').trim();
  if (!id) return [];
  const items = settings.combos[id];
  return Array.isArray(items) ? items : [];
}

export function formatComboComponentProductName(product: Pick<Product, 'name' | 'volume'>): string {
  const name = String(product.name || '').trim();
  const vol = String(product.volume || '').trim();
  if (!vol || name.toLowerCase().includes(vol.toLowerCase())) {
    return name;
  }
  return `${name} ${vol}`.trim();
}

export function formatComboComponentLabel(product: Pick<Product, 'name' | 'volume'>, quantity: number): string {
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  return `${qty} ${formatComboComponentProductName(product)}`;
}

export function formatOrderItemComboLine(ci: OrderItemComboComponent): string {
  const qty = Math.max(1, Math.floor(Number(ci.quantity) || 1));
  return `↳ ${qty}× ${String(ci.name || '').trim()}`;
}

export interface ComboCalculatedMetrics {
  isCombo: boolean;
  availableStock: number;
  separatePrice: number;
  discount: number;
  costPrice: number;
  marginPercent: number;
  itemsSummaryText: string;
  orderComboItems: OrderItemComboComponent[];
  resolvedItems: Array<{
    productId: string;
    quantity: number;
    product?: Product;
    displayName: string;
  }>;
}

export function calculateComboMetrics(
  comboProduct: Pick<Product, 'id' | 'price' | 'promoPrice' | 'promoEndsAt'>,
  settings?: StoreSettings | null,
  allProducts?: Product[]
): ComboCalculatedMetrics {
  const comboId = String(comboProduct?.id || '').trim();
  const rawItems = getComboComponentItems(comboId, settings);
  if (rawItems.length === 0) {
    return {
      isCombo: false,
      availableStock: 0,
      separatePrice: 0,
      discount: 0,
      costPrice: 0,
      marginPercent: 0,
      itemsSummaryText: '',
      orderComboItems: [],
      resolvedItems: [],
    };
  }

  const productMap = new Map<string, Product>();
  if (Array.isArray(allProducts)) {
    for (const p of allProducts) {
      if (p && p.id) productMap.set(String(p.id), p);
    }
  }

  let minStock = Infinity;
  let separatePrice = 0;
  let costPrice = 0;
  const resolvedItems: ComboCalculatedMetrics['resolvedItems'] = [];

  for (const item of rawItems) {
    const pid = String(item?.productId || '').trim();
    const qty = Math.floor(Number(item?.quantity) || 0);
    if (!pid || qty < 1 || pid === comboId || isComboProduct(pid, settings)) {
      minStock = 0;
      continue;
    }
    const comp = productMap.get(pid);
    if (!comp || comp.active === false) {
      minStock = 0;
      resolvedItems.push({
        productId: pid,
        quantity: qty,
        product: comp,
        displayName: comp ? formatComboComponentProductName(comp) : 'Produto indisponível',
      });
      continue;
    }

    const compStock = Math.max(0, Math.floor(Number(comp.stock) || 0));
    const availForComp = Math.floor(compStock / qty);
    if (availForComp < minStock) {
      minStock = availForComp;
    }

    const compEffectivePrice = getEffectiveProductPrice(comp);
    separatePrice += compEffectivePrice * qty;
    costPrice += (Number(comp.costPrice) || 0) * qty;

    resolvedItems.push({
      productId: pid,
      quantity: qty,
      product: comp,
      displayName: formatComboComponentProductName(comp),
    });
  }

  if (!Number.isFinite(minStock) || minStock < 0) {
    minStock = 0;
  }

  separatePrice = Math.round(separatePrice * 100) / 100;
  costPrice = Math.round(costPrice * 100) / 100;
  const comboEffectivePrice = getEffectiveProductPrice(comboProduct);
  const discount = Math.max(0, Math.round((separatePrice - comboEffectivePrice) * 100) / 100);
  const marginPercent =
    comboEffectivePrice > 0
      ? Math.round(((comboEffectivePrice - costPrice) / comboEffectivePrice) * 1000) / 10
      : 0;

  const itemsSummaryText = resolvedItems
    .map((ri) => `${ri.quantity} ${ri.displayName}`)
    .join(' • ');

  const orderComboItems: OrderItemComboComponent[] = resolvedItems.map((ri) => ({
    productId: ri.productId,
    name: ri.displayName,
    quantity: ri.quantity,
  }));

  return {
    isCombo: true,
    availableStock: minStock,
    separatePrice,
    discount,
    costPrice,
    marginPercent,
    itemsSummaryText,
    orderComboItems,
    resolvedItems,
  };
}

export function getProductAddonGroups(
  product?: Pick<Product, 'id' | 'category'> | null,
  settings?: StoreSettings | null
): AddonGroup[] {
  if (!product || !Array.isArray(settings?.addonGroups) || settings!.addonGroups.length === 0) {
    return [];
  }
  const prodId = String(product.id || '').trim();
  const prodCat = String(product.category || '').trim();

  return settings!.addonGroups.filter((group) => {
    if (!group || group.active === false) return false;
    const activeOptions = Array.isArray(group.options)
      ? group.options.filter((opt) => opt && opt.active !== false && String(opt.name || '').trim().length > 0)
      : [];
    if (activeOptions.length === 0) return false;

    const matchesCategory =
      Boolean(prodCat) &&
      Array.isArray(group.categoryIds) &&
      group.categoryIds.some((cid) => String(cid || '').trim() === prodCat);
    const matchesProduct =
      Boolean(prodId) &&
      Array.isArray(group.productIds) &&
      group.productIds.some((pid) => String(pid || '').trim() === prodId);

    return matchesCategory || matchesProduct;
  });
}

export function buildOrderItemAddonsSignature(addons?: OrderItemAddon[] | null): string {
  if (!Array.isArray(addons) || addons.length === 0) return '';
  return addons
    .filter((a) => a && Number(a.quantity) > 0)
    .map((a) => {
      const gKey = String(a.groupId || a.groupName || '').trim();
      const oKey = String(a.optionId || a.optionName || '').trim();
      const qty = Math.max(1, Math.floor(Number(a.quantity) || 1));
      const price = Math.round((Number(a.price) || 0) * 100);
      return `${gKey}:${oKey}:${qty}:${price}`;
    })
    .sort()
    .join('|');
}

export function formatOrderItemAddonLine(addon: OrderItemAddon): string {
  const qty = Math.max(1, Math.floor(Number(addon.quantity) || 1));
  const unitPrice = Number(addon.price) || 0;
  const lineTotal = Math.round(unitPrice * qty * 100) / 100;
  const prefix = qty > 1 ? `+ ${qty}x ${addon.optionName}` : `+ ${addon.optionName}`;
  if (lineTotal > 0) {
    return `${prefix} R$ ${lineTotal.toFixed(2).replace('.', ',')}`;
  }
  return `${prefix} (grátis)`;
}

export const PRIORITY_CATEGORY_IDS = [
  'cervejas',
  'destilados',
  'vinhos',
  'nao_alcoolicos',
  'gelo_carvao',
  'petiscos',
] as const;

export function slugifyCategoryId(raw: string): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function formatCategoryLabel(category: string): string {
  switch (category) {
    case 'combos':
      return 'Combos';
    case 'cervejas':
      return 'Cervejas';
    case 'destilados':
      return 'Destilados';
    case 'nao_alcoolicos':
      return 'Não Alcoólicos';
    case 'vinhos':
      return 'Vinhos';
    case 'gelo_carvao':
      return 'Gelo & Carvão';
    case 'petiscos':
      return 'Petiscos';
    case 'outros':
      return 'Outros';
    default:
      return category;
  }
}

export function buildInitialCategoriesFromProducts(
  products?: Array<Pick<Product, 'category'>>
): StoreCategoryItem[] {
  const existingIds = new Set<string>();
  if (Array.isArray(products)) {
    for (const p of products) {
      const cat = typeof p?.category === 'string' ? p.category.trim() : '';
      if (cat) existingIds.add(cat);
    }
  }

  // Fallback to default priority categories if no products exist yet
  if (existingIds.size === 0) {
    return PRIORITY_CATEGORY_IDS.map((id) => ({
      id,
      name: formatCategoryLabel(id),
    }));
  }

  const orderedIds: string[] = [];
  const prioritySet = new Set<string>(PRIORITY_CATEGORY_IDS);

  for (const pid of PRIORITY_CATEGORY_IDS) {
    if (existingIds.has(pid)) {
      orderedIds.push(pid);
    }
  }

  const others = Array.from(existingIds)
    .filter((id) => !prioritySet.has(id))
    .sort((a, b) => formatCategoryLabel(a).localeCompare(formatCategoryLabel(b), 'pt-BR', { sensitivity: 'base' }));

  orderedIds.push(...others);

  return orderedIds.slice(0, 50).map((id) => ({
    id,
    name: formatCategoryLabel(id).slice(0, 40),
  }));
}

export function reconcileStoreCategoriesWithProducts(
  categories: StoreCategoryItem[],
  products?: Array<Pick<Product, 'category'>>
): StoreCategoryItem[] {
  if (!Array.isArray(categories) || categories.length === 0) {
    return buildInitialCategoriesFromProducts(products);
  }
  if (!Array.isArray(products) || products.length === 0) {
    return categories;
  }

  const productCategories = new Set<string>();
  for (const p of products) {
    const cat = typeof p?.category === 'string' ? p.category.trim() : '';
    if (cat) productCategories.add(cat);
  }

  if (productCategories.size === 0) return categories;

  const explicitIds = new Set(categories.map((c) => String(c.id || '').trim()));
  const result: StoreCategoryItem[] = [];
  const seenResultIds = new Set<string>();

  for (const c of categories) {
    let exactId = String(c.id || '').trim();
    if (!exactId) continue;

    // If c.id was previously slugified (e.g. "cigarro") while products have "Cigarro", restore exact ID
    if (!productCategories.has(exactId)) {
      const cSlug = slugifyCategoryId(exactId);
      for (const prodCat of productCategories) {
        if (
          !explicitIds.has(prodCat) &&
          !seenResultIds.has(prodCat) &&
          (prodCat.toLowerCase() === exactId.toLowerCase() || slugifyCategoryId(prodCat) === cSlug)
        ) {
          exactId = prodCat;
          break;
        }
      }
    }

    if (!seenResultIds.has(exactId)) {
      seenResultIds.add(exactId);
      result.push({
        id: exactId,
        name: String(c.name || formatCategoryLabel(exactId)).trim().slice(0, 40),
      });
    }
  }

  return result;
}

export function resolveStoreCategories(
  settings?: StoreSettings | null,
  products?: Array<Pick<Product, 'category'>>
): StoreCategoryItem[] {
  if (Array.isArray(settings?.categories) && settings!.categories.length > 0) {
    return reconcileStoreCategoriesWithProducts(settings!.categories, products);
  }
  return buildInitialCategoriesFromProducts(products);
}

export function getCategoryDisplayName(
  categoryId: string,
  settings?: StoreSettings | null,
  products?: Array<Pick<Product, 'category'>>
): string {
  const trimmed = String(categoryId || '').trim();
  if (!trimmed || trimmed === 'outros') return 'Outros';
  const cats = resolveStoreCategories(settings, products);
  const found = cats.find((c) => c.id === trimmed);
  if (found && found.name) return found.name;
  return formatCategoryLabel(trimmed);
}

export function sortProductsByPreference(
  list: Product[],
  featuredProductIds?: string[]
): Product[] {
  if (!Array.isArray(featuredProductIds) || featuredProductIds.length === 0 || list.length <= 1) {
    return list;
  }
  const rankMap = new Map<string, number>();
  for (const id of featuredProductIds) {
    if (typeof id === 'string' && !rankMap.has(id)) {
      rankMap.set(id, rankMap.size);
      if (rankMap.size >= 50) break;
    }
  }
  if (rankMap.size === 0) return list;

  const preferred: Product[] = [];
  const rest: Product[] = [];
  for (const p of list) {
    if (rankMap.has(p.id)) {
      preferred.push(p);
    } else {
      rest.push(p);
    }
  }
  if (preferred.length === 0) return list;

  preferred.sort((a, b) => (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0));
  return [...preferred, ...rest];
}

export function sortProductsByModeOnly(
  list: Product[],
  settings?: StoreSettings | null,
  allProductsForCategories?: Array<Pick<Product, 'category'>>
): Product[] {
  if (list.length <= 1) return [...list];
  const mode: ProductSortMode = settings?.productSortMode || 'manual';
  const copy = [...list];

  if (mode === 'az') {
    return copy.sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })
    );
  }

  if (mode === 'price_asc') {
    return copy.sort((a, b) => {
      const diff = getEffectiveProductPrice(a) - getEffectiveProductPrice(b);
      if (Math.abs(diff) > 0.0001) return diff;
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });
  }

  if (mode === 'price_desc') {
    return copy.sort((a, b) => {
      const diff = getEffectiveProductPrice(b) - getEffectiveProductPrice(a);
      if (Math.abs(diff) > 0.0001) return diff;
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });
  }

  // mode === 'manual'
  const cats = resolveStoreCategories(settings, allProductsForCategories || list);
  const catRank = new Map<string, number>();
  cats.forEach((c, idx) => catRank.set(c.id, idx));

  const productOrderMap = settings?.productOrder || {};
  const rankByCatAndProd = new Map<string, Map<string, number>>();
  for (const [catId, prodIds] of Object.entries(productOrderMap)) {
    if (Array.isArray(prodIds)) {
      const m = new Map<string, number>();
      prodIds.forEach((pid, idx) => {
        if (typeof pid === 'string' && !m.has(pid)) {
          m.set(pid, idx);
        }
      });
      rankByCatAndProd.set(catId, m);
    }
  }

  const originalIndex = new Map<string, number>();
  list.forEach((p, idx) => originalIndex.set(p.id, idx));

  return copy.sort((a, b) => {
    if (a.category !== b.category) {
      const ca = catRank.has(a.category) ? catRank.get(a.category)! : 999999;
      const cb = catRank.has(b.category) ? catRank.get(b.category)! : 999999;
      if (ca !== cb) return ca - cb;
    }
    const catMap = rankByCatAndProd.get(a.category);
    if (catMap) {
      const ra = catMap.has(a.id) ? catMap.get(a.id)! : 999999;
      const rb = catMap.has(b.id) ? catMap.get(b.id)! : 999999;
      if (ra !== rb) return ra - rb;
    }
    return (originalIndex.get(a.id) ?? 0) - (originalIndex.get(b.id) ?? 0);
  });
}

export function sortProductsForStore(
  list: Product[],
  settings?: StoreSettings | null,
  allProductsForCategories?: Array<Pick<Product, 'category'>>
): Product[] {
  if (list.length <= 1) return [...list];

  const featuredIds = settings?.featuredProductIds;
  const rankMap = new Map<string, number>();
  if (Array.isArray(featuredIds)) {
    for (const id of featuredIds) {
      if (typeof id === 'string' && !rankMap.has(id)) {
        rankMap.set(id, rankMap.size);
        if (rankMap.size >= 50) break;
      }
    }
  }

  const preferred: Product[] = [];
  const rest: Product[] = [];
  for (const p of list) {
    if (rankMap.has(p.id)) {
      preferred.push(p);
    } else {
      rest.push(p);
    }
  }

  preferred.sort((a, b) => (rankMap.get(a.id) ?? 0) - (rankMap.get(b.id) ?? 0));
  const sortedRest = sortProductsByModeOnly(rest, settings, allProductsForCategories);
  return [...preferred, ...sortedRest];
}

export interface AppState {
  products: Product[];
  orders: Order[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  customers: CustomerProfile[];
  coupons?: Coupon[];
}

export interface ProductImportItem {
  rowNumber?: number;
  name: string;
  category?: string;
  price: number | string;
  costPrice?: number | string;
  stock?: number | string;
  minStock?: number | string;
  sku?: string;
  volume?: string;
  active?: boolean | string;
}

export interface ProductImportErrorItem {
  rowNumber: number;
  name?: string;
  reason: string;
}

export interface ProductImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: ProductImportErrorItem[];
}

export interface CashSessionSummary {
  ordersCount: number;
  totalRevenue: number;
  productsRevenue?: number;
  totalCost?: number;
  netProfit: number;
  profitMarginPercent?: number;
  missingCostItemsCount?: number;
  avgTicket: number;
  onlineCount: number;
  onlineRevenue: number;
  posCount: number;
  posRevenue: number;
  mesaCount: number;
  mesaRevenue: number;
  paymentBreakdown: {
    dinheiro: number;
    pix: number;
    cartao_debito: number;
    cartao_credito: number;
  };
  serviceFeeTotal: number;
  discountTotal: number;
  cancelledCount: number;
  openingCash: number;
  expectedCash: number;
  countedCash: number | null;
  cashDifference: number | null;
}

export interface CashSession {
  id: string;
  openedAt: string;
  closedAt?: string | null;
  openingCash: number;
  countedCash?: number | null;
  notes?: string | null;
  summary: CashSessionSummary;
  createdAt: string;
}

export interface PaymentHistoryItem {
  id: string;
  orderId: string;
  type: 'entrada' | 'saida';
  status: OrderStatus;
  source: 'online' | 'balcao' | 'mesa';
  channelLabel: string;
  customerName: string;
  paymentMethod: PaymentMethod;
  amount: number;
  cashReceived?: number | null;
  changeGiven?: number | null;
  serviceFee?: number;
  discount?: number;
  createdAt: string;
  updatedAt: string;
  cancelReason?: string | null;
}

export interface PaymentsHistorySummary {
  entriesCount: number;
  entriesTotal: number;
  cancelledCount: number;
  cancelledTotal: number;
  balance: number;
  byPaymentMethod: {
    dinheiro: number;
    pix: number;
    cartao_debito: number;
    cartao_credito: number;
  };
}

export interface PaymentsHistoryResponse {
  items: PaymentHistoryItem[];
  summary: PaymentsHistorySummary;
  hasMore: boolean;
  nextOffset: number | null;
  totalCount: number;
  sessionInfo?: {
    id: string;
    openedAt: string;
    closedAt?: string | null;
  } | null;
}

/**
 * Normalizes a neighborhood name for accent-insensitive and case-insensitive comparison.
 */
export function normalizeNeighborhoodName(name?: string | null): string {
  if (!name) return '';
  return String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sorts delivery areas alphabetically (A-Z) by name using pt-BR collation.
 */
export function sortDeliveryAreasAlphabetically(areas: DeliveryArea[]): DeliveryArea[] {
  return [...areas].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' })
  );
}

/**
 * Returns active delivery areas sorted alphabetically (A-Z).
 */
export function getActiveDeliveryAreasSorted(areas: DeliveryArea[]): DeliveryArea[] {
  return sortDeliveryAreasAlphabetically(areas.filter((a) => a.active !== false));
}

/**
 * Finds an active delivery area by exact ID or by normalized neighborhood name (ignoring accents and case).
 */
export function findMatchingActiveDeliveryArea(
  areas: DeliveryArea[],
  idOrName?: string | null
): DeliveryArea | undefined {
  if (!idOrName) return undefined;
  const raw = String(idOrName).trim();
  if (!raw) return undefined;
  const activeAreas = areas.filter((a) => a.active !== false);
  const byId = activeAreas.find((a) => a.id === raw);
  if (byId) return byId;
  const normalizedTarget = normalizeNeighborhoodName(raw);
  if (!normalizedTarget) return undefined;
  return activeAreas.find((a) => normalizeNeighborhoodName(a.name) === normalizedTarget);
}

/**
 * Formats a delivery area option for <select> dropdowns: "Nome do bairro — taxa R$ X,XX — tempo"
 */
export function formatDeliveryAreaOptionLabel(area: DeliveryArea): string {
  const feeFormatted = Number(area.fee || 0)
    .toFixed(2)
    .replace('.', ',');
  const timeText = (area.estimatedTime || '30 a 45 min').trim();
  return `${area.name} — taxa R$ ${feeFormatted} — ${timeText}`;
}

/**
 * Formats separated unit and case counts for a product or cart:
 * e.g. "3 un + 1 cx (12 un)", "3 un", "1 cx (12 un)".
 */
export function formatUnitAndCaseCount(
  unitQty: number,
  caseQty: number,
  caseSize?: number | null
): string {
  const u = Math.max(0, Math.round(Number(unitQty) || 0));
  const c = Math.max(0, Math.round(Number(caseQty) || 0));
  const cs = Number(caseSize) > 1 ? Math.round(Number(caseSize)) : 0;
  const caseUnitsTotal = cs > 0 ? c * cs : 0;

  if (u > 0 && c > 0) {
    return caseUnitsTotal > 0
      ? `${u} un + ${c} cx (${caseUnitsTotal} un)`
      : `${u} un + ${c} cx`;
  }
  if (c > 0) {
    return caseUnitsTotal > 0 ? `${c} cx (${caseUnitsTotal} un)` : `${c} cx`;
  }
  return `${u} un`;
}

/**
 * Formats an array of cart/tab/order items separating loose units ("un") and cases ("cx (N un)").
 */
export function formatCartItemsUnitAndCaseSummary(
  items: Array<{
    quantity: number;
    saleUnit?: SaleUnit | null;
    unitsPerSale?: number | null;
    caseSize?: number | null;
    product?: { caseSize?: number | null } | null;
  }>
): string {
  let unitQty = 0;
  let caseQty = 0;
  let caseUnitsTotal = 0;

  for (const item of items) {
    const qty = Math.max(0, Math.round(Number(item?.quantity) || 0));
    if (qty <= 0) continue;
    if (item?.saleUnit === 'case') {
      caseQty += qty;
      const perCase =
        Number(item?.unitsPerSale) > 1
          ? Math.round(Number(item.unitsPerSale))
          : Number(item?.caseSize) > 1
          ? Math.round(Number(item.caseSize))
          : Number(item?.product?.caseSize) > 1
          ? Math.round(Number(item?.product?.caseSize))
          : 0;
      if (perCase > 0) {
        caseUnitsTotal += qty * perCase;
      }
    } else {
      unitQty += qty;
    }
  }

  if (unitQty > 0 && caseQty > 0) {
    return caseUnitsTotal > 0
      ? `${unitQty} un + ${caseQty} cx (${caseUnitsTotal} un)`
      : `${unitQty} un + ${caseQty} cx`;
  }
  if (caseQty > 0) {
    return caseUnitsTotal > 0 ? `${caseQty} cx (${caseUnitsTotal} un)` : `${caseQty} cx`;
  }
  return `${unitQty} un`;
}

/**
 * Returns the product's safe image URL (preferring `/api/products/:id/image` via `product.imageUrl`),
 * strictly rejecting any base64 (`data:`) strings so lists and grids remain lightweight.
 */
export function getSafeProductImageUrl(
  product?: { imageUrl?: string | null; image?: string | null } | null
): string {
  if (!product) return '';
  const url = typeof product.imageUrl === 'string' ? product.imageUrl.trim() : '';
  if (url && !url.toLowerCase().startsWith('data:')) {
    return url;
  }
  const fallback = typeof product.image === 'string' ? product.image.trim() : '';
  if (fallback && !fallback.toLowerCase().startsWith('data:')) {
    return fallback;
  }
  return '';
}

export type AdminAssistantProposalType =
  | 'price'
  | 'promo'
  | 'description'
  | 'stock_adjust'
  | 'combo';

export interface AdminAssistantProposal {
  id: string;
  type: AdminAssistantProposalType;
  title: string;
  summary: string;
  productId?: string;
  productName?: string;
  currentPrice?: number;
  newPrice?: number;
  currentCostPrice?: number;
  newCostPrice?: number;
  promoPrice?: number | null;
  promoEndsAt?: string | null;
  currentDescription?: string;
  newDescription?: string;
  stockMode?: StockAdjustMode;
  stockQuantity?: number;
  stockReason?: StockAdjustReason;
  stockNote?: string;
  currentStock?: number;
  comboId?: string;
  comboName?: string;
  comboPrice?: number;
  comboCategory?: string;
  comboVolume?: string;
  comboItems?: Array<{
    productId: string;
    productName?: string;
    quantity: number;
  }>;
  status?: 'pending' | 'confirmed' | 'ignored';
}

export interface AdminAssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  proposals?: AdminAssistantProposal[];
}

export interface AdminAssistantResponse {
  reply: string;
  proposals: AdminAssistantProposal[];
  remainingToday: number;
}


