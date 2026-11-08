// Utility for distance calculation, CEP lookup and Geocoding with Google Maps & fallback

/**
 * Calculates the great-circle distance between two points in kilometers (Haversine formula).
 */
export function calculateDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c;
  return Math.round(d * 100) / 100; // 2 decimal places
}

/**
 * Calculates the great-circle distance between two points in meters (rounded integer).
 */
export function calculateDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Checks whether the pin offset from the geocoded address exceeds the allowed threshold.
 * - 'exata': max 300m
 * - 'rua': max 800m
 * - 'aproximada': no hard limit
 */
export function checkPinOffsetLimit(
  geoLat: number | null | undefined,
  geoLng: number | null | undefined,
  pinLat: number | null | undefined,
  pinLng: number | null | undefined,
  precisao: string | null | undefined
): { offsetM: number | null; maxOffsetM: number | null; isTooFar: boolean } {
  if (
    geoLat === undefined ||
    geoLat === null ||
    Number.isNaN(Number(geoLat)) ||
    geoLng === undefined ||
    geoLng === null ||
    Number.isNaN(Number(geoLng)) ||
    pinLat === undefined ||
    pinLat === null ||
    Number.isNaN(Number(pinLat)) ||
    pinLng === undefined ||
    pinLng === null ||
    Number.isNaN(Number(pinLng))
  ) {
    return { offsetM: null, maxOffsetM: null, isTooFar: false };
  }

  const offsetM = calculateDistanceMeters(
    Number(geoLat),
    Number(geoLng),
    Number(pinLat),
    Number(pinLng)
  );
  const maxOffsetM =
    precisao === 'exata' ? 300 : precisao === 'rua' ? 800 : null;
  const isTooFar = maxOffsetM !== null && offsetM > maxOffsetM;

  return { offsetM, maxOffsetM, isTooFar };
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

export interface CepResult {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  latitude?: number;
  longitude?: number;
  erro?: boolean;
}

/**
 * Searches Brazilian Postal Service (ViaCEP) for a given CEP.
 */
export async function fetchAddressByCep(cep: string): Promise<CepResult | null> {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;
    return data;
  } catch (e) {
    console.warn('ViaCEP lookup error:', e);
    return null;
  }
}

/**
 * Fetches CEP information including geographic coordinates from BrasilAPI v2.
 */
export async function fetchCoordinatesByCepBrasilApi(cep: string): Promise<{
  lat: number;
  lng: number;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
} | null> {
  const clean = cep.replace(/\D/g, '');
  if (clean.length !== 8) return null;

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${clean}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.location?.coordinates?.latitude && data.location?.coordinates?.longitude) {
      const lat = parseFloat(data.location.coordinates.latitude);
      const lng = parseFloat(data.location.coordinates.longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        return {
          lat,
          lng,
          street: data.street || '',
          neighborhood: data.neighborhood || '',
          city: data.city || '',
          state: data.state || '',
        };
      }
    }
  } catch (e) {
    console.warn('BrasilAPI CEP v2 lookup error:', e);
  }
  return null;
}

export interface ServerGeoResolveResult {
  latitude: number;
  longitude: number;
  precisao: 'exata' | 'rua' | 'aproximada' | string;
  displayName?: string;
}

/**
 * Resolves full address coordinates via the server endpoint POST /api/geo/resolve
 * (OpenStreetMap Nominatim structured search on server -> BrasilAPI fallback).
 * Never calls Nominatim directly from the browser.
 */
export async function resolveFullAddressOnServer(params: {
  rua?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  cep?: string;
  query?: string;
}): Promise<ServerGeoResolveResult | null> {
  try {
    const res = await fetch('/api/geo/resolve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (
      data &&
      typeof data.latitude === 'number' &&
      !Number.isNaN(data.latitude) &&
      typeof data.longitude === 'number' &&
      !Number.isNaN(data.longitude)
    ) {
      return {
        latitude: data.latitude,
        longitude: data.longitude,
        precisao: data.precisao || 'rua',
        displayName: data.displayName || '',
      };
    }
    return null;
  } catch (e) {
    console.warn('Server geocoding error:', e);
    return null;
  }
}

/**
 * Geocodes an address string via the backend POST /api/geo/resolve endpoint.
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  if (!query || !query.trim()) return null;

  const resolved = await resolveFullAddressOnServer({ query: query.trim() });
  if (!resolved) return null;

  return {
    lat: resolved.latitude,
    lng: resolved.longitude,
    displayName: resolved.displayName || query.trim(),
  };
}

/**
 * Resolves address and coordinates either by CEP or address string using ViaCEP + POST /api/geo/resolve.
 */
