import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { MapPin, Navigation, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';

interface AddressPinMapProps {
  latitude: number;
  longitude: number;
  precisao?: 'exata' | 'rua' | 'aproximada' | string | null;
  onChange: (lat: number, lng: number) => void;
  showConfirmButton?: boolean;
  onConfirmPin?: (lat: number, lng: number) => void;
  isConfirmingPin?: boolean;
  pinConfirmed?: boolean;
}

export const AddressPinMap: React.FC<AddressPinMapProps> = ({
  latitude,
  longitude,
  precisao,
  onChange,
  showConfirmButton = false,
  onConfirmPin,
  isConfirmingPin = false,
  pinConfirmed = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [isLocatingGps, setIsLocatingGps] = useState<boolean>(false);
  const [gpsError, setGpsError] = useState<string>('');

  // Keep latest callback ref so Leaflet event listeners always invoke current handler
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [latitude, longitude],
        zoom: 17,
        zoomControl: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'custom-customer-pin-icon',
        html: `<div style="width:36px;height:36px;background:#dc2626;border:3px solid #ffffff;border-radius:9999px;box-shadow:0 6px 14px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;font-size:18px;cursor:grab;">📍</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 32],
      });

      const marker = L.marker([latitude, longitude], {
        draggable: true,
        icon: pinIcon,
      }).addTo(map);

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        const roundedLat = Math.round(pos.lat * 1000000) / 1000000;
        const roundedLng = Math.round(pos.lng * 1000000) / 1000000;
        onChangeRef.current(roundedLat, roundedLng);
      });

      map.on('click', (e: L.LeafletMouseEvent) => {
        const roundedLat = Math.round(e.latlng.lat * 1000000) / 1000000;
        const roundedLng = Math.round(e.latlng.lng * 1000000) / 1000000;
        marker.setLatLng([roundedLat, roundedLng]);
        onChangeRef.current(roundedLat, roundedLng);
      });

      mapInstanceRef.current = map;
      markerRef.current = marker;

      setTimeout(() => {
        map.invalidateSize();
      }, 180);
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, []);

  // Sync marker and map center when latitude/longitude props change externally
  useEffect(() => {
    const map = mapInstanceRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const currentPos = marker.getLatLng();
    const diffLat = Math.abs(currentPos.lat - latitude);
    const diffLng = Math.abs(currentPos.lng - longitude);

    if (diffLat > 0.00001 || diffLng > 0.00001) {
      marker.setLatLng([latitude, longitude]);
      map.setView([latitude, longitude], Math.max(map.getZoom(), 17), { animate: true });
    }
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  }, [latitude, longitude]);

  const handleUseCurrentLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsError('Geolocalização não suportada neste navegador.');
      return;
    }

    setIsLocatingGps(true);
    setGpsError('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocatingGps(false);
        const gpsLat = Math.round(position.coords.latitude * 1000000) / 1000000;
        const gpsLng = Math.round(position.coords.longitude * 1000000) / 1000000;

        if (markerRef.current && mapInstanceRef.current) {
          markerRef.current.setLatLng([gpsLat, gpsLng]);
          mapInstanceRef.current.setView([gpsLat, gpsLng], 18, { animate: true });
        }
        onChange(gpsLat, gpsLng);
      },
      (err) => {
        setIsLocatingGps(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGpsError('Permissão de localização negada. Ative o GPS ou arraste o alfinete no mapa.');
        } else {
          setGpsError('Não foi possível obter a localização atual do aparelho.');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  return (
    <div className="p-3 bg-white border-2 border-amber-300 rounded-2xl space-y-2.5 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-amber-950 font-black text-xs">
          <MapPin className="w-4 h-4 text-red-600 shrink-0" />
          <span>Localização da Entrega no Mapa</span>
        </div>

        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={isLocatingGps}
          className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
        >
          {isLocatingGps ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Navigation className="w-3.5 h-3.5" />
          )}
          <span>Usar minha localização atual</span>
        </button>
      </div>

      <p className="text-[11px] text-neutral-700 font-semibold leading-snug">
        Confira se o alfinete está na sua casa. Se não estiver, arraste até o lugar certo.
      </p>

      {precisao === 'aproximada' && (
        <div className="p-2.5 bg-amber-100 border border-amber-400 rounded-xl text-amber-950 text-[11px] font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <span>
            Atenção: A localização encontrada pelo CEP é aproximada. Por favor, ajuste o alfinete no mapa até a posição exata da sua casa ou clique em &ldquo;Usar minha localização atual&rdquo;.
          </span>
        </div>
      )}

      {gpsError && (
        <p className="text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 p-2 rounded-xl">
          {gpsError}
        </p>
      )}

      <div className="relative rounded-xl overflow-hidden border border-neutral-300 h-48 w-full z-0">
        <div ref={mapContainerRef} className="w-full h-full" />
      </div>

      {showConfirmButton && onConfirmPin && (
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-neutral-600 font-medium">
            {pinConfirmed
              ? '✓ Localização confirmada para suas entregas!'
              : 'Confirme o ponto no mapa uma vez para atualizar seu cadastro:'}
          </span>
          <button
            type="button"
            onClick={() => onConfirmPin(latitude, longitude)}
            disabled={isConfirmingPin}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black rounded-xl text-[11px] flex items-center gap-1 shrink-0 cursor-pointer shadow-2xs"
          >
            {isConfirmingPin ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            <span>{pinConfirmed ? 'Atualizar ponto' : 'Confirmar localização'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
