import {
  Product,
  Order,
  StoreSettings,
  OrderStatus,
  DeliveryArea,
  CustomerProfile,
  Coupon,
  DiningTable,
  TableTab,
  TableTabItem,
  TableWithTab,
  TabDetail,
  PaymentMethod,
  ProductImportItem,
  ProductImportResult,
  StockAdjustMode,
  StockAdjustReason,
  StockMovementsResponse,
  AdminChangesResponse,
  GuestTrackedOrderResponse,
  SavedGuestOrderLink,
  CashSession,
  CashSessionSummary,
  PaymentsHistoryResponse,
  AdminAssistantMessage,
  AdminAssistantResponse,
  isComboProduct,
  calculateComboMetrics,
} from '../types';
import { initialProducts, initialOrders, initialSettings, initialDeliveryAreas, initialCustomers } from '../data/initialData';
import { soundService } from '../utils/sound';

const STORAGE_KEY_ADMIN_TOKEN = 'deposito_admin_token_v5';
const STORAGE_KEY_CUSTOMER_TOKEN = 'deposito_customer_token_v5';
const STORAGE_KEY_CURRENT_CUSTOMER = 'deposito_current_customer_v5';
const STORAGE_KEY_GUEST_ORDERS = 'deposito_guest_orders_v1';

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
  deliveryAreaId?: string | null;
  neighborhood?: string | null;
  estimatedTime?: string;
  isValidArea?: boolean;
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

export const ORDER_SUBMIT_TIMEOUT_MS = 20000;
export const ORDER_RETRY_DELAYS_MS = [2000, 4000, 6000] as const;
export const ORDER_CHECKING_STATUS_MESSAGE = 'Conferindo se o seu pedido chegou...';
export const ORDER_NETWORK_EXHAUSTED_MESSAGE =
  'Não conseguimos confirmar seu pedido por falha na internet. Toque em Tentar de novo — não será criado pedido duplicado.';

