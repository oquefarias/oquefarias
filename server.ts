import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  initialProducts,
  initialOrders,
  initialSettings,
  initialDeliveryAreas,
  initialCustomers,
} from './src/data/initialData.ts';
import {
  Product,
  Order,
  StoreSettings,
  DeliveryArea,
  CustomerProfile,
  OrderStatus,
} from './src/types/index.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_CACHE_FILE = path.resolve(DATA_DIR, 'db.json');

// In-Memory Database Schema
interface DatabaseSchema {
  products: Product[];
  orders: Order[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  customers: CustomerProfile[];
}

// -----------------------------------------------------------------------------
// 1. SUPABASE CLIENT
// Configured STRICTLY via environment variables: SUPABASE_URL and SUPABASE_SECRET_KEY
// Never read from store settings. Never uses hardcoded URLs or keys.
// -----------------------------------------------------------------------------
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();

let supabase: SupabaseClient | null = null;
if (supabaseUrl && supabaseSecretKey) {
  try {
    supabase = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false },
    });
    console.log('[Supabase] Cliente inicializado com sucesso via chave secreta (service_role).');
  } catch (err) {
    console.error('[Supabase Error] Falha ao inicializar cliente Supabase:', err);
  }
} else {
  console.warn(
    '[Supabase Warning] SUPABASE_URL ou SUPABASE_SECRET_KEY não configurados no ambiente. Operações que exigem banco responderão HTTP 500 até a configuração ser preenchida.'
  );
}

// -----------------------------------------------------------------------------
// 2. COLUMN MAPPINGS (camelCase <-> snake_case)
// -----------------------------------------------------------------------------
function productToDB(p: Product) {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    volume: p.volume || null,
    price: Number(p.price) || 0,
    cost_price: Number(p.costPrice) || 0,
    stock: Number(p.stock) || 0,
    min_stock: Number(p.minStock ?? 10),
    is_cold: p.isCold !== false,
    image: p.image || null,
    sku: p.sku || null,
    active: p.active !== false,
    description: p.description || '',
    updated_at: new Date().toISOString(),
  };
}

function productFromDB(row: any): Product {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    category: row.category as any,
    volume: row.volume || '',
    price: Number(row.price || 0),
    costPrice: Number(row.cost_price || 0),
    stock: Number(row.stock || 0),
    minStock: row.min_stock !== null && row.min_stock !== undefined ? Number(row.min_stock) : 10,
    isCold: row.is_cold ?? true,
    image: row.image || '',
    sku: row.sku || '',
    active: row.active ?? true,
    description: row.description || '',
  };
}

function deliveryAreaToDB(a: DeliveryArea) {
  return {
    id: a.id,
    name: a.name,
    fee: Number(a.fee) || 0,
    estimated_time: a.estimatedTime || '30 a 45 min',
    active: a.active !== false,
    updated_at: new Date().toISOString(),
  };
}

function deliveryAreaFromDB(row: any): DeliveryArea {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    fee: Number(row.fee || 0),
    estimatedTime: row.estimated_time || '30 a 45 min',
    active: row.active ?? true,
  };
}

function customerToDB(c: CustomerProfile) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    address: c.address || null,
    number: c.number || null,
    neighborhood: c.neighborhood || null,
    complement: c.complement || null,
    reference: c.reference || null,
    cep: c.cep || null,
    city: c.city || null,
    state: c.state || null,
    latitude: c.latitude !== undefined && c.latitude !== null ? Number(c.latitude) : null,
    longitude: c.longitude !== undefined && c.longitude !== null ? Number(c.longitude) : null,
    distance_km: c.distanceKm !== undefined && c.distanceKm !== null ? Number(c.distanceKm) : null,
    is_within_delivery_radius:
      c.isWithinDeliveryRadius !== undefined && c.isWithinDeliveryRadius !== null
        ? Boolean(c.isWithinDeliveryRadius)
        : null,
    total_orders_count: Number(c.totalOrdersCount || 0),
    total_spent: Number(c.totalSpent || 0),
    last_order_at: c.lastOrderAt || null,
    created_at: c.createdAt || new Date().toISOString(),
  };
}

