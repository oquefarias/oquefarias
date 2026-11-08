import React, { useState, useEffect, useMemo } from 'react';
import {
  CustomerProfile,
  StoreSettings,
  DeliveryArea,
  getActiveDeliveryAreasSorted,
  findMatchingActiveDeliveryArea,
  formatDeliveryAreaOptionLabel,
} from '../../types';
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
  Check,
} from 'lucide-react';
import { fetchAddressByCep } from '../../utils/geo';

interface CustomerModalProps {
  isOpen: boolean;
  customer: CustomerProfile | null;
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  onSave: (
    custData: Omit<CustomerProfile, 'id' | 'createdAt'> & {
      id?: string;
      deliveryAreaId?: string;
    }
  ) => Promise<void>;
  onClose: () => void;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({
  isOpen,
  customer,
  deliveryAreas,
  onSave,
  onClose,
}) => {
  const [name, setName] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [cep, setCep] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [number, setNumber] = useState<string>('');
  const [deliveryAreaId, setDeliveryAreaId] = useState<string>('');
  const [legacyNeighborhoodName, setLegacyNeighborhoodName] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [complement, setComplement] = useState<string>('');
  const [reference, setReference] = useState<string>('');

  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepStatusMessage, setCepStatusMessage] = useState<{
    type: 'success' | 'warn';
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>('');

  const activeAreasSorted = useMemo(
    () => getActiveDeliveryAreasSorted(deliveryAreas),
    [deliveryAreas]
  );

  useEffect(() => {
    setIsSubmitting(false);
    setFormError('');
    setCepStatusMessage(null);
    if (customer) {
      setName(customer.name || '');
      setPhone(customer.phone || '');
      setCep(customer.cep || '');
      setAddress(customer.address || '');
      setNumber(customer.number || '');
      const matched = findMatchingActiveDeliveryArea(
        deliveryAreas,
        customer.neighborhood
      );
      setDeliveryAreaId(matched ? matched.id : '');
      setLegacyNeighborhoodName(!matched && customer.neighborhood ? customer.neighborhood : '');
      setCity(customer.city || '');
      setState(customer.state || '');
      setComplement(customer.complement || '');
      setReference(customer.reference || '');
    } else {
      setName('');
      setPhone('');
      setCep('');
      setAddress('');
      setNumber('');
      setDeliveryAreaId('');
      setLegacyNeighborhoodName('');
      setCity('');
      setState('');
      setComplement('');
      setReference('');
    }
  }, [customer, isOpen, deliveryAreas]);

  if (!isOpen) return null;

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
    } else {
      setCepStatusMessage(null);
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
          text: 'Não foi possível preencher pelo CEP agora. Digite a rua e escolha o bairro abaixo.',
        });
        return;
      }

      if (viaCep.logradouro) setAddress(viaCep.logradouro);
      if (viaCep.localidade) setCity(viaCep.localidade);
      if (viaCep.uf) setState(viaCep.uf);

      if (viaCep.bairro) {
        const matchedArea = findMatchingActiveDeliveryArea(deliveryAreas, viaCep.bairro);
        if (matchedArea) {
          setDeliveryAreaId(matchedArea.id);
          setLegacyNeighborhoodName('');
          setCepStatusMessage({
            type: 'success',
            text: `Rua preenchida e bairro "${matchedArea.name}" selecionado!`,
          });
          return;
        }
      }

      setCepStatusMessage({
        type: 'success',
        text: 'Rua preenchida pelo CEP! Agora escolha o bairro na lista abaixo.',
      });
    } catch {
      setCepStatusMessage({
        type: 'warn',
        text: 'Não foi possível consultar o CEP agora. Preencha o endereço manualmente.',
      });
    } finally {
      setIsSearchingCep(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!name.trim()) {
      setFormError('Por favor, informe o nome do cliente.');
      return;
    }
    if (!phone.trim()) {
      setFormError('Por favor, informe o telefone/WhatsApp do cliente.');
      return;
    }
    const cleanCepDigits = cep.replace(/\D/g, '');
    if (cleanCepDigits.length > 0 && cleanCepDigits.length !== 8) {
      setFormError('O CEP deve ter 8 dígitos (ou deixe em branco).');
      return;
    }
    if (address.trim().length < 2 || address.trim().length > 120) {
      setFormError('Informe a rua/avenida (entre 2 e 120 caracteres).');
      return;
    }
    if (number.trim().length < 1 || number.trim().length > 20) {
      setFormError('Informe o número do imóvel (até 20 caracteres).');
      return;
    }
    if (complement.trim().length > 80) {
      setFormError('O complemento deve ter no máximo 80 caracteres.');
      return;
    }
    if (reference.trim().length > 120) {
      setFormError('O ponto de referência deve ter no máximo 120 caracteres.');
      return;
    }

    const chosenArea = activeAreasSorted.find((a) => a.id === deliveryAreaId);
    if (!chosenArea) {
      setFormError('Escolha um bairro da lista de entrega.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({
        id: customer?.id,
        name: name.trim(),
        phone: phone.trim(),
        cep: cleanCepDigits,
        address: address.trim(),
        number: number.trim(),
        neighborhood: chosenArea.name,
        deliveryAreaId: chosenArea.id,
        city: city.trim(),
        state: state.trim(),
        complement: complement.trim(),
        reference: reference.trim(),
      });
      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      setFormError(err?.message || 'Erro ao salvar o cliente. Tente novamente.');
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

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
            Preencha o endereço do cliente e escolha o bairro atendido pela loja.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {formError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* 1. Nome e Telefone */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-bold text-neutral-700 block mb-1">
                Nome Completo do Cliente *
              </label>
              <input
                type="text"
                required
                placeholder="Ex: João da Silva"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 focus:bg-white outline-none"
              />
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

          {/* 2. CEP (Opcional) */}
          <div className="p-4 bg-amber-50/70 border border-amber-300/80 rounded-2xl space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-black text-amber-950 flex items-center gap-1.5 text-xs">
                <Building2 className="w-4 h-4 text-amber-600" />
                <span>CEP (opcional — preenche a rua automaticamente)</span>
              </label>
            </div>

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
                  className="w-full px-3.5 py-2 bg-white border border-amber-300 rounded-xl font-mono font-bold text-sm text-neutral-900 focus:border-amber-500 outline-none"
                />
                {isSearchingCep && (
                  <Loader2 className="w-4 h-4 text-amber-600 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />
                )}
              </div>

              <button
                type="button"
                onClick={() => executeCepSearch()}
                disabled={isSearchingCep}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                {isSearchingCep ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Search className="w-3.5 h-3.5" />
                )}
                <span>Buscar CEP</span>
              </button>
            </div>

            {cepStatusMessage && (
              <p
                className={`text-[11px] font-bold flex items-center gap-1.5 p-2 rounded-xl ${
                  cepStatusMessage.type === 'success'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-amber-100 text-amber-900 border border-amber-300'
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
          </div>

          {/* 3. Campos de Endereço e Bairro (select) */}
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-8 sm:col-span-9">
                <label className="font-bold text-neutral-700 block mb-1">
                  Rua / Avenida *
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
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
                  minLength={1}
                  maxLength={20}
                  placeholder="123"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-neutral-700 block mb-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-amber-600" />
                <span>Bairro atendido *</span>
              </label>
              {legacyNeighborhoodName && !deliveryAreaId && (
                <p className="mb-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-xl">
                  Bairro anterior do cliente (&ldquo;{legacyNeighborhoodName}&rdquo;) não está na lista ativa. Escolha um bairro atendido abaixo:
                </p>
              )}
              <select
                required
                value={deliveryAreaId}
                onChange={(e) => setDeliveryAreaId(e.target.value)}
                className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900 focus:border-amber-500 outline-none"
              >
                <option value="">Escolha seu bairro na lista...</option>
                {activeAreasSorted.map((area) => (
                  <option key={area.id} value={area.id}>
                    {formatDeliveryAreaOptionLabel(area)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Complemento / Apto
                </label>
                <input
                  type="text"
                  maxLength={80}
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
                  maxLength={120}
                  placeholder="Ex: Em frente à praça, portão preto"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium focus:border-amber-500 outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Cidade (opcional)
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
                  Estado / UF (opcional)
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
              className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-neutral-950 font-black rounded-xl shadow-md transition-all flex items-center gap-1.5 cursor-pointer"
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
