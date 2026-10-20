import { Product, StoreSettings, Order, DeliveryArea, CustomerProfile } from '../types';

export const initialSettings: StoreSettings = {
  storeName: 'Depósito & Distribuidora de Bebidas',
  logoUrl: '',
  bannerUrl: '',
  cnpjOrCpf: '',
  phone: '(11) 98765-4321',
  whatsapp: '5511987654321',
  address: 'Rua Principal, 100',
  pixKey: '',
  pixKeyType: 'aleatoria',
  pixReceiver: '',
  deliveryFee: 5.00,
  freeDeliveryThreshold: 100.00,
  minOrderValue: 15.00,
  isOpen: true,
  closedMessage: 'No momento estamos fechados para entregas. Reabriremos no próximo expediente!',
  estimatedDeliveryTime: '30 a 45 min',
  openingHours: 'Segunda a Domingo: 10:00 às 23:00',
  soundEnabled: true,
  adminPin: '1234',
  supabaseUrl: 'https://daxtsgcjsyujykztxiox.supabase.co',
  supabaseAnonKey: 'sb_publishable_dFxrorp9joFJ8cpDkUfSrw_PcoUSuYN',
  deliveryRadiusKm: 5,
  storeLatitude: -23.55052,
  storeLongitude: -46.633308,
  deliveryModel: 'both',
};

// All simulation data wiped clean for real depot operation
export const initialProducts: Product[] = [];
export const initialOrders: Order[] = [];
export const initialDeliveryAreas: DeliveryArea[] = [];
export const initialCustomers: CustomerProfile[] = [];
