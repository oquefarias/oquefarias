import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Product, Order, StoreSettings, DeliveryArea, CustomerProfile } from '../types';

export const SUPABASE_SQL_SCHEMA = `-- =====================================================================
-- TABELAS DO DEPÓSITO DE BEBIDAS NO SUPABASE
-- Cole este script no SQL Editor do seu painel Supabase e clique em RUN
-- =====================================================================

-- 1. Tabela de Configurações da Loja
create table if not exists store_settings (
  id text primary key default 'default',
  data jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Tabela de Produtos do Estoque
create table if not exists products (
  id text primary key,
  name text not null,
  category text not null,
  volume text,
  price numeric not null,
  cost_price numeric default 0,
  stock integer not null default 0,
  min_stock integer default 10,
  is_cold boolean default true,
  image text,
  sku text,
  active boolean default true,
  description text default '',
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Tabela de Áreas e Taxas de Entrega
create table if not exists delivery_areas (
  id text primary key,
  name text not null,
  fee numeric not null default 0,
  estimated_time text default '30 a 45 min',
  active boolean default true,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. Tabela de Clientes Cadastrados
create table if not exists customers (
  id text primary key,
  name text not null,
  phone text not null,
  address text,
  number text,
  neighborhood text,
  complement text,
  reference text,
  total_orders_count integer default 0,
  total_spent numeric default 0,
  last_order_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 5. Tabela de Pedidos
create table if not exists orders (
  id text primary key,
  source text default 'online',
  status text not null default 'pendente',
  customer jsonb not null,
  delivery_type text not null default 'delivery',
  items jsonb not null,
  subtotal numeric not null,
  delivery_fee numeric default 0,
  total numeric not null,
  payment_method text not null,
  cash_change_for numeric,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 6. Tabela Coringa para sincronização de backup e compatibilidade
create table if not exists app_state (
  id text primary key,
  payload jsonb not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Ativar permissões públicas (Anon) para leitura e escrita pelo app
alter table store_settings enable row level security;
create policy if not exists "Permitir tudo store_settings" on store_settings for all using (true) with check (true);

alter table products enable row level security;
create policy if not exists "Permitir tudo products" on products for all using (true) with check (true);

alter table delivery_areas enable row level security;
create policy if not exists "Permitir tudo delivery_areas" on delivery_areas for all using (true) with check (true);

alter table customers enable row level security;
create policy if not exists "Permitir tudo customers" on customers for all using (true) with check (true);

alter table orders enable row level security;
create policy if not exists "Permitir tudo orders" on orders for all using (true) with check (true);

alter table app_state enable row level security;
create policy if not exists "Permitir tudo app_state" on app_state for all using (true) with check (true);
`;

class SupabaseService {
  private client: SupabaseClient | null = null;
  private currentUrl: string = '';
  private currentKey: string = '';

  constructor() {
    this.initFromEnvOrStorage();
  }

