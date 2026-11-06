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
  OrderItem,
  PaymentMethod,
  StoreSettings,
  DeliveryArea,
  CustomerProfile,
  OrderStatus,
  Coupon,
  DiningTable,
  TableTab,
  TableTabItem,
  TableWithTab,
  TabDetail,
  TabStatus,
  LinkedTable,
  GeoPrecision,
  StoreCategoryItem,
  ProductSortMode,
  AddonGroup,
  AddonOption,
  OrderItemAddon,
  ComboComponentItem,
  OrderItemComboComponent,
  slugifyCategoryId,
  buildInitialCategoriesFromProducts,
  reconcileStoreCategoriesWithProducts,
  getProductAddonGroups,
  isComboProduct,
  calculateComboMetrics,
  formatComboComponentProductName,
  canSellProductCase,
  StockMovement,
  StockMovementsResponse,
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

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000; // Raio da Terra em metros
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
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

export interface ServerGeoResolveResult {
  latitude: number;
  longitude: number;
  precisao: GeoPrecision;
  displayName: string;
}

async function resolveAddressGeocodeServer(
  supabase: SupabaseClient | null,
  params: {
    rua?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    query?: string;
    contactEmail?: string;
  }
): Promise<ServerGeoResolveResult | null> {
  let contactEmail = params.contactEmail || process.env.CONTACT_EMAIL || 'contato@depositoexpress.com.br';
  if (!params.contactEmail && supabase) {
    try {
      const { data: settingsRow, error: sErr } = await supabase
        .from('store_settings')
        .select('data')
        .eq('id', 'default')
        .maybeSingle();
      if (!sErr && settingsRow?.data) {
        const sData = settingsRow.data;
        if (sData.email && typeof sData.email === 'string' && sData.email.includes('@')) {
          contactEmail = sData.email.trim();
        } else if (sData.pixKey && typeof sData.pixKey === 'string' && sData.pixKey.includes('@')) {
          contactEmail = sData.pixKey.trim();
        }
      }
    } catch {
      // ignore fallback email lookup errors
    }
  }

  const userAgent = `DepositoExpress/1.0 (${contactEmail})`;

  let rua = String(params.rua || '').trim();
  const numero = String(params.numero || '').trim();
  let bairro = String(params.bairro || '').trim();
  let cidade = String(params.cidade || '').trim();
  let uf = String(params.uf || '').trim();
  const rawCep = String(params.cep || '').replace(/\D/g, '');
  const freeQuery = String(params.query || '').trim();

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
      return {
        latitude: hit1.lat,
        longitude: hit1.lon,
        precisao: 'exata',
        displayName: hit1.displayName,
      };
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
      return {
        latitude: hit2.lat,
        longitude: hit2.lon,
        precisao: 'rua',
        displayName: hit2.displayName,
      };
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
        return {
          latitude: hit3WithNum.lat,
          longitude: hit3WithNum.lon,
          precisao: 'exata',
          displayName: hit3WithNum.displayName,
        };
      }
    }

    const hit3 = await fetchNominatimStructured(
      { street: rua, city: cidade },
      userAgent
    );
    if (hit3) {
      return {
        latitude: hit3.lat,
        longitude: hit3.lon,
        precisao: 'rua',
        displayName: hit3.displayName,
      };
    }
  }

  // Additional structured fallback when city was not typed: try street + neighborhood or street free-form
  if (rua && !cidade) {
    const queryParts = [numero ? `${rua}, ${numero}` : rua, bairro, uf, 'Brasil'].filter(Boolean).join(', ');
    const hitStreet = await fetchNominatimStructured({ q: queryParts }, userAgent);
    if (hitStreet) {
      return {
        latitude: hitStreet.lat,
        longitude: hitStreet.lon,
        precisao: numero ? 'exata' : 'rua',
        displayName: hitStreet.displayName,
      };
    }
  }

  // Free-form query fallback if caller passed a raw query (e.g. store settings search)
  if (freeQuery && !rua && !rawCep) {
    const hitFree = await fetchNominatimStructured({ q: freeQuery }, userAgent);
    if (hitFree) {
      return {
        latitude: hitFree.lat,
        longitude: hitFree.lon,
        precisao: 'rua',
        displayName: hitFree.displayName,
      };
    }
  }

  // (b) Fallback: BrasilAPI coordinates and mark precisao as 'aproximada'
  if (rawCep.length === 8) {
    if (!brasilApiData) {
      brasilApiData = await fetchBrasilApiCepServer(rawCep);
    }
    if (brasilApiData && brasilApiData.lat !== undefined && brasilApiData.lng !== undefined) {
      return {
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
      };
    }
  }

  return null;
}

interface ValidatedCustomerGeoFields {
  error?: string;
  latitude?: number;
  longitude?: number;
  geoLatitude?: number;
  geoLongitude?: number;
  geoPrecision?: GeoPrecision;
  pinOffsetM?: number;
  locationVerified: boolean;
  distanceKm?: number;
  isWithinDeliveryRadius?: boolean;
}

async function resolveAndValidateCustomerAddress(
  supabase: SupabaseClient,
  input: {
    address?: string;
    number?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    cep?: string;
    pinLatitude?: number;
    pinLongitude?: number;
  }
): Promise<ValidatedCustomerGeoFields> {
  const rua = String(input.address || '').trim();
  const numero = String(input.number || '').trim();
  const bairro = String(input.neighborhood || '').trim();
  const cidade = String(input.city || '').trim();
  const uf = String(input.state || '').trim();
  const cep = String(input.cep || '').trim();

  const hasAddressFields = Boolean(rua || cep.replace(/\D/g, '').length === 8);
  const resolved = hasAddressFields
    ? await resolveAddressGeocodeServer(supabase, {
        rua,
        numero,
        bairro,
        cidade,
        uf,
        cep,
      })
    : null;

  const hasBrowserPin =
    input.pinLatitude !== undefined &&
    input.pinLatitude !== null &&
    !Number.isNaN(Number(input.pinLatitude)) &&
    input.pinLongitude !== undefined &&
    input.pinLongitude !== null &&
    !Number.isNaN(Number(input.pinLongitude));

  if (!resolved) {
    // Endereço não pôde ser geocodificado pelo servidor: aceite com location_verified = false e não trave o cadastro
    const fallbackLat = hasBrowserPin ? Number(input.pinLatitude) : undefined;
    const fallbackLng = hasBrowserPin ? Number(input.pinLongitude) : undefined;
    const metrics = await computeCustomerServerMetrics(supabase, fallbackLat, fallbackLng);
    return {
      latitude: fallbackLat,
      longitude: fallbackLng,
      geoLatitude: undefined,
      geoLongitude: undefined,
      geoPrecision: undefined,
      pinOffsetM: undefined,
      locationVerified: false,
      distanceKm: metrics.distanceKm,
      isWithinDeliveryRadius: metrics.isWithinDeliveryRadius ?? true,
    };
  }

  const geoLatitude = resolved.latitude;
  const geoLongitude = resolved.longitude;
  const geoPrecision = resolved.precisao;

  // Quem decide se o endereço está dentro da área de entrega é o ENDEREÇO DIGITADO (posição encontrada pelo servidor)
  const geoMetrics = await computeCustomerServerMetrics(supabase, geoLatitude, geoLongitude);

  // Se o endereço digitado estiver fora da área de entrega, recuse como hoje (mesmo que o alfinete esteja dentro)
  if (geoMetrics.isWithinDeliveryRadius === false) {
    const distLabel = geoMetrics.distanceKm !== undefined ? ` (${geoMetrics.distanceKm} km do depósito)` : '';
    return {
      error: `Endereço fora da área de entrega${distLabel}.`,
      locationVerified: false,
      distanceKm: geoMetrics.distanceKm,
      isWithinDeliveryRadius: false,
    };
  }

  let finalLat = geoLatitude;
  let finalLng = geoLongitude;
  let pinOffsetM = 0;
  let locationVerified = geoPrecision !== 'aproximada';

  if (hasBrowserPin) {
    const pinLat = Number(input.pinLatitude);
    const pinLng = Number(input.pinLongitude);
    pinOffsetM = haversineMeters(geoLatitude, geoLongitude, pinLat, pinLng);

    finalLat = pinLat;
    finalLng = pinLng;

    const isPinTooFar =
      (geoPrecision === 'exata' && pinOffsetM > 300) ||
      (geoPrecision === 'rua' && pinOffsetM > 800);

    // Se o alfinete vier longe do endereço digitado (>300 m exata ou >800 m rua),
    // aceite o cadastro/alteração, grave as coordenadas do alfinete, mas marque location_verified = false
    locationVerified = isPinTooFar ? false : geoPrecision !== 'aproximada';
  }

  return {
    latitude: finalLat,
    longitude: finalLng,
    geoLatitude,
    geoLongitude,
    geoPrecision,
    pinOffsetM,
    locationVerified,
    distanceKm: geoMetrics.distanceKm,
    isWithinDeliveryRadius: geoMetrics.isWithinDeliveryRadius,
  };
}



function parseProductCaseFields(body: any): { error?: string; caseSize: number | null; casePrice: number | null } {
  const rawSize = body?.caseSize !== undefined ? body.caseSize : body?.case_size;
  const rawPrice = body?.casePrice !== undefined ? body.casePrice : body?.case_price;

  const hasSize = rawSize !== undefined && rawSize !== null && String(rawSize).trim() !== '' && Number(rawSize) !== 0;
  const hasPrice = rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim() !== '' && Number(rawPrice) !== 0;

  if (!hasSize && !hasPrice) {
    return { caseSize: null, casePrice: null };
  }

  const sizeNum = Number(rawSize);

  if (!Number.isInteger(sizeNum) || sizeNum < 2 || sizeNum > 100) {
    return {
      error: 'Unidades por caixa deve ser um número inteiro entre 2 e 100.',
      caseSize: null,
      casePrice: null,
    };
  }

  if (!hasPrice) {
    return {
      caseSize: sizeNum,
      casePrice: null,
    };
  }

  const priceNum = Number(rawPrice);
  if (Number.isNaN(priceNum) || priceNum <= 0) {
    return {
      error: 'O preço da caixa fechada deve ser maior que zero.',
      caseSize: null,
      casePrice: null,
    };
  }

  return {
    caseSize: sizeNum,
    casePrice: Math.round(priceNum * 100) / 100,
  };
}

function parseValidItemQuantity(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const num = Number(raw);
  if (!Number.isInteger(num) || num < 1 || num > 999) {
    return null;
  }
  return num;
}

export const PRODUCT_COLUMNS_NO_IMAGE =
  'id,name,category,volume,price,promo_price,promo_ends_at,case_size,case_price,cost_price,stock,min_stock,is_cold,sku,active,description,updated_at';

export const MAX_PRODUCT_IMAGE_DECODED_BYTES = 200 * 1024; // 200 KB

export interface ProductImageMeta {
  hasImage: boolean;
  externalUrl: string | null;
  versionMs: number;
}

let productImageMetaCache: {
  map: Map<string, ProductImageMeta>;
  expiresAt: number;
} | null = null;

export function invalidateProductImageMetaCache(): void {
  productImageMetaCache = null;
}

export function parseUpdatedAtVersionMs(rawUpdatedAt: unknown): number {
  if (!rawUpdatedAt) return 1;
  const ms = new Date(String(rawUpdatedAt)).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 1;
}

export function buildProductImageUrl(
  productId: string,
  meta?: ProductImageMeta | null,
  fallbackUpdatedAt?: unknown
): string {
  if (!meta || !meta.hasImage) return '';
  if (meta.externalUrl) return meta.externalUrl;
  const v = meta.versionMs || parseUpdatedAtVersionMs(fallbackUpdatedAt);
  return `/api/products/${encodeURIComponent(productId)}/image?v=${v}`;
}

export async function fetchProductImageMetaMap(
  supabase: SupabaseClient,
  forceRefresh = false
): Promise<Map<string, ProductImageMeta>> {
  const now = Date.now();
  if (!forceRefresh && productImageMetaCache && productImageMetaCache.expiresAt > now) {
    return productImageMetaCache.map;
  }

  const [withImgRes, extUrlRes] = await Promise.all([
    supabase
      .from('products')
      .select('id,updated_at')
      .not('image', 'is', null)
      .neq('image', ''),
    supabase
      .from('products')
      .select('id,image,updated_at')
      .or('image.ilike.http://%,image.ilike.https://%'),
  ]);

  if (withImgRes.error) {
    console.error('[Supabase Error] fetchProductImageMetaMap (withImg):', withImgRes.error.message);
  }
  if (extUrlRes.error) {
    console.error('[Supabase Error] fetchProductImageMetaMap (extUrl):', extUrlRes.error.message);
  }

  const map = new Map<string, ProductImageMeta>();
  const extById = new Map<string, string>();

  for (const r of extUrlRes.data || []) {
    if (r?.id && typeof r.image === 'string') {
      extById.set(String(r.id), r.image.trim());
    }
  }

  for (const r of withImgRes.data || []) {
    if (!r?.id) continue;
    const id = String(r.id);
    map.set(id, {
      hasImage: true,
      externalUrl: extById.get(id) || null,
      versionMs: parseUpdatedAtVersionMs(r.updated_at),
    });
  }

  productImageMetaCache = {
    map,
    expiresAt: now + 30_000,
  };

  return map;
}

