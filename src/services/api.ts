import { Product, Order, StoreSettings, OrderStatus, AppState, DeliveryArea, CustomerProfile } from '../types';
import { initialProducts, initialOrders, initialSettings, initialDeliveryAreas, initialCustomers } from '../data/initialData';
import { soundService } from '../utils/sound';

const STORAGE_KEY_PRODUCTS = 'deposito_products_v2';
const STORAGE_KEY_ORDERS = 'deposito_orders_v2';
const STORAGE_KEY_SETTINGS = 'deposito_settings_v2';
const STORAGE_KEY_AREAS = 'deposito_areas_v2';
const STORAGE_KEY_CUSTOMERS = 'deposito_customers_v2';
const STORAGE_KEY_CURRENT_CUSTOMER = 'deposito_current_customer_v2';
const STORAGE_KEY_ADMIN_AUTH = 'deposito_admin_auth_v2';

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

  constructor() {
    this.initLocalStorageIfEmpty();
    this.setupBroadcastChannel();
    this.setupServerEvents();
  }

  private initLocalStorageIfEmpty() {
    if (typeof window === 'undefined') return;
    if (!localStorage.getItem(STORAGE_KEY_PRODUCTS)) {
      localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(initialProducts));
    }
    if (!localStorage.getItem(STORAGE_KEY_ORDERS)) {
      localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(initialOrders));
    }
    if (!localStorage.getItem(STORAGE_KEY_SETTINGS)) {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(initialSettings));
    }
    if (!localStorage.getItem(STORAGE_KEY_AREAS)) {
      localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(initialDeliveryAreas));
    }
    if (!localStorage.getItem(STORAGE_KEY_CUSTOMERS)) {
      localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(initialCustomers));
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
    this.listeners.forEach(fn => fn());
  }

  public async syncWithBackend(): Promise<void> {
    if (this.hasInitializedBackend) return;
    try {
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

  public resetToDefaults() {
    localStorage.setItem(STORAGE_KEY_PRODUCTS, JSON.stringify(initialProducts));
    localStorage.setItem(STORAGE_KEY_ORDERS, JSON.stringify(initialOrders));
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(initialSettings));
    localStorage.setItem(STORAGE_KEY_AREAS, JSON.stringify(initialDeliveryAreas));
    localStorage.setItem(STORAGE_KEY_CUSTOMERS, JSON.stringify(initialCustomers));
    this.notifyListeners();
  }
}

export const api = new ApiService();