function customerFromDB(row: any): CustomerProfile {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    phone: String(row.phone || ''),
    address: row.address || '',
    number: row.number || '',
    neighborhood: row.neighborhood || '',
    complement: row.complement || '',
    reference: row.reference || '',
    cep: row.cep || undefined,
    city: row.city || undefined,
    state: row.state || undefined,
    latitude: row.latitude !== null && row.latitude !== undefined ? Number(row.latitude) : undefined,
    longitude: row.longitude !== null && row.longitude !== undefined ? Number(row.longitude) : undefined,
    distanceKm: row.distance_km !== null && row.distance_km !== undefined ? Number(row.distance_km) : undefined,
    isWithinDeliveryRadius:
      row.is_within_delivery_radius !== null && row.is_within_delivery_radius !== undefined
        ? Boolean(row.is_within_delivery_radius)
        : undefined,
    totalOrdersCount: Number(row.total_orders_count || 0),
    totalSpent: Number(row.total_spent || 0),
    lastOrderAt: row.last_order_at || undefined,
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function orderToDB(o: Order) {
  return {
    id: o.id,
    source: o.source || 'online',
    status: o.status || 'pendente',
    customer: o.customer, // jsonb
    delivery_type: o.deliveryType || 'delivery',
    items: o.items, // jsonb
    subtotal: Number(o.subtotal) || 0,
    delivery_fee: Number(o.deliveryFee) || 0,
    total: Number(o.total) || 0,
    payment_method: o.paymentMethod || 'pix',
    cash_change_for: o.cashChangeFor !== undefined && o.cashChangeFor !== null ? Number(o.cashChangeFor) : null,
    notes: o.notes || null,
    created_at: o.createdAt || new Date().toISOString(),
    updated_at: o.updatedAt || new Date().toISOString(),
  };
}

function orderFromDB(row: any): Order {
  return {
    id: String(row.id),
    source: row.source || 'online',
    status: (row.status as OrderStatus) || 'pendente',
    customer: row.customer || {},
    deliveryType: row.delivery_type || 'delivery',
    items: Array.isArray(row.items) ? row.items : [],
    subtotal: Number(row.subtotal || 0),
    deliveryFee: Number(row.delivery_fee || 0),
    total: Number(row.total || 0),
    paymentMethod: row.payment_method || 'pix',
    cashChangeFor:
      row.cash_change_for !== null && row.cash_change_for !== undefined
        ? Number(row.cash_change_for)
        : undefined,
    notes: row.notes || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

function sanitizePublicSettings(settings: StoreSettings): StoreSettings {
  const clean = { ...settings };
  delete (clean as any).adminPin;
  delete (clean as any).supabaseUrl;
  delete (clean as any).supabaseAnonKey;
  delete (clean as any).supabaseSecretKey;
  return clean;
}

// -----------------------------------------------------------------------------
// 3. STARTUP DATA LOADING & SEEDING FROM SUPABASE
// -----------------------------------------------------------------------------
let db: DatabaseSchema = {
  products: initialProducts,
  orders: initialOrders,
  settings: sanitizePublicSettings(initialSettings),
  deliveryAreas: initialDeliveryAreas,
  customers: initialCustomers,
};

function saveOptionalCache(data: DatabaseSchema) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[Cache] Aviso ao gravar cache opcional local (db.json):', e);
  }
}

function loadOptionalCache(): DatabaseSchema | null {
  try {
    if (fs.existsSync(DATA_CACHE_FILE)) {
      const raw = fs.readFileSync(DATA_CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.products)) {
        return parsed;
      }
    }
  } catch {
    // Ignored
  }
  return null;
}

