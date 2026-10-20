import { Product, Order, StoreSettings, OrderStatus, AppState, DeliveryArea, CustomerProfile } from '../types';
import { initialProducts, initialOrders, initialSettings, initialDeliveryAreas, initialCustomers } from '../data/initialData';
import { soundService } from '../utils/sound';
import { supabaseService } from './supabase';

const STORAGE_KEY_PRODUCTS = 'deposito_products_v4';
const STORAGE_KEY_ORDERS = 'deposito_orders_v4';
const STORAGE_KEY_SETTINGS = 'deposito_settings_v4';
const STORAGE_KEY_AREAS = 'deposito_areas_v4';
const STORAGE_KEY_CUSTOMERS = 'deposito_customers_v4';
const STORAGE_KEY_CURRENT_CUSTOMER = 'deposito_current_customer_v4';
const STORAGE_KEY_ADMIN_AUTH = 'deposito_admin_auth_v4';

let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('deposito_sync_channel');
  } catch (e) {
    console.warn('BroadcastChannel not supported', e);
  }
}

class ApiService {
  private listeners: Array<() => void> = [];
  private eventSource: EventSource | null = null;
  private hasInitializedBackend: boolean = false;
  private version: number = 0;

  constructor() {
    this.initLocalStorageIfEmpty();
    this.setupBroadcastChannel();
    this.setupServerEvents();
    // Initialize Supabase if credentials are present in settings or env
    const settings = this.getSettings();
    if (settings.supabaseUrl && settings.supabaseAnonKey) {
      supabaseService.initFromEnvOrStorage(settings.supabaseUrl, settings.supabaseAnonKey);
    }
  }

