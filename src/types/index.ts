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
  sku: string;
  active: boolean;
  description: string;
}

export function hasProductCase(product?: Pick<Product, 'caseSize' | 'casePrice'> | null): boolean {
  if (!product) return false;
  const size = Number(product.caseSize) || 0;
  const price = Number(product.casePrice) || 0;
  return Number.isInteger(size) && size >= 2 && size <= 100 && price > 0;
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
  | 'fecharModal';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  pdv: 'F2',
  mesas: 'F3',
  pedidos: 'F4',
  estoque: 'F8',
  finalizar: 'F9',
  busca: '/',
  fecharModal: 'Escape',
};

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
  shortcuts?: Record<string, string>; // Atalhos do teclado customizados no painel
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

export function formatCategoryLabel(category: string): string {
  switch (category) {
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
    default:
      return category;
  }
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