export async function resolveAddressOrCep(
  input: string
): Promise<{
  address: string;
  lat: number;
  lng: number;
  source: 'cep' | 'geocode';
  precisao?: string;
} | null> {
  if (!input || !input.trim()) return null;

  const cepMatch = input.match(/\b\d{5}-?\d{3}\b/);
  const cleanDigits = input.replace(/\D/g, '');
  const targetCep = cepMatch ? cepMatch[0].replace(/\D/g, '') : cleanDigits.length === 8 ? cleanDigits : null;

  if (targetCep) {
    const viaCepData = await fetchAddressByCep(targetCep);
    const brasilApiData = await fetchCoordinatesByCepBrasilApi(targetCep);

    const street = viaCepData?.logradouro || brasilApiData?.street || '';
    const neighborhood = viaCepData?.bairro || brasilApiData?.neighborhood || '';
    const city = viaCepData?.localidade || brasilApiData?.city || '';
    const uf = viaCepData?.uf || brasilApiData?.state || '';

    const numberMatch = input.replace(targetCep, '').match(/\b\d{1,5}\b/);
    const streetNumber = numberMatch ? numberMatch[0] : '';

    const formattedAddress = [
      street ? `${street}${streetNumber ? `, ${streetNumber}` : ''}` : '',
      neighborhood,
      city && uf ? `${city} - ${uf}` : city,
      `CEP ${targetCep.slice(0, 5)}-${targetCep.slice(5)}`,
    ]
      .filter(Boolean)
      .join(', ');

    const serverGeo = await resolveFullAddressOnServer({
      rua: street,
      numero: streetNumber,
      bairro: neighborhood,
      cidade: city,
      uf,
      cep: targetCep,
    });

    if (serverGeo) {
      return {
        address: formattedAddress,
        lat: serverGeo.latitude,
        lng: serverGeo.longitude,
        source: 'cep',
        precisao: serverGeo.precisao,
      };
    }

    if (brasilApiData?.lat && brasilApiData?.lng) {
      return {
        address: formattedAddress,
        lat: brasilApiData.lat,
        lng: brasilApiData.lng,
        source: 'cep',
        precisao: 'aproximada',
      };
    }
  }

  const geo = await resolveFullAddressOnServer({ query: input.trim() });
  if (geo) {
    return {
      address: geo.displayName || input.trim(),
      lat: geo.latitude,
      lng: geo.longitude,
      source: 'geocode',
      precisao: geo.precisao,
    };
  }

  return null;
}

export interface RouteCustomerLike {
  name?: string;
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;
  latitude?: number | null;
  longitude?: number | null;
  geoLatitude?: number | null;
  geoLongitude?: number | null;
  geo_latitude?: number | null;
  geo_longitude?: number | null;
  pinOffsetM?: number | null;
  pin_offset_m?: number | null;
  locationVerified?: boolean | null;
  location_verified?: boolean | null;
}

/**
 * Formats the customer's full written address (street, number, neighborhood, city, state, CEP).
/**
 * Extracts the city/UF portion from the store's full address string if available.
 * Example: "Av. das Palmeiras, 450 - Centro, São Paulo - SP" -> "São Paulo - SP"
 */
export function extractStoreCityFromAddress(storeAddress?: string | null): string {
  if (!storeAddress) return '';
  const raw = String(storeAddress).trim();
  if (!raw) return '';
  const commaParts = raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length >= 3) {
    return commaParts[commaParts.length - 1];
  }
  const dashParts = raw
    .split(' - ')
    .map((p) => p.trim())
    .filter(Boolean);
  if (dashParts.length >= 3) {
    return dashParts.slice(-2).join(' - ');
  }
  if (commaParts.length === 2) {
    const second = commaParts[1];
    if (!/^\d+$/.test(second)) {
      return second;
    }
  }
  return '';
}

/**
 * Formats a customer's written address for Google Maps destination search:
 * "Rua, Número, Bairro, Cidade da loja"
 */
