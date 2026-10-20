import { Product, Order, StoreSettings, OrderStatus, DeliveryArea, CustomerProfile } from '../types';
import { initialProducts, initialOrders, initialSettings, initialDeliveryAreas, initialCustomers } from '../data/initialData';
import { soundService } from '../utils/sound';

const STORAGE_KEY_ADMIN_TOKEN = 'deposito_admin_token_v5';
const STORAGE_KEY_CURRENT_CUSTOMER = 'deposito_current_customer_v4';

class ApiService {
  private listeners: Array<() => void> = [];
  private eventSource: EventSource | null = null;
  private version: number = 0;

  // In-memory state synchronized strictly with the server API
  private state: {
    products: Product[];
    orders: Order[];
    settings: StoreSettings;
    deliveryAreas: DeliveryArea[];
    customers: CustomerProfile[];
  } = {
    products: initialProducts,
    orders: initialOrders,
    settings: initialSettings,
    deliveryAreas: initialDeliveryAreas,
    customers: initialCustomers,
  };

  constructor() {
    this.cleanLegacyLocalStorage();
    this.setupServerEvents();
  }

  /**
   * Purge any legacy localStorage data so it is never used as a source of truth.
   * Only admin token and cart are kept in localStorage.
   */
  private cleanLegacyLocalStorage() {
    if (typeof window === 'undefined') return;
    const legacyKeys = [
      'deposito_products_v4',
      'deposito_orders_v4',
      'deposito_settings_v4',
      'deposito_areas_v4',
      'deposito_customers_v4',
      'deposito_products_v3',
      'deposito_orders_v3',
      'deposito_areas_v3',
      'deposito_customers_v3',
      'deposito_products_v2',
      'deposito_orders_v2',
      'deposito_areas_v2',
      'deposito_customers_v2',
    ];
    for (const key of legacyKeys) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
  }

