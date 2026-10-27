import React, { useState, useEffect, useMemo } from 'react';
import {
  TabDetail,
  TableWithTab,
  Product,
  ProductCategory,
  TableTabItem,
  LinkedTable,
  SaleUnit,
  isProductPromoActive,
  getEffectiveProductPrice,
  hasProductCase,
  formatStockWithCases,
} from '../../../types';
import { api } from '../../../services/api';
import {
  X,
  Search,
  Plus,
  Trash2,
  ArrowRightLeft,
  Merge,
  MoveRight,
  Receipt,
  Users,
  Clock,
  AlertCircle,
  Check,
  Edit2,
  Tag,
  Snowflake,
  Ban,
  MessageSquare,
} from 'lucide-react';

interface TableTabDetailModalProps {
  tabId: string | null;
  isOpen: boolean;
  allTables: TableWithTab[];
  products: Product[];
  onClose: () => void;
  onRequestCloseTab: (tab: TabDetail) => void;
  onRefreshParent: () => void;
}

export const TableTabDetailModal: React.FC<TableTabDetailModalProps> = ({
  tabId,
  isOpen,
  allTables,
  products,
  onClose,
  onRequestCloseTab,
  onRefreshParent,
}) => {
  const [tabDetail, setTabDetail] = useState<TabDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');

  // Add Item state
  const [prodSearch, setProdSearch] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<ProductCategory | 'todas'>('todas');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [itemSaleUnit, setItemSaleUnit] = useState<SaleUnit>('unit');
  const [itemQuantity, setItemQuantity] = useState<number>(1);
  const [itemNotes, setItemNotes] = useState<string>('');
  const [isAddingItem, setIsAddingItem] = useState<boolean>(false);
  const [addItemError, setAddItemError] = useState<string>('');

  // Edit Tab metadata
  const [isEditingMeta, setIsEditingMeta] = useState<boolean>(false);
  const [metaCustomerName, setMetaCustomerName] = useState<string>('');
  const [metaPeopleCount, setMetaPeopleCount] = useState<number>(1);
  const [metaNotes, setMetaNotes] = useState<string>('');

  // Sub-dialog states
  const [moveModalOpen, setMoveModalOpen] = useState<boolean>(false);
  const [joinModalOpen, setJoinModalOpen] = useState<boolean>(false);
  const [selectedJoinTableId, setSelectedJoinTableId] = useState<string>('');
  const [isJoiningTable, setIsJoiningTable] = useState<boolean>(false);
  const [joinError, setJoinError] = useState<string>('');

  const [transferItem, setTransferItem] = useState<TableTabItem | null>(null);
  const [targetTabId, setTargetTabId] = useState<string>('');
  const [targetTableId, setTargetTableId] = useState<string>('');

  // In-screen action error & confirmation modal states
  const [actionError, setActionError] = useState<string>('');

  const [itemToCancel, setItemToCancel] = useState<TableTabItem | null>(null);
  const [isCancellingItem, setIsCancellingItem] = useState<boolean>(false);

  const [tableToUnjoin, setTableToUnjoin] = useState<LinkedTable | null>(null);
  const [isUnjoiningTable, setIsUnjoiningTable] = useState<boolean>(false);

  const [isCancelTabModalOpen, setIsCancelTabModalOpen] = useState<boolean>(false);
  const [cancelTabReason, setCancelTabReason] = useState<string>('');
  const [isCancellingTab, setIsCancellingTab] = useState<boolean>(false);

  const [lastLaunchedItemKey, setLastLaunchedItemKey] = useState<{
    productId: string;
    saleUnit: SaleUnit;
    ts: number;
  } | null>(null);

  const loadDetail = async () => {
    if (!tabId) return;
    try {
      const data = await api.getTabDetail(tabId);
      setTabDetail(data);
      setMetaCustomerName(data.customerName || '');
      setMetaPeopleCount(data.peopleCount || 1);
      setMetaNotes(data.notes || '');
      setError('');
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar detalhes da comanda.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && tabId) {
      setLoading(true);
      setActionError('');
      setItemToCancel(null);
      setTableToUnjoin(null);
      setIsCancelTabModalOpen(false);
      setLastLaunchedItemKey(null);
      loadDetail();
    } else {
      setTabDetail(null);
      setSelectedProduct(null);
      setItemSaleUnit('unit');
      setItemQuantity(1);
      setItemNotes('');
      setProdSearch('');
      setIsEditingMeta(false);
      setActionError('');
      setItemToCancel(null);
      setTableToUnjoin(null);
      setIsCancelTabModalOpen(false);
      setLastLaunchedItemKey(null);
    }
  }, [isOpen, tabId]);

  useEffect(() => {
    if (!lastLaunchedItemKey || !tabDetail) return;
    const timer = window.setTimeout(() => {
      const exactEl = document.querySelector(
        `[data-tab-item="${lastLaunchedItemKey.productId}::${lastLaunchedItemKey.saleUnit}"]`
      );
      const fallbackEl = document.querySelector(
        `[data-tab-item-product="${lastLaunchedItemKey.productId}"]`
      );
      const targetEl = exactEl || fallbackEl;
      if (targetEl && typeof (targetEl as HTMLElement).scrollIntoView === 'function') {
        (targetEl as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setLastLaunchedItemKey(null);
    }, 80);
    return () => window.clearTimeout(timer);
  }, [lastLaunchedItemKey, tabDetail]);

  // Filter products for launching items
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.active) return false;
      if (categoryFilter !== 'todas' && p.category !== categoryFilter) return false;
      if (prodSearch.trim()) {
        const q = prodSearch.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku ? p.sku.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesSku) return false;
      }
      return true;
    });
  }, [products, categoryFilter, prodSearch]);

  // Other open tabs for transfer (only primary tables with open tabs, excluding joined tables)
  const otherOpenTables = useMemo(() => {
    return allTables.filter((t) => t.currentTab && t.currentTab.id !== tabId && !t.joinedToTabId);
  }, [allTables, tabId]);

  // Free tables for move (not occupied, not joined)
  const freeTables = useMemo(() => {
    return allTables.filter((t) => !t.currentTab && !t.joinedToTabId && t.active);
  }, [allTables]);

  // Active tables available to join (excluding current table, tables already joined, and secondary tables)
  const joinableTables = useMemo(() => {
    if (!tabDetail) return [];
    return allTables.filter((t) => {
      if (!t.active) return false;
      if (t.id === tabDetail.tableId) return false;
      if (tabDetail.linkedTables?.some((lt) => lt.id === t.id)) return false;
      if (t.joinedToTabId) return false;
      return true;
    });
  }, [allTables, tabDetail]);

  const allTableNumbers = useMemo(() => {
    if (!tabDetail) return '';
    const nums = [
      tabDetail.tableNumber,
      ...(tabDetail.linkedTables || []).map((lt) => lt.number),
    ].sort((a, b) => a - b);
    return nums.join(' + ');
  }, [tabDetail]);

  if (!isOpen || !tabId) return null;

  // Add Item Handler
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) {
      setAddItemError('Selecione um produto.');
      return;
    }
    if (itemQuantity <= 0) {
      setAddItemError('A quantidade deve ser maior que zero.');
      return;
    }
    const isCase = itemSaleUnit === 'case' && hasProductCase(selectedProduct);
    const unitsPerSale = isCase ? Number(selectedProduct.caseSize) : 1;
    const totalUnitsNeeded = itemQuantity * unitsPerSale;

    if (selectedProduct.stock < totalUnitsNeeded) {
      setAddItemError(
        `Estoque insuficiente (${formatStockWithCases(selectedProduct.stock, selectedProduct.caseSize)} disponível).`
      );
      return;
    }

    const launchedProductId = selectedProduct.id;
    const launchedSaleUnit: SaleUnit = isCase ? 'case' : 'unit';

    setIsAddingItem(true);
    setAddItemError('');

    try {
      await api.addTabItem(tabId, {
        product_id: launchedProductId,
        quantity: itemQuantity,
        sale_unit: launchedSaleUnit,
        notes: itemNotes.trim() || undefined,
      });

      setSelectedProduct(null);
      setItemSaleUnit('unit');
      setItemQuantity(1);
      setItemNotes('');
      await loadDetail();
      setLastLaunchedItemKey({
        productId: launchedProductId,
        saleUnit: launchedSaleUnit,
        ts: Date.now(),
      });
      onRefreshParent();
    } catch (err: any) {
      setAddItemError(err.message || 'Erro ao adicionar item.');
    } finally {
      setIsAddingItem(false);
    }
  };

  // Cancel Item Handler
  const handleConfirmCancelItem = async () => {
    if (!itemToCancel || !tabId) return;
    setIsCancellingItem(true);
    setActionError('');

    try {
      await api.cancelTabItem(tabId, itemToCancel.id);
      setItemToCancel(null);
      await loadDetail();
      onRefreshParent();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao cancelar item.');
    } finally {
      setIsCancellingItem(false);
    }
  };

  // Transfer Item Handler
  const handleTransferItem = async () => {
    if (!transferItem || !targetTabId) return;
    setActionError('');

    try {
      await api.transferTabItem(tabId, transferItem.id, targetTabId);
      setTransferItem(null);
      setTargetTabId('');
      await loadDetail();
      onRefreshParent();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao transferir item.');
    }
  };

  // Move Tab Handler
  const handleMoveTab = async () => {
    if (!targetTableId) return;
    setActionError('');

    try {
      await api.moveTab(tabId, targetTableId);
      setMoveModalOpen(false);
      setTargetTableId('');
      await loadDetail();
      onRefreshParent();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao trocar de mesa.');
    }
  };

  // Join Table Handler
  const handleJoinTable = async () => {
    if (!selectedJoinTableId) return;
    setIsJoiningTable(true);
    setJoinError('');

    try {
      await api.joinTableToTab(tabId, selectedJoinTableId);
      setJoinModalOpen(false);
      setSelectedJoinTableId('');
      await loadDetail();
      onRefreshParent();
    } catch (err: any) {
      setJoinError(err.message || 'Erro ao juntar mesa.');
    } finally {
      setIsJoiningTable(false);
    }
  };

  // Unjoin Table Handler
  const handleConfirmUnjoinTable = async () => {
    if (!tableToUnjoin || !tabId) return;
    setIsUnjoiningTable(true);
    setActionError('');

    try {
      await api.unjoinTableFromTab(tabId, tableToUnjoin.id);
      setTableToUnjoin(null);
      await loadDetail();
      onRefreshParent();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao separar mesa.');
    } finally {
      setIsUnjoiningTable(false);
    }
  };

  // Cancel Tab Handler
  const handleConfirmCancelTab = async () => {
    if (!tabId) return;
    setIsCancellingTab(true);
    setActionError('');

    try {
      await api.cancelTab(tabId, cancelTabReason.trim() || undefined);
      setIsCancelTabModalOpen(false);
      onRefreshParent();
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao cancelar comanda.');
    } finally {
      setIsCancellingTab(false);
    }
  };

  // Save Meta Handler
  const handleSaveMeta = async () => {
    setActionError('');
    try {
      await api.updateTabInfo(tabId, {
        customer_name: metaCustomerName.trim() || undefined,
        people_count: metaPeopleCount,
        notes: metaNotes.trim() || undefined,
      });
      setIsEditingMeta(false);
      await loadDetail();
      onRefreshParent();
    } catch (err: any) {
      setActionError(err.message || 'Erro ao atualizar dados da comanda.');
    }
  };

  const activeItems = tabDetail?.items.filter((i) => i.status === 'active') || [];
  const cancelledItems = tabDetail?.items.filter((i) => i.status === 'cancelled') || [];

  const groupedActiveItems = (() => {
    const map = new Map<
      string,
      {
        key: string;
        productId: string;
        productName: string;
        saleUnit: SaleUnit;
        unitsPerSale: number;
        unitPrice: number;
        quantity: number;
        notesList: string[];
        items: TableTabItem[];
      }
    >();

    for (const item of activeItems) {
      const saleUnit: SaleUnit = item.saleUnit === 'case' ? 'case' : 'unit';
      const unitsPerSale = item.unitsPerSale && item.unitsPerSale > 1 ? item.unitsPerSale : 1;
      const key = `${item.productId}::${saleUnit}::${Number(item.unitPrice).toFixed(2)}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += item.quantity;
        if (item.notes && !existing.notesList.includes(item.notes)) {
          existing.notesList.push(item.notes);
        }
        existing.items.push(item);
      } else {
        map.set(key, {
          key,
          productId: item.productId,
          productName: item.productName,
          saleUnit,
          unitsPerSale,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          notesList: item.notes ? [item.notes] : [],
          items: [item],
        });
      }
    }

    return Array.from(map.values());
  })();

  const timeElapsedMinutes = tabDetail
    ? Math.max(0, Math.floor((Date.now() - new Date(tabDetail.openedAt).getTime()) / 60000))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-none sm:rounded-3xl w-full max-w-5xl h-[100dvh] sm:h-[94vh] shadow-2xl border-0 sm:border border-neutral-100 overflow-hidden flex flex-col relative">
        {/* Single Scroll Container on <640px, Flex Column on >=640px */}
        <div className="flex-1 overflow-y-auto sm:overflow-hidden flex flex-col">
          {/* Top Header */}
          <div className="bg-neutral-900 px-4 py-3.5 sm:px-6 sm:py-4 text-white flex items-center justify-between border-b border-neutral-800 shrink-0">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-amber-500 text-neutral-950 font-black text-lg sm:text-xl flex items-center justify-center shadow-md shrink-0">
                {tabDetail?.tableNumber || '?'}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-black">
                    Mesa {allTableNumbers}
                    {tabDetail?.tableLabel ? ` • ${tabDetail.tableLabel}` : ''}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Aberta
                  </span>
                  {tabDetail?.linkedTables && tabDetail.linkedTables.length > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      +{tabDetail.linkedTables.length} {tabDetail.linkedTables.length === 1 ? 'mesa juntada' : 'mesas juntadas'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 sm:gap-3 text-xs text-neutral-400 mt-0.5 flex-wrap">
                  <span className="flex items-center gap-1 font-semibold text-neutral-200">
                    <Users className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    {tabDetail?.customerName || 'Cliente não identificado'} ({tabDetail?.peopleCount} {tabDetail?.peopleCount === 1 ? 'pessoa' : 'pessoas'})
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    Aberta há {timeElapsedMinutes} min
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setIsEditingMeta(!isEditingMeta)}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-neutral-300 text-xs font-bold transition-colors flex items-center gap-1.5"
                title="Editar dados do cliente e pessoas"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Editar Mesa</span>
              </button>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Linked Tables Bar (when tab has joined tables) */}
          {tabDetail?.linkedTables && tabDetail.linkedTables.length > 0 && (
            <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs animate-in slide-in-from-top-1 shrink-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-amber-950 flex items-center gap-1.5">
                  <span>🔗</span>
                  <span>Mesas juntadas:</span>
                </span>
                {tabDetail.linkedTables.map((lt) => (
                  <span
                    key={lt.id}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-amber-300 text-neutral-900 font-bold shadow-2xs text-[11px]"
                  >
                    <span>Mesa {lt.number}{lt.label ? ` (${lt.label})` : ''}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setActionError('');
                        setTableToUnjoin(lt);
                      }}
                      className="text-neutral-400 hover:text-red-600 transition-colors ml-1 p-0.5 rounded hover:bg-neutral-100 flex items-center gap-1 text-[10px] font-black text-red-600"
                      title={`Separar a Mesa ${lt.number} desta comanda?`}
                    >
                      <X className="w-3 h-3" />
                      <span>Separar</span>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Action Error Banner */}
          {actionError && (
            <div className="mx-4 sm:mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between gap-2 text-xs text-red-700 font-bold animate-in fade-in shrink-0">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
              <button
                onClick={() => setActionError('')}
                className="text-red-500 hover:text-red-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Optional Edit Meta Bar */}
          {isEditingMeta && (
            <div className="bg-neutral-800 p-4 border-b border-neutral-700 text-white flex flex-wrap items-center gap-3 text-xs animate-in slide-in-from-top-2 shrink-0">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-neutral-400 text-[10px] font-bold uppercase mb-1">
                  Nome do Cliente / Identificação
                </label>
                <input
                  type="text"
                  value={metaCustomerName}
                  onChange={(e) => setMetaCustomerName(e.target.value)}
                  placeholder="Ex: Carlos..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="w-32">
                <label className="block text-neutral-400 text-[10px] font-bold uppercase mb-1">
                  Pessoas
                </label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={metaPeopleCount}
                  onChange={(e) => setMetaPeopleCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="flex-1 min-w-[220px]">
                <label className="block text-neutral-400 text-[10px] font-bold uppercase mb-1">
                  Observações
                </label>
                <input
                  type="text"
                  value={metaNotes}
                  onChange={(e) => setMetaNotes(e.target.value)}
                  placeholder="Ex: Balde de gelo, taças..."
                  className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-1.5 text-xs text-white"
                />
              </div>

              <div className="flex items-end gap-2 pt-4">
                <button
                  onClick={handleSaveMeta}
                  className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black rounded-xl text-xs"
                >
                  Salvar
                </button>
                <button
                  onClick={() => setIsEditingMeta(false)}
                  className="px-3 py-1.5 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 font-bold rounded-xl text-xs"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Main Body: Single flow on <640px, 2 Columns on Desktop */}
          <div className="sm:flex-1 sm:overflow-hidden grid grid-cols-1 lg:grid-cols-12">
            {/* LEFT COLUMN: Items List (Col 7) */}
            <div className="lg:col-span-7 lg:border-r border-neutral-200 flex flex-col sm:h-full sm:overflow-hidden bg-neutral-50/50">
              {/* Items Header */}
              <div className="p-4 bg-white border-b border-neutral-200 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-sm font-black text-neutral-900">Itens Consumidos</h3>
                  <p className="text-xs text-neutral-500">
                    {activeItems.length} {activeItems.length === 1 ? 'lançamento' : 'lançamentos'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Subtotal</span>
                  <span className="text-xl font-black text-amber-600">
                    R$ {(tabDetail?.subtotal || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Items List (full height without inner scroll on <640px, scrollable on >=640px) */}
              <div className="sm:flex-1 sm:overflow-y-auto p-4 space-y-2">
                {loading ? (
                  <div className="p-12 text-center text-xs text-neutral-400 font-bold">
                    Carregando itens da comanda...
                  </div>
                ) : groupedActiveItems.length === 0 ? (
                  <div className="p-8 sm:p-12 text-center bg-white rounded-2xl border border-dashed border-neutral-300">
                    <Receipt className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
                    <p className="text-xs font-bold text-neutral-700">Nenhum item na comanda ainda</p>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      Selecione produtos no catálogo para lançar.
                    </p>
                  </div>
                ) : (
                  groupedActiveItems.map((group) => {
                    const isCase = group.saleUnit === 'case' && group.unitsPerSale > 1;
                    const totalUnits = group.quantity * group.unitsPerSale;
                    const targetItem = group.items[group.items.length - 1];
                    return (
                      <div
                        key={group.key}
                        data-tab-item={`${group.productId}::${group.saleUnit}`}
                        data-tab-item-product={group.productId}
                        className="p-3 bg-white rounded-2xl border border-neutral-200 shadow-2xs flex items-center justify-between gap-3 hover:border-amber-300 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="px-2 h-9 min-w-[36px] rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-black text-xs flex items-center justify-center shrink-0">
                            {isCase ? `${group.quantity} cx` : `${group.quantity}x`}
                          </div>
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-neutral-900 block">
                              {isCase
                                ? `${group.quantity} cx ${group.productName} (${totalUnits} un)`
                                : group.productName}
                            </span>
                            <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-0.5 flex-wrap">
                              <span>
                                R$ {group.unitPrice.toFixed(2)}{' '}
                                {isCase ? `a caixa (c/${group.unitsPerSale})` : 'cada'}
                              </span>
                              <span>•</span>
                              <span className="font-black text-neutral-800">
                                Total: R$ {(group.unitPrice * group.quantity).toFixed(2)}
                              </span>
                            </div>
                            {group.notesList.length > 0 && (
                              <span className="inline-block mt-1 text-[10px] font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md">
                                Obs: {group.notesList.join(' | ')}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {/* Transfer Item Button */}
                          {otherOpenTables.length > 0 && (
                            <button
                              onClick={() => {
                                setTransferItem(targetItem);
                                setTargetTabId(otherOpenTables[0]?.currentTab?.id || '');
                              }}
                              className="p-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 transition-colors"
                              title="Transferir item para outra mesa"
                            >
                              <ArrowRightLeft className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Cancel Item Button (restores stock) */}
                          <button
                            onClick={() => {
                              setActionError('');
                              setItemToCancel(targetItem);
                            }}
                            className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 transition-colors"
                            title="Cancelar item (estorna estoque)"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}

                {/* Cancelled items audit view */}
                {cancelledItems.length > 0 && (
                  <div className="pt-3 border-t border-neutral-200">
                    <span className="text-[10px] font-black uppercase text-neutral-400 tracking-wider block mb-2">
                      Itens Cancelados ({cancelledItems.length})
                    </span>
                    <div className="space-y-1">
                      {cancelledItems.map((c) => {
                        const isCase = c.saleUnit === 'case' && (c.unitsPerSale || 1) > 1;
                        const totalUnits = c.quantity * (c.unitsPerSale || 1);
                        return (
                          <div
                            key={c.id}
                            className="p-2 rounded-xl bg-neutral-100 text-neutral-400 text-[11px] flex justify-between items-center line-through"
                          >
                            <span>
                              {isCase
                                ? `${c.quantity} cx ${c.productName} (${totalUnits} un)`
                                : `${c.quantity}x ${c.productName}`}
                            </span>
                            <span>Cancelado</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Tab Operations Bar */}
              <div className="p-4 bg-white border-t border-neutral-200 space-y-3 shrink-0">
                {/* Secondary operations */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetTableId(freeTables[0]?.id || '');
                      setMoveModalOpen(true);
                    }}
                    disabled={freeTables.length === 0}
                    className="px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-700 text-xs font-bold transition-colors flex items-center gap-1.5"
                  >
                    <MoveRight className="w-3.5 h-3.5 text-neutral-500" />
                    <span>Trocar de Mesa</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedJoinTableId(joinableTables[0]?.id || '');
                      setJoinError('');
                      setJoinModalOpen(true);
                    }}
                    disabled={joinableTables.length === 0}
                    className="px-3 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-700 text-xs font-bold transition-colors flex items-center gap-1.5"
                  >
                    <Merge className="w-3.5 h-3.5 text-neutral-500" />
                    <span>Juntar Mesas</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCancelTabReason('');
                      setActionError('');
                      setIsCancelTabModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold transition-colors ml-auto flex items-center gap-1.5"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    <span>Cancelar Comanda</span>
                  </button>
                </div>

                {/* Primary Close Button (>=640px) */}
                <button
                  type="button"
                  onClick={() => tabDetail && onRequestCloseTab(tabDetail)}
                  className="hidden sm:flex w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-black shadow-lg hover:shadow-xl transition-all items-center justify-center gap-2"
                >
                  <Receipt className="w-5 h-5" />
                  <span>Fechar Conta • R$ {(tabDetail?.subtotal || 0).toFixed(2)}</span>
                </button>
              </div>
            </div>

            {/* RIGHT COLUMN: Launch Products Catalog (Col 5) */}
            <div className="lg:col-span-5 flex flex-col sm:h-full sm:overflow-hidden bg-white border-t sm:border-t-0 border-neutral-200">
              {/* Search and Category Filters */}
              <div className="p-4 border-b border-neutral-200 space-y-3 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="text"
                    value={prodSearch}
                    onChange={(e) => setProdSearch(e.target.value)}
                    placeholder="Buscar produto por nome ou código..."
                    className="w-full bg-neutral-100 border border-neutral-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px]">
                  {[
                    { id: 'todas', label: 'Todos' },
                    { id: 'cervejas', label: 'Cervejas' },
                    { id: 'destilados', label: 'Destilados' },
                    { id: 'vinhos', label: 'Vinhos' },
                    { id: 'nao_alcoolicos', label: 'Não Alcoólicos' },
                    { id: 'gelo_carvao', label: 'Gelo & Carvão' },
                    { id: 'petiscos', label: 'Petiscos' },
                  ].map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCategoryFilter(c.id as any)}
                      className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap transition-colors ${
                        categoryFilter === c.id
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Products Grid / List */}
              <div className="sm:flex-1 sm:overflow-y-auto p-3 space-y-2 pb-6 sm:pb-3">
                {filteredProducts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-neutral-400">
                    Nenhum produto encontrado.
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const isSelected = selectedProduct?.id === p.id;
                    const isPromo = isProductPromoActive(p);
                    const effectivePrice = getEffectiveProductPrice(p);
                    const hasCase = hasProductCase(p);
                    const isOutOfStock = p.stock <= 0;

                    return (
                      <div
                        key={p.id}
                        onClick={() => {
                          if (!isOutOfStock) {
                            setSelectedProduct(p);
                            setItemSaleUnit('unit');
                            setItemQuantity(1);
                            setAddItemError('');
                          }
                        }}
                        className={`p-2.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500/10 shadow-xs'
                            : isOutOfStock
                            ? 'opacity-40 bg-neutral-50 border-neutral-200 cursor-not-allowed'
                            : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {p.image ? (
                            <img
                              src={p.image}
                              alt={p.name}
                              className="w-10 h-10 rounded-xl object-cover bg-neutral-100 shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 font-bold text-xs flex items-center justify-center shrink-0">
                              🍺
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-neutral-900 truncate">
                                {p.name}
                              </span>
                              {p.isCold && <Snowflake className="w-3 h-3 text-sky-500 shrink-0" />}
                              {isPromo && (
                                <span className="px-1 py-0.2 bg-red-100 text-red-700 text-[9px] font-black rounded uppercase shrink-0">
                                  PROMO
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-neutral-400 mt-0.5 flex-wrap">
                              <span>{p.volume}</span>
                              <span>•</span>
                              <span className={p.stock <= p.minStock ? 'text-amber-600 font-bold' : ''}>
                                Estoque: {formatStockWithCases(p.stock, p.caseSize)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {isPromo && (
                            <span className="text-[10px] text-neutral-400 line-through block">
                              R$ {p.price.toFixed(2)}
                            </span>
                          )}
                          <span className="text-xs font-black text-neutral-900 block">
                            R$ {effectivePrice.toFixed(2)}
                          </span>
                          {hasCase && (
                            <span className="text-[10px] font-bold text-amber-700 block">
                              Cx c/{p.caseSize}: R$ {Number(p.casePrice).toFixed(2)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Launch Form Bar (Fixed bottom drawer on <640px, bottom of right column on >=640px) */}
              {selectedProduct && (() => {
                const hasCase = hasProductCase(selectedProduct);
                const caseUnavailable = hasCase && selectedProduct.stock < Number(selectedProduct.caseSize);
                const isCase = itemSaleUnit === 'case' && hasCase && !caseUnavailable;
                const unitEffPrice = getEffectiveProductPrice(selectedProduct);
                const activeUnitPrice = isCase ? Number(selectedProduct.casePrice) : unitEffPrice;
                const maxQty = isCase
                  ? Math.max(1, Math.floor(selectedProduct.stock / Number(selectedProduct.caseSize)))
                  : Math.max(1, selectedProduct.stock);

                return (
                  <>
                    {/* Mobile Drawer Backdrop (<640px) */}
                    <div
                      onClick={() => setSelectedProduct(null)}
                      className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] sm:hidden animate-in fade-in duration-150"
                    />
                    <form
                      onSubmit={handleAddItem}
                      className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-white p-4 shadow-2xl border-t border-neutral-200 space-y-3 animate-in slide-in-from-bottom-2 sm:static sm:z-auto sm:rounded-none sm:bg-neutral-50 sm:shadow-none shrink-0"
                    >
                      {addItemError && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-[11px] text-red-700 font-bold">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{addItemError}</span>
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Lançar Item</span>
                          <span className="text-xs font-black text-neutral-900 truncate block">
                            {selectedProduct.name}
                            {isCase ? ` — Caixa c/${selectedProduct.caseSize}` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-black text-amber-600">
                            R$ {(activeUnitPrice * itemQuantity).toFixed(2)}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedProduct(null)}
                            aria-label="Fechar lançamento de item"
                            className="w-8 h-8 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 flex items-center justify-center transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {hasCase && (
                        <div className="space-y-1">
                          <div className="grid grid-cols-2 gap-1.5 p-1 bg-white rounded-xl border border-neutral-200">
                            <button
                              type="button"
                              onClick={() => {
                                setItemSaleUnit('unit');
                                setItemQuantity(1);
                              }}
                              className={`py-2 sm:py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all text-center ${
                                !isCase
                                  ? 'bg-neutral-900 text-white shadow-2xs'
                                  : 'text-neutral-600 hover:bg-neutral-100'
                              }`}
                            >
                              Unidade • R$ {unitEffPrice.toFixed(2)}
                            </button>
                            <button
                              type="button"
                              disabled={caseUnavailable}
                              onClick={() => {
                                setItemSaleUnit('case');
                                setItemQuantity(1);
                              }}
                              className={`py-2 sm:py-1.5 px-2 rounded-lg text-[11px] font-bold transition-all text-center ${
                                caseUnavailable
                                  ? 'opacity-40 cursor-not-allowed text-neutral-400'
                                  : isCase
                                  ? 'bg-amber-500 text-neutral-950 shadow-2xs'
                                  : 'text-neutral-600 hover:bg-neutral-100'
                              }`}
                            >
                              Caixa c/{selectedProduct.caseSize} • R$ {Number(selectedProduct.casePrice).toFixed(2)}
                            </button>
                          </div>
                          {caseUnavailable && (
                            <p className="text-[10px] text-neutral-400 font-semibold text-center">
                              sem caixa fechada no estoque
                            </p>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3 items-center">
                        {/* Quantity selector (at least 40x40px on mobile) */}
                        <div className="flex items-center gap-1.5 bg-white border border-neutral-200 rounded-xl p-1">
                          <button
                            type="button"
                            onClick={() => setItemQuantity((q) => Math.max(1, q - 1))}
                            className="w-10 h-10 min-w-[40px] min-h-[40px] sm:w-8 sm:h-8 sm:min-w-[32px] sm:min-h-[32px] shrink-0 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-black flex items-center justify-center transition-colors"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            max={maxQty}
                            value={itemQuantity}
                            onChange={(e) => setItemQuantity(Math.max(1, Math.min(maxQty, parseInt(e.target.value, 10) || 1)))}
                            className="w-full min-w-0 text-center text-xs font-black text-neutral-900 focus:outline-hidden"
                          />
                          <button
                            type="button"
                            onClick={() => setItemQuantity((q) => Math.min(maxQty, q + 1))}
                            className="w-10 h-10 min-w-[40px] min-h-[40px] sm:w-8 sm:h-8 sm:min-w-[32px] sm:min-h-[32px] shrink-0 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-black flex items-center justify-center transition-colors"
                          >
                            +
                          </button>
                        </div>

                        {/* Submit Button */}
                        <button
                          type="submit"
                          disabled={isAddingItem || selectedProduct.stock <= 0}
                          className="w-full h-12 sm:h-auto py-2.5 px-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          <span>{isAddingItem ? 'Lançando...' : 'Adicionar'}</span>
                        </button>
                      </div>

                      {/* Optional Item Note */}
                      <input
                        type="text"
                        value={itemNotes}
                        onChange={(e) => setItemNotes(e.target.value)}
                        placeholder="Observação do item (ex: bem gelada, sem gelo)..."
                        className="w-full bg-white border border-neutral-200 rounded-xl px-3 py-2 sm:py-1.5 text-[11px] font-medium text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                      />
                    </form>
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Fixed Mobile Footer (<640px): Fechar Conta always visible */}
        <div className="sm:hidden p-3 bg-white border-t border-neutral-200 shrink-0 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            onClick={() => tabDetail && onRequestCloseTab(tabDetail)}
            className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-black shadow-lg transition-all flex items-center justify-center gap-2"
          >
            <Receipt className="w-5 h-5" />
            <span>Fechar Conta • R$ {(tabDetail?.subtotal || 0).toFixed(2)}</span>
          </button>
        </div>

        {/* Sub-Dialog: Move Tab to Another Table */}
        {moveModalOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-neutral-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-neutral-900">Trocar de Mesa</h3>
                <button onClick={() => setMoveModalOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-neutral-600">
                Selecione para qual mesa livre deseja transferir esta comanda:
              </p>
              <select
                value={targetTableId}
                onChange={(e) => setTargetTableId(e.target.value)}
                className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3 py-2.5 text-xs font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                {freeTables.map((t) => (
                  <option key={t.id} value={t.id}>
                    Mesa {t.number} {t.label ? `(${t.label})` : ''} - {t.seats || 2} lugares
                  </option>
                ))}
              </select>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMoveModalOpen(false)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleMoveTab}
                  disabled={!targetTableId}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-black rounded-xl shadow-xs"
                >
                  Confirmar Troca
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Dialog: Join Table to Tab */}
        {joinModalOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-neutral-200 space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                    <Merge className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-black text-neutral-900">Juntar Mesas</h3>
                </div>
                <button onClick={() => setJoinModalOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs text-neutral-600">
                Selecione a mesa que deseja juntar à <strong>Mesa {allTableNumbers}</strong>:
              </p>

              {joinError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{joinError}</span>
                </div>
              )}

              <select
                value={selectedJoinTableId}
                onChange={(e) => {
                  setSelectedJoinTableId(e.target.value);
                  setJoinError('');
                }}
                className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3 py-2.5 text-xs font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                {joinableTables.map((t) => {
                  const isOcc = Boolean(t.currentTab);
                  return (
                    <option key={t.id} value={t.id}>
                      Mesa {t.number} {t.label ? `(${t.label})` : ''} — {isOcc ? `Ocupada (R$ ${(t.currentTab?.subtotal || 0).toFixed(2)})` : 'Livre'}
                    </option>
                  );
                })}
              </select>

              {/* Dynamic explanation message based on chosen table */}
              {(() => {
                const targetTable = joinableTables.find((t) => t.id === selectedJoinTableId);
                if (!targetTable) return null;
                const hasOpenTab = Boolean(targetTable.currentTab);
                return (
                  <div
                    className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                      hasOpenTab
                        ? 'bg-amber-50/80 border-amber-200 text-amber-900'
                        : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    <span className="font-black text-xs block">
                      {hasOpenTab ? '⚠️ Mesa com comanda aberta' : '✨ Mesa livre'}
                    </span>
                    <p className="text-[11px] leading-relaxed">
                      {hasOpenTab
                        ? `A Mesa ${targetTable.number} já tem comanda aberta (R$ ${(targetTable.currentTab?.subtotal || 0).toFixed(2)}). Ao juntar, todos os itens serão transferidos para esta conta e as pessoas serão somadas.`
                        : `A Mesa ${targetTable.number} será adicionada a esta conta.`}
                    </p>
                  </div>
                );
              })()}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setJoinModalOpen(false)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleJoinTable}
                  disabled={!selectedJoinTableId || isJoiningTable}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-neutral-950 text-xs font-black rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <Merge className="w-4 h-4" />
                  <span>{isJoiningTable ? 'Juntando...' : 'Confirmar e Juntar'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sub-Dialog: Transfer Item to another Tab */}
        {transferItem && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-neutral-200 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-black text-neutral-900">Transferir Item</h3>
                <button onClick={() => setTransferItem(null)} className="text-neutral-400 hover:text-neutral-600">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-xs text-neutral-600">
                Transferir{' '}
                <strong>
                  {transferItem.saleUnit === 'case' && (transferItem.unitsPerSale || 1) > 1
                    ? `${transferItem.quantity} cx ${transferItem.productName} (${transferItem.quantity * (transferItem.unitsPerSale || 1)} un)`
                    : `${transferItem.quantity}x ${transferItem.productName}`}
                </strong>{' '}
                para:
              </p>
              <select
                value={targetTabId}
                onChange={(e) => setTargetTabId(e.target.value)}
                className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3 py-2.5 text-xs font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              >
                {otherOpenTables.map((t) => (
                  <option key={t.currentTab?.id} value={t.currentTab?.id}>
                    Mesa {t.number} - {t.currentTab?.customerName || 'Cliente'}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferItem(null)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold rounded-xl"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleTransferItem}
                  disabled={!targetTabId}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-black rounded-xl shadow-xs"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-Screen Confirmation Modal: Cancelar Item */}
        {itemToCancel && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-neutral-100 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-neutral-900">Cancelar item</h3>
                  <p className="text-xs text-neutral-500">
                    Deseja cancelar{' '}
                    {itemToCancel.saleUnit === 'case' && (itemToCancel.unitsPerSale || 1) > 1
                      ? `${itemToCancel.quantity} cx "${itemToCancel.productName}" (${itemToCancel.quantity * (itemToCancel.unitsPerSale || 1)} un)`
                      : `${itemToCancel.quantity}x "${itemToCancel.productName}"`}
                    ? O estoque será devolvido automaticamente.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setItemToCancel(null)}
                  disabled={isCancellingItem}
                  className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-bold transition-colors"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancelItem}
                  disabled={isCancellingItem}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                >
                  {isCancellingItem ? 'Cancelando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-Screen Confirmation Modal: Separar Mesa */}
        {tableToUnjoin && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-neutral-100 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Merge className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-neutral-900">Separar mesa</h3>
                  <p className="text-xs text-neutral-500">
                    Deseja separar a Mesa {tableToUnjoin.number} desta comanda? Os itens continuarão nesta conta.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTableToUnjoin(null)}
                  disabled={isUnjoiningTable}
                  className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-bold transition-colors"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmUnjoinTable}
                  disabled={isUnjoiningTable}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-neutral-950 rounded-xl text-xs font-black transition-colors shadow-xs"
                >
                  {isUnjoiningTable ? 'Separando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* In-Screen Confirmation Modal: Cancelar Comanda */}
        {isCancelTabModalOpen && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl border border-neutral-100 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <Ban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-neutral-900">Cancelar comanda</h3>
                  <p className="text-xs text-neutral-500">
                    Tem certeza que deseja cancelar esta comanda? O estoque de todos os itens ativos será devolvido automaticamente.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Motivo do cancelamento (opcional):
                </label>
                <input
                  type="text"
                  value={cancelTabReason}
                  onChange={(e) => setCancelTabReason(e.target.value)}
                  placeholder="Ex: Cliente desistiu, erro de lançamento..."
                  className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCancelTabModalOpen(false)}
                  disabled={isCancellingTab}
                  className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-bold transition-colors"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancelTab}
                  disabled={isCancellingTab}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                >
                  {isCancellingTab ? 'Cancelando...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