export function validateIncomingProductImage(rawImage: unknown): {
  error?: string;
  value: string | null;
  keepExisting: boolean;
  copyFromProductId?: string;
  decodedBytes?: number;
} {
  if (rawImage === undefined) {
    return { value: null, keepExisting: true };
  }
  if (rawImage === null || typeof rawImage !== 'string') {
    return { value: null, keepExisting: false };
  }
  const trimmed = rawImage.trim();
  if (!trimmed) {
    return { value: null, keepExisting: false };
  }

  const localApiMatch = trimmed.match(/^\/api\/products\/([^/?#]+)\/image/i);
  if (localApiMatch) {
    let sourceId = localApiMatch[1];
    try {
      sourceId = decodeURIComponent(sourceId);
    } catch {
      // ignore decode error
    }
    return {
      value: null,
      keepExisting: true,
      copyFromProductId: sourceId,
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    if (trimmed.length > 2048) {
      return { error: 'URL da imagem muito longa.', value: null, keepExisting: false };
    }
    return { value: trimmed, keepExisting: false };
  }

  const dataMatch = trimmed.match(/^data:(image\/(jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!dataMatch) {
    if (trimmed.startsWith('data:')) {
      return {
        error: 'Formato de imagem não suportado. Use apenas JPG, PNG ou WebP.',
        value: null,
        keepExisting: false,
      };
    }
    return { error: 'Formato de imagem inválido.', value: null, keepExisting: false };
  }

  const base64Payload = dataMatch[3].replace(/\s+/g, '');
  const buffer = Buffer.from(base64Payload, 'base64');
  if (!buffer || buffer.length === 0) {
    return { error: 'Imagem inválida ou vazia.', value: null, keepExisting: false };
  }

  if (buffer.length > MAX_PRODUCT_IMAGE_DECODED_BYTES) {
    return {
      error: 'Foto muito pesada. Use uma imagem menor',
      value: null,
      keepExisting: false,
      decodedBytes: buffer.length,
    };
  }

  const mime = dataMatch[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : dataMatch[1].toLowerCase();
  return {
    value: `data:${mime};base64,${base64Payload}`,
    keepExisting: false,
    decodedBytes: buffer.length,
  };
}

function productToDB(p: Product, imageValue: string | null = null) {
  const promoPriceVal =
    p.promoPrice !== undefined && p.promoPrice !== null && Number(p.promoPrice) > 0
      ? Number(p.promoPrice)
      : null;
  const promoEndsAtVal = p.promoEndsAt ? String(p.promoEndsAt) : null;
  const parsedCase = parseProductCaseFields(p);

  return {
    id: p.id,
    name: p.name,
    category: p.category,
    volume: p.volume || null,
    price: Number(p.price) || 0,
    promo_price: promoPriceVal,
    promo_ends_at: promoEndsAtVal,
    case_size: parsedCase.caseSize,
    case_price: parsedCase.casePrice,
    cost_price: Number(p.costPrice) || 0,
    stock: Number(p.stock) || 0,
    min_stock: Number(p.minStock ?? 10),
    is_cold: p.isCold !== false,
    image: imageValue,
    sku: p.sku || null,
    active: p.active !== false,
    description: p.description || '',
    updated_at: new Date().toISOString(),
  };
}

function productFromDB(row: any, imageMetaMap?: Map<string, ProductImageMeta>): Product {
  const rawCaseSize = row.case_size !== null && row.case_size !== undefined ? Number(row.case_size) : null;
  const rawCasePrice = row.case_price !== null && row.case_price !== undefined ? Number(row.case_price) : null;
  const hasValidCaseSize =
    rawCaseSize !== null &&
    Number.isInteger(rawCaseSize) &&
    rawCaseSize >= 2 &&
    rawCaseSize <= 100;
  const hasValidCasePrice =
    hasValidCaseSize &&
    rawCasePrice !== null &&
    rawCasePrice > 0;

  const id = String(row.id);
  const updatedAtStr = row.updated_at ? String(row.updated_at) : undefined;
  let imageUrl = '';

  if (imageMetaMap) {
    const meta = imageMetaMap.get(id);
    imageUrl = buildProductImageUrl(id, meta, updatedAtStr);
  } else if (typeof row.image === 'string' && row.image.trim() !== '') {
    const rawImg = row.image.trim();
    if (/^https?:\/\//i.test(rawImg)) {
      imageUrl = rawImg;
    } else {
      imageUrl = `/api/products/${encodeURIComponent(id)}/image?v=${parseUpdatedAtVersionMs(updatedAtStr)}`;
    }
  }

  return {
    id,
    name: String(row.name || ''),
    category: row.category as any,
    volume: row.volume || '',
    price: Number(row.price || 0),
    promoPrice:
      row.promo_price !== null && row.promo_price !== undefined && Number(row.promo_price) > 0
        ? Number(row.promo_price)
        : null,
    promoEndsAt: row.promo_ends_at ? String(row.promo_ends_at) : null,
    caseSize: hasValidCaseSize ? rawCaseSize : null,
    casePrice: hasValidCasePrice ? rawCasePrice : null,
    costPrice: Number(row.cost_price || 0),
    stock: Number(row.stock || 0),
    minStock: row.min_stock !== null && row.min_stock !== undefined ? Number(row.min_stock) : 10,
    isCold: row.is_cold ?? true,
    // Never include base64 data inside product objects returned in lists
    image: '',
    imageUrl,
    sku: row.sku || '',
    active: row.active ?? true,
    description: row.description || '',
    updatedAt: updatedAtStr,
  };
}

function mapProductsFromDB(rows: any[] | null | undefined, imageMetaMap?: Map<string, ProductImageMeta>): Product[] {
  return (rows || []).map((r) => productFromDB(r, imageMetaMap));
}

function sanitizePublicProduct(p: Product): Omit<Product, 'costPrice' | 'minStock'> {
  const activePromo = isPromoActive(p);
  const { costPrice: _costPrice, minStock: _minStock, ...rest } = p;
  return {
    ...rest,
    image: '',
    imageUrl: p.imageUrl || '',
    promoPrice: activePromo ? (p.promoPrice ?? null) : null,
    promoEndsAt: activePromo ? (p.promoEndsAt ?? null) : null,
    caseSize: p.caseSize ?? null,
    casePrice: p.casePrice ?? null,
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
  const rawGeoLat = c.geoLatitude !== undefined ? c.geoLatitude : c.geo_latitude;
  const rawGeoLng = c.geoLongitude !== undefined ? c.geoLongitude : c.geo_longitude;
  const rawGeoPrec = c.geoPrecision !== undefined ? c.geoPrecision : c.geo_precision;
  const rawPinOffset = c.pinOffsetM !== undefined ? c.pinOffsetM : c.pin_offset_m;
  const rawLocVerified = c.locationVerified !== undefined ? c.locationVerified : c.location_verified;

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
    geo_latitude: rawGeoLat !== undefined && rawGeoLat !== null ? Number(rawGeoLat) : null,
    geo_longitude: rawGeoLng !== undefined && rawGeoLng !== null ? Number(rawGeoLng) : null,
    geo_precision: rawGeoPrec || null,
    pin_offset_m:
      rawPinOffset !== undefined && rawPinOffset !== null && !Number.isNaN(Number(rawPinOffset))
        ? Math.round(Number(rawPinOffset))
        : null,
    location_verified: Boolean(rawLocVerified && rawGeoLat !== undefined && rawGeoLat !== null),
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
  const hasGeoLat = row.geo_latitude !== null && row.geo_latitude !== undefined;
  const geoLat = hasGeoLat ? Number(row.geo_latitude) : undefined;
  const geoLng =
    row.geo_longitude !== null && row.geo_longitude !== undefined
      ? Number(row.geo_longitude)
      : undefined;
  const geoPrec: GeoPrecision | undefined =
    row.geo_precision === 'exata' || row.geo_precision === 'rua' || row.geo_precision === 'aproximada'
      ? row.geo_precision
      : undefined;
  const pinOffset =
    row.pin_offset_m !== null && row.pin_offset_m !== undefined
      ? Number(row.pin_offset_m)
      : undefined;
  const locVerified = hasGeoLat ? Boolean(row.location_verified) : false;

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
    geoLatitude: geoLat,
    geoLongitude: geoLng,
    geoPrecision: geoPrec,
    pinOffsetM: pinOffset,
    locationVerified: locVerified,
    geo_latitude: geoLat ?? null,
    geo_longitude: geoLng ?? null,
    geo_precision: geoPrec ?? null,
    pin_offset_m: pinOffset ?? null,
    location_verified: locVerified,
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

async function ensureLegacyCustomerGeocoded(
  supabase: SupabaseClient,
  custRow: any
): Promise<{ customer: CustomerProfile; pinRejectedError?: string }> {
  if (custRow.geo_latitude !== null && custRow.geo_latitude !== undefined) {
    return { customer: customerFromDB(custRow) };
  }

  const hasAddress = Boolean(
    (custRow.address && String(custRow.address).trim()) ||
      (custRow.cep && String(custRow.cep).replace(/\D/g, '').length === 8)
  );
  if (!hasAddress) {
    return { customer: customerFromDB(custRow) };
  }

  const existingPinLat =
    custRow.latitude !== null && custRow.latitude !== undefined && !Number.isNaN(Number(custRow.latitude))
      ? Number(custRow.latitude)
      : undefined;
  const existingPinLng =
    custRow.longitude !== null && custRow.longitude !== undefined && !Number.isNaN(Number(custRow.longitude))
      ? Number(custRow.longitude)
      : undefined;

  const validated = await resolveAndValidateCustomerAddress(supabase, {
    address: custRow.address,
    number: custRow.number,
    neighborhood: custRow.neighborhood,
    city: custRow.city,
    state: custRow.state,
    cep: custRow.cep,
    pinLatitude: existingPinLat,
    pinLongitude: existingPinLng,
  });

  if (validated.error) {
    // Legacy customer had a pin far from their typed address: reset their coordinates to the geocoded address and mark location_verified = false
    const fallbackGeo = await resolveAndValidateCustomerAddress(supabase, {
      address: custRow.address,
      number: custRow.number,
      neighborhood: custRow.neighborhood,
      city: custRow.city,
      state: custRow.state,
      cep: custRow.cep,
    });

    if (fallbackGeo.geoLatitude !== undefined && fallbackGeo.geoLongitude !== undefined) {
      const { data: updatedRow, error: updErr } = await supabase
        .from('customers')
        .update({
          latitude: fallbackGeo.latitude ?? null,
          longitude: fallbackGeo.longitude ?? null,
          geo_latitude: fallbackGeo.geoLatitude,
          geo_longitude: fallbackGeo.geoLongitude,
          geo_precision: fallbackGeo.geoPrecision ?? null,
          pin_offset_m: 0,
          location_verified: false,
          distance_km: fallbackGeo.distanceKm ?? null,
          is_within_delivery_radius: fallbackGeo.isWithinDeliveryRadius ?? null,
        })
        .eq('id', custRow.id)
        .select('*')
        .maybeSingle();

      if (!updErr && updatedRow) {
        return {
          customer: customerFromDB(updatedRow),
          pinRejectedError: validated.error,
        };
      }
    }

    return {
      customer: customerFromDB({ ...custRow, location_verified: false }),
      pinRejectedError: validated.error,
    };
  }

  if (validated.geoLatitude !== undefined && validated.geoLongitude !== undefined) {
    const { data: updatedRow, error: updErr } = await supabase
      .from('customers')
      .update({
        latitude: validated.latitude ?? null,
        longitude: validated.longitude ?? null,
        geo_latitude: validated.geoLatitude,
        geo_longitude: validated.geoLongitude,
        geo_precision: validated.geoPrecision ?? null,
        pin_offset_m: validated.pinOffsetM ?? 0,
        location_verified: validated.locationVerified,
        distance_km: validated.distanceKm ?? null,
        is_within_delivery_radius: validated.isWithinDeliveryRadius ?? null,
      })
      .eq('id', custRow.id)
      .select('*')
      .maybeSingle();

    if (!updErr && updatedRow) {
      return { customer: customerFromDB(updatedRow) };
    }
  }

  return { customer: customerFromDB(custRow) };
}

function normalizeCouponExpiresAt(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Date-only or midnight UTC strings ("YYYY-MM-DD" or "YYYY-MM-DDT00:00:00...")
  const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:T00:00:00(?:\.000)?(?:Z|[+-]00:00)?)?$/);
  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}T23:59:59-03:00`;
  }

  // Already has explicit -03:00 end of day
  const brEndMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})T23:59:59(?:\.\d+)?-03:00$/);
  if (brEndMatch) {
    return `${brEndMatch[1]}T23:59:59-03:00`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;

  // Extract YYYY-MM-DD in America/Sao_Paulo timezone
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (year && month && day) {
    return `${year}-${month}-${day}T23:59:59-03:00`;
  }

  return `${trimmed.slice(0, 10)}T23:59:59-03:00`;
}

function getCouponExpirationMs(expiresAt: string | null | undefined): number | null {
  const normalized = normalizeCouponExpiresAt(expiresAt);
  if (!normalized) return null;
  const ms = new Date(normalized).getTime();
  return Number.isNaN(ms) ? null : ms;
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
    expires_at: normalizeCouponExpiresAt(c.expiresAt),
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
    expiresAt: normalizeCouponExpiresAt(row.expires_at),
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
    guest_token: o.guestToken || null,
    coupon_code: o.couponCode ? o.couponCode.toUpperCase().trim() : null,
    discount: Number(o.discount) || 0,
    delivery_type: o.deliveryType || 'delivery',
    items: o.items, // jsonb
    subtotal: Number(o.subtotal) || 0,
    delivery_fee: Number(o.deliveryFee) || 0,
    total: Number(o.total) || 0,
    payment_method: o.paymentMethod || 'pix',
    cash_change_for:
      o.paymentMethod === 'dinheiro' && o.cashChangeFor !== undefined && o.cashChangeFor !== null
        ? Number(o.cashChangeFor)
        : null,
    notes: o.notes || null,
    client_request_id: o.clientRequestId ? String(o.clientRequestId).trim().slice(0, 64) : null,
    created_at: o.createdAt || new Date().toISOString(),
    updated_at: o.updatedAt || new Date().toISOString(),
  };
}

function orderFromDB(row: any, customerById?: Map<string, CustomerProfile>): Order {
  const rawCust = row.customer && typeof row.customer === 'object' ? { ...row.customer } : {};
  const customerId = row.customer_id ? String(row.customer_id) : undefined;
  const linkedCust = customerId && customerById ? customerById.get(customerId) : undefined;

  const rawGeoLat =
    rawCust.geoLatitude !== undefined && rawCust.geoLatitude !== null
      ? rawCust.geoLatitude
      : rawCust.geo_latitude !== undefined && rawCust.geo_latitude !== null
      ? rawCust.geo_latitude
      : linkedCust?.geoLatitude;

  const rawGeoLng =
    rawCust.geoLongitude !== undefined && rawCust.geoLongitude !== null
      ? rawCust.geoLongitude
      : rawCust.geo_longitude !== undefined && rawCust.geo_longitude !== null
      ? rawCust.geo_longitude
      : linkedCust?.geoLongitude;

  const rawPinOffset =
    rawCust.pinOffsetM !== undefined && rawCust.pinOffsetM !== null
      ? rawCust.pinOffsetM
      : rawCust.pin_offset_m !== undefined && rawCust.pin_offset_m !== null
      ? rawCust.pin_offset_m
      : linkedCust?.pinOffsetM;

  const rawVerified =
    rawCust.locationVerified !== undefined && rawCust.locationVerified !== null
      ? rawCust.locationVerified
      : rawCust.location_verified !== undefined && rawCust.location_verified !== null
      ? rawCust.location_verified
      : linkedCust?.locationVerified;

  if (rawGeoLat !== undefined && rawGeoLat !== null && !Number.isNaN(Number(rawGeoLat))) {
    rawCust.geoLatitude = Number(rawGeoLat);
    rawCust.geo_latitude = Number(rawGeoLat);
  }
  if (rawGeoLng !== undefined && rawGeoLng !== null && !Number.isNaN(Number(rawGeoLng))) {
    rawCust.geoLongitude = Number(rawGeoLng);
    rawCust.geo_longitude = Number(rawGeoLng);
  }
  if (rawPinOffset !== undefined && rawPinOffset !== null && !Number.isNaN(Number(rawPinOffset))) {
    rawCust.pinOffsetM = Math.round(Number(rawPinOffset));
    rawCust.pin_offset_m = Math.round(Number(rawPinOffset));
  }
  if (rawVerified !== undefined && rawVerified !== null) {
    rawCust.locationVerified = Boolean(rawVerified);
    rawCust.location_verified = Boolean(rawVerified);
  }

  return {
    id: String(row.id),
    source: row.source || 'online',
    status: (row.status as OrderStatus) || 'pendente',
    customer: rawCust,
    customerId,
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
    clientRequestId: row.client_request_id || undefined,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

function sanitizePublicCustomer<T extends Record<string, any>>(c: T): T {
  if (!c || typeof c !== 'object') return c;
  const {
    pinOffsetM: _pinOffsetM,
    pin_offset_m: _pin_offset_m,
    ...rest
  } = c;
  return rest as T;
}

function sanitizeCustomerOrder(o: Order): Order {
  const { guestToken: _guestToken, ...restOrder } = o;
  return {
    ...restOrder,
    customer: o.customer ? sanitizePublicCustomer(o.customer) : o.customer,
    items: (o.items || []).map(({ costPrice: _costPrice, ...itemRest }) => itemRest),
  };
}

const GUEST_ORDER_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const GUEST_ORDER_MAX_PER_HOUR = 3;
const guestOrdersByIp = new Map<string, number[]>();
const guestOrdersByPhone = new Map<string, number[]>();

function normalizeBrazilianPhoneDigits(rawPhone: unknown): string {
  let digits = String(rawPhone || '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    digits = digits.slice(2);
  }
  return digits;
}

function pruneGuestTimestamps(list: number[] | undefined, now: number): number[] {
  if (!list || list.length === 0) return [];
  return list.filter((ts) => now - ts < GUEST_ORDER_RATE_WINDOW_MS);
}

function isGuestOrderRateLimited(ip: string, phoneDigits: string): boolean {
  const now = Date.now();
  const ipKey = ip || 'unknown';
  const ipList = pruneGuestTimestamps(guestOrdersByIp.get(ipKey), now);
  guestOrdersByIp.set(ipKey, ipList);

  const phoneKey = phoneDigits || 'unknown';
  const phoneList = pruneGuestTimestamps(guestOrdersByPhone.get(phoneKey), now);
  guestOrdersByPhone.set(phoneKey, phoneList);

  return ipList.length >= GUEST_ORDER_MAX_PER_HOUR || phoneList.length >= GUEST_ORDER_MAX_PER_HOUR;
}

function recordGuestOrderRateLimit(ip: string, phoneDigits: string): void {
  const now = Date.now();
  const ipKey = ip || 'unknown';
  const ipList = pruneGuestTimestamps(guestOrdersByIp.get(ipKey), now);
  ipList.push(now);
  guestOrdersByIp.set(ipKey, ipList);

  const phoneKey = phoneDigits || 'unknown';
  const phoneList = pruneGuestTimestamps(guestOrdersByPhone.get(phoneKey), now);
  phoneList.push(now);
  guestOrdersByPhone.set(phoneKey, phoneList);
}

const DEFAULT_SERVER_SHORTCUTS: Record<string, string> = {
  pdv: 'F2',
  mesas: 'F3',
  pedidos: 'F4',
  estoque: 'F8',
  finalizar: 'F9',
  busca: '/',
  fecharModal: 'Escape',
  newProduct: 'F6',
  saveProduct: 'Ctrl+S',
  saveAndNewProduct: 'Ctrl+Enter',
};

const FORBIDDEN_SHORTCUT_KEYS = new Set([
  'F5',
  'F7',
  'F11',
  'F12',
  'TAB',
  'ENTER',
  'CTRL+W',
  'CTRL+T',
  'CTRL+N',
  'CTRL+R',
  'CTRL+L',
  'CTRL+P',
  'ALT+F4',
]);

function isForbiddenShortcutKey(key: string): boolean {
  const upper = key.trim().toUpperCase();
  if (!upper || upper.length > 32) return true;
  if (FORBIDDEN_SHORTCUT_KEYS.has(upper)) return true;
  return false;
}

const VALID_PRODUCT_SORT_MODES = new Set<ProductSortMode>(['manual', 'az', 'price_asc', 'price_desc']);

function sanitizePublicSettings(settings: StoreSettings): StoreSettings {
  const clean: StoreSettings = { ...initialSettings, ...(settings || {}) };
  delete (clean as any).adminPin;
  delete (clean as any).supabaseUrl;
  delete (clean as any).supabaseAnonKey;
  delete (clean as any).supabaseSecretKey;

  // Validate showOutOfStock (boolean, default false)
  clean.showOutOfStock = typeof (settings as any)?.showOutOfStock === 'boolean'
    ? (settings as any).showOutOfStock
    : false;

  // Validate featuredProductIds (ordered string array, max 50, max 100 chars per ID, deduplicated)
  if (Array.isArray((settings as any)?.featuredProductIds)) {
    const seen = new Set<string>();
    const validIds: string[] = [];
    for (const item of (settings as any).featuredProductIds) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed.length > 0 && trimmed.length <= 100 && !seen.has(trimmed)) {
          seen.add(trimmed);
          validIds.push(trimmed);
          if (validIds.length >= 50) break;
        }
      }
    }
    clean.featuredProductIds = validIds;
  } else {
    clean.featuredProductIds = [];
  }

  // Validate categories: ordered list of { id, name } (max 50; id exact trimmed up to 40 chars; name max 40 chars)
  if (Array.isArray((settings as any)?.categories)) {
    const seenCatIds = new Set<string>();
    const validCategories: StoreCategoryItem[] = [];
    for (const rawCat of (settings as any).categories) {
      if (rawCat && typeof rawCat === 'object') {
        const id = String(rawCat.id || '').trim().slice(0, 40);
        const name = String(rawCat.name || '').trim().slice(0, 40);
        const lowerId = id.toLowerCase();
        if (
          id.length >= 1 &&
          id.length <= 40 &&
          lowerId !== 'todas' &&
          lowerId !== 'outros' &&
          name.length >= 1 &&
          !seenCatIds.has(id)
        ) {
          seenCatIds.add(id);
          validCategories.push({ id, name });
          if (validCategories.length >= 50) break;
        }
      }
    }
    clean.categories = validCategories;
  } else {
    clean.categories = [];
  }

  // Validate productSortMode ('manual' | 'az' | 'price_asc' | 'price_desc', default 'manual')
  const rawSortMode = (settings as any)?.productSortMode;
  clean.productSortMode =
    typeof rawSortMode === 'string' && VALID_PRODUCT_SORT_MODES.has(rawSortMode as ProductSortMode)
      ? (rawSortMode as ProductSortMode)
      : 'manual';

  // Validate productOrder ({ [categoryId]: string[] }, max 2000 product IDs total)
  const rawProductOrder = (settings as any)?.productOrder;
  const sanitizedProductOrder: Record<string, string[]> = {};
  if (rawProductOrder && typeof rawProductOrder === 'object' && !Array.isArray(rawProductOrder)) {
    let totalIdsCount = 0;
    for (const [rawCatId, rawList] of Object.entries(rawProductOrder)) {
      if (totalIdsCount >= 2000) break;
      const catId = String(rawCatId || '').trim().slice(0, 40);
      if (!catId || catId.length > 40) continue;
      if (Array.isArray(rawList)) {
        const seenProdIds = new Set<string>();
        const catProdIds: string[] = [];
        for (const item of rawList) {
          if (totalIdsCount >= 2000) break;
          if (typeof item === 'string') {
            const pid = item.trim();
            if (pid.length > 0 && pid.length <= 100 && !seenProdIds.has(pid)) {
              seenProdIds.add(pid);
              catProdIds.push(pid);
              totalIdsCount++;
            }
          }
        }
        if (catProdIds.length > 0) {
          sanitizedProductOrder[catId] = catProdIds;
        }
      }
    }
  }
  clean.productOrder = sanitizedProductOrder;

  // Validate shortcuts (object mapping valid actions to valid non-reserved keys)
  const rawShortcuts = (settings as any)?.shortcuts;
  const sanitizedShortcuts: Record<string, string> = { ...DEFAULT_SERVER_SHORTCUTS };
  if (rawShortcuts && typeof rawShortcuts === 'object' && !Array.isArray(rawShortcuts)) {
    for (const action of Object.keys(DEFAULT_SERVER_SHORTCUTS)) {
      const val = rawShortcuts[action];
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.length > 0 && trimmed.length <= 32 && !isForbiddenShortcutKey(trimmed)) {
          sanitizedShortcuts[action] = trimmed;
        }
      }
    }
  }
  clean.shortcuts = sanitizedShortcuts;

  // Validate addonGroups (max 30 groups, max 20 options per group)
  if (Array.isArray((settings as any)?.addonGroups)) {
    const validGroups: AddonGroup[] = [];
    const seenGroupIds = new Set<string>();
    for (const rawGroup of (settings as any).addonGroups) {
      if (!rawGroup || typeof rawGroup !== 'object') continue;
      const gId = String(rawGroup.id || '').trim().slice(0, 60);
      const gName = String(rawGroup.name || '').trim().slice(0, 60);
      if (!gId || !gName || seenGroupIds.has(gId)) continue;
      seenGroupIds.add(gId);

      const gActive = rawGroup.active === false ? false : true;
      const rawMin = Number(rawGroup.min);
      const gMin =
        !Number.isNaN(rawMin) && rawMin >= 0
          ? Math.min(10, Math.floor(rawMin))
          : 0;
      const rawMax = Number(rawGroup.max);
      const gMax =
        !Number.isNaN(rawMax) && rawMax >= 1
          ? Math.max(Math.max(1, gMin), Math.min(10, Math.floor(rawMax)))
          : Math.max(1, gMin);

      const validOptions: AddonOption[] = [];
      const seenOptIds = new Set<string>();
      if (Array.isArray(rawGroup.options)) {
        for (const rawOpt of rawGroup.options) {
          if (!rawOpt || typeof rawOpt !== 'object') continue;
          const oId = String(rawOpt.id || '').trim().slice(0, 60);
          const oName = String(rawOpt.name || '').trim().slice(0, 60);
          if (!oId || !oName || seenOptIds.has(oId)) continue;
          seenOptIds.add(oId);

          const rawPrice = Number(rawOpt.price);
          const oPrice =
            !Number.isNaN(rawPrice) && rawPrice >= 0
              ? Math.round(rawPrice * 100) / 100
              : 0;
          const oActive = rawOpt.active === false ? false : true;

          validOptions.push({
            id: oId,
            name: oName,
            price: oPrice,
            active: oActive,
          });
          if (validOptions.length >= 20) break;
        }
      }

      const categoryIds: string[] = [];
      const seenCatIdSet = new Set<string>();
      if (Array.isArray(rawGroup.categoryIds)) {
        for (const rawCid of rawGroup.categoryIds) {
          if (typeof rawCid === 'string') {
            const cid = rawCid.trim().slice(0, 40);
            if (cid && !seenCatIdSet.has(cid)) {
              seenCatIdSet.add(cid);
              categoryIds.push(cid);
              if (categoryIds.length >= 50) break;
            }
          }
        }
      }

      const productIds: string[] = [];
      const seenProdIdSet = new Set<string>();
      if (Array.isArray(rawGroup.productIds)) {
        for (const rawPid of rawGroup.productIds) {
          if (typeof rawPid === 'string') {
            const pid = rawPid.trim().slice(0, 100);
            if (pid && !seenProdIdSet.has(pid)) {
              seenProdIdSet.add(pid);
              productIds.push(pid);
              if (productIds.length >= 500) break;
            }
          }
        }
      }

      validGroups.push({
        id: gId,
        name: gName,
        active: gActive,
        min: gMin,
        max: gMax,
        options: validOptions,
        categoryIds,
        productIds,
      });

      if (validGroups.length >= 30) break;
    }
    clean.addonGroups = validGroups;
  } else {
    clean.addonGroups = [];
  }

  // Validate combos: { [idDoProdutoCombo]: Array<{ productId, quantity }> }
  // Max 100 combos, max 15 items per combo, integer quantity 1..99, no self-reference, no combo inside combo
  const rawCombos = (settings as any)?.combos;
  const sanitizedCombos: Record<string, ComboComponentItem[]> = {};
  if (rawCombos && typeof rawCombos === 'object' && !Array.isArray(rawCombos)) {
    const candidateComboIds = new Set<string>();
    for (const [rawComboId, rawList] of Object.entries(rawCombos)) {
      const cid = String(rawComboId || '').trim().slice(0, 100);
      if (cid && Array.isArray(rawList) && rawList.length > 0) {
        candidateComboIds.add(cid);
      }
    }

    let comboCount = 0;
    for (const [rawComboId, rawList] of Object.entries(rawCombos)) {
      if (comboCount >= 100) break;
      const comboId = String(rawComboId || '').trim().slice(0, 100);
      if (!comboId || !Array.isArray(rawList) || rawList.length === 0) continue;

      const validItems: ComboComponentItem[] = [];
      const seenItemIds = new Set<string>();
      for (const rawItem of rawList) {
        if (validItems.length >= 15) break;
        if (!rawItem || typeof rawItem !== 'object') continue;
        const pid = String((rawItem as any).productId || '').trim().slice(0, 100);
        const rawQty = (rawItem as any).quantity;
        if (
          rawQty === null ||
          rawQty === undefined ||
          typeof rawQty === 'boolean' ||
          (typeof rawQty === 'string' && rawQty.trim() === '')
        ) {
          continue;
        }
        const qty = Number(rawQty);
        if (!pid || pid === comboId || candidateComboIds.has(pid)) continue;
        if (!Number.isInteger(qty) || qty < 1 || qty > 99) continue;
        if (seenItemIds.has(pid)) continue;
        seenItemIds.add(pid);
        validItems.push({ productId: pid, quantity: qty });
      }

      if (validItems.length > 0) {
        sanitizedCombos[comboId] = validItems;
        comboCount++;
      }
    }
  }
  clean.combos = sanitizedCombos;

  // Validate hiddenFromStoreIds (array of unique non-empty strings, max 2000 items, max 100 chars each)
  if (Array.isArray((settings as any)?.hiddenFromStoreIds)) {
    const seenHiddenIds = new Set<string>();
    const validHiddenIds: string[] = [];
    for (const rawId of (settings as any).hiddenFromStoreIds) {
      if (typeof rawId === 'string') {
        const trimmed = rawId.trim();
        if (trimmed.length > 0 && trimmed.length <= 100 && !seenHiddenIds.has(trimmed)) {
          seenHiddenIds.add(trimmed);
          validHiddenIds.push(trimmed);
          if (validHiddenIds.length >= 2000) break;
        }
      }
    }
    clean.hiddenFromStoreIds = validHiddenIds;
  } else {
    clean.hiddenFromStoreIds = [];
  }

  // Validate caseSaleChannels: { [productId]: { store: boolean, local: boolean } } (max 2000 items)
  const rawCaseChannels = (settings as any)?.caseSaleChannels;
  const sanitizedCaseChannels: Record<string, { store: boolean; local: boolean }> = {};
  if (rawCaseChannels && typeof rawCaseChannels === 'object' && !Array.isArray(rawCaseChannels)) {
    let channelCount = 0;
    for (const [rawPid, rawCfg] of Object.entries(rawCaseChannels)) {
      if (channelCount >= 2000) break;
      const pid = String(rawPid || '').trim().slice(0, 100);
      if (!pid || !rawCfg || typeof rawCfg !== 'object' || Array.isArray(rawCfg)) continue;
      const storeFlag = (rawCfg as any).store !== false;
      const localFlag = (rawCfg as any).local !== false;
      sanitizedCaseChannels[pid] = {
        store: Boolean(storeFlag),
        local: Boolean(localFlag),
      };
      channelCount++;
    }
  }
  clean.caseSaleChannels = sanitizedCaseChannels;

  return clean;
}

function validateIncomingCombos(
  rawCombos: unknown,
  existingProductIds: Set<string>
): { error?: string; combos: Record<string, ComboComponentItem[]> } {
  if (rawCombos === undefined || rawCombos === null) {
    return { combos: {} };
  }
  if (typeof rawCombos !== 'object' || Array.isArray(rawCombos)) {
    return { error: 'Formato inválido de combos.', combos: {} };
  }

  const entries = Object.entries(rawCombos as Record<string, unknown>);
  if (entries.length > 100) {
    return { error: 'Limite máximo de 100 combos excedido.', combos: {} };
  }

  const activeComboIds = new Set<string>();
  for (const [rawComboId, rawList] of entries) {
    const cid = String(rawComboId || '').trim();
    if (!cid) continue;
    if (Array.isArray(rawList) && rawList.length > 0) {
      activeComboIds.add(cid);
    }
  }

  const result: Record<string, ComboComponentItem[]> = {};
  for (const [rawComboId, rawList] of entries) {
    const comboId = String(rawComboId || '').trim();
    if (!comboId) continue;
    if (!Array.isArray(rawList)) {
      return { error: `A composição do combo "${comboId}" deve ser uma lista de itens.`, combos: {} };
    }
    if (rawList.length === 0) {
      continue;
    }
    if (!existingProductIds.has(comboId)) {
      return { error: `O produto do combo (${comboId}) não existe no cadastro.`, combos: {} };
    }
    if (rawList.length > 15) {
      return { error: 'Um combo pode ter no máximo 15 itens.', combos: {} };
    }

    const validItems: ComboComponentItem[] = [];
    const seenItemIds = new Set<string>();

    for (const rawItem of rawList) {
      if (!rawItem || typeof rawItem !== 'object') {
        return { error: 'Item inválido na composição do combo.', combos: {} };
      }
      const pid = String((rawItem as any).productId || '').trim();
      const rawQty = (rawItem as any).quantity;

      if (!pid || !existingProductIds.has(pid)) {
        return { error: 'Produto inexistente informado na composição do combo.', combos: {} };
      }
      if (pid === comboId) {
        return { error: 'Um combo não pode conter a si mesmo.', combos: {} };
      }
      if (activeComboIds.has(pid)) {
        return { error: 'Um combo não pode conter outro combo.', combos: {} };
      }
      if (
        rawQty === null ||
        rawQty === undefined ||
        typeof rawQty === 'boolean' ||
        (typeof rawQty === 'string' && rawQty.trim() === '')
      ) {
        return { error: 'Quantidade inválida no combo (use inteiro de 1 a 99).', combos: {} };
      }
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return { error: 'Quantidade inválida no combo (use inteiro de 1 a 99).', combos: {} };
      }
      if (seenItemIds.has(pid)) {
        return { error: 'Produto repetido na composição do mesmo combo.', combos: {} };
      }
      seenItemIds.add(pid);
      validItems.push({ productId: pid, quantity: qty });
    }

    result[comboId] = validItems;
  }

  return { combos: result };
}

function applyCombosStockAndCost(products: Product[], settings: StoreSettings): Product[] {
  if (!settings?.combos || Object.keys(settings.combos).length === 0) {
    return products;
  }
  return products.map((p) => {
    if (!isComboProduct(p.id, settings)) return p;
    const metrics = calculateComboMetrics(p, settings, products);
    return {
      ...p,
      stock: metrics.availableStock,
      costPrice: metrics.costPrice,
      caseSize: null,
      casePrice: null,
    };
  });
}

function extractOrderStockItems(
  order: Order,
  opts?: { reason?: string; refType?: string; refId?: string }
): { id: string; qty: number; reason?: string; refType?: string; refId?: string; note?: string }[] {
  const unitsMap = new Map<string, number>();
  const comboNamesByProduct = new Map<string, Set<string>>();
  const channelLabel =
    order.source === 'balcao' ? 'Balcão' : order.source === 'mesa' ? 'Mesa' : 'Delivery';

  for (const it of order.items || []) {
    const itemQty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    if (Array.isArray(it.comboItems) && it.comboItems.length > 0) {
      const comboTitle = String(it.name || 'Combo').trim();
      for (const ci of it.comboItems) {
        const compId = String(ci?.productId || '').trim();
        const compQty = Math.max(1, Math.floor(Number(ci?.quantity) || 1));
        if (compId) {
          unitsMap.set(compId, (unitsMap.get(compId) || 0) + itemQty * compQty);
          if (!comboNamesByProduct.has(compId)) {
            comboNamesByProduct.set(compId, new Set<string>());
          }
          comboNamesByProduct.get(compId)!.add(comboTitle);
        }
      }
    } else if (it.productId) {
      const unitsPerSale =
        it.unitsPerSale && Number(it.unitsPerSale) > 0 ? Math.floor(Number(it.unitsPerSale)) : 1;
      unitsMap.set(it.productId, (unitsMap.get(it.productId) || 0) + itemQty * unitsPerSale);
    }
  }
  return Array.from(unitsMap.entries()).map(([id, qty]) => {
    const combos = comboNamesByProduct.get(id);
    const comboSuffix =
      combos && combos.size > 0
        ? `Combo: ${Array.from(combos).join(', ')}`
        : '';
    const note = comboSuffix ? `${channelLabel} — ${comboSuffix}` : channelLabel;
    return {
      id,
      qty,
      ...(opts?.reason ? { reason: opts.reason } : {}),
      ...(opts?.refType ? { refType: opts.refType } : {}),
      ...(opts?.refId ? { refId: opts.refId } : {}),
      note,
    };
  });
}

function reconcileSettingsCategoriesAndOrders(
  settings: StoreSettings,
  products: Array<{ id?: string; category?: string }>
): { settings: StoreSettings; changed: boolean } {
  let changed = false;
  const currentCategories = settings.categories || [];

  const existingProdIdSet = new Set<string>();
  let hasProductIds = false;
  if (Array.isArray(products)) {
    for (const p of products) {
      if (p && typeof p.id === 'string' && p.id.trim()) {
        existingProdIdSet.add(p.id.trim());
        hasProductIds = true;
      }
    }
  }

  if (hasProductIds && Array.isArray(settings.hiddenFromStoreIds) && settings.hiddenFromStoreIds.length > 0) {
    const filteredHidden = settings.hiddenFromStoreIds.filter((id) => existingProdIdSet.has(id));
    if (filteredHidden.length !== settings.hiddenFromStoreIds.length) {
      settings.hiddenFromStoreIds = filteredHidden;
      changed = true;
    }
  }

  if (hasProductIds && settings.caseSaleChannels && typeof settings.caseSaleChannels === 'object') {
    const nextChannels: Record<string, { store: boolean; local: boolean }> = {};
    let removedAny = false;
    for (const [pid, cfg] of Object.entries(settings.caseSaleChannels)) {
      if (existingProdIdSet.has(pid)) {
        nextChannels[pid] = cfg;
      } else {
        removedAny = true;
      }
    }
    if (removedAny) {
      settings.caseSaleChannels = nextChannels;
      changed = true;
    }
  }

  if (currentCategories.length === 0) {
    settings.categories = buildInitialCategoriesFromProducts(products as any);
    return { settings, changed: true };
  }

  const reconciled = reconcileStoreCategoriesWithProducts(currentCategories, products as any);
  const idMap = new Map<string, string>();
  currentCategories.forEach((oldCat, idx) => {
    const newCat = reconciled[idx];
    if (newCat && oldCat.id !== newCat.id) {
      idMap.set(oldCat.id, newCat.id);
      changed = true;
    }
  });

  if (reconciled.length !== currentCategories.length) {
    changed = true;
  }

  if (changed) {
    settings.categories = reconciled;

    if (settings.productOrder && idMap.size > 0) {
      const nextOrder: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(settings.productOrder)) {
        const mappedKey = idMap.get(k) || k;
        nextOrder[mappedKey] = v;
      }
      settings.productOrder = nextOrder;
    }

    if (Array.isArray(settings.addonGroups) && idMap.size > 0) {
      settings.addonGroups = settings.addonGroups.map((g) => ({
        ...g,
        categoryIds: (g.categoryIds || []).map((cid) => idMap.get(cid) || cid),
      }));
    }
  }

  return { settings, changed };
}

function validateAndCalculateItemAddons(
  serverProduct: Product,
  rawAddons: unknown,
  dbSettings: StoreSettings
): { error?: string; addons: OrderItemAddon[]; addonsTotal: number } {
  if (rawAddons !== undefined && rawAddons !== null && !Array.isArray(rawAddons)) {
    return {
      error: `Formato inválido de adicionais para o produto "${serverProduct.name}".`,
      addons: [],
      addonsTotal: 0,
    };
  }

  const incomingList = Array.isArray(rawAddons) ? rawAddons : [];
  if (incomingList.length > 60) {
    return {
      error: `Quantidade excessiva de adicionais para o produto "${serverProduct.name}".`,
      addons: [],
      addonsTotal: 0,
    };
  }

  const applicableGroups = getProductAddonGroups(serverProduct, dbSettings);
  const applicableGroupById = new Map<string, AddonGroup>(
    applicableGroups.map((g) => [g.id, g])
  );

  const qtyByGroupId = new Map<string, number>();
  const mergedAddonsMap = new Map<string, OrderItemAddon>();

  for (const rawItem of incomingList) {
    if (!rawItem || typeof rawItem !== 'object') {
      return {
        error: `Adicional inválido informado para o produto "${serverProduct.name}".`,
        addons: [],
        addonsTotal: 0,
      };
    }

    const groupId = String((rawItem as any).groupId || '').trim();
    const optionId = String((rawItem as any).optionId || '').trim();
    const rawQty = (rawItem as any).quantity;

    if (!groupId || !optionId) {
      return {
        error: `Adicional incompleto informado para o produto "${serverProduct.name}".`,
        addons: [],
        addonsTotal: 0,
      };
    }

    if (
      rawQty === null ||
      rawQty === undefined ||
      typeof rawQty === 'boolean' ||
      (typeof rawQty === 'string' && rawQty.trim() === '')
    ) {
      return {
        error: `Quantidade inválida de adicional para o produto "${serverProduct.name}".`,
        addons: [],
        addonsTotal: 0,
      };
    }

    const qtyNum = Number(rawQty);
    if (!Number.isInteger(qtyNum) || qtyNum < 1 || qtyNum > 10) {
      return {
        error: `Quantidade inválida de adicional para o produto "${serverProduct.name}".`,
        addons: [],
        addonsTotal: 0,
      };
    }

    const group = applicableGroupById.get(groupId);
    if (!group) {
      return {
        error: `O grupo de adicional selecionado não é válido para o produto "${serverProduct.name}".`,
        addons: [],
        addonsTotal: 0,
      };
    }

    const option = (group.options || []).find((opt) => opt && opt.id === optionId);
    if (!option || option.active === false) {
      return {
        error: `A opção de adicional selecionada em "${group.name}" não está disponível para "${serverProduct.name}".`,
        addons: [],
        addonsTotal: 0,
      };
    }

    const nextGroupQty = (qtyByGroupId.get(group.id) || 0) + qtyNum;
    qtyByGroupId.set(group.id, nextGroupQty);

    const mergeKey = `${group.id}::${option.id}`;
    const existingAddon = mergedAddonsMap.get(mergeKey);
    const optPrice = Math.max(0, Math.round((Number(option.price) || 0) * 100) / 100);

    if (existingAddon) {
      existingAddon.quantity += qtyNum;
    } else {
      mergedAddonsMap.set(mergeKey, {
        groupId: group.id,
        optionId: option.id,
        groupName: group.name,
        optionName: option.name,
        price: optPrice,
        quantity: qtyNum,
      });
    }
  }

  for (const group of applicableGroups) {
    const selectedQty = qtyByGroupId.get(group.id) || 0;
    const min = Math.max(0, Math.floor(Number(group.min) || 0));
    const max = Math.max(Math.max(1, min), Math.floor(Number(group.max) || 1));

    if (selectedQty < min) {
      return {
        error: `Em "${serverProduct.name}", o grupo "${group.name}" é obrigatório: escolha pelo menos ${min} ${min === 1 ? 'opção' : 'opções'}.`,
        addons: [],
        addonsTotal: 0,
      };
    }

    if (selectedQty > max) {
      return {
        error: `Em "${serverProduct.name}", o grupo "${group.name}" permite no máximo ${max} ${max === 1 ? 'opção' : 'opções'}.`,
        addons: [],
        addonsTotal: 0,
      };
    }
  }

  const validatedAddons = Array.from(mergedAddonsMap.values());
  const addonsTotal =
    Math.round(
      validatedAddons.reduce((sum, a) => sum + a.price * a.quantity, 0) * 100
    ) / 100;

  return {
    addons: validatedAddons,
    addonsTotal,
  };
}

function diningTableFromDB(row: any): DiningTable {
  return {
    id: String(row.id),
    number: Number(row.number),
    label: row.label || null,
    seats: row.seats !== null && row.seats !== undefined ? Number(row.seats) : null,
    active: row.active ?? true,
    createdAt: row.created_at || undefined,
  };
}

function tableTabFromDB(row: any): TableTab {
  return {
    id: String(row.id),
    tableId: String(row.table_id),
    status: (row.status as TabStatus) || 'open',
    customerName: row.customer_name || null,
    peopleCount: row.people_count !== null && row.people_count !== undefined ? Number(row.people_count) : 1,
    notes: row.notes || null,
    mergedInto: row.merged_into || null,
    orderId: row.order_id || null,
    openedAt: row.opened_at || new Date().toISOString(),
    closedAt: row.closed_at || null,
    updatedAt: row.updated_at || new Date().toISOString(),
  };
}

function tableTabItemFromDB(row: any): TableTabItem {
  const saleUnit = row.sale_unit === 'case' ? 'case' : 'unit';
  const unitsPerSale =
    row.units_per_sale !== null && row.units_per_sale !== undefined && Number(row.units_per_sale) > 0
      ? Number(row.units_per_sale)
      : 1;
  let comboItems: OrderItemComboComponent[] | undefined = undefined;
  if (Array.isArray(row.combo_items) && row.combo_items.length > 0) {
    const parsedComboItems: OrderItemComboComponent[] = [];
    for (const ci of row.combo_items) {
      if (ci && typeof ci === 'object') {
        const pid = String((ci as any).productId || '').trim();
        const cname = String((ci as any).name || '').trim();
        const cqty = Math.max(1, Math.floor(Number((ci as any).quantity) || 1));
        if (pid && cname) {
          parsedComboItems.push({ productId: pid, name: cname, quantity: cqty });
        }
      }
    }
    if (parsedComboItems.length > 0) {
      comboItems = parsedComboItems;
    }
  }
  return {
    id: String(row.id),
    tabId: String(row.tab_id),
    productId: String(row.product_id),
    productName: String(row.product_name),
    unitPrice: Number(row.unit_price || 0),
    quantity: Number(row.quantity || 1),
    saleUnit,
    unitsPerSale,
    ...(comboItems ? { comboItems } : {}),
    notes: row.notes || null,
    status: (row.status as 'active' | 'cancelled') || 'active',
    addedAt: row.added_at || new Date().toISOString(),
    cancelledAt: row.cancelled_at || null,
  };
}

function translateTabRpcError(message: string): string {
  if (!message) return 'Erro ao processar operação da comanda.';
  if (message.includes('QUANTIDADE_INVALIDA')) return 'Quantidade inválida.';
  if (message.includes('COMANDA_NAO_ABERTA')) return 'A comanda não está aberta.';
  if (message.includes('COMBO_INVALIDO')) return 'Combo com itens inválidos';
  if (message.includes('ESTOQUE_INSUFICIENTE')) return 'Estoque insuficiente para este produto.';
  if (message.includes('ITEM_INVALIDO')) return 'Item não encontrado ou já cancelado.';
  if (message.includes('MESMA_COMANDA')) return 'Não é possível transferir ou juntar para a mesma comanda.';
  if (message.includes('COMANDA_NAO_ESTA_FECHANDO')) return 'Esta conta não está em fechamento.';
  if (message.includes('MESMA_MESA')) return 'Escolha uma mesa diferente.';
  if (message.includes('MESA_INVALIDA')) return 'Mesa não encontrada ou inativa.';
  if (message.includes('MESA_JA_JUNTADA')) return 'Essa mesa já está juntada com outra conta.';
  if (message.includes('MESA_NAO_JUNTADA')) return 'Essa mesa não está juntada a esta conta.';
  if (message.includes('UNIDADE_INVALIDA')) return 'Este produto não é vendido em caixa fechada.';
  return message;
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

  const exp = Date.now() + 16 * 60 * 60 * 1000; // 16 hours
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
  app.set('etag', false);
  app.use(express.json());

  const router = express.Router();

  // Middleware: desabilitar cache em todas as rotas da API
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

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

  router.post('/admin/refresh', requireAdmin, (_req, res) => {
    try {
      const { token, expiresAt } = createAdminSignedToken();
      return res.json({
        success: true,
        token,
        expiresAt,
      });
    } catch (err: any) {
      console.error('[Auth Error] Erro ao renovar token assinado:', err);
      return res.status(500).json({ error: err.message || 'Erro ao renovar token de sessão.' });
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

    const body = req.body || {};

    const resolved = await resolveAddressGeocodeServer(supabase, {
      rua: String(body.rua || body.street || body.address || body.logradouro || '').trim(),
      numero: String(body.numero || body.number || '').trim(),
      bairro: String(body.bairro || body.neighborhood || '').trim(),
      cidade: String(body.cidade || body.city || body.localidade || '').trim(),
      uf: String(body.uf || body.state || '').trim(),
      cep: String(body.cep || body.postalcode || '').replace(/\D/g, ''),
      query: String(body.query || '').trim(),
      contactEmail,
    });

    if (resolved) {
      return res.json(resolved);
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
      guestOrderId,
      guestToken,
    } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      return res.status(400).json({ error: 'Nome completo é obrigatório (2 a 80 caracteres).' });
    }

    const cleanPhoneDigits = normalizeBrazilianPhoneDigits(phone);
    if (cleanPhoneDigits.length < 10 || cleanPhoneDigits.length > 11) {
      return res.status(400).json({ error: 'Número de WhatsApp válido (10 ou 11 dígitos) é obrigatório.' });
    }

    const hasExplicitEmail = typeof email === 'string' && email.trim() !== '';
    if (hasExplicitEmail && !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail válido é obrigatório.' });
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'A senha deve ter no mínimo 8 caracteres.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const cleanEmail = hasExplicitEmail ? email.toLowerCase().trim() : undefined;

    // Check email uniqueness when email is provided
    if (cleanEmail) {
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
        return res.status(409).json({
          error: 'Este e-mail já está cadastrado. Faça login com seu e-mail e senha.',
          field: 'email',
        });
      }
    }

    // Check phone uniqueness when customer has password_hash
    if (cleanPhoneDigits.length >= 10) {
      const { data: phoneRows, error: phoneCheckErr } = await supabase
        .from('customers')
        .select('id, phone, email, password_hash')
        .not('password_hash', 'is', null);

      if (phoneCheckErr) {
        console.error('[Supabase Error] check customer phone:', phoneCheckErr.message);
        return res.status(500).json({ error: phoneCheckErr.message });
      }

      const duplicatePhone = (phoneRows || []).find(
        (r: any) => normalizeBrazilianPhoneDigits(r.phone) === cleanPhoneDigits
      );
      if (duplicatePhone) {
        return res.status(409).json({
          error: 'Este telefone/WhatsApp já está cadastrado em uma conta.',
          field: 'phone',
        });
      }
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

      const trimmedAddress = String(address || '').trim();
      const trimmedNumber = String(number || '').trim();
      const trimmedNeighborhood = String(neighborhood || '').trim();
      const isPickupPlaceholder =
        !trimmedAddress || trimmedAddress.toLowerCase() === 'retirada no depósito';

      let geoValidation: Awaited<ReturnType<typeof resolveAndValidateCustomerAddress>> = {
        locationVerified: false,
      };

      if (!isPickupPlaceholder) {
        geoValidation = await resolveAndValidateCustomerAddress(supabase, {
          address: trimmedAddress,
          number: trimmedNumber,
          neighborhood: trimmedNeighborhood,
          city,
          state,
          cep,
          pinLatitude: parsedLat,
          pinLongitude: parsedLng,
        });

        if (geoValidation.error) {
          return res.status(400).json({ error: geoValidation.error });
        }
      }

      let initialOrdersCount = 0;
      let initialTotalSpent = 0;
      let initialLastOrderAt: string | undefined = undefined;
      let validGuestOrderToLink: string | null = null;

      if (
        typeof guestOrderId === 'string' &&
        guestOrderId.trim() &&
        typeof guestToken === 'string' &&
        /^[a-f0-9]{32}$/i.test(guestToken.trim())
      ) {
        const { data: guestOrderRow, error: guestOrderErr } = await supabase
          .from('orders')
          .select('id, total, created_at, guest_token, customer_id')
          .eq('id', guestOrderId.trim())
          .maybeSingle();

        if (
          !guestOrderErr &&
          guestOrderRow &&
          !guestOrderRow.customer_id &&
          typeof guestOrderRow.guest_token === 'string' &&
          guestOrderRow.guest_token === guestToken.trim()
        ) {
          validGuestOrderToLink = String(guestOrderRow.id);
          initialOrdersCount = 1;
          initialTotalSpent = Number(guestOrderRow.total) || 0;
          initialLastOrderAt = guestOrderRow.created_at || new Date().toISOString();
        }
      }

      const newCustProfile: CustomerProfile = {
        id: customerId,
        name: name.trim(),
        email: cleanEmail,
        phone: String(phone).trim(),
        address: isPickupPlaceholder ? '' : trimmedAddress,
        number: isPickupPlaceholder ? '' : trimmedNumber,
        neighborhood: isPickupPlaceholder ? '' : trimmedNeighborhood,
        complement: complement ? complement.trim() : undefined,
        reference: reference ? reference.trim() : undefined,
        cep: cep ? cep.trim() : undefined,
        city: city ? city.trim() : undefined,
        state: state ? state.trim() : undefined,
        latitude: geoValidation.latitude,
        longitude: geoValidation.longitude,
        geoLatitude: geoValidation.geoLatitude,
        geoLongitude: geoValidation.geoLongitude,
        geoPrecision: geoValidation.geoPrecision,
        pinOffsetM: geoValidation.pinOffsetM,
        locationVerified: geoValidation.locationVerified,
        distanceKm: geoValidation.distanceKm,
        isWithinDeliveryRadius: geoValidation.isWithinDeliveryRadius,
        createdAt: new Date().toISOString(),
        totalOrdersCount: initialOrdersCount,
        totalSpent: initialTotalSpent,
        lastOrderAt: initialLastOrderAt,
      };

      let dbPayload = customerToDB(newCustProfile, passwordHash);
      let { data: insertedRow, error: insertErr } = await supabase
        .from('customers')
        .insert(dbPayload)
        .select('*')
        .single();

      // If customers.email has a NOT NULL constraint in the database and email was omitted, fallback to a phone-based internal email
      if (insertErr && !cleanEmail) {
        newCustProfile.email = `${cleanPhoneDigits}@whatsapp.cliente`;
        dbPayload = customerToDB(newCustProfile, passwordHash);
        const retryInsert = await supabase
          .from('customers')
          .insert(dbPayload)
          .select('*')
          .single();
        insertedRow = retryInsert.data;
        insertErr = retryInsert.error;
      }

      if (insertErr) {
        console.error('[Supabase Error] customer register insert:', insertErr.message);
        return res.status(500).json({ error: insertErr.message });
      }

      if (validGuestOrderToLink) {
        const { error: linkErr } = await supabase
          .from('orders')
          .update({ customer_id: customerId })
          .eq('id', validGuestOrderToLink);
        if (linkErr) {
          console.warn('[Supabase Warning] link guest order to new customer:', linkErr.message);
        }
      }

      const { token, expiresAt } = createCustomerSignedToken(customerId);

      return res.status(201).json({
        success: true,
        token,
        expiresAt,
        customer: sanitizePublicCustomer(insertedRow ? customerFromDB(insertedRow) : newCustProfile),
      });
    } catch (err: any) {
      console.error('[Auth Error] customer registration error:', err);
      return res.status(500).json({ error: err.message || 'Erro ao registrar cliente.' });
    }
  });

  router.post('/customer/login', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail/WhatsApp e senha são obrigatórios.' });
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

    const rawIdentifier = String(email).trim();
    let customerRow: any = null;

    if (rawIdentifier.includes('@')) {
      const cleanEmail = rawIdentifier.toLowerCase();
      const { data, error: fetchErr } = await supabase
        .from('customers')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (fetchErr) {
        console.error('[Supabase Error] customer login query:', fetchErr.message);
        return res.status(500).json({ error: fetchErr.message });
      }
      customerRow = data;
    } else {
      const cleanDigits = normalizeBrazilianPhoneDigits(rawIdentifier);
      if (cleanDigits.length >= 10) {
        const { data: phoneCandidates, error: phoneFetchErr } = await supabase
          .from('customers')
          .select('*')
          .not('password_hash', 'is', null);

        if (phoneFetchErr) {
          console.error('[Supabase Error] customer login phone query:', phoneFetchErr.message);
          return res.status(500).json({ error: phoneFetchErr.message });
        }

        customerRow = (phoneCandidates || []).find(
          (r: any) => normalizeBrazilianPhoneDigits(r.phone) === cleanDigits
        );
      }
    }

    if (!customerRow || !customerRow.password_hash) {
      // Record failed attempt
      await supabase.from('admin_login_attempts').insert({
        ip: attemptIp,
        success: false,
        created_at: new Date().toISOString(),
      });
      return res.status(401).json({ error: 'E-mail/WhatsApp ou senha incorretos.' });
    }

    const isMatch = await verifyPassword(String(password), customerRow.password_hash);

    await supabase.from('admin_login_attempts').insert({
      ip: attemptIp,
      success: isMatch,
      created_at: new Date().toISOString(),
    });

    if (!isMatch) {
      return res.status(401).json({ error: 'E-mail/WhatsApp ou senha incorretos.' });
    }

    const { token, expiresAt } = createCustomerSignedToken(customerRow.id);
    const { customer } = await ensureLegacyCustomerGeocoded(supabase, customerRow);

    return res.json({
      success: true,
      token,
      expiresAt,
      customer: sanitizePublicCustomer(customer),
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

    const { customer } = await ensureLegacyCustomerGeocoded(supabase, data);
    res.json(sanitizePublicCustomer(customer));
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

    const nextAddress = body.address !== undefined ? String(body.address).trim() : (existing.address || '');
    const nextNumber = body.number !== undefined ? String(body.number).trim() : (existing.number || '');
    const nextNeighborhood = body.neighborhood !== undefined ? String(body.neighborhood).trim() : (existing.neighborhood || '');
    const nextCep = body.cep !== undefined ? String(body.cep).trim() : (existing.cep || '');
    const nextCity = body.city !== undefined ? String(body.city).trim() : (existing.city || '');
    const nextState = body.state !== undefined ? String(body.state).trim() : (existing.state || '');

    const hasIncomingPin =
      body.latitude !== undefined &&
      body.latitude !== null &&
      !Number.isNaN(Number(body.latitude)) &&
      body.longitude !== undefined &&
      body.longitude !== null &&
      !Number.isNaN(Number(body.longitude));

    const addressTextChanged =
      nextAddress !== (existing.address || '') ||
      nextNumber !== (existing.number || '') ||
      nextNeighborhood !== (existing.neighborhood || '') ||
      nextCep.replace(/\D/g, '') !== String(existing.cep || '').replace(/\D/g, '') ||
      nextCity !== (existing.city || '') ||
      nextState !== (existing.state || '');

    const pinLat = hasIncomingPin
      ? Number(body.latitude)
      : !addressTextChanged && existing.latitude !== null && existing.latitude !== undefined
      ? Number(existing.latitude)
      : undefined;
    const pinLng = hasIncomingPin
      ? Number(body.longitude)
      : !addressTextChanged && existing.longitude !== null && existing.longitude !== undefined
      ? Number(existing.longitude)
      : undefined;

    const geoValidation = await resolveAndValidateCustomerAddress(supabase, {
      address: nextAddress,
      number: nextNumber,
      neighborhood: nextNeighborhood,
      city: nextCity,
      state: nextState,
      cep: nextCep,
      pinLatitude: pinLat,
      pinLongitude: pinLng,
    });

    if (geoValidation.error) {
      return res.status(400).json({ error: geoValidation.error });
    }

    const updatedProfile: CustomerProfile = {
      ...customerFromDB(existing),
      name: body.name !== undefined ? body.name : existing.name,
      phone: body.phone !== undefined ? body.phone : existing.phone,
      address: nextAddress,
      number: nextNumber,
      neighborhood: nextNeighborhood,
      complement: body.complement !== undefined ? body.complement : existing.complement,
      reference: body.reference !== undefined ? body.reference : existing.reference,
      cep: nextCep,
      city: nextCity,
      state: nextState,
      latitude: geoValidation.latitude,
      longitude: geoValidation.longitude,
      geoLatitude: geoValidation.geoLatitude,
      geoLongitude: geoValidation.geoLongitude,
      geoPrecision: geoValidation.geoPrecision,
      pinOffsetM: geoValidation.pinOffsetM,
      locationVerified: geoValidation.locationVerified,
      distanceKm: geoValidation.distanceKm,
      isWithinDeliveryRadius: geoValidation.isWithinDeliveryRadius,
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

    return res.json(sanitizePublicCustomer(customerFromDB(savedRow)));
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

    const { customer: dbCustomer } = await ensureLegacyCustomerGeocoded(supabase, custRes.data);
    const dbAreas = (areasRes.data || []).map(deliveryAreaFromDB);
    const dbSettings: StoreSettings = settingsRes.data?.data
      ? sanitizePublicSettings(settingsRes.data.data)
      : initialSettings;

    const maxRadiusKm = Number(dbSettings.deliveryRadiusKm) || 5;
    let distanceKm: number | null = null;
    let isWithinDeliveryRadius = true;

    const quoteRefLat = dbCustomer.geoLatitude ?? dbCustomer.latitude;
    const quoteRefLng = dbCustomer.geoLongitude ?? dbCustomer.longitude;

    if (
      quoteRefLat !== undefined &&
      quoteRefLat !== null &&
      quoteRefLng !== undefined &&
      quoteRefLng !== null &&
      dbSettings.storeLatitude !== undefined &&
      dbSettings.storeLatitude !== null &&
      dbSettings.storeLongitude !== undefined &&
      dbSettings.storeLongitude !== null
    ) {
      distanceKm = haversineKm(
        Number(dbSettings.storeLatitude),
        Number(dbSettings.storeLongitude),
        Number(quoteRefLat),
        Number(quoteRefLng)
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

    return res.json((data || []).map((r: any) => orderFromDB(r)).map(sanitizeCustomerOrder));
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

    return res.json(sanitizeCustomerOrder(orderFromDB(data)));
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

    const expMs = getCouponExpirationMs(coupon.expiresAt);
    if (expMs !== null && expMs < Date.now()) {
      return res.status(400).json({ error: 'Este cupom já expirou.' });
    }

    if (coupon.maxUses !== null && coupon.maxUses !== undefined && coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({ error: 'Este cupom está esgotado (limite máximo de usos atingido).' });
    }

    let numSubtotal = Number(subtotal) || 0;
    if (Array.isArray(items) && items.length > 0) {
      const [{ data: prodRows, error: prodErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
        supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);
      if (prodErr) return res.status(500).json({ error: prodErr.message });
      if (settingsErr) return res.status(500).json({ error: settingsErr.message });

      if (prodRows) {
        const dbProds = mapProductsFromDB(prodRows);
        const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;
        reconcileSettingsCategoriesAndOrders(dbSettings, dbProds);

        let calculatedSub = 0;
        for (const it of items) {
          const sp = dbProds.find((p) => p.id === (it.productId || it.id));
          if (sp && sp.active) {
            const qty = Math.max(1, parseInt(it.quantity, 10) || 1);
            const isCase = it.saleUnit === 'case' && canSellProductCase(sp, dbSettings, 'store');
            const baseUnitPrice = isCase ? Number(sp.casePrice) : getEffectivePrice(sp);
            const addonCalc = validateAndCalculateItemAddons(sp, it.addons, dbSettings);
            const unitPrice = Math.round((baseUnitPrice + (addonCalc.error ? 0 : addonCalc.addonsTotal)) * 100) / 100;
            calculatedSub += unitPrice * qty;
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
      expiresAt: normalizeCouponExpiresAt(expiresAt),
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
    if (expiresAt !== undefined) updateData.expires_at = normalizeCouponExpiresAt(expiresAt);
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
      const [prodRes, imageMetaMap, areasRes, settingsRes] = await Promise.all([
        supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE),
        fetchProductImageMetaMap(supabase),
        supabase.from('delivery_areas').select('*').eq('active', true),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);

      if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
      if (areasRes.error) return res.status(500).json({ error: areasRes.error.message });
      if (settingsRes.error) return res.status(500).json({ error: settingsRes.error.message });

      const allProductRows = mapProductsFromDB(prodRes.data, imageMetaMap);
      const deliveryAreas = (areasRes.data || []).map(deliveryAreaFromDB);

      let settings = sanitizePublicSettings(initialSettings);
      let shouldPersistSettings = false;
      if (settingsRes.data && settingsRes.data.data) {
        settings = sanitizePublicSettings(settingsRes.data.data);
      } else {
        shouldPersistSettings = true;
      }

      const reconciled = reconcileSettingsCategoriesAndOrders(settings, allProductRows as any);
      settings = reconciled.settings;
      if (reconciled.changed) {
        shouldPersistSettings = true;
      }

      const productsWithCombos = applyCombosStockAndCost(allProductRows, settings);
      const products = productsWithCombos
        .filter((p) => p.active !== false)
        .map(sanitizePublicProduct);

      if (shouldPersistSettings) {
        const { error: persistErr } = await supabase.from('store_settings').upsert({
          id: 'default',
          data: settings,
          updated_at: new Date().toISOString(),
        });
        if (persistErr) {
          console.error('[Supabase Error] store_settings persist in /state:', persistErr.message);
        }
      }

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
      const cutoff48hIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const [prodRes, imageMetaMap, areasRes, custRes, orderRes, couponsRes, settingsRes] = await Promise.all([
        supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE).order('name'),
        fetchProductImageMetaMap(supabase),
        supabase.from('delivery_areas').select('*'),
        supabase.from('customers').select('*').order('created_at', { ascending: false }),
        supabase
          .from('orders')
          .select('*')
          .or(`created_at.gte.${cutoff48hIso},status.in.(pendente,em_separacao,em_rota)`)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('coupons').select('*').order('code'),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);

      if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
      if (areasRes.error) return res.status(500).json({ error: areasRes.error.message });
      if (custRes.error) return res.status(500).json({ error: custRes.error.message });
      if (orderRes.error) return res.status(500).json({ error: orderRes.error.message });
      if (couponsRes.error) return res.status(500).json({ error: couponsRes.error.message });
      if (settingsRes.error) return res.status(500).json({ error: settingsRes.error.message });

      const mappedProducts = mapProductsFromDB(prodRes.data, imageMetaMap);

      let settings = sanitizePublicSettings(initialSettings);
      if (settingsRes.data && settingsRes.data.data) {
        settings = sanitizePublicSettings(settingsRes.data.data);
      }

      const reconciled = reconcileSettingsCategoriesAndOrders(settings, mappedProducts);
      settings = reconciled.settings;
      if (reconciled.changed) {
        const { error: persistErr } = await supabase.from('store_settings').upsert({
          id: 'default',
          data: settings,
          updated_at: new Date().toISOString(),
        });
        if (persistErr) {
          console.error('[Supabase Error] store_settings persist in /admin/state:', persistErr.message);
        }
      }

      const productsWithCombos = applyCombosStockAndCost(mappedProducts, settings);
      const customers = (custRes.data || []).map(customerFromDB);
      const customerById = new Map<string, CustomerProfile>(customers.map((c) => [c.id, c]));

      return res.json({
        products: productsWithCombos,
        orders: (orderRes.data || []).map((r: any) => orderFromDB(r, customerById)),
        deliveryAreas: (areasRes.data || []).map(deliveryAreaFromDB),
        customers,
        coupons: (couponsRes.data || []).map(couponFromDB),
        settings,
        serverTime: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Server Error] GET /api/admin/state:', err);
      return res.status(500).json({ error: err.message || 'Erro interno ao carregar estado.' });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN LIGHTWEIGHT CHANGE CHECK: GET /admin/changes?since=<timestamp>
  // ---------------------------------------------------------------------------
  router.get('/admin/changes', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    const rawSince = typeof req.query.since === 'string' ? req.query.since.trim() : '';
    let sinceMs = 0;
    if (rawSince) {
      const asNum = Number(rawSince);
      if (!Number.isNaN(asNum) && asNum > 0) {
        sinceMs = asNum;
      } else {
        const parsed = new Date(rawSince).getTime();
        if (!Number.isNaN(parsed) && parsed > 0) {
          sinceMs = parsed;
        }
      }
    }

    if (!sinceMs) {
      return res.json({
        ordersChanged: true,
        productsChanged: true,
        tabsChanged: true,
        serverTime: new Date().toISOString(),
      });
    }

    try {
      const [latestOrderRes, latestProdRes, latestMovRes, latestTabRes, latestTabItemRes] = await Promise.all([
        supabase
          .from('orders')
          .select('created_at,updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('products')
          .select('updated_at')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('stock_movements')
          .select('created_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('table_tabs')
          .select('opened_at,closed_at')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('table_tab_items')
          .select('created_at,cancelled_at')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (latestOrderRes.error) {
        console.error('[Supabase Error] /admin/changes orders:', latestOrderRes.error.message);
      }
      if (latestProdRes.error) {
        console.error('[Supabase Error] /admin/changes products:', latestProdRes.error.message);
      }
      if (latestMovRes.error) {
        console.error('[Supabase Error] /admin/changes stock_movements:', latestMovRes.error.message);
      }
      if (latestTabRes.error) {
        console.error('[Supabase Error] /admin/changes table_tabs:', latestTabRes.error.message);
      }
      if (latestTabItemRes.error) {
        console.error('[Supabase Error] /admin/changes table_tab_items:', latestTabItemRes.error.message);
      }

      const toMs = (v: unknown): number => {
        if (!v) return 0;
        const t = new Date(String(v)).getTime();
        return Number.isNaN(t) ? 0 : t;
      };

      const latestOrderMs = Math.max(
        toMs(latestOrderRes.data?.created_at),
        toMs(latestOrderRes.data?.updated_at)
      );
      const latestProdMs = Math.max(
        toMs(latestProdRes.data?.updated_at),
        toMs(latestMovRes.data?.created_at)
      );
      const latestTabMs = Math.max(
        toMs(latestTabRes.data?.opened_at),
        toMs(latestTabRes.data?.closed_at),
        toMs(latestTabItemRes.data?.created_at),
        toMs(latestTabItemRes.data?.cancelled_at)
      );

      // Add a small 2s safety overlap window
      const thresholdMs = Math.max(0, sinceMs - 2000);

      return res.json({
        ordersChanged: latestOrderMs >= thresholdMs,
        productsChanged: latestProdMs >= thresholdMs,
        tabsChanged: latestTabMs >= thresholdMs,
        serverTime: new Date().toISOString(),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Erro ao verificar atualizações.' });
    }
  });

  // ---------------------------------------------------------------------------
  // ADMIN POLLING FOR NEW ORDERS: GET /admin/orders
  // Supports ?since=<timestamp> and limits to last 48h + active orders
  // ---------------------------------------------------------------------------
  router.get('/admin/orders', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    try {
      const cutoff48hIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const rawSince = typeof req.query.since === 'string' ? req.query.since.trim() : '';
      let sinceIso: string | null = null;
      if (rawSince) {
        const asNum = Number(rawSince);
        const d = !Number.isNaN(asNum) && asNum > 0 ? new Date(asNum) : new Date(rawSince);
        if (!Number.isNaN(d.getTime())) {
          // 5s overlap window to avoid clock drift misses
          sinceIso = new Date(Math.max(0, d.getTime() - 5000)).toISOString();
        }
      }

      let orderQuery = supabase
        .from('orders')
        .select('*')
        .or(`created_at.gte.${cutoff48hIso},status.in.(pendente,em_separacao,em_rota)`)
        .order('created_at', { ascending: false })
        .limit(300);

      if (sinceIso) {
        orderQuery = supabase
          .from('orders')
          .select('*')
          .or(`created_at.gte.${sinceIso},updated_at.gte.${sinceIso},status.in.(pendente,em_separacao,em_rota)`)
          .order('created_at', { ascending: false })
          .limit(200);
      }

      const orderRes = await orderQuery;

      if (orderRes.error) {
        console.error('[Supabase Error] admin orders query:', orderRes.error.message);
        return res.status(500).json({ error: orderRes.error.message });
      }

      const orderRows = orderRes.data || [];
      const customerIds = Array.from(
        new Set(
          orderRows
            .map((r: any) => (r.customer_id ? String(r.customer_id).trim() : ''))
            .filter(Boolean)
        )
      );

      const customerById = new Map<string, CustomerProfile>();
      if (customerIds.length > 0) {
        const custRes = await supabase
          .from('customers')
          .select('*')
          .in('id', customerIds);

        if (custRes.error) {
          console.error('[Supabase Error] admin customers for orders query:', custRes.error.message);
          return res.status(500).json({ error: custRes.error.message });
        }

        for (const cRow of custRes.data || []) {
          const c = customerFromDB(cRow);
          customerById.set(c.id, c);
        }
      }

      const orders = orderRows.map((r: any) => orderFromDB(r, customerById));
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

    const [{ data, error }, imageMetaMap, { data: settingsRow, error: settingsErr }] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE).order('name'),
      fetchProductImageMetaMap(supabase),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);
    if (error) return res.status(500).json({ error: error.message });
    if (settingsErr) return res.status(500).json({ error: settingsErr.message });

    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const signed = token ? verifySignedToken(token) : null;
    const isAdmin = signed?.role === 'admin';

    const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;
    const mapped = applyCombosStockAndCost(mapProductsFromDB(data, imageMetaMap), dbSettings);
    res.json(isAdmin ? mapped : mapped.filter((p) => p.active).map(sanitizePublicProduct));
  });

  // ---------------------------------------------------------------------------
  // PUBLIC PRODUCT IMAGE ROUTE: GET /products/:id/image
  // Reads ONLY image, updated_at of that single product and serves binary with immutable cache
  // ---------------------------------------------------------------------------
  router.get('/products/:id/image', async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase não configurado no servidor.' });
    }

    const { data, error } = await supabase
      .from('products')
      .select('image, updated_at')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.error('[Supabase Error] GET /products/:id/image:', error.message);
      return res.status(500).json({ error: error.message });
    }

    const rawImage = typeof data?.image === 'string' ? data.image.trim() : '';
    if (!data || !rawImage) {
      return res.status(404).end();
    }

    const versionMs = parseUpdatedAtVersionMs(data.updated_at);
    const etag = `W/"prod-img-${Buffer.from(String(id)).toString('hex')}-${versionMs}-${rawImage.length}"`;

    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    if (/^https?:\/\//i.test(rawImage)) {
      return res.redirect(302, rawImage);
    }

    const match = rawImage.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/i);
    if (!match) {
      return res.status(404).end();
    }

    const contentType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const base64Data = match[2].replace(/\s+/g, '');
    const binaryBuffer = Buffer.from(base64Data, 'base64');

    if (!binaryBuffer || binaryBuffer.length === 0) {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(binaryBuffer.length));
    res.setHeader('X-Image-Storage-Bytes', String(Buffer.byteLength(rawImage, 'utf8')));
    res.setHeader('X-Image-Decoded-Bytes', String(binaryBuffer.length));
    return res.status(200).send(binaryBuffer);
  });

  // ---------------------------------------------------------------------------
  // ADMIN UPDATE ONLY PRODUCT IMAGE: PUT /admin/products/:id/image
  // ---------------------------------------------------------------------------
  router.put('/admin/products/:id/image', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const rawImage = req.body?.image;
    const imgValidation = validateIncomingProductImage(rawImage);
    if (imgValidation.error) {
      return res.status(400).json({ error: imgValidation.error });
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('products')
      .update({
        image: imgValidation.value,
        updated_at: nowIso,
      })
      .eq('id', id)
      .select('id, updated_at')
      .maybeSingle();

    if (error) {
      console.error('[Supabase Error] PUT /admin/products/:id/image:', error.message);
      return res.status(500).json({ error: error.message });
    }
    if (!data) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    invalidateProductImageMetaCache();
    const versionMs = parseUpdatedAtVersionMs(data.updated_at);
    const hasImage = Boolean(imgValidation.value);
    const externalUrl =
      imgValidation.value && /^https?:\/\//i.test(imgValidation.value) ? imgValidation.value : null;

    const imageUrl = buildProductImageUrl(
      String(data.id),
      {
        hasImage,
        externalUrl,
        versionMs,
      },
      data.updated_at
    );

    return res.json({
      id: String(data.id),
      imageUrl,
      updatedAt: String(data.updated_at || nowIso),
      decodedBytes: imgValidation.decodedBytes ?? 0,
      storageBytes: imgValidation.value ? Buffer.byteLength(imgValidation.value, 'utf8') : 0,
    });
  });

  router.post('/products', requireAdmin, async (req, res) => {
    const product = req.body as Product;
    if (!product || !product.id || !product.name) {
      return res.status(400).json({ error: 'Dados do produto inválidos.' });
    }

    const parsedCase = parseProductCaseFields(product);
    if (parsedCase.error) {
      return res.status(400).json({ error: parsedCase.error });
    }

    const rawImageInput = product.image || product.imageUrl || '';
    const imgValidation = validateIncomingProductImage(rawImageInput);
    if (imgValidation.error) {
      return res.status(400).json({ error: imgValidation.error });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existingRow, error: existingErr } = await supabase
      .from('products')
      .select('id, stock')
      .eq('id', product.id)
      .maybeSingle();
    if (existingErr) {
      return res.status(500).json({ error: existingErr.message });
    }

    let finalImageToSave: string | null = imgValidation.value;
    if (imgValidation.keepExisting) {
      const sourceId = imgValidation.copyFromProductId || product.id;
      const { data: srcImgRow, error: srcImgErr } = await supabase
        .from('products')
        .select('image')
        .eq('id', sourceId)
        .maybeSingle();
      if (srcImgErr) {
        return res.status(500).json({ error: srcImgErr.message });
      }
      finalImageToSave = srcImgRow?.image || null;
    }

    const requestedStock = Math.max(0, Math.trunc(Number(product.stock) || 0));
    const normalizedProduct: Product = {
      ...product,
      stock: existingRow ? Number(existingRow.stock || 0) : 0,
      caseSize: parsedCase.caseSize,
      casePrice: parsedCase.casePrice,
    };

    const { data, error } = await supabase
      .from('products')
      .upsert(productToDB(normalizedProduct, finalImageToSave))
      .select(PRODUCT_COLUMNS_NO_IMAGE)
      .single();
    if (error) {
      console.error('[Supabase Error] products upsert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    invalidateProductImageMetaCache();
    const imageMetaMap = await fetchProductImageMetaMap(supabase, true);
    let savedProduct = data ? productFromDB(data, imageMetaMap) : normalizedProduct;
    const { data: settingsRow, error: settingsErr } = await supabase
      .from('store_settings')
      .select('data')
      .eq('id', 'default')
      .maybeSingle();
    if (settingsErr) {
      console.error('[Supabase Error] store_settings in POST /products:', settingsErr.message);
      return res.status(500).json({ error: settingsErr.message });
    }
    const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;
    const isCombo = isComboProduct(savedProduct.id, dbSettings);

    if (!isCombo && requestedStock !== Number(savedProduct.stock || 0)) {
      const { data: newStockVal, error: adjErr } = await supabase.rpc('adjust_stock', {
        p_product_id: savedProduct.id,
        p_mode: 'set',
        p_value: requestedStock,
        p_reason: existingRow ? 'ajuste' : 'entrada',
        p_note: existingRow ? null : 'Estoque inicial no cadastro',
      });
      if (adjErr) {
        console.error('[RPC Error] adjust_stock in POST /products:', adjErr.message);
        if (String(adjErr.message || '').includes('ESTOQUE_NEGATIVO')) {
          return res.status(400).json({ error: 'O estoque não pode ficar negativo' });
        }
        return res.status(500).json({ error: adjErr.message });
      }
      savedProduct.stock = Number(newStockVal ?? requestedStock);
    }

    if (isCombo) {
      const { data: allRows, error: allErr } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS_NO_IMAGE);
      if (allErr) return res.status(500).json({ error: allErr.message });
      const withCombos = applyCombosStockAndCost(mapProductsFromDB(allRows, imageMetaMap), dbSettings);
      const found = withCombos.find((p) => p.id === savedProduct.id);
      if (found) savedProduct = found;
    }

    res.status(201).json(savedProduct);
  });

  // Requirement: Em PUT /api/products/:id não grava stock direto em products: se mudou, chama adjust_stock com mode='set', reason='ajuste'
  router.put('/products/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const body = req.body || {};
    const parsedCase = parseProductCaseFields(body);
    if (parsedCase.error) {
      return res.status(400).json({ error: parsedCase.error });
    }

    const hasImageField = Object.prototype.hasOwnProperty.call(body, 'image');
    const imgValidation = hasImageField
      ? validateIncomingProductImage(body.image)
      : { value: null, keepExisting: true };
    if (imgValidation.error) {
      return res.status(400).json({ error: imgValidation.error });
    }

    const [{ data: existingRow, error: fetchExistErr }, { data: settingsRow, error: settingsErr }] =
      await Promise.all([
        supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE).eq('id', id).maybeSingle(),
        supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      ]);

    if (fetchExistErr) {
      return res.status(500).json({ error: fetchExistErr.message });
    }
    if (settingsErr) {
      return res.status(500).json({ error: settingsErr.message });
    }
    if (!existingRow) {
      return res.status(404).json({ error: 'Produto não encontrado.' });
    }

    const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;
    const isCombo = isComboProduct(id, dbSettings);

    let targetStock: number | null = null;
    if (
      !isCombo &&
      Object.prototype.hasOwnProperty.call(body, 'stock') &&
      body.stock !== undefined &&
      body.stock !== null &&
      String(body.stock).trim() !== ''
    ) {
      const parsedStock = Number(body.stock);
      if (!Number.isInteger(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ error: 'O estoque não pode ficar negativo' });
      }
      targetStock = parsedStock;
    }

    const updateData: Record<string, any> = {
      name: body.name,
      category: body.category,
      volume: body.volume || null,
      price: Number(body.price) || 0,
      case_size: parsedCase.caseSize,
      case_price: parsedCase.casePrice,
      cost_price: Number(body.costPrice) || 0,
      min_stock: Number(body.minStock ?? 10),
      is_cold: body.isCold !== false,
      sku: body.sku || null,
      active: body.active !== false,
      description: body.description || '',
      updated_at: new Date().toISOString(),
    };

    if (!imgValidation.keepExisting) {
      updateData.image = imgValidation.value;
    }

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
      .select(PRODUCT_COLUMNS_NO_IMAGE)
      .maybeSingle();

    if (error || !data) {
      console.error('[Supabase Error] products update:', error?.message);
      return res.status(500).json({ error: error?.message || 'Produto não encontrado.' });
    }

    invalidateProductImageMetaCache();
    const imageMetaMap = await fetchProductImageMetaMap(supabase, true);
    let updatedProduct = productFromDB(data, imageMetaMap);

    if (!isCombo && targetStock !== null && targetStock !== Number(existingRow.stock || 0)) {
      const { data: newStockVal, error: adjErr } = await supabase.rpc('adjust_stock', {
        p_product_id: id,
        p_mode: 'set',
        p_value: targetStock,
        p_reason: 'ajuste',
        p_note: null,
      });
      if (adjErr) {
        console.error('[RPC Error] adjust_stock in PUT /products/:id:', adjErr.message);
        const msg = String(adjErr.message || '');
        if (msg.includes('ESTOQUE_NEGATIVO')) {
          return res.status(400).json({ error: 'O estoque não pode ficar negativo' });
        }
        if (msg.includes('PRODUTO_NAO_ENCONTRADO')) {
          return res.status(404).json({ error: 'Produto não encontrado.' });
        }
        return res.status(500).json({ error: msg });
      }
      updatedProduct.stock = Number(newStockVal ?? targetStock);
    }

    if (isCombo) {
      const { data: allRows, error: allErr } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS_NO_IMAGE);
      if (allErr) return res.status(500).json({ error: allErr.message });
      const withCombos = applyCombosStockAndCost(mapProductsFromDB(allRows, imageMetaMap), dbSettings);
      const found = withCombos.find((p) => p.id === updatedProduct.id);
      if (found) updatedProduct = found;
    }

    res.json(updatedProduct);
  });

  // Requirement: Rotas exclusivas para gerenciar promoção do produto (sem mexer em price nem stock)
  router.put('/admin/products/:id/promotion', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { promoPrice, promoEndsAt } = req.body || {};
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existing, error: fetchErr } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS_NO_IMAGE)
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(PRODUCT_COLUMNS_NO_IMAGE)
      .single();

    if (updateErr || !updated) {
      console.error('[Supabase Error] product promotion update:', updateErr?.message);
      return res.status(500).json({ error: updateErr?.message || 'Erro ao salvar promoção.' });
    }

    const imageMetaMap = await fetchProductImageMetaMap(supabase);
    res.json(productFromDB(updated, imageMetaMap));
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
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(PRODUCT_COLUMNS_NO_IMAGE)
      .maybeSingle();

    if (updateErr || !updated) {
      console.error('[Supabase Error] product promotion delete:', updateErr?.message);
      return res.status(404).json({ error: updateErr?.message || 'Produto não encontrado.' });
    }

    const imageMetaMap = await fetchProductImageMetaMap(supabase);
    res.json(productFromDB(updated, imageMetaMap));
  });

  // Requirement 2a: POST /api/admin/products/:id/stock (mode: 'delta'|'set', value: inteiro, reason: 'ajuste'|'entrada'|'perda'|'contagem', note)
  const handleManualStockAdjust = async (req: express.Request, res: express.Response) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const [{ data: existingRow, error: prodErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE).eq('id', id).maybeSingle(),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);

    if (prodErr) return res.status(500).json({ error: prodErr.message });
    if (settingsErr) return res.status(500).json({ error: settingsErr.message });
    if (!existingRow) return res.status(404).json({ error: 'Produto não encontrado.' });

    const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;
    if (isComboProduct(id, dbSettings)) {
      return res.status(400).json({
        error: 'O campo de estoque do combo não pode ser editado (o estoque é dos itens).',
      });
    }

    const body = req.body || {};
    let mode: 'delta' | 'set' = body.mode === 'set' ? 'set' : 'delta';
    let value: number;

    if (body.value !== undefined && body.value !== null && String(body.value).trim() !== '') {
      const parsedVal = Number(body.value);
      if (!Number.isInteger(parsedVal)) {
        return res.status(400).json({ error: 'O valor de estoque deve ser um número inteiro.' });
      }
      value = parsedVal;
    } else if (body.delta !== undefined) {
      mode = 'delta';
      const rawDelta = Math.trunc(Number(body.delta) || 0);
      const unit = body.unit === 'case' ? 'case' : 'unit';
      if (unit === 'case') {
        const caseSize = existingRow.case_size !== null && existingRow.case_size !== undefined ? Number(existingRow.case_size) : 0;
        if (!Number.isInteger(caseSize) || caseSize < 2) {
          return res.status(400).json({ error: 'Este produto não possui unidades por caixa configuradas.' });
        }
        value = rawDelta * caseSize;
      } else {
        value = rawDelta;
      }
    } else {
      return res.status(400).json({ error: 'Informe o valor de ajuste de estoque.' });
    }

    if (mode === 'set' && value < 0) {
      return res.status(400).json({ error: 'O estoque não pode ficar negativo' });
    }

    if (mode === 'delta' && value === 0) {
      return res.json({ stock: Number(existingRow.stock || 0) });
    }

    const validReasons = new Set(['ajuste', 'entrada', 'perda', 'contagem']);
    const rawReason = typeof body.reason === 'string' ? body.reason.trim().toLowerCase() : 'ajuste';
    const reason = validReasons.has(rawReason) ? rawReason : 'ajuste';
    const note =
      typeof body.note === 'string' && body.note.trim().length > 0
        ? body.note.trim().slice(0, 200)
        : null;

    const { data: newStock, error: rpcErr } = await supabase.rpc('adjust_stock', {
      p_product_id: id,
      p_mode: mode,
      p_value: value,
      p_reason: reason,
      p_note: note,
    });

    if (rpcErr) {
      console.error('[RPC Error] adjust_stock:', rpcErr.message);
      const msg = String(rpcErr.message || '');
      if (msg.includes('ESTOQUE_NEGATIVO') || msg.includes('ESTOQUE_INSUFICIENTE')) {
        return res.status(400).json({ error: 'O estoque não pode ficar negativo' });
      }
      if (msg.includes('PRODUTO_NAO_ENCONTRADO')) {
        return res.status(404).json({ error: 'Produto não encontrado.' });
      }
      return res.status(400).json({ error: msg || 'Não foi possível ajustar o estoque.' });
    }

    return res.json({ stock: Number(newStock ?? 0) });
  };

  router.post('/admin/products/:id/stock', requireAdmin, handleManualStockAdjust);
  router.post('/products/:id/stock', requireAdmin, handleManualStockAdjust);

  // ---------------------------------------------------------------------------
  // STOCK MOVEMENTS HISTORY: GET /admin/stock-movements
  // ---------------------------------------------------------------------------
  router.get('/admin/stock-movements', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const productId = typeof req.query.productId === 'string' ? req.query.productId.trim() : '';
    const reason = typeof req.query.reason === 'string' ? req.query.reason.trim().toLowerCase() : '';
    const direction = typeof req.query.direction === 'string' ? req.query.direction.trim().toLowerCase() : '';
    const fromRaw = typeof req.query.from === 'string' ? req.query.from.trim() : '';
    const toRaw = typeof req.query.to === 'string' ? req.query.to.trim() : '';
    const beforeRaw = typeof req.query.before === 'string' ? req.query.before.trim() : '';
    const parsedLimit = parseInt(String(req.query.limit || '100'), 10);
    const limit = Number.isNaN(parsedLimit) ? 100 : Math.max(1, Math.min(500, parsedLimit));

    const toIsoRange = (raw: string, isEnd: boolean): string | null => {
      if (!raw) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return isEnd ? `${raw}T23:59:59.999-03:00` : `${raw}T00:00:00.000-03:00`;
      }
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    };

    const fromIso = toIsoRange(fromRaw, false);
    const toIso = toIsoRange(toRaw, true);
    const beforeIso = beforeRaw ? toIsoRange(beforeRaw, true) || beforeRaw : null;

    const applyCommonFilters = (q: any) => {
      let query = q;
      if (productId) {
        query = query.eq('product_id', productId);
      }
      if (reason && reason !== 'todos') {
        if (reason === 'cancelamento') {
          query = query.in('reason', ['cancelamento', 'mesa_cancelamento', 'estorno_erro']);
        } else {
          query = query.eq('reason', reason);
        }
      }
      if (direction === 'in' || direction === 'entradas') {
        query = query.gt('delta', 0);
      } else if (direction === 'out' || direction === 'saidas') {
        query = query.lt('delta', 0);
      }
      if (fromIso) {
        query = query.gte('created_at', fromIso);
      }
      if (toIso) {
        query = query.lte('created_at', toIso);
      }
      return query;
    };

    let listQuery = applyCommonFilters(
      supabase
        .from('stock_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
    );

    if (beforeIso) {
      listQuery = listQuery.lt('created_at', beforeIso);
    }

    const summaryQuery = applyCommonFilters(
      supabase
        .from('stock_movements')
        .select('delta')
        .limit(5000)
    );

    const [listRes, summaryRes] = await Promise.all([
      listQuery.limit(limit + 1),
      summaryQuery,
    ]);

    if (listRes.error) {
      console.error('[Supabase Error] stock_movements list:', listRes.error.message);
      return res.status(500).json({ error: listRes.error.message });
    }
    if (summaryRes.error) {
      console.error('[Supabase Error] stock_movements summary:', summaryRes.error.message);
      return res.status(500).json({ error: summaryRes.error.message });
    }

    const rawRows = Array.isArray(listRes.data) ? listRes.data : [];
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

    // Resolve table numbers for any comanda movements
    const comandaRefIds: string[] = Array.from(
      new Set<string>(
        pageRows
          .filter((r: any) => r.ref_type === 'comanda' && r.ref_id)
          .map((r: any) => String(r.ref_id).trim())
          .filter(Boolean)
      )
    );

    const tableNumberByRefId = new Map<string, number>();
    if (comandaRefIds.length > 0) {
      const { data: tabsData, error: tabsErr } = await supabase
        .from('table_tabs')
        .select('id, table_id')
        .in('id', comandaRefIds);

      if (tabsErr) {
        console.error('[Supabase Error] table_tabs lookup for stock_movements:', tabsErr.message);
      } else {
        const foundTabIds = new Set<string>((tabsData || []).map((t: any) => String(t.id)));
        const missingRefIds = comandaRefIds.filter((rid: string) => !foundTabIds.has(rid));
        const tabIdByItemRef = new Map<string, string>();
        let allTabsList: Array<{ id: string; table_id: string }> = [...(tabsData || [])];

        if (missingRefIds.length > 0) {
          const { data: tabItemsData, error: tabItemsErr } = await supabase
            .from('table_tab_items')
            .select('id, tab_id')
            .in('id', missingRefIds);
          if (!tabItemsErr && tabItemsData && tabItemsData.length > 0) {
            const extraTabIds = Array.from(
              new Set(tabItemsData.map((ti: any) => String(ti.tab_id)).filter(Boolean))
            );
            for (const ti of tabItemsData) {
              tabIdByItemRef.set(String(ti.id), String(ti.tab_id));
            }
            if (extraTabIds.length > 0) {
              const { data: extraTabs, error: extraTabsErr } = await supabase
                .from('table_tabs')
                .select('id, table_id')
                .in('id', extraTabIds);
              if (!extraTabsErr && extraTabs) {
                allTabsList = [...allTabsList, ...extraTabs];
              }
            }
          }
        }

        const tableIds = Array.from(
          new Set(allTabsList.map((t: any) => String(t.table_id)).filter(Boolean))
        );
        if (tableIds.length > 0) {
          const { data: tablesData, error: tablesErr } = await supabase
            .from('dining_tables')
            .select('id, number')
            .in('id', tableIds);
          if (!tablesErr && tablesData) {
            const numberByTableId = new Map<string, number>(
              tablesData.map((tb: any) => [String(tb.id), Number(tb.number)])
            );
            const numberByTabId = new Map<string, number>();
            for (const tbTab of allTabsList) {
              const num = numberByTableId.get(String(tbTab.table_id));
              if (num !== undefined) {
                numberByTabId.set(String(tbTab.id), num);
                tableNumberByRefId.set(String(tbTab.id), num);
              }
            }
            for (const [itemId, tId] of tabIdByItemRef.entries()) {
              const num = numberByTabId.get(tId);
              if (num !== undefined) {
                tableNumberByRefId.set(itemId, num);
              }
            }
          }
        }
      }
    }

    const items: StockMovement[] = pageRows.map((r: any) => {
      const refIdStr = r.ref_id ? String(r.ref_id) : null;
      const tblNum =
        r.ref_type === 'comanda' && refIdStr ? tableNumberByRefId.get(refIdStr) ?? null : null;
      return {
        id: String(r.id),
        createdAt: r.created_at || new Date().toISOString(),
        productId: String(r.product_id || ''),
        productName: String(r.product_name || ''),
        delta: Number(r.delta || 0),
        stockAfter: Number(r.stock_after || 0),
        reason: String(r.reason || 'ajuste'),
        refType: r.ref_type ? String(r.ref_type) : null,
        refId: refIdStr,
        note: r.note ? String(r.note) : null,
        tableNumber: tblNum,
      };
    });

    let totalIn = 0;
    let totalOut = 0;
    for (const sRow of summaryRes.data || []) {
      const d = Number((sRow as any).delta || 0);
      if (d > 0) totalIn += d;
      else if (d < 0) totalOut += Math.abs(d);
    }

    const nextBefore =
      hasMore && items.length > 0 ? items[items.length - 1].createdAt : null;

    const responsePayload: StockMovementsResponse = {
      items,
      summary: {
        totalIn,
        totalOut,
        balance: totalIn - totalOut,
      },
      hasMore,
      nextBefore,
    };

    return res.json(responsePayload);
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

    invalidateProductImageMetaCache();

    // If deleted product was in store_settings (combos, hiddenFromStoreIds, featuredProductIds, caseSaleChannels), clean it up
    const { data: settingsRow, error: settingsErr } = await supabase
      .from('store_settings')
      .select('data')
      .eq('id', 'default')
      .maybeSingle();
    if (!settingsErr && settingsRow?.data) {
      const cleanSettings = sanitizePublicSettings(settingsRow.data);
      let settingsChanged = false;
      if (cleanSettings.combos && cleanSettings.combos[id]) {
        delete cleanSettings.combos[id];
        settingsChanged = true;
      }
      if (Array.isArray(cleanSettings.hiddenFromStoreIds) && cleanSettings.hiddenFromStoreIds.includes(id)) {
        cleanSettings.hiddenFromStoreIds = cleanSettings.hiddenFromStoreIds.filter((pid) => pid !== id);
        settingsChanged = true;
      }
      if (Array.isArray(cleanSettings.featuredProductIds) && cleanSettings.featuredProductIds.includes(id)) {
        cleanSettings.featuredProductIds = cleanSettings.featuredProductIds.filter((pid) => pid !== id);
        settingsChanged = true;
      }
      if (cleanSettings.caseSaleChannels && cleanSettings.caseSaleChannels[id]) {
        delete cleanSettings.caseSaleChannels[id];
        settingsChanged = true;
      }
      if (settingsChanged) {
        const { error: saveSetErr } = await supabase.from('store_settings').upsert({
          id: 'default',
          data: cleanSettings,
          updated_at: new Date().toISOString(),
        });
        if (saveSetErr) {
          console.error('[Supabase Error] store_settings cleanup after product delete:', saveSetErr.message);
        }
      }
    }

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // IMPORT PRODUCTS FROM SPREADSHEET (.xlsx): POST /admin/products/import
  // ---------------------------------------------------------------------------
  router.post('/admin/products/import', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const rawRows = req.body?.rows;
    const duplicateMode: 'skip' | 'update' = req.body?.duplicateMode === 'update' ? 'update' : 'skip';

    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return res.status(400).json({ error: 'Nenhum produto enviado para importação.' });
    }

    if (rawRows.length > 2000) {
      return res.status(400).json({ error: 'A planilha excede o limite máximo de 2000 linhas.' });
    }

    const normalizeKey = (val: unknown): string =>
      String(val ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();

    const parseMoneyBr = (raw: unknown): number | null => {
      if (raw === null || raw === undefined || typeof raw === 'boolean') return null;
      if (typeof raw === 'number') {
        return Number.isFinite(raw) ? Math.round(raw * 100) / 100 : null;
      }
      let str = String(raw)
        .replace(/R\$/gi, '')
        .replace(/\s+/g, '')
        .trim();
      if (!str) return null;
      if (str.includes('.') && str.includes(',')) {
        str = str.replace(/\./g, '').replace(',', '.');
      } else if (str.includes(',')) {
        str = str.replace(',', '.');
      }
      const num = Number(str);
      if (Number.isNaN(num) || !Number.isFinite(num)) return null;
      return Math.round(num * 100) / 100;
    };

    const parseNonNegativeInt = (raw: unknown, defaultVal: number): { valid: boolean; value: number } => {
      if (raw === null || raw === undefined || String(raw).trim() === '') {
        return { valid: true, value: defaultVal };
      }
      if (typeof raw === 'boolean') return { valid: false, value: 0 };
      if (typeof raw === 'number') {
        if (!Number.isInteger(raw) || raw < 0) return { valid: false, value: 0 };
        return { valid: true, value: raw };
      }
      let str = String(raw).trim();
      if (str.includes(',') && !str.includes('.')) {
        str = str.replace(',', '.');
      }
      const num = Number(str);
      if (!Number.isFinite(num) || !Number.isInteger(num) || num < 0) {
        return { valid: false, value: 0 };
      }
      return { valid: true, value: num };
    };

    const normalizeCategory = (raw: unknown): string => {
      const trimmed = String(raw ?? '').trim();
      const k = normalizeKey(trimmed);
      if (!k) return 'cervejas';
      if (k === 'cervejas' || k === 'cerveja') return 'cervejas';
      if (k === 'destilados' || k === 'destilado') return 'destilados';
      if (k === 'vinhos' || k === 'vinho') return 'vinhos';
      if (
        k === 'nao_alcoolicos' ||
        k === 'nao alcoolicos' ||
        k === 'nao alcoolico' ||
        k === 'sem alcool'
      ) {
        return 'nao_alcoolicos';
      }
      if (k === 'gelo_carvao' || k === 'gelo e carvao' || k === 'gelo & carvao') {
        return 'gelo_carvao';
      }
      if (k === 'petiscos' || k === 'petisco') return 'petiscos';
      return trimmed;
    };

    const parseActiveFlag = (raw: unknown): boolean => {
      if (raw === undefined || raw === null || String(raw).trim() === '') return true;
      if (typeof raw === 'boolean') return raw;
      const k = normalizeKey(raw);
      if (['nao', 'false', '0', 'inativo', 'pausado', 'desativado', 'n'].includes(k)) {
        return false;
      }
      return true;
    };

    const [{ data: existingRows, error: fetchErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);
    if (fetchErr) {
      console.error('[Supabase Error] products import fetch existing:', fetchErr.message);
      return res.status(500).json({ error: fetchErr.message });
    }
    if (settingsErr) {
      console.error('[Supabase Error] store_settings fetch in products import:', settingsErr.message);
      return res.status(500).json({ error: settingsErr.message });
    }

    const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;

    const byName = new Map<string, any>();
    const bySku = new Map<string, any>();
    for (const r of existingRows || []) {
      const nKey = normalizeKey(r.name);
      if (nKey) byName.set(nKey, r);
      const sKey = normalizeKey(r.sku);
      if (sKey) bySku.set(sKey, r);
    }

    const toInsert: { dbRow: any; initialStock: number }[] = [];
    const toUpdate: { id: string; price: number; cost_price: number; stock: number; oldStock: number; updated_at: string }[] = [];
    let skipped = 0;
    const errors: { rowNumber: number; name?: string; reason: string }[] = [];

    for (let i = 0; i < rawRows.length; i++) {
      const item = rawRows[i] || {};
      const rowNumber = Number(item.rowNumber) || i + 2;
      const name = String(item.name ?? '').trim();

      if (!name) {
        errors.push({ rowNumber, name: '', reason: 'Sem nome do produto' });
        continue;
      }

      const price = parseMoneyBr(item.price);
      if (price === null || price <= 0) {
        errors.push({ rowNumber, name, reason: 'Preço de venda inválido ou <= 0' });
        continue;
      }

      let costPrice = 0;
      if (item.costPrice !== undefined && item.costPrice !== null && String(item.costPrice).trim() !== '') {
        const parsedCost = parseMoneyBr(item.costPrice);
        if (parsedCost === null || parsedCost < 0) {
          errors.push({ rowNumber, name, reason: 'Preço de custo inválido ou negativo' });
          continue;
        }
        costPrice = parsedCost;
      }

      const stockParsed = parseNonNegativeInt(item.stock, 0);
      if (!stockParsed.valid) {
        errors.push({ rowNumber, name, reason: 'Estoque negativo ou não inteiro' });
        continue;
      }

      const minStockParsed = parseNonNegativeInt(item.minStock, 10);
      if (!minStockParsed.valid) {
        errors.push({ rowNumber, name, reason: 'Estoque mínimo negativo ou não inteiro' });
        continue;
      }

      const sku = String(item.sku ?? '').trim();
      const volume = String(item.volume ?? '').trim();
      const category = normalizeCategory(item.category);
      const active = parseActiveFlag(item.active);

      const nameKey = normalizeKey(name);
      const skuKey = sku ? normalizeKey(sku) : '';

      const existing = (skuKey ? bySku.get(skuKey) : undefined) || byName.get(nameKey);

      if (existing) {
        // Requirement 5.d: Importação de planilha: não mexa em combos (se o nome ou SKU bater com um combo, pule mesmo no modo "atualizar")
        if (existing.id && isComboProduct(String(existing.id), dbSettings)) {
          skipped++;
          continue;
        }
        if (duplicateMode === 'skip') {
          skipped++;
        } else {
          if (existing.id && !String(existing.id).startsWith('__pending__')) {
            toUpdate.push({
              id: String(existing.id),
              price,
              cost_price: costPrice,
              stock: stockParsed.value,
              oldStock: Number(existing.stock || 0),
              updated_at: new Date().toISOString(),
            });
          }
        }
        continue;
      }

      const newId = `prod-imp-${Date.now()}-${i}-${crypto.randomBytes(3).toString('hex')}`;
      const newDbRow = {
        id: newId,
        name,
        category,
        volume: volume || null,
        price,
        promo_price: null,
        promo_ends_at: null,
        case_size: null,
        case_price: null,
        cost_price: costPrice,
        stock: 0,
        min_stock: minStockParsed.value,
        is_cold: true,
        image: null,
        sku: sku || null,
        active,
        description: '',
        updated_at: new Date().toISOString(),
      };

      toInsert.push({ dbRow: newDbRow, initialStock: stockParsed.value });
      byName.set(nameKey, newDbRow);
      if (skuKey) bySku.set(skuKey, newDbRow);
    }

    let created = 0;
    const BATCH_SIZE = 100;
    for (let start = 0; start < toInsert.length; start += BATCH_SIZE) {
      const chunk = toInsert.slice(start, start + BATCH_SIZE);
      const { error: insertErr } = await supabase.from('products').insert(chunk.map((c) => c.dbRow));
      if (insertErr) {
        console.error('[Supabase Error] products batch import insert:', insertErr.message);
        return res.status(500).json({ error: `Erro ao gravar produtos importados: ${insertErr.message}` });
      }
      for (const item of chunk) {
        if (item.initialStock > 0) {
          const { error: adjErr } = await supabase.rpc('adjust_stock', {
            p_product_id: item.dbRow.id,
            p_mode: 'set',
            p_value: item.initialStock,
            p_reason: 'importacao',
            p_note: 'Importação de planilha',
          });
          if (adjErr) {
            console.error('[RPC Error] adjust_stock on import insert:', adjErr.message);
            return res.status(500).json({ error: `Erro ao registrar estoque importado: ${adjErr.message}` });
          }
        }
      }
      created += chunk.length;
    }

    let updated = 0;
    for (const upd of toUpdate) {
      const { error: updErr } = await supabase
        .from('products')
        .update({
          price: upd.price,
          cost_price: upd.cost_price,
          updated_at: upd.updated_at,
        })
        .eq('id', upd.id);
      if (updErr) {
        console.error('[Supabase Error] products import update:', updErr.message);
        return res.status(500).json({ error: `Erro ao atualizar produto existente: ${updErr.message}` });
      }
      if (upd.stock !== upd.oldStock) {
        const { error: adjErr } = await supabase.rpc('adjust_stock', {
          p_product_id: upd.id,
          p_mode: 'set',
          p_value: upd.stock,
          p_reason: 'importacao',
          p_note: 'Importação de planilha',
        });
        if (adjErr) {
          console.error('[RPC Error] adjust_stock on import update:', adjErr.message);
          return res.status(500).json({ error: `Erro ao atualizar estoque do produto: ${adjErr.message}` });
        }
      }
      updated++;
    }

    invalidateProductImageMetaCache();

    return res.json({
      created,
      updated,
      skipped,
      errors,
    });
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

    const geoValidation = await resolveAndValidateCustomerAddress(supabase, {
      address: cust.address,
      number: cust.number,
      neighborhood: cust.neighborhood,
      city: cust.city,
      state: cust.state,
      cep: cust.cep,
      pinLatitude: parsedLat,
      pinLongitude: parsedLng,
    });

    if (geoValidation.error) {
      return res.status(400).json({ error: geoValidation.error });
    }

    const newCust: CustomerProfile = {
      ...cust,
      id: cust.id || `cust-${Date.now()}`,
      latitude: geoValidation.latitude,
      longitude: geoValidation.longitude,
      geoLatitude: geoValidation.geoLatitude,
      geoLongitude: geoValidation.geoLongitude,
      geoPrecision: geoValidation.geoPrecision,
      pinOffsetM: geoValidation.pinOffsetM,
      locationVerified: geoValidation.locationVerified,
      distanceKm: geoValidation.distanceKm,
      isWithinDeliveryRadius: geoValidation.isWithinDeliveryRadius,
      createdAt: new Date().toISOString(),
      totalOrdersCount: 0,
      totalSpent: 0,
    };

    const { data: insertedRow, error } = await supabase
      .from('customers')
      .insert(customerToDB(newCust))
      .select('*')
      .single();
    if (error) {
      console.error('[Supabase Error] customers insert:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json(insertedRow ? customerFromDB(insertedRow) : newCust);
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
    const body = req.body || {};

    const nextAddress = body.address !== undefined ? String(body.address).trim() : existingMapped.address;
    const nextNumber = body.number !== undefined ? String(body.number).trim() : existingMapped.number;
    const nextNeighborhood = body.neighborhood !== undefined ? String(body.neighborhood).trim() : existingMapped.neighborhood;
    const nextCep = body.cep !== undefined ? String(body.cep).trim() : (existingMapped.cep || '');
    const nextCity = body.city !== undefined ? String(body.city).trim() : (existingMapped.city || '');
    const nextState = body.state !== undefined ? String(body.state).trim() : (existingMapped.state || '');

    const hasIncomingPin =
      body.latitude !== undefined &&
      body.latitude !== null &&
      !Number.isNaN(Number(body.latitude)) &&
      body.longitude !== undefined &&
      body.longitude !== null &&
      !Number.isNaN(Number(body.longitude));

    const addressTextChanged =
      nextAddress !== existingMapped.address ||
      nextNumber !== existingMapped.number ||
      nextNeighborhood !== existingMapped.neighborhood ||
      nextCep.replace(/\D/g, '') !== String(existingMapped.cep || '').replace(/\D/g, '') ||
      nextCity !== (existingMapped.city || '') ||
      nextState !== (existingMapped.state || '');

    const pinLat = hasIncomingPin
      ? Number(body.latitude)
      : !addressTextChanged && existingMapped.latitude !== undefined
      ? existingMapped.latitude
      : undefined;
    const pinLng = hasIncomingPin
      ? Number(body.longitude)
      : !addressTextChanged && existingMapped.longitude !== undefined
      ? existingMapped.longitude
      : undefined;

    const geoValidation = await resolveAndValidateCustomerAddress(supabase, {
      address: nextAddress,
      number: nextNumber,
      neighborhood: nextNeighborhood,
      city: nextCity,
      state: nextState,
      cep: nextCep,
      pinLatitude: pinLat,
      pinLongitude: pinLng,
    });

    if (geoValidation.error) {
      return res.status(400).json({ error: geoValidation.error });
    }

    const updated: CustomerProfile = {
      ...existingMapped,
      ...body,
      id,
      address: nextAddress,
      number: nextNumber,
      neighborhood: nextNeighborhood,
      cep: nextCep || undefined,
      city: nextCity || undefined,
      state: nextState || undefined,
      latitude: geoValidation.latitude,
      longitude: geoValidation.longitude,
      geoLatitude: geoValidation.geoLatitude,
      geoLongitude: geoValidation.geoLongitude,
      geoPrecision: geoValidation.geoPrecision,
      pinOffsetM: geoValidation.pinOffsetM,
      locationVerified: geoValidation.locationVerified,
      distanceKm: geoValidation.distanceKm,
      isWithinDeliveryRadius: geoValidation.isWithinDeliveryRadius,
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
    const effectiveSource: 'balcao' | 'online' =
      isAdmin && rawOrder.source === 'balcao' ? 'balcao' : 'online';

    const rawClientRequestId =
      typeof rawOrder.clientRequestId === 'string' &&
      rawOrder.clientRequestId.trim().length > 0 &&
      rawOrder.clientRequestId.trim().length <= 64
        ? rawOrder.clientRequestId.trim()
        : undefined;

    if (rawClientRequestId) {
      const { data: existingIdempRow, error: existingIdempErr } = await supabase
        .from('orders')
        .select('*')
        .eq('client_request_id', rawClientRequestId)
        .maybeSingle();

      if (existingIdempErr) {
        return res.status(500).json({ error: existingIdempErr.message });
      }
      if (existingIdempRow) {
        if (isAdmin) {
          return res.status(200).json(orderFromDB(existingIdempRow));
        }
        if (isCustomer && existingIdempRow.customer_id === signed?.customerId) {
          return res.status(200).json(sanitizeCustomerOrder(orderFromDB(existingIdempRow)));
        }
        if (!isCustomer && !existingIdempRow.customer_id && existingIdempRow.guest_token) {
          const sanitized = sanitizeCustomerOrder(orderFromDB(existingIdempRow));
          const guestTok = String(existingIdempRow.guest_token);
          const trackingUrl = `/pedido/${existingIdempRow.id}?t=${guestTok}`;
          return res.status(200).json({
            ...sanitized,
            order: sanitized,
            trackingUrl,
            guestToken: guestTok,
          });
        }
      }
    }

    // Reject coupons for non-registered customers
    if (
      effectiveSource === 'online' &&
      rawOrder.couponCode &&
      typeof rawOrder.couponCode === 'string' &&
      rawOrder.couponCode.trim() !== '' &&
      !isCustomer
    ) {
      return res.status(400).json({
        error: 'Cupons de desconto são exclusivos para clientes cadastrados.',
      });
    }

    // 1. Fetch current products, delivery areas, settings directly from Supabase (without base64 images)
    const [prodRes, areasRes, settingsRes] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE),
      supabase.from('delivery_areas').select('*').eq('active', true),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);

    if (prodRes.error) return res.status(500).json({ error: prodRes.error.message });
    if (areasRes.error) return res.status(500).json({ error: areasRes.error.message });
    if (settingsRes.error) return res.status(500).json({ error: settingsRes.error.message });
    const dbProducts = mapProductsFromDB(prodRes.data);
    const dbAreas = (areasRes.data || []).map(deliveryAreaFromDB);
    const dbSettings = settingsRes.data?.data ? sanitizePublicSettings(settingsRes.data.data) : initialSettings;
    reconcileSettingsCategoriesAndOrders(dbSettings, dbProducts);

    const maxRadiusKm = Number(dbSettings.deliveryRadiusKm) || 5;
    let customerId: string | undefined = undefined;
    let customerData: any = null;
    let serverDistanceKm: number | undefined = undefined;
    let serverIsWithinRadius: boolean | undefined = undefined;
    let guestToken: string | undefined = undefined;
    let guestPhoneDigitsForRateLimit = '';
    const clientIpForRateLimit = getClientIp(req);

    if (effectiveSource === 'balcao') {
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
    } else if (isCustomer && signed?.customerId) {
      // Logged-in customer checkout
      customerId = signed.customerId;
      const { data: custRow, error: custErr } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .maybeSingle();

      if (custErr || !custRow) {
        return res.status(401).json({ error: 'Cliente não encontrado. Faça login novamente.' });
      }

      let dbCustomer = customerFromDB(custRow);
      const isDeliveryOrder = rawOrder.deliveryType !== 'retirada';
      const customAddr =
        isDeliveryOrder && rawOrder.deliveryAddress && typeof rawOrder.deliveryAddress === 'object'
          ? rawOrder.deliveryAddress
          : null;

      if (customAddr) {
        const cAddress = String(customAddr.address || '').trim();
        const cNumber = String(customAddr.number || '').trim();
        const cNeighborhood = String(customAddr.neighborhood || '').trim();
        const cCep = customAddr.cep ? String(customAddr.cep).trim() : undefined;
        const cCity = customAddr.city ? String(customAddr.city).trim() : undefined;
        const cState = customAddr.state ? String(customAddr.state).trim() : undefined;
        const cComplement = customAddr.complement ? String(customAddr.complement).trim() : undefined;
        const cReference = customAddr.reference ? String(customAddr.reference).trim() : undefined;

        if (!cAddress || !cNumber || !cNeighborhood) {
          return res.status(400).json({
            error: 'Preencha rua, número e bairro do endereço de entrega.',
          });
        }

        const parsedPinLat =
          customAddr.latitude !== undefined &&
          customAddr.latitude !== null &&
          !Number.isNaN(Number(customAddr.latitude))
            ? Number(customAddr.latitude)
            : undefined;
        const parsedPinLng =
          customAddr.longitude !== undefined &&
          customAddr.longitude !== null &&
          !Number.isNaN(Number(customAddr.longitude))
            ? Number(customAddr.longitude)
            : undefined;

        const geoValidation = await resolveAndValidateCustomerAddress(supabase, {
          address: cAddress,
          number: cNumber,
          neighborhood: cNeighborhood,
          city: cCity,
          state: cState,
          cep: cCep,
          pinLatitude: parsedPinLat,
          pinLongitude: parsedPinLng,
        });

        if (geoValidation.error) {
          return res.status(400).json({ error: geoValidation.error });
        }

        serverDistanceKm = geoValidation.distanceKm;
        serverIsWithinRadius = geoValidation.isWithinDeliveryRadius;

        if (dbAreas.length > 0 && dbSettings.deliveryModel !== 'radius') {
          const matchedNh = dbAreas.find(
            (a) => a.active && a.name.toLowerCase().trim() === cNeighborhood.toLowerCase()
          );
          if (!matchedNh) {
            return res.status(400).json({
              error: `Desculpe! O bairro "${cNeighborhood}" não está na nossa área de entrega atendida.`,
            });
          }
        }

        const verifiedFlag = Boolean(geoValidation.locationVerified);
        customerData = {
          name: dbCustomer.name,
          phone: dbCustomer.phone,
          email: dbCustomer.email || undefined,
          address: cAddress,
          number: cNumber,
          neighborhood: cNeighborhood,
          complement: cComplement,
          reference: cReference,
          cep: cCep,
          city: cCity,
          state: cState,
          latitude: geoValidation.latitude,
          longitude: geoValidation.longitude,
          geoLatitude: geoValidation.geoLatitude,
          geoLongitude: geoValidation.geoLongitude,
          geoPrecision: geoValidation.geoPrecision,
          pinOffsetM: geoValidation.pinOffsetM,
          locationVerified: verifiedFlag,
          geo_latitude: geoValidation.geoLatitude ?? null,
          geo_longitude: geoValidation.geoLongitude ?? null,
          geo_precision: geoValidation.geoPrecision ?? null,
          pin_offset_m: geoValidation.pinOffsetM ?? null,
          location_verified: verifiedFlag,
          distanceKm: serverDistanceKm,
          isWithinDeliveryRadius: serverIsWithinRadius,
        };
      } else {
        if (isDeliveryOrder && (custRow.geo_latitude === null || custRow.geo_latitude === undefined)) {
          const legacyResult = await ensureLegacyCustomerGeocoded(supabase, custRow);
          dbCustomer = legacyResult.customer;
        }

        const orderRefLat = dbCustomer.geoLatitude ?? dbCustomer.latitude;
        const orderRefLng = dbCustomer.geoLongitude ?? dbCustomer.longitude;
        if (
          orderRefLat !== undefined &&
          orderRefLat !== null &&
          orderRefLng !== undefined &&
          orderRefLng !== null &&
          dbSettings.storeLatitude !== undefined &&
          dbSettings.storeLatitude !== null &&
          dbSettings.storeLongitude !== undefined &&
          dbSettings.storeLongitude !== null
        ) {
          serverDistanceKm = haversineKm(
            Number(dbSettings.storeLatitude),
            Number(dbSettings.storeLongitude),
            Number(orderRefLat),
            Number(orderRefLng)
          );
          serverIsWithinRadius = serverDistanceKm <= maxRadiusKm;
        }

        const verifiedFlag = isDeliveryOrder ? Boolean(dbCustomer.locationVerified) : true;

        customerData = {
          name: dbCustomer.name,
          phone: dbCustomer.phone,
          email: dbCustomer.email || undefined,
          address: isDeliveryOrder ? (dbCustomer.address || rawOrder.customer?.address || '') : 'Retirada no Depósito',
          number: isDeliveryOrder ? (dbCustomer.number || rawOrder.customer?.number || '') : 'S/N',
          neighborhood: isDeliveryOrder ? (dbCustomer.neighborhood || rawOrder.customer?.neighborhood || '') : 'Depósito',
          complement: dbCustomer.complement || rawOrder.customer?.complement || undefined,
          reference: dbCustomer.reference || rawOrder.customer?.reference || undefined,
          cep: dbCustomer.cep || rawOrder.customer?.cep || undefined,
          city: dbCustomer.city || rawOrder.customer?.city || undefined,
          state: dbCustomer.state || rawOrder.customer?.state || undefined,
          latitude: dbCustomer.latitude,
          longitude: dbCustomer.longitude,
          geoLatitude: dbCustomer.geoLatitude,
          geoLongitude: dbCustomer.geoLongitude,
          geoPrecision: dbCustomer.geoPrecision,
          pinOffsetM: dbCustomer.pinOffsetM,
          locationVerified: verifiedFlag,
          geo_latitude: dbCustomer.geoLatitude ?? null,
          geo_longitude: dbCustomer.geoLongitude ?? null,
          geo_precision: dbCustomer.geoPrecision ?? null,
          pin_offset_m: dbCustomer.pinOffsetM ?? null,
          location_verified: verifiedFlag,
          distanceKm: serverDistanceKm,
          isWithinDeliveryRadius: serverIsWithinRadius,
        };
      }
    } else if (rawOrder.guest && typeof rawOrder.guest === 'object') {
      // Guest quick checkout (without account)
      const guestObj = rawOrder.guest;
      const gName = String(guestObj.name || '').trim();
      const gPhoneRaw = String(guestObj.phone || '').trim();
      const gPhoneDigits = normalizeBrazilianPhoneDigits(gPhoneRaw);

      if (gName.length < 2 || gName.length > 80) {
        return res.status(400).json({ error: 'Informe seu nome (entre 2 e 80 caracteres).' });
      }

      if (gPhoneDigits.length < 10 || gPhoneDigits.length > 11) {
        return res.status(400).json({
          error: 'Informe um WhatsApp válido com DDD (10 ou 11 dígitos).',
        });
      }

      if (isGuestOrderRateLimited(clientIpForRateLimit, gPhoneDigits)) {
        return res.status(429).json({
          error: 'Muitos pedidos seguidos, aguarde um pouco ou fale com a gente no WhatsApp',
        });
      }

      const oneHourAgoIso = new Date(Date.now() - GUEST_ORDER_RATE_WINDOW_MS).toISOString();
      const { data: recentGuestOrders, error: guestRateErr } = await supabase
        .from('orders')
        .select('id, customer', { count: 'exact' })
        .not('guest_token', 'is', null)
        .gte('created_at', oneHourAgoIso)
        .limit(200);

      if (guestRateErr) {
        console.error('[Supabase Error] guest rate limit check:', guestRateErr.message);
        return res.status(500).json({ error: guestRateErr.message });
      }

      const matchingPhoneCount = (recentGuestOrders || []).filter(
        (row: any) => normalizeBrazilianPhoneDigits(row?.customer?.phone) === gPhoneDigits
      ).length;

      if (matchingPhoneCount >= GUEST_ORDER_MAX_PER_HOUR) {
        return res.status(429).json({
          error: 'Muitos pedidos seguidos, aguarde um pouco ou fale com a gente no WhatsApp',
        });
      }

      guestPhoneDigitsForRateLimit = gPhoneDigits;
      guestToken = crypto.randomBytes(16).toString('hex');
      const isDeliveryOrder = rawOrder.deliveryType !== 'retirada';

      if (isDeliveryOrder) {
        const gAddress = String(guestObj.address || '').trim();
        const gNumber = String(guestObj.number || '').trim();
        const gNeighborhood = String(guestObj.neighborhood || '').trim();
        const gCep = guestObj.cep ? String(guestObj.cep).trim() : undefined;
        const gCity = guestObj.city ? String(guestObj.city).trim() : undefined;
        const gState = guestObj.state ? String(guestObj.state).trim() : undefined;
        const gComplement = guestObj.complement ? String(guestObj.complement).trim() : undefined;
        const gReference = guestObj.reference ? String(guestObj.reference).trim() : undefined;

        if (!gAddress || !gNumber || !gNeighborhood) {
          return res.status(400).json({
            error: 'Preencha rua, número e bairro do endereço de entrega.',
          });
        }

        const parsedPinLat =
          guestObj.latitude !== undefined &&
          guestObj.latitude !== null &&
          !Number.isNaN(Number(guestObj.latitude))
            ? Number(guestObj.latitude)
            : undefined;
        const parsedPinLng =
          guestObj.longitude !== undefined &&
          guestObj.longitude !== null &&
          !Number.isNaN(Number(guestObj.longitude))
            ? Number(guestObj.longitude)
            : undefined;

        const geoValidation = await resolveAndValidateCustomerAddress(supabase, {
          address: gAddress,
          number: gNumber,
          neighborhood: gNeighborhood,
          city: gCity,
          state: gState,
          cep: gCep,
          pinLatitude: parsedPinLat,
          pinLongitude: parsedPinLng,
        });

        if (geoValidation.error) {
          return res.status(400).json({ error: geoValidation.error });
        }

        serverDistanceKm = geoValidation.distanceKm;
        serverIsWithinRadius = geoValidation.isWithinDeliveryRadius;

        if (dbAreas.length > 0 && dbSettings.deliveryModel !== 'radius') {
          const matchedNh = dbAreas.find(
            (a) => a.active && a.name.toLowerCase().trim() === gNeighborhood.toLowerCase()
          );
          if (!matchedNh) {
            return res.status(400).json({
              error: `Desculpe! O bairro "${gNeighborhood}" não está na nossa área de entrega atendida.`,
            });
          }
        }

        const verifiedFlag = Boolean(geoValidation.locationVerified);
        customerData = {
          name: gName,
          phone: gPhoneRaw,
          address: gAddress,
          number: gNumber,
          neighborhood: gNeighborhood,
          complement: gComplement,
          reference: gReference,
          cep: gCep,
          city: gCity,
          state: gState,
          latitude: geoValidation.latitude,
          longitude: geoValidation.longitude,
          geoLatitude: geoValidation.geoLatitude,
          geoLongitude: geoValidation.geoLongitude,
          geoPrecision: geoValidation.geoPrecision,
          pinOffsetM: geoValidation.pinOffsetM,
          locationVerified: verifiedFlag,
          geo_latitude: geoValidation.geoLatitude ?? null,
          geo_longitude: geoValidation.geoLongitude ?? null,
          geo_precision: geoValidation.geoPrecision ?? null,
          pin_offset_m: geoValidation.pinOffsetM ?? null,
          location_verified: verifiedFlag,
          distanceKm: serverDistanceKm,
          isWithinDeliveryRadius: serverIsWithinRadius,
        };
      } else {
        customerData = {
          name: gName,
          phone: gPhoneRaw,
          address: 'Retirada no Depósito',
          number: 'S/N',
          neighborhood: 'Depósito',
          locationVerified: true,
          location_verified: true,
        };
      }
    } else {
      return res.status(401).json({
        error: 'Faça login, crie sua conta ou escolha Pedido rápido sem cadastro para finalizar.',
      });
    }

    // 2. Validate items and recalculate subtotal
    let recalculatedSubtotal = 0;
    const validatedItems: OrderItem[] = [];
    const unitsByProductId = new Map<string, number>();
    const comboNamesByProductId = new Map<string, Set<string>>();
    const comboCheckList: Array<{ comboProduct: Product; comboDef: ComboComponentItem[] }> = [];
    const nonComboCheckList: Product[] = [];
    const orderCaseChannel: 'store' | 'local' = effectiveSource === 'balcao' ? 'local' : 'store';

    for (const item of rawOrder.items) {
      const serverProduct = dbProducts.find((p) => p.id === item.productId);
      if (!serverProduct || !serverProduct.active) {
        return res.status(400).json({
          error: `O produto "${item.name || item.productId}" não está disponível no momento.`,
        });
      }
      if (
        effectiveSource !== 'balcao' &&
        Array.isArray(dbSettings.hiddenFromStoreIds) &&
        dbSettings.hiddenFromStoreIds.includes(serverProduct.id)
      ) {
        return res.status(400).json({
          error: 'Produto indisponível no delivery',
        });
      }

      const requestedQty = parseValidItemQuantity(item.quantity);
      if (requestedQty === null) {
        return res.status(400).json({ error: 'Quantidade inválida.' });
      }
      const saleUnit = item.saleUnit === 'case' ? 'case' : 'unit';
      const isCombo = isComboProduct(serverProduct.id, dbSettings);

      let unitsPerSale = 1;
      let effectivePrice = getEffectivePrice(serverProduct);
      let originalPrice = serverProduct.price;

      if (saleUnit === 'case') {
        if (isCombo || !canSellProductCase(serverProduct, dbSettings, orderCaseChannel)) {
          return res.status(400).json({
            error: 'Venda por caixa não disponível',
          });
        }

        unitsPerSale = Number(serverProduct.caseSize);
        effectivePrice = Number(serverProduct.casePrice);
        originalPrice = Number(serverProduct.casePrice);
      }

      const addonsValidation = validateAndCalculateItemAddons(
        serverProduct,
        item.addons,
        dbSettings
      );
      if (addonsValidation.error) {
        return res.status(400).json({ error: addonsValidation.error });
      }

      let itemCostPrice = (Number(serverProduct.costPrice) || 0) * unitsPerSale;
      let itemComboComponents: OrderItemComboComponent[] | undefined = undefined;

      if (isCombo) {
        const comboDef = dbSettings.combos?.[serverProduct.id] || [];
        if (comboDef.length === 0) {
          return res.status(400).json({
            error: `O combo "${serverProduct.name}" não possui itens configurados.`,
          });
        }

        let comboCostSum = 0;
        const resolvedComboItems: OrderItemComboComponent[] = [];

        for (const ci of comboDef) {
          const comp = dbProducts.find((p) => p.id === ci.productId);
          const compQty = Math.max(1, Math.floor(Number(ci.quantity) || 1));

          if (!comp || !comp.active) {
            return res.status(409).json({
              error: `Estoque insuficiente para o combo ${serverProduct.name}: falta ${comp ? comp.name : ci.productId}`,
            });
          }

          const neededForComp = requestedQty * compQty;
          unitsByProductId.set(comp.id, (unitsByProductId.get(comp.id) || 0) + neededForComp);
          if (!comboNamesByProductId.has(comp.id)) {
            comboNamesByProductId.set(comp.id, new Set<string>());
          }
          comboNamesByProductId.get(comp.id)!.add(serverProduct.name);

          comboCostSum += (Number(comp.costPrice) || 0) * compQty;
          resolvedComboItems.push({
            productId: comp.id,
            name: formatComboComponentProductName(comp),
            quantity: compQty,
          });
        }

        itemCostPrice = Math.round(comboCostSum * 100) / 100;
        itemComboComponents = resolvedComboItems;
        comboCheckList.push({ comboProduct: serverProduct, comboDef });
      } else {
        const unitsForThisLine = requestedQty * unitsPerSale;
        const totalUnitsForProduct = (unitsByProductId.get(serverProduct.id) || 0) + unitsForThisLine;
        unitsByProductId.set(serverProduct.id, totalUnitsForProduct);
        nonComboCheckList.push(serverProduct);
      }

      const finalUnitPrice = Math.round((effectivePrice + addonsValidation.addonsTotal) * 100) / 100;
      const finalOriginalPrice = Math.round((originalPrice + addonsValidation.addonsTotal) * 100) / 100;
      const itemTotal = Math.round(finalUnitPrice * requestedQty * 100) / 100;
      recalculatedSubtotal = Math.round((recalculatedSubtotal + itemTotal) * 100) / 100;

      const validatedOrderItem: OrderItem = {
        productId: serverProduct.id,
        name: serverProduct.name,
        volume: serverProduct.volume,
        price: finalUnitPrice,
        originalPrice: finalOriginalPrice,
        costPrice: itemCostPrice,
        quantity: requestedQty,
        saleUnit,
        unitsPerSale,
        isCold: serverProduct.isCold,
      };

      if (itemComboComponents && itemComboComponents.length > 0) {
        validatedOrderItem.comboItems = itemComboComponents;
      }

      if (addonsValidation.addons.length > 0) {
        validatedOrderItem.addons = addonsValidation.addons.map((a) => ({
          groupName: a.groupName,
          optionName: a.optionName,
          price: a.price,
          quantity: a.quantity,
        }));
        validatedOrderItem.addonsTotal = addonsValidation.addonsTotal;
      }

      validatedItems.push(validatedOrderItem);
    }

    // Check total accumulated stock for all combo components first (summing across all combos and loose items in the order)
    for (const { comboProduct, comboDef } of comboCheckList) {
      for (const ci of comboDef) {
        const comp = dbProducts.find((p) => p.id === ci.productId);
        const totalNeededForComp = unitsByProductId.get(ci.productId) || 0;
        if (!comp || !comp.active || comp.stock < totalNeededForComp) {
          return res.status(409).json({
            error: `Estoque insuficiente para o combo ${comboProduct.name}: falta ${comp ? comp.name : ci.productId}`,
          });
        }
      }
    }

    // Check total accumulated stock for regular (non-combo) items
    for (const serverProduct of nonComboCheckList) {
      const totalUnitsForProduct = unitsByProductId.get(serverProduct.id) || 0;
      if (serverProduct.stock < totalUnitsForProduct) {
        return res.status(409).json({
          error: `Estoque insuficiente para "${serverProduct.name}". Disponível em estoque: ${serverProduct.stock} un.`,
        });
      }
    }

    // Número do pedido sempre gerado pelo servidor antes da baixa de estoque para gravar refId no histórico
    const orderId = `PED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const orderSourceLabel = effectiveSource === 'balcao' ? 'Balcão' : 'Delivery';

    const stockPayload = Array.from(unitsByProductId.entries()).map(([id, qty]) => {
      const combosForProd = comboNamesByProductId.get(id);
      const comboNote =
        combosForProd && combosForProd.size > 0
          ? `Combo: ${Array.from(combosForProd).join(', ')}`
          : '';
      const note = comboNote ? `${orderSourceLabel} — ${comboNote}` : orderSourceLabel;
      return {
        id,
        qty,
        reason: 'venda',
        refType: 'pedido',
        refId: orderId,
        note,
      };
    });
    const rollbackStockPayload = stockPayload.map((it) => ({
      ...it,
      reason: 'estorno_erro',
      refType: 'pedido',
      refId: orderId,
    }));

    // 3. Recalculate Delivery Fee, Minimum Order & Enforce Delivery Radius on Server
    const minOrderVal = Number(dbSettings.minOrderValue) || 0;
    if (
      effectiveSource === 'online' &&
      minOrderVal > 0 &&
      Math.round(recalculatedSubtotal * 100) < Math.round(minOrderVal * 100)
    ) {
      const formattedMin = minOrderVal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      return res.status(400).json({
        error: `O pedido mínimo é de ${formattedMin}.`,
      });
    }

    const deliveryType = rawOrder.deliveryType === 'retirada' ? 'retirada' : 'delivery';
    let deliveryFee = 0;

    if (deliveryType === 'delivery') {
      if (effectiveSource !== 'balcao' && !customerData.address?.trim()) {
        return res.status(400).json({
          error: 'Preencha seu endereço de entrega antes de finalizar o pedido, ou escolha Retirar no Depósito.',
        });
      }
      if (effectiveSource !== 'balcao' && serverDistanceKm !== undefined && serverDistanceKm > maxRadiusKm) {
        return res.status(400).json({
          error: `Endereço fora do raio de entrega de ${maxRadiusKm} km. Escolha Retirar no Depósito.`,
        });
      }

      const customerNh = (customerData.neighborhood || '').toLowerCase().trim();
      const matchedArea = dbAreas.find((a) => a.active && a.name.toLowerCase().trim() === customerNh);

      if (effectiveSource !== 'balcao' && dbAreas.length > 0 && dbSettings.deliveryModel !== 'radius' && !matchedArea) {
        return res.status(400).json({
          error: `Desculpe! O bairro "${customerData.neighborhood || ''}" não está na nossa área de entrega atendida.`,
        });
      }

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

    if (rawOrder.couponCode && typeof rawOrder.couponCode === 'string' && rawOrder.couponCode.trim() !== '') {
      if (!isCustomer) {
        return res.status(400).json({ error: 'Cupons de desconto são exclusivos para clientes cadastrados.' });
      }
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

      const couponExpMs = getCouponExpirationMs(coupon.expiresAt);
      if (couponExpMs !== null && couponExpMs < Date.now()) {
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

    const calculatedTotal = Math.max(0, Math.round((recalculatedSubtotal - discount + deliveryFee) * 100) / 100);

    const paymentMethod: PaymentMethod = rawOrder.paymentMethod || 'pix';
    let validatedCashChangeFor: number | undefined = undefined;
    if (paymentMethod === 'dinheiro') {
      if (
        rawOrder.cashChangeFor !== undefined &&
        rawOrder.cashChangeFor !== null &&
        String(rawOrder.cashChangeFor).trim() !== ''
      ) {
        const parsedCash = Number(rawOrder.cashChangeFor);
        if (Number.isNaN(parsedCash) || Math.round(parsedCash * 100) < Math.round(calculatedTotal * 100)) {
          return res.status(400).json({ error: 'Valor recebido menor que o total da conta.' });
        }
        validatedCashChangeFor = Math.round(parsedCash * 100) / 100;
      }
    }

    // 5. Decrement Stock via RPC decrement_stock(p_items jsonb)
    const { error: decStockErr } = await supabase.rpc('decrement_stock', {
      p_items: stockPayload,
    });

    if (decStockErr) {
      console.error('[RPC Error] decrement_stock:', decStockErr.message);
      let prodName = 'um dos produtos selecionados';
      const match = decStockErr.message?.match(/ESTOQUE_INSUFICIENTE:([^\s,]+)/);
      if (match && match[1]) {
        const offendingId = match[1];
        const offending = dbProducts.find((p) => p.id === offendingId);
        if (offending) prodName = offending.name;

        const matchingCombo = comboCheckList.find((c) =>
          c.comboDef.some((ci) => ci.productId === offendingId)
        );
        if (matchingCombo) {
          return res.status(409).json({
            error: `Estoque insuficiente para o combo ${matchingCombo.comboProduct.name}: falta ${prodName}`,
          });
        }
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
        await supabase.rpc('restore_stock', { p_items: rollbackStockPayload });
        return res.status(400).json({ error: 'Não foi possível resgatar o cupom: ' + redeemErr.message });
      }
    }

    // 7. Persist Order in database
    const newOrder: Order = {
      id: orderId,
      source: effectiveSource,
      status: 'pendente', // Force pending
      customer: customerData,
      customerId,
      guestToken,
      couponCode: validCouponCode,
      discount: Math.round(discount * 100) / 100,
      deliveryType,
      items: validatedItems,
      subtotal: Math.round(recalculatedSubtotal * 100) / 100,
      deliveryFee: Math.round(deliveryFee * 100) / 100,
      total: calculatedTotal,
      paymentMethod,
      cashChangeFor: validatedCashChangeFor,
      notes: rawOrder.notes || undefined,
      clientRequestId: rawClientRequestId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { error: orderErr } = await supabase.from('orders').insert(orderToDB(newOrder));
    if (orderErr) {
      console.error('[Supabase Error] orders insert:', orderErr.message);
      // Rollback stock decrement!
      await supabase.rpc('restore_stock', { p_items: rollbackStockPayload });

      if (orderErr.code === '23505' && rawClientRequestId) {
        const { data: dupRow, error: dupErr } = await supabase
          .from('orders')
          .select('*')
          .eq('client_request_id', rawClientRequestId)
          .maybeSingle();

        if (!dupErr && dupRow) {
          const dupOrder = orderFromDB(dupRow);
          if (isAdmin) return res.status(200).json(dupOrder);
          if (isCustomer && dupRow.customer_id === signed?.customerId) {
            return res.status(200).json(sanitizeCustomerOrder(dupOrder));
          }
          if (!isCustomer && !dupRow.customer_id && dupRow.guest_token) {
            const sanitizedDup = sanitizeCustomerOrder(dupOrder);
            const dupTok = String(dupRow.guest_token);
            const trackingUrl = `/pedido/${dupRow.id}?t=${dupTok}`;
            return res.status(200).json({
              ...sanitizedDup,
              order: sanitizedDup,
              trackingUrl,
              guestToken: dupTok,
            });
          }
        }
      }

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

    if (guestToken) {
      recordGuestOrderRateLimit(clientIpForRateLimit, guestPhoneDigitsForRateLimit);
      const sanitizedGuestOrder = sanitizeCustomerOrder(newOrder);
      const trackingUrl = `/pedido/${newOrder.id}?t=${guestToken}`;
      return res.status(201).json({
        ...sanitizedGuestOrder,
        order: sanitizedGuestOrder,
        trackingUrl,
        guestToken,
      });
    }

    return res.status(201).json(isAdmin ? newOrder : sanitizeCustomerOrder(newOrder));
  });

  // Guest order tracking without login: GET /api/orders/track/:id?t=<token>
  router.get('/orders/track/:id', async (req, res) => {
    const { id } = req.params;
    const rawToken = typeof req.query.t === 'string' ? req.query.t.trim() : '';

    if (!id || !rawToken || !/^[a-f0-9]{32}$/i.test(rawToken)) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: orderRow, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (orderErr) {
      console.error('[Supabase Error] track guest order:', orderErr.message);
      return res.status(500).json({ error: orderErr.message });
    }

    if (!orderRow || typeof orderRow.guest_token !== 'string' || orderRow.guest_token.length !== 32) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const storedBuf = Buffer.from(orderRow.guest_token.toLowerCase(), 'utf8');
    const queryBuf = Buffer.from(rawToken.toLowerCase(), 'utf8');
    if (storedBuf.length !== queryBuf.length || !crypto.timingSafeEqual(storedBuf, queryBuf)) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const { data: settingsRow, error: settingsErr } = await supabase
      .from('store_settings')
      .select('data')
      .eq('id', 'default')
      .maybeSingle();

    if (settingsErr) {
      console.error('[Supabase Error] track order settings:', settingsErr.message);
      return res.status(500).json({ error: settingsErr.message });
    }

    const cleanSettings = settingsRow?.data
      ? sanitizePublicSettings(settingsRow.data)
      : sanitizePublicSettings(initialSettings);

    const parsedOrder = sanitizeCustomerOrder(orderFromDB(orderRow));
    const safeCustomer = {
      name: parsedOrder.customer?.name || '',
      phone: parsedOrder.customer?.phone || '',
      address: parsedOrder.customer?.address || '',
      number: parsedOrder.customer?.number || '',
      neighborhood: parsedOrder.customer?.neighborhood || '',
      complement: parsedOrder.customer?.complement || undefined,
      reference: parsedOrder.customer?.reference || undefined,
      cep: parsedOrder.customer?.cep || undefined,
      city: parsedOrder.customer?.city || undefined,
      state: parsedOrder.customer?.state || undefined,
    };

    const safeOrder: Order = {
      id: parsedOrder.id,
      createdAt: parsedOrder.createdAt,
      updatedAt: parsedOrder.updatedAt,
      source: parsedOrder.source,
      status: parsedOrder.status,
      deliveryType: parsedOrder.deliveryType,
      items: parsedOrder.items,
      subtotal: parsedOrder.subtotal,
      discount: parsedOrder.discount,
      deliveryFee: parsedOrder.deliveryFee,
      total: parsedOrder.total,
      paymentMethod: parsedOrder.paymentMethod,
      cashChangeFor: parsedOrder.cashChangeFor,
      notes: parsedOrder.notes,
      customerId: parsedOrder.customerId,
      customer: safeCustomer,
      trackingUrl: `/pedido/${parsedOrder.id}?t=${rawToken}`,
    };

    return res.json({
      order: safeOrder,
      store: {
        storeName: cleanSettings.storeName,
        phone: cleanSettings.phone,
        whatsapp: cleanSettings.whatsapp,
        address: cleanSettings.address,
        openingHours: cleanSettings.openingHours,
        estimatedDeliveryTime: cleanSettings.estimatedDeliveryTime,
        pixKey: cleanSettings.pixKey,
        pixReceiver: cleanSettings.pixReceiver,
      },
    });
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
  // Para combos, use comboItems gravado no item do pedido.
  router.patch('/orders/:id/status', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { status: newStatus, notes: incomingNotes } = req.body || {};
    const VALID_STATUSES: OrderStatus[] = ['pendente', 'em_separacao', 'em_rota', 'concluido', 'cancelado'];
    if (!newStatus || !VALID_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: 'Status de pedido inválido.' });
    }

    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    // Fetch existing order
    const { data: existingRow, error: fetchOrderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchOrderErr) {
      return res.status(500).json({ error: fetchOrderErr.message });
    }
    if (!existingRow) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    const existingOrder = orderFromDB(existingRow);
    const oldStatus = existingOrder.status;

    let updatedNotes: string | null = existingRow.notes || null;
    if (incomingNotes !== undefined && incomingNotes !== null && String(incomingNotes).trim() !== '') {
      updatedNotes = String(incomingNotes).trim();
    }

    if (oldStatus === newStatus) {
      if (updatedNotes !== (existingRow.notes || null)) {
        const { data: sameStatusRow, error: sameStatusErr } = await supabase
          .from('orders')
          .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('*')
          .maybeSingle();
        if (sameStatusErr || !sameStatusRow) {
          return res.status(500).json({ error: sameStatusErr?.message || 'Erro ao atualizar pedido.' });
        }
        return res.json(orderFromDB(sameStatusRow));
      }
      return res.json(existingOrder);
    }

    // 1. Atomic conditional status update FIRST to prevent race conditions
    const { data: updatedRow, error: updateErr } = await supabase
      .from('orders')
      .update({
        status: newStatus,
        notes: updatedNotes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', oldStatus)
      .select('*')
      .maybeSingle();

    if (updateErr) {
      console.error('[Supabase Error] order status update:', updateErr.message);
      return res.status(500).json({ error: updateErr.message });
    }
    if (!updatedRow) {
      return res.status(409).json({ error: 'Este pedido já foi alterado por outra pessoa. Atualize a tela.' });
    }

    // 2. Adjust stock ONLY after conditional status transition succeeded (using saved comboItems for combos)
    if (oldStatus !== 'cancelado' && newStatus === 'cancelado') {
      const stockItems = extractOrderStockItems(existingOrder, {
        reason: 'cancelamento',
        refType: 'pedido',
        refId: id,
      });
      if (stockItems.length > 0) {
        const { error: restErr } = await supabase.rpc('restore_stock', { p_items: stockItems });
        if (restErr) {
          console.error('[RPC Error] restore_stock on cancel:', restErr.message);
          await supabase
            .from('orders')
            .update({
              status: oldStatus,
              notes: existingRow.notes || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
          return res.status(500).json({ error: 'Erro ao devolver estoque: ' + restErr.message });
        }
      }
    } else if (oldStatus === 'cancelado' && newStatus !== 'cancelado') {
      const stockItems = extractOrderStockItems(existingOrder, {
        reason: 'reativacao',
        refType: 'pedido',
        refId: id,
      });
      if (stockItems.length > 0) {
        const { error: decErr } = await supabase.rpc('decrement_stock', { p_items: stockItems });
        if (decErr) {
          console.error('[RPC Error] decrement_stock on uncancel:', decErr.message);
          await supabase
            .from('orders')
            .update({
              status: oldStatus,
              notes: existingRow.notes || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id);
          if (decErr.message?.includes('ESTOQUE_INSUFICIENTE')) {
            return res.status(409).json({ error: 'Não é possível reativar o pedido: estoque insuficiente de um ou mais itens.' });
          }
          return res.status(500).json({ error: decErr.message });
        }
      }
    }

    res.json(orderFromDB(updatedRow));
  });

  router.delete('/orders/:id', requireAdmin, async (req, res) => {
    const { id } = req.params;
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existingRow, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) {
      console.error('[Supabase Error] orders fetch before delete:', fetchErr.message);
      return res.status(500).json({ error: fetchErr.message });
    }

    if (existingRow) {
      const existingOrder = orderFromDB(existingRow);
      if (existingOrder.status !== 'cancelado') {
        const stockItems = extractOrderStockItems(existingOrder, {
          reason: 'cancelamento',
          refType: 'pedido',
          refId: id,
        });
        if (stockItems.length > 0) {
          const { error: restErr } = await supabase.rpc('restore_stock', { p_items: stockItems });
          if (restErr) {
            console.error('[RPC Error] restore_stock on delete order:', restErr.message);
            return res.status(500).json({ error: 'Erro ao devolver estoque antes de excluir o pedido: ' + restErr.message });
          }
        }
      }
    }

    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) {
      console.error('[Supabase Error] orders delete:', error.message);
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  });

  // ---------------------------------------------------------------------------
  // SETTINGS & CATEGORIES ROUTES
  // ---------------------------------------------------------------------------
  router.get('/settings', async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado.' });

    const { data, error } = await supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle();
    if (error) {
      console.error('[Supabase Error] store_settings get:', error.message);
      return res.status(500).json({ error: error.message });
    }
    const settings = data?.data ? sanitizePublicSettings(data.data) : sanitizePublicSettings(initialSettings);
    if (!settings.categories || settings.categories.length === 0) {
      const { data: prodRows, error: prodErr } = await supabase.from('products').select('category');
      if (prodErr) {
        console.error('[Supabase Error] products categories get:', prodErr.message);
        return res.status(500).json({ error: prodErr.message });
      }
      settings.categories = buildInitialCategoriesFromProducts((prodRows || []) as any);
    }
    res.json(settings);
  });

  router.put('/settings', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: existingData, error: fetchError } = await supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle();
    if (fetchError) {
      console.error('[Supabase Error] store_settings fetch before update:', fetchError.message);
      return res.status(500).json({ error: fetchError.message });
    }
    const current = existingData?.data || initialSettings;

    const { data: allProdRows, error: prodError } = await supabase
      .from('products')
      .select('id, category');
    if (prodError) {
      console.error('[Supabase Error] products check in settings update:', prodError.message);
      return res.status(500).json({ error: prodError.message });
    }

    const existingIds = new Set((allProdRows || []).map((r: any) => String(r.id)));

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'combos')) {
      const comboValidation = validateIncomingCombos(req.body.combos, existingIds);
      if (comboValidation.error) {
        return res.status(400).json({ error: comboValidation.error });
      }
    }

    const cleanSettings = sanitizePublicSettings({ ...current, ...req.body });

    if (!cleanSettings.categories || cleanSettings.categories.length === 0) {
      cleanSettings.categories = buildInitialCategoriesFromProducts((allProdRows || []) as any);
    }

    if (cleanSettings.featuredProductIds && cleanSettings.featuredProductIds.length > 0) {
      cleanSettings.featuredProductIds = cleanSettings.featuredProductIds.filter((id) => existingIds.has(id));
    }

    if (cleanSettings.hiddenFromStoreIds && cleanSettings.hiddenFromStoreIds.length > 0) {
      cleanSettings.hiddenFromStoreIds = cleanSettings.hiddenFromStoreIds.filter((id) => existingIds.has(id));
    }

    if (cleanSettings.productOrder && typeof cleanSettings.productOrder === 'object') {
      const filteredOrder: Record<string, string[]> = {};
      let totalCount = 0;
      for (const [catId, list] of Object.entries(cleanSettings.productOrder)) {
        if (!Array.isArray(list) || totalCount >= 2000) continue;
        const validList: string[] = [];
        for (const pid of list) {
          if (totalCount >= 2000) break;
          if (existingIds.has(pid)) {
            validList.push(pid);
            totalCount++;
          }
        }
        if (validList.length > 0) {
          filteredOrder[catId] = validList;
        }
      }
      cleanSettings.productOrder = filteredOrder;
    }

    if (cleanSettings.combos && typeof cleanSettings.combos === 'object') {
      const filteredCombos: Record<string, ComboComponentItem[]> = {};
      for (const [comboId, items] of Object.entries(cleanSettings.combos)) {
        if (!existingIds.has(comboId)) continue;
        const validItems = items.filter((it) => existingIds.has(it.productId));
        if (validItems.length > 0 && validItems.length === items.length) {
          filteredCombos[comboId] = validItems;
        }
      }
      cleanSettings.combos = filteredCombos;
    }

    if (cleanSettings.caseSaleChannels && typeof cleanSettings.caseSaleChannels === 'object') {
      const filteredChannels: Record<string, { store: boolean; local: boolean }> = {};
      for (const [pid, cfg] of Object.entries(cleanSettings.caseSaleChannels)) {
        if (existingIds.has(pid)) {
          filteredChannels[pid] = cfg;
        }
      }
      cleanSettings.caseSaleChannels = filteredChannels;
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

    res.json(cleanSettings);
  });

  router.post('/admin/categories/remove', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const rawId = req.body?.id;
    const rawMoveTo = req.body?.moveTo;
    const catId = String(rawId ?? '').trim();
    const moveToId = rawMoveTo ? String(rawMoveTo).trim() : '';

    if (!catId) {
      return res.status(400).json({ error: 'ID da categoria inválido.' });
    }

    const [{ data: settingsRow, error: settingsErr }, { data: allProds, error: prodsErr }] = await Promise.all([
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
      supabase.from('products').select('id, category'),
    ]);

    if (settingsErr) {
      console.error('[Supabase Error] store_settings fetch in categories/remove:', settingsErr.message);
      return res.status(500).json({ error: settingsErr.message });
    }
    if (prodsErr) {
      console.error('[Supabase Error] products fetch in categories/remove:', prodsErr.message);
      return res.status(500).json({ error: prodsErr.message });
    }

    const cleanSettings = sanitizePublicSettings(settingsRow?.data || initialSettings);
    if (!cleanSettings.categories || cleanSettings.categories.length === 0) {
      cleanSettings.categories = buildInitialCategoriesFromProducts((allProds || []) as any);
    }

    if (!cleanSettings.categories.some((c) => c.id === catId)) {
      return res.status(400).json({ error: 'Categoria não encontrada.' });
    }

    const productsInCategory = (allProds || []).filter((p: any) => String(p.category) === catId);
    const remainingCategories = cleanSettings.categories.filter((c) => c.id !== catId);

    if (remainingCategories.length === 0) {
      return res.status(400).json({ error: 'A loja precisa ter pelo menos uma categoria cadastrada.' });
    }

    if (productsInCategory.length > 0) {
      if (!moveToId || moveToId === catId) {
        return res.status(400).json({
          error: 'Escolha uma categoria de destino para mover os produtos desta categoria.',
        });
      }
      const targetExists = remainingCategories.some((c) => c.id === moveToId);
      if (!targetExists) {
        return res.status(400).json({ error: 'A categoria de destino informada não existe.' });
      }

      const { error: moveError } = await supabase
        .from('products')
        .update({
          category: moveToId,
          updated_at: new Date().toISOString(),
        })
        .eq('category', catId);

      if (moveError) {
        console.error('[Supabase Error] products update category in categories/remove:', moveError.message);
        return res.status(500).json({ error: moveError.message });
      }
    }

    // Remove category from settings.categories only after moving products succeeded
    cleanSettings.categories = remainingCategories;

    // Clean up productOrder for removed category (and merge into moveToId if applicable)
    if (cleanSettings.productOrder && cleanSettings.productOrder[catId]) {
      const oldOrderIds = cleanSettings.productOrder[catId] || [];
      if (moveToId && productsInCategory.length > 0) {
        const destOrder = cleanSettings.productOrder[moveToId] || [];
        const merged = Array.from(new Set([...destOrder, ...oldOrderIds]));
        cleanSettings.productOrder[moveToId] = merged;
      }
      delete cleanSettings.productOrder[catId];
    }

    const sanitizedFinal = sanitizePublicSettings(cleanSettings);

    const { error: saveSettingsErr } = await supabase.from('store_settings').upsert({
      id: 'default',
      data: sanitizedFinal,
      updated_at: new Date().toISOString(),
    });

    if (saveSettingsErr) {
      console.error('[Supabase Error] store_settings update in categories/remove:', saveSettingsErr.message);
      return res.status(500).json({ error: saveSettingsErr.message });
    }

    return res.json({
      settings: sanitizedFinal,
      movedCount: productsInCategory.length,
    });
  });

  // ---------------------------------------------------------------------------
  // MESAS & COMANDAS MODULE (Admin only)
  // ---------------------------------------------------------------------------

  // 1. List active tables with current open tab (if any) and joined tables
  router.get('/admin/tables', requireAdmin, async (_req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: tablesData, error: tablesErr } = await supabase
      .from('dining_tables')
      .select('*')
      .eq('active', true)
      .order('number', { ascending: true });

    if (tablesErr) {
      console.error('[Supabase Error] dining_tables list:', tablesErr.message);
      return res.status(500).json({ error: tablesErr.message });
    }

    const tables: DiningTable[] = (tablesData || []).map(diningTableFromDB);
    const tableLookup = new Map<string, DiningTable>(tables.map((t) => [t.id, t]));

    // Fetch open/closing tabs
    const { data: tabsData, error: tabsErr } = await supabase
      .from('table_tabs')
      .select('*')
      .in('status', ['open', 'closing']);

    if (tabsErr) {
      console.error('[Supabase Error] table_tabs list:', tabsErr.message);
      return res.status(500).json({ error: tabsErr.message });
    }

    const openTabs = (tabsData || []).map(tableTabFromDB);

    // Fetch table_tab_links
    const { data: linksData, error: linksErr } = await supabase
      .from('table_tab_links')
      .select('*');

    if (linksErr) {
      console.error('[Supabase Error] table_tab_links list:', linksErr.message);
      return res.status(500).json({ error: linksErr.message });
    }

    const links = linksData || [];

    const tabItemsMap = new Map<string, { itemsCount: number; subtotal: number }>();

    if (openTabs.length > 0) {
      const tabIds = openTabs.map((t) => t.id);
      const { data: itemsData, error: itemsErr } = await supabase
        .from('table_tab_items')
        .select('*')
        .in('tab_id', tabIds)
        .eq('status', 'active');

      if (itemsErr) {
        console.error('[Supabase Error] table_tab_items list:', itemsErr.message);
        return res.status(500).json({ error: itemsErr.message });
      }

      const items = (itemsData || []).map(tableTabItemFromDB);
      for (const item of items) {
        const current = tabItemsMap.get(item.tabId) || { itemsCount: 0, subtotal: 0 };
        const unitsPerSale = item.saleUnit === 'case' && item.unitsPerSale && item.unitsPerSale > 1 ? item.unitsPerSale : 1;
        current.itemsCount += item.quantity * unitsPerSale;
        current.subtotal += item.unitPrice * item.quantity;
        tabItemsMap.set(item.tabId, current);
      }
    }

    const result: TableWithTab[] = tables.map((tbl) => {
      // 1. If primary table of an open tab
      const tab = openTabs.find((t) => t.tableId === tbl.id);
      if (tab) {
        const itemStats = tabItemsMap.get(tab.id) || { itemsCount: 0, subtotal: 0 };
        const tabLinks = links.filter((l: any) => l.tab_id === tab.id);
        const linkedTables: LinkedTable[] = [];
        for (const l of tabLinks) {
          const linkedTbl = tableLookup.get(l.table_id);
          if (linkedTbl) {
            linkedTables.push({
              id: linkedTbl.id,
              number: linkedTbl.number,
              label: linkedTbl.label || null,
            });
          }
        }
        linkedTables.sort((a, b) => a.number - b.number);

        return {
          ...tbl,
          currentTab: {
            ...tab,
            itemsCount: itemStats.itemsCount,
            subtotal: Math.round(itemStats.subtotal * 100) / 100,
          },
          linkedTables: linkedTables.length > 0 ? linkedTables : undefined,
        };
      }

      // 2. If joined to another tab
      const link = links.find((l: any) => l.table_id === tbl.id);
      if (link) {
        const targetTab = openTabs.find((t) => t.id === link.tab_id);
        const primaryTable = targetTab ? tableLookup.get(targetTab.tableId) : null;
        return {
          ...tbl,
          currentTab: null,
          joinedToTabId: link.tab_id,
          joinedToTableNumber: primaryTable?.number,
        };
      }

      // 3. Free table
      return {
        ...tbl,
        currentTab: null,
      };
    });

    res.json(result);
  });

  // 2. Create dining table
  router.post('/admin/tables', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const num = parseInt(req.body.number, 10);
    if (!num || num <= 0) {
      return res.status(400).json({ error: 'Número da mesa deve ser um valor inteiro positivo.' });
    }

    const label = req.body.label ? String(req.body.label).trim() : null;
    const seats = req.body.seats !== undefined && req.body.seats !== null && Number(req.body.seats) > 0 ? Number(req.body.seats) : null;

    // Check if table with this number already exists
    const { data: existing, error: checkErr } = await supabase
      .from('dining_tables')
      .select('*')
      .eq('number', num)
      .maybeSingle();

    if (checkErr) {
      return res.status(500).json({ error: checkErr.message });
    }

    if (existing) {
      if (existing.active) {
        return res.status(400).json({ error: `Já existe uma mesa ativa com o número ${num}.` });
      }
      // Reactivate existing inactive table
      const { data: reactivated, error: updateErr } = await supabase
        .from('dining_tables')
        .update({
          label,
          seats,
          active: true,
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (updateErr) return res.status(500).json({ error: updateErr.message });
      return res.status(201).json(diningTableFromDB(reactivated));
    }

    const newId = crypto.randomUUID();
    const { data: created, error: insertErr } = await supabase
      .from('dining_tables')
      .insert({
        id: newId,
        number: num,
        label,
        seats,
        active: true,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[Supabase Error] dining_tables insert:', insertErr.message);
      return res.status(500).json({ error: insertErr.message });
    }

    res.status(201).json(diningTableFromDB(created));
  });

  // 3. Update dining table
  router.put('/admin/tables/:id', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const num = req.body.number !== undefined ? parseInt(req.body.number, 10) : undefined;
    if (num !== undefined && (!num || num <= 0)) {
      return res.status(400).json({ error: 'Número da mesa inválido.' });
    }

    if (num !== undefined) {
      const { data: conflict } = await supabase
        .from('dining_tables')
        .select('id')
        .eq('number', num)
        .neq('id', req.params.id)
        .maybeSingle();
      if (conflict) {
        return res.status(400).json({ error: `Já existe outra mesa com o número ${num}.` });
      }
    }

    const updates: any = {};
    if (num !== undefined) updates.number = num;
    if (req.body.label !== undefined) updates.label = req.body.label ? String(req.body.label).trim() : null;
    if (req.body.seats !== undefined) updates.seats = req.body.seats ? Number(req.body.seats) : null;
    if (req.body.active !== undefined) updates.active = Boolean(req.body.active);

    const { data: updated, error } = await supabase
      .from('dining_tables')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json(diningTableFromDB(updated));
  });

  // 4. Soft-delete dining table
  router.delete('/admin/tables/:id', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    // Check if table has open tab
    const { data: openTab, error: checkErr } = await supabase
      .from('table_tabs')
      .select('id')
      .eq('table_id', req.params.id)
      .in('status', ['open', 'closing'])
      .maybeSingle();

    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (openTab) {
      return res.status(400).json({ error: 'Não é possível remover ou desativar mesa com comanda aberta. Feche ou cancele a comanda primeiro.' });
    }

    // Check if table is in table_tab_links
    const { data: linkRow, error: linkErr } = await supabase
      .from('table_tab_links')
      .select('table_id')
      .eq('table_id', req.params.id)
      .maybeSingle();

    if (linkErr) return res.status(500).json({ error: linkErr.message });
    if (linkRow) {
      return res.status(400).json({ error: 'Não é possível desativar uma mesa que está juntada a uma comanda.' });
    }

    const { error: delErr } = await supabase
      .from('dining_tables')
      .update({ active: false })
      .eq('id', req.params.id);

    if (delErr) return res.status(500).json({ error: delErr.message });

    res.json({ success: true });
  });

  // 5. Open tab for table
  router.post('/admin/tables/:id/open', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: table, error: tblErr } = await supabase
      .from('dining_tables')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (tblErr) return res.status(500).json({ error: tblErr.message });
    if (!table || !table.active) {
      return res.status(404).json({ error: 'Mesa não encontrada ou inativa.' });
    }

    // Check if table is joined to another tab in table_tab_links
    const { data: linkRow, error: linkErr } = await supabase
      .from('table_tab_links')
      .select('tab_id')
      .eq('table_id', req.params.id)
      .maybeSingle();

    if (linkErr) return res.status(500).json({ error: linkErr.message });
    if (linkRow) {
      const { data: linkedTab } = await supabase
        .from('table_tabs')
        .select('table_id')
        .eq('id', linkRow.tab_id)
        .maybeSingle();

      let primaryNumber = '?';
      if (linkedTab?.table_id) {
        const { data: primaryTbl } = await supabase
          .from('dining_tables')
          .select('number')
          .eq('id', linkedTab.table_id)
          .maybeSingle();
        if (primaryTbl?.number) primaryNumber = String(primaryTbl.number);
      }
      return res.status(400).json({ error: `Esta mesa está juntada com a Mesa ${primaryNumber}.` });
    }

    const { data: existingTab, error: checkErr } = await supabase
      .from('table_tabs')
      .select('id')
      .eq('table_id', req.params.id)
      .in('status', ['open', 'closing'])
      .maybeSingle();

    if (checkErr) return res.status(500).json({ error: checkErr.message });
    if (existingTab) {
      return res.status(400).json({ error: 'Esta mesa já possui uma comanda aberta.' });
    }

    const tabId = crypto.randomUUID();
    const now = new Date().toISOString();
    const customerName = req.body.customer_name ? String(req.body.customer_name).trim() : null;
    const peopleCount = req.body.people_count ? Math.max(1, parseInt(req.body.people_count, 10) || 1) : 1;
    const notes = req.body.notes ? String(req.body.notes).trim() : null;

    const { data: createdTab, error: insertErr } = await supabase
      .from('table_tabs')
      .insert({
        id: tabId,
        table_id: req.params.id,
        status: 'open',
        customer_name: customerName,
        people_count: peopleCount,
        notes,
        opened_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (insertErr) {
      console.error('[Supabase Error] table_tabs open:', insertErr.message);
      return res.status(500).json({ error: insertErr.message });
    }

    res.status(201).json(tableTabFromDB(createdTab));
  });

  // 6. Get tab detail with items and linked tables
  router.get('/admin/tabs/:id', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { data: tabData, error: tabErr } = await supabase
      .from('table_tabs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (tabErr) return res.status(500).json({ error: tabErr.message });
    if (!tabData) return res.status(404).json({ error: 'Comanda não encontrada.' });

    const { data: tableData } = await supabase
      .from('dining_tables')
      .select('number, label')
      .eq('id', tabData.table_id)
      .maybeSingle();

    // Fetch linked tables
    const { data: linksData, error: linksErr } = await supabase
      .from('table_tab_links')
      .select('table_id')
      .eq('tab_id', req.params.id);

    if (linksErr) return res.status(500).json({ error: linksErr.message });

    let linkedTables: LinkedTable[] = [];
    if (linksData && linksData.length > 0) {
      const linkedIds = linksData.map((l: any) => l.table_id);
      const { data: linkedTablesData, error: linkedTablesErr } = await supabase
        .from('dining_tables')
        .select('id, number, label')
        .in('id', linkedIds);

      if (linkedTablesErr) return res.status(500).json({ error: linkedTablesErr.message });

      linkedTables = (linkedTablesData || [])
        .map((t: any) => ({
          id: String(t.id),
          number: Number(t.number),
          label: t.label || null,
        }))
        .sort((a, b) => a.number - b.number);
    }

    const { data: itemsData, error: itemsErr } = await supabase
      .from('table_tab_items')
      .select('*')
      .eq('tab_id', req.params.id)
      .order('added_at', { ascending: true });

    if (itemsErr) return res.status(500).json({ error: itemsErr.message });

    const items: TableTabItem[] = (itemsData || []).map(tableTabItemFromDB);
    const subtotal = items
      .filter((it) => it.status === 'active')
      .reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);

    const result: TabDetail = {
      ...tableTabFromDB(tabData),
      tableNumber: tableData?.number || 0,
      tableLabel: tableData?.label || null,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      linkedTables: linkedTables.length > 0 ? linkedTables : undefined,
    };

    res.json(result);
  });

  // 7. Update tab metadata (customerName, peopleCount, notes)
  router.patch('/admin/tabs/:id', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const updates: any = { updated_at: new Date().toISOString() };
    if (req.body.customer_name !== undefined) {
      updates.customer_name = req.body.customer_name ? String(req.body.customer_name).trim() : null;
    }
    if (req.body.people_count !== undefined) {
      updates.people_count = Math.max(1, parseInt(req.body.people_count, 10) || 1);
    }
    if (req.body.notes !== undefined) {
      updates.notes = req.body.notes ? String(req.body.notes).trim() : null;
    }

    const { data: updated, error } = await supabase
      .from('table_tabs')
      .update(updates)
      .eq('id', req.params.id)
      .in('status', ['open', 'closing'])
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    if (!updated) return res.status(404).json({ error: 'Comanda não encontrada ou não está aberta.' });

    res.json(tableTabFromDB(updated));
  });

  // 8. Add item to tab (decrement stock via RPC add_table_tab_item or add_table_tab_combo)
  router.post('/admin/tabs/:id/items', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { product_id, quantity, notes, sale_unit } = req.body || {};
    const qty = parseValidItemQuantity(quantity);
    if (qty === null) {
      return res.status(400).json({ error: 'Quantidade inválida.' });
    }

    const saleUnit = sale_unit === 'case' ? 'case' : 'unit';

    // Verify tab is open
    const { data: tab, error: tabErr } = await supabase
      .from('table_tabs')
      .select('id, status')
      .eq('id', req.params.id)
      .maybeSingle();

    if (tabErr) return res.status(500).json({ error: tabErr.message });
    if (!tab) return res.status(404).json({ error: 'Comanda não encontrada.' });
    if (tab.status !== 'open') {
      return res.status(409).json({ error: 'A comanda não está aberta para novos itens.' });
    }

    // Fetch product and store_settings to calculate effective price and check if product is a combo
    const [{ data: prodData, error: prodErr }, { data: settingsRow, error: settingsErr }] = await Promise.all([
      supabase.from('products').select(PRODUCT_COLUMNS_NO_IMAGE).eq('id', product_id).maybeSingle(),
      supabase.from('store_settings').select('data').eq('id', 'default').maybeSingle(),
    ]);

    if (prodErr) return res.status(500).json({ error: prodErr.message });
    if (settingsErr) return res.status(500).json({ error: settingsErr.message });
    if (!prodData || prodData.active === false) {
      return res.status(404).json({ error: 'Produto não encontrado ou inativo.' });
    }

    const dbSettings = settingsRow?.data ? sanitizePublicSettings(settingsRow.data) : initialSettings;
    const productName = `${prodData.name}${prodData.volume ? ` ${prodData.volume}` : ''}`;
    const itemNotes = notes ? String(notes).trim() : null;

    if (isComboProduct(String(prodData.id), dbSettings)) {
      const rawComboItems = dbSettings.combos?.[String(prodData.id)];
      if (!Array.isArray(rawComboItems) || rawComboItems.length === 0) {
        return res.status(400).json({ error: 'Combo com itens inválidos' });
      }

      const compIds: string[] = [];
      for (const ci of rawComboItems) {
        const cid = String(ci?.productId || '').trim();
        const cqty = Number(ci?.quantity);
        if (
          !cid ||
          cid === String(prodData.id) ||
          isComboProduct(cid, dbSettings) ||
          !Number.isInteger(cqty) ||
          cqty < 1 ||
          cqty > 99
        ) {
          return res.status(400).json({ error: 'Combo com itens inválidos' });
        }
        compIds.push(cid);
      }

      const { data: compRows, error: compErr } = await supabase
        .from('products')
        .select(PRODUCT_COLUMNS_NO_IMAGE)
        .in('id', Array.from(new Set(compIds)));

      if (compErr) return res.status(500).json({ error: compErr.message });

      const compById = new Map<string, any>((compRows || []).map((r: any) => [String(r.id), r]));
      const p_components: OrderItemComboComponent[] = [];

      for (const ci of rawComboItems) {
        const cid = String(ci.productId).trim();
        const compRow = compById.get(cid);
        if (!compRow || compRow.active === false) {
          return res.status(400).json({ error: 'Combo com itens inválidos' });
        }
        const compProd = productFromDB(compRow);
        p_components.push({
          productId: compProd.id,
          name: formatComboComponentProductName(compProd),
          quantity: Number(ci.quantity),
        });
      }

      const comboUnitPrice = getEffectivePrice(prodData);

      const { data: itemId, error: rpcErr } = await supabase.rpc('add_table_tab_combo', {
        p_tab_id: req.params.id,
        p_product_id: String(prodData.id),
        p_product_name: productName,
        p_unit_price: comboUnitPrice,
        p_qty: qty,
        p_notes: itemNotes,
        p_components,
      });

      if (rpcErr) {
        console.error('[Supabase RPC Error] add_table_tab_combo:', rpcErr.message);
        const msg = String(rpcErr.message || '');
        if (msg.includes('ESTOQUE_INSUFICIENTE')) {
          const match = msg.match(/ESTOQUE_INSUFICIENTE:([^\s,)]+)/);
          const missingId = match?.[1]?.trim() || '';
          const missingCompRow = missingId ? compById.get(missingId) : undefined;
          const missingProdName = missingCompRow?.name
            ? String(missingCompRow.name)
            : p_components.find((c) => c.productId === missingId)?.name || missingId || 'item do combo';
          return res.status(409).json({
            error: `Estoque insuficiente para o combo ${prodData.name}: falta ${missingProdName}`,
          });
        }
        if (msg.includes('COMBO_INVALIDO')) {
          return res.status(400).json({ error: 'Combo com itens inválidos' });
        }
        if (msg.includes('COMANDA_NAO_ABERTA')) {
          return res.status(409).json({ error: translateTabRpcError(msg) });
        }
        return res.status(400).json({ error: translateTabRpcError(msg) });
      }

      return res.status(201).json({ success: true, itemId });
    }

    let unitPrice = getEffectivePrice(prodData);
    let unitsPerSale = 1;

    if (saleUnit === 'case') {
      const mappedProduct = productFromDB(prodData);
      if (!canSellProductCase(mappedProduct, dbSettings, 'local')) {
        return res.status(400).json({ error: 'Venda por caixa não disponível' });
      }
      unitPrice = Number(mappedProduct.casePrice);
      unitsPerSale = Number(mappedProduct.caseSize);
    }

    // Call Supabase RPC add_table_tab_item
    const { data: itemId, error: rpcErr } = await supabase.rpc('add_table_tab_item', {
      p_tab_id: req.params.id,
      p_product_id: String(prodData.id),
      p_product_name: productName,
      p_unit_price: unitPrice,
      p_qty: qty,
      p_notes: itemNotes,
      p_sale_unit: saleUnit,
      p_units_per_sale: unitsPerSale,
    });

    if (rpcErr) {
      console.error('[Supabase RPC Error] add_table_tab_item:', rpcErr.message);
      if (String(rpcErr.message || '').includes('COMANDA_NAO_ABERTA')) {
        return res.status(409).json({ error: translateTabRpcError(rpcErr.message) });
      }
      return res.status(400).json({ error: translateTabRpcError(rpcErr.message) });
    }

    res.status(201).json({ success: true, itemId });
  });

  // 9. Cancel item on tab (restores stock via RPC cancel_table_tab_item)
  router.delete('/admin/tabs/:id/items/:itemId', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    // Verify tab is open
    const { data: tab, error: tabErr } = await supabase
      .from('table_tabs')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle();

    if (tabErr) return res.status(500).json({ error: tabErr.message });
    if (!tab) return res.status(404).json({ error: 'Comanda não encontrada.' });
    if (tab.status !== 'open') {
      return res.status(400).json({ error: 'A comanda não está aberta para cancelamento de itens.' });
    }

    // Verify item belongs to tab and is active
    const { data: item, error: itemErr } = await supabase
      .from('table_tab_items')
      .select('*')
      .eq('id', req.params.itemId)
      .eq('tab_id', req.params.id)
      .eq('status', 'active')
      .maybeSingle();

    if (itemErr) return res.status(500).json({ error: itemErr.message });
    if (!item) {
      return res.status(404).json({ error: 'Item não encontrado ou já cancelado.' });
    }

    const { error: rpcErr } = await supabase.rpc('cancel_table_tab_item', {
      p_item_id: req.params.itemId,
    });

    if (rpcErr) {
      console.error('[Supabase RPC Error] cancel_table_tab_item:', rpcErr.message);
      return res.status(400).json({ error: translateTabRpcError(rpcErr.message) });
    }

    res.json({ success: true });
  });

  // 10. Transfer item to another open tab (RPC transfer_table_tab_item)
  router.post('/admin/tabs/:id/items/:itemId/transfer', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { to_tab_id } = req.body || {};
    if (!to_tab_id) {
      return res.status(400).json({ error: 'Comanda de destino não informada.' });
    }

    const { error: rpcErr } = await supabase.rpc('transfer_table_tab_item', {
      p_item_id: req.params.itemId,
      p_from: req.params.id,
      p_to: to_tab_id,
    });

    if (rpcErr) {
      console.error('[Supabase RPC Error] transfer_table_tab_item:', rpcErr.message);
      return res.status(400).json({ error: translateTabRpcError(rpcErr.message) });
    }

    res.json({ success: true });
  });

  // 11. Join another table into tab (RPC join_table_to_tab)
  router.post('/admin/tabs/:id/join', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { table_id } = req.body || {};
    if (!table_id) {
      return res.status(400).json({ error: 'Mesa não informada.' });
    }

    // Read customer_name from both tabs BEFORE joining
    const [targetTabRes, sourceTabRes] = await Promise.all([
      supabase.from('table_tabs').select('customer_name').eq('id', req.params.id).maybeSingle(),
      supabase
        .from('table_tabs')
        .select('customer_name')
        .eq('table_id', table_id)
        .eq('status', 'open')
        .maybeSingle(),
    ]);

    if (targetTabRes.error) {
      return res.status(500).json({ error: targetTabRes.error.message });
    }
    if (sourceTabRes.error) {
      return res.status(500).json({ error: sourceTabRes.error.message });
    }

    const targetName = targetTabRes.data?.customer_name ? String(targetTabRes.data.customer_name).trim() : '';
    const sourceName = sourceTabRes.data?.customer_name ? String(sourceTabRes.data.customer_name).trim() : '';

    const { error: rpcErr } = await supabase.rpc('join_table_to_tab', {
      p_tab_id: req.params.id,
      p_table_id: table_id,
    });

    if (rpcErr) {
      console.error('[Supabase RPC Error] join_table_to_tab:', rpcErr.message);
      return res.status(400).json({ error: translateTabRpcError(rpcErr.message) });
    }

    const now = new Date().toISOString();
    const tabUpdatePayload: Record<string, any> = { updated_at: now };
    if (targetName && sourceName) {
      tabUpdatePayload.customer_name = `${targetName} + ${sourceName}`;
    }

    const { error: updErr } = await supabase
      .from('table_tabs')
      .update(tabUpdatePayload)
      .eq('id', req.params.id);

    if (updErr) {
      console.error('[Supabase Error] table_tabs update after join:', updErr.message);
      return res.status(500).json({ error: updErr.message });
    }

    res.json({ success: true });
  });

  // 12. Unjoin a table from tab (RPC unjoin_table_from_tab)
  router.post('/admin/tabs/:id/unjoin', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { table_id } = req.body || {};
    if (!table_id) {
      return res.status(400).json({ error: 'Mesa não informada.' });
    }

    const { error: rpcErr } = await supabase.rpc('unjoin_table_from_tab', {
      p_tab_id: req.params.id,
      p_table_id: table_id,
    });

    if (rpcErr) {
      console.error('[Supabase RPC Error] unjoin_table_from_tab:', rpcErr.message);
      return res.status(400).json({ error: translateTabRpcError(rpcErr.message) });
    }

    const now = new Date().toISOString();
    await supabase.from('table_tabs').update({ updated_at: now }).eq('id', req.params.id);

    res.json({ success: true });
  });

  // 13. Move tab to another free table
  router.post('/admin/tabs/:id/move', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { to_table_id } = req.body || {};
    if (!to_table_id) {
      return res.status(400).json({ error: 'Mesa de destino não informada.' });
    }

    // Verify source tab is open
    const { data: srcTab, error: srcTabErr } = await supabase
      .from('table_tabs')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (srcTabErr) return res.status(500).json({ error: srcTabErr.message });
    if (!srcTab) return res.status(404).json({ error: 'Comanda não encontrada.' });
    if (srcTab.status !== 'open') {
      return res.status(400).json({ error: 'A comanda não está aberta.' });
    }

    if (srcTab.table_id === to_table_id) {
      return res.status(400).json({ error: 'A comanda já está vinculada a esta mesa.' });
    }

    // Check target table exists and is active
    const { data: targetTable, error: targetTblErr } = await supabase
      .from('dining_tables')
      .select('*')
      .eq('id', to_table_id)
      .maybeSingle();

    if (targetTblErr) return res.status(500).json({ error: targetTblErr.message });
    if (!targetTable || !targetTable.active) {
      return res.status(400).json({ error: 'Mesa de destino não encontrada ou inativa.' });
    }

    // Check target table is NOT in table_tab_links
    const { data: targetLink, error: targetLinkErr } = await supabase
      .from('table_tab_links')
      .select('table_id')
      .eq('table_id', to_table_id)
      .maybeSingle();

    if (targetLinkErr) return res.status(500).json({ error: targetLinkErr.message });
    if (targetLink) {
      return res.status(400).json({ error: 'A mesa de destino está juntada a outra conta.' });
    }

    // Check target table does NOT have an open/closing tab
    const { data: occupied, error: occupiedErr } = await supabase
      .from('table_tabs')
      .select('id')
      .eq('table_id', to_table_id)
      .in('status', ['open', 'closing'])
      .maybeSingle();

    if (occupiedErr) return res.status(500).json({ error: occupiedErr.message });
    if (occupied) {
      return res.status(400).json({ error: 'A mesa de destino já possui uma comanda aberta.' });
    }

    const { error: moveErr } = await supabase
      .from('table_tabs')
      .update({
        table_id: to_table_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'open');

    if (moveErr) {
      return res.status(500).json({ error: moveErr.message });
    }

    res.json({ success: true });
  });

  // 14. Close tab: atomic closing lock, calculates service fee & discount, creates order with source='mesa', calls finish_table_tab_close RPC
  router.post('/admin/tabs/:id/close', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const now = new Date().toISOString();

    // Helper to safely rollback tab to open only if still closing
    const rollbackTab = async () => {
      await supabase
        .from('table_tabs')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('status', 'closing');
    };

    // 1. Atomic lock: open -> closing
    const { data: lockedTab, error: lockErr } = await supabase
      .from('table_tabs')
      .update({ status: 'closing', updated_at: now })
      .eq('id', req.params.id)
      .eq('status', 'open')
      .select()
      .maybeSingle();

    if (lockErr || !lockedTab) {
      return res.status(400).json({ error: 'A comanda não está aberta ou já está em processo de fechamento.' });
    }

    // 2. Fetch active items
    const { data: itemsData, error: itemsErr } = await supabase
      .from('table_tab_items')
      .select('*')
      .eq('tab_id', req.params.id)
      .eq('status', 'active');

    if (itemsErr) {
      await rollbackTab();
      return res.status(500).json({ error: itemsErr.message });
    }

    if (!itemsData || itemsData.length === 0) {
      await rollbackTab();
      return res.status(400).json({ error: 'Não é possível fechar uma conta sem itens.' });
    }

    const activeItems = itemsData.map(tableTabItemFromDB);

    // 3. Validate payment_method against accepted payment methods
    const VALID_PAYMENT_METHODS: PaymentMethod[] = ['pix', 'cartao_credito', 'cartao_debito', 'dinheiro'];
    const paymentMethod = req.body?.payment_method as PaymentMethod;
    if (!paymentMethod || !VALID_PAYMENT_METHODS.includes(paymentMethod)) {
      await rollbackTab();
      return res.status(400).json({ error: 'Forma de pagamento inválida.' });
    }

    // 4. Fetch table info and linked tables
    const { data: tableData, error: tableErr } = await supabase
      .from('dining_tables')
      .select('*')
      .eq('id', lockedTab.table_id)
      .maybeSingle();

    if (tableErr) {
      await rollbackTab();
      return res.status(500).json({ error: tableErr.message });
    }

    const { data: tabLinks, error: linksErr } = await supabase
      .from('table_tab_links')
      .select('table_id')
      .eq('tab_id', req.params.id);

    if (linksErr) {
      await rollbackTab();
      return res.status(500).json({ error: linksErr.message });
    }

    let linkedNumbers: number[] = [];
    if (tabLinks && tabLinks.length > 0) {
      const linkedIds = tabLinks.map((l: any) => l.table_id);
      const { data: linkedTablesData, error: linkedTablesErr } = await supabase
        .from('dining_tables')
        .select('number')
        .in('id', linkedIds);

      if (linkedTablesErr) {
        await rollbackTab();
        return res.status(500).json({ error: linkedTablesErr.message });
      }
      linkedNumbers = (linkedTablesData || []).map((t: any) => Number(t.number));
    }

    const allTableNumbers = [
      ...(tableData?.number ? [Number(tableData.number)] : []),
      ...linkedNumbers,
    ].sort((a, b) => a - b);

    const tableName = allTableNumbers.length > 0
      ? `Mesa ${allTableNumbers.join(' + ')}`
      : `Mesa ${tableData?.number || '?'}${tableData?.label ? ` (${tableData.label})` : ''}`;

    // 5. Fetch products for active items (and any inner combo component products)
    const productIdsSet = new Set<string>();
    for (const it of activeItems) {
      if (it.productId) productIdsSet.add(it.productId);
      if (Array.isArray(it.comboItems)) {
        for (const ci of it.comboItems) {
          if (ci?.productId) productIdsSet.add(String(ci.productId));
        }
      }
    }
    const productIds = Array.from(productIdsSet);
    const { data: prodRows, error: prodErr } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS_NO_IMAGE)
      .in('id', productIds);

    if (prodErr) {
      await rollbackTab();
      return res.status(500).json({ error: prodErr.message });
    }

    const prodMap = new Map((prodRows || []).map((p: any) => [String(p.id), p]));

    // 6. Round subtotal to cents BEFORE calculating service fee and total
    const rawSubtotal = activeItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);
    const subtotal = Math.round(rawSubtotal * 100) / 100;
    const feePct = Math.max(0, Math.min(20, Number(req.body.service_fee_percent) || 0));
    const serviceFee = Math.round(subtotal * (feePct / 100) * 100) / 100;

    const rawDiscountInput =
      req.body.discount !== undefined && req.body.discount !== null && String(req.body.discount).trim() !== ''
        ? Number(req.body.discount)
        : 0;

    if (
      Number.isNaN(rawDiscountInput) ||
      Math.round(rawDiscountInput * 100) < 0 ||
      Math.round(rawDiscountInput * 100) > Math.round((subtotal + serviceFee) * 100)
    ) {
      await rollbackTab();
      return res.status(400).json({ error: 'O desconto não pode ser maior que o valor da conta.' });
    }

    const discountVal = Math.round(rawDiscountInput * 100) / 100;
    const total = Math.max(0, Math.round((subtotal + serviceFee - discountVal) * 100) / 100);

    if (
      req.body.expected_subtotal !== undefined &&
      req.body.expected_subtotal !== null &&
      String(req.body.expected_subtotal).trim() !== ''
    ) {
      const expectedSub = Number(req.body.expected_subtotal);
      if (!Number.isNaN(expectedSub) && Math.round(expectedSub * 100) !== Math.round(subtotal * 100)) {
        await rollbackTab();
        return res.status(409).json({
          error: `A conta mudou: novo total R$ ${total.toFixed(2).replace('.', ',')}`,
          newSubtotal: subtotal,
          newTotal: total,
        });
      }
    }

    let cashChangeFor: number | undefined = undefined;
    if (paymentMethod === 'dinheiro') {
      if (
        req.body.cash_change_for !== undefined &&
        req.body.cash_change_for !== null &&
        String(req.body.cash_change_for).trim() !== ''
      ) {
        const parsedCash = Number(req.body.cash_change_for);
        if (Number.isNaN(parsedCash) || Math.round(parsedCash * 100) < Math.round(total * 100)) {
          await rollbackTab();
          return res.status(400).json({ error: 'Valor recebido menor que o total da conta.' });
        }
        cashChangeFor = Math.round(parsedCash * 100) / 100;
      }
    }

    // 7. Map order items (name = product name only without volume, volume goes in volume field, combos carry comboItems and summed inner costPrice)
    const orderItems: OrderItem[] = activeItems.map((it) => {
      const p = prodMap.get(it.productId);
      const hasComboItems = Array.isArray(it.comboItems) && it.comboItems.length > 0;
      const saleUnit = hasComboItems ? 'unit' : it.saleUnit === 'case' ? 'case' : 'unit';
      const unitsPerSale = hasComboItems ? 1 : it.unitsPerSale && it.unitsPerSale > 0 ? it.unitsPerSale : 1;

      let itemCostPrice = (p?.cost_price ? Number(p.cost_price) : 0) * unitsPerSale;
      if (hasComboItems && it.comboItems) {
        const comboCostSum = it.comboItems.reduce((sum, ci) => {
          const compProd = prodMap.get(String(ci.productId));
          const compCost = compProd?.cost_price ? Number(compProd.cost_price) : 0;
          const compQty = Math.max(1, Math.floor(Number(ci.quantity) || 1));
          return sum + compCost * compQty;
        }, 0);
        itemCostPrice = Math.round(comboCostSum * 100) / 100;
      }

      const orderItem: OrderItem = {
        productId: it.productId,
        name: p?.name || it.productName,
        volume: p?.volume || '',
        price: it.unitPrice,
        originalPrice: saleUnit === 'case' ? it.unitPrice : (p?.price ? Number(p.price) : it.unitPrice),
        costPrice: itemCostPrice,
        quantity: it.quantity,
        saleUnit,
        unitsPerSale,
        isCold: p?.is_cold ?? true,
      };

      if (hasComboItems && it.comboItems) {
        orderItem.comboItems = it.comboItems.map((ci) => ({
          productId: String(ci.productId),
          name: String(ci.name),
          quantity: Math.max(1, Math.floor(Number(ci.quantity) || 1)),
        }));
      }

      return orderItem;
    });

    const customerName = lockedTab.customer_name?.trim() ? `${lockedTab.customer_name} - ${tableName}` : tableName;

    let orderNotes = tableName;
    if (feePct > 0) {
      orderNotes += ` | Taxa de serviço (${feePct}%): R$ ${serviceFee.toFixed(2)}`;
    }
    if (lockedTab.notes?.trim()) {
      orderNotes += ` | Obs da mesa: ${lockedTab.notes.trim()}`;
    }
    if (req.body.notes && String(req.body.notes).trim()) {
      orderNotes += ` | ${String(req.body.notes).trim()}`;
    }

    const orderId = `PED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    const newOrder: Order = {
      id: orderId,
      source: 'mesa',
      status: 'concluido',
      customer: {
        name: customerName,
        phone: 'Presencial',
        address: `Consumo no Local - ${tableName}`,
        number: '',
        neighborhood: 'Salão',
      },
      deliveryType: 'local',
      items: orderItems,
      subtotal,
      deliveryFee: 0,
      discount: discountVal,
      total,
      paymentMethod,
      cashChangeFor,
      notes: orderNotes,
      createdAt: now,
      updatedAt: now,
    };

    // 8. Atomic close RPC finish_table_tab_close
    const { error: closeRpcErr } = await supabase.rpc('finish_table_tab_close', {
      p_tab_id: req.params.id,
      p_order: orderToDB(newOrder),
    });

    if (closeRpcErr) {
      console.error('[Supabase RPC Error] finish_table_tab_close:', closeRpcErr.message);
      await rollbackTab();
      return res.status(500).json({ error: translateTabRpcError(closeRpcErr.message) });
    }

    res.json({ success: true, order: newOrder });
  });

  // 14. Cancel tab: restores stock of all active items via RPC cancel_table_tab
  router.post('/admin/tabs/:id/cancel', requireAdmin, async (req, res) => {
    const supabase = getSupabase();
    if (!supabase) return res.status(500).json({ error: 'Supabase não configurado no servidor.' });

    const { error: rpcErr } = await supabase.rpc('cancel_table_tab', {
      p_tab_id: req.params.id,
    });

    if (rpcErr) {
      console.error('[Supabase RPC Error] cancel_table_tab:', rpcErr.message);
      return res.status(400).json({ error: translateTabRpcError(rpcErr.message) });
    }

    if (req.body?.reason) {
      const { data: currentTab } = await supabase
        .from('table_tabs')
        .select('notes')
        .eq('id', req.params.id)
        .maybeSingle();

      const noteAdd = `[Cancelada: ${String(req.body.reason).trim()}]`;
      const updatedNotes = currentTab?.notes ? `${currentTab.notes} ${noteAdd}` : noteAdd;

      await supabase
        .from('table_tabs')
        .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
        .eq('id', req.params.id);
    }

    res.json({ success: true });
  });

  // Mount the router under both /api and root (for Vercel path rewrites compatibility)
  app.use('/api', router);
  app.use('/', router);

  return app;
}
