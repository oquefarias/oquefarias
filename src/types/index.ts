export type ProductCategory = 
  | 'cervejas'
  | 'destilados'
  | 'vinhos'
  | 'nao_alcoolicos'
  | 'gelo_carvao'
  | 'petiscos';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  volume: string;
  price: number;
  promoPrice?: number | null;
  promoEndsAt?: string | null;
  costPrice: number;
  stock: number;
  minStock: number;
  isCold: boolean;
  image: string;
  sku: string;
  active: boolean;
  description: string;
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
  isCold?: boolean;
}

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
  source: 'online' | 'balcao';
  customer: CustomerInfo;
  customerId?: string;
  couponCode?: string;
  discount?: number;
  deliveryType: 'delivery' | 'retirada';
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
}

export interface AppState {
  products: Product[];
  orders: Order[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  customers: CustomerProfile[];
  coupons?: Coupon[];
}
