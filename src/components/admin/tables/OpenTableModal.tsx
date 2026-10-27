import React, { useState } from 'react';
import { TableWithTab } from '../../../types';
import { api } from '../../../services/api';
import { X, Users, MessageSquare, AlertCircle, Sparkles } from 'lucide-react';

interface OpenTableModalProps {
  table: TableWithTab | null;
  availableTables: TableWithTab[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (openedTabId?: string) => void;
}

export const OpenTableModal: React.FC<OpenTableModalProps> = ({
  table,
  availableTables,
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [selectedTableId, setSelectedTableId] = useState<string>(table ? table.id : (availableTables[0]?.id || ''));
  const [customerName, setCustomerName] = useState<string>('');
  const [peopleCount, setPeopleCount] = useState<number>(2);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Reset form fields every time the modal opens
  React.useEffect(() => {
    if (isOpen) {
      setCustomerName('');
      setPeopleCount(2);
      setNotes('');
      setError('');
      setSelectedTableId(table ? table.id : (availableTables[0]?.id || ''));
    }
  }, [isOpen, table?.id]);

  // Keep selectedTableId valid when opening without a preselected table
  React.useEffect(() => {
    if (isOpen && !table && !selectedTableId && availableTables.length > 0) {
      setSelectedTableId(availableTables[0].id);
    }
  }, [isOpen, table, selectedTableId, availableTables]);

  if (!isOpen) return null;

  const currentSelectedTable = table || availableTables.find((t) => t.id === selectedTableId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSelectedTable) {
      setError('Selecione uma mesa disponível.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const opened = await api.openTableTab(currentSelectedTable.id, {
        customer_name: customerName.trim() || undefined,
        people_count: Number(peopleCount),
        notes: notes.trim() || undefined,
      });
      onSuccess(opened.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao abrir a comanda.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-neutral-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-6 text-neutral-950 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] font-black tracking-wider uppercase text-amber-950">Atendimento Local</span>
            </div>
            <h2 className="text-xl font-black mt-1">
              Abrir Comanda {table ? `• Mesa ${table.number}` : ''}
            </h2>
            {table?.label && (
              <p className="text-xs font-semibold text-amber-950 mt-0.5">{table.label}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/40 text-neutral-950 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2 text-xs text-red-700 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Table Selector if opened globally */}
          {!table && (
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Selecione a Mesa Livre
              </label>
              <select
                value={selectedTableId}
                onChange={(e) => setSelectedTableId(e.target.value)}
                className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3 py-2.5 text-sm font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                {availableTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Mesa {t.number} {t.label ? `(${t.label})` : ''} - {t.seats || 2} lugares
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Customer Name */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Identificação / Nome do Cliente (opcional)
            </label>
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Ex: João Silva, Turma da Sinuca..."
              className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              autoFocus
            />
          </div>

          {/* People Count */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Quantidade de Pessoas na Mesa
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPeopleCount((p) => Math.max(1, p - 1))}
                className="w-11 h-11 min-w-[44px] min-h-[44px] shrink-0 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-black text-lg flex items-center justify-center transition-colors"
              >
                -
              </button>
              <div className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl py-2.5 flex items-center justify-center gap-2">
                <Users className="w-4 h-4 text-amber-600" />
                <span className="font-black text-base text-neutral-900">{peopleCount}</span>
                <span className="text-xs text-neutral-500 font-medium">
                  {peopleCount === 1 ? 'pessoa' : 'pessoas'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPeopleCount((p) => p + 1)}
                className="w-11 h-11 min-w-[44px] min-h-[44px] shrink-0 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-black text-lg flex items-center justify-center transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Observações iniciais (opcional)
            </label>
            <div className="relative">
              <MessageSquare className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: Cliente pediu copo descartável e balde com gelo..."
                rows={2}
                className="w-full bg-neutral-100 border border-neutral-200 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Submit */}
          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-2xl text-xs font-bold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !currentSelectedTable}
              className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 rounded-2xl text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" />
              <span>{isSubmitting ? 'Abrindo...' : 'Abrir Mesa'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