async function initializeDatabaseFromSupabase(): Promise<void> {
  if (!supabase) {
    console.warn('[Startup] Supabase não configurado. Utilizando cache opcional local (db.json) / dados iniciais.');
    const cached = loadOptionalCache();
    if (cached) {
      db = cached;
    }
    return;
  }

  console.log('[Startup] Carregando tabelas do Supabase para memória...');
  try {
    // 1. Settings (table store_settings, row id 'default', column data jsonb)
    let loadedSettings = sanitizePublicSettings(initialSettings);
    const { data: settingsRow, error: settingsErr } = await supabase
      .from('store_settings')
      .select('data')
      .eq('id', 'default')
      .maybeSingle();

    if (settingsErr) {
      console.error('[Startup Error] Falha ao carregar store_settings do Supabase:', settingsErr.message);
    } else if (settingsRow && settingsRow.data) {
      loadedSettings = sanitizePublicSettings(settingsRow.data);
    } else {
      console.log('[Startup] Semeando store_settings no Supabase...');
      const { error: seedSettingsErr } = await supabase.from('store_settings').upsert({
        id: 'default',
        data: sanitizePublicSettings(initialSettings),
        updated_at: new Date().toISOString(),
      });
      if (seedSettingsErr) {
        console.error('[Startup Error] Erro ao semear store_settings:', seedSettingsErr.message);
      }
    }

    // 2. Products
    let loadedProducts: Product[] = [];
    const { data: productsRows, error: prodErr } = await supabase.from('products').select('*');
    if (prodErr) {
      console.error('[Startup Error] Falha ao carregar products do Supabase:', prodErr.message);
    } else if (productsRows && productsRows.length > 0) {
      loadedProducts = productsRows.map(productFromDB);
    } else if (initialProducts.length > 0) {
      console.log('[Startup] Semeando products no Supabase...');
      const { error: seedProdErr } = await supabase.from('products').upsert(initialProducts.map(productToDB));
      if (seedProdErr) {
        console.error('[Startup Error] Erro ao semear products:', seedProdErr.message);
      }
      loadedProducts = [...initialProducts];
    }

    // 3. Delivery Areas
    let loadedAreas: DeliveryArea[] = [];
    const { data: areasRows, error: areasErr } = await supabase.from('delivery_areas').select('*');
    if (areasErr) {
      console.error('[Startup Error] Falha ao carregar delivery_areas do Supabase:', areasErr.message);
    } else if (areasRows && areasRows.length > 0) {
      loadedAreas = areasRows.map(deliveryAreaFromDB);
    } else if (initialDeliveryAreas.length > 0) {
      console.log('[Startup] Semeando delivery_areas no Supabase...');
      const { error: seedAreasErr } = await supabase.from('delivery_areas').upsert(initialDeliveryAreas.map(deliveryAreaToDB));
      if (seedAreasErr) {
        console.error('[Startup Error] Erro ao semear delivery_areas:', seedAreasErr.message);
      }
      loadedAreas = [...initialDeliveryAreas];
    }

    // 4. Customers
    let loadedCustomers: CustomerProfile[] = [];
    const { data: custRows, error: custErr } = await supabase.from('customers').select('*');
    if (custErr) {
      console.error('[Startup Error] Falha ao carregar customers do Supabase:', custErr.message);
    } else if (custRows && custRows.length > 0) {
      loadedCustomers = custRows.map(customerFromDB);
    } else if (initialCustomers.length > 0) {
      console.log('[Startup] Semeando customers no Supabase...');
      const { error: seedCustErr } = await supabase.from('customers').upsert(initialCustomers.map(customerToDB));
      if (seedCustErr) {
        console.error('[Startup Error] Erro ao semear customers:', seedCustErr.message);
      }
      loadedCustomers = [...initialCustomers];
    }

    // 5. Orders
    let loadedOrders: Order[] = [];
    const { data: orderRows, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });
    if (orderErr) {
      console.error('[Startup Error] Falha ao carregar orders do Supabase:', orderErr.message);
    } else if (orderRows && orderRows.length > 0) {
      loadedOrders = orderRows.map(orderFromDB);
    } else if (initialOrders.length > 0) {
      console.log('[Startup] Semeando orders no Supabase...');
      const { error: seedOrdersErr } = await supabase.from('orders').upsert(initialOrders.map(orderToDB));
      if (seedOrdersErr) {
        console.error('[Startup Error] Erro ao semear orders:', seedOrdersErr.message);
      }
      loadedOrders = [...initialOrders];
    }

    db = {
      products: loadedProducts,
      orders: loadedOrders,
      settings: loadedSettings,
      deliveryAreas: loadedAreas,
      customers: loadedCustomers,
    };

    saveOptionalCache(db);
    console.log(
      `[Startup] Carregado do Supabase com sucesso: ${db.products.length} produtos, ${db.deliveryAreas.length} áreas, ${db.customers.length} clientes, ${db.orders.length} pedidos.`
    );
  } catch (err) {
    console.error('[Startup Fatal Error] Erro durante inicialização com Supabase:', err);
    const cached = loadOptionalCache();
    if (cached) {
      db = cached;
    }
  }
}

