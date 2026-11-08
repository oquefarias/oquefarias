import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  CustomerProfile,
  DeliveryArea,
  StoreSettings,
  getActiveDeliveryAreasSorted,
  findMatchingActiveDeliveryArea,
  formatDeliveryAreaOptionLabel,
} from '../../types';
import { api } from '../../services/api';
import {
  User,
  Mail,
  Lock,
  X,
  ArrowRight,
  CheckCircle2,
  Building2,
  Search,
  Loader2,
  LogOut,
  Eye,
  EyeOff,
  MessageCircle,
} from 'lucide-react';
import { fetchAddressByCep } from '../../utils/geo';

export interface InitialRegisterData {
  name?: string;
  email?: string;
  phone?: string;
  cep?: string;
  address?: string;
  number?: string;
  neighborhood?: string;
  deliveryAreaId?: string;
  city?: string;
  state?: string;
  complement?: string;
  reference?: string;
  latitude?: number;
  longitude?: number;
}

interface CustomerAuthModalProps {
  isOpen: boolean;
  deliveryAreas: DeliveryArea[];
  currentCustomer: CustomerProfile | null;
  settings?: StoreSettings;
  initialRegisterData?: InitialRegisterData;
  initialTab?: 'login' | 'cadastro';
  onSuccess: (cust: CustomerProfile) => void;
  onClose: () => void;
  onLogout?: () => void;
}