  private initLocalStorageIfEmpty() {
    if (typeof window === 'undefined') return;
    // Wipe any legacy simulation data from previous turns
    [
      'deposito_products_v2', 'deposito_orders_v2', 'deposito_areas_v2', 'deposito_customers_v2',
      'deposito_products_v3', 'deposito_orders_v3', 'deposito_areas_v3', 'deposito_customers_v3'
    ].forEach(k => {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    });

    if (!localStorage.getItem(STORAGE_KEY_PRODUCTS)) {
      localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEY_ORDERS)) {
      localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify([]));
    }
    const existingSettingsRaw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!existingSettingsRaw) {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(initialSettings));
    } else {
      try {
        const parsed = JSON.parse(existingSettingsRaw);
        let updated = false;
        if (!parsed.supabaseUrl && initialSettings.supabaseUrl) {
          parsed.supabaseUrl = initialSettings.supabaseUrl;
          updated = true;
        }
        if (!parsed.supabaseAnonKey && initialSettings.supabaseAnonKey) {
          parsed.supabaseAnonKey = initialSettings.supabaseAnonKey;
          updated = true;
        }
        if (updated) {
          localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(parsed));
        }
      } catch {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(initialSettings));
      }
    }
    if (!localStorage.getItem(STORAGE_KEY_AREAS)) {
      localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify([]));
    }
    if (!localStorage.getItem(STORAGE_KEY_CUSTOMERS)) {
      localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify([]));
    }
  }

  private setupBroadcastChannel() {
    if (!broadcastChannel) return;
    broadcastChannel.onmessage = (event) => {
      if (event.data?.type === 'ORDER_CREATED') {
        soundService.playNewOrderSound();
      }
      this.notifyListeners();
    };
  }

  private setupServerEvents() {
    if (typeof window === 'undefined') return;
    try {
      this.eventSource = new EventSource('/api/events');
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'NEW_ORDER') {
            soundService.playNewOrderSound();
          }
          if (data.type === 'STATE_UPDATED' && data.payload) {
            localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(data.payload.products));
            localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(data.payload.orders));
            localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(data.payload.settings));
            if (data.payload.deliveryAreas) {
              localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(data.payload.deliveryAreas));
            }
            if (data.payload.customers) {
              localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(data.payload.customers));
            }
          }
          this.notifyListeners();
        } catch (err) {
          console.warn('SSE message parse error', err);
        }
      };
    } catch {
      // Ignored
    }
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notifyListeners() {
    this.version++;
    this.listeners.forEach(fn => fn());
  }

  public getVersion(): number {
    return this.version;
  }

  public async syncWithBackend(): Promise<void> {
    if (this.hasInitializedBackend) return;
    try {
      // 1. First attempt to load state from Supabase if configured
      if (supabaseService.isConfigured()) {
        const supaData = await supabaseService.loadAllFromSupabase();
        if (supaData && (supaData.products || supaData.orders || supaData.settings || supaData.deliveryAreas || supaData.customers)) {
          if (supaData.products) localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(supaData.products));
          if (supaData.orders) localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(supaData.orders));
          if (supaData.settings) localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(supaData.settings));
          if (supaData.deliveryAreas) localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(supaData.deliveryAreas));
          if (supaData.customers) localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(supaData.customers));
          this.hasInitializedBackend = true;
          this.notifyListeners();
          return;
        }
      }

      // 2. Fallback to Express backend state
      const res = await fetch('/api/state');
      if (res.ok) {
        const data: AppState = await res.json();
        if (data.products && data.orders && data.settings) {
          localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(data.products));
          localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(data.orders));
          localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(data.settings));
          if (data.deliveryAreas) {
            localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(data.deliveryAreas));
          }
          if (data.customers) {
            localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(data.customers));
          }
          this.hasInitializedBackend = true;
          this.notifyListeners();
        }
      }
    } catch {
      // Offline fallback
    }
  }

  // ================= ADMIN SECURITY / PIN =================
  public isAdminAuthenticated(): boolean {
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(STORAGE_KEY_ADMIN_AUTH) === 'true';
  }

  public async verifyAdminPin(pin: string): Promise<boolean> {
    const settings = this.getSettings();
    const correctPin = settings.adminPin || '1234';
    const isOk = String(pin).trim() === String(correctPin).trim();

    if (isOk) {
      sessionStorage.setItem(STORAGE_KEY_ADMIN_AUTH, 'true');
      this.notifyListeners();
      return true;
    }
    return false;
  }

  public logoutAdmin(): void {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(STORAGE_KEY_ADMIN_AUTH);
      this.notifyListeners();
    }
  }

  // ================= PRODUCTS =================
  public getProducts(): Product[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_PRODUCTS);
      return data ? JSON.parse(data) : initialProducts;
    } catch {
      return initialProducts;
    }
  }

  public async saveProduct(product: Product): Promise<void> {
    const products = this.getProducts();
    const existingIndex = products.findIndex(p => p.id === product.id);

    let updated: Product[];
    if (existingIndex >= 0) {
      updated = [...products];
      updated[existingIndex] = product;
    } else {
      updated = [product, ...products];
    }

    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(updated));
    this.notifyListeners();
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'PRODUCTS_UPDATED' });
    }

    // Persist to Supabase
    supabaseService.saveProduct(product).catch(err => console.warn('Supabase saveProduct error', err));

    try {
      await fetch(existingIndex >= 0 ? `/api/products/${product.id}` : '/api/products', {
        method: existingIndex >= 0 ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product),
      });
    } catch {
      // Ignored
    }
  }

  public async adjustStock(productId: string, delta: number): Promise<void> {
    const products = this.getProducts();
    const prod = products.find(p => p.id === productId);
    if (!prod) return;

    prod.stock = Math.max(0, prod.stock + delta);
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));
    this.notifyListeners();

    // Persist to Supabase
    supabaseService.saveProduct(prod).catch(err => console.warn('Supabase adjustStock error', err));

    try {
      await fetch(`/api/products/${productId}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delta }),
      });
    } catch {
      // Ignored
    }
  }

  public async deleteProduct(productId: string): Promise<void> {
    const products = this.getProducts().filter(p => p.id !== productId);
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));
    this.notifyListeners();

    // Persist to Supabase
    supabaseService.deleteProduct(productId).catch(err => console.warn('Supabase deleteProduct error', err));

    try {
      await fetch(`/api/products/${productId}`, { method: 'DELETE' });
    } catch {
      // Ignored
    }
  }

  // ================= DELIVERY AREAS =================
  public getDeliveryAreas(): DeliveryArea[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_AREAS);
      return data ? JSON.parse(data) : initialDeliveryAreas;
    } catch {
      return initialDeliveryAreas;
    }
  }

  public async saveDeliveryArea(area: DeliveryArea): Promise<void> {
    const areas = this.getDeliveryAreas();
    const existingIndex = areas.findIndex(a => a.id === area.id);

    let updated: DeliveryArea[];
    if (existingIndex >= 0) {
      updated = [...areas];
      updated[existingIndex] = area;
    } else {
      updated = [...areas, area];
    }

    localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(updated));
    this.notifyListeners();

    // Persist to Supabase
    supabaseService.saveDeliveryArea(area).catch(err => console.warn('Supabase saveDeliveryArea error', err));

    try {
      await fetch(existingIndex >= 0 ? `/api/delivery-areas/${area.id}` : '/api/delivery-areas', {
        method: existingIndex >= 0 ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(area),
      });
    } catch {
      // Ignored
    }
  }

  public async deleteDeliveryArea(id: string): Promise<void> {
    const areas = this.getDeliveryAreas().filter(a => a.id !== id);
    localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(areas));
    this.notifyListeners();

    // Persist to Supabase
    supabaseService.deleteDeliveryArea(id).catch(err => console.warn('Supabase deleteDeliveryArea error', err));

    try {
      await fetch(`/api/delivery-areas/${id}`, { method: 'DELETE' });
    } catch {
      // Ignored
    }
  }

  // ================= CUSTOMERS & AUTH =================
  public getCustomers(): CustomerProfile[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_CUSTOMERS);
      return data ? JSON.parse(data) : initialCustomers;
    } catch {
      return initialCustomers;
    }
  }

  public getCurrentCustomer(): CustomerProfile | null {
    try {
      const data = localStorage.getItem(STORAGE_KEY_CURRENT_CUSTOMER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  public setCurrentCustomer(cust: CustomerProfile | null): void {
    if (cust) {
      localStorage.setItem(STORAGE_KEY_CURRENT_CUSTOMER, JSON.stringify(cust));
    } else {
      localStorage.removeItem(STORAGE_KEY_CURRENT_CUSTOMER);
    }
    this.notifyListeners();
  }

  public async saveCustomerProfile(custData: Omit<CustomerProfile, 'id' | 'createdAt'> & { id?: string }): Promise<CustomerProfile> {
    const customers = this.getCustomers();
    const cleanPhone = custData.phone.replace(/\D/g, '');
    const existingIndex = customers.findIndex(c => c.phone.replace(/\D/g, '') === cleanPhone);

    let savedCust: CustomerProfile;
    if (existingIndex >= 0) {
      savedCust = { ...customers[existingIndex], ...custData };
      customers[existingIndex] = savedCust;
    } else {
      savedCust = {
        ...custData,
        id: custData.id || `cust-${Date.now()}`,
        createdAt: new Date().toISOString(),
        totalOrdersCount: 0,
        totalSpent: 0,
      };
      customers.unshift(savedCust);
    }

    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(customers));
    this.setCurrentCustomer(savedCust);

    // Persist to Supabase
    supabaseService.saveCustomer(savedCust).catch(err => console.warn('Supabase saveCustomer error', err));

    try {
      await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(savedCust),
      });
    } catch {
      // Ignored
    }

    return savedCust;
  }

  public findCustomerByPhone(phone: string): CustomerProfile | null {
    const clean = phone.replace(/\D/g, '');
    if (!clean) return null;
    const customers = this.getCustomers();
    return customers.find(c => c.phone.replace(/\D/g, '') === clean) || null;
  }

  // ================= ORDERS =================
  public getOrders(): Order[] {
    try {
      const data = localStorage.getItem(STORAGE_KEY_ORDERS);
      const orders: Order[] = data ? JSON.parse(data) : initialOrders;
      return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return initialOrders;
    }
  }

  public async createOrder(newOrder: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { id?: string }): Promise<Order> {
    const orders = this.getOrders();
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const orderId = newOrder.id || `PED-${randomNum}`;

    const order: Order = {
      ...newOrder,
      id: orderId,
      status: 'pendente',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Decrement stock
    const products = this.getProducts();
    for (const item of order.items) {
      const prod = products.find(p => p.id === item.productId);
      if (prod) {
        prod.stock = Math.max(0, prod.stock - item.quantity);
      }
    }
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(products));

    // Update customer history if customer
    if (order.customer && order.customer.phone) {
      await this.saveCustomerProfile({
        name: order.customer.name,
        phone: order.customer.phone,
        address: order.customer.address,
        number: order.customer.number,
        neighborhood: order.customer.neighborhood,
        complement: order.customer.complement,
        reference: order.customer.reference,
      });
    }

    const updatedOrders = [order, ...orders];
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(updatedOrders));

    soundService.playNewOrderSound();
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'ORDER_CREATED', orderId: order.id });
    }

    this.notifyListeners();

    // Persist to Supabase
    supabaseService.saveOrder(order).catch(err => console.warn('Supabase saveOrder error', err));

    try {
      await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order),
      });
    } catch {
      // Ignored
    }

    return order;
  }

  public async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    const orders = this.getOrders();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    order.status = status;
    order.updatedAt = new Date().toISOString();

    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(orders));
    this.notifyListeners();

    // Persist to Supabase
    supabaseService.updateOrderStatus(orderId, status).catch(err => console.warn('Supabase updateOrderStatus error', err));

    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch {
      // Ignored
    }
  }

  // ================= SETTINGS =================
  public getSettings(): StoreSettings {
    try {
      const data = localStorage.getItem(STORAGE_KEY_SETTINGS);
      return data ? JSON.parse(data) : initialSettings;
    } catch {
      return initialSettings;
    }
  }

  public async updateSettings(settings: Partial<StoreSettings>): Promise<void> {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(updated));
    soundService.setSoundEnabled(updated.soundEnabled);
    this.notifyListeners();

    // Re-initialize Supabase client if credentials changed
    if (updated.supabaseUrl && updated.supabaseAnonKey) {
      supabaseService.initFromEnvOrStorage(updated.supabaseUrl, updated.supabaseAnonKey);
    }
    // Persist to Supabase
    supabaseService.saveSettings(updated).catch(err => console.warn('Supabase saveSettings error', err));

    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch {
      // Ignored
    }
  }

  // ================= SUPABASE HELPERS =================
  public async testSupabase(): Promise<{ success: boolean; message: string }> {
    return supabaseService.testConnection();
  }

  public async syncAllToSupabase(): Promise<{ success: boolean; message: string }> {
    return supabaseService.syncAllToSupabase({
      products: this.getProducts(),
      orders: this.getOrders(),
      settings: this.getSettings(),
      deliveryAreas: this.getDeliveryAreas(),
      customers: this.getCustomers(),
    });
  }

  public isSupabaseConnected(): boolean {
    return supabaseService.isConfigured();
  }

  public async clearAllSimulationData(): Promise<void> {
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify([]));
    localStorage.removeItem(STORAGE_KEY_CURRENT_CUSTOMER);
    this.notifyListeners();

    try {
      await fetch('/api/clear-all', { method: 'POST' });
    } catch {
      // Ignored
    }
  }

  public resetToDefaults() {
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(initialSettings));
    localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify([]));
    this.notifyListeners();
  }
}

export const api = new ApiService();
