import React, { useState } from 'react';
import { api } from '../../services/api';
import { ShieldCheck, Lock, ArrowRight, X, AlertCircle } from 'lucide-react';

interface AdminLoginModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({ isOpen, onSuccess, onClose }) => {
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Por favor digite sua senha de acesso.');
      return;
    }

    setIsLoading(true);
    setError('');

    const isOk = await api.verifyAdminPin(pin);
    setIsLoading(false);

    if (isOk) {
      setPin('');
      onSuccess();
    } else {
      setError('Senha de acesso incorreta. Verifique e tente novamente.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl max-w-sm w-full shadow-2xl overflow-hidden border border-neutral-200">
        <div className="bg-neutral-900 text-white p-6 text-center relative">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="w-14 h-14 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-amber-500/30">
            <ShieldCheck className="w-8 h-8" />
          </div>

          <h3 className="font-black text-lg">Acesso Restrito do Depósito</h3>
          <p className="text-xs text-neutral-400 mt-1">
            Área exclusiva do proprietário e funcionários autorizados.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-neutral-700 block mb-1 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-600" />
              <span>Digite o PIN / Senha do Dono</span>
            </label>
            <input
              type="password"
              autoFocus
              maxLength={12}
              placeholder="Senha de acesso"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                if (error) setError('');
              }}
              className="w-full px-4 py-3 bg-neutral-50 border border-neutral-300 rounded-xl text-center text-lg tracking-widest font-mono font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
            <p className="text-[11px] text-neutral-400 mt-1 text-center">
              Digite o PIN configurado em <code className="text-neutral-600 font-mono">ADMIN_PIN</code> no servidor.
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading || !pin.trim()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 text-white font-black text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <span>Verificando...</span>
              ) : (
                <>
                  <span>Desbloquear Computador</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
