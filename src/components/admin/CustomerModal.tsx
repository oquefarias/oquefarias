import React, { useState, useEffect } from 'react';
import { CustomerProfile, StoreSettings, DeliveryArea } from '../../types';
import {
  X,
  User,
  Phone,
  MapPin,
  Building2,
  Search,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Check,
} from 'lucide-react';
import {
  fetchAddressByCep,
  fetchCoordinatesByCepBrasilApi,
  calculateDistanceKm,
  resolveFullAddressOnServer,
} from '../../utils/geo';
import { AddressPinMap } from '../AddressPinMap';

interface CustomerModalProps {
  isOpen: boolean;
  customer: CustomerProfile | null;
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  onSave: (custData: Omit<CustomerProfile, 'id' | 'createdAt'> & { id?: string }) => Promise<void>;
  onClose: () => void;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({
  isOpen,
  customer,
  settings,
  deliveryAreas,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [cep, setCep] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [number, setNumber] = useState<string>('');
  const [neighborhood, setNeighborhood] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [complement, setComplement] = useState<string>('');
  const [reference, setReference] = useState<string>('');

  // Geographic and delivery radius state
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
  const [geoPrecisao, setGeoPrecisao] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [isWithinRadius, setIsWithinRadius] = useState<boolean | null>(null);

  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepStatusMessage, setCepStatusMessage] = useState<{
    type: 'success' | 'warn' | 'error';
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (customer) {
      setName(customer.name || '');
      setPhone(customer.phone || '');
      setCep(customer.cep || '');
      setAddress(customer.address || '');
      setNumber(customer.number || '');
      setNeighborhood(customer.neighborhood || '');
      setCity(customer.city || '');
      setState(customer.state || '');
      setComplement(customer.complement || '');
      setReference(customer.reference || '');
      setLat(customer.latitude);
      setLng(customer.longitude);
      setGeoPrecisao(null);
      setDistanceKm(customer.distanceKm ?? null);
      setIsWithinRadius(customer.isWithinDeliveryRadius ?? null);
      setCepStatusMessage(null);
    } else {
      setName('');
      setPhone('');
      setCep('');
      setAddress('');
      setNumber('');
      setNeighborhood('');
      setCity('');
      setState('');
      setComplement('');
      setReference('');
      setLat(undefined);
      setLng(undefined);
      setGeoPrecisao(null);
      setDistanceKm(null);
      setIsWithinRadius(null);
      setCepStatusMessage(null);
    }
  }, [customer, isOpen]);

  // Recalculate distance whenever customer lat/lng changes
  useEffect(() => {
    if (
      lat !== undefined &&
      lng !== undefined &&
      settings.storeLatitude !== undefined &&
      settings.storeLongitude !== undefined
    ) {
      const dist = calculateDistanceKm(
        settings.storeLatitude,
        settings.storeLongitude,
        lat,
        lng
      );
      setDistanceKm(dist);
      const maxRadius = settings.deliveryRadiusKm || 5;
      setIsWithinRadius(dist <= maxRadius);
    }
  }, [lat, lng, settings.storeLatitude, settings.storeLongitude, settings.deliveryRadiusKm]);

  if (!isOpen) return null;

