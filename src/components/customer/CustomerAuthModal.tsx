import React, { useState } from 'react';
import { CustomerProfile, DeliveryArea } from '../../types';
import { api } from '../../services/api';
import { User, Phone, MapPin, X, ArrowRight, CheckCircle2 } from 'lucide-react';

interface CustomerAuthModalProps {
  isOpen: boolean;
  deliveryAreas: DeliveryArea[];
  currentCustomer: CustomerProfile | null;
  onSuccess: (cust: CustomerProfile) => void;
  onClose: () => void;
}

export const CustomerAuthModal: React.FC<CustomerAuthModalProps> = ({
  isOpen,
  deliveryAreas,
  currentCustomer,
  onSuccess,
  onClose,
}) => {
  const [tab, setTab] = useState<'login' | 'cadastro'>(currentCustomer ? 'cadastro' : 'login');
  
  // Login by phone
  const [phoneSearch, setPhoneSearch] = useState<string>('');
  const [loginError, setLoginError] = useState<string>('');

  // Register form
  const [name, setName] = useState<string>(currentCustomer?.name || '');
  const [phone, setPhone] = useState<string>(currentCustomer?.phone || '');
  const [address, setAddress] = useState<string>(currentCustomer?.address || '');
  const [number, setNumber] = useState<string>(currentCustomer?.number || '');
  const [neighborhood, setNeighborhood] = useState<string>(currentCustomer?.neighborhood || (deliveryAreas[0]?.name || ''));
  const [complement, setComplement] = useState<string>(currentCustomer?.complement || '');
  const [reference, setReference] = useState<string>(currentCustomer?.reference || '');

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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim() || !address.trim() || !number.trim() || !neighborhood.trim()) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }

    const saved = await api.saveCustomerProfile({
      name,
      phone,
      address,
      number,
      neighborhood,
      complement,
      reference,
    });

    onSuccess(saved);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white p-6 relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 hover:bg-black/10 rounded-lg text-white"
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
            Seus dados ficam salvos para você pedir em apenas 1 clique nas próximas vezes!
          </p>

          {/* Tab selector */}
          {!currentCustomer && (
            <div className="flex bg-black/20 p-1 rounded-xl mt-4 text-xs font-bold">
              <button
                type="button"
                onClick={() => setTab('login')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
                  tab === 'login' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-100 hover:text-white'
                }`}
              >
                Já sou Cliente
              </button>
              <button
                type="button"
                onClick={() => setTab('cadastro')}
                className={`flex-1 py-1.5 rounded-lg transition-all ${
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
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
            >
              <span>Continuar</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        ) : (
          /* Tab 2: Register / Edit Profile */
          <form onSubmit={handleRegister} className="p-6 space-y-4 text-xs">
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

            <div className="pt-2 border-t border-neutral-100">
              <span className="font-bold text-neutral-900 block mb-2 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-amber-600" />
                <span>Endereço de Entrega Principal</span>
              </span>

              <div className="space-y-3">
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
                    {deliveryAreas.filter(a => a.active).length > 0 ? (
                      <select
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium"
                        required
                      >
                        {deliveryAreas.filter(a => a.active).map(a => (
                          <option key={a.id} value={a.name}>
                            {a.name} (Taxa R$ {a.fee.toFixed(2)})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="Ex: Centro, Jardim..."
                        value={neighborhood}
                        onChange={(e) => setNeighborhood(e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium"
                        required
                      />
                    )}
                  </div>

                  <div>
                    <label className="font-bold text-neutral-700 block mb-1">Complemento / Apto</label>
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
            </div>

            <div className="pt-3">
              <button
                type="submit"
                className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
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
