import React, { useState, useEffect } from 'react';
import { CustomerProfile, DeliveryArea, StoreSettings } from '../../types';
import { api } from '../../services/api';
import {
  User,
  Phone,
  MapPin,
  X,
  ArrowRight,
  CheckCircle2,
  Building2,
  Search,
  Loader2,
  Compass,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchAddressByCep,
  fetchCoordinatesByCepBrasilApi,
  calculateDistanceKm,
  geocodeAddress,
} from '../../utils/geo';

interface CustomerAuthModalProps {
  isOpen: boolean;
  deliveryAreas: DeliveryArea[];
  currentCustomer: CustomerProfile | null;
  settings?: StoreSettings;
  onSuccess: (cust: CustomerProfile) => void;
  onClose: () => void;
}

export const CustomerAuthModal: React.FC<CustomerAuthModalProps> = ({
  isOpen,
  deliveryAreas,
  currentCustomer,
  settings,
  onSuccess,
  onClose,
}) => {
  const [tab, setTab] = useState<'login' | 'cadastro'>(currentCustomer ? 'cadastro' : 'login');

  // Login by phone
  const [phoneSearch, setPhoneSearch] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  // Register form
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

  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [isWithinRadius, setIsWithinRadius] = useState<boolean | null>(null);

  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepStatusMessage, setCepStatusMessage] = useState<{
    type: 'success' | 'warn' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (currentCustomer) {
      setName(currentCustomer.name || '');
      setPhone(currentCustomer.phone || '');
      setCep(currentCustomer.cep || '');
      setAddress(currentCustomer.address || '');
      setNumber(currentCustomer.number || '');
      setNeighborhood(currentCustomer.neighborhood || (deliveryAreas[0]?.name || ''));
      setCity(currentCustomer.city || '');
      setState(currentCustomer.state || '');
      setComplement(currentCustomer.complement || '');
      setReference(currentCustomer.reference || '');
      setLat(currentCustomer.latitude);
      setLng(currentCustomer.longitude);
      setDistanceKm(currentCustomer.distanceKm ?? null);
      setIsWithinRadius(currentCustomer.isWithinDeliveryRadius ?? null);
    } else {
      setName('');
      setPhone('');
      setCep('');
      setAddress('');
      setNumber('');
      setNeighborhood(deliveryAreas[0]?.name || '');
      setCity('');
      setState('');
      setComplement('');
      setReference('');
      setLat(undefined);
      setLng(undefined);
      setDistanceKm(null);
      setIsWithinRadius(null);
    }
  }, [currentCustomer, isOpen, deliveryAreas]);

  if (!isOpen) return null;

  const handlePhoneLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneSearch.trim()) return;

    const found = api.findCustomerByPhone(phoneSearch);
    if (found) {
      api.setCurrentCustomer(found);
      onSuccess(found);
    } else {
      setLoginError('Telefone não encontrado. Cadastre-se abaixo rapidamente em 1 minuto!');
      setPhone(phoneSearch);
      setTab('cadastro');
    }
  };

  const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);

    let formatted = val;
    if (val.length > 5) {
      formatted = `${val.slice(0, 5)}-${val.slice(5)}`;
    }
    setCep(formatted);

    if (val.length === 8) {
      executeCepSearch(val);
    }
  };

  const executeCepSearch = async (cleanCepArg?: string) => {
    const rawDigits = (cleanCepArg || cep).replace(/\D/g, '');
    if (rawDigits.length !== 8) {
      setCepStatusMessage({
        type: 'warn',
        text: 'Digite um CEP completo com 8 dígitos.',
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
          text: `CEP ${rawDigits} não encontrado. Verifique os números digitados.`,
        });
        return;
      }

      const logradouro = viaCep?.logradouro || brasilApi?.street || '';
      const bairro = viaCep?.bairro || brasilApi?.neighborhood || '';
      const localidade = viaCep?.localidade || brasilApi?.city || '';
      const uf = viaCep?.uf || brasilApi?.state || '';

      if (logradouro) setAddress(logradouro);
      if (bairro) setNeighborhood(bairro);
      if (localidade) setCity(localidade);
      if (uf) setState(uf);

      let foundLat = brasilApi?.lat;
      let foundLng = brasilApi?.lng;

      if ((foundLat === undefined || foundLng === undefined) && (logradouro || bairro || localidade)) {
        const query = `${logradouro} ${bairro} ${localidade} ${uf} Brasil`;
        const geo = await geocodeAddress(query);
        if (geo) {
          foundLat = geo.lat;
          foundLng = geo.lng;
        }
      }

      if (foundLat !== undefined && foundLng !== undefined) {
        setLat(foundLat);
        setLng(foundLng);

        if (settings?.storeLatitude && settings?.storeLongitude) {
          const dist = calculateDistanceKm(
            settings.storeLatitude,
            settings.storeLongitude,
            foundLat,
            foundLng
          );
          setDistanceKm(dist);
          const maxRadius = settings.deliveryRadiusKm || 5;
          const inside = dist <= maxRadius;
          setIsWithinRadius(inside);

          setCepStatusMessage({
            type: 'success',
            text: inside
              ? `Endereço localizado! Distância de ${dist} km (Dentro do raio de entrega de ${maxRadius} km).`
              : `Atenção: Endereço a ${dist} km, além do raio de entrega de ${maxRadius} km.`,
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
        text: 'Erro ao consultar o CEP.',
      });
    } finally {
      setIsSearchingCep(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !address.trim() || !number.trim() || !neighborhood.trim()) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    const saved = await api.saveCustomerProfile({
      id: currentCustomer?.id,
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

    onSuccess(saved);
  };

  const maxRadiusKm = settings?.deliveryRadiusKm || 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200 my-6">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 hover:bg-black/10 rounded-lg text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-2">
            <User className="w-6 h-6 text-white" />
          </div>

          <h3 className="font-black text-xl">
            {currentCustomer ? 'Meu Cadastro de Entrega' : 'Acesse ou Cadastre-se'}
          </h3>
          <p className="text-xs text-amber-100 mt-1">
            Cadastre seu endereço pelo CEP para entrega rápida e segura no seu endereço.
          </p>

          {/* Tab selector */}
          {!currentCustomer && (
            <div className="flex bg-black/20 p-1 rounded-xl mt-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => setTab('login')}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  tab === 'login' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-100 hover:text-white'
                }`}
              >
                Já sou Cliente
              </button>
              <button
                type="button"
                onClick={() => setTab('cadastro')}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  tab === 'cadastro' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-100 hover:text-white'
                }`}
              >
                Primeiro Pedido (Cadastrar)
              </button>
            </div>
          )}
        </div>

        {/* Tab 1: Phone Login */}
        {tab === 'login' && !currentCustomer ? (
          <form onSubmit={handlePhoneLogin} className="p-6 space-y-4">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Digite seu número de WhatsApp / Celular
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="tel"
                  required
                  placeholder="(11) 99999-8888"
                  value={phoneSearch}
                  onChange={(e) => {
                    setPhoneSearch(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl text-sm font-semibold"
                />
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">
                Localizaremos seu endereço salvo automaticamente.
              </p>
            </div>

            {loginError && (
              <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Continuar</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          /* Tab 2: Register / Edit Profile */
          <form onSubmit={handleRegister} className="p-6 space-y-3.5 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Seu Nome *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João da Silva"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>
              <div>
                <label className="font-bold text-neutral-700 block mb-1">WhatsApp / Celular *</label>
                <input
                  type="tel"
                  required
                  placeholder="(11) 98888-7777"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>
            </div>

            {/* CEP SEARCH SECTION */}
            <div className="p-3.5 bg-amber-50/70 border-2 border-amber-300/80 rounded-2xl space-y-2">
              <label className="font-black text-amber-950 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-amber-600" />
                  <span>Cadastrar Endereço por CEP</span>
                </span>
                <span className="text-[10px] text-amber-800 font-bold">Auto-completar</span>
              </label>

              <div className="flex gap-1.5">
                <input
                  type="text"
                  maxLength={9}
                  placeholder="00000-000"
                  value={cep}
                  onChange={handleCepChange}
                  className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl font-mono font-bold text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => executeCepSearch()}
                  disabled={isSearchingCep}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  {isSearchingCep ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Buscar</span>
                </button>
              </div>

              {cepStatusMessage && (
                <p className={`text-[10px] font-bold p-1.5 rounded-lg ${
                  cepStatusMessage.type === 'success' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
                }`}>
                  {cepStatusMessage.text}
                </p>
              )}

              {distanceKm !== null && (
                <div className={`p-2 rounded-xl text-[11px] font-bold flex items-center gap-1.5 border ${
                  isWithinRadius
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                    : 'bg-red-50 text-red-800 border-red-300'
                }`}>
                  <Compass className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isWithinRadius
                      ? `Dentro da área de entrega! (${distanceKm} km do depósito)`
                      : `Atenção: A ${distanceKm} km do depósito (raio de ${maxRadiusKm} km).`}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="font-bold text-neutral-700 block mb-1">Rua / Avenida *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Rua das Flores"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Número *</label>
                  <input
                    type="text"
                    required
                    placeholder="123"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Bairro *</label>
                  <input
                    type="text"
                    placeholder="Ex: Centro"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Complemento</label>
                  <input
                    type="text"
                    placeholder="Apto 42B"
                    value={complement}
                    onChange={(e) => setComplement(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Ponto de Referência</label>
                <input
                  type="text"
                  placeholder="Ex: Em frente à padaria, portão branco"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Salvar Cadastro e Continuar</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