  // Format and search CEP
  const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);

    let formatted = val;
    if (val.length > 5) {
      formatted = `${val.slice(0, 5)}-${val.slice(5)}`;
    }
    setCep(formatted);

    // Auto-search when 8 digits are typed
    if (val.length === 8) {
      executeCepSearch(val);
    }
  };

  const executeCepSearch = async (cleanCepArg?: string) => {
    const rawDigits = (cleanCepArg || cep).replace(/\D/g, '');
    if (rawDigits.length !== 8) {
      setCepStatusMessage({
        type: 'warn',
        text: 'Digite um CEP completo com 8 dígitos para consultar.',
      });
      return;
    }

    setIsSearchingCep(true);
    setCepStatusMessage(null);

    try {
      const viaCep = await fetchAddressByCep(rawDigits);
      const brasilApi = await fetchCoordinatesByCepBrasilApi(rawDigits);

      if (!viaCep && !brasilApi) {
        setCepStatusMessage({
          type: 'error',
          text: `CEP ${rawDigits} não encontrado. Verifique se digitou corretamente.`,
        });
        return;
      }

      const logradouro = viaCep?.logradouro || brasilApi?.street || address;
      const bairro = viaCep?.bairro || brasilApi?.neighborhood || neighborhood;
      const localidade = viaCep?.localidade || brasilApi?.city || city;
      const uf = viaCep?.uf || brasilApi?.state || state;

      if (logradouro) setAddress(logradouro);
      if (bairro) setNeighborhood(bairro);
      if (localidade) setCity(localidade);
      if (uf) setState(uf);

      const resolved = await resolveFullAddressOnServer({
        rua: logradouro,
        numero: number.trim(),
        bairro,
        cidade: localidade,
        uf,
        cep: rawDigits,
      });

      if (resolved) {
        setLat(resolved.latitude);
        setLng(resolved.longitude);
        setGeoPrecisao(resolved.precisao);

        if (settings.storeLatitude && settings.storeLongitude) {
          const dist = calculateDistanceKm(
            settings.storeLatitude,
            settings.storeLongitude,
            resolved.latitude,
            resolved.longitude
          );
          setDistanceKm(dist);
          const maxRadius = settings.deliveryRadiusKm || 5;
          const inside = dist <= maxRadius;
          setIsWithinRadius(inside);

          setCepStatusMessage({
            type: resolved.precisao === 'aproximada' ? 'warn' : 'success',
            text: inside
              ? `Endereço localizado! Distância de ${dist} km (DENTRO do raio de ${maxRadius} km).`
              : `Endereço localizado! Distância de ${dist} km (ATENÇÃO: Fora do raio de ${maxRadius} km).`,
          });
        } else {
          setCepStatusMessage({
            type: 'success',
            text: 'Endereço localizado com sucesso!',
          });
        }
      } else {
        setCepStatusMessage({
          type: 'success',
          text: 'Rua e bairro preenchidos com sucesso via CEP!',
        });
      }
    } catch {
      setCepStatusMessage({
        type: 'error',
        text: 'Erro ao consultar o CEP. Verifique sua conexão.',
      });
    } finally {
      setIsSearchingCep(false);
    }
  };

  // When number is modified, refine coordinates via POST /api/geo/resolve
  const handleNumberBlur = async () => {
    const cleanCepDigits = cep.replace(/\D/g, '');
    if (!number.trim() || (!address.trim() && cleanCepDigits.length !== 8)) return;
    try {
      const resolved = await resolveFullAddressOnServer({
        rua: address.trim(),
        numero: number.trim(),
        bairro: neighborhood.trim(),
        cidade: city.trim(),
        uf: state.trim(),
        cep: cleanCepDigits,
      });
      if (resolved) {
        setLat(resolved.latitude);
        setLng(resolved.longitude);
        setGeoPrecisao(resolved.precisao);
      }
    } catch {
      // Ignored
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      alert('Por favor, informe o nome do cliente.');
      return;
    }
    if (!phone.trim()) {
      alert('Por favor, informe o telefone/WhatsApp do cliente.');
      return;
    }
    if (!address.trim()) {
      alert('Por favor, informe a rua ou consulte pelo CEP.');
      return;
    }
    if (!number.trim()) {
      alert('Por favor, informe o número do imóvel.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        id: customer?.id,
        name: name.trim(),
        phone: phone.trim(),
        cep: cep.trim(),
        address: address.trim(),
        number: number.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        complement: complement.trim(),
        reference: reference.trim(),
        latitude: lat,
        longitude: lng,
        distanceKm: distanceKm ?? undefined,
        isWithinDeliveryRadius: isWithinRadius ?? undefined,
      });
      onClose();
    } catch (err) {
      alert('Erro ao salvar o cliente. Tente novamente.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const maxRadiusKm = settings.deliveryRadiusKm || 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden border border-neutral-200 my-8 animate-fade-in">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-6 relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 hover:bg-black/10 rounded-xl text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-2 shadow-inner">
            <User className="w-6 h-6 text-white" />
          </div>

          <h3 className="font-black text-xl">
            {customer ? 'Editar Dados do Cliente' : 'Cadastrar Novo Cliente'}
          </h3>
          <p className="text-xs text-amber-100 mt-1">
            Cadastre o endereço pelo CEP para preenchimento automático e identificação imediata se está no raio de entrega.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {/* 1. Nome e Telefone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-neutral-700 block mb-1">
                Nome Completo do Cliente *
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Ex: João da Silva"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 focus:bg-white outline-none"
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-neutral-700 block mb-1">
                WhatsApp / Celular *
              </label>
              <div className="relative">
                <Phone className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  required
                  placeholder="(11) 98888-7777"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 focus:bg-white outline-none"
                />
              </div>
            </div>
          </div>

          {/* 2. BUSCA POR CEP (Destaque Principal) */}
          <div className="p-4 bg-amber-50/70 border-2 border-amber-300/80 rounded-2xl space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="font-black text-amber-950 flex items-center gap-1.5 text-xs">
                <Building2 className="w-4 h-4 text-amber-600" />
                <span>Cadastrar Endereço por CEP (Automático)</span>
              </label>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-200/80 px-2 py-0.5 rounded-md">
                Preenchimento Rápido
              </span>
            </div>

            <p className="text-[11px] text-amber-900/80">
              Digite o CEP para preencher rua, bairro, cidade e calcular a distância até seu depósito:
            </p>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  maxLength={9}
                  placeholder="00000-000"
                  value={cep}
                  onChange={handleCepChange}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      executeCepSearch();
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl font-mono font-bold text-sm text-neutral-900 focus:border-amber-500 outline-none shadow-2xs"
                />
                {isSearchingCep && (
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>

              <button
                type="button"
                onClick={() => executeCepSearch()}
                disabled={isSearchingCep}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs transition-colors flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
              >
                {isSearchingCep ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>Buscar CEP</span>
              </button>
            </div>

            {/* Status message */}
            {cepStatusMessage && (
              <p
                className={`text-[11px] font-bold flex items-center gap-1.5 p-2 rounded-xl ${
                  cepStatusMessage.type === 'success'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : cepStatusMessage.type === 'warn'
                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                    : 'bg-red-100 text-red-900 border border-red-300'
                }`}
              >
                {cepStatusMessage.type === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                )}
                <span>{cepStatusMessage.text}</span>
              </p>
            )}

            {/* IDENTIFICAÇÃO DO RAIO DE ENTREGA (Feedback Visual) */}
            {distanceKm !== null && (
              <div
                className={`p-3 rounded-xl border flex items-start gap-2.5 transition-all ${
                  isWithinRadius
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-950'
                    : 'bg-red-500/10 border-red-500/30 text-red-950'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 font-black ${
                    isWithinRadius
                      ? 'bg-emerald-500 text-white'
                      : 'bg-red-500 text-white'
                  }`}
                >
                  <Compass className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-xs">
                      {isWithinRadius
                        ? '✓ DENTRO DO RAIO DE ENTREGA'
                        : '⚠️ FORA DO RAIO DE ENTREGA'}
                    </span>
                    <span className="font-mono font-black text-xs">
                      {distanceKm} km da loja
                    </span>
                  </div>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {isWithinRadius
                      ? `Endereço localizado a ${distanceKm} km. O seu depósito atende até ${maxRadiusKm} km.`
                      : `Atenção: Endereço a ${distanceKm} km, além do raio configurado de ${maxRadiusKm} km.`}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 3. Campos de Endereço */}
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-8 sm:col-span-9">
                <label className="font-bold text-neutral-700 block mb-1">
                  Rua / Avenida (Logradouro) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Rua das Flores"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>

              <div className="col-span-4 sm:col-span-3">
                <label className="font-bold text-neutral-700 block mb-1">
                  Número *
                </label>
                <input
                  type="text"
                  required
                  placeholder="123"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  onBlur={handleNumberBlur}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            {lat !== undefined && lng !== undefined && (
              <AddressPinMap
                latitude={lat}
                longitude={lng}
                precisao={geoPrecisao}
                onChange={(newLat, newLng) => {
                  setLat(newLat);
                  setLng(newLng);
                  setGeoPrecisao('exata');
                }}
              />
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Bairro *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Centro"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Cidade
                </label>
                <input
                  type="text"
                  placeholder="Ex: São Paulo"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Estado (UF)
                </label>
                <input
                  type="text"
                  maxLength={2}
                  placeholder="SP"
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium uppercase font-mono focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Complemento / Apto
                </label>
                <input
                  type="text"
                  placeholder="Ex: Apto 42B, Bloco 2"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Ponto de Referência
                </label>
                <input
                  type="text"
                  placeholder="Ex: Em frente à praça, portão preto"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 border-t border-neutral-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold rounded-xl transition-colors cursor-pointer"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>{customer ? 'Salvar Alterações' : 'Cadastrar Cliente'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
