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

/**
 * Geocodes an address string using OpenStreetMap Nominatim.
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  if (!query || !query.trim()) return null;

  try {
    const cleanQuery = encodeURIComponent(query.trim());
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${cleanQuery}&countrycodes=br&limit=1`,
      {
        headers: {
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const item = data[0];
      return {
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        displayName: item.display_name,
      };
    }
    return null;
  } catch (e) {
    console.warn('Geocoding error:', e);
    return null;
  }
}

/**
 * Resolves address and coordinates either by CEP or address string.
 * Tier 1: Check if input contains an 8-digit CEP (ViaCEP + BrasilAPI v2).
 * Tier 2: Geocode address string with Brazil country bias.
 */
export async function resolveAddressOrCep(
  input: string
): Promise<{ address: string; lat: number; lng: number; source: 'cep' | 'geocode' } | null> {
  if (!input || !input.trim()) return null;

  // Extract any 8-digit pattern (e.g. 01310-100 or 01310100)
  const cepMatch = input.match(/\b\d{5}-?\d{3}\b/);
  const cleanDigits = input.replace(/\D/g, '');

  const targetCep = cepMatch ? cepMatch[0].replace(/\D/g, '') : (cleanDigits.length === 8 ? cleanDigits : null);

  if (targetCep) {
    // 1. First try BrasilAPI for direct coordinates
    const brasilApiData = await fetchCoordinatesByCepBrasilApi(targetCep);
    const viaCepData = await fetchAddressByCep(targetCep);

    const street = viaCepData?.logradouro || brasilApiData?.street || '';
    const neighborhood = viaCepData?.bairro || brasilApiData?.neighborhood || '';
    const city = viaCepData?.localidade || brasilApiData?.city || '';
    const uf = viaCepData?.uf || brasilApiData?.state || '';

    // Check if user also specified a number in the input (e.g., "01310-100, 1500" or "Rua X 120, CEP 01310-100")
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

    // If street and number exist, try Nominatim for exact house coordinates
    if (street && streetNumber && city) {
      const refined = await geocodeAddress(`${street}, ${streetNumber}, ${city}, ${uf}, Brasil`);
      if (refined) {
        return {
          address: formattedAddress,
          lat: refined.lat,
          lng: refined.lng,
          source: 'cep',
        };
      }
    }

    // Otherwise use BrasilAPI coordinates if available
    if (brasilApiData?.lat && brasilApiData?.lng) {
      return {
        address: formattedAddress,
        lat: brasilApiData.lat,
        lng: brasilApiData.lng,
        source: 'cep',
      };
    }

    // Fallback: Nominatim with street + neighborhood + city
    if (street || city) {
      const query = `${street} ${neighborhood} ${city} ${uf} Brasil`;
      const refined = await geocodeAddress(query);
      if (refined) {
        return {
          address: formattedAddress,
          lat: refined.lat,
          lng: refined.lng,
          source: 'cep',
        };
      }
    }
  }

  // Normal address search via Nominatim
  const geo = await geocodeAddress(input);
  if (geo) {
    return {
      address: geo.displayName,
      lat: geo.lat,
      lng: geo.lng,
      source: 'geocode',
    };
  }

  return null;
}