// -----------------------------------------------------------------------------
// 4. ADMIN AUTHENTICATION SESSIONS (12 hours validity, crypto.randomUUID)
// -----------------------------------------------------------------------------
const adminSessions = new Map<string, number>(); // token -> expiresAt

function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, exp] of adminSessions.entries()) {
    if (now > exp) {
      adminSessions.delete(token);
    }
  }
}

setInterval(cleanExpiredSessions, 15 * 60 * 1000);

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Não autorizado. Autentique-se com o PIN de administrador.' });
  }

  const expiresAt = adminSessions.get(token);
  if (!expiresAt || Date.now() > expiresAt) {
    if (expiresAt) adminSessions.delete(token);
    return res.status(401).json({ error: 'Sessão de administrador expirada ou inválida.' });
  }

  next();
}

// -----------------------------------------------------------------------------
// 5. SSE CLIENTS FOR REAL-TIME ORDER ALERTS (Restricted to authenticated admin)
// -----------------------------------------------------------------------------
const sseClients = new Set<express.Response>();

function broadcastSSE(type: string, payload?: unknown) {
  const message = `data: ${JSON.stringify({ type, payload })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

// -----------------------------------------------------------------------------
// 6. SERVER SETUP & API ROUTES
// -----------------------------------------------------------------------------
async function startServer() {
  await initializeDatabaseFromSupabase();

  const app = express();
  app.use(express.json());

  // ---------------------------------------------------------------------------
  // AUTH: VERIFY ADMIN PIN
  // ---------------------------------------------------------------------------
// TEMPORARIO (diagnostico do PIN) - remover depois. Nao revela o PIN, so o formato.
app.get('/api/_diag-pin', (_req, res) => {
  const raw = process.env.ADMIN_PIN;
  const s = raw === undefined ? '' : String(raw);
  res.json({
    definido: raw !== undefined,
    tamanho: s.length,
    tamanhoSemEspacos: s.trim().length,
    soDigitos: /^\d+$/.test(s.trim()),
    temAspas: /["']/.test(s),
    temEspacoOuQuebra: /\s/.test(s),
  });
});

  app.post('/api/admin/verify-pin', (req, res) => {
    const { pin } = req.body || {};
    const configuredPin = process.env.ADMIN_PIN;

    if (!configuredPin) {
      console.error('[Auth Error] ADMIN_PIN não está definido nas variáveis de ambiente!');
      return res.status(500).json({ error: 'ADMIN_PIN não configurado no servidor.' });
    }

    if (!pin || String(pin).trim() !== String(configuredPin).trim()) {
      return res.status(401).json({ error: 'PIN de acesso incorreto.' });
    }

    // Generate random UUID token with 12h validity
    const token = crypto.randomUUID();
    const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
    adminSessions.set(token, expiresAt);

    return res.json({
      success: true,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });

  // ---------------------------------------------------------------------------
  // SSE REAL-TIME NOTIFICATIONS (Requires Admin Token via Header or Query ?token=)
  // ---------------------------------------------------------------------------
  app.get('/api/events', (req, res) => {
    const queryToken = typeof req.query.token === 'string' ? req.query.token.trim() : null;
    const headerToken = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim()
      : null;
    const token = queryToken || headerToken;

    if (!token) {
      return res.status(401).json({ error: 'Token de administrador ausente para conexão SSE.' });
    }

    const expiresAt = adminSessions.get(token);
    if (!expiresAt || Date.now() > expiresAt) {
      return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // ---------------------------------------------------------------------------
  // STATE ROUTES:
  // Public: GET /api/state (Active products, active areas, public settings - NO adminPin, NO Supabase info, NO orders, NO customers)
  // Admin:  GET /api/admin/state (Complete state, requires Bearer token)
  // ---------------------------------------------------------------------------
  app.get('/api/state', (_req, res) => {
    res.json({
      products: db.products.filter((p) => p.active),
      deliveryAreas: db.deliveryAreas.filter((a) => a.active),
      settings: sanitizePublicSettings(db.settings),
    });
  });

  app.get('/api/admin/state', requireAdmin, (_req, res) => {
    res.json({
      products: db.products,
      orders: db.orders,
      deliveryAreas: db.deliveryAreas,
      customers: db.customers,
      settings: sanitizePublicSettings(db.settings),
    });
  });

  // ---------------------------------------------------------------------------
  // PRODUCTS ROUTES
  // GET /api/products -> Public (active products only)
  // POST /api/products -> Admin only
  // PUT /api/products/:id -> Admin only
  // POST /api/products/:id/stock -> Admin only
  // DELETE /api/products/:id -> Admin only
  // ---------------------------------------------------------------------------
  app.get('/api/products', (_req, res) => {
    res.json(db.products.filter((p) => p.active));
  });

  app.post('/api/products', requireAdmin, async (req, res) => {
    const product = req.body as Product;
    if (!product || !product.id || !product.name) {
      return res.status(400).json({ error: 'Dados do produto inválidos.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('products').upsert(productToDB(product));
    if (error) {
      console.error('[Supabase Error] products upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.products.unshift(product);
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'PRODUCT_CREATED', product });
    res.status(201).json(product);
  });

  app.put('/api/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const index = db.products.findIndex((p) => p.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const updated: Product = { ...db.products[index], ...req.body, id };

    const { error } = await supabase.from('products').upsert(productToDB(updated));
    if (error) {
      console.error('[Supabase Error] products update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.products[index] = updated;
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'PRODUCT_UPDATED', product: updated });
    res.json(updated);
  });

  app.post('/api/products/:id/stock', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { delta } = req.body || {};
    const product = db.products.find((p) => p.id === id);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const newStock = Math.max(0, product.stock + (Number(delta) || 0));
    const updatedProd: Product = { ...product, stock: newStock };

    const { error } = await supabase.from('products').upsert(productToDB(updatedProd));
    if (error) {
      console.error('[Supabase Error] stock update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    product.stock = newStock;
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'STOCK_UPDATED', product });
    res.json(product);
  });

  app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] products delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.products = db.products.filter((p) => p.id !== id);
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'PRODUCT_DELETED', id });
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // DELIVERY AREAS ROUTES
  // GET /api/delivery-areas -> Public (active delivery areas)
  // POST /api/delivery-areas -> Admin only
  // PUT /api/delivery-areas/:id -> Admin only
  // DELETE /api/delivery-areas/:id -> Admin only
  // ---------------------------------------------------------------------------
  app.get('/api/delivery-areas', (_req, res) => {
    res.json(db.deliveryAreas.filter((a) => a.active));
  });

  app.post('/api/delivery-areas', requireAdmin, async (req, res) => {
    const area = req.body as DeliveryArea;
    if (!area || !area.id || !area.name) {
      return res.status(400).json({ error: 'Dados da área inválidos.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('delivery_areas').upsert(deliveryAreaToDB(area));
    if (error) {
      console.error('[Supabase Error] delivery_areas upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.deliveryAreas.push(area);
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'AREA_CREATED', area });
    res.status(201).json(area);
  });

  app.put('/api/delivery-areas/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const idx = db.deliveryAreas.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Área não encontrada.' });

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const updated: DeliveryArea = { ...db.deliveryAreas[idx], ...req.body, id };

    const { error } = await supabase.from('delivery_areas').upsert(deliveryAreaToDB(updated));
    if (error) {
      console.error('[Supabase Error] delivery_areas update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.deliveryAreas[idx] = updated;
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'AREA_UPDATED', area: updated });
    res.json(updated);
  });

  app.delete('/api/delivery-areas/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('delivery_areas').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] delivery_areas delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.deliveryAreas = db.deliveryAreas.filter((a) => a.id !== id);
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'AREA_DELETED', id });
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // CUSTOMERS ROUTES
  // GET /api/customers -> Admin only (never exposes full customer list publicly)
  // GET /api/customers/by-phone/:phone -> Public lookup for the single exact phone record
  // POST /api/customers -> Public / Admin profile registration
  // DELETE /api/customers/:id -> Admin only
  // ---------------------------------------------------------------------------
  app.get('/api/customers', requireAdmin, (_req, res) => {
    res.json(db.customers);
  });

  app.get('/api/customers/by-phone/:phone', (req, res) => {
    const cleanPhone = req.params.phone.replace(/\D/g, '');
    if (!cleanPhone) {
      return res.status(400).json({ error: 'Telefone inválido.' });
    }
    const found = db.customers.find((c) => c.phone.replace(/\D/g, '') === cleanPhone);
    if (!found) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }
    // Return exclusively this individual customer's record
    res.json(found);
  });

  app.post('/api/customers', async (req, res) => {
    const cust = req.body as CustomerProfile;
    if (!cust || !cust.phone || !cust.name) {
      return res.status(400).json({ error: 'Nome e telefone do cliente são obrigatórios.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const cleanPhone = cust.phone.replace(/\D/g, '');
    const existingIndex = db.customers.findIndex((c) => c.phone.replace(/\D/g, '') === cleanPhone);

    let savedCust: CustomerProfile;
    if (existingIndex >= 0) {
      savedCust = { ...db.customers[existingIndex], ...cust };
    } else {
      savedCust = {
        ...cust,
        id: cust.id || `cust-${Date.now()}`,
        createdAt: new Date().toISOString(),
        totalOrdersCount: 0,
        totalSpent: 0,
      };
    }

    const { error } = await supabase.from('customers').upsert(customerToDB(savedCust));
    if (error) {
      console.error('[Supabase Error] customers upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (existingIndex >= 0) {
      db.customers[existingIndex] = savedCust;
    } else {
      db.customers.unshift(savedCust);
    }

    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'CUSTOMER_SAVED', customer: savedCust });
    res.json(savedCust);
  });

  app.delete('/api/customers/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] customers delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.customers = db.customers.filter((c) => c.id !== id);
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'CUSTOMER_DELETED', id });
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // ORDERS ROUTES
  // POST /api/orders (Public): Server RECALCULATES all prices, subtotal, fees, and totals
  //                           from the database products, checks stock, decrements stock in DB,
  //                           and forces status 'pendente'.
  // GET /api/orders/:id (Public): Returns status of single order.
  // PATCH /api/orders/:id/status (Admin only)
  // DELETE /api/orders/:id (Admin only)
  // ---------------------------------------------------------------------------
  app.post('/api/orders', async (req, res) => {
    const rawOrder = req.body;
    if (!rawOrder || !rawOrder.items || !Array.isArray(rawOrder.items) || rawOrder.items.length === 0) {
      return res.status(400).json({ error: 'O pedido deve conter pelo menos um item.' });
    }

    if (!rawOrder.customer || !rawOrder.customer.name || !rawOrder.customer.phone) {
      return res.status(400).json({ error: 'Nome e telefone do cliente são obrigatórios.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    // 1. Recalculate prices from server database and verify stock
    let recalculatedSubtotal = 0;
    const validatedItems: any[] = [];
    const productsToUpdate: Product[] = [];

    for (const item of rawOrder.items) {
      const serverProduct = db.products.find((p) => p.id === item.productId);
      if (!serverProduct || !serverProduct.active) {
        return res.status(400).json({
          error: `O produto "${item.name || item.productId}" não está disponível no momento.`,
        });
      }

      const requestedQty = Math.max(1, parseInt(item.quantity, 10) || 1);
      if (serverProduct.stock < requestedQty) {
        return res.status(400).json({
          error: `Estoque insuficiente para "${serverProduct.name}". Disponível em estoque: ${serverProduct.stock} un.`,
        });
      }

      const itemTotal = serverProduct.price * requestedQty;
      recalculatedSubtotal += itemTotal;

      validatedItems.push({
        productId: serverProduct.id,
        name: serverProduct.name,
        volume: serverProduct.volume,
        price: serverProduct.price,
        costPrice: serverProduct.costPrice,
        quantity: requestedQty,
        isCold: serverProduct.isCold,
      });

      productsToUpdate.push({
        ...serverProduct,
        stock: serverProduct.stock - requestedQty,
      });
    }

    // 2. Recalculate Delivery Fee
    const deliveryType = rawOrder.deliveryType === 'retirada' ? 'retirada' : 'delivery';
    let deliveryFee = 0;

    if (deliveryType === 'delivery') {
      const customerNh = (rawOrder.customer.neighborhood || '').toLowerCase().trim();
      const matchedArea = db.deliveryAreas.find(
        (a) => a.active && a.name.toLowerCase().trim() === customerNh
      );

      if (matchedArea) {
        deliveryFee = matchedArea.fee;
      } else {
        deliveryFee = db.settings.deliveryFee || 5.0;
        if (db.settings.pricePerKm && rawOrder.customer.distanceKm) {
          const dist = Number(rawOrder.customer.distanceKm);
          if (dist > 1) {
            deliveryFee += (dist - 1) * db.settings.pricePerKm;
          }
        }
      }

      // Check free delivery threshold
      if (
        db.settings.freeDeliveryThreshold &&
        recalculatedSubtotal >= db.settings.freeDeliveryThreshold
      ) {
        deliveryFee = 0;
      }
    }

    const calculatedTotal = recalculatedSubtotal + deliveryFee;

    // 3. Create Order Object (Forcing initial status to 'pendente')
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    const orderId = rawOrder.id && !rawOrder.id.startsWith('MOCK') ? rawOrder.id : `PED-${randomNum}`;

    const newOrder: Order = {
      id: orderId,
      source: rawOrder.source === 'balcao' ? 'balcao' : 'online',
      status: 'pendente', // Force pending
      customer: {
        name: String(rawOrder.customer.name).trim(),
        phone: String(rawOrder.customer.phone).trim(),
        address: String(rawOrder.customer.address || '').trim(),
        number: String(rawOrder.customer.number || '').trim(),
        neighborhood: String(rawOrder.customer.neighborhood || '').trim(),
        complement: rawOrder.customer.complement || undefined,
        reference: rawOrder.customer.reference || undefined,
        cep: rawOrder.customer.cep || undefined,
        city: rawOrder.customer.city || undefined,
        state: rawOrder.customer.state || undefined,
        latitude: rawOrder.customer.latitude !== undefined && rawOrder.customer.latitude !== null ? Number(rawOrder.customer.latitude) : undefined,
        longitude: rawOrder.customer.longitude !== undefined && rawOrder.customer.longitude !== null ? Number(rawOrder.customer.longitude) : undefined,
        distanceKm: rawOrder.customer.distanceKm !== undefined && rawOrder.customer.distanceKm !== null ? Number(rawOrder.customer.distanceKm) : undefined,
        isWithinDeliveryRadius: rawOrder.customer.isWithinDeliveryRadius ?? undefined,
      },
      deliveryType,
      items: validatedItems,
      subtotal: Math.round(recalculatedSubtotal * 100) / 100,
      deliveryFee: Math.round(deliveryFee * 100) / 100,
      total: Math.round(calculatedTotal * 100) / 100,
      paymentMethod: rawOrder.paymentMethod || 'pix',
      cashChangeFor: rawOrder.cashChangeFor !== undefined && rawOrder.cashChangeFor !== null ? Number(rawOrder.cashChangeFor) : undefined,
      notes: rawOrder.notes || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 4. Save to Supabase: orders table
    const { error: orderErr } = await supabase.from('orders').upsert(orderToDB(newOrder));
    if (orderErr) {
      console.error('[Supabase Error] orders upsert:', orderErr.message);
      return res.status(500).json({ error: orderErr.message });
    }

    // 5. Update product stock in Supabase
    for (const prod of productsToUpdate) {
      const { error: prodStockErr } = await supabase.from('products').upsert(productToDB(prod));
      if (prodStockErr) {
        console.error('[Supabase Error] Falha ao atualizar estoque do produto no banco:', prodStockErr.message);
        return res.status(500).json({ error: prodStockErr.message });
      }
    }

    // 6. Update/insert customer record in Supabase (if valid phone)
    const cleanPhone = newOrder.customer.phone.replace(/\D/g, '');
    let updatedCustData: CustomerProfile | null = null;
    if (cleanPhone.length >= 8) {
      const existingCust = db.customers.find((c) => c.phone.replace(/\D/g, '') === cleanPhone);
      updatedCustData = {
        id: existingCust?.id || `cust-${Date.now()}`,
        name: newOrder.customer.name,
        phone: newOrder.customer.phone,
        address: newOrder.customer.address,
        number: newOrder.customer.number,
        neighborhood: newOrder.customer.neighborhood,
        complement: newOrder.customer.complement,
        reference: newOrder.customer.reference,
        cep: newOrder.customer.cep,
        city: newOrder.customer.city,
        state: newOrder.customer.state,
        latitude: newOrder.customer.latitude,
        longitude: newOrder.customer.longitude,
        distanceKm: newOrder.customer.distanceKm,
        isWithinDeliveryRadius: newOrder.customer.isWithinDeliveryRadius,
        createdAt: existingCust?.createdAt || new Date().toISOString(),
        totalOrdersCount: (existingCust?.totalOrdersCount || 0) + 1,
        totalSpent: (existingCust?.totalSpent || 0) + newOrder.total,
        lastOrderAt: new Date().toISOString(),
      };

      const { error: custErr } = await supabase.from('customers').upsert(customerToDB(updatedCustData));
      if (custErr) {
        console.error('[Supabase Error] Falha ao atualizar cliente:', custErr.message);
        return res.status(500).json({ error: custErr.message });
      }
    }

    // 7. Update in-memory state
    for (const prod of productsToUpdate) {
      const pIdx = db.products.findIndex((p) => p.id === prod.id);
      if (pIdx >= 0) db.products[pIdx].stock = prod.stock;
    }
    if (updatedCustData) {
      const cIdx = db.customers.findIndex((c) => c.phone.replace(/\D/g, '') === cleanPhone);
      if (cIdx >= 0) db.customers[cIdx] = updatedCustData;
      else db.customers.unshift(updatedCustData);
    }
    db.orders.unshift(newOrder);

    saveOptionalCache(db);

    // Notify Admin Panel in real time via SSE
    broadcastSSE('NEW_ORDER', newOrder);
    broadcastSSE('STATE_UPDATED', { type: 'ORDER_CREATED', order: newOrder });

    res.status(201).json(newOrder);
  });

  app.get('/api/orders/:id', (req, res) => {
    const { id } = req.params;
    const order = db.orders.find((o) => o.id === id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    // Return only status and essential tracking info for public inquiry
    res.json({
      id: order.id,
      status: order.status,
      total: order.total,
      deliveryType: order.deliveryType,
      createdAt: order.createdAt,
      itemsCount: order.items.length,
    });
  });

  app.patch('/api/orders/:id/status', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    const order = db.orders.find((o) => o.id === id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      console.error('[Supabase Error] order status update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    order.status = status;
    order.updatedAt = new Date().toISOString();
    saveOptionalCache(db);

    broadcastSSE('ORDER_STATUS_CHANGED', order);
    broadcastSSE('STATE_UPDATED', { type: 'ORDER_STATUS_CHANGED', order });
    res.json(order);
  });

  app.delete('/api/orders/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] orders delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.orders = db.orders.filter((o) => o.id !== id);
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'ORDER_DELETED', id });
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // SETTINGS ROUTES (Admin only for modification)
  // ---------------------------------------------------------------------------
  app.get('/api/settings', (_req, res) => {
    res.json(sanitizePublicSettings(db.settings));
  });

  app.put('/api/settings', requireAdmin, async (req, res) => {
    const cleanSettings = sanitizePublicSettings({ ...db.settings, ...req.body });

    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error } = await supabase.from('store_settings').upsert({
      id: 'default',
      data: cleanSettings,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[Supabase Error] store_settings update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    db.settings = cleanSettings;
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'SETTINGS_UPDATED', settings: cleanSettings });
    res.json(cleanSettings);
  });

  // ---------------------------------------------------------------------------
  // CLEAR ALL SIMULATION DATA ROUTE (Admin only)
  // ---------------------------------------------------------------------------
  app.post('/api/clear-all', requireAdmin, async (_req, res) => {
    if (!supabase) {
      console.error('[Supabase Error] Cliente Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const { error: ordErr } = await supabase.from('orders').delete().neq('id', '___empty___');
    if (ordErr) {
      console.error('[Supabase Error] clear orders:', ordErr.message);
      return res.status(500).json({ error: ordErr.message });
    }

    const { error: custErr } = await supabase.from('customers').delete().neq('id', '___empty___');
    if (custErr) {
      console.error('[Supabase Error] clear customers:', custErr.message);
      return res.status(500).json({ error: custErr.message });
    }

    db.orders = [];
    db.customers = [];
    saveOptionalCache(db);
    broadcastSSE('STATE_UPDATED', { type: 'DATA_CLEARED' });
    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // ATTACH VITE (DEV) OR STATIC (PROD)
  // ---------------------------------------------------------------------------
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Depósito Express] Servidor rodando com sucesso na porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Fatal] Falha ao iniciar servidor:', err);
});