export const CustomerAuthModal: React.FC<CustomerAuthModalProps> = ({
  isOpen,
  deliveryAreas,
  currentCustomer,
  settings,
  initialRegisterData,
  initialTab,
  onSuccess,
  onClose,
  onLogout,
}) => {
  const [tab, setTab] = useState<'login' | 'cadastro' | 'perfil'>('login');

  // Login form
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [showLoginPassword, setShowLoginPassword] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string>('');
  const [isLoadingLogin, setIsLoadingLogin] = useState<boolean>(false);

  // Register / Edit form
  const [name, setName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);
  const [cep, setCep] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [number, setNumber] = useState<string>('');
  const [selectedAreaId, setSelectedAreaId] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [complement, setComplement] = useState<string>('');
  const [reference, setReference] = useState<string>('');

  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepStatusMessage, setCepStatusMessage] = useState<{
    type: 'success' | 'warn';
    text: string;
  } | null>(null);
  const [registerError, setRegisterError] = useState<string>('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [alreadyRegisteredField, setAlreadyRegisteredField] = useState<'email' | 'phone' | null>(null);
  const [isSubmittingRegister, setIsSubmittingRegister] = useState<boolean>(false);

  const activeAreasSorted = useMemo(
    () => getActiveDeliveryAreasSorted(deliveryAreas),
    [deliveryAreas]
  );

  // Field refs for scrolling & focusing first invalid input
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordInputRef = useRef<HTMLInputElement | null>(null);
  const cepInputRef = useRef<HTMLInputElement | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);
  const numberInputRef = useRef<HTMLInputElement | null>(null);
  const neighborhoodSelectRef = useRef<HTMLSelectElement | null>(null);

  const fieldRefs: Record<string, React.RefObject<HTMLElement | null>> = {
    name: nameInputRef,
    email: emailInputRef,
    phone: phoneInputRef,
    password: passwordInputRef,
    confirmPassword: confirmPasswordInputRef,
    cep: cepInputRef,
    address: addressInputRef,
    number: numberInputRef,
    neighborhood: neighborhoodSelectRef,
  };

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (
      (field === 'email' && alreadyRegisteredField === 'email') ||
      (field === 'phone' && alreadyRegisteredField === 'phone')
    ) {
      setAlreadyRegisteredField(null);
    }
  };

  const focusFirstErrorField = (errors: Record<string, string>) => {
    const order = [
      'name',
      'email',
      'phone',
      'password',
      'confirmPassword',
      'cep',
      'address',
      'number',
      'neighborhood',
    ];
    for (const key of order) {
      if (errors[key]) {
        const el = fieldRefs[key]?.current;
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setTimeout(() => {
            el.focus();
          }, 50);
        }
        break;
      }
    }
  };

  useEffect(() => {
    setFieldErrors({});
    setAlreadyRegisteredField(null);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setShowLoginPassword(false);
    setIsLoadingLogin(false);
    setIsSubmittingRegister(false);

    if (currentCustomer) {
      setTab('perfil');
      setName(currentCustomer.name || '');
      setEmail(currentCustomer.email || '');
      setPhone(currentCustomer.phone || '');
      setPassword('');
      setConfirmPassword('');
      setCep(currentCustomer.cep || '');
      setAddress(currentCustomer.address || '');
      setNumber(currentCustomer.number || '');
      const matched = findMatchingActiveDeliveryArea(
        activeAreasSorted,
        currentCustomer.neighborhood
      );
      setSelectedAreaId(matched ? matched.id : '');
      setCity(currentCustomer.city || '');
      setState(currentCustomer.state || '');
      setComplement(currentCustomer.complement || '');
      setReference(currentCustomer.reference || '');
      setRegisterError('');
      setCepStatusMessage(null);
    } else {
      const hasPrefilledData = Boolean(
        initialRegisterData &&
          (initialRegisterData.name?.trim() ||
            initialRegisterData.phone?.trim() ||
            initialRegisterData.address?.trim() ||
            initialRegisterData.cep?.trim())
      );
      setTab(initialTab || (hasPrefilledData ? 'cadastro' : 'login'));
      setName(initialRegisterData?.name || '');
      setEmail(initialRegisterData?.email || '');
      setPhone(initialRegisterData?.phone || '');
      setPassword('');
      setConfirmPassword('');
      setCep(initialRegisterData?.cep || '');
      setAddress(initialRegisterData?.address || '');
      setNumber(initialRegisterData?.number || '');

      let initialAreaId = '';
      if (
        initialRegisterData?.deliveryAreaId &&
        activeAreasSorted.some((a) => a.id === initialRegisterData.deliveryAreaId)
      ) {
        initialAreaId = initialRegisterData.deliveryAreaId;
      } else if (initialRegisterData?.neighborhood) {
        const matched = findMatchingActiveDeliveryArea(
          activeAreasSorted,
          initialRegisterData.neighborhood
        );
        if (matched) initialAreaId = matched.id;
      }
      setSelectedAreaId(initialAreaId);

      setCity(initialRegisterData?.city || '');
      setState(initialRegisterData?.state || '');
      setComplement(initialRegisterData?.complement || '');
      setReference(initialRegisterData?.reference || '');
      setLoginError('');
      setRegisterError('');
      setCepStatusMessage(null);
    }
  }, [currentCustomer, isOpen, activeAreasSorted, initialTab]);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginError('Preencha seu e-mail/WhatsApp e senha.');
      return;
    }

    setIsLoadingLogin(true);
    setLoginError('');
    try {
      const res = await api.loginCustomer(loginEmail, loginPassword);
      if (res.success && res.customer) {
        setIsLoadingLogin(false);
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
    clearFieldError('cep');

    if (val.length === 8) {
      executeCepSearch(val);
    }
  };

  const executeCepSearch = async (cleanCepArg?: string) => {
    const rawDigits = (cleanCepArg || cep).replace(/\D/g, '');
    if (rawDigits.length !== 8) {
      return;
    }

    setIsSearchingCep(true);
    setCepStatusMessage(null);

    try {
      const viaCep = await fetchAddressByCep(rawDigits);
      if (!viaCep) {
        setCepStatusMessage({
          type: 'warn',
          text: 'Não foi possível buscar pelo CEP. Preencha a rua e escolha seu bairro abaixo.',
        });
        return;
      }

      if (viaCep.logradouro) {
        setAddress(viaCep.logradouro);
        clearFieldError('address');
      }
      if (viaCep.localidade) setCity(viaCep.localidade);
      if (viaCep.uf) setState(viaCep.uf);

      if (viaCep.bairro) {
        const matched = findMatchingActiveDeliveryArea(activeAreasSorted, viaCep.bairro);
        if (matched) {
          setSelectedAreaId(matched.id);
          clearFieldError('neighborhood');
          setCepStatusMessage({
            type: 'success',
            text: `Rua e bairro (${matched.name}) preenchidos pelo CEP!`,
          });
          return;
        }
      }

      setCepStatusMessage({
        type: 'success',
        text: 'Rua preenchida pelo CEP! Agora escolha seu bairro na lista abaixo.',
      });
    } catch {
      // Se falhar, segue normal sem travar (1b)
    } finally {
      setIsSearchingCep(false);
    }
  };

  const validateFields = (isProfile: boolean): boolean => {
    const errors: Record<string, string> = {};

    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) {
      errors.name = 'Informe seu nome completo (2 a 80 caracteres).';
    }

    if (!isProfile) {
      const cleanMail = email.trim();
      if (cleanMail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanMail)) {
        errors.email = 'Digite um e-mail válido.';
      }
    }

    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 13) {
      errors.phone = 'Telefone inválido. Digite DDD + número (ex: 11 98888-7777).';
    }

    if (!isProfile) {
      if (password.length < 8) {
        errors.password = 'Mínimo 8 caracteres';
      }
      if (!confirmPassword || password !== confirmPassword) {
        errors.confirmPassword = 'As senhas não são iguais';
      }
    } else if (password) {
      if (password.length < 8) {
        errors.password = 'Mínimo 8 caracteres';
      }
      if (confirmPassword && password !== confirmPassword) {
        errors.confirmPassword = 'As senhas não são iguais';
      }
    }

    const cepDigits = cep.replace(/\D/g, '');
    if (cep.trim().length > 0 && cepDigits.length !== 8) {
      errors.cep = 'Digite os 8 números do CEP ou deixe em branco.';
    }

    const cleanAddress = address.trim();
    if (cleanAddress.length < 2 || cleanAddress.length > 120) {
      errors.address = 'Informe a rua (entre 2 e 120 caracteres).';
    }

    const cleanNumber = number.trim();
    if (cleanNumber.length < 1 || cleanNumber.length > 20) {
      errors.number = 'Informe o número (entre 1 e 20 caracteres).';
    }

    const chosenArea = activeAreasSorted.find((a) => a.id === selectedAreaId);
    if (!chosenArea) {
      errors.neighborhood = 'Escolha um bairro da lista de entrega.';
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstErrorField(errors);
      return false;
    }
    return true;
  };

  const mapServerErrorToFields = (msg: string) => {
    const lower = msg.toLowerCase();
    const mapped: Record<string, string> = {};

    if (lower.includes('e-mail') || lower.includes('email')) {
      mapped.email = msg;
      if (lower.includes('cadastrado') || lower.includes('existe')) {
        setAlreadyRegisteredField('email');
      }
    } else if (lower.includes('telefone') || lower.includes('whatsapp') || lower.includes('celular')) {
      mapped.phone = msg;
      if (lower.includes('cadastrado') || lower.includes('existe')) {
        setAlreadyRegisteredField('phone');
      }
    } else if (lower.includes('senha')) {
      mapped.password = msg;
    } else if (lower.includes('cep')) {
      mapped.cep = msg;
    } else if (lower.includes('número') || lower.includes('numero')) {
      mapped.number = msg;
    } else if (lower.includes('bairro')) {
      mapped.neighborhood = msg;
    } else if (lower.includes('rua') || lower.includes('endereço') || lower.includes('endereco')) {
      mapped.address = msg;
    }

    if (Object.keys(mapped).length > 0) {
      setFieldErrors((prev) => ({ ...prev, ...mapped }));
      focusFirstErrorField(mapped);
    } else {
      setRegisterError(msg);
    }
  };

  const handleSwitchToLoginWithEmail = () => {
    if (email.trim()) {
      setLoginEmail(email.trim());
    } else if (phone.trim()) {
      setLoginEmail(phone.trim());
    }
    setFieldErrors({});
    setRegisterError('');
    setAlreadyRegisteredField(null);
    setTab('login');
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    setAlreadyRegisteredField(null);

    if (!validateFields(false)) {
      return;
    }

    const chosenArea = activeAreasSorted.find((a) => a.id === selectedAreaId);
    if (!chosenArea) {
      setFieldErrors((prev) => ({ ...prev, neighborhood: 'Escolha um bairro da lista de entrega.' }));
      return;
    }

    setIsSubmittingRegister(true);
    try {
      const saved = await api.registerCustomer({
        name: name.trim(),
        email: email.trim() ? email.trim().toLowerCase() : undefined,
        phone: phone.trim(),
        password,
        cep: cep.trim() || undefined,
        address: address.trim(),
        number: number.trim(),
        neighborhood: chosenArea.name,
        deliveryAreaId: chosenArea.id,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        complement: complement.trim() || undefined,
        reference: reference.trim() || undefined,
      });

      setIsSubmittingRegister(false);
      onSuccess(saved);
    } catch (err: any) {
      mapServerErrorToFields(err.message || 'Erro ao realizar cadastro.');
    } finally {
      setIsSubmittingRegister(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');
    setAlreadyRegisteredField(null);

    if (!validateFields(true)) {
      return;
    }

    const chosenArea = activeAreasSorted.find((a) => a.id === selectedAreaId);
    if (!chosenArea) {
      setFieldErrors((prev) => ({ ...prev, neighborhood: 'Escolha um bairro da lista de entrega.' }));
      return;
    }

    setIsSubmittingRegister(true);
    try {
      const updated = await api.updateCustomerMe({
        name: name.trim(),
        phone: phone.trim(),
        password: password ? password : undefined,
        cep: cep.trim() || undefined,
        address: address.trim(),
        number: number.trim(),
        neighborhood: chosenArea.name,
        deliveryAreaId: chosenArea.id,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        complement: complement.trim() || undefined,
        reference: reference.trim() || undefined,
      });

      setIsSubmittingRegister(false);
      onSuccess(updated);
    } catch (err: any) {
      mapServerErrorToFields(err.message || 'Erro ao atualizar dados.');
    } finally {
      setIsSubmittingRegister(false);
    }
  };

  const handleLogoutClick = () => {
    api.logoutCustomer();
    if (onLogout) onLogout();
    onClose();
  };

  const storeWhatsappDigits = (settings?.whatsapp || '').replace(/\D/g, '');
  const storeWhatsappUrl = storeWhatsappDigits
    ? `https://wa.me/${storeWhatsappDigits.startsWith('55') ? storeWhatsappDigits : `55${storeWhatsappDigits}`}`
    : null;

  const getInputClass = (field: string, extra = '') =>
    `w-full px-3 py-2 rounded-xl border transition-colors outline-none ${
      fieldErrors[field]
        ? 'border-red-500 bg-red-50/40 focus:border-red-600'
        : 'bg-neutral-50 border-neutral-300 focus:border-amber-500'
    } ${extra}`;

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
            {currentCustomer ? 'Minha Conta / Endereço' : 'Identifique-se para Comprar'}
          </h3>
          <p className="text-xs text-amber-100 mt-1">
            {currentCustomer
              ? 'Visualize ou atualize seus dados e bairro de entrega.'
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
                  setFieldErrors({});
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
              <span className="font-medium text-amber-100">
                Logado como: <strong className="text-white">{currentCustomer.name}</strong>
              </span>
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

        {/* Tab 1: Email/WhatsApp + Password Login */}
        {tab === 'login' && !currentCustomer && (
          <form onSubmit={handleLogin} className="p-6 space-y-4">
            <div>
              <label className="text-xs font-bold text-neutral-700 block mb-1">
                E-mail ou WhatsApp
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  required
                  placeholder="seu@email.com ou (11) 99999-9999"
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
                  type={showLoginPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  className="w-full pl-9 pr-10 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl text-sm font-semibold outline-amber-500"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowLoginPassword((v) => !v)}
                  aria-label={showLoginPassword ? 'Esconder senha' : 'Mostrar senha'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-neutral-800 cursor-pointer"
                >
                  {showLoginPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
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
            noValidate
            onSubmit={tab === 'perfil' ? handleUpdateProfile : handleRegister}
            className="p-6 space-y-3 text-xs max-h-[75vh] overflow-y-auto"
          >
            {registerError && (
              <div className="text-xs text-red-800 bg-red-50 p-2.5 rounded-xl border border-red-200 font-bold space-y-2">
                <p>{registerError}</p>
                {alreadyRegisteredField && (
                  <button
                    type="button"
                    onClick={handleSwitchToLoginWithEmail}
                    className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-lg text-xs cursor-pointer"
                  >
                    Já tenho conta — entrar
                  </button>
                )}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Nome Completo *</label>
                <input
                  ref={nameInputRef}
                  type="text"
                  maxLength={80}
                  placeholder="Ex: João da Silva"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearFieldError('name');
                  }}
                  className={getInputClass('name')}
                />
                {fieldErrors.name && (
                  <p className="text-[11px] font-bold text-red-600 mt-1">{fieldErrors.name}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    E-mail {tab === 'cadastro' ? '(opcional)' : ''}
                  </label>
                  <input
                    ref={emailInputRef}
                    type="email"
                    disabled={tab === 'perfil'}
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFieldError('email');
                    }}
                    className={getInputClass('email', 'disabled:bg-neutral-100')}
                  />
                  {fieldErrors.email && (
                    <div className="mt-1 space-y-1.5">
                      <p className="text-[11px] font-bold text-red-600">{fieldErrors.email}</p>
                      {alreadyRegisteredField === 'email' && (
                        <button
                          type="button"
                          onClick={handleSwitchToLoginWithEmail}
                          className="w-full py-1.5 px-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-lg text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                        >
                          <span>Já tenho conta — entrar</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">WhatsApp / Celular *</label>
                  <input
                    ref={phoneInputRef}
                    type="tel"
                    placeholder="(11) 98888-7777"
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      clearFieldError('phone');
                    }}
                    className={getInputClass('phone')}
                  />
                  {fieldErrors.phone && (
                    <div className="mt-1 space-y-1.5">
                      <p className="text-[11px] font-bold text-red-600">{fieldErrors.phone}</p>
                      {alreadyRegisteredField === 'phone' && (
                        <button
                          type="button"
                          onClick={handleSwitchToLoginWithEmail}
                          className="w-full py-1.5 px-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-lg text-[11px] flex items-center justify-center gap-1 cursor-pointer shadow-2xs"
                        >
                          <span>Já tenho conta — entrar</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Password inputs with eye toggle */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    {tab === 'perfil' ? 'Nova Senha (opcional)' : 'Senha (mínimo 8 dígitos) *'}
                  </label>
                  <div className="relative">
                    <input
                      ref={passwordInputRef}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Mínimo 8 caracteres"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearFieldError('password');
                        if (confirmPassword && e.target.value === confirmPassword) {
                          clearFieldError('confirmPassword');
                        }
                      }}
                      className={getInputClass('password', 'pr-9')}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-neutral-800 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="text-[11px] font-bold text-red-600 mt-1">{fieldErrors.password}</p>
                  )}
                </div>
                {tab === 'cadastro' && (
                  <div>
                    <label className="font-bold text-neutral-700 block mb-1">Confirmar Senha *</label>
                    <div className="relative">
                      <input
                        ref={confirmPasswordInputRef}
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Repita a senha"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          clearFieldError('confirmPassword');
                        }}
                        className={getInputClass('confirmPassword', 'pr-9')}
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        aria-label={
                          showConfirmPassword
                            ? 'Esconder confirmação de senha'
                            : 'Mostrar confirmação de senha'
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-500 hover:text-neutral-800 cursor-pointer"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {fieldErrors.confirmPassword && (
                      <p className="text-[11px] font-bold text-red-600 mt-1">
                        {fieldErrors.confirmPassword}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* OPTIONAL CEP FIELD */}
            <div className="p-3 bg-amber-50/80 border border-amber-300 rounded-2xl space-y-2 mt-2">
              <label className="font-black text-amber-950 flex items-center justify-between text-xs">
                <span className="flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-amber-600" />
                  <span>CEP (opcional)</span>
                </span>
                <span className="text-[10px] text-amber-800 font-bold">Preenche a rua</span>
              </label>

              <div className="flex gap-1.5">
                <input
                  ref={cepInputRef}
                  type="text"
                  maxLength={9}
                  placeholder="00000-000"
                  value={cep}
                  onChange={handleCepChange}
                  className={`w-full px-3 py-2 bg-white border rounded-xl font-mono font-bold text-xs outline-none ${
                    fieldErrors.cep ? 'border-red-500 bg-red-50/40' : 'border-amber-300'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => executeCepSearch()}
                  disabled={isSearchingCep}
                  className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  {isSearchingCep ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Search className="w-3.5 h-3.5" />
                  )}
                  <span>Buscar</span>
                </button>
              </div>

              {fieldErrors.cep && (
                <p className="text-[11px] font-bold text-red-600">{fieldErrors.cep}</p>
              )}

              {cepStatusMessage && !fieldErrors.cep && (
                <p
                  className={`text-[10px] font-bold p-1.5 rounded-lg ${
                    cepStatusMessage.type === 'success'
                      ? 'bg-emerald-100 text-emerald-900'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {cepStatusMessage.text}
                </p>
              )}
            </div>

            <div className="space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="font-bold text-neutral-700 block mb-1">Rua / Logradouro *</label>
                  <input
                    ref={addressInputRef}
                    type="text"
                    maxLength={120}
                    placeholder="Ex: Rua das Flores"
                    value={address}
                    onChange={(e) => {
                      setAddress(e.target.value);
                      clearFieldError('address');
                    }}
                    className={getInputClass('address')}
                  />
                  {fieldErrors.address && (
                    <p className="text-[11px] font-bold text-red-600 mt-1">{fieldErrors.address}</p>
                  )}
                </div>
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Número *</label>
                  <input
                    ref={numberInputRef}
                    type="text"
                    maxLength={20}
                    placeholder="123"
                    value={number}
                    onChange={(e) => {
                      setNumber(e.target.value);
                      clearFieldError('number');
                    }}
                    className={getInputClass('number')}
                  />
                  {fieldErrors.number && (
                    <p className="text-[11px] font-bold text-red-600 mt-1">{fieldErrors.number}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Complemento</label>
                  <input
                    type="text"
                    maxLength={80}
                    placeholder="Apto 42B"
                    value={complement}
                    onChange={(e) => setComplement(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Ponto de referência</label>
                  <input
                    type="text"
                    maxLength={120}
                    placeholder="Ex: Em frente à padaria"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {/* BAIRRO SELECT */}
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Bairro *</label>
                <select
                  ref={neighborhoodSelectRef}
                  value={selectedAreaId}
                  onChange={(e) => {
                    setSelectedAreaId(e.target.value);
                    clearFieldError('neighborhood');
                  }}
                  className={getInputClass('neighborhood', 'font-bold text-neutral-900')}
                >
                  <option value="">Escolha seu bairro na lista</option>
                  {activeAreasSorted.map((area) => (
                    <option key={area.id} value={area.id}>
                      {formatDeliveryAreaOptionLabel(area)}
                    </option>
                  ))}
                </select>
                {fieldErrors.neighborhood && (
                  <p className="text-[11px] font-bold text-red-600 mt-1">
                    {fieldErrors.neighborhood}
                  </p>
                )}

                <p className="text-[11px] text-neutral-600 mt-1.5 leading-relaxed">
                  Seu bairro não está na lista? No momento não entregamos aí — você pode escolher{' '}
                  <strong>Retirada na loja</strong> ou{' '}
                  {storeWhatsappUrl ? (
                    <a
                      href={storeWhatsappUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-700 hover:text-emerald-800 font-bold underline inline-flex items-center gap-0.5"
                    >
                      <MessageCircle className="w-3 h-3 inline" />
                      <span>falar com a gente no WhatsApp</span>
                    </a>
                  ) : (
                    <strong>falar com a gente no WhatsApp</strong>
                  )}
                  .
                </p>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmittingRegister}
                className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-neutral-950 font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
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
