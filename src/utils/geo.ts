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

