import React, { useState, useEffect, useRef } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import L from 'leaflet';
import { StoreSettings } from '../../types';
import {
  MapPin,
  Search,
  Navigation,
  CheckCircle2,
  Compass,
  Sliders,
  DollarSign,
  Loader2,
  Check,
  Building2,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import {
  resolveAddressOrCep,
  fetchAddressByCep,
  fetchCoordinatesByCepBrasilApi,
  geocodeAddress,
} from '../../utils/geo';

const GOOGLE_MAPS_API_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GOOGLE_MAPS_API_KEY) ||
  'AIzaSyBnPqXUmvGHh2nXkgb1yBap52jlLLSwaI4';

interface GoogleDeliveryRadiusMapProps {
  settings: StoreSettings;
  onSave: (updated: Partial<StoreSettings>) => void;
}

// Circle overlay & Camera synchronization on Google Maps
interface MapCircleOverlayProps {
  center: { lat: number; lng: number };
  radiusKm: number;
}

const MapCircleOverlay: React.FC<MapCircleOverlayProps> = ({ center, radiusKm }) => {
  const map = useMap();
  const circleRef = useRef<google.maps.Circle | null>(null);

  useEffect(() => {
    if (!map) return;

    if (!circleRef.current) {
      circleRef.current = new google.maps.Circle({
        map,
        center,
        radius: radiusKm * 1000,
        strokeColor: '#d97706',
        strokeOpacity: 0.9,
        strokeWeight: 2.5,
        fillColor: '#f59e0b',
        fillOpacity: 0.2,
      });
    } else {
      circleRef.current.setCenter(center);
      circleRef.current.setRadius(radiusKm * 1000);
    }

    return () => {
      if (circleRef.current) {
        circleRef.current.setMap(null);
        circleRef.current = null;
      }
    };
  }, [map, center, radiusKm]);

  // Adjust camera to fit the circle bounds smoothly
  useEffect(() => {
    if (!map || !circleRef.current) return;
    const bounds = circleRef.current.getBounds();
    if (bounds) {
      map.fitBounds(bounds, 40);
    }
  }, [map, center, radiusKm]);

  return null;
};

