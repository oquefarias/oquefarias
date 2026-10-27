import React, { useState, useEffect } from 'react';
import { DiningTable, TableWithTab } from '../../../types';
import { api } from '../../../services/api';
import { X, Plus, Edit2, Trash2, Check, AlertCircle, LayoutGrid } from 'lucide-react';

interface ManageTablesModalProps {
  tables: TableWithTab[];
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export const ManageTablesModal: React.FC<ManageTablesModalProps> = ({
  tables,
  isOpen,
  onClose,
  onRefresh,
}) => {
  const [modalTables, setModalTables] = useState<TableWithTab[]>(tables);
  const [editingTable, setEditingTable] = useState<DiningTable | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [formNumber, setFormNumber] = useState<string>('');
  const [formLabel, setFormLabel] = useState<string>('');
  const [formSeats, setFormSeats] = useState<string>('4');
  const [error, setError] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // In-screen confirmation modal state for deactivating table
  const [tableToDelete, setTableToDelete] = useState<TableWithTab | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  useEffect(() => {
    setModalTables(tables);
  }, [tables]);

  if (!isOpen) return null;

  const reloadModalTables = async () => {
    try {
      const fresh = await api.getAdminTables();
      setModalTables(fresh);
    } catch (err: any) {
      console.error('Erro ao recarregar mesas do modal:', err);
    }
    onRefresh();
  };

  const handleStartCreate = () => {
    const maxNumber = modalTables.reduce((max, t) => Math.max(max, t.number), 0);
    setFormNumber(String(maxNumber + 1));
    setFormLabel('');
    setFormSeats('4');
    setEditingTable(null);
    setIsCreating(true);
    setError('');
  };

  const handleStartEdit = (t: DiningTable) => {
    setEditingTable(t);
    setIsCreating(false);
    setFormNumber(String(t.number));
    setFormLabel(t.label || '');
    setFormSeats(t.seats ? String(t.seats) : '4');
    setError('');
  };

  const handleCancelForm = () => {
    setIsCreating(false);
    setEditingTable(null);
    setError('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(formNumber, 10);
    if (!num || num <= 0) {
      setError('Informe um número válido para a mesa.');
      return;
    }

    const seats = parseInt(formSeats, 10) || 4;
    setIsSaving(true);
    setError('');

    try {
      if (editingTable) {
        await api.updateAdminTable(editingTable.id, {
          number: num,
          label: formLabel.trim() || undefined,
          seats,
        });
      } else {
        await api.createAdminTable({
          number: num,
          label: formLabel.trim() || undefined,
          seats,
        });
      }
      await reloadModalTables();
      handleCancelForm();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar mesa.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (t: TableWithTab) => {
    if (t.currentTab || t.joinedToTabId) {
      setError('Não é possível desativar uma mesa com comanda aberta ou vinculada.');
      return;
    }
    setError('');
    setTableToDelete(t);
  };

  const handleConfirmDelete = async () => {
    if (!tableToDelete) return;
    setIsDeleting(true);
    setError('');

    try {
      await api.deleteAdminTable(tableToDelete.id);
      await reloadModalTables();
      setTableToDelete(null);
    } catch (err: any) {
      setError(err.message || 'Erro ao desativar mesa.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[90vh] shadow-2xl border border-neutral-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-neutral-900 p-6 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <LayoutGrid className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black">Gerenciar Mesas</h2>
              <p className="text-xs text-neutral-400">Configure as mesas disponíveis no seu estabelecimento</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center gap-2 text-xs text-red-700 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Form for Add/Edit */}
          {(isCreating || editingTable) && (
            <form onSubmit={handleSave} className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase text-amber-700">
                  {editingTable ? `Editar Mesa ${editingTable.number}` : 'Cadastrar Nova Mesa'}
                </span>
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="text-xs text-neutral-500 hover:text-neutral-800"
                >
                  Cancelar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                    Número da Mesa *
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formNumber}
                    onChange={(e) => setFormNumber(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                    Identificação / Setor
                  </label>
                  <input
                    type="text"
                    value={formLabel}
                    onChange={(e) => setFormLabel(e.target.value)}
                    placeholder="Ex: Varanda, Sinuca, Bar..."
                    className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm font-semibold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                    Capacidade (Lugares)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={formSeats}
                    onChange={(e) => setFormSeats(e.target.value)}
                    className="w-full bg-white border border-neutral-300 rounded-xl px-3 py-2 text-sm font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleCancelForm}
                  className="px-3 py-2 bg-neutral-200 hover:bg-neutral-300 text-neutral-800 rounded-xl text-xs font-bold transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1.5 shadow-sm transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Salvando...' : 'Salvar Mesa'}</span>
                </button>
              </div>
            </form>
          )}

          {/* List Header & Button */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase text-neutral-500">
              Mesas Cadastradas ({modalTables.length})
            </span>
            {!isCreating && !editingTable && (
              <button
                type="button"
                onClick={handleStartCreate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-xl shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Adicionar Mesa</span>
              </button>
            )}
          </div>

          {/* Tables Table */}
          <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-2xl overflow-hidden bg-white">
            {modalTables.length === 0 ? (
              <div className="p-8 text-center text-neutral-400 text-xs font-medium">
                Nenhuma mesa cadastrada ainda. Clique em "Adicionar Mesa" acima.
              </div>
            ) : (
              modalTables.map((t) => {
                const isOccupied = Boolean(t.currentTab || t.joinedToTabId);
                return (
                  <div
                    key={t.id}
                    className="p-3.5 flex items-center justify-between gap-3 hover:bg-neutral-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center font-black text-neutral-900 text-base">
                        {t.number}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-neutral-900">Mesa {t.number}</span>
                          {t.label && (
                            <span className="text-xs px-2 py-0.5 rounded-md bg-neutral-100 text-neutral-700 font-semibold">
                              {t.label}
                            </span>
                          )}
                          {t.joinedToTabId ? (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                              Juntada (Mesa {t.joinedToTableNumber || '?'})
                            </span>
                          ) : isOccupied ? (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                              Ocupada
                            </span>
                          ) : (
                            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
                              Livre
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-neutral-400 mt-0.5">
                          {t.seats || 4} lugares{' '}
                          {t.currentTab
                            ? `• Comanda ativa: R$ ${t.currentTab.subtotal.toFixed(2)}`
                            : t.joinedToTableNumber
                            ? `• Vinculada à Mesa ${t.joinedToTableNumber}`
                            : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleStartEdit(t)}
                        className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
                        title="Editar mesa"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteClick(t)}
                        disabled={isOccupied}
                        className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={isOccupied ? 'Não pode desativar mesa em atendimento' : 'Desativar mesa'}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-neutral-50 border-t border-neutral-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold transition-colors"
          >
            Concluir
          </button>
        </div>
      </div>

      {/* In-Screen Confirmation Modal: Desativar Mesa */}
      {tableToDelete && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-neutral-100 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-neutral-900">Desativar mesa</h3>
                <p className="text-xs text-neutral-500">
                  Tem certeza que deseja desativar a Mesa {tableToDelete.number}?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setTableToDelete(null)}
                disabled={isDeleting}
                className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-bold transition-colors"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
              >
                {isDeleting ? 'Desativando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
