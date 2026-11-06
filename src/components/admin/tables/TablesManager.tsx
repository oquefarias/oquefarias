import React, { useState, useEffect, useMemo } from 'react';
import { TableWithTab, Product, StoreSettings, TabDetail, Order } from '../../../types';
import { api } from '../../../services/api';
import { OpenTableModal } from './OpenTableModal';
import { ManageTablesModal } from './ManageTablesModal';
import { TableTabDetailModal } from './TableTabDetailModal';
import { CloseTabModal } from './CloseTabModal';
import { TableReceiptModal } from './TableReceiptModal';
import {
  LayoutGrid,
  Plus,
  RefreshCw,
  Search,
  Users,
  Clock,
  Receipt,
  Utensils,
  DollarSign,
  Sparkles,
} from 'lucide-react';

interface TablesManagerProps {
  products: Product[];
  settings: StoreSettings;
  hasOpenCashSession?: boolean;
  onRequestOpenCashSession?: () => void;
}

export const TablesManager: React.FC<TablesManagerProps> = ({
  products,
  settings,
  hasOpenCashSession = true,
  onRequestOpenCashSession,
}) => {
  const [tables, setTables] = useState<TableWithTab[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'todas' | 'livres' | 'ocupadas'>('todas');

  // Modals state
  const [isManageModalOpen, setIsManageModalOpen] = useState<boolean>(false);
  const [isOpenTabModalOpen, setIsOpenTabModalOpen] = useState<boolean>(false);
  const [tableToOpen, setTableToOpen] = useState<TableWithTab | null>(null);
  const [openingTableId, setOpeningTableId] = useState<string | null>(null);

  const [activeTabDetailId, setActiveTabDetailId] = useState<string | null>(null);
  const [tabToClose, setTabToClose] = useState<TabDetail | null>(null);
  const [closedOrderReceipt, setClosedOrderReceipt] = useState<Order | null>(null);

  const handleQuickOpenTable = async (tbl: TableWithTab) => {
    if (openingTableId) return;
    setOpeningTableId(tbl.id);
    try {
      const opened = await api.openTableTab(tbl.id, {
        people_count: 1,
      });
      await loadTables();
      setActiveTabDetailId(opened.id);
    } catch (err: any) {
      try {
        const updatedList = await api.getAdminTables();
        setTables(updatedList);
        const found = updatedList.find((t) => t.id === tbl.id);
        const existingTabId = found?.currentTab?.id || found?.joinedToTabId;
        if (existingTabId) {
          setActiveTabDetailId(existingTabId);
          return;
        }
      } catch {
        // ignore reload error
      }
      api.notifyError(err?.message || 'Não foi possível abrir a mesa.');
    } finally {
      setOpeningTableId(null);
    }
  };

  // Load tables from server
  const loadTables = async (showSpinner = false) => {
    if (showSpinner) setIsRefreshing(true);
    try {
      const data = await api.getAdminTables();
      setTables(data);
    } catch (err: any) {
      console.error('Erro ao carregar mesas:', err);
    } finally {
      setLoading(false);
      if (showSpinner) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadTables();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadTables();
      }
    };

    // Auto-refresh every 15 seconds ONLY while tab is visible
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        loadTables();
      }
    }, 15000);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, []);

  // Summary statistics
  const freeTables = useMemo(
    () => tables.filter((t) => !t.currentTab && !t.joinedToTabId),
    [tables]
  );
  const occupiedTables = useMemo(
    () => tables.filter((t) => Boolean(t.currentTab) || Boolean(t.joinedToTabId)),
    [tables]
  );

  const totalClientsPresent = useMemo(() => {
    return tables.reduce((sum, t) => sum + (t.currentTab?.peopleCount || 0), 0);
  }, [tables]);

  const totalOpenRevenue = useMemo(() => {
    return tables.reduce((sum, t) => sum + (t.currentTab?.subtotal || 0), 0);
  }, [tables]);

  // Filtered tables for display
  const filteredTables = useMemo(() => {
    return tables.filter((t) => {
      const isOccupied = Boolean(t.currentTab) || Boolean(t.joinedToTabId);
      if (filterStatus === 'livres' && isOccupied) return false;
      if (filterStatus === 'ocupadas' && !isOccupied) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesNum = String(t.number).includes(q);
        const matchesLabel = t.label ? t.label.toLowerCase().includes(q) : false;
        const matchesClient = t.currentTab?.customerName
          ? t.currentTab.customerName.toLowerCase().includes(q)
          : false;
        const matchesJoinedNum = t.joinedToTableNumber
          ? String(t.joinedToTableNumber).includes(q)
          : false;
        const matchesLinkedNums = t.linkedTables
          ? t.linkedTables.some((lt) => String(lt.number).includes(q))
          : false;
        if (!matchesNum && !matchesLabel && !matchesClient && !matchesJoinedNum && !matchesLinkedNums) {
          return false;
        }
      }
      return true;
    });
  }, [tables, filterStatus, search]);

  const formatElapsed = (isoDate?: string) => {
    if (!isoDate) return '';
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const minutes = Math.max(0, Math.floor(diffMs / 60000));
    if (minutes < 60) return `Há ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    return `Há ${hours}h ${remMin}m`;
  };

  useEffect(() => {
    if (!closedOrderReceipt && !isManageModalOpen && !isOpenTabModalOpen) return;
    const closeKey = (settings.shortcuts?.fecharModal || 'Escape').toUpperCase();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (window.innerWidth < 768) return;
      const pressed = e.key.toUpperCase();
      if (pressed === closeKey || (closeKey === 'ESC' && e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        if (closedOrderReceipt) {
          setClosedOrderReceipt(null);
        } else if (isManageModalOpen) {
          setIsManageModalOpen(false);
        } else if (isOpenTabModalOpen) {
          setIsOpenTabModalOpen(false);
          setTableToOpen(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closedOrderReceipt, isManageModalOpen, isOpenTabModalOpen, settings.shortcuts]);

  return (
    <div className="space-y-6 min-w-0">
      {/* 1. Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Livres */}
        <div className="bg-white p-3.5 sm:p-5 rounded-3xl border border-neutral-200 shadow-xs flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-2xl bg-neutral-100 text-neutral-600 flex items-center justify-center font-black text-lg sm:text-xl">
            {freeTables.length}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-wider block truncate">
              Mesas Livres
            </span>
            <span className="text-base sm:text-xl font-black text-neutral-900 block truncate">
              {freeTables.length} {freeTables.length === 1 ? 'mesa' : 'mesas'}
            </span>
          </div>
        </div>

        {/* Ocupadas */}
        <div className="bg-white p-3.5 sm:p-5 rounded-3xl border border-neutral-200 shadow-xs flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-black text-lg sm:text-xl">
            {occupiedTables.length}
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-wider block truncate">
              Mesas Ocupadas
            </span>
            <span className="text-base sm:text-xl font-black text-emerald-700 block truncate">
              {occupiedTables.length} {occupiedTables.length === 1 ? 'mesa' : 'mesas'}
            </span>
          </div>
        </div>

        {/* Clientes no Local */}
        <div className="bg-white p-3.5 sm:p-5 rounded-3xl border border-neutral-200 shadow-xs flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-2xl bg-sky-100 text-sky-800 flex items-center justify-center">
            <Users className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-wider block truncate">
              Clientes Presentes
            </span>
            <span className="text-base sm:text-xl font-black text-neutral-900 block truncate">
              {totalClientsPresent} {totalClientsPresent === 1 ? 'pessoa' : 'pessoas'}
            </span>
          </div>
        </div>

        {/* Valor em Aberto */}
        <div className="bg-white p-3.5 sm:p-5 rounded-3xl border border-neutral-200 shadow-xs flex items-center gap-3 sm:gap-4 min-w-0">
          <div className="w-10 h-10 sm:w-12 sm:h-12 shrink-0 rounded-2xl bg-amber-100 text-amber-800 flex items-center justify-center">
            <DollarSign className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <span className="text-[10px] sm:text-[11px] font-bold text-neutral-400 uppercase tracking-wider block truncate">
              Consumo em Aberto
            </span>
            <span className="text-base sm:text-xl font-black text-amber-600 block truncate">
              R$ {totalOpenRevenue.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Action and Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white p-3.5 sm:p-4 rounded-3xl border border-neutral-200 shadow-xs">
        {/* Left: Filters and Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 max-w-lg min-w-0">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              data-admin-search="mesas"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar mesa ou cliente..."
              className="w-full bg-neutral-100 border border-neutral-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex items-center justify-between sm:justify-start gap-1 bg-neutral-100 p-1 rounded-xl">
            {(['todas', 'livres', 'ocupadas'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  filterStatus === st
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex flex-wrap items-center gap-2 justify-end">
          <button
            onClick={() => loadTables(true)}
            className="p-2.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition-colors"
            title="Atualizar mesas"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
          </button>

          <button
            onClick={() => setIsManageModalOpen(true)}
            className="px-3 sm:px-3.5 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5"
          >
            <LayoutGrid className="w-4 h-4 text-neutral-600 shrink-0" />
            <span>Gerenciar Mesas</span>
          </button>

          <button
            onClick={() => {
              setTableToOpen(null);
              setIsOpenTabModalOpen(true);
            }}
            disabled={freeTables.length === 0}
            className="px-3.5 sm:px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 rounded-xl text-xs font-black shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Abrir Comanda</span>
          </button>
        </div>
      </div>

      {/* 3. Tables Cards Grid */}
      {loading ? (
        <div className="p-16 text-center text-xs text-neutral-400 font-bold">
          Carregando mesas do depósito...
        </div>
      ) : filteredTables.length === 0 ? (
        <div className="p-16 text-center bg-white rounded-3xl border border-dashed border-neutral-300">
          <Utensils className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <h3 className="font-bold text-base text-neutral-800">Nenhuma mesa encontrada</h3>
          <p className="text-xs text-neutral-500 mt-1">
            {tables.length === 0
              ? 'Cadastre suas primeiras mesas clicando em "Gerenciar Mesas" acima.'
              : 'Nenhuma mesa corresponde ao filtro aplicado.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTables.map((tbl) => {
            const isJoined = Boolean(tbl.joinedToTabId);
            const tab = tbl.currentTab;

            // 1. Occupied Table Card (Primary table of open tab)
            if (tab) {
              const hasLinked = tbl.linkedTables && tbl.linkedTables.length > 0;
              const allNumbers = hasLinked
                ? [tbl.number, ...tbl.linkedTables!.map((lt) => lt.number)].sort((a, b) => a - b).join(' + ')
                : String(tbl.number);

              return (
                <div
                  key={tbl.id}
                  onClick={() => setActiveTabDetailId(tab.id)}
                  className="bg-white rounded-3xl border-2 border-emerald-400/80 hover:border-emerald-500 p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    {/* Top status */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white font-black text-lg flex items-center justify-center shadow-xs shrink-0">
                          {tbl.number}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-black text-sm text-neutral-900">
                              Mesa {allNumbers}
                            </span>
                            {tbl.label && (
                              <span className="text-[10px] font-semibold text-neutral-500">
                                ({tbl.label})
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-semibold text-neutral-400 flex items-center gap-1">
                            <Clock className="w-3 h-3 text-neutral-400" />
                            {formatElapsed(tab.openedAt)}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Ocupada
                        </span>
                        {hasLinked && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-200">
                            +{tbl.linkedTables!.length} {tbl.linkedTables!.length === 1 ? 'juntada' : 'juntadas'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Customer Info */}
                    <div className="bg-neutral-50 rounded-2xl p-3 border border-neutral-100 space-y-1 mb-4">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-neutral-800 truncate">
                        <span>👤</span>
                        <span className="truncate">{tab.customerName || 'Cliente não identificado'}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-neutral-500">
                        <span>👥 {tab.peopleCount} {tab.peopleCount === 1 ? 'pessoa' : 'pessoas'}</span>
                        <span>•</span>
                        <span>📦 {tab.itemsCount} un</span>
                      </div>
                    </div>
                  </div>

                  {/* Subtotal & Action */}
                  <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Total</span>
                      <span className="text-xl font-black text-amber-600">
                        R$ {tab.subtotal.toFixed(2)}
                      </span>
                    </div>

                    <button
                      type="button"
                      className="px-3.5 py-2 rounded-xl bg-neutral-900 group-hover:bg-amber-500 group-hover:text-neutral-950 text-white text-xs font-black transition-colors"
                    >
                      Ver Comanda
                    </button>
                  </div>
                </div>
              );
            }

            // 2. Joined Table Card (Secondary table attached to another tab)
            if (isJoined && tbl.joinedToTabId) {
              return (
                <div
                  key={tbl.id}
                  onClick={() => setActiveTabDetailId(tbl.joinedToTabId!)}
                  className="bg-white rounded-3xl border-2 border-amber-300 hover:border-amber-500 p-5 shadow-xs hover:shadow-md transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div>
                    {/* Top status */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-11 h-11 rounded-2xl bg-amber-500 text-neutral-950 font-black text-lg flex items-center justify-center shadow-xs shrink-0">
                          {tbl.number}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-black text-sm text-neutral-900">
                              Mesa {tbl.number}
                            </span>
                            {tbl.label && (
                              <span className="text-[10px] font-semibold text-neutral-500">
                                ({tbl.label})
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-semibold text-amber-700">
                            Mesa vinculada
                          </span>
                        </div>
                      </div>

                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">
                        Juntada
                      </span>
                    </div>

                    {/* Prominent Highlight Warning/Notice */}
                    <div className="bg-amber-50 rounded-2xl p-3 border border-amber-200 space-y-1 mb-4">
                      <div className="flex items-center gap-1.5 text-xs font-black text-amber-900">
                        <span>🔗</span>
                        <span>Juntada com a Mesa {tbl.joinedToTableNumber}</span>
                      </div>
                      <p className="text-[11px] text-amber-800">
                        Os itens e a conta estão unificados na Mesa {tbl.joinedToTableNumber}. Clique para ver a comanda.
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-neutral-500">
                      Conta compartilhada
                    </span>

                    <button
                      type="button"
                      className="px-3.5 py-2 rounded-xl bg-neutral-900 group-hover:bg-amber-500 group-hover:text-neutral-950 text-white text-xs font-black transition-colors"
                    >
                      Ver Comanda
                    </button>
                  </div>
                </div>
              );
            }

            // 3. Free Table Card
            return (
              <div
                key={tbl.id}
                className="bg-white rounded-3xl border border-neutral-200 hover:border-neutral-300 p-5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-11 h-11 rounded-2xl bg-neutral-100 border border-neutral-200 text-neutral-800 font-black text-lg flex items-center justify-center">
                        {tbl.number}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-black text-sm text-neutral-900">
                            Mesa {tbl.number}
                          </span>
                          {tbl.label && (
                            <span className="text-[10px] font-semibold text-neutral-500">
                              ({tbl.label})
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-semibold text-neutral-400">
                          {tbl.seats || 4} lugares
                        </span>
                      </div>
                    </div>

                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-neutral-100 text-neutral-500">
                      Livre
                    </span>
                  </div>

                  <p className="text-xs text-neutral-400 py-4 text-center">
                    Mesa disponível para atendimento
                  </p>
                </div>

                <div className="pt-3 border-t border-neutral-100">
                  <button
                    type="button"
                    disabled={openingTableId !== null}
                    onClick={() => handleQuickOpenTable(tbl)}
                    className="w-full py-2.5 px-3 bg-neutral-100 hover:bg-amber-500 hover:text-neutral-950 disabled:opacity-50 text-neutral-800 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{openingTableId === tbl.id ? 'Abrindo...' : 'Abrir Mesa'}</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Open Table Modal */}
      <OpenTableModal
        table={tableToOpen}
        availableTables={freeTables}
        isOpen={isOpenTabModalOpen}
        onClose={() => {
          setIsOpenTabModalOpen(false);
          setTableToOpen(null);
        }}
        onSuccess={async (openedTabId) => {
          setIsOpenTabModalOpen(false);
          setTableToOpen(null);
          await loadTables();
          if (openedTabId) {
            setActiveTabDetailId(openedTabId);
          }
        }}
      />

      {/* Manage Tables Modal */}
      <ManageTablesModal
        tables={tables}
        isOpen={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        onRefresh={() => loadTables()}
      />

      {/* Table Tab Detail Modal */}
      <TableTabDetailModal
        tabId={activeTabDetailId}
        isOpen={Boolean(activeTabDetailId)}
        allTables={tables}
        products={products}
        settings={settings}
        onClose={() => setActiveTabDetailId(null)}
        onRequestCloseTab={(tab) => {
          setActiveTabDetailId(null);
          setTabToClose(tab);
        }}
        onRefreshParent={() => loadTables()}
      />

      {/* Close Tab Modal */}
      <CloseTabModal
        tab={tabToClose}
        isOpen={Boolean(tabToClose)}
        settings={settings}
        hasOpenCashSession={hasOpenCashSession}
        onRequestOpenCashSession={onRequestOpenCashSession}
        onClose={() => setTabToClose(null)}
        onSuccess={(createdOrder) => {
          setTabToClose(null);
          setClosedOrderReceipt(createdOrder);
          loadTables();
        }}
      />

      {/* Post-closing Receipt Modal */}
      <TableReceiptModal
        order={closedOrderReceipt}
        settings={settings}
        isOpen={Boolean(closedOrderReceipt)}
        onClose={() => setClosedOrderReceipt(null)}
      />
    </div>
  );
};