export function formatCustomerWrittenAddress(
  customer?: RouteCustomerLike | null,
  storeAddress?: string | null
): string {
  if (!customer) return '';
  const streetPart = [
    customer.address?.trim() || '',
    customer.number?.trim() ? customer.number.trim() : '',
  ]
    .filter(Boolean)
    .join(', ');

  const customerCityState = [
    customer.city?.trim() || '',
    customer.state?.trim() || '',
  ]
    .filter(Boolean)
    .join(' - ');

  const storeCity = extractStoreCityFromAddress(storeAddress);
  const cityStatePart = customerCityState || storeCity;

  const cepDigits = (customer.cep || '').replace(/\D/g, '');
  const formattedCep =
    cepDigits.length === 8
      ? `${cepDigits.slice(0, 5)}-${cepDigits.slice(5)}`
      : customer.cep?.trim() || '';

  return [
    streetPart,
    customer.neighborhood?.trim() || '',
    cityStatePart,
    formattedCep,
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Checks whether the customer's written address is present.
 */
export function isCustomerLocationVerified(customer?: RouteCustomerLike | null): boolean {
  if (!customer) return false;
  return Boolean(customer.address?.trim() && customer.neighborhood?.trim());
}

/**
 * Coordinates are no longer used for delivery routes; always returns false so routes use written address.
 */
export function shouldUseCustomerCoordinatesForRoute(_customer?: RouteCustomerLike | null): boolean {
  return false;
}

/**
 * Returns the Google Maps destination parameter for a delivery customer using the written address
 * (street, number, neighborhood, store city) without coordinates.
 */
export function getDeliveryDestinationParam(
  customer?: RouteCustomerLike | null,
  storeAddress?: string | null
): string {
  if (!customer) return '';

  const written = formatCustomerWrittenAddress(customer, storeAddress);
  if (written) {
    return encodeURIComponent(written);
  }

  if (customer.address?.trim()) {
    return encodeURIComponent(customer.address.trim());
  }

  return '';
}

/**
 * Builds the public Google Maps route URL for a single delivery order using the written address:
 * https://www.google.com/maps/dir/?api=1&destination=...&travelmode=driving
 */
export function buildSingleDeliveryRouteUrl(
  customer?: RouteCustomerLike | null,
  storeAddress?: string | null
): string {
  const dest = getDeliveryDestinationParam(customer, storeAddress);
  if (!dest) return 'https://www.google.com/maps';
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

export interface MultiRouteOrderStop<T = any> {
  order: T;
  stopNumber: number;
  destinationParam: string;
  writtenAddress: string;
  isVerified: boolean;
  distanceFromPrevKm: number | null;
}

/**
 * Builds a multi-stop Google Maps directions URL (up to 9 stops) using only written addresses
 * (street, number, neighborhood, store city) without coordinates.
 */
export function buildMultiStopDeliveryRoute<T extends { id: string; customer: RouteCustomerLike }>(
  orders: T[],
  storeSettings: { address?: string; storeLatitude?: number; storeLongitude?: number }
): {
  url: string;
  orderedStops: MultiRouteOrderStop<T>[];
} {
  const limited = orders.slice(0, 9);
  if (limited.length === 0) {
    return { url: 'https://www.google.com/maps', orderedStops: [] };
  }

  const storeAddress = storeSettings.address?.trim() || '';

  const orderedStops: MultiRouteOrderStop<T>[] = limited.map((order, idx) => {
    const c = order.customer;
    return {
      order,
      stopNumber: idx + 1,
      destinationParam: getDeliveryDestinationParam(c, storeAddress),
      writtenAddress:
        formatCustomerWrittenAddress(c, storeAddress) || c?.address || 'Endereço não informado',
      isVerified: true,
      distanceFromPrevKm: null,
    };
  });

  const originParam = storeAddress ? encodeURIComponent(storeAddress) : '';

  const lastStop = orderedStops[orderedStops.length - 1];
  const intermediateStops = orderedStops.slice(0, -1);

  const waypointsParam = intermediateStops
    .map((s) => s.destinationParam)
    .filter(Boolean)
    .join('|');

  const queryParts: string[] = ['api=1'];
  if (originParam) {
    queryParts.push(`origin=${originParam}`);
  }
  if (lastStop?.destinationParam) {
    queryParts.push(`destination=${lastStop.destinationParam}`);
  }
  if (waypointsParam) {
    queryParts.push(`waypoints=${waypointsParam}`);
  }
  queryParts.push('travelmode=driving');

  return {
    url: `https://www.google.com/maps/dir/?${queryParts.join('&')}`,
    orderedStops,
  };
}
