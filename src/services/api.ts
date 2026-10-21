import { Product, Order, StoreSettings, OrderStatus, DeliveryArea, CustomerProfile, Coupon } from '../types';
import { initialProducts, initialOrders, initialSettings, initialDeliveryAreas, initialCustomers } from '../data/initialData';
import { soundService } from '../utils/sound';

const STORAGE_KEY_ADMIN_TOKEN = 'deposito_admin_token_v5';
const STORAGE_KEY_CUSTOMER_TOKEN = 'deposito_customer_token_v5';
const STORAGE_KEY_CURRENT_CUSTOMER = 'deposito_current_customer_v5';

export interface VerifyPinResult {
  success: boolean;
  status: number;
  error?: string;
}

export interface CustomerAuthResult {
  success: boolean;
  status: number;
  error?: string;
  customer?: CustomerProfile;
}

export interface CouponValidationResult {
  valid: boolean;
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  discount: number;
  minOrder?: number;
  maxDiscount?: number;
}

export interface CustomerDeliveryQuoteResult {
  distanceKm: number | null;
  isWithinDeliveryRadius: boolean;
  deliveryRadiusKm: number;
  deliveryFee: number;
  rawDeliveryFee: number;
  freeDeliveryThreshold: number;
  latitude: number | null;
  longitude: number | null;
}

const STORAGE_PREFIX_PIN_CONFIRMED = 'deposito_pin_confirmed_v1_';

class ApiService {
  private listeners: Array<() => void> = [];
  private version: number = 0;
  private pollingInterval: any = null;

  // In-memory state synchronized directly with the server API
  private state: {
    products: Product[];
    orders: Order[];
    settings: StoreSettings;
    deliveryAreas: DeliveryArea[];
    customers: CustomerProfile[];
    coupons: Coupon[];
  } = {
    products: initialProducts,
    orders: initialOrders,
    settings: initialSettings,
    deliveryAreas: initialDeliveryAreas,
    customers: initialCustomers,
    coupons: [],
  };

  constructor() {
    this.cleanLegacyLocalStorage();
  }

