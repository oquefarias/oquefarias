import express from 'express';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  initialProducts,
  initialSettings,
  initialDeliveryAreas,
} from '../data/initialData.js';
import {
  Product,
  Order,
  StoreSettings,
  DeliveryArea,
  CustomerProfile,
  OrderStatus,
} from '../types/index.js';

dotenv.config();

// -----------------------------------------------------------------------------
// 1. SUPABASE CLIENT FACTORY
// Strictly using environment variables: SUPABASE_URL and SUPABASE_SECRET_KEY
// -----------------------------------------------------------------------------
function getSupabase(): SupabaseClient | null {
  const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
  const supabaseSecretKey = (process.env.SUPABASE_SECRET_KEY || '').trim();

  if (!supabaseUrl || !supabaseSecretKey) {
    return null;
  }

  try {
    return createClient(supabaseUrl, supabaseSecretKey, {
      auth: { persistSession: false },
    });
  } catch (err) {
    console.error('[Supabase Error] Falha ao criar cliente Supabase:', err);
    return null;
  }
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
// 3. STATELESS AUTH: HMAC-SHA256 SIGNED TOKENS & CONSTANT-TIME PIN CHECK
// -----------------------------------------------------------------------------
interface TokenPayload {
  role: 'admin';
  exp: number; // expiration in ms
  nonce: string;
}

function getSessionSecret(): string {
  return (process.env.ADMIN_SESSION_SECRET || '').trim();
}

function createAdminSignedToken(): { token: string; expiresAt: string } {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET não está configurado no servidor.');
  }

  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12 hours
  const payload: TokenPayload = {
    role: 'admin',
    exp,
    nonce: crypto.randomUUID(),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  return {
    token: `${payloadBase64}.${signature}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

function verifyAdminSignedToken(token: string): boolean {
  const secret = getSessionSecret();
  if (!secret || !token) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [payloadBase64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expSigBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expSigBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expSigBuf)) return false;

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf-8'));
    if (payload.role !== 'admin') return false;
    if (Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function comparePin(receivedPin: unknown, configuredPin: string | undefined): boolean {
  if (!configuredPin || receivedPin === undefined || receivedPin === null) return false;
  const recvStr = String(receivedPin).trim();
  const confStr = String(configuredPin).trim();

  // Hash both with SHA256 to guarantee identical 32-byte length before timingSafeEqual
  const hashRecv = crypto.createHash('sha256').update(recvStr).digest();
  const hashConf = crypto.createHash('sha256').update(confStr).digest();

  return crypto.timingSafeEqual(hashRecv, hashConf);
}

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  return req.socket.remoteAddress || req.ip || 'unknown';
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Não autorizado. Autentique-se com o PIN de administrador.' });
  }

  if (!verifyAdminSignedToken(token)) {
    return res.status(401).json({ error: 'Sessão de administrador expirada ou inválida.' });
  }

  next();
}

// -----------------------------------------------------------------------------
// 4. EXPRESS APP FACTORY (Stateless, Serverless & Local Compatible)
// -----------------------------------------------------------------------------
export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  // Sub-router that handles both /api prefix and root / prefix (Vercel rewrite flexibility)
  const router = express.Router();

  // ---------------------------------------------------------------------------
  // AUTH: VERIFY ADMIN PIN (Rate-limited via admin_login_attempts table)
  // ---------------------------------------------------------------------------
  router.post('/admin/verify-pin', async (req, res) => {
    const { pin } = req.body || {};
    const configuredPin = process.env.ADMIN_PIN;
    const sessionSecret = getSessionSecret();

    if (!configuredPin) {
      console.error('[Auth Error] ADMIN_PIN não está definido nas variáveis de ambiente!');
      return res.status(500).json({ error: 'ADMIN_PIN não configurado no servidor.' });
    }

    if (!sessionSecret) {
      console.error('[Auth Error] ADMIN_SESSION_SECRET não está definido nas variáveis de ambiente!');
      return res.status(500).json({ error: 'ADMIN_SESSION_SECRET não configurado no servidor.' });
    }

    const supabase = getSupabase();
    if (!supabase) {
      console.error('[Auth Error] Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor (SUPABASE_URL ou SUPABASE_SECRET_KEY ausente).' });
    }

    const clientIp = getClientIp(req);
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // Check failed attempts for this IP in the last 15 minutes
    try {
      const { count, error: countErr } = await supabase
        .from('admin_login_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('ip', clientIp)
        .eq('success', false)
        .gte('created_at', fifteenMinutesAgo);

      if (countErr) {
        console.warn('[Auth Warning] Falha ao consultar admin_login_attempts:', countErr.message);
      } else if ((count ?? 0) >= 5) {
        return res.status(429).json({ error: 'Muitas tentativas, aguarde 15 minutos.' });
      }
    } catch (err) {
      console.warn('[Auth Warning] Erro ao verificar tentativas de login:', err);
    }

    // Verify PIN in constant time
    const isOk = comparePin(pin, configuredPin);

    // Record attempt in database
    try {
      await supabase.from('admin_login_attempts').insert({
        ip: clientIp,
        success: isOk,
        created_at: new Date().toISOString(),
      });
    } catch (insertErr) {
      console.warn('[Auth Warning] Falha ao registrar tentativa em admin_login_attempts:', insertErr);
    }

    if (!isOk) {
      return res.status(401).json({ error: 'PIN de acesso incorreto.' });
    }

    try {
      const { token, expiresAt } = createAdminSignedToken();
      return res.json({
        success: true,
        token,
        expiresAt,
      });
    } catch (err: any) {
      console.error('[Auth Error] Erro ao criar token assinado:', err);
      return res.status(500).json({ error: err.message || 'Erro ao gerar token de sessão.' });
    }
  });

  // ---------------------------------------------------------------------------
  // PUBLIC STATE: GET /state
  // Returns active products, active delivery areas, and public settings directly from Supabase
  // ---------------------------------------------------------------------------
  router.get('/state', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    try {
      const [prodRes, areasRes, settingsRes] = await Promise.all([
        supabase.from('products').select('*').eq('active', true),
        supabase.from('delivery_areas').select('*').eq('active', true),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);

      if (prodRes.error) {
        console.error('[Supabase Error] products select:', prodRes.error.message);
        return res.status(500).json({ error: prodRes.error.message });
      }
      if (areasRes.error) {
        console.error('[Supabase Error] delivery_areas select:', areasRes.error.message);
        return res.status(500).json({ error: areasRes.error.message });
      }

      let settings = sanitizePublicSettings(initialSettings);
      if (settingsRes.data && settingsRes.data.data) {
        settings = sanitizePublicSettings(settingsRes.data.data);
      } else {
        // Seed store_settings if missing
        await supabase.from('store_settings').upsert({
          id: 'default',
          data: sanitizePublicSettings(initialSettings),
          updated_at: new Date().toISOString(),
        });
      }

      const products = (prodRes.data || []).map(productFromDB);
      const deliveryAreas = (areasRes.data || []).map(deliveryAreaFromDB);

      return res.json({
        products,
        deliveryAreas,
        settings,
      });
    } catch (err: any) {
      console.error('[Server Error] GET /api/state:', err);
      return res.status(500).json({ error: err.message || 'Erro interno ao carregar dados.' });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN COMPLETE STATE: GET /admin/state
  // ---------------------------------------------------------------------------
  router.get('/admin/state', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    try {
      const [prodRes, areasRes, custRes, orderRes, settingsRes] = await Promise.all([
        supabase.from('products').select('*'),
        supabase.from('delivery_areas').select('*'),
        supabase.from('customers').select('*'),
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);

      if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
      if (areasRes.error) return res.status(500).json({ error: areasRes.error.message });
      if (custRes.error) return res.status(500).json({ error: custRes.error.message });
      if (orderRes.error) return res.status(500).json({ error: orderRes.error.message });

      let settings = sanitizePublicSettings(initialSettings);
      if (settingsRes.data && settingsRes.data.data) {
        settings = sanitizePublicSettings(settingsRes.data.data);
      }

      return res.json({
        products: (prodRes.data || []).map(productFromDB),
        orders: (orderRes.data || []).map(orderFromDB),
        deliveryAreas: (areasRes.data || []).map(deliveryAreaFromDB),
        customers: (custRes.data || []).map(customerFromDB),
        settings,
      });
    } catch (err: any) {
      console.error('[Server Error] GET /api/admin/state:', err);
      return res.status(500).json({ error: err.message || 'Erro interno ao carregar estado.' });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN POLLING FOR NEW ORDERS: GET /admin/orders
  // Used by front-end polling (every 10s) to notify owner of incoming orders without SSE
  // ---------------------------------------------------------------------------
  router.get('/admin/orders', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Supabase Error] admin orders query:', error.message);
        return res.status(500).json({ error: error.message });
      }

      const orders = (data || []).map(orderFromDB);
      return res.json(orders);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------------------------
  // PRODUCTS ROUTES
  // ---------------------------------------------------------------------------
  router.get('/products', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado.' });

    const { data, error } = await supabase.from('products').select('*').eq('active', true);
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(productFromDB));
  });

  router.post('/products', requireAdmin, async (req, res) => {
    const product = req.body as Product;
    if (!product || !product.id || !product.name) {
      return res.status(400).json({ error: 'Dados do produto inválidos.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error } = await supabase.from('products').upsert(productToDB(product));
    if (error) {
      console.error('[Supabase Error] products upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(product);
  });

  router.put('/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const updated: Product = { ...req.body, id };
    const { error } = await supabase.from('products').upsert(productToDB(updated));
    if (error) {
      console.error('[Supabase Error] products update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(updated);
  });

  router.post('/products/:id/stock', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { delta } = req.body || {};
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existing, error: fetchErr } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const currentProd = productFromDB(existing);
    const newStock = Math.max(0, currentProd.stock + (Number(delta) || 0));
    const updatedProd: Product = { ...currentProd, stock: newStock };

    const { error } = await supabase.from('products').upsert(productToDB(updatedProd));
    if (error) {
      console.error('[Supabase Error] stock update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(updatedProd);
  });

  router.delete('/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] products delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // DELIVERY AREAS ROUTES
  // ---------------------------------------------------------------------------
  router.get('/delivery-areas', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado.' });

    const { data, error } = await supabase.from('delivery_areas').select('*').eq('active', true);
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(deliveryAreaFromDB));
  });

  router.post('/delivery-areas', requireAdmin, async (req, res) => {
    const area = req.body as DeliveryArea;
    if (!area || !area.id || !area.name) {
      return res.status(400).json({ error: 'Dados da área inválidos.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error } = await supabase.from('delivery_areas').upsert(deliveryAreaToDB(area));
    if (error) {
      console.error('[Supabase Error] delivery_areas upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(area);
  });

  router.put('/delivery-areas/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const updated: DeliveryArea = { ...req.body, id };
    const { error } = await supabase.from('delivery_areas').upsert(deliveryAreaToDB(updated));
    if (error) {
      console.error('[Supabase Error] delivery_areas update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(updated);
  });

  router.delete('/delivery-areas/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error } = await supabase.from('delivery_areas').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] delivery_areas delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // CUSTOMERS ROUTES
  // ---------------------------------------------------------------------------
  router.get('/customers', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase.from('customers').select('*');
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(customerFromDB));
  });

  router.get('/customers/by-phone/:phone', async (req, res) => {
    const cleanPhone = req.params.phone.replace(/\D/g, '');
    if (!cleanPhone) {
      return res.status(400).json({ error: 'Telefone inválido.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase.from('customers').select('*');
    if (error) return res.status(500).json({ error: error.message });

    const found = (data || []).find((c: any) => String(c.phone || '').replace(/\D/g, '') === cleanPhone);
    if (!found) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    res.json(customerFromDB(found));
  });

  router.post('/customers', async (req, res) => {
    const cust = req.body as CustomerProfile;
    if (!cust || !cust.phone || !cust.name) {
      return res.status(400).json({ error: 'Nome e telefone do cliente são obrigatórios.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanPhone = cust.phone.replace(/\D/g, '');
    const { data: allCust } = await supabase.from('customers').select('*');
    const existingRow = (allCust || []).find((c: any) => String(c.phone || '').replace(/\D/g, '') === cleanPhone);

    let savedCust: CustomerProfile;
    if (existingRow) {
      const existing = customerFromDB(existingRow);
      savedCust = { ...existing, ...cust };
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

    res.json(savedCust);
  });

  router.delete('/customers/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] customers delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // ORDERS ROUTES
  // ---------------------------------------------------------------------------
  router.post('/orders', async (req, res) => {
    const rawOrder = req.body;
    if (!rawOrder || !rawOrder.items || !Array.isArray(rawOrder.items) || rawOrder.items.length === 0) {
      return res.status(400).json({ error: 'O pedido deve conter pelo menos um item.' });
    }

    if (!rawOrder.customer || !rawOrder.customer.name || !rawOrder.customer.phone) {
      return res.status(400).json({ error: 'Nome e telefone do cliente são obrigatórios.' });
    }

    const supabase = getSupabase();
    if (!supabase) {
      console.error('[Supabase Error] Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    // 1. Fetch current products, delivery areas, and settings directly from Supabase
    const [prodRes, areasRes, settingsRes] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('delivery_areas').select('*').eq('active', true),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);

    if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
    const dbProducts = (prodRes.data || []).map(productFromDB);
    const dbAreas = (areasRes.data || []).map(deliveryAreaFromDB);
    const dbSettings = settingsRes.data?.data ? sanitizePublicSettings(settingsRes.data.data) : initialSettings;

    // 2. Recalculate prices and verify stock
    let recalculatedSubtotal = 0;
    const validatedItems: any[] = [];
    const productsToUpdate: Product[] = [];

    for (const item of rawOrder.items) {
      const serverProduct = dbProducts.find((p) => p.id === item.productId);
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

    // 3. Recalculate Delivery Fee
    const deliveryType = rawOrder.deliveryType === 'retirada' ? 'retirada' : 'delivery';
    let deliveryFee = 0;

    if (deliveryType === 'delivery') {
      const customerNh = (rawOrder.customer.neighborhood || '').toLowerCase().trim();
      const matchedArea = dbAreas.find((a) => a.active && a.name.toLowerCase().trim() === customerNh);

      if (matchedArea) {
        deliveryFee = matchedArea.fee;
      } else {
        deliveryFee = dbSettings.deliveryFee || 5.0;
        if (dbSettings.pricePerKm && rawOrder.customer.distanceKm) {
          const dist = Number(rawOrder.customer.distanceKm);
          if (dist > 1) {
            deliveryFee += (dist - 1) * dbSettings.pricePerKm;
          }
        }
      }

      if (dbSettings.freeDeliveryThreshold && recalculatedSubtotal >= dbSettings.freeDeliveryThreshold) {
        deliveryFee = 0;
      }
    }

    const calculatedTotal = recalculatedSubtotal + deliveryFee;

    // 4. Force initial status to 'pendente'
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

    // 5. Persist order into orders table
    const { error: orderErr } = await supabase.from('orders').upsert(orderToDB(newOrder));
    if (orderErr) {
      console.error('[Supabase Error] orders upsert:', orderErr.message);
      return res.status(500).json({ error: orderErr.message });
    }

    // 6. Update product stocks in Supabase
    for (const prod of productsToUpdate) {
      const { error: prodStockErr } = await supabase.from('products').upsert(productToDB(prod));
      if (prodStockErr) {
        console.error('[Supabase Error] Falha ao atualizar estoque do produto no banco:', prodStockErr.message);
        return res.status(500).json({ error: prodStockErr.message });
      }
    }

    // 7. Update/insert customer record in Supabase (if valid phone)
    const cleanPhone = newOrder.customer.phone.replace(/\D/g, '');
    if (cleanPhone.length >= 8) {
      const { data: custRows } = await supabase.from('customers').select('*');
      const existingCustRow = (custRows || []).find((c: any) => String(c.phone || '').replace(/\D/g, '') === cleanPhone);
      const existingCust = existingCustRow ? customerFromDB(existingCustRow) : null;

      const updatedCustData: CustomerProfile = {
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

    res.status(201).json(newOrder);
  });

  router.get('/orders/:id', async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
    if (error || !data) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const order = orderFromDB(data);
    res.json({
      id: order.id,
      status: order.status,
      total: order.total,
      deliveryType: order.deliveryType,
      createdAt: order.createdAt,
      itemsCount: order.items.length,
    });
  });

  router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body || {};
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      console.error('[Supabase Error] order status update:', error?.message);
      return res.status(500).json({ error: error?.message || 'Pedido não encontrado.' });
    }

    res.json(orderFromDB(data));
  });

  router.delete('/orders/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] orders delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // SETTINGS ROUTES
  // ---------------------------------------------------------------------------
  router.get('/settings', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado.' });

    const { data } = await supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle();
    const settings = data?.data ? sanitizePublicSettings(data.data) : sanitizePublicSettings(initialSettings);
    res.json(settings);
  });

  router.put('/settings', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existingData } = await supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle();
    const current = existingData?.data || initialSettings;
    const cleanSettings = sanitizePublicSettings({ ...current, ...req.body });

    const { error } = await supabase.from('store_settings').upsert({
      id: 'default',
      data: cleanSettings,
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error('[Supabase Error] store_settings update:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json(cleanSettings);
  });

  // ---------------------------------------------------------------------------
  // CLEAR ALL SIMULATION DATA ROUTE (Admin only)
  // ---------------------------------------------------------------------------
  router.post('/clear-all', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error: ordErr } = await supabase.from('orders').delete().neq('id', '___empty___');
    if (ordErr) return res.status(500).json({ error: ordErr.message });

    const { error: custErr } = await supabase.from('customers').delete().neq('id', '___empty___');
    if (custErr) return res.status(500).json({ error: custErr.message });

    res.json({ success: true });
  });

  // Mount the router under both /api and root (for Vercel path rewrites compatibility)
  app.use('/api', router);
  app.use('/', router);

  return app;
}
