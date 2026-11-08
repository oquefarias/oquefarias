// Utility for CEP lookup (ViaCEP) and Google Maps routes by written address

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