// Fallback Interactive Leaflet Map if Google Maps API has issues or is loading
const LeafletFallbackMap: React.FC<{
  center: { lat: number; lng: number };
  radiusKm: number;
  onPinDragEnd: (coords: { lat: number; lng: number }) => void;
}> = ({ center, radiusKm, onPinDragEnd }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom: 13,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const storeIcon = L.divIcon({
      className: 'custom-leaflet-store-pin',
      html: `
        <div style="
          background-color: #f59e0b;
          color: #000;
          width: 38px;
          height: 38px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.35);
          border: 3px solid #ffffff;
          transform: translate(-50%, -50%);
        ">
          🍺
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    });

    const marker = L.marker([center.lat, center.lng], {
      draggable: true,
      icon: storeIcon,
      title: 'Ponto do Depósito (Arraste para ajustar)',
    }).addTo(map);

    const circle = L.circle([center.lat, center.lng], {
      radius: radiusKm * 1000,
      color: '#f59e0b',
      fillColor: '#f59e0b',
      fillOpacity: 0.2,
      weight: 3,
      dashArray: '4, 4',
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      onPinDragEnd({ lat: pos.lat, lng: pos.lng });
    });

    mapRef.current = map;
    markerRef.current = marker;
    circleRef.current = circle;

    setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !circleRef.current) return;
    const pos = L.latLng(center.lat, center.lng);
    markerRef.current.setLatLng(pos);
    circleRef.current.setLatLng(pos);
    circleRef.current.setRadius(radiusKm * 1000);

    const bounds = circleRef.current.getBounds();
    mapRef.current.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
  }, [center.lat, center.lng, radiusKm]);

  return (
    <div
      ref={containerRef}
      className="w-full flex-1 rounded-2xl overflow-hidden border border-neutral-200 z-0 min-h-[480px]"
      style={{ minHeight: '480px' }}
    />
  );
};

// Search component with Google Maps search & CEP search
interface AddressAndCepSearchProps {
  initialAddress: string;
  onSelectLocation: (info: { address: string; lat: number; lng: number }) => void;
}

const AddressAndCepSearch: React.FC<AddressAndCepSearchProps> = ({
  initialAddress,
  onSelectLocation,
}) => {
  const placesLib = useMapsLibrary('places');
  const [searchMode, setSearchMode] = useState<'google' | 'cep'>('google');

  // Address search query
  const [addressQuery, setAddressQuery] = useState<string>(initialAddress);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState<boolean>(false);

  // CEP search query
  const [cepQuery, setCepQuery] = useState<string>('');
  const [cepNumber, setCepNumber] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusNotice, setStatusNotice] = useState<{
    type: 'success' | 'info' | 'warn';
    message: string;
  } | null>(null);

  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAddressQuery(initialAddress);
  }, [initialAddress]);

  // Click outside to close suggestion dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch Google Places suggestions with debounce
  useEffect(() => {
    if (searchMode !== 'google') return;
    if (!addressQuery || addressQuery.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    // If query looks like a CEP (e.g. 01310-100 or 8 digits)
    const cleanDigits = addressQuery.replace(/\D/g, '');
    if (cleanDigits.length === 8) {
      return; // Handled directly
    }

    const timer = setTimeout(async () => {
      try {
        // Try classic AutocompleteService first (most compatible across Google API keys)
        if (window.google?.maps?.places?.AutocompleteService) {
          const autoService = new window.google.maps.places.AutocompleteService();
          autoService.getPlacePredictions(
            {
              input: addressQuery,
              componentRestrictions: { country: 'br' },
              types: ['geocode', 'establishment'],
            },
            (preds, status) => {
              if (status === window.google.maps.places.PlacesServiceStatus.OK && preds) {
                setSuggestions(preds);
                setIsDropdownOpen(true);
              }
            }
          );
        } else if (placesLib?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
          // New Places API
          const res = await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input: addressQuery,
            includedRegionCodes: ['br'],
            language: 'pt-BR',
          });
          if (res?.suggestions) {
            setSuggestions(res.suggestions);
            setIsDropdownOpen(true);
          }
        }
      } catch (err) {
        console.warn('Google Places suggestion error, CEP fallback ready:', err);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [addressQuery, searchMode, placesLib]);

  // Execute Google Maps address search with automatic CEP fallback
  const handleSearchGoogleAddress = async (selectedText?: string) => {
    const query = selectedText || addressQuery;
    if (!query || !query.trim()) {
      setStatusNotice({ type: 'warn', message: 'Digite um endereço para pesquisar.' });
      return;
    }

    setIsLoading(true);
    setStatusNotice(null);
    setIsDropdownOpen(false);

    try {
      // 1. If user typed an 8-digit CEP directly into the address bar
      const cleanDigits = query.replace(/\D/g, '');
      if (cleanDigits.length === 8 && query.trim().length <= 11) {
        const resolved = await resolveAddressOrCep(cleanDigits);
        if (resolved) {
          setAddressQuery(resolved.address);
          onSelectLocation(resolved);
          setStatusNotice({
            type: 'success',
            message: `Localizado via CEP ${cleanDigits}: ${resolved.address}`,
          });
          return;
        }
      }

      // 2. Try Google Geocoder first if available
      let googleResolved = false;
      if (window.google?.maps?.Geocoder) {
        try {
          const geocoder = new window.google.maps.Geocoder();
          const geoRes = await new Promise<google.maps.GeocoderResult[] | null>((resolve) => {
            geocoder.geocode(
              { address: query, componentRestrictions: { country: 'BR' } },
              (results, status) => {
                if (status === 'OK' && results && results.length > 0) {
                  resolve(results);
                } else {
                  resolve(null);
                }
              }
            );
          });

          if (geoRes && geoRes[0]?.geometry?.location) {
            const loc = geoRes[0].geometry.location;
            const formatted = geoRes[0].formatted_address || query;
            setAddressQuery(formatted);
            onSelectLocation({
              address: formatted,
              lat: loc.lat(),
              lng: loc.lng(),
            });
            setStatusNotice({
              type: 'success',
              message: `Endereço localizado no Google Maps com sucesso!`,
            });
            googleResolved = true;
            return;
          }
        } catch (e) {
          console.warn('Google Geocoding API indisponível ou não ativada na chave, usando busca por CEP/endereço.', e);
        }
      }

      if (!googleResolved) {
        // 3. Fallback: Search using CEP or Brazil address geocoding
        const resolved = await resolveAddressOrCep(query);
        if (resolved) {
          setAddressQuery(resolved.address);
          onSelectLocation(resolved);
          setStatusNotice({
            type: 'info',
            message: `Localizado com precisão real: ${resolved.address}`,
          });
          return;
        }

        // If not found, suggest searching by CEP
        setStatusNotice({
          type: 'warn',
          message: 'Endereço não encontrado diretamente. Digite o CEP da loja para posicionar com 100% de precisão!',
        });
      }
    } catch {
      // Automatic CEP search fallback
      const resolved = await resolveAddressOrCep(query);
      if (resolved) {
        setAddressQuery(resolved.address);
        onSelectLocation(resolved);
        setStatusNotice({
          type: 'info',
          message: `Localizado via endereço e CEP: ${resolved.address}`,
        });
      } else {
        setStatusNotice({
          type: 'warn',
          message: 'Erro ao buscar no Google Maps. Tente pesquisar pelo CEP da loja na aba ao lado.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Execute direct CEP search
  const handleSearchCep = async () => {
    const cleanCep = cepQuery.replace(/\D/g, '');
    if (cleanCep.length !== 8) {
      setStatusNotice({
        type: 'warn',
        message: 'Por favor, digite um CEP válido com 8 dígitos (ex: 01310-100).',
      });
      return;
    }

    setIsLoading(true);
    setStatusNotice(null);

    try {
      const inputStr = cepNumber ? `${cleanCep}, ${cepNumber}` : cleanCep;
      const resolved = await resolveAddressOrCep(inputStr);

      if (resolved) {
        setAddressQuery(resolved.address);
        onSelectLocation(resolved);
        setStatusNotice({
          type: 'success',
          message: `Depósito localizado pelo CEP ${cleanCep}: ${resolved.address}`,
        });
      } else {
        // Fallback directly to ViaCEP
        const viaCep = await fetchAddressByCep(cleanCep);
        if (viaCep && !viaCep.erro) {
          const addr = `${viaCep.logradouro ? viaCep.logradouro + (cepNumber ? `, ${cepNumber}` : '') + ', ' : ''}${viaCep.bairro ? viaCep.bairro + ', ' : ''}${viaCep.localidade} - ${viaCep.uf}, CEP ${viaCep.cep}`;
          // Try geocoding street + city
          const geo = await geocodeAddress(`${viaCep.logradouro || ''} ${viaCep.localidade} ${viaCep.uf} Brasil`);
          if (geo) {
            setAddressQuery(addr);
            onSelectLocation({ address: addr, lat: geo.lat, lng: geo.lng });
            setStatusNotice({
              type: 'success',
              message: `Localizado pelo CEP: ${addr}`,
            });
            return;
          }
        }
        setStatusNotice({
          type: 'warn',
          message: `CEP ${cleanCep} não encontrado. Verifique os dígitos e tente novamente.`,
        });
      }
    } catch {
      setStatusNotice({
        type: 'warn',
        message: 'Falha ao buscar o CEP. Verifique sua conexão e tente novamente.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Search Mode Tabs */}
      <div className="flex bg-neutral-100 p-1 rounded-2xl gap-1">
        <button
          type="button"
          onClick={() => {
            setSearchMode('google');
            setStatusNotice(null);
          }}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            searchMode === 'google'
              ? 'bg-white text-neutral-900 shadow-2xs'
              : 'text-neutral-500 hover:text-neutral-900'
          }`}
        >
          <Search className="w-3.5 h-3.5 text-amber-500" />
          <span>Pesquisar no Google Maps</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSearchMode('cep');
            setStatusNotice(null);
          }}
          className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            searchMode === 'cep'
              ? 'bg-amber-500 text-neutral-950 font-black shadow-2xs'
              : 'text-neutral-500 hover:text-neutral-900'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          <span>Pesquisar por CEP</span>
        </button>
      </div>

      {/* MODE 1: GOOGLE MAPS SEARCH */}
      {searchMode === 'google' && (
        <div ref={dropdownRef} className="relative space-y-1">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={addressQuery}
                onChange={(e) => setAddressQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchGoogleAddress();
                  }
                }}
                placeholder="Ex: Av. Paulista, 1000 ou digite o CEP..."
                className="w-full px-3.5 py-3 pl-10 bg-neutral-50 border border-neutral-300 rounded-2xl text-xs font-semibold focus:border-amber-500 focus:bg-white outline-none transition-all shadow-2xs"
              />
              <MapPin className="w-4 h-4 text-amber-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              {isLoading && (
                <Loader2 className="w-4 h-4 text-neutral-400 animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
              )}
            </div>

            <button
              type="button"
              onClick={() => handleSearchGoogleAddress()}
              disabled={isLoading}
              className="px-4 py-3 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-2xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Localizar</span>
            </button>
          </div>

          {/* Google Places Dropdown */}
          {isDropdownOpen && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 bg-white border border-neutral-200 rounded-2xl shadow-xl z-50 overflow-hidden max-h-64 overflow-y-auto">
              <div className="px-3 py-1.5 bg-neutral-100/80 border-b border-neutral-200 text-[10px] font-bold text-neutral-500 uppercase tracking-wider flex items-center justify-between">
                <span>Sugestões Google Maps</span>
              </div>
              {suggestions.map((item, idx) => {
                const text =
                  item.description ||
                  item.placePrediction?.text?.text ||
                  item.placePrediction?.mainText?.text ||
                  '';
                const secondary =
                  item.structured_formatting?.secondary_text ||
                  item.placePrediction?.secondaryText?.text ||
                  '';
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setAddressQuery(text);
                      handleSearchGoogleAddress(text);
                    }}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-amber-50/70 border-b border-neutral-100 last:border-0 transition-colors flex items-start gap-2.5 cursor-pointer"
                  >
                    <MapPin className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-bold text-xs text-neutral-900 line-clamp-1">{text}</p>
                      {secondary && (
                        <p className="text-[11px] text-neutral-500 line-clamp-1">{secondary}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODE 2: DIRECT CEP SEARCH */}
      {searchMode === 'cep' && (
        <div className="space-y-2">
          <div className="grid grid-cols-12 gap-2">
            <div className="col-span-7 relative">
              <input
                type="text"
                value={cepQuery}
                maxLength={9}
                onChange={(e) => {
                  let v = e.target.value.replace(/\D/g, '');
                  if (v.length > 5) v = `${v.slice(0, 5)}-${v.slice(5, 8)}`;
                  setCepQuery(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchCep();
                  }
                }}
                placeholder="CEP: 01310-100"
                className="w-full px-3.5 py-3 bg-neutral-50 border border-neutral-300 rounded-2xl text-xs font-bold focus:border-amber-500 focus:bg-white outline-none transition-all shadow-2xs font-mono"
              />
            </div>

            <div className="col-span-5 flex gap-2">
              <input
                type="text"
                value={cepNumber}
                onChange={(e) => setCepNumber(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchCep();
                  }
                }}
                placeholder="Nº (ex: 1500)"
                className="w-full px-3 py-3 bg-neutral-50 border border-neutral-300 rounded-2xl text-xs font-medium focus:border-amber-500 focus:bg-white outline-none transition-all shadow-2xs"
              />

              <button
                type="button"
                onClick={handleSearchCep}
                disabled={isLoading}
                className="px-3.5 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 rounded-2xl text-xs font-black transition-all flex items-center gap-1 shrink-0 shadow-2xs cursor-pointer"
              >
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>Buscar</span>
              </button>
            </div>
          </div>
          <p className="text-[11px] text-neutral-500">
            Busca oficial pelos Correios e BrasilAPI com coordenadas GPS automáticas.
          </p>
        </div>
      )}

      {/* Status Notice Banner */}
      {statusNotice && (
        <div
          className={`p-3 rounded-2xl text-xs font-medium flex items-center gap-2 animate-fade-in ${
            statusNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : statusNotice.type === 'info'
              ? 'bg-amber-50 text-amber-900 border border-amber-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {statusNotice.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          )}
          <span>{statusNotice.message}</span>
        </div>
      )}
    </div>
  );
};

// Main Export Component
export const GoogleDeliveryRadiusMap: React.FC<GoogleDeliveryRadiusMapProps> = ({
  settings,
  onSave,
}) => {
  const [googleMapsError, setGoogleMapsError] = useState<boolean>(false);

  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      language="pt-BR"
      region="BR"
      libraries={['places', 'geometry']}
      onError={(err) => {
        console.warn('Google Maps API load error, Leaflet fallback enabled:', err);
        setGoogleMapsError(true);
      }}
    >
      <GoogleDeliveryRadiusMapInner
        settings={settings}
        onSave={onSave}
        isFallbackActive={googleMapsError}
      />
    </APIProvider>
  );
};

interface GoogleDeliveryRadiusMapInnerProps extends GoogleDeliveryRadiusMapProps {
  isFallbackActive: boolean;
}

const GoogleDeliveryRadiusMapInner: React.FC<GoogleDeliveryRadiusMapInnerProps> = ({
  settings,
  onSave,
  isFallbackActive,
}) => {
  const [address, setAddress] = useState<string>(settings.address || 'São Paulo, SP');
  const [center, setCenter] = useState<{ lat: number; lng: number }>({
    lat: settings.storeLatitude || -23.55052,
    lng: settings.storeLongitude || -46.633308,
  });
  const [radiusKm, setRadiusKm] = useState<number>(settings.deliveryRadiusKm || 5);
  const [deliveryFee, setDeliveryFee] = useState<number>(settings.deliveryFee || 5.0);
  const [pricePerKm, setPricePerKm] = useState<number>(settings.pricePerKm || 0);
  const [deliveryModel, setDeliveryModel] = useState<'radius' | 'neighborhoods' | 'both'>(
    settings.deliveryModel || 'both'
  );
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<boolean>(false);

  // Handle location update from search bar (Google Maps or CEP)
  const handleSelectLocation = (info: { address: string; lat: number; lng: number }) => {
    setAddress(info.address);
    setCenter({ lat: info.lat, lng: info.lng });
  };

  // Use current GPS location from device
  const handleUseCurrentGPS = () => {
    if (!navigator.geolocation) {
      alert('Geolocalização não suportada no seu navegador.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(coords);
        try {
          const res = await resolveAddressOrCep(`${coords.lat}, ${coords.lng}`);
          if (res) {
            setAddress(res.address);
          } else {
            setAddress(`Coordenadas: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
          }
        } catch {
          setAddress(`Coordenadas: ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`);
        }
      },
      () => {
        alert('Não foi possível obter a sua localização GPS atual. Permita o acesso à localização.');
      }
    );
  };

  // Save changes to store settings
  const handleSave = () => {
    onSave({
      address,
      storeLatitude: center.lat,
      storeLongitude: center.lng,
      deliveryRadiusKm: radiusKm,
      deliveryFee,
      pricePerKm,
      deliveryModel,
    });
    setSaveSuccessMessage(true);
    setTimeout(() => setSaveSuccessMessage(false), 3500);
  };

  const coverageAreaApprox = (Math.PI * Math.pow(radiusKm, 2)).toFixed(1);

  return (
    <div className="space-y-6">
      {saveSuccessMessage && (
        <div className="p-4 bg-emerald-500 text-white rounded-2xl font-bold text-sm shadow-md flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>Configurações do raio de entrega salvas com sucesso!</span>
        </div>
      )}

      {/* HEADER */}
      <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-black">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-lg text-neutral-900">
                  Área de Entrega por Raio no Mapa
                </h3>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">
                  Google Maps & CEP
                </span>
              </div>
              <p className="text-xs text-neutral-500 mt-0.5">
                Pesquise o endereço da sua loja no Google Maps ou digite o CEP para posicionar o mapa e definir o raio de entrega em km.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-neutral-950 rounded-2xl font-black text-xs shadow-sm transition-all flex items-center gap-2 shrink-0 self-start md:self-auto cursor-pointer"
        >
          <Check className="w-4 h-4" />
          <span>Salvar Raio de Entrega</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: SEARCH BAR & RADIUS CONTROLS */}
        <div className="lg:col-span-5 space-y-5">
          {/* 1. SEARCH BAR WITH GOOGLE MAPS AUTOCOMPLETE & CEP */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-sm text-neutral-900 flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-500" />
                <span>1. Localizar sua Loja / Depósito</span>
              </h4>
              <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-bold">
                Endereço Real
              </span>
            </div>

            <p className="text-[11px] text-neutral-500">
              Digite o endereço no Google Maps ou faça a busca pelo <strong>CEP</strong> da loja se a API não localizar:
            </p>

            <AddressAndCepSearch
              initialAddress={address}
              onSelectLocation={handleSelectLocation}
            />

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleUseCurrentGPS}
                className="text-xs text-amber-600 hover:text-amber-700 font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Usar GPS atual da loja</span>
              </button>

              <span className="text-[10px] text-neutral-400 font-mono">
                {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
              </span>
            </div>
          </div>

          {/* 2. RADIUS CONTROLS (KM) */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-black text-sm text-neutral-900 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-500" />
                <span>2. Raio de Distância da Entrega</span>
              </h4>
              <div className="px-3.5 py-1 bg-amber-500 text-neutral-950 rounded-full font-black text-xs shadow-2xs">
                {radiusKm} km de alcance
              </div>
            </div>

            {/* Slider */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[11px] font-bold text-neutral-500">
                <span>1 km</span>
                <span className="text-amber-600 font-black">{radiusKm} km</span>
                <span>20 km</span>
              </div>
              <input
                type="range"
                min="1"
                max="20"
                step="0.5"
                value={radiusKm}
                onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer h-2 bg-neutral-200 rounded-lg appearance-none"
              />
            </div>

            {/* Quick Distance Buttons */}
            <div>
              <span className="text-[10px] uppercase font-bold text-neutral-400 block mb-2">
                Atalhos rápidos em quilômetros:
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5, 6, 8, 10, 12, 15].map((km) => (
                  <button
                    key={km}
                    type="button"
                    onClick={() => setRadiusKm(km)}
                    className={`py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
                      radiusKm === km
                        ? 'bg-amber-500 text-neutral-950 font-black shadow-xs scale-102'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {km} km
                  </button>
                ))}
              </div>
            </div>

            {/* Coverage badge */}
            <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-2xl text-[11px] text-amber-950 space-y-1">
              <div className="font-bold flex items-center justify-between">
                <span>Área Total Coberta no Mapa:</span>
                <span className="font-black text-amber-800">~{coverageAreaApprox} km²</span>
              </div>
              <p className="text-neutral-600 text-[10px]">
                O círculo âmbar no mapa representa exatamente o alcance de entrega a partir do seu depósito ({radiusKm} km).
              </p>
            </div>
          </div>

          {/* 3. TAXAS E MODELO */}
          <div className="bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs space-y-4">
            <h4 className="font-black text-sm text-neutral-900 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-amber-500" />
              <span>3. Taxas de Entrega</span>
            </h4>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Taxa Base de Frete (R$)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={deliveryFee}
                  onChange={(e) => setDeliveryFee(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl font-bold"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  + Adicional por km (R$)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={pricePerKm}
                  onChange={(e) => setPricePerKm(parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl font-bold"
                />
                <span className="text-[10px] text-neutral-400">0 = taxa fixa</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: MAP CONTAINER */}
        <div className="lg:col-span-7 flex flex-col space-y-3">
          <div className="bg-white rounded-3xl border border-neutral-200 p-3 shadow-xs flex-1 flex flex-col min-h-[560px]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-100 mb-2">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-500 animate-pulse"></span>
                <span className="text-xs font-black text-neutral-900 flex items-center gap-1.5">
                  <span>Visualização do Raio de Entrega</span>
                  <span className="text-neutral-400 font-normal">| {radiusKm} km</span>
                </span>
              </div>
              <span className="text-[11px] text-neutral-500">
                Pino 🍺 = Depósito | Círculo = Raio de {radiusKm} km
              </span>
            </div>

            {/* Map Component: Google Map or Fallback Map */}
            {isFallbackActive ? (
              <LeafletFallbackMap
                center={center}
                radiusKm={radiusKm}
                onPinDragEnd={(pos) => setCenter(pos)}
              />
            ) : (
              <div className="w-full flex-1 rounded-2xl overflow-hidden border border-neutral-200 min-h-[500px]">
                <Map
                  mapId="DEMO_MAP_ID"
                  defaultCenter={center}
                  center={center}
                  defaultZoom={13}
                  gestureHandling="greedy"
                  disableDefaultUI={false}
                  style={{ width: '100%', height: '100%', minHeight: '500px' }}
                  internalUsageAttributionIds={['gmp_git_agentskills_v1']}
                >
                  {/* Advanced Marker for Store Pin */}
                  <AdvancedMarker
                    position={center}
                    draggable={true}
                    onDragEnd={(e) => {
                      if (e.latLng) {
                        setCenter({ lat: e.latLng.lat(), lng: e.latLng.lng() });
                      }
                    }}
                    title="Ponto do seu Depósito (Arraste para ajustar se desejar)"
                  >
                    <div className="w-10 h-10 rounded-full bg-amber-500 border-2 border-white shadow-lg flex items-center justify-center text-xl cursor-grab active:cursor-grabbing hover:scale-110 transition-transform">
                      🍺
                    </div>
                  </AdvancedMarker>

                  {/* Dynamic Google Maps Circle */}
                  <MapCircleOverlay center={center} radiusKm={radiusKm} />
                </Map>
              </div>
            )}

            <div className="mt-2.5 px-3 py-2 bg-neutral-50 rounded-xl text-[11px] text-neutral-600 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Compass className="w-3.5 h-3.5 text-amber-500" />
                <span>Arraste o pino 🍺 para posicionar com precisão exata no mapa.</span>
              </span>
              <span className="font-bold text-neutral-800">Google Maps Platform &copy;</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