export function isNetworkOrTimeoutError(err: any): boolean {
  if (!err) return false;
  if (err.isServerResponse) return false;
  if (err.isNetworkError || err.isNetworkRetryExhausted) return true;
  const name = String(err.name || '');
  if (name === 'AbortError' || name === 'TimeoutError' || err instanceof TypeError) {
    return true;
  }
  const msg = String(err.message || err || '').toLowerCase();
  return (
    msg.includes('load failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('fetch failed') ||
    msg.includes('the internet connection appears to be offline') ||
    msg.includes('the network connection was lost') ||
    msg.includes('aborted') ||
    msg.includes('timeout') ||
    msg.includes('tempo limite')
  );
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = ORDER_SUBMIT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ApiService {
  private listeners: Array<() => void> = [];
  private adminChangeListeners: Array<(changes: AdminChangesResponse) => void> = [];
  private version: number = 0;
  private pollingInterval: any = null;
  private visibilityListener: (() => void) | null = null;
  private interactionListener: (() => void) | null = null;
  private lastUserInteractionMs: number = Date.now();
  private currentPollIntervalMs: number = 20000;
  private lastPollCheckMs: number = 0;
  private isPollingInFlight: boolean = false;
  private lastChangesSyncTime: string = '';
  private lastOrdersSyncTime: string = '';
  private lastProductsSyncTime: string = '';
  private adminSessionExpiredMessage: string = '';

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
  private getTokenExpirationMs(token: string | null): number | null {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return null;
      const base64 = parts[0].replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const json = atob(padded);
      const payload = JSON.parse(json);
      return typeof payload?.exp === 'number' ? payload.exp : null;
    } catch {
      return null;
    }
  }

  public getAdminToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(STORAGE_KEY_ADMIN_TOKEN);
  }

  public isAdminAuthenticated(): boolean {
    const token = this.getAdminToken();
    if (!token) return false;
    const expMs = this.getTokenExpirationMs(token);
    if (expMs !== null && expMs <= Date.now()) {
      this.handleAdminSessionExpired();
      return false;
    }
    return true;
  }

  public getAdminSessionExpiredMessage(): string {
    return this.adminSessionExpiredMessage;
  }

  public clearAdminSessionExpiredMessage(): void {
    this.adminSessionExpiredMessage = '';
  }

  private handleAdminSessionExpired(): void {
    const expiredMsg = 'Sua sessão expirou. Digite o PIN novamente.';
    this.adminSessionExpiredMessage = expiredMsg;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY_ADMIN_TOKEN);
      try {
        window.dispatchEvent(new CustomEvent('deposito_admin_expired', { detail: { message: expiredMsg } }));
      } catch {}
    }
    this.stopOrderPolling();
    this.state.orders = [];
    this.state.customers = [];
    this.state.coupons = [];
    this.notifyListeners();
  }

  public async checkAndRefreshAdminToken(): Promise<void> {
    const token = this.getAdminToken();
    if (!token) return;
    const expMs = this.getTokenExpirationMs(token);
    if (expMs === null) return;
    const remainingMs = expMs - Date.now();
    if (remainingMs <= 0) {
      this.handleAdminSessionExpired();
      return;
    }
    // If less than 2 hours remain, renew via POST /api/admin/refresh
    if (remainingMs < 2 * 60 * 60 * 1000) {
      try {
        const res = await fetch('/api/admin/refresh', {
          method: 'POST',
          headers: this.getAdminHeaders(),
        });
        if (res.status === 401) {
          this.handleAdminSessionExpired();
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data?.token && typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEY_ADMIN_TOKEN, data.token);
          }
        }
      } catch {
        // Ignore transient network errors during background token renewal
      }
    }
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
        cache: 'no-store',
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

  public async updateCustomerMe(
    data: Partial<CustomerProfile> & { password?: string; deliveryAreaId?: string }
  ): Promise<CustomerProfile> {
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
      cache: 'no-store',
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
      cache: 'no-store',
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

  public getSavedGuestOrders(): SavedGuestOrderLink[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY_GUEST_ORDERS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item: any) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.token === 'string' &&
          /^[a-f0-9]{32}$/i.test(item.token)
      );
    } catch {
      return [];
    }
  }

  public getGuestTokenForOrder(orderId: string): string | null {
    const saved = this.getSavedGuestOrders().find((o) => o.id === orderId);
    return saved ? saved.token : null;
  }

  public saveGuestOrderToStorage(order: Order, token: string, trackingUrl?: string): void {
    if (typeof window === 'undefined' || !order?.id || !token) return;
    try {
      const cleanToken = token.trim();
      if (!/^[a-f0-9]{32}$/i.test(cleanToken)) return;
      const existing = this.getSavedGuestOrders().filter((o) => o.id !== order.id);
      const itemsSummary = (order.items || [])
        .map((i) => `${i.quantity}x ${i.name}`)
        .join(', ');
      const entry: SavedGuestOrderLink = {
        id: order.id,
        token: cleanToken,
        trackingUrl: trackingUrl || `/pedido/${order.id}?t=${cleanToken}`,
        createdAt: order.createdAt || new Date().toISOString(),
        total: Number(order.total) || 0,
        status: order.status || 'pendente',
        deliveryType: order.deliveryType || 'delivery',
        itemsSummary,
      };
      const next = [entry, ...existing].slice(0, 25);
      localStorage.setItem(STORAGE_KEY_GUEST_ORDERS, JSON.stringify(next));
    } catch {
      // Ignore storage quota or private mode errors
    }
  }

  public async trackGuestOrder(orderId: string, token: string): Promise<GuestTrackedOrderResponse> {
    const cleanId = encodeURIComponent(orderId.trim());
    const cleanTok = encodeURIComponent(token.trim());
    const res = await fetch(`/api/orders/track/${cleanId}?t=${cleanTok}`, {
      cache: 'no-store',
    });

    if (!res.ok) {
      let message = 'Pedido não encontrado.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      const err: any = new Error(message);
      err.status = res.status;
      throw err;
    }

    const data: GuestTrackedOrderResponse = await res.json();
    if (data?.order && token) {
      this.saveGuestOrderToStorage(data.order, token, data.order.trackingUrl);
    }
    return data;
  }

  public async getCustomerDeliveryQuote(
    subtotal?: number,
    neighborhood?: string,
    deliveryAreaId?: string
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
      if (deliveryAreaId && deliveryAreaId.trim()) {
        params.set('deliveryAreaId', deliveryAreaId.trim());
      }
      const qs = params.toString();
      const res = await fetch(`/api/customer/delivery-quote${qs ? `?${qs}` : ''}`, {
        headers: this.getCustomerHeaders(),
        cache: 'no-store',
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.warn('Erro ao consultar cotação de entrega:', err);
      return null;
    }
  }

  // ================= NOTIFICATIONS & ERRORS =================
  public notifyError(message: string) {
    console.error(`[Depósito API Error] ${message}`);
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('deposito_db_error', { detail: { message } }));
      } catch {}
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

  public subscribeAdminChanges(listener: (changes: AdminChangesResponse) => void): () => void {
    this.adminChangeListeners.push(listener);
    return () => {
      this.adminChangeListeners = this.adminChangeListeners.filter((l) => l !== listener);
    };
  }

  private notifyAdminChangeListeners(changes: AdminChangesResponse) {
    for (const fn of this.adminChangeListeners) {
      try {
        fn(changes);
      } catch (err) {
        console.error('Error notifying admin change listener:', err);
      }
    }
  }

  // ================= ORDER & STOCK POLLING =================
  private isDocumentVisible(): boolean {
    if (typeof document === 'undefined') return true;
    return document.visibilityState === 'visible';
  }

  public async checkAdminChanges(since?: string): Promise<AdminChangesResponse | null> {
    const token = this.getAdminToken();
    if (!token) return null;

    try {
      const qs = since ? `?since=${encodeURIComponent(since)}` : '';
      const res = await fetch(`/api/admin/changes${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (res.status === 401) {
        this.handleAdminSessionExpired();
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  private mergeFetchedOrders(fetchedOrders: Order[]) {
    if (!Array.isArray(fetchedOrders)) return;

    const existingIds = new Set(this.state.orders.map((o) => o.id));
    const hasNewPendingOrder = fetchedOrders.some(
      (fo) =>
        !existingIds.has(fo.id) &&
        fo.status === 'pendente' &&
        fo.source !== 'mesa' &&
        fo.source !== 'balcao'
    );

    if (hasNewPendingOrder) {
      void soundService.playNewOrderSound();
    }

    const byId = new Map<string, Order>();
    for (const o of this.state.orders) {
      byId.set(o.id, o);
    }
    for (const fo of fetchedOrders) {
      byId.set(fo.id, fo);
    }

    const cutoff48hMs = Date.now() - 48 * 60 * 60 * 1000;
    const merged = Array.from(byId.values()).filter((o) => {
      if (o.status === 'pendente' || o.status === 'em_separacao' || o.status === 'em_rota') {
        return true;
      }
      const createdMs = new Date(o.createdAt).getTime();
      return Number.isNaN(createdMs) || createdMs >= cutoff48hMs;
    });

    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this.state.orders = merged;
  }

  public async fetchUpdatedAdminOrders(since?: string): Promise<void> {
    const token = this.getAdminToken();
    if (!token) return;

    try {
      const qs = since ? `?since=${encodeURIComponent(since)}` : '';
      const ordersRes = await fetch(`/api/admin/orders${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });

      if (ordersRes.status === 401) {
        this.handleAdminSessionExpired();
        return;
      }

      if (ordersRes.ok) {
        const fetchedOrders: Order[] = await ordersRes.json();
        this.mergeFetchedOrders(fetchedOrders);
        this.notifyListeners();
      }
    } catch {
      // Ignore transient background errors
    }
  }

  private static readonly ACTIVE_POLL_INTERVAL_MS = 20000; // 20s active (180 req/h)
  private static readonly IDLE_POLL_INTERVAL_MS = 60000; // 60s idle after 10 min (60 req/h)
  private static readonly IDLE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  public async pollAdminChanges(): Promise<AdminChangesResponse | null> {
    const token = this.getAdminToken();
    if (!token) {
      this.stopOrderPolling();
      return null;
    }

    if (!this.isDocumentVisible()) {
      return null;
    }

    if (this.isPollingInFlight) {
      return null;
    }

    this.isPollingInFlight = true;
    this.lastPollCheckMs = Date.now();

    try {
      void this.checkAndRefreshAdminToken();

      const since =
        this.lastChangesSyncTime || this.lastOrdersSyncTime || this.lastProductsSyncTime || '';
      const changes = await this.checkAdminChanges(since);
      if (!changes) return null;

      const srvTime = changes.serverTime || new Date().toISOString();
      this.lastChangesSyncTime = srvTime;

      const tasks: Promise<any>[] = [];

      if (changes.ordersChanged) {
        const prevOrdersSince = this.lastOrdersSyncTime;
        this.lastOrdersSyncTime = srvTime;
        tasks.push(this.fetchUpdatedAdminOrders(prevOrdersSince));
      } else if (!this.lastOrdersSyncTime) {
        this.lastOrdersSyncTime = srvTime;
      }

      if (changes.productsChanged) {
        this.lastProductsSyncTime = srvTime;
        tasks.push(this.reloadProducts());
      } else if (!this.lastProductsSyncTime) {
        this.lastProductsSyncTime = srvTime;
      }

      if (tasks.length > 0) {
        await Promise.all(tasks);
      }

      this.notifyAdminChangeListeners(changes);
      return changes;
    } catch {
      return null;
    } finally {
      this.isPollingInFlight = false;
    }
  }

  private scheduleCentralClock(intervalMs: number) {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.currentPollIntervalMs = intervalMs;
    this.pollingInterval = setInterval(() => {
      if (!this.isAdminAuthenticated()) {
        this.stopOrderPolling();
        return;
      }
      const idleElapsedMs = Date.now() - this.lastUserInteractionMs;
      if (
        idleElapsedMs >= ApiService.IDLE_THRESHOLD_MS &&
        this.currentPollIntervalMs !== ApiService.IDLE_POLL_INTERVAL_MS
      ) {
        this.scheduleCentralClock(ApiService.IDLE_POLL_INTERVAL_MS);
      }
      if (this.isDocumentVisible()) {
        void this.pollAdminChanges();
      }
    }, intervalMs);
  }

  private startOrderPolling() {
    this.stopOrderPolling();
    if (!this.isAdminAuthenticated()) return;

    const now = Date.now();
    this.lastUserInteractionMs = now;
    this.lastPollCheckMs = now;
    void this.checkAndRefreshAdminToken();

    if (typeof document !== 'undefined') {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible' && this.isAdminAuthenticated()) {
          this.lastUserInteractionMs = Date.now();
          if (this.currentPollIntervalMs !== ApiService.ACTIVE_POLL_INTERVAL_MS) {
            this.scheduleCentralClock(ApiService.ACTIVE_POLL_INTERVAL_MS);
          }
          void this.pollAdminChanges();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }

    if (typeof window !== 'undefined') {
      this.interactionListener = () => {
        const ts = Date.now();
        this.lastUserInteractionMs = ts;
        if (
          this.currentPollIntervalMs !== ApiService.ACTIVE_POLL_INTERVAL_MS &&
          this.isAdminAuthenticated()
        ) {
          this.scheduleCentralClock(ApiService.ACTIVE_POLL_INTERVAL_MS);
          if (
            this.isDocumentVisible() &&
            ts - this.lastPollCheckMs >= ApiService.ACTIVE_POLL_INTERVAL_MS
          ) {
            void this.pollAdminChanges();
          }
        }
      };
      const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'] as const;
      for (const ev of events) {
        window.addEventListener(ev, this.interactionListener, { passive: true });
      }
    }

    // Single central clock: 20s while active, 60s after 10 min without interaction
    this.scheduleCentralClock(ApiService.ACTIVE_POLL_INTERVAL_MS);
  }

  private stopOrderPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.interactionListener && typeof window !== 'undefined') {
      const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointerdown'] as const;
      for (const ev of events) {
        window.removeEventListener(ev, this.interactionListener);
      }
      this.interactionListener = null;
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
          cache: 'no-store',
        });

        if (res.ok) {
          const data = await res.json();
          const srvTime = data.serverTime || new Date().toISOString();
          this.lastChangesSyncTime = srvTime;
          this.lastOrdersSyncTime = srvTime;
          this.lastProductsSyncTime = srvTime;
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
          console.warn('[Admin] Sessão expirada ou inválida. Retornando à tela de PIN.');
          this.handleAdminSessionExpired();
          return;
        }
      } catch (err) {
        console.warn('Erro ao buscar estado administrativo:', err);
      }
    }

    // Public state for store customer
    try {
      this.stopOrderPolling();
      const res = await fetch('/api/state', {
        cache: 'no-store',
      });
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
        this.adminSessionExpiredMessage = '';
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
    this.adminSessionExpiredMessage = '';
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
      const res = await fetch('/api/products', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      });
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

  public async importAdminProducts(
    rows: ProductImportItem[],
    duplicateMode: 'skip' | 'update'
  ): Promise<ProductImportResult> {
    const res = await fetch('/api/admin/products/import', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ rows, duplicateMode }),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível importar a planilha de produtos.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    const result: ProductImportResult = await res.json();
    await this.reloadProducts();
    return result;
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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

  public async saveProduct(
    product: Omit<Product, 'image'> & { image?: string | null }
  ): Promise<Product> {
    const isEdit = this.state.products.some((p) => p.id === product.id);
    const url = isEdit ? `/api/products/${product.id}` : '/api/products';
    const method = isEdit ? 'PUT' : 'POST';

    const payload: Record<string, any> = { ...product };
    if (isEdit) {
      if (
        payload.image === undefined ||
        (typeof payload.image === 'string' &&
          (payload.image.trim() === '' || payload.image.trim().startsWith('/api/products/')))
      ) {
        delete payload.image;
      }
    }

    const res = await fetch(url, {
      method,
      headers: this.getAdminHeaders(),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível salvar o produto no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const saved: Product = await res.json();
    await this.reloadProducts();
    return saved;
  }

  public async updateProductImage(
    productId: string,
    imageDataUrl: string | null
  ): Promise<{ id: string; imageUrl: string; updatedAt: string; decodedBytes: number; storageBytes: number }> {
    const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/image`, {
      method: 'PUT',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ image: imageDataUrl }),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível salvar a foto do produto.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    const result = await res.json();
    this.state.products = this.state.products.map((p) =>
      p.id === productId
        ? { ...p, image: '', imageUrl: result.imageUrl || '', updatedAt: result.updatedAt }
        : p
    );
    this.notifyListeners();
    return result;
  }

  public setLocalProductStock(productId: string, newStock: number): void {
    const cleanStock = Math.max(0, Math.floor(Number(newStock) || 0));
    const nextProducts = this.state.products.map((p) =>
      p.id === productId ? { ...p, stock: cleanStock } : p
    );
    this.state.products = nextProducts.map((p) => {
      if (isComboProduct(p.id, this.state.settings)) {
        const metrics = calculateComboMetrics(p, this.state.settings, nextProducts);
        return { ...p, stock: metrics.availableStock };
      }
      return p;
    });
    this.notifyListeners();
  }

  public async adjustProductStock(
    productId: string,
    payload: {
      mode: StockAdjustMode;
      value: number;
      reason?: StockAdjustReason;
      note?: string;
    }
  ): Promise<{ stock: number }> {
    const res = await fetch(`/api/admin/products/${encodeURIComponent(productId)}/stock`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível alterar o estoque.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    const data = await res.json();
    const updatedStock = Math.max(0, Math.floor(Number(data?.stock ?? 0)));
    this.setLocalProductStock(productId, updatedStock);
    return { stock: updatedStock };
  }

  public async adjustStock(productId: string, delta: number, unit: 'unit' | 'case' = 'unit'): Promise<void> {
    const prod = this.state.products.find((p) => p.id === productId);
    const mult = unit === 'case' && prod?.caseSize && prod.caseSize >= 2 ? Math.floor(prod.caseSize) : 1;
    await this.adjustProductStock(productId, {
      mode: 'delta',
      value: Math.round(delta * mult),
      reason: 'ajuste',
    });
  }

  public async getStockMovements(params: {
    productId?: string;
    reason?: string;
    direction?: 'in' | 'out' | '';
    from?: string;
    to?: string;
    limit?: number;
    before?: string;
  }): Promise<StockMovementsResponse> {
    const search = new URLSearchParams();
    if (params.productId) search.set('productId', params.productId);
    if (params.reason) search.set('reason', params.reason);
    if (params.direction) search.set('direction', params.direction);
    if (params.from) search.set('from', params.from);
    if (params.to) search.set('to', params.to);
    if (params.limit) search.set('limit', String(params.limit));
    if (params.before) search.set('before', params.before);

    const qs = search.toString();
    const res = await fetch(`/api/admin/stock-movements${qs ? `?${qs}` : ''}`, {
      headers: this.getAdminHeaders(),
      cache: 'no-store',
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível carregar o histórico de estoque.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }

    return await res.json();
  }

  public async deleteProduct(productId: string): Promise<void> {
    const res = await fetch(`/api/products/${productId}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível excluir o produto no banco de dados.';
      try {
        const json = await res.json();
        if (json?.error) message = `Não foi possível salvar no banco: ${json.error}`;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    if (this.state.settings.combos && productId in this.state.settings.combos) {
      const nextCombos = { ...this.state.settings.combos };
      delete nextCombos[productId];
      this.state.settings = { ...this.state.settings, combos: nextCombos };
    }
    this.state.products = this.state.products.filter((p) => p.id !== productId);
    await this.reloadProducts();
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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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
    newOrder: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { id?: string },
    options?: { onStatusMessage?: (msg: string) => void }
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

    const bodyPayload = JSON.stringify(newOrder);
    let createdOrder: Order | null = null;

    for (let attempt = 0; attempt <= ORDER_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          '/api/orders',
          {
            method: 'POST',
            headers,
            body: bodyPayload,
          },
          ORDER_SUBMIT_TIMEOUT_MS
        );

        if (res.status === 401 && newOrder.source === 'balcao') {
          this.handleAdminSessionExpired();
          const authErr: any = new Error('Sua sessão expirou. Digite o PIN novamente.');
          authErr.status = 401;
          authErr.isServerResponse = true;
          throw authErr;
        }

        if (!res.ok) {
          let message = 'Não foi possível realizar o pedido.';
          try {
            const json = await res.json();
            if (json?.error) message = json.error;
          } catch {}
          if (newOrder.source === 'balcao') {
            this.notifyError(message);
          }
          const serverErr: any = new Error(message);
          serverErr.status = res.status;
          serverErr.isServerResponse = true;
          throw serverErr;
        }

        const rawJson = await res.json();
        if (rawJson && typeof rawJson === 'object' && rawJson.order && typeof rawJson.order === 'object') {
          createdOrder = {
            ...rawJson.order,
            trackingUrl: rawJson.trackingUrl || rawJson.order.trackingUrl,
            guestToken: rawJson.guestToken || rawJson.order.guestToken,
          };
        } else {
          createdOrder = rawJson;
        }
        break;
      } catch (err: any) {
        if (!isNetworkOrTimeoutError(err)) {
          throw err;
        }

        if (attempt < ORDER_RETRY_DELAYS_MS.length) {
          options?.onStatusMessage?.(ORDER_CHECKING_STATUS_MESSAGE);
          await sleepMs(ORDER_RETRY_DELAYS_MS[attempt]);
          continue;
        }

        const exhaustedErr: any = new Error(ORDER_NETWORK_EXHAUSTED_MESSAGE);
        exhaustedErr.isNetworkError = true;
        exhaustedErr.isNetworkRetryExhausted = true;
        throw exhaustedErr;
      }
    }

    if (!createdOrder) {
      const exhaustedErr: any = new Error(ORDER_NETWORK_EXHAUSTED_MESSAGE);
      exhaustedErr.isNetworkError = true;
      exhaustedErr.isNetworkRetryExhausted = true;
      throw exhaustedErr;
    }

    if (createdOrder.guestToken) {
      this.saveGuestOrderToStorage(createdOrder, createdOrder.guestToken, createdOrder.trackingUrl);
    } else if (createdOrder.trackingUrl) {
      const matchTok = createdOrder.trackingUrl.match(/[?&]t=([a-f0-9]{32})/i);
      if (matchTok && matchTok[1]) {
        createdOrder.guestToken = matchTok[1];
        this.saveGuestOrderToStorage(createdOrder, matchTok[1], createdOrder.trackingUrl);
      }
    }

    if (this.isAdminAuthenticated()) {
      const existingIdx = this.state.orders.findIndex((o) => o.id === createdOrder!.id);
      if (existingIdx >= 0) {
        this.state.orders[existingIdx] = createdOrder;
      } else {
        this.state.orders.unshift(createdOrder);
      }
    }

    // Refresh products on server to sync atomic real-time stock
    await this.reloadProducts().catch(() => {});

    this.notifyListeners();
    return createdOrder;
  }

  public async updateOrderStatus(orderId: string, status: OrderStatus, notes?: string): Promise<void> {
    const payload: { status: OrderStatus; notes?: string } = { status };
    if (notes !== undefined) {
      payload.notes = notes;
    }
    const res = await fetch(`/api/orders/${orderId}/status`, {
      method: 'PATCH',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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
    await this.reloadProducts();
    this.notifyListeners();
  }

  // ================= COUPONS =================
  public getCoupons(): Coupon[] {
    return this.state.coupons;
  }

  public async validateCoupon(
    code: string,
    subtotal: number,
    items?: Array<{
      productId: string;
      quantity: number;
      saleUnit?: 'unit' | 'case';
      addons?: Array<{ groupId?: string; optionId?: string; quantity: number }>;
    }>
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
      cache: 'no-store',
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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

  public async updateSettings(settings: Partial<StoreSettings>): Promise<StoreSettings> {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(settings),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

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
    if ('combos' in settings) {
      await this.reloadProducts();
    }
    this.notifyListeners();
    return updated;
  }

  public async removeAdminCategory(
    id: string,
    moveTo?: string
  ): Promise<{ settings: StoreSettings; movedCount: number }> {
    const res = await fetch('/api/admin/categories/remove', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ id, moveTo }),
    });

    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }

    if (!res.ok) {
      let message = 'Não foi possível remover a categoria.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      this.notifyError(message);
      throw new Error(message);
    }

    const data: { settings: StoreSettings; movedCount: number } = await res.json();
    if (data?.settings) {
      this.state.settings = data.settings;
    }
    await this.reloadProducts();
    this.notifyListeners();
    return data;
  }

  // ================= MESAS E COMANDAS =================
  public async getAdminTables(): Promise<TableWithTab[]> {
    const res = await fetch('/api/admin/tables', {
      headers: this.getAdminHeaders(),
      cache: 'no-store',
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Erro ao carregar mesas.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async createAdminTable(data: { number: number; label?: string; seats?: number }): Promise<DiningTable> {
    const res = await fetch('/api/admin/tables', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível cadastrar a mesa.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async updateAdminTable(id: string, data: { number?: number; label?: string; seats?: number; active?: boolean }): Promise<DiningTable> {
    const res = await fetch(`/api/admin/tables/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível atualizar a mesa.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async deleteAdminTable(id: string): Promise<void> {
    const res = await fetch(`/api/admin/tables/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível remover a mesa.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
  }

  public async openTableTab(tableId: string, data: { customer_name?: string; people_count?: number; notes?: string }): Promise<TableTab> {
    const res = await fetch(`/api/admin/tables/${encodeURIComponent(tableId)}/open`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível abrir a comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async getTabDetail(tabId: string): Promise<TabDetail> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}`, {
      headers: this.getAdminHeaders(),
      cache: 'no-store',
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível carregar os detalhes da comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async updateTabInfo(tabId: string, data: { customer_name?: string; people_count?: number; notes?: string }): Promise<TableTab> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}`, {
      method: 'PATCH',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível atualizar as informações da comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async addTabItem(
    tabId: string,
    data: { product_id: string; quantity: number; sale_unit?: 'unit' | 'case'; notes?: string }
  ): Promise<{ itemId: string }> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/items`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível adicionar o produto à comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    const json = await res.json();
    await this.reloadProducts();
    return json;
  }

  public async cancelTabItem(tabId: string, itemId: string): Promise<void> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/items/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível cancelar o item da comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    await this.reloadProducts();
  }

  public async transferTabItem(tabId: string, itemId: string, toTabId: string): Promise<void> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/items/${encodeURIComponent(itemId)}/transfer`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ to_tab_id: toTabId }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível transferir o item.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
  }

  public async joinTableToTab(tabId: string, tableId: string): Promise<void> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/join`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ table_id: tableId }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível juntar a mesa à comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
  }

  public async unjoinTableFromTab(tabId: string, tableId: string): Promise<void> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/unjoin`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ table_id: tableId }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível separar a mesa da comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
  }

  public async moveTab(tabId: string, toTableId: string): Promise<void> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/move`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ to_table_id: toTableId }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível trocar a mesa.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
  }

  private async tryRecoverClosedTabOrder(
    tabId: string,
    data: {
      payment_method: PaymentMethod;
      service_fee_percent?: number;
      discount?: number;
      cash_change_for?: number;
      expected_subtotal?: number;
      notes?: string;
    }
  ): Promise<Order | null> {
    try {
      const fresh = await this.getTabDetail(tabId);
      if (!fresh || fresh.status !== 'closed') {
        return null;
      }

      await this.fetchUpdatedAdminOrders().catch(() => {});
      let foundOrder: Order | undefined = this.state.orders.find(
        (o) =>
          (fresh.orderId && o.id === fresh.orderId) ||
          o.clientRequestId === `tab:${tabId}`
      );

      if (!foundOrder) {
        const activeItems = (fresh.items || []).filter((i) => i.status === 'active');
        const sub = Number(fresh.subtotal) || 0;
        const feePct = Number(data.service_fee_percent ?? 0);
        const feeAmt = Math.round(sub * (feePct / 100) * 100) / 100;
        const disc = Number(data.discount ?? 0);
        const tot = Math.max(0, Math.round((sub + feeAmt - disc) * 100) / 100);
        const nowIso = fresh.closedAt || new Date().toISOString();
        const tableLabelText = fresh.tableLabel
          ? `Mesa ${fresh.tableNumber} (${fresh.tableLabel})`
          : `Mesa ${fresh.tableNumber}`;

        const fallbackOrder: Order = {
          id: fresh.orderId || `PED-${tabId.slice(0, 8).toUpperCase()}`,
          source: 'mesa',
          clientRequestId: `tab:${tabId}`,
          customer: {
            name: fresh.customerName || tableLabelText,
            phone: '(Mesa)',
            address: tableLabelText,
            number: String(fresh.tableNumber || 'S/N'),
            neighborhood: 'Consumo no Local',
          },
          deliveryType: 'local',
          items: activeItems.map((it) => ({
            productId: it.productId,
            name: it.productName,
            volume: '',
            price: it.unitPrice,
            originalPrice: it.unitPrice,
            costPrice: 0,
            quantity: it.quantity,
            saleUnit: it.saleUnit || 'unit',
            unitsPerSale: it.unitsPerSale || 1,
            isCold: true,
            comboItems: it.comboItems,
          })),
          subtotal: sub,
          discount: disc,
          deliveryFee: 0,
          total: tot,
          paymentMethod: data.payment_method,
          cashChangeFor: data.cash_change_for,
          status: 'concluido',
          createdAt: nowIso,
          updatedAt: nowIso,
          notes: data.notes || fresh.notes || undefined,
        };
        this.mergeFetchedOrders([fallbackOrder]);
        foundOrder = fallbackOrder;
      }

      await this.reloadProducts().catch(() => {});
      this.notifyListeners();
      return foundOrder;
    } catch {
      return null;
    }
  }

  public async closeTab(
    tabId: string,
    data: {
      payment_method: PaymentMethod;
      service_fee_percent?: number;
      discount?: number;
      cash_change_for?: number;
      expected_subtotal?: number;
      notes?: string;
    },
    options?: { onStatusMessage?: (msg: string) => void }
  ): Promise<{ order: Order }> {
    const bodyPayload = JSON.stringify(data);

    for (let attempt = 0; attempt <= ORDER_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const res = await fetchWithTimeout(
          `/api/admin/tabs/${encodeURIComponent(tabId)}/close`,
          {
            method: 'POST',
            headers: this.getAdminHeaders(),
            body: bodyPayload,
          },
          ORDER_SUBMIT_TIMEOUT_MS
        );

        if (res.status === 401) {
          this.handleAdminSessionExpired();
          const authErr: any = new Error('Sua sessão expirou. Digite o PIN novamente.');
          authErr.status = 401;
          authErr.isServerResponse = true;
          throw authErr;
        }

        if (!res.ok) {
          let message = 'Não foi possível fechar a comanda.';
          try {
            const json = await res.json();
            if (json?.error) message = json.error;
          } catch {}

          // Se a comanda já havia sido fechada na tentativa anterior cuja resposta caiu, recupera o pedido gerado
          if (res.status === 400 && message.toLowerCase().includes('não está aberta')) {
            const recovered = await this.tryRecoverClosedTabOrder(tabId, data);
            if (recovered) {
              return { order: recovered };
            }
          }

          const serverErr: any = new Error(message);
          serverErr.status = res.status;
          serverErr.isServerResponse = true;
          throw serverErr;
        }

        const json = await res.json();
        if (json?.order) {
          this.mergeFetchedOrders([json.order]);
        }
        await this.reloadProducts().catch(() => {});
        this.notifyListeners();
        return json;
      } catch (err: any) {
        if (!isNetworkOrTimeoutError(err)) {
          throw err;
        }

        options?.onStatusMessage?.(ORDER_CHECKING_STATUS_MESSAGE);

        const recoveredImmediate = await this.tryRecoverClosedTabOrder(tabId, data);
        if (recoveredImmediate) {
          return { order: recoveredImmediate };
        }

        if (attempt < ORDER_RETRY_DELAYS_MS.length) {
          await sleepMs(ORDER_RETRY_DELAYS_MS[attempt]);
          const recoveredAfterWait = await this.tryRecoverClosedTabOrder(tabId, data);
          if (recoveredAfterWait) {
            return { order: recoveredAfterWait };
          }
          continue;
        }

        const exhaustedErr: any = new Error(ORDER_NETWORK_EXHAUSTED_MESSAGE);
        exhaustedErr.isNetworkError = true;
        exhaustedErr.isNetworkRetryExhausted = true;
        throw exhaustedErr;
      }
    }

    const exhaustedErr: any = new Error(ORDER_NETWORK_EXHAUSTED_MESSAGE);
    exhaustedErr.isNetworkError = true;
    exhaustedErr.isNetworkRetryExhausted = true;
    throw exhaustedErr;
  }

  public async cancelTab(tabId: string, reason?: string): Promise<void> {
    const res = await fetch(`/api/admin/tabs/${encodeURIComponent(tabId)}/cancel`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ reason }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível cancelar a comanda.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    await this.reloadProducts();
    this.notifyListeners();
  }

  // ---------------------------------------------------------------------------
  // EXPEDIENTE (CASH SESSIONS) & PAYMENTS HISTORY
  // ---------------------------------------------------------------------------

  public async getCurrentCashSession(): Promise<{
    session: CashSession | null;
    openTablesCount: number;
    latestClosedSession: CashSession | null;
  }> {
    const res = await fetch('/api/admin/cash-sessions/current', {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível consultar o expediente atual.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async openCashSession(openingCash: number): Promise<{
    session: CashSession;
    settings?: StoreSettings;
  }> {
    const res = await fetch('/api/admin/cash-sessions/open', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({ openingCash }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(json?.error || 'Não foi possível abrir o expediente.');
      err.status = res.status;
      err.session = json?.session || null;
      throw err;
    }
    if (json?.settings) {
      this.state.settings = { ...this.state.settings, ...json.settings };
      this.notifyListeners();
    }
    return json;
  }

  public async closeCashSession(
    sessionId: string,
    data: { countedCash: number; notes?: string }
  ): Promise<{
    session: CashSession;
    settings?: StoreSettings;
  }> {
    const res = await fetch(`/api/admin/cash-sessions/${encodeURIComponent(sessionId)}/close`, {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify(data),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err: any = new Error(json?.error || 'Não foi possível fechar o expediente.');
      err.status = res.status;
      throw err;
    }
    if (json?.settings) {
      this.state.settings = { ...this.state.settings, ...json.settings };
      this.notifyListeners();
    }
    return json;
  }

  public async getCashSessions(limit = 30): Promise<CashSession[]> {
    const res = await fetch(`/api/admin/cash-sessions?limit=${encodeURIComponent(String(limit))}`, {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível listar os expedientes.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    const json = await res.json();
    return Array.isArray(json?.sessions) ? json.sessions : [];
  }

  public async getCashSummaryByRange(from: string, to: string): Promise<{
    summary: CashSessionSummary;
    fromIso: string;
    toIso: string;
  }> {
    const params = new URLSearchParams({ from, to });
    const res = await fetch(`/api/admin/cash-sessions/summary-by-range?${params.toString()}`, {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível calcular o resumo do período.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  public async getPaymentsHistory(params: {
    channels?: string[];
    paymentMethod?: string;
    showCancelled?: boolean;
    period?: 'session' | 'today' | '7d' | 'custom';
    sessionId?: string;
    from?: string;
    to?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<PaymentsHistoryResponse> {
    const qs = new URLSearchParams();
    if (params.channels && params.channels.length > 0) {
      qs.set('channels', params.channels.join(','));
    }
    if (params.paymentMethod) {
      qs.set('paymentMethod', params.paymentMethod);
    }
    if (params.showCancelled !== undefined) {
      qs.set('showCancelled', String(params.showCancelled));
    }
    if (params.period) {
      qs.set('period', params.period);
    }
    if (params.sessionId) {
      qs.set('sessionId', params.sessionId);
    }
    if (params.from) {
      qs.set('from', params.from);
    }
    if (params.to) {
      qs.set('to', params.to);
    }
    if (params.search) {
      qs.set('search', params.search);
    }
    if (params.limit) {
      qs.set('limit', String(params.limit));
    }
    if (params.offset !== undefined) {
      qs.set('offset', String(params.offset));
    }

    const res = await fetch(`/api/admin/payments-history?${qs.toString()}`, {
      headers: this.getAdminHeaders(),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let message = 'Não foi possível carregar o histórico de pagamentos.';
      try {
        const json = await res.json();
        if (json?.error) message = json.error;
      } catch {}
      throw new Error(message);
    }
    return await res.json();
  }

  async askAdminAssistant(
    message: string,
    history: AdminAssistantMessage[] = []
  ): Promise<AdminAssistantResponse> {
    const res = await fetch('/api/admin/assistant', {
      method: 'POST',
      headers: this.getAdminHeaders(),
      body: JSON.stringify({
        message,
        history: history.slice(-10).map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
        })),
      }),
    });
    if (res.status === 401) {
      this.handleAdminSessionExpired();
      throw new Error('Sua sessão expirou. Digite o PIN novamente.');
    }
    if (!res.ok) {
      let errMsg = 'Não foi possível consultar o Assistente IA agora.';
      try {
        const json = await res.json();
        if (json?.error) errMsg = json.error;
      } catch {}
      throw new Error(errMsg);
    }
    return await res.json();
  }
}

export const api = new ApiService();
