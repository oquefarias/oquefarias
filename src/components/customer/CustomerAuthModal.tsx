import React, { useState, useEffect } from 'react';
import { CustomerProfile, DeliveryArea, StoreSettings } from '../../types';
import { api } from '../../services/api';
import {
  User,
  Phone,
  Mail,
  Lock,
  MapPin,
  X,
  ArrowRight,
  CheckCircle2,
  Building2,
  Search,
  Loader2,
  Compass,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import {
  fetchAddressByCep,
  fetchCoordinatesByCepBrasilApi,
  calculateDistanceKm,
  resolveFullAddressOnServer,
} from '../../utils/geo';
import { AddressPinMap } from '../AddressPinMap';

interface CustomerAuthModalProps {
  isOpen: boolean;
  deliveryAreas: DeliveryArea[];
  currentCustomer: CustomerProfile | null;
  settings?: StoreSettings;
  onSuccess: (cust: CustomerProfile) => void;
  onClose: () => void;
  onLogout?: () => void;
}

export const CustomerAuthModal: React.FC<CustomerAuthModalProps> = ({
  isOpen,
  deliveryAreas,
  currentCustomer,
  settings,
  onSuccess,
  onClose,
  onLogout,
}) => {
  const [tab, setTab] = useState<'login' | 'cadastro' | 'perfil'>('login');

  // Login form
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');
  const [isLoadingLogin, setIsLoadingLogin] = useState<boolean>(false);

  // Register / Edit form
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
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
  const [geoPrecisao, setGeoPrecisao] = useState<string | null>(null);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [isWithinRadius, setIsWithinRadius] = useState<boolean | null>(null);

  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepStatusMessage, setCepStatusMessage] = useState<{
    type: 'success' | 'warn' | 'error';
    text: string;
  } | null>(null);
  const [registerError, setRegisterError] = useState<string>('');
  const [isSubmittingRegister, setIsSubmittingRegister] = useState<boolean>(false);

  useEffect(() => {
    if (currentCustomer) {
      setTab('perfil');
      setName(currentCustomer.name || '');
      setEmail(currentCustomer.email || '');
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
      setGeoPrecisao(null);
      setDistanceKm(currentCustomer.distanceKm ?? null);
      setIsWithinRadius(currentCustomer.isWithinDeliveryRadius ?? null);
    } else {
      setTab('login');
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setConfirmPassword('');
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
      setGeoPrecisao(null);
      setDistanceKm(null);
      setIsWithinRadius(null);
      setLoginError('');
      setRegisterError('');
    }
  }, [currentCustomer, isOpen, deliveryAreas]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError('Preencha seu e-mail e senha.');
      return;
    }

    setIsLoadingLogin(true);
    setLoginError('');
    try {
      const res = await api.loginCustomer(loginEmail, loginPassword);
      if (res.success && res.customer) {
        onSuccess(res.customer);
      } else {
        setLoginError(res.error || 'E-mail ou senha incorretos.');
      }
    } catch {
      setLoginError('Servidor indisponível. Tente novamente em instantes.');
    } finally {
      setIsLoadingLogin(false);
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

  const updateCoordinatesAndDistance = (newLat: number, newLng: number, precisaoVal?: string | null) => {
    setLat(newLat);
    setLng(newLng);
    if (precisaoVal !== undefined) {
      setGeoPrecisao(precisaoVal);
    }
    if (settings?.storeLatitude !== undefined && settings?.storeLongitude !== undefined) {
      const dist = calculateDistanceKm(
        settings.storeLatitude,
        settings.storeLongitude,
        newLat,
        newLng
      );
      setDistanceKm(dist);
      const maxRadius = settings.deliveryRadiusKm || 5;
      const inside = dist <= maxRadius;
      setIsWithinRadius(inside);
    }
  };

  const executeServerGeoResolve = async (params: {
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
    cep: string;
  }) => {
    const resolved = await resolveFullAddressOnServer(params);
    if (resolved) {
      updateCoordinatesAndDistance(resolved.latitude, resolved.longitude, resolved.precisao);
      if (settings?.storeLatitude !== undefined && settings?.storeLongitude !== undefined) {
        const dist = calculateDistanceKm(
          settings.storeLatitude,
          settings.storeLongitude,
          resolved.latitude,
          resolved.longitude
        );
        const maxRadius = settings.deliveryRadiusKm || 5;
        const inside = dist <= maxRadius;
        setCepStatusMessage({
          type: resolved.precisao === 'aproximada' ? 'warn' : 'success',
          text: inside
            ? `Endereço localizado! Distância de ${dist} km (Dentro do raio de entrega de ${maxRadius} km).`
            : `Atenção: Endereço a ${dist} km, além do raio de entrega de ${maxRadius} km.`,
        });
      }
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
        updateCoordinatesAndDistance(resolved.latitude, resolved.longitude, resolved.precisao);
        if (settings?.storeLatitude !== undefined && settings?.storeLongitude !== undefined) {
          const dist = calculateDistanceKm(
            settings.storeLatitude,
            settings.storeLongitude,
            resolved.latitude,
            resolved.longitude
          );
          const maxRadius = settings.deliveryRadiusKm || 5;
          const inside = dist <= maxRadius;
          setCepStatusMessage({
            type: resolved.precisao === 'aproximada' ? 'warn' : 'success',
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

  const handleNumberBlur = async () => {
    const cleanCepDigits = cep.replace(/\D/g, '');
    if (!address.trim() && cleanCepDigits.length !== 8) return;
    if (!number.trim()) return;

    setIsSearchingCep(true);
    try {
      await executeServerGeoResolve({
        rua: address.trim(),
        numero: number.trim(),
        bairro: neighborhood.trim(),
        cidade: city.trim(),
        uf: state.trim(),
        cep: cleanCepDigits,
      });
    } finally {
      setIsSearchingCep(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');

    if (!name.trim() || !email.trim() || !phone.trim() || !address.trim() || !number.trim() || !neighborhood.trim()) {
      setRegisterError('Por favor, preencha todos os campos obrigatórios (*).');
      return;
    }

    if (!email.includes('@')) {
      setRegisterError('Digite um e-mail válido.');
      return;
    }

    if (password.length < 8) {
      setRegisterError('A senha deve conter no mínimo 8 caracteres.');
      return;
    }

    if (password !== confirmPassword) {
      setRegisterError('As senhas não coincidem. Digite novamente.');
      return;
    }

    setIsSubmittingRegister(true);
    try {
      let finalLat = lat;
      let finalLng = lng;
      if (finalLat === undefined || finalLng === undefined) {
        const resolved = await resolveFullAddressOnServer({
          rua: address.trim(),
          numero: number.trim(),
          bairro: neighborhood.trim(),
          cidade: city.trim(),
          uf: state.trim(),
          cep: cep.replace(/\D/g, ''),
        });
        if (resolved) {
          finalLat = resolved.latitude;
          finalLng = resolved.longitude;
        }
      }

      const saved = await api.registerCustomer({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        cep: cep.trim(),
        address: address.trim(),
        number: number.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        complement: complement.trim(),
        reference: reference.trim(),
        latitude: finalLat,
        longitude: finalLng,
      });

      if (saved?.id) {
        api.markCustomerPinConfirmed(saved.id);
      }
      onSuccess(saved);
    } catch (err: any) {
      setRegisterError(err.message || 'Erro ao realizar cadastro.');
    } finally {
      setIsSubmittingRegister(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');

    if (!name.trim() || !phone.trim() || !address.trim() || !number.trim() || !neighborhood.trim()) {
      setRegisterError('Preencha os campos obrigatórios (*).');
      return;
    }

    if (password && password.length < 8) {
      setRegisterError('A nova senha deve ter no mínimo 8 caracteres.');
      return;
    }

    setIsSubmittingRegister(true);
    try {
      let finalLat = lat;
      let finalLng = lng;
      if (finalLat === undefined || finalLng === undefined) {
        const resolved = await resolveFullAddressOnServer({
          rua: address.trim(),
          numero: number.trim(),
          bairro: neighborhood.trim(),
          cidade: city.trim(),
          uf: state.trim(),
          cep: cep.replace(/\D/g, ''),
        });
        if (resolved) {
          finalLat = resolved.latitude;
          finalLng = resolved.longitude;
        }
      }

      const updated = await api.updateCustomerMe({
        name: name.trim(),
        phone: phone.trim(),
        password: password ? password : undefined,
        cep: cep.trim(),
        address: address.trim(),
        number: number.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        complement: complement.trim(),
        reference: reference.trim(),
        latitude: finalLat,
        longitude: finalLng,
      });

      if (updated?.id) {
        api.markCustomerPinConfirmed(updated.id);
      }
      onSuccess(updated);
    } catch (err: any) {
      setRegisterError(err.message || 'Erro ao atualizar dados.');
    } finally {
      setIsSubmittingRegister(false);
    }
  };

  const handleLogoutClick = () => {
    api.logoutCustomer();
    if (onLogout) onLogout();
    onClose();
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
            {currentCustomer ? 'Minha Conta de Entrega' : 'Identifique-se para Comprar'}
          </h3>
          <p className="text-xs text-amber-100 mt-1">
            {currentCustomer
              ? 'Visualize ou atualize seus dados de entrega.'
              : 'Faça login ou crie sua conta para finalizar seus pedidos com segurança.'}
          </p>

          {/* Tab selector */}
          {!currentCustomer ? (
            <div className="flex bg-black/20 p-1 rounded-xl mt-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setLoginError('');
                }}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  tab === 'login' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-100 hover:text-white'
                }`}
              >
                Já tenho Conta (Entrar)
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('cadastro');
                  setRegisterError('');
                }}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  tab === 'cadastro' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-100 hover:text-white'
                }`}
              >
                Criar Nova Conta
              </button>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between text-xs bg-black/15 px-3 py-1.5 rounded-xl">
              <span className="font-medium text-amber-100">Logado como: <strong className="text-white">{currentCustomer.name}</strong></span>
              <button
                type="button"
                onClick={handleLogoutClick}
                className="text-white font-bold flex items-center gap-1 hover:underline cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sair</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab 1: Email + Password Login */}
        {tab === 'login' && !currentCustomer && (
          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                E-mail
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="email"
                  required
                  placeholder="seu@email.com"
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl text-sm font-semibold outline-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                Senha
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  className="w-full pl-9 pr-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl text-sm font-semibold outline-amber-500"
                />
              </div>
            </div>

            {loginError && (
              <p className="text-xs text-red-800 bg-red-50 p-2.5 rounded-xl border border-red-200 font-medium">
                {loginError}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoadingLogin}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoadingLogin ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                <>
                  <span>Entrar na Minha Conta</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setTab('cadastro')}
                className="text-xs text-amber-700 hover:text-amber-800 font-bold hover:underline cursor-pointer"
              >
                Primeira vez aqui? Crie sua conta em 1 minuto →
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: Register (New Customer) OR Tab 3: Edit Profile */}
        {(tab === 'cadastro' || tab === 'perfil') && (
          <form
            onSubmit={tab === 'perfil' ? handleUpdateProfile : handleRegister}
            className="p-6 space-y-3 text-xs max-h-[75vh] overflow-y-auto"
          >
            {registerError && (
              <p className="text-xs text-red-800 bg-red-50 p-2.5 rounded-xl border border-red-200 font-bold">
                {registerError}
              </p>
            )}

            <div className="space-y-3">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Nome Completo *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: João da Silva"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">E-mail *</label>
                  <input
                    type="email"
                    required
                    disabled={tab === 'perfil'}
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 disabled:bg-neutral-100 border border-neutral-300 rounded-xl"
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

              {/* Password inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    {tab === 'perfil' ? 'Nova Senha (opcional)' : 'Senha (mínimo 8 dígitos) *'}
                  </label>
                  <input
                    type="password"
                    required={tab === 'cadastro'}
                    placeholder="Mínimo 8 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                {tab === 'cadastro' && (
                  <div>
                    <label className="font-bold text-neutral-700 block mb-1">Confirmar Senha *</label>
                    <input
                      type="password"
                      required
                      placeholder="Repita a senha"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* CEP SEARCH SECTION */}
            <div className="p-3 bg-amber-50/80 border-2 border-amber-300/80 rounded-2xl space-y-2 mt-2">
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
                  <label className="font-bold text-neutral-700 block mb-1">Rua / Logradouro *</label>
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
                    onBlur={handleNumberBlur}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {lat !== undefined && lng !== undefined && (
                <AddressPinMap
                  latitude={lat}
                  longitude={lng}
                  precisao={geoPrecisao}
                  onChange={(newLat, newLng) => {
                    updateCoordinatesAndDistance(newLat, newLng, 'exata');
                  }}
                />
              )}

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

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="font-bold text-neutral-700 block mb-1">Cidade</label>
                  <input
                    type="text"
                    placeholder="São Paulo"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">UF</label>
                  <input
                    type="text"
                    maxLength={2}
                    placeholder="SP"
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl uppercase font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Ponto de Referência</label>
                <input
                  type="text"
                  placeholder="Ex: Em frente à padaria, portão preto"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmittingRegister}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmittingRegister ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Salvando...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{tab === 'perfil' ? 'Atualizar Dados' : 'Criar Minha Conta e Continuar'}</span>
                  </>
                )}
              </button>
            </div>

            {tab === 'cadastro' && (
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={() => setTab('login')}
                  className="text-xs text-neutral-500 hover:text-neutral-800 font-bold hover:underline cursor-pointer"
                >
                  Já possui uma conta? Faça login aqui
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    </div>
  );
};