  public initFromEnvOrStorage(customUrl?: string, customKey?: string) {
    let url = customUrl;
    let key = customKey;

    if (!url || !key) {
      if (typeof window !== 'undefined') {
        try {
          const raw = localStorage.getItem('deposito_settings_v4');
          if (raw) {
            const parsed = JSON.parse(raw);
            url = url || parsed.supabaseUrl;
            key = key || parsed.supabaseAnonKey;
          }
        } catch {
          // ignore
        }
      }
    }

    if (!url || !key) {
      const envUrl = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_SUPABASE_URL || import.meta.env?.SUPABASE_URL)) ||
                     (typeof process !== 'undefined' && (process.env?.SUPABASE_URL || process.env?.VITE_SUPABASE_URL));
      const envKey = (typeof import.meta !== 'undefined' && (import.meta.env?.VITE_SUPABASE_ANON_KEY || import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env?.SUPABASE_PUBLISHABLE_KEY)) ||
                     (typeof process !== 'undefined' && (process.env?.SUPABASE_ANON_KEY || process.env?.SUPABASE_PUBLISHABLE_KEY || process.env?.VITE_SUPABASE_ANON_KEY));
      url = url || (typeof envUrl === 'string' && envUrl ? envUrl : 'https://daxtsgcjsyujykztxiox.supabase.co');
      key = key || (typeof envKey === 'string' && envKey ? envKey : 'sb_publishable_dFxrorp9joFJ8cpDkUfSrw_PcoUSuYN');
    }

    if (url && key && (url !== this.currentUrl || key !== this.currentKey)) {
      try {
        this.client = createClient(url.trim(), key.trim(), {
          auth: { persistSession: false },
        });
        this.currentUrl = url.trim();
        this.currentKey = key.trim();
      } catch (e) {
        console.warn('Erro ao inicializar Supabase client:', e);
        this.client = null;
      }
    }
  }

  public isConfigured(): boolean {
    return !!(this.client && this.currentUrl && this.currentKey);
  }

  public getCredentials(): { url: string; key: string } {
    return { url: this.currentUrl, key: this.currentKey };
  }

  public async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.client) {
      return { success: false, message: 'Supabase não configurado. Insira a URL e a Chave da API.' };
    }
    try {
      // Try querying or inserting a test ping
      const { error } = await this.client
        .from('app_state')
        .select('id')
        .limit(1);

      if (error && error.code !== 'PGRST116') {
        // If app_state doesn't exist yet, test with store_settings or generic rest
        const testRes = await this.client.from('store_settings').select('id').limit(1);
        if (testRes.error && testRes.error.code !== 'PGRST116') {
          return {
            success: true,
            message: `Conectado ao Supabase com sucesso! (Aviso: crie as tabelas com o botão 'Copiar SQL'). Detalhe: ${error.message || testRes.error.message}`,
          };
        }
      }
      return { success: true, message: 'Conectado com sucesso ao Supabase! Tabelas prontas.' };
    } catch (err: any) {
      return { success: false, message: `Falha na conexão: ${err?.message || err}` };
    }
  }

  // ================= UPSELL / SYNC ALL =================
  public async syncAllToSupabase(data: {
    products: Product[];
    orders: Order[];
    settings: StoreSettings;
    deliveryAreas: DeliveryArea[];
    customers: CustomerProfile[];
  }): Promise<{ success: boolean; message: string }> {
    if (!this.client) {
      return { success: false, message: 'Supabase não conectado.' };
    }

    try {
      // 1. Settings
      try {
        await this.client.from('store_settings').upsert({
          id: 'default',
          data: data.settings,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Sync store_settings failed:', e);
      }

      // 2. Delivery Areas
      if (data.deliveryAreas.length > 0) {
        try {
          await this.client.from('delivery_areas').upsert(
            data.deliveryAreas.map(a => ({
              id: a.id,
              name: a.name,
              fee: a.fee,
              estimated_time: a.estimatedTime,
              active: a.active,
              updated_at: new Date().toISOString(),
            }))
          );
        } catch (e) {
          console.warn('Sync delivery_areas failed:', e);
        }
      }

      // 3. Customers
      if (data.customers.length > 0) {
        try {
          await this.client.from('customers').upsert(
            data.customers.map(c => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              address: c.address,
              number: c.number,
              neighborhood: c.neighborhood,
              complement: c.complement || null,
              reference: c.reference || null,
              total_orders_count: c.totalOrdersCount || 0,
              total_spent: c.totalSpent || 0,
              last_order_at: c.lastOrderAt || null,
              created_at: c.createdAt || new Date().toISOString(),
            }))
          );
        } catch (e) {
          console.warn('Sync customers failed:', e);
        }
      }

      // 4. Products
      if (data.products.length > 0) {
        try {
          await this.client.from('products').upsert(
            data.products.map(p => ({
              id: p.id,
              name: p.name,
              category: p.category,
              volume: p.volume,
              price: p.price,
              cost_price: p.costPrice || 0,
              stock: p.stock,
              min_stock: p.minStock || 10,
              is_cold: p.isCold ?? true,
              image: p.image || '',
              sku: p.sku || '',
              active: p.active ?? true,
              description: p.description || '',
              updated_at: new Date().toISOString(),
            }))
          );
        } catch (e) {
          console.warn('Sync products failed:', e);
        }
      }

      // 5. Orders
      if (data.orders.length > 0) {
        try {
          await this.client.from('orders').upsert(
            data.orders.map(o => ({
              id: o.id,
              source: o.source,
              status: o.status,
              customer: o.customer,
              delivery_type: o.deliveryType,
              items: o.items,
              subtotal: o.subtotal,
              delivery_fee: o.deliveryFee,
              total: o.total,
              payment_method: o.paymentMethod,
              cash_change_for: o.cashChangeFor || null,
              notes: o.notes || null,
              created_at: o.createdAt,
              updated_at: o.updatedAt,
            }))
          );
        } catch (e) {
          console.warn('Sync orders failed:', e);
        }
      }

      // 6. Complete state backup in app_state table for fallback safety
      try {
        await this.client.from('app_state').upsert({
          id: 'store_data',
          payload: data,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Sync app_state fallback failed:', e);
      }

      return { success: true, message: 'Dados sincronizados com o Supabase com sucesso!' };
    } catch (err: any) {
      return { success: false, message: `Erro ao sincronizar: ${err?.message || err}` };
    }
  }

  // ================= SAVE SINGLE ENTITIES =================
  public async saveCustomer(cust: CustomerProfile): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('customers').upsert({
        id: cust.id,
        name: cust.name,
        phone: cust.phone,
        address: cust.address,
        number: cust.number,
        neighborhood: cust.neighborhood,
        complement: cust.complement || null,
        reference: cust.reference || null,
        total_orders_count: cust.totalOrdersCount || 0,
        total_spent: cust.totalSpent || 0,
        last_order_at: cust.lastOrderAt || null,
        created_at: cust.createdAt || new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Supabase saveCustomer error:', e);
    }
  }

  public async saveOrder(order: Order): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('orders').upsert({
        id: order.id,
        source: order.source,
        status: order.status,
        customer: order.customer,
        delivery_type: order.deliveryType,
        items: order.items,
        subtotal: order.subtotal,
        delivery_fee: order.deliveryFee,
        total: order.total,
        payment_method: order.paymentMethod,
        cash_change_for: order.cashChangeFor || null,
        notes: order.notes || null,
        created_at: order.createdAt,
        updated_at: order.updatedAt,
      });
    } catch (e) {
      console.warn('Supabase saveOrder error:', e);
    }
  }

  public async updateOrderStatus(orderId: string, status: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('orders').update({
        status,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);
    } catch (e) {
      console.warn('Supabase updateOrderStatus error:', e);
    }
  }

  public async saveSettings(settings: StoreSettings): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('store_settings').upsert({
        id: 'default',
        data: settings,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Supabase saveSettings error:', e);
    }
  }

  public async saveProduct(product: Product): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('products').upsert({
        id: product.id,
        name: product.name,
        category: product.category,
        volume: product.volume,
        price: product.price,
        cost_price: product.costPrice || 0,
        stock: product.stock,
        min_stock: product.minStock || 10,
        is_cold: product.isCold ?? true,
        image: product.image || '',
        sku: product.sku || '',
        active: product.active ?? true,
        description: product.description || '',
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Supabase saveProduct error:', e);
    }
  }

  public async deleteProduct(productId: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('products').delete().eq('id', productId);
    } catch (e) {
      console.warn('Supabase deleteProduct error:', e);
    }
  }

  public async saveDeliveryArea(area: DeliveryArea): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('delivery_areas').upsert({
        id: area.id,
        name: area.name,
        fee: area.fee,
        estimated_time: area.estimatedTime,
        active: area.active,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('Supabase saveDeliveryArea error:', e);
    }
  }

  public async deleteDeliveryArea(areaId: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.from('delivery_areas').delete().eq('id', areaId);
    } catch (e) {
      console.warn('Supabase deleteDeliveryArea error:', e);
    }
  }

  // ================= LOAD FROM SUPABASE =================
  public async loadAllFromSupabase(): Promise<{
    products?: Product[];
    orders?: Order[];
    settings?: StoreSettings;
    deliveryAreas?: DeliveryArea[];
    customers?: CustomerProfile[];
  } | null> {
    if (!this.client) return null;
    try {
      const results: any = {};

      // Load Settings
      try {
        const { data: sData } = await this.client.from('store_settings').select('data').eq('id', 'default').single();
        if (sData?.data) results.settings = sData.data;
      } catch {
        // ignore
      }

      // Load Delivery Areas
      try {
        const { data: aData } = await this.client.from('delivery_areas').select('*');
        if (aData && aData.length >= 0) {
          results.deliveryAreas = aData.map((a: any) => ({
            id: a.id,
            name: a.name,
            fee: Number(a.fee),
            estimatedTime: a.estimated_time || '30 a 45 min',
            active: a.active ?? true,
          }));
        }
      } catch {
        // ignore
      }

      // Load Customers
      try {
        const { data: cData } = await this.client.from('customers').select('*');
        if (cData) {
          results.customers = cData.map((c: any) => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            address: c.address || '',
            number: c.number || '',
            neighborhood: c.neighborhood || '',
            complement: c.complement || undefined,
            reference: c.reference || undefined,
            totalOrdersCount: c.total_orders_count || 0,
            totalSpent: Number(c.total_spent) || 0,
            lastOrderAt: c.last_order_at || undefined,
            createdAt: c.created_at || new Date().toISOString(),
          }));
        }
      } catch {
        // ignore
      }

      // Load Products
      try {
        const { data: pData } = await this.client.from('products').select('*');
        if (pData) {
          results.products = pData.map((p: any) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            volume: p.volume || '',
            price: Number(p.price),
            costPrice: Number(p.cost_price) || 0,
            stock: Number(p.stock) || 0,
            minStock: Number(p.min_stock) || 10,
            isCold: p.is_cold ?? true,
            image: p.image || '',
            sku: p.sku || '',
            active: p.active ?? true,
            description: p.description || '',
          }));
        }
      } catch {
        // ignore
      }

      // Load Orders
      try {
        const { data: oData } = await this.client.from('orders').select('*');
        if (oData) {
          results.orders = oData.map((o: any) => ({
            id: o.id,
            source: o.source || 'online',
            status: o.status,
            customer: o.customer,
            deliveryType: o.delivery_type || 'delivery',
            items: o.items || [],
            subtotal: Number(o.subtotal),
            deliveryFee: Number(o.delivery_fee) || 0,
            total: Number(o.total),
            paymentMethod: o.payment_method,
            cashChangeFor: o.cash_change_for ? Number(o.cash_change_for) : undefined,
            notes: o.notes || undefined,
            createdAt: o.created_at,
            updatedAt: o.updated_at,
          }));
        }
      } catch {
        // ignore
      }

      return results;
    } catch (e) {
      console.warn('Failed to load from Supabase:', e);
      return null;
    }
  }
}

export const supabaseService = new SupabaseService();
