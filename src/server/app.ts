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
  Coupon,
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
export function isPromoActive(product: any): boolean {
  if (!product) return false;
  const normalPrice = Number(product.price) || 0;
  const rawPromo = product.promoPrice !== undefined ? product.promoPrice : product.promo_price;
  const promoPrice = rawPromo !== null && rawPromo !== undefined ? Number(rawPromo) : 0;

  if (!(promoPrice > 0 && promoPrice < normalPrice)) {
    return false;
  }

  const rawEndsAt = product.promoEndsAt !== undefined ? product.promoEndsAt : product.promo_ends_at;
  if (rawEndsAt) {
    const endsAtMs = new Date(rawEndsAt).getTime();
    if (!Number.isNaN(endsAtMs) && endsAtMs <= Date.now()) {
      return false;
    }
  }

  return true;
}

export function getEffectivePrice(product: any): number {
  if (!product) return 0;
  const normalPrice = Number(product.price) || 0;
  const rawPromo = product.promoPrice !== undefined ? product.promoPrice : product.promo_price;
  return isPromoActive(product) ? Number(rawPromo) : normalPrice;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // Raio da Terra em km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

async function fetchNominatimStructured(
  params: Record<string, string>,
  userAgent: string
): Promise<{ lat: number; lon: number; displayName: string } | null> {
  try {
    const searchParams = new URLSearchParams({
      format: 'json',
      countrycodes: 'br',
      limit: '1',
      ...params,
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6500);
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams.toString()}`, {
      headers: {
        'User-Agent': userAgent,
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
        return {
          lat,
          lon,
          displayName: String(data[0].display_name || ''),
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('[Geo Warning] Nominatim request failed:', err);
    return null;
  }
}

async function fetchBrasilApiCepServer(cleanCep: string): Promise<{
  lat?: number;
  lng?: number;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
} | null> {
  if (cleanCep.length !== 8) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    const rawLat = data?.location?.coordinates?.latitude;
    const rawLng = data?.location?.coordinates?.longitude;
    const lat = rawLat !== undefined && rawLat !== null ? parseFloat(String(rawLat)) : undefined;
    const lng = rawLng !== undefined && rawLng !== null ? parseFloat(String(rawLng)) : undefined;
    return {
      lat: lat !== undefined && !Number.isNaN(lat) ? lat : undefined,
      lng: lng !== undefined && !Number.isNaN(lng) ? lng : undefined,
      street: String(data?.street || ''),
      neighborhood: String(data?.neighborhood || ''),
      city: String(data?.city || ''),
      state: String(data?.state || ''),
    };
  } catch (err) {
    console.warn('[Geo Warning] BrasilAPI lookup failed:', err);
    return null;
  }
}

async function computeCustomerServerMetrics(
  supabase: SupabaseClient,
  latitude: number | undefined | null,
  longitude: number | undefined | null
): Promise<{ distanceKm?: number; isWithinDeliveryRadius?: boolean }> {
  if (
    latitude === undefined ||
    latitude === null ||
    Number.isNaN(Number(latitude)) ||
    longitude === undefined ||
    longitude === null ||
    Number.isNaN(Number(longitude))
  ) {
    return { distanceKm: undefined, isWithinDeliveryRadius: undefined };
  }

  const { data: settingsRow } = await supabase
    .from('store_settings')
    .select('data')
    .eq('id', 'default')
    .maybeSingle();
  const dbSettings: StoreSettings = settingsRow?.data
    ? sanitizePublicSettings(settingsRow.data)
    : initialSettings;

  if (
    dbSettings.storeLatitude === undefined ||
    dbSettings.storeLatitude === null ||
    dbSettings.storeLongitude === undefined ||
    dbSettings.storeLongitude === null
  ) {
    return { distanceKm: undefined, isWithinDeliveryRadius: undefined };
  }

  const distanceKm = haversineKm(
    Number(dbSettings.storeLatitude),
    Number(dbSettings.storeLongitude),
    Number(latitude),
    Number(longitude)
  );
  const maxRadius = Number(dbSettings.deliveryRadiusKm) || 5;
  return {
    distanceKm,
    isWithinDeliveryRadius: distanceKm <= maxRadius,
  };
}


function productToDB(p: Product) {
  const promoPriceVal =
    p.promoPrice !== undefined && p.promoPrice !== null && Number(p.promoPrice) > 0
      ? Number(p.promoPrice)
      : null;
  const promoEndsAtVal = p.promoEndsAt ? String(p.promoEndsAt) : null;

  return {
    id: p.id,
    name: p.name,
    category: p.category,
    volume: p.volume || null,
    price: Number(p.price) || 0,
    promo_price: promoPriceVal,
    promo_ends_at: promoEndsAtVal,
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
    promoPrice:
      row.promo_price !== null && row.promo_price !== undefined && Number(row.promo_price) > 0
        ? Number(row.promo_price)
        : null,
    promoEndsAt: row.promo_ends_at ? String(row.promo_ends_at) : null,
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

function sanitizePublicProduct(p: Product): Product {
  const activePromo = isPromoActive(p);
  return {
    ...p,
    promoPrice: activePromo ? (p.promoPrice ?? null) : null,
    promoEndsAt: activePromo ? (p.promoEndsAt ?? null) : null,
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

function customerToDB(c: CustomerProfile, passwordHash?: string) {
  const dbObj: any = {
    id: c.id,
    name: c.name,
    email: c.email ? c.email.toLowerCase().trim() : null,
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

  if (passwordHash) {
    dbObj.password_hash = passwordHash;
  }

  return dbObj;
}

function customerFromDB(row: any): CustomerProfile {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    email: row.email || undefined,
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

function couponToDB(c: Coupon) {
  return {
    code: c.code.toUpperCase().trim(),
    type: c.type === 'fixed' ? 'fixed' : 'percent',
    value: Number(c.value) || 0,
    min_order: c.minOrder ? Number(c.minOrder) : null,
    max_discount:
      c.maxDiscount !== undefined && c.maxDiscount !== null && Number(c.maxDiscount) > 0
        ? Number(c.maxDiscount)
        : null,
    active: c.active !== false,
    expires_at: c.expiresAt || null,
    max_uses: c.maxUses ? Number(c.maxUses) : null,
    used_count: Number(c.usedCount) || 0,
  };
}

function couponFromDB(row: any): Coupon {
  return {
    code: String(row.code || '').toUpperCase(),
    type: row.type === 'fixed' ? 'fixed' : 'percent',
    value: Number(row.value || 0),
    minOrder: row.min_order !== null && row.min_order !== undefined ? Number(row.min_order) : undefined,
    maxDiscount: row.max_discount !== null && row.max_discount !== undefined ? Number(row.max_discount) : undefined,
    active: row.active ?? true,
    expiresAt: row.expires_at || null,
    maxUses: row.max_uses !== null && row.max_uses !== undefined ? Number(row.max_uses) : null,
    usedCount: Number(row.used_count || 0),
  };
}

function calculateCouponDiscount(coupon: Coupon, subtotal: number): number {
  const numSubtotal = Math.max(0, Number(subtotal) || 0);
  let discount = 0;
  if (coupon.type === 'percent') {
    discount = (coupon.value / 100) * numSubtotal;
    if (coupon.maxDiscount !== undefined && coupon.maxDiscount !== null && coupon.maxDiscount > 0) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
    discount = Math.min(discount, numSubtotal);
  } else {
    discount = Math.min(coupon.value, numSubtotal);
  }
  return Math.round(discount * 100) / 100;
}

function orderToDB(o: Order) {
  return {
    id: o.id,
    source: o.source || 'online',
    status: o.status || 'pendente',
    customer: o.customer, // jsonb
    customer_id: o.customerId || null,
    coupon_code: o.couponCode ? o.couponCode.toUpperCase().trim() : null,
    discount: Number(o.discount) || 0,
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
    customerId: row.customer_id || undefined,
    couponCode: row.coupon_code || undefined,
    discount: Number(row.discount || 0),
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
// 3. CRYPTO & STATELESS HMAC-SHA256 SIGNED TOKENS
// -----------------------------------------------------------------------------
interface TokenPayload {
  role: 'admin' | 'customer';
  customerId?: string;
  exp: number; // expiration in ms
  nonce: string;
}

function getSessionSecret(): string {
  return (process.env.ADMIN_SESSION_SECRET || '').trim();
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!storedHash || !storedHash.startsWith('scrypt:')) {
      return resolve(false);
    }
    const parts = storedHash.split(':');
    if (parts.length !== 3) return resolve(false);
    const [, salt, keyHex] = parts;
    const keyBuffer = Buffer.from(keyHex, 'hex');

    crypto.scrypt(password, salt, keyBuffer.length, (err, derivedKey) => {
      if (err) return resolve(false);
      try {
        const matches = crypto.timingSafeEqual(derivedKey, keyBuffer);
        resolve(matches);
      } catch {
        resolve(false);
      }
    });
  });
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

function createCustomerSignedToken(customerId: string): { token: string; expiresAt: string } {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('ADMIN_SESSION_SECRET não está configurado no servidor.');
  }

  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload: TokenPayload = {
    role: 'customer',
    customerId,
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

function verifySignedToken(token: string): TokenPayload | null {
  const secret = getSessionSecret();
  if (!secret || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadBase64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadBase64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expSigBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expSigBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expSigBuf)) return null;

  try {
    const payload: TokenPayload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString('utf-8'));
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function comparePin(receivedPin: unknown, configuredPin: string | undefined): boolean {
  if (!configuredPin || receivedPin === undefined || receivedPin === null) return false;
  const recvStr = String(receivedPin).trim();
  const confStr = String(configuredPin).trim();

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

  const payload = verifySignedToken(token);
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ error: 'Sessão de administrador expirada ou inválida.' });
  }

  (req as any).admin = payload;
  next();
}

function requireCustomer(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ error: 'Não autenticado. Faça login para continuar.' });
  }

  const payload = verifySignedToken(token);
  if (!payload || payload.role !== 'customer' || !payload.customerId) {
    return res.status(401).json({ error: 'Sessão do cliente expirada ou inválida. Faça login novamente.' });
  }

  (req as any).customerId = payload.customerId;
  next();
}

// -----------------------------------------------------------------------------
// 4. EXPRESS APP FACTORY (Stateless, Serverless & Local Compatible)
// -----------------------------------------------------------------------------
export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

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

    const isOk = comparePin(pin, configuredPin);

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
  // GEOCODING RESOLVE ON SERVER: POST /geo/resolve
  // Rate-limited to 20 calls/min per IP using admin_login_attempts with 'geo:' prefix
  // ---------------------------------------------------------------------------
  router.post('/geo/resolve', async (req, res) => {
    const supabase = getSupabase();
    const clientIp = getClientIp(req);
    const geoIpKey = `geo:${clientIp}`;
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

    let contactEmail = process.env.CONTACT_EMAIL || 'contato@depositoexpress.com.br';

    if (supabase) {
      try {
        const { count, error: countErr } = await supabase
          .from('admin_login_attempts')
          .select('*', { count: 'exact', head: true })
          .eq('ip', geoIpKey)
          .gte('created_at', oneMinuteAgo);

        if (!countErr && (count ?? 0) >= 20) {
          return res.status(429).json({
            error: 'Limite de consultas de localização atingido (20 por minuto). Aguarde um instante.',
          });
        }

        await supabase.from('admin_login_attempts').insert({
          ip: geoIpKey,
          success: true,
          created_at: new Date().toISOString(),
        });

        const { data: settingsRow } = await supabase
          .from('store_settings')
          .select('data')
          .eq('id', 'default')
          .maybeSingle();
        const sData = settingsRow?.data;
        if (sData) {
          if (sData.email && typeof sData.email === 'string' && sData.email.includes('@')) {
            contactEmail = sData.email.trim();
          } else if (sData.pixKey && typeof sData.pixKey === 'string' && sData.pixKey.includes('@')) {
            contactEmail = sData.pixKey.trim();
          }
        }
      } catch (err) {
        console.warn('[Geo Warning] Rate limit check warning:', err);
      }
    }

    const userAgent = `DepositoExpress/1.0 (${contactEmail})`;
    const body = req.body || {};

    let rua = String(body.rua || body.street || body.address || body.logradouro || '').trim();
    const numero = String(body.numero || body.number || '').trim();
    let bairro = String(body.bairro || body.neighborhood || '').trim();
    let cidade = String(body.cidade || body.city || body.localidade || '').trim();
    let uf = String(body.uf || body.state || '').trim();
    const rawCep = String(body.cep || body.postalcode || '').replace(/\D/g, '');
    const freeQuery = String(body.query || '').trim();

    let brasilApiData: Awaited<ReturnType<typeof fetchBrasilApiCepServer>> = null;
    if (rawCep.length === 8 && (!rua || !cidade)) {
      brasilApiData = await fetchBrasilApiCepServer(rawCep);
      if (brasilApiData) {
        if (!rua && brasilApiData.street) rua = brasilApiData.street;
        if (!bairro && brasilApiData.neighborhood) bairro = brasilApiData.neighborhood;
        if (!cidade && brasilApiData.city) cidade = brasilApiData.city;
        if (!uf && brasilApiData.state) uf = brasilApiData.state;
      }
    }

    const formattedPostal =
      rawCep.length === 8 ? `${rawCep.slice(0, 5)}-${rawCep.slice(5)}` : rawCep;

    // (a) 1. Structured search with street=[número rua], city, state, postalcode
    if (rua && numero) {
      const params1: Record<string, string> = {
        street: `${numero} ${rua}`,
      };
      if (cidade) params1.city = cidade;
      if (uf) params1.state = uf;
      if (formattedPostal) params1.postalcode = formattedPostal;

      const hit1 = await fetchNominatimStructured(params1, userAgent);
      if (hit1) {
        return res.json({
          latitude: hit1.lat,
          longitude: hit1.lon,
          precisao: 'exata',
          displayName: hit1.displayName,
        });
      }
    }

    // (a) 2. Retry without number: street=[rua], city, state, postalcode
    if (rua) {
      const params2: Record<string, string> = {
        street: rua,
      };
      if (cidade) params2.city = cidade;
      if (uf) params2.state = uf;
      if (formattedPostal) params2.postalcode = formattedPostal;

      const hit2 = await fetchNominatimStructured(params2, userAgent);
      if (hit2) {
        return res.json({
          latitude: hit2.lat,
          longitude: hit2.lon,
          precisao: 'rua',
          displayName: hit2.displayName,
        });
      }
    }

    // (a) 3. Retry with only street + city (first with number if available, then street only)
    if (rua && cidade) {
      if (numero) {
        const hit3WithNum = await fetchNominatimStructured(
          { street: `${numero} ${rua}`, city: cidade },
          userAgent
        );
        if (hit3WithNum) {
          return res.json({
            latitude: hit3WithNum.lat,
            longitude: hit3WithNum.lon,
            precisao: 'exata',
            displayName: hit3WithNum.displayName,
          });
        }
      }

      const hit3 = await fetchNominatimStructured(
        { street: rua, city: cidade },
        userAgent
      );
      if (hit3) {
        return res.json({
          latitude: hit3.lat,
          longitude: hit3.lon,
          precisao: 'rua',
          displayName: hit3.displayName,
        });
      }
    }

    // Free-form query fallback if caller passed a raw query (e.g. store settings search)
    if (freeQuery && !rua && !rawCep) {
      const hitFree = await fetchNominatimStructured({ q: freeQuery }, userAgent);
      if (hitFree) {
        return res.json({
          latitude: hitFree.lat,
          longitude: hitFree.lon,
          precisao: 'rua',
          displayName: hitFree.displayName,
        });
      }
    }

    // (b) Fallback: BrasilAPI coordinates and mark precisao as 'aproximada'
    if (rawCep.length === 8) {
      if (!brasilApiData) {
        brasilApiData = await fetchBrasilApiCepServer(rawCep);
      }
      if (brasilApiData && brasilApiData.lat !== undefined && brasilApiData.lng !== undefined) {
        return res.json({
          latitude: brasilApiData.lat,
          longitude: brasilApiData.lng,
          precisao: 'aproximada',
          displayName: [
            brasilApiData.street || rua,
            brasilApiData.neighborhood || bairro,
            brasilApiData.city || cidade,
            brasilApiData.state || uf,
          ]
            .filter(Boolean)
            .join(', '),
        });
      }
    }

    return res.status(404).json({
      error: 'Não foi possível localizar as coordenadas deste endereço.',
    });
  });

  // ---------------------------------------------------------------------------
  // CUSTOMER AUTH: REGISTER, LOGIN, ME
  // ---------------------------------------------------------------------------
  router.post('/customer/register', async (req, res) => {
    const {
      name,
      email,
      phone,
      password,
      cep,
      address,
      number,
      neighborhood,
      complement,
      reference,
      city,
      state,
      latitude,
      longitude,
    } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Nome completo é obrigatório.' });
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório.' });
    }

    if (!phone || typeof phone !== 'string' || phone.replace(/\D/g, '').length < 8) {
      return res.status(400).json({ error: 'Número de WhatsApp é obrigatório.' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanEmail = email.toLowerCase().trim();

    // Check email uniqueness
    const { data: existingUser, error: checkErr } = await supabase
      .from('customers')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (checkErr) {
      console.error('[Supabase Error] check customer email:', checkErr.message);
      return res.status(500).json({ error: checkErr.message });
    }

    if (existingUser) {
      return res.status(409).json({ error: 'Este e-mail já está cadastrado. Faça login com seu e-mail e senha.' });
    }

    try {
      const passwordHash = await hashPassword(password);
      const customerId = `cust-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

      const parsedLat =
        latitude !== undefined && latitude !== null && !Number.isNaN(Number(latitude))
          ? Number(latitude)
          : undefined;
      const parsedLng =
        longitude !== undefined && longitude !== null && !Number.isNaN(Number(longitude))
          ? Number(longitude)
          : undefined;

      // Always calculate distance_km and is_within_delivery_radius on the server; ignore browser values
      const serverMetrics = await computeCustomerServerMetrics(supabase, parsedLat, parsedLng);

      const newCustProfile: CustomerProfile = {
        id: customerId,
        name: name.trim(),
        email: cleanEmail,
        phone: phone.trim(),
        address: (address || '').trim(),
        number: (number || '').trim(),
        neighborhood: (neighborhood || '').trim(),
        complement: complement ? complement.trim() : undefined,
        reference: reference ? reference.trim() : undefined,
        cep: cep ? cep.trim() : undefined,
        city: city ? city.trim() : undefined,
        state: state ? state.trim() : undefined,
        latitude: parsedLat,
        longitude: parsedLng,
        distanceKm: serverMetrics.distanceKm,
        isWithinDeliveryRadius: serverMetrics.isWithinDeliveryRadius,
        createdAt: new Date().toISOString(),
        totalOrdersCount: 0,
        totalSpent: 0,
      };

      const { error: insertErr } = await supabase
        .from('customers')
        .insert(customerToDB(newCustProfile, passwordHash));

      if (insertErr) {
        console.error('[Supabase Error] customer register insert:', insertErr.message);
        return res.status(500).json({ error: insertErr.message });
      }

      const { token, expiresAt } = createCustomerSignedToken(customerId);

      return res.status(201).json({
        success: true,
        token,
        expiresAt,
        customer: newCustProfile,
      });
    } catch (err: any) {
      console.error('[Auth Error] customer registration error:', err);
      return res.status(500).json({ error: err.message || 'Erro ao registrar cliente.' });
    }
  });

  router.post('/customer/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const clientIp = getClientIp(req);
    const attemptIp = `customer:${clientIp}`;
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    // Check rate limit for customer login attempts
    try {
      const { count } = await supabase
        .from('admin_login_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('ip', attemptIp)
        .eq('success', false)
        .gte('created_at', fifteenMinutesAgo);

      if ((count ?? 0) >= 5) {
        return res.status(429).json({ error: 'Muitas tentativas, aguarde 15 minutos.' });
      }
    } catch (err) {
      console.warn('[Auth Warning] customer login attempt check:', err);
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const { data: customerRow, error: fetchErr } = await supabase
      .from('customers')
      .select('*')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (fetchErr) {
      console.error('[Supabase Error] customer login query:', fetchErr.message);
      return res.status(500).json({ error: fetchErr.message });
    }

    if (!customerRow || !customerRow.password_hash) {
      // Record failed attempt
      await supabase.from('admin_login_attempts').insert({
        ip: attemptIp,
        success: false,
        created_at: new Date().toISOString(),
      });
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const isMatch = await verifyPassword(String(password), customerRow.password_hash);

    await supabase.from('admin_login_attempts').insert({
      ip: attemptIp,
      success: isMatch,
      created_at: new Date().toISOString(),
    });

    if (!isMatch) {
      return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
    }

    const { token, expiresAt } = createCustomerSignedToken(customerRow.id);
    const customer = customerFromDB(customerRow);

    return res.json({
      success: true,
      token,
      expiresAt,
      customer,
    });
  });

  router.get('/customer/me', requireCustomer, async (req, res) => {
    const customerId = (req as any).customerId;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .maybeSingle();

    if (error || !data) {
      return res.status(404).json({ error: 'Cadastro do cliente não encontrado.' });
    }

    res.json(customerFromDB(data));
  });

  router.put('/customer/me', requireCustomer, async (req, res) => {
    const customerId = (req as any).customerId;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existing, error: fetchErr } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const body = req.body || {};
    let newPasswordHash: string | undefined = undefined;
    if (body.password && typeof body.password === 'string') {
      if (body.password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
      }
      newPasswordHash = await hashPassword(body.password);
    }

    const nextLat =
      body.latitude !== undefined && body.latitude !== null && !Number.isNaN(Number(body.latitude))
        ? Number(body.latitude)
        : existing.latitude !== null && existing.latitude !== undefined
        ? Number(existing.latitude)
        : undefined;
    const nextLng =
      body.longitude !== undefined && body.longitude !== null && !Number.isNaN(Number(body.longitude))
        ? Number(body.longitude)
        : existing.longitude !== null && existing.longitude !== undefined
        ? Number(existing.longitude)
        : undefined;

    // Always calculate distance_km and is_within_delivery_radius on the server; ignore browser values
    const serverMetrics = await computeCustomerServerMetrics(supabase, nextLat, nextLng);

    const updatedProfile: CustomerProfile = {
      ...customerFromDB(existing),
      name: body.name !== undefined ? body.name : existing.name,
      phone: body.phone !== undefined ? body.phone : existing.phone,
      address: body.address !== undefined ? body.address : existing.address,
      number: body.number !== undefined ? body.number : existing.number,
      neighborhood: body.neighborhood !== undefined ? body.neighborhood : existing.neighborhood,
      complement: body.complement !== undefined ? body.complement : existing.complement,
      reference: body.reference !== undefined ? body.reference : existing.reference,
      cep: body.cep !== undefined ? body.cep : existing.cep,
      city: body.city !== undefined ? body.city : existing.city,
      state: body.state !== undefined ? body.state : existing.state,
      latitude: nextLat,
      longitude: nextLng,
      distanceKm: serverMetrics.distanceKm,
      isWithinDeliveryRadius: serverMetrics.isWithinDeliveryRadius,
    };

    const updateDBData = customerToDB(updatedProfile, newPasswordHash);
    const { data: savedRow, error: saveErr } = await supabase
      .from('customers')
      .update(updateDBData)
      .eq('id', customerId)
      .select('*')
      .single();

    if (saveErr) {
      console.error('[Supabase Error] customer update error:', saveErr.message);
      return res.status(500).json({ error: saveErr.message });
    }

    return res.json(customerFromDB(savedRow));
  });

  // ---------------------------------------------------------------------------
  // CUSTOMER DELIVERY QUOTE: GET /customer/delivery-quote (Protected by requireCustomer)
  // Calculates distance, radius check, and delivery fee on the server
  // ---------------------------------------------------------------------------
  router.get('/customer/delivery-quote', requireCustomer, async (req, res) => {
    const customerId = (req as any).customerId;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const [custRes, areasRes, settingsRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', customerId).maybeSingle(),
      supabase.from('delivery_areas').select('*').eq('active', true),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);

    if (custRes.error || !custRes.data) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const dbCustomer = customerFromDB(custRes.data);
    const dbAreas = (areasRes.data || []).map(deliveryAreaFromDB);
    const dbSettings: StoreSettings = settingsRes.data?.data
      ? sanitizePublicSettings(settingsRes.data.data)
      : initialSettings;

    const maxRadiusKm = Number(dbSettings.deliveryRadiusKm) || 5;
    let distanceKm: number | null = null;
    let isWithinDeliveryRadius = true;

    if (
      dbCustomer.latitude !== undefined &&
      dbCustomer.latitude !== null &&
      dbCustomer.longitude !== undefined &&
      dbCustomer.longitude !== null &&
      dbSettings.storeLatitude !== undefined &&
      dbSettings.storeLatitude !== null &&
      dbSettings.storeLongitude !== undefined &&
      dbSettings.storeLongitude !== null
    ) {
      distanceKm = haversineKm(
        Number(dbSettings.storeLatitude),
        Number(dbSettings.storeLongitude),
        Number(dbCustomer.latitude),
        Number(dbCustomer.longitude)
      );
      isWithinDeliveryRadius = distanceKm <= maxRadiusKm;

      // Sync customer's stored distance if outdated
      if (
        dbCustomer.distanceKm !== distanceKm ||
        dbCustomer.isWithinDeliveryRadius !== isWithinDeliveryRadius
      ) {
        await supabase
          .from('customers')
          .update({
            distance_km: distanceKm,
            is_within_delivery_radius: isWithinDeliveryRadius,
          })
          .eq('id', customerId);
      }
    }

    const requestedNh = String(req.query.neighborhood || dbCustomer.neighborhood || '')
      .toLowerCase()
      .trim();
    const matchedArea = dbAreas.find((a) => a.active && a.name.toLowerCase().trim() === requestedNh);

    let rawDeliveryFee = 0;
    if (matchedArea) {
      rawDeliveryFee = matchedArea.fee;
    } else {
      rawDeliveryFee = Number(dbSettings.deliveryFee) || 5.0;
      if (dbSettings.pricePerKm && distanceKm !== null && distanceKm > 1) {
        rawDeliveryFee += (distanceKm - 1) * Number(dbSettings.pricePerKm);
      }
    }
    rawDeliveryFee = Math.round(rawDeliveryFee * 100) / 100;

    const subtotalParam = req.query.subtotal !== undefined ? Number(req.query.subtotal) : null;
    let deliveryFee = rawDeliveryFee;
    if (
      subtotalParam !== null &&
      !Number.isNaN(subtotalParam) &&
      dbSettings.freeDeliveryThreshold &&
      subtotalParam >= Number(dbSettings.freeDeliveryThreshold)
    ) {
      deliveryFee = 0;
    }

    return res.json({
      distanceKm,
      isWithinDeliveryRadius,
      deliveryRadiusKm: maxRadiusKm,
      deliveryFee,
      rawDeliveryFee,
      freeDeliveryThreshold: Number(dbSettings.freeDeliveryThreshold) || 0,
      latitude: dbCustomer.latitude ?? null,
      longitude: dbCustomer.longitude ?? null,
    });
  });

  // ---------------------------------------------------------------------------
  // CUSTOMER ORDER TRACKING ROUTES (Protected by requireCustomer)
  // ---------------------------------------------------------------------------
  router.get('/customer/orders', requireCustomer, async (req, res) => {
    const customerId = (req as any).customerId;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Supabase Error] customer orders list:', error.message);
      return res.status(500).json({ error: error.message });
    }

    return res.json((data || []).map(orderFromDB));
  });

  router.get('/customer/orders/:id', requireCustomer, async (req, res) => {
    const customerId = (req as any).customerId;
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('customer_id', customerId)
      .maybeSingle();

    if (error) {
      console.error('[Supabase Error] customer order detail:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!data) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    return res.json(orderFromDB(data));
  });

  // ---------------------------------------------------------------------------
  // COUPONS: VALIDATE (Requires Customer) & ADMIN MANAGEMENT (Requires Admin)
  // ---------------------------------------------------------------------------
  router.post('/coupons/validate', requireCustomer, async (req, res) => {
    const { code, subtotal, items } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Código de cupom obrigatório.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanCode = code.toUpperCase().trim();
    const { data: row, error } = await supabase
      .from('coupons')
      .select('*')
      .eq('code', cleanCode)
      .maybeSingle();

    if (error || !row) {
      return res.status(404).json({ error: 'Cupom inexistente ou inválido.' });
    }

    const coupon = couponFromDB(row);

    if (!coupon.active) {
      return res.status(400).json({ error: 'Este cupom não está ativo no momento.' });
    }

    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Este cupom já expirou.' });
    }

    if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ error: 'Este cupom está esgotado (limite máximo de usos atingido).' });
    }

    let numSubtotal = Number(subtotal) || 0;
    if (Array.isArray(items) && items.length > 0) {
      const { data: prodRows } = await supabase.from('products').select('*');
      if (prodRows) {
        const dbProds = prodRows.map(productFromDB);
        let calculatedSub = 0;
        for (const it of items) {
          const sp = dbProds.find((p) => p.id === (it.productId || it.id));
          if (sp && sp.active) {
            const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
            calculatedSub += getEffectivePrice(sp) * qty;
          }
        }
        if (calculatedSub > 0) {
          numSubtotal = Math.round(calculatedSub * 100) / 100;
        }
      }
    }

    if (coupon.minOrder && numSubtotal < coupon.minOrder) {
      const formattedMin = coupon.minOrder.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return res.status(400).json({ error: `Pedido abaixo do mínimo de ${formattedMin} para utilizar este cupom.` });
    }

    const discount = calculateCouponDiscount(coupon, numSubtotal);

    return res.json({
      valid: true,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discount,
      minOrder: coupon.minOrder,
      maxDiscount: coupon.maxDiscount,
    });
  });

  router.get('/admin/coupons', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase.from('coupons').select('*').order('code');
    if (error) return res.status(500).json({ error: error.message });

    res.json((data || []).map(couponFromDB));
  });

  router.post('/admin/coupons', requireAdmin, async (req, res) => {
    const { code, type, value, minOrder, maxDiscount, active, expiresAt, maxUses } = req.body || {};
    if (!code || !type || value === undefined) {
      return res.status(400).json({ error: 'Código, tipo e valor são obrigatórios.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanCode = String(code).toUpperCase().trim();
    const newCoupon: Coupon = {
      code: cleanCode,
      type: type === 'fixed' ? 'fixed' : 'percent',
      value: Number(value),
      minOrder: minOrder ? Number(minOrder) : undefined,
      maxDiscount:
        type !== 'fixed' && maxDiscount !== undefined && maxDiscount !== null && Number(maxDiscount) > 0
          ? Number(maxDiscount)
          : undefined,
      active: active !== false,
      expiresAt: expiresAt || null,
      maxUses: maxUses ? Number(maxUses) : null,
      usedCount: 0,
    };

    const { error } = await supabase.from('coupons').insert(couponToDB(newCoupon));
    if (error) {
      if (error.code === '23505' || error.message?.includes('unique') || error.message?.includes('duplicate')) {
        return res.status(409).json({ error: 'Já existe um cupom com este código.' });
      }
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(newCoupon);
  });

  router.put('/admin/coupons/:code', requireAdmin, async (req, res) => {
    const { code } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanCode = code.toUpperCase().trim();
    const { type, value, minOrder, maxDiscount, active, expiresAt, maxUses } = req.body || {};

    const updateData: any = {};
    if (type !== undefined) updateData.type = type;
    if (value !== undefined) updateData.value = Number(value);
    if (minOrder !== undefined) updateData.min_order = minOrder ? Number(minOrder) : null;
    if (maxDiscount !== undefined) {
      updateData.max_discount = maxDiscount && Number(maxDiscount) > 0 ? Number(maxDiscount) : null;
    }
    if (active !== undefined) updateData.active = Boolean(active);
    if (expiresAt !== undefined) updateData.expires_at = expiresAt || null;
    if (maxUses !== undefined) updateData.max_uses = maxUses ? Number(maxUses) : null;

    const { data, error } = await supabase
      .from('coupons')
      .update(updateData)
      .eq('code', cleanCode)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      return res.status(500).json({ error: error?.message || 'Cupom não encontrado.' });
    }

    res.json(couponFromDB(data));
  });

  router.delete('/admin/coupons/:code', requireAdmin, async (req, res) => {
    const { code } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanCode = code.toUpperCase().trim();
    const { error } = await supabase.from('coupons').delete().eq('code', cleanCode);
    if (error) return res.status(500).json({ error: error.message });

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // PUBLIC STATE: GET /state
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

      if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
      if (areasRes.error) return res.status(500).json({ error: areasRes.error.message });

      let settings = sanitizePublicSettings(initialSettings);
      if (settingsRes.data && settingsRes.data.data) {
        settings = sanitizePublicSettings(settingsRes.data.data);
      } else {
        await supabase.from('store_settings').upsert({
          id: 'default',
          data: sanitizePublicSettings(initialSettings),
          updated_at: new Date().toISOString(),
        });
      }

      const products = (prodRes.data || []).map(productFromDB).map(sanitizePublicProduct);
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
      const [prodRes, areasRes, custRes, orderRes, couponsRes, settingsRes] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase.from('delivery_areas').select('*'),
        supabase.from('customers').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('*').order('created_at', { ascending: false }),
        supabase.from('coupons').select('*').order('code'),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);

      if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
      if (areasRes.error) return res.status(500).json({ error: areasRes.error.message });
      if (custRes.error) return res.status(500).json({ error: custRes.error.message });
      if (orderRes.error) return res.status(500).json({ error: orderRes.error.message });
      if (couponsRes.error) return res.status(500).json({ error: couponsRes.error.message });

      let settings = sanitizePublicSettings(initialSettings);
      if (settingsRes.data && settingsRes.data.data) {
        settings = sanitizePublicSettings(settingsRes.data.data);
      }

      return res.json({
        products: (prodRes.data || []).map(productFromDB),
        orders: (orderRes.data || []).map(orderFromDB),
        deliveryAreas: (areasRes.data || []).map(deliveryAreaFromDB),
        customers: (custRes.data || []).map(customerFromDB),
        coupons: (couponsRes.data || []).map(couponFromDB),
        settings,
      });
    } catch (err: any) {
      console.error('[Server Error] GET /api/admin/state:', err);
      return res.status(500).json({ error: err.message || 'Erro interno ao carregar estado.' });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN POLLING FOR NEW ORDERS: GET /admin/orders
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
  router.get('/products', async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado.' });

    const { data, error } = await supabase.from('products').select('*').order('name');
    if (error) return res.status(500).json({ error: error.message });

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const signed = token ? verifySignedToken(token) : null;
    const isAdmin = signed?.role === 'admin';

    const mapped = (data || []).map(productFromDB);
    res.json(isAdmin ? mapped : mapped.map(sanitizePublicProduct));
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

  // Requirement: Em PUT /api/products/:id NUNCA altere a coluna stock (ignore stock do corpo)
  // e não apague a promoção sem querer (só altera promo_price e promo_ends_at se esses campos vierem explicitamente no corpo)
  router.put('/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const body = req.body || {};
    const updateData: Record<string, any> = {
      name: body.name,
      category: body.category,
      volume: body.volume || null,
      price: Number(body.price) || 0,
      cost_price: Number(body.costPrice) || 0,
      min_stock: Number(body.minStock ?? 10),
      is_cold: body.isCold !== false,
      image: body.image || null,
      sku: body.sku || null,
      active: body.active !== false,
      description: body.description || '',
      updated_at: new Date().toISOString(),
    };

    if (Object.prototype.hasOwnProperty.call(body, 'promoPrice')) {
      updateData.promo_price =
        body.promoPrice !== null && body.promoPrice !== undefined && Number(body.promoPrice) > 0
          ? Number(body.promoPrice)
          : null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'promoEndsAt')) {
      updateData.promo_ends_at = body.promoEndsAt ? String(body.promoEndsAt) : null;
    }

    const { data, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      console.error('[Supabase Error] products update:', error?.message);
      return res.status(500).json({ error: error?.message || 'Produto não encontrado.' });
    }

    res.json(productFromDB(data));
  });

  // Requirement: Rotas exclusivas para gerenciar promoção do produto (sem mexer em price nem stock)
  router.put('/admin/products/:id/promotion', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { promoPrice, promoEndsAt } = req.body || {};
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existing, error: fetchErr } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const normalPrice = Number(existing.price) || 0;
    const numPromo = Number(promoPrice);

    if (Number.isNaN(numPromo) || numPromo <= 0) {
      return res.status(400).json({ error: 'O preço promocional deve ser maior que zero.' });
    }

    if (numPromo >= normalPrice) {
      const formattedNormal = normalPrice.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return res.status(400).json({
        error: `O preço promocional precisa ser menor que o preço normal (${formattedNormal}).`,
      });
    }

    const cleanEndsAt = promoEndsAt && String(promoEndsAt).trim() ? new Date(promoEndsAt).toISOString() : null;

    const { data: updated, error: updateErr } = await supabase
      .from('products')
      .update({
        promo_price: Math.round(numPromo * 100) / 100,
        promo_ends_at: cleanEndsAt,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateErr || !updated) {
      console.error('[Supabase Error] product promotion update:', updateErr?.message);
      return res.status(500).json({ error: updateErr?.message || 'Erro ao salvar promoção.' });
    }

    res.json(productFromDB(updated));
  });

  router.delete('/admin/products/:id/promotion', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: updated, error: updateErr } = await supabase
      .from('products')
      .update({
        promo_price: null,
        promo_ends_at: null,
      })
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateErr || !updated) {
      console.error('[Supabase Error] product promotion delete:', updateErr?.message);
      return res.status(404).json({ error: updateErr?.message || 'Produto não encontrado.' });
    }

    res.json(productFromDB(updated));
  });

  // Requirement: Alteração de estoque manual via POST /api/products/:id/stock (decrement_stock para delta negativo e restore_stock para positivo)
  router.post('/products/:id/stock', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const delta = Number(req.body?.delta) || 0;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    if (delta === 0) {
      const { data: row } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
      return res.json(row ? productFromDB(row) : null);
    }

    if (delta > 0) {
      const { error: rpcErr } = await supabase.rpc('restore_stock', {
        p_items: [{ id, qty: delta }],
      });
      if (rpcErr) {
        console.error('[RPC Error] restore_stock:', rpcErr.message);
        return res.status(500).json({ error: rpcErr.message });
      }
    } else {
      const { error: rpcErr } = await supabase.rpc('decrement_stock', {
        p_items: [{ id, qty: Math.abs(delta) }],
      });
      if (rpcErr) {
        if (rpcErr.message?.includes('ESTOQUE_INSUFICIENTE')) {
          return res.status(409).json({ error: 'Estoque insuficiente para esta redução.' });
        }
        return res.status(500).json({ error: rpcErr.message });
      }
    }

    const { data: updatedRow, error: fetchErr } = await supabase.from('products').select('*').eq('id', id).single();
    if (fetchErr || !updatedRow) {
      return res.status(500).json({ error: 'Produto não encontrado após atualização.' });
    }

    res.json(productFromDB(updatedRow));
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
  // CUSTOMERS ROUTES (Admin only)
  // ---------------------------------------------------------------------------
  router.get('/customers', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data, error } = await supabase.from('customers').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(customerFromDB));
  });

  router.post('/customers', requireAdmin, async (req, res) => {
    const cust = req.body as CustomerProfile;
    if (!cust || !cust.name || !cust.phone) {
      return res.status(400).json({ error: 'Nome e telefone são obrigatórios.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const parsedLat =
      cust.latitude !== undefined && cust.latitude !== null && !Number.isNaN(Number(cust.latitude))
        ? Number(cust.latitude)
        : undefined;
    const parsedLng =
      cust.longitude !== undefined && cust.longitude !== null && !Number.isNaN(Number(cust.longitude))
        ? Number(cust.longitude)
        : undefined;

    const serverMetrics = await computeCustomerServerMetrics(supabase, parsedLat, parsedLng);

    const newCust: CustomerProfile = {
      ...cust,
      id: cust.id || `cust-${Date.now()}`,
      latitude: parsedLat,
      longitude: parsedLng,
      distanceKm: serverMetrics.distanceKm,
      isWithinDeliveryRadius: serverMetrics.isWithinDeliveryRadius,
      createdAt: new Date().toISOString(),
      totalOrdersCount: 0,
      totalSpent: 0,
    };

    const { error } = await supabase.from('customers').insert(customerToDB(newCust));
    if (error) {
      console.error('[Supabase Error] customers insert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(newCust);
  });

  router.put('/customers/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existing, error: fetchErr } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
    if (fetchErr || !existing) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    const existingMapped = customerFromDB(existing);
    const nextLat =
      req.body?.latitude !== undefined && req.body?.latitude !== null && !Number.isNaN(Number(req.body.latitude))
        ? Number(req.body.latitude)
        : existingMapped.latitude;
    const nextLng =
      req.body?.longitude !== undefined && req.body?.longitude !== null && !Number.isNaN(Number(req.body.longitude))
        ? Number(req.body.longitude)
        : existingMapped.longitude;

    const serverMetrics = await computeCustomerServerMetrics(supabase, nextLat, nextLng);

    const updated: CustomerProfile = {
      ...existingMapped,
      ...req.body,
      id,
      latitude: nextLat,
      longitude: nextLng,
      distanceKm: serverMetrics.distanceKm,
      isWithinDeliveryRadius: serverMetrics.isWithinDeliveryRadius,
    };
    const { data: saved, error } = await supabase
      .from('customers')
      .update(customerToDB(updated))
      .eq('id', id)
      .select('*')
      .single();

    if (error || !saved) {
      console.error('[Supabase Error] customers update:', error?.message);
      return res.status(500).json({ error: error?.message || 'Erro ao atualizar cliente.' });
    }

    res.json(customerFromDB(saved));
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

    const supabase = getSupabase();
    if (!supabase) {
      console.error('[Supabase Error] Supabase não configurado no servidor.');
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    // Determine authentication: admin token (for balcão) or customer token (for store)
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const signed = token ? verifySignedToken(token) : null;

    const isAdmin = signed?.role === 'admin';
    const isCustomer = signed?.role === 'customer' && Boolean(signed.customerId);

    // 1. Fetch current products, delivery areas, settings directly from Supabase
    const [prodRes, areasRes, settingsRes] = await Promise.all([
      supabase.from('products').select('*'),
      supabase.from('delivery_areas').select('*').eq('active', true),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);

    if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
    const dbProducts = (prodRes.data || []).map(productFromDB);
    const dbAreas = (areasRes.data || []).map(deliveryAreaFromDB);
    const dbSettings = settingsRes.data?.data ? sanitizePublicSettings(settingsRes.data.data) : initialSettings;

    const maxRadiusKm = Number(dbSettings.deliveryRadiusKm) || 5;
    let customerId: string | undefined = undefined;
    let customerData: any = null;
    let serverDistanceKm: number | undefined = undefined;
    let serverIsWithinRadius: boolean | undefined = undefined;

    if (rawOrder.source === 'balcao' && isAdmin) {
      // Admin POS sale
      customerData = {
        name: rawOrder.customer?.name ? String(rawOrder.customer.name).trim() : 'Cliente Balcão',
        phone: rawOrder.customer?.phone ? String(rawOrder.customer.phone).trim() : '(Balcão)',
        address: rawOrder.customer?.address || 'Venda Presencial no Depósito',
        number: rawOrder.customer?.number || 'Balcão',
        neighborhood: rawOrder.customer?.neighborhood || 'Loja Física',
        complement: rawOrder.customer?.complement || undefined,
        reference: rawOrder.customer?.reference || undefined,
      };
      customerId = rawOrder.customerId || undefined;
    } else {
      // Store checkout - requires customer token
      if (!isCustomer || !signed?.customerId) {
        return res.status(401).json({
          error: 'Faça login ou crie sua conta para finalizar o pedido.',
        });
      }

      customerId = signed.customerId;
      const { data: custRow, error: custErr } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle();

      if (custErr || !custRow) {
        return res.status(401).json({ error: 'Cliente não encontrado. Faça login novamente.' });
      }

      const dbCustomer = customerFromDB(custRow);

      // Calculate distance strictly from the customer's saved DB coordinates (never from req.body)
      if (
        dbCustomer.latitude !== undefined &&
        dbCustomer.latitude !== null &&
        dbCustomer.longitude !== undefined &&
        dbCustomer.longitude !== null &&
        dbSettings.storeLatitude !== undefined &&
        dbSettings.storeLatitude !== null &&
        dbSettings.storeLongitude !== undefined &&
        dbSettings.storeLongitude !== null
      ) {
        serverDistanceKm = haversineKm(
          Number(dbSettings.storeLatitude),
          Number(dbSettings.storeLongitude),
          Number(dbCustomer.latitude),
          Number(dbCustomer.longitude)
        );
        serverIsWithinRadius = serverDistanceKm <= maxRadiusKm;
      }

      // Use customer data directly from the database by the token's id
      customerData = {
        name: dbCustomer.name,
        phone: dbCustomer.phone,
        email: dbCustomer.email || undefined,
        address: rawOrder.deliveryType === 'delivery' ? (dbCustomer.address || rawOrder.customer?.address || '') : 'Retirada no Depósito',
        number: rawOrder.deliveryType === 'delivery' ? (dbCustomer.number || rawOrder.customer?.number || '') : 'S/N',
        neighborhood: rawOrder.deliveryType === 'delivery' ? (dbCustomer.neighborhood || rawOrder.customer?.neighborhood || '') : 'Depósito',
        complement: dbCustomer.complement || rawOrder.customer?.complement || undefined,
        reference: dbCustomer.reference || rawOrder.customer?.reference || undefined,
        cep: dbCustomer.cep || rawOrder.customer?.cep || undefined,
        city: dbCustomer.city || rawOrder.customer?.city || undefined,
        state: dbCustomer.state || rawOrder.customer?.state || undefined,
        latitude: dbCustomer.latitude,
        longitude: dbCustomer.longitude,
        distanceKm: serverDistanceKm,
        isWithinDeliveryRadius: serverIsWithinRadius,
      };
    }

    // 2. Validate items and recalculate subtotal
    let recalculatedSubtotal = 0;
    const validatedItems: any[] = [];
    const stockPayload: { id: string; qty: number }[] = [];

    for (const item of rawOrder.items) {
      const serverProduct = dbProducts.find((p) => p.id === item.productId);
      if (!serverProduct || !serverProduct.active) {
        return res.status(400).json({
          error: `O produto "${item.name || item.productId}" não está disponível no momento.`,
        });
      }

      const requestedQty = Math.max(1, parseInt(item.quantity, 10) || 1);
      if (serverProduct.stock < requestedQty) {
        return res.status(409).json({
          error: `Estoque insuficiente para "${serverProduct.name}". Disponível em estoque: ${serverProduct.stock} un.`,
        });
      }

      const effectivePrice = getEffectivePrice(serverProduct);
      const itemTotal = effectivePrice * requestedQty;
      recalculatedSubtotal += itemTotal;

      validatedItems.push({
        productId: serverProduct.id,
        name: serverProduct.name,
        volume: serverProduct.volume,
        price: effectivePrice,
        originalPrice: serverProduct.price,
        costPrice: serverProduct.costPrice,
        quantity: requestedQty,
        isCold: serverProduct.isCold,
      });

      stockPayload.push({
        id: serverProduct.id,
        qty: requestedQty,
      });
    }

    // 3. Recalculate Delivery Fee & Enforce Delivery Radius on Server
    const deliveryType = rawOrder.deliveryType === 'retirada' ? 'retirada' : 'delivery';
    let deliveryFee = 0;

    if (deliveryType === 'delivery') {
      // Entrega exige localização confirmada (sem coordenada não dá para checar o raio)
      if (rawOrder.source !== 'balcao' && serverDistanceKm === undefined) {
        return res.status(400).json({
          error: 'Confirme sua localização no mapa (Meus dados > Endereço) antes de pedir entrega, ou escolha Retirar no Depósito.',
        });
      }
      if (rawOrder.source !== 'balcao' && serverDistanceKm !== undefined && serverDistanceKm > maxRadiusKm) {
        return res.status(400).json({
          error: `Endereço fora do raio de entrega de ${maxRadiusKm} km. Escolha Retirar no Depósito.`,
        });
      }

      const customerNh = (customerData.neighborhood || '').toLowerCase().trim();
      const matchedArea = dbAreas.find((a) => a.active && a.name.toLowerCase().trim() === customerNh);

      if (matchedArea) {
        deliveryFee = matchedArea.fee;
      } else {
        deliveryFee = dbSettings.deliveryFee || 5.0;
        if (dbSettings.pricePerKm && serverDistanceKm !== undefined) {
          if (serverDistanceKm > 1) {
            deliveryFee += (serverDistanceKm - 1) * dbSettings.pricePerKm;
          }
        }
      }
      deliveryFee = Math.round(deliveryFee * 100) / 100;

      if (dbSettings.freeDeliveryThreshold && recalculatedSubtotal >= dbSettings.freeDeliveryThreshold) {
        deliveryFee = 0;
      }
    }

    // 4. Validate & calculate Coupon Discount
    let discount = 0;
    let validCouponCode: string | undefined = undefined;

    if (rawOrder.couponCode && typeof rawOrder.couponCode === 'string') {
      const requestedCode = rawOrder.couponCode.toUpperCase().trim();
      const { data: couponRow, error: couponFetchErr } = await supabase
        .from('coupons')
        .select('*')
        .eq('code', requestedCode)
        .maybeSingle();

      if (couponFetchErr || !couponRow) {
        return res.status(400).json({ error: 'Cupom de desconto inválido ou inexistente.' });
      }

      const coupon = couponFromDB(couponRow);
      if (!coupon.active) {
        return res.status(400).json({ error: 'O cupom inserido está desativado.' });
      }

      if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
        return res.status(400).json({ error: 'O cupom inserido já expirou.' });
      }

      if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount >= coupon.maxUses) {
        return res.status(400).json({ error: 'O cupom inserido atingiu o limite máximo de utilizações.' });
      }

      if (coupon.minOrder && recalculatedSubtotal < coupon.minOrder) {
        const formattedMin = coupon.minOrder.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        return res.status(400).json({ error: `O valor dos produtos precisa ser de no mínimo ${formattedMin} para este cupom.` });
      }

      discount = calculateCouponDiscount(coupon, recalculatedSubtotal);

      validCouponCode = coupon.code;
    }

    const calculatedTotal = Math.max(0, recalculatedSubtotal - discount + deliveryFee);

    // 5. Decrement Stock via RPC decrement_stock(p_items jsonb)
    const { error: decStockErr } = await supabase.rpc('decrement_stock', {
      p_items: stockPayload,
    });

    if (decStockErr) {
      console.error('[RPC Error] decrement_stock:', decStockErr.message);
      let prodName = 'um dos produtos selecionados';
      const match = decStockErr.message?.match(/ESTOQUE_INSUFICIENTE:([^\s,]+)/);
      if (match && match[1]) {
        const offending = dbProducts.find((p) => p.id === match[1]);
        if (offending) prodName = offending.name;
      }
      return res.status(409).json({ error: `Estoque insuficiente para "${prodName}".` });
    }

    // 6. Redeem Coupon via RPC redeem_coupon(p_code text)
    if (validCouponCode) {
      const { error: redeemErr } = await supabase.rpc('redeem_coupon', {
        p_code: validCouponCode,
      });

      if (redeemErr) {
        console.error('[RPC Error] redeem_coupon:', redeemErr.message);
        // Rollback stock decrement!
        await supabase.rpc('restore_stock', { p_items: stockPayload });
        return res.status(400).json({ error: 'Não foi possível resgatar o cupom: ' + redeemErr.message });
      }
    }

    // 7. Persist Order in database
    // Número do pedido sempre gerado pelo servidor (nunca aceito do navegador)
    const orderId = `PED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const newOrder: Order = {
      id: orderId,
      source: rawOrder.source === 'balcao' ? 'balcao' : 'online',
      status: 'pendente', // Force pending
      customer: customerData,
      customerId,
      couponCode: validCouponCode,
      discount: Math.round(discount * 100) / 100,
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

    const { error: orderErr } = await supabase.from('orders').insert(orderToDB(newOrder));
    if (orderErr) {
      console.error('[Supabase Error] orders upsert:', orderErr.message);
      // Rollback stock decrement!
      await supabase.rpc('restore_stock', { p_items: stockPayload });
      return res.status(500).json({ error: orderErr.message });
    }

    // 8. Update customer stats
    if (customerId) {
      try {
        const { data: currentCust } = await supabase.from('customers').select('total_orders_count, total_spent').eq('id', customerId).maybeSingle();
        await supabase
          .from('customers')
          .update({
            total_orders_count: (currentCust?.total_orders_count || 0) + 1,
            total_spent: Number(currentCust?.total_spent || 0) + newOrder.total,
            last_order_at: new Date().toISOString(),
          })
          .eq('id', customerId);
      } catch (custUpdateErr) {
        console.warn('[Warning] Falha ao atualizar estatísticas do cliente:', custUpdateErr);
      }
    }

    return res.status(201).json(newOrder);
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

  // Requirement: Ao mudar o status de um pedido para cancelado, devolva o estoque com restore_stock; se sair de cancelado para outro status, baixe de novo com decrement_stock.
  router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status: newStatus } = req.body || {};
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    // Fetch existing order
    const { data: existingRow, error: fetchOrderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchOrderErr || !existingRow) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const existingOrder = orderFromDB(existingRow);
    const oldStatus = existingOrder.status;

    if (newStatus && oldStatus !== newStatus) {
      const stockItems = (existingOrder.items || []).map((it) => ({
        id: it.productId,
        qty: it.quantity,
      }));

      if (stockItems.length > 0) {
        if (oldStatus !== 'cancelado' && newStatus === 'cancelado') {
          // Returning stock
          const { error: restErr } = await supabase.rpc('restore_stock', { p_items: stockItems });
          if (restErr) {
            console.error('[RPC Error] restore_stock on cancel:', restErr.message);
            return res.status(500).json({ error: 'Erro ao devolver estoque: ' + restErr.message });
          }
        } else if (oldStatus === 'cancelado' && newStatus !== 'cancelado') {
          // Decreasing stock again
          const { error: decErr } = await supabase.rpc('decrement_stock', { p_items: stockItems });
          if (decErr) {
            console.error('[RPC Error] decrement_stock on uncancel:', decErr.message);
            if (decErr.message?.includes('ESTOQUE_INSUFICIENTE')) {
              return res.status(409).json({ error: 'Não é possível reativar o pedido: estoque insuficiente de um ou mais itens.' });
            }
            return res.status(500).json({ error: decErr.message });
          }
        }
      }
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
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