  // ================= ADMIN AUTH & HEADERS =================
  public getAdminToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY_ADMIN_TOKEN);
  }

  public isAdminAuthenticated(): boolean {
    return Boolean(this.getAdminToken());
  }

  private getAdminHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getAdminToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  /**
   * Displays an unmistakable user-facing alert when database operations fail.
   */
  private notifyError(message: string) {
    console.error(`[Depósito API Error] ${message}`);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('deposito_db_error', { detail: { message } }));
      } catch {
        // ignore
      }
      setTimeout(() => {
        alert(message);
      }, 50);
    }
  }

  // ================= REACTIVITY & SSE =================
  public subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners() {
    this.version++;
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (err) {
        console.error('Error notifying listener:', err);
      }
    }
  }

  public getVersion(): number {
    return this.version;
  }

  private setupServerEvents() {
    if (typeof window === 'undefined') return;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const token = this.getAdminToken();
    if (!token) return; // SSE is restricted to authenticated admin

    try {
      this.eventSource = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);

      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'NEW_ORDER') {
            soundService.playNewOrderSound();
            if (data.payload) {
              const existingIdx = this.state.orders.findIndex((o) => o.id === data.payload.id);
              if (existingIdx === -1) {
                this.state.orders.unshift(data.payload);
              }
            }
          }

          if (data.type === 'ORDER_STATUS_CHANGED' && data.payload) {
            const idx = this.state.orders.findIndex((o) => o.id === data.payload.id);
            if (idx >= 0) {
              this.state.orders[idx] = data.payload;
            }
          }

          if (data.type === 'STATE_UPDATED') {
            this.syncWithBackend();
          }

          this.notifyListeners();
        } catch (err) {
          console.warn('Erro ao processar evento SSE:', err);
        }
      };

      this.eventSource.onerror = () => {
        // EventSource will auto-reconnect or close if unauthenticated
      };
    } catch {
      // Ignored
    }
  }

  // ================= DATA SYNCHRONIZATION =================
  public async syncWithBackend(): Promise<void> {
    const token = this.getAdminToken();

    if (token) {
      try {
        const res = await fetch('/api/admin/state', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (res.ok) {
          const data = await res.json();
          this.state = {
            products: Array.isArray(data.products) ? data.products : [],
            orders: Array.isArray(data.orders) ? data.orders : [],
            settings: data.settings || initialSettings,
            deliveryAreas: Array.isArray(data.deliveryAreas) ? data.deliveryAreas : [],
            customers: Array.isArray(data.customers) ? data.customers : [],
          };
          this.setupServerEvents();
          this.notifyListeners();
          return;
        }

        if (res.status === 401) {
          // Token expired or invalid
          console.warn('[Admin] Sessão expirada ou inválida. Retornando ao estado público.');
          this.logoutAdmin();
          return;
        }
      } catch (err) {
        console.warn('Erro ao buscar estado administrativo:', err);
      }
    }

    // Public state for store customer
    try {
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        this.state = {
          products: Array.isArray(data.products) ? data.products : [],
          orders: [],
          settings: data.settings || initialSettings,
          deliveryAreas: Array.isArray(data.deliveryAreas) ? data.deliveryAreas : [],
          customers: [],
        };
        this.notifyListeners();
      }
    } catch (err) {
      console.warn('Erro ao buscar estado público da loja:', err);
    }
  }

  // ================= ADMIN SECURITY / PIN =================
  public async verifyAdminPin(pin: string): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (!res.ok) {
        return false;
      }

      const data = await res.json();
      if (data && data.token) {
        localStorage.setItem(STORAGE_KEY_ADMIN_TOKEN, data.token);
        await this.syncWithBackend();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Erro ao verificar PIN do admin:', err);
      return false;
    }
  }

  public logoutAdmin(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_ADMIN_TOKEN);
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.state.orders = [];
    this.state.customers = [];
    this.syncWithBackend();
    this.notifyListeners();
  }

  // ================= PRODUCTS =================
  public getProducts(): Product[] {
    return this.state.products;
  }

  public async saveProduct(product: Product): Promise<void> {
    const isEdit = this.state.products.some((p) => p.id === product.id);
    const url = isEdit ? `/api/products/${product.id}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: this.getAdminHeaders(),
      body: JSON.stringify(product),
    });

    if (!res.ok) {
      let message = 'Não foi possível salvar o produto no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const saved: Product = await res.json();
    const idx = this.state.products.findIndex((p) => p.id === saved.id);
    if (idx >= 0) {
      this.state.products[idx] = saved;
    } else {
      this.state.products.unshift(saved);
    }
    this.notifyListeners();
  }

  public async adjustStock(productId: string, delta: number): Promise<void> {
    const res = await fetch(`/api/products/${productId}/stock`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ delta }),
    });

    if (!res.ok) {
      let message = 'Não foi possível alterar o estoque no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: Product = await res.json();
    const idx = this.state.products.findIndex((p) => p.id === productId);
    if (idx >= 0) {
      this.state.products[idx] = updated;
    }
    this.notifyListeners();
  }

  public async deleteProduct(productId: string): Promise<void> {
    const res = await fetch(`/api/products/${productId}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível excluir o produto no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.products = this.state.products.filter((p) => p.id !== productId);
    this.notifyListeners();
  }

  // ================= DELIVERY AREAS =================
  public getDeliveryAreas(): DeliveryArea[] {
    return this.state.deliveryAreas;
  }

  public async saveDeliveryArea(area: DeliveryArea): Promise<void> {
    const isEdit = this.state.deliveryAreas.some((a) => a.id === area.id);
    const url = isEdit ? `/api/delivery-areas/${area.id}` : '/api/delivery-areas';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: this.getAdminHeaders(),
      body: JSON.stringify(area),
    });

    if (!res.ok) {
      let message = 'Não foi possível salvar o bairro de entrega no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const saved: DeliveryArea = await res.json();
    const idx = this.state.deliveryAreas.findIndex((a) => a.id === saved.id);
    if (idx >= 0) {
      this.state.deliveryAreas[idx] = saved;
    } else {
      this.state.deliveryAreas.push(saved);
    }
    this.notifyListeners();
  }

  public async deleteDeliveryArea(id: string): Promise<void> {
    const res = await fetch(`/api/delivery-areas/${id}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível excluir o bairro de entrega no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.deliveryAreas = this.state.deliveryAreas.filter((a) => a.id !== id);
    this.notifyListeners();
  }

  // ================= CUSTOMERS & AUTH =================
  public getCustomers(): CustomerProfile[] {
    return this.state.customers;
  }

  public getCurrentCustomer(): CustomerProfile | null {
    if (typeof window === 'undefined') return null;
    try {
      const data = localStorage.getItem(STORAGE_KEY_CURRENT_CUSTOMER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  public setCurrentCustomer(cust: CustomerProfile | null): void {
    if (typeof window === 'undefined') return;
    if (cust) {
      localStorage.setItem(STORAGE_KEY_CURRENT_CUSTOMER, JSON.stringify(cust));
    } else {
      localStorage.removeItem(STORAGE_KEY_CURRENT_CUSTOMER);
    }
    this.notifyListeners();
  }

  public async findCustomerByPhone(phone: string): Promise<CustomerProfile | null> {
    const clean = phone.replace(/\D/g, '');
    if (!clean) return null;

    try {
      const res = await fetch(`/api/customers/by-phone/${clean}`);
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  }

  public async saveCustomerProfile(
    custData: Omit<CustomerProfile, 'id' | 'createdAt'> & { id?: string }
  ): Promise<CustomerProfile> {
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(custData),
    });

    if (!res.ok) {
      let message = 'Não foi possível salvar o cadastro do cliente no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const saved: CustomerProfile = await res.json();
    this.setCurrentCustomer(saved);

    if (this.isAdminAuthenticated()) {
      const cleanPhone = saved.phone.replace(/\D/g, '');
      const idx = this.state.customers.findIndex(
        (c) => c.id === saved.id || c.phone.replace(/\D/g, '') === cleanPhone
      );
      if (idx >= 0) {
        this.state.customers[idx] = saved;
      } else {
        this.state.customers.unshift(saved);
      }
    }

    this.notifyListeners();
    return saved;
  }

  public async deleteCustomer(id: string): Promise<void> {
    const res = await fetch(`/api/customers/${id}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível excluir o cliente no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.customers = this.state.customers.filter((c) => c.id !== id);
    this.notifyListeners();
  }

  // ================= ORDERS =================
  public getOrders(): Order[] {
    return this.state.orders.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public async createOrder(
    newOrder: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { id?: string }
  ): Promise<Order> {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newOrder),
    });

    if (!res.ok) {
      let message = 'Não foi possível realizar o pedido.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const createdOrder: Order = await res.json();

    if (this.isAdminAuthenticated()) {
      this.state.orders.unshift(createdOrder);
    }

    soundService.playNewOrderSound();
    this.notifyListeners();
    return createdOrder;
  }

  public async updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      let message = 'Não foi possível atualizar o status do pedido no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: Order = await res.json();
    const idx = this.state.orders.findIndex((o) => o.id === orderId);
    if (idx >= 0) {
      this.state.orders[idx] = updated;
    }
    this.notifyListeners();
  }

  public async deleteOrder(orderId: string): Promise<void> {
    const res = await fetch(`/api/orders/${orderId}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível excluir o pedido no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.orders = this.state.orders.filter((o) => o.id !== orderId);
    this.notifyListeners();
  }

  // ================= SETTINGS =================
  public getSettings(): StoreSettings {
    return this.state.settings;
  }

  public async updateSettings(settings: Partial<StoreSettings>): Promise<void> {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(settings),
    });

    if (!res.ok) {
      let message = 'Não foi possível salvar as configurações no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: StoreSettings = await res.json();
    this.state.settings = updated;
    soundService.setSoundEnabled(updated.soundEnabled);
    this.notifyListeners();
  }

  public async clearAllSimulationData(): Promise<void> {
    const res = await fetch('/api/clear-all', {
      method: 'POST',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível zerar os dados de simulação.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {
        // ignore
      }
      this.notifyError(message);
      throw new Error(message);
    }

    await this.syncWithBackend();
  }
}

export const api = new ApiService();