  /**
   * Purge legacy localStorage data so it is never used as source of truth.
   * Only admin token, customer token and cart are kept in localStorage.
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
      'deposito_current_customer_v4',
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

  public getAdminHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getAdminToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // ================= CUSTOMER AUTH & HEADERS =================
  public getCustomerToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY_CUSTOMER_TOKEN);
  }

  public isCustomerAuthenticated(): boolean {
    return Boolean(this.getCustomerToken());
  }

  public getCustomerHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = this.getCustomerToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  public getCurrentCustomer(): CustomerProfile | null {
    if (typeof window === 'undefined') return null;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CURRENT_CUSTOMER);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }

  public setCurrentCustomer(customer: CustomerProfile | null) {
    if (typeof window === 'undefined') return;
    if (customer) {
      localStorage.setItem(STORAGE_KEY_CURRENT_CUSTOMER, JSON.stringify(customer));
    } else {
      localStorage.removeItem(STORAGE_KEY_CURRENT_CUSTOMER);
    }
    this.notifyListeners();
  }

  public async registerCustomer(data: any): Promise<CustomerProfile> {
    const res = await fetch('/api/customer/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      let message = 'Não foi possível realizar o cadastro.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const json = await res.json();
    if (json.token) {
      localStorage.setItem(STORAGE_KEY_CUSTOMER_TOKEN, json.token);
    }
    if (json.customer) {
      this.setCurrentCustomer(json.customer);
      if (json.customer.id && json.customer.latitude !== undefined && json.customer.longitude !== undefined) {
        this.markCustomerPinConfirmed(json.customer.id);
      }
    }

    this.notifyListeners();
    return json.customer;
  }

  public isCustomerPinConfirmed(customerId?: string | null): boolean {
    if (typeof window === 'undefined' || !customerId) return false;
    try {
      return localStorage.getItem(`${STORAGE_PREFIX_PIN_CONFIRMED}${customerId}`) === '1';
    } catch {
      return false;
    }
  }

  public markCustomerPinConfirmed(customerId?: string | null): void {
    if (typeof window === 'undefined' || !customerId) return;
    try {
      localStorage.setItem(`${STORAGE_PREFIX_PIN_CONFIRMED}${customerId}`, '1');
    } catch {
      // ignore
    }
  }

  public async loginCustomer(email: string, password: string): Promise<CustomerAuthResult> {
    try {
      const res = await fetch('/api/customer/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 429) {
        let msg = 'Muitas tentativas, aguarde 15 minutos.';
        try {
          const json = await res.json();
          if (json?.error) msg = json.error;
        } catch {}
        return { success: false, status: 429, error: msg };
      }

      if (res.status >= 500) {
        return { success: false, status: res.status, error: 'Servidor indisponível' };
      }

      if (!res.ok) {
        let msg = 'E-mail ou senha incorretos.';
        try {
          const json = await res.json();
          if (json?.error) msg = json.error;
        } catch {}
        return { success: false, status: res.status, error: msg };
      }

      const data = await res.json();
      if (data && data.token && data.customer) {
        localStorage.setItem(STORAGE_KEY_CUSTOMER_TOKEN, data.token);
        this.setCurrentCustomer(data.customer);
        return { success: true, status: 200, customer: data.customer };
      }

      return { success: false, status: 500, error: 'Servidor indisponível' };
    } catch (err) {
      console.error('Erro de conexão no login do cliente:', err);
      return { success: false, status: 0, error: 'Servidor indisponível' };
    }
  }

  public logoutCustomer(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_CUSTOMER_TOKEN);
      localStorage.removeItem(STORAGE_KEY_CURRENT_CUSTOMER);
    }
    this.notifyListeners();
  }

  public async getCustomerMe(): Promise<CustomerProfile | null> {
    const token = this.getCustomerToken();
    if (!token) return null;

    try {
      const res = await fetch('/api/customer/me', {
        headers: this.getCustomerHeaders(),
      });
      if (res.ok) {
        const cust: CustomerProfile = await res.json();
        this.setCurrentCustomer(cust);
        return cust;
      }
      if (res.status === 401) {
        this.logoutCustomer();
      }
      return null;
    } catch {
      return null;
    }
  }

  public async updateCustomerMe(data: Partial<CustomerProfile> & { password?: string }): Promise<CustomerProfile> {
    const res = await fetch('/api/customer/me', {
      method: 'PUT',
      headers: this.getCustomerHeaders(),
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      let message = 'Não foi possível atualizar o cadastro.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: CustomerProfile = await res.json();
    this.setCurrentCustomer(updated);
    return updated;
  }

  public async getCustomerOrders(): Promise<Order[]> {
    const res = await fetch('/api/customer/orders', {
      headers: this.getCustomerHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível carregar seus pedidos.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    const list: Order[] = await res.json();
    return Array.isArray(list) ? list : [];
  }

  public async getCustomerOrder(orderId: string): Promise<Order> {
    const res = await fetch(`/api/customer/orders/${encodeURIComponent(orderId)}`, {
      headers: this.getCustomerHeaders(),
    });

    if (!res.ok) {
      let message = 'Pedido não encontrado.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    return await res.json();
  }

  public async getCustomerDeliveryQuote(
    subtotal?: number,
    neighborhood?: string
  ): Promise<CustomerDeliveryQuoteResult | null> {
    const token = this.getCustomerToken();
    if (!token) return null;

    try {
      const params = new URLSearchParams();
      if (subtotal !== undefined && !Number.isNaN(subtotal)) {
        params.set('subtotal', String(subtotal));
      }
      if (neighborhood && neighborhood.trim()) {
        params.set('neighborhood', neighborhood.trim());
      }
      const qs = params.toString();
      const res = await fetch(`/api/customer/delivery-quote${qs ? `?${qs}` : ''}`, {
        headers: this.getCustomerHeaders(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('Erro ao consultar cotação de entrega:', err);
      return null;
    }
  }

  // ================= NOTIFICATIONS & ERRORS =================
  private notifyError(message: string) {
    console.error(`[Depósito API Error] ${message}`);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('deposito_db_error', { detail: { message } }));
      } catch {}
      setTimeout(() => {
        alert(message);
      }, 50);
    }
  }

  // ================= REACTIVITY =================
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

  // ================= ORDER & STOCK POLLING (EVERY 10 SECONDS) =================
  private startOrderPolling() {
    this.stopOrderPolling();
    if (!this.isAdminAuthenticated()) return;

    this.pollOrders();
    this.pollingInterval = setInterval(() => {
      this.pollOrders();
    }, 10000);
  }

  private stopOrderPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async pollOrders(): Promise<void> {
    const token = this.getAdminToken();
    if (!token) {
      this.stopOrderPolling();
      return;
    }

    try {
      const [ordersRes, prodRes] = await Promise.all([
        fetch('/api/admin/orders', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/products', {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (ordersRes.status === 401) {
        this.logoutAdmin();
        return;
      }

      if (ordersRes.ok) {
        const fetchedOrders: Order[] = await ordersRes.json();
        if (Array.isArray(fetchedOrders)) {
          const existingIds = new Set(this.state.orders.map((o) => o.id));
          const hasNewPendingOrder = fetchedOrders.some(
            (fo) => !existingIds.has(fo.id) && fo.status === 'pendente'
          );

          if (hasNewPendingOrder) {
            soundService.playNewOrderSound();
          }

          this.state.orders = fetchedOrders;
        }
      }

      if (prodRes.ok) {
        const fetchedProducts: Product[] = await prodRes.json();
        if (Array.isArray(fetchedProducts)) {
          this.state.products = fetchedProducts;
        }
      }

      this.notifyListeners();
    } catch {
      // Background poll silently continues
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
            coupons: Array.isArray(data.coupons) ? data.coupons : [],
          };
          this.startOrderPolling();
          this.notifyListeners();
          return;
        }

        if (res.status === 401) {
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
      this.stopOrderPolling();
      const res = await fetch('/api/state');
      if (res.ok) {
        const data = await res.json();
        this.state = {
          products: Array.isArray(data.products) ? data.products : [],
          orders: [],
          settings: data.settings || initialSettings,
          deliveryAreas: Array.isArray(data.deliveryAreas) ? data.deliveryAreas : [],
          customers: [],
          coupons: [],
        };
        this.notifyListeners();
      }
    } catch (err) {
      console.warn('Erro ao buscar estado público da loja:', err);
    }
  }

  // ================= ADMIN SECURITY / PIN =================
  public async verifyAdminPin(pin: string): Promise<VerifyPinResult> {
    try {
      const res = await fetch('/api/admin/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });

      if (res.status === 429) {
        let msg = 'Muitas tentativas, aguarde 15 minutos.';
        try {
          const json = await res.json();
          if (json?.error) msg = json.error;
        } catch {}
        return { success: false, status: 429, error: msg };
      }

      if (res.status >= 500) {
        return { success: false, status: res.status, error: 'Servidor indisponível' };
      }

      if (!res.ok) {
        return { success: false, status: res.status, error: 'Senha de acesso incorreta. Tente novamente.' };
      }

      const data = await res.json();
      if (data && data.token) {
        localStorage.setItem(STORAGE_KEY_ADMIN_TOKEN, data.token);
        await this.syncWithBackend();
        return { success: true, status: 200 };
      }

      return { success: false, status: 500, error: 'Servidor indisponível' };
    } catch (err) {
      console.error('Erro de conexão ao verificar PIN do admin:', err);
      return { success: false, status: 0, error: 'Servidor indisponível' };
    }
  }

  public logoutAdmin(): void {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_ADMIN_TOKEN);
    }
    this.stopOrderPolling();
    this.state.orders = [];
    this.state.customers = [];
    this.state.coupons = [];
    this.syncWithBackend();
    this.notifyListeners();
  }

  // ================= PRODUCTS & STOCK =================
  public getProducts(): Product[] {
    return this.state.products;
  }

  public async reloadProducts(): Promise<void> {
    try {
      const token = this.getAdminToken();
      const res = await fetch('/api/products', token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
      if (res.ok) {
        const prods = await res.json();
        if (Array.isArray(prods)) {
          this.state.products = prods;
          this.notifyListeners();
        }
      }
    } catch (err) {
      console.warn('Erro ao recarregar produtos:', err);
    }
  }

  public async setProductPromotion(
    productId: string,
    promoPrice: number,
    promoEndsAt?: string | null
  ): Promise<Product> {
    const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/promotion`, {
      method: 'PUT',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({
        promoPrice,
        promoEndsAt: promoEndsAt || null,
      }),
    });

    if (!res.ok) {
      let message = 'Não foi possível salvar a promoção do produto.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    const updated: Product = await res.json();
    await this.reloadProducts();
    return updated;
  }

  public async clearProductPromotion(productId: string): Promise<Product> {
    const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/promotion`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Não foi possível encerrar a promoção do produto.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: Product = await res.json();
    await this.reloadProducts();
    return updated;
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
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    await this.reloadProducts();
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
        if (json?.error) message = `Não foi possível alterar o estoque: ${json.error}`;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    await this.reloadProducts();
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
      } catch {}
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
      let message = 'Não foi possível salvar a taxa de entrega no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {}
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
      let message = 'Não foi possível excluir a área de entrega no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.deliveryAreas = this.state.deliveryAreas.filter((a) => a.id !== id);
    this.notifyListeners();
  }

  // ================= CUSTOMERS (ADMIN) =================
  public getCustomers(): CustomerProfile[] {
    return this.state.customers;
  }

  public async saveCustomerProfile(
    customer: Omit<CustomerProfile, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
  ): Promise<CustomerProfile> {
    const isEdit = Boolean(customer.id && this.state.customers.some((c) => c.id === customer.id));
    const url = isEdit ? `/api/customers/${customer.id}` : '/api/customers';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: this.getAdminHeaders(),
      body: JSON.stringify(customer),
    });

    if (!res.ok) {
      let message = 'Não foi possível salvar o cliente no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const saved: CustomerProfile = await res.json();
    const idx = this.state.customers.findIndex((c) => c.id === saved.id);
    if (idx >= 0) {
      this.state.customers[idx] = saved;
    } else {
      this.state.customers.unshift(saved);
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
      } catch {}
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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const adminToken = this.getAdminToken();
    const customerToken = this.getCustomerToken();

    if (newOrder.source === 'balcao' && adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    } else if (customerToken) {
      headers['Authorization'] = `Bearer ${customerToken}`;
    } else if (adminToken) {
      headers['Authorization'] = `Bearer ${adminToken}`;
    }

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers,
      body: JSON.stringify(newOrder),
    });

    if (!res.ok) {
      let message = 'Não foi possível realizar o pedido.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const createdOrder: Order = await res.json();

    if (this.isAdminAuthenticated()) {
      this.state.orders.unshift(createdOrder);
    }

    // Refresh products on server to sync atomic real-time stock
    await this.reloadProducts();

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
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: Order = await res.json();
    const idx = this.state.orders.findIndex((o) => o.id === orderId);
    if (idx >= 0) {
      this.state.orders[idx] = updated;
    }

    // Refresh products because stock might be restored/decremented on cancel/uncancel
    await this.reloadProducts();
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
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.orders = this.state.orders.filter((o) => o.id !== orderId);
    this.notifyListeners();
  }

  // ================= COUPONS =================
  public getCoupons(): Coupon[] {
    return this.state.coupons;
  }

  public async validateCoupon(
    code: string,
    subtotal: number,
    items?: Array<{ productId: string; quantity: number }>
  ): Promise<CouponValidationResult> {
    const res = await fetch('/api/coupons/validate', {
      method: 'POST',
      headers: this.getCustomerHeaders(),
      body: JSON.stringify({ code, subtotal, items }),
    });

    if (!res.ok) {
      let message = 'Cupom inválido.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    return await res.json();
  }

  public async getAdminCoupons(): Promise<Coupon[]> {
    const res = await fetch('/api/admin/coupons', {
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Erro ao listar cupons.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const list: Coupon[] = await res.json();
    this.state.coupons = Array.isArray(list) ? list : [];
    this.notifyListeners();
    return this.state.coupons;
  }

  public async createAdminCoupon(data: Partial<Coupon>): Promise<Coupon> {
    const res = await fetch('/api/admin/coupons', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      let message = 'Erro ao criar cupom.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const created: Coupon = await res.json();
    this.state.coupons.unshift(created);
    this.notifyListeners();
    return created;
  }

  public async updateAdminCoupon(code: string, data: Partial<Coupon>): Promise<Coupon> {
    const res = await fetch(`/api/admin/coupons/${code}`, {
      method: 'PUT',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      let message = 'Erro ao atualizar cupom.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const updated: Coupon = await res.json();
    const idx = this.state.coupons.findIndex((c) => c.code === code);
    if (idx >= 0) {
      this.state.coupons[idx] = updated;
    }
    this.notifyListeners();
    return updated;
  }

  public async deleteAdminCoupon(code: string): Promise<void> {
    const res = await fetch(`/api/admin/coupons/${code}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (!res.ok) {
      let message = 'Erro ao excluir cupom.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    this.state.coupons = this.state.coupons.filter((c) => c.code !== code);
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
      } catch {}
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
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    await this.syncWithBackend();
  }
}

export const api = new ApiService();
