import React, { useState, useEffect, useMemo } from 'react';
import {
  TabDetail,
  TableWithTab,
  Product,
  ProductCategory,
  TableTabItem,
  OrderItemComboComponent,
  LinkedTable,
  SaleUnit,
  StoreSettings,
  isProductPromoActive,
  getEffectiveProductPrice,
  hasProductCase,
  canSellProductCase,
  formatStockWithCases,
  resolveStoreCategories,
  sortProductsForStore,
  getProductAddonGroups,
  isComboProduct,
  calculateComboMetrics,
  formatOrderItemComboLine,
  formatUnitAndCaseCount,
  formatCartItemsUnitAndCaseSummary,
} from '../../../types';
import { api } from '../../../services/api';
import { ProductThumb } from '../../common/ProductThumb';
import {
  X,
  Search,
  Plus,
  Trash2,
  ArrowRightLeft,
  Merge,
  MoveRight,
  Receipt,
  Printer,
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
  settings?: StoreSettings;
  onClose: () => void;
  onRequestCloseTab: (tab: TabDetail) => void;
  onRefreshParent: () => void;
}

export const TableTabDetailModal: React.FC<TableTabDetailModalProps> = ({
  tabId,
  isOpen,
  allTables,
  products,
  settings,
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
  const [isPreBillModalOpen, setIsPreBillModalOpen] = useState<boolean>(false);

  const [isCompactLayout, setIsCompactLayout] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 640 || window.innerHeight < 800 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsCompactLayout(window.innerWidth < 640 || window.innerHeight < 800);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
    setIsAddingItem(false);
    setIsCancellingItem(false);
    setIsJoiningTable(false);
    setIsUnjoiningTable(false);
    setIsCancellingTab(false);
    if (isOpen && tabId) {
      setLoading(true);
      setActionError('');
      setItemToCancel(null);
      setTableToUnjoin(null);
      setIsCancelTabModalOpen(false);
      setIsPreBillModalOpen(false);
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
      setIsPreBillModalOpen(false);
      setLastLaunchedItemKey(null);
    }
  }, [isOpen, tabId]);

  // Reload open tab detail when central clock reports tabsChanged or when returning to the browser tab
  useEffect(() => {
    if (!isOpen || !tabId) return;

    const unsubscribeChanges = api.subscribeAdminChanges((changes) => {
      if (changes.tabsChanged) {
        loadDetail();
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadDetail();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      unsubscribeChanges();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
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

  const storeCategories = useMemo(
    () => resolveStoreCategories(settings, products),
    [settings, products]
  );

  const knownCategoryIds = useMemo(
    () => new Set(storeCategories.map((c) => c.id)),
    [storeCategories]
  );

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const categoryPills = useMemo(() => {
    const activeProds = products.filter((p) => p.active);
    const pills: { id: string; label: string }[] = [{ id: 'todas', label: 'Todos' }];
    for (const cat of storeCategories) {
      if (activeProds.some((p) => p.category === cat.id)) {
        pills.push({ id: cat.id, label: cat.name });
      }
    }
    if (activeProds.some((p) => !p.category || !knownCategoryIds.has(p.category))) {
      pills.push({ id: 'outros', label: 'Outros' });
    }
    return pills;
  }, [products, storeCategories, knownCategoryIds]);

  // Filter products for launching items (with owner's preferred products first + store sort order)
  const filteredProducts = useMemo(() => {
    const matching = products.filter((p) => {
      if (!p.active) return false;
      if (categoryFilter !== 'todas') {
        if (categoryFilter === 'outros') {
          if (p.category && knownCategoryIds.has(p.category)) return false;
        } else if (p.category !== categoryFilter) {
          return false;
        }
      }
      if (prodSearch.trim()) {
        const q = prodSearch.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesSku = p.sku ? p.sku.toLowerCase().includes(q) : false;
        if (!matchesName && !matchesSku) return false;
      }
      return true;
    });
    return sortProductsForStore(matching, settings, products);
  }, [products, categoryFilter, prodSearch, settings, knownCategoryIds]);

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

  useEffect(() => {
    if (!isOpen || !tabId) return;
    const closeKey = (settings?.shortcuts?.fecharModal || 'Escape').toUpperCase();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (window.innerWidth < 768) return;
      const pressed = e.key.toUpperCase();
      if (pressed === closeKey || (closeKey === 'ESC' && e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        if (isPreBillModalOpen) {
          setIsPreBillModalOpen(false);
        } else if (isCancelTabModalOpen) {
          setIsCancelTabModalOpen(false);
        } else if (tableToUnjoin) {
          setTableToUnjoin(null);
        } else if (itemToCancel) {
          setItemToCancel(null);
        } else if (transferItem) {
          setTransferItem(null);
        } else if (joinModalOpen) {
          setJoinModalOpen(false);
        } else if (moveModalOpen) {
          setMoveModalOpen(false);
        } else if (selectedProduct) {
          setSelectedProduct(null);
        } else if (isEditingMeta) {
          setIsEditingMeta(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    tabId,
    settings?.shortcuts,
    isPreBillModalOpen,
    isCancelTabModalOpen,
    tableToUnjoin,
    itemToCancel,
    transferItem,
    joinModalOpen,
    moveModalOpen,
    selectedProduct,
    isEditingMeta,
    onClose,
  ]);

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
    const isCase = itemSaleUnit === 'case' && canSellProductCase(selectedProduct, settings, 'local');
    const unitsPerSale = isCase ? Number(selectedProduct.caseSize) : 1;
    const totalUnitsNeeded = itemQuantity * unitsPerSale;

    if (selectedProduct.stock < totalUnitsNeeded) {
      setAddItemError(
        `Estoque insuficiente (${formatStockWithCases(selectedProduct.stock, selectedProduct.caseSize)} disponível).`
      );
      return;
    }

    const isSelectedCombo = isComboProduct(selectedProduct.id, settings);
    const launchedProductId = selectedProduct.id;
    const launchedSaleUnit: SaleUnit = !isSelectedCombo && isCase ? 'case' : 'unit';

    setIsAddingItem(true);
    setAddItemError('');

    try {
      await api.addTabItem(tabId, {
        product_id: launchedProductId,
        quantity: itemQuantity,
        ...(isSelectedCombo ? {} : { sale_unit: launchedSaleUnit }),
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
        comboItems?: OrderItemComboComponent[];
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
        if (!existing.comboItems && item.comboItems && item.comboItems.length > 0) {
          existing.comboItems = item.comboItems;
        }
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
          comboItems: item.comboItems && item.comboItems.length > 0 ? item.comboItems : undefined,
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

  const handleOpenPreBill = () => {
    if (!tabDetail) return;
    setIsPreBillModalOpen(true);
    window.setTimeout(() => {
      window.print();
    }, 120);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-none sm:rounded-3xl w-full max-w-5xl h-[100dvh] sm:h-[94vh] shadow-2xl border-0 sm:border border-neutral-100 overflow-hidden flex flex-col relative">
        {/* Single Scroll Container when <640px width or <800px height, Flex Column otherwise */}
        <div className={`flex-1 flex flex-col ${isCompactLayout ? 'overflow-y-auto' : 'overflow-hidden'}`}>
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

          {/* Main Body: Single flow when compact (<640px width or <800px height), 2 Columns on tall Desktop */}
          <div className={isCompactLayout ? 'grid grid-cols-1' : 'flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12'}>
            {/* LEFT COLUMN: Items List (Col 7) */}
            <div className={`lg:col-span-7 lg:border-r border-neutral-200 flex flex-col bg-neutral-50/50 ${isCompactLayout ? '' : 'h-full overflow-hidden'}`}>
              {/* Items Header */}
              <div className="p-4 bg-white border-b border-neutral-200 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-sm font-black text-neutral-900">Itens Consumidos</h3>
                  <p className="text-xs text-neutral-500">
                    {activeItems.length > 0
                      ? `${formatCartItemsUnitAndCaseSummary(activeItems)} (${activeItems.length} ${
                          activeItems.length === 1 ? 'lançamento' : 'lançamentos'
                        })`
                      : '0 un'}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider block">Subtotal</span>
                  <span className="text-xl font-black text-amber-600">
                    R$ {(tabDetail?.subtotal || 0).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Items List (full height without inner scroll when compact, scrollable on tall desktop) */}
              <div className={`p-4 space-y-2 ${isCompactLayout ? '' : 'flex-1 overflow-y-auto'}`}>
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
                    const groupProduct = productById.get(group.productId);
                    return (
                      <div
                        key={group.key}
                        data-tab-item={`${group.productId}::${group.saleUnit}`}
                        data-tab-item-product={group.productId}
                        className="p-3 bg-white rounded-2xl border border-neutral-200 shadow-2xs flex items-center justify-between gap-3 hover:border-amber-300 transition-colors"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="px-2 h-9 min-w-[36px] rounded-xl bg-amber-50 border border-amber-200 text-amber-900 font-black text-xs flex items-center justify-center shrink-0">
                            {isCase ? `${group.quantity} cx` : `${group.quantity} un`}
                          </div>
                          <ProductThumb
                            product={groupProduct}
                            alt={group.productName}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-neutral-900 block">
                              {isCase
                                ? `${group.quantity} cx (${totalUnits} un) — ${group.productName}`
                                : `${group.quantity} un — ${group.productName}`}
                            </span>
                            {group.comboItems && group.comboItems.length > 0 && (
                              <div className="mt-0.5 space-y-0.5">
                                {group.comboItems.map((ci, ciIdx) => (
                                  <p
                                    key={`${ci.productId}-${ciIdx}`}
                                    className="text-[11px] font-bold text-amber-800 leading-tight"
                                  >
                                    {formatOrderItemComboLine(ci)}
                                  </p>
                                ))}
                              </div>
                            )}
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

                {/* Primary Print & Close Buttons (Tall Desktop only; Compact uses sticky footer) */}
                {!isCompactLayout && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleOpenPreBill}
                      className="py-3.5 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border border-neutral-300 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 shrink-0"
                    >
                      <Printer className="w-4 h-4 text-neutral-700" />
                      <span>Imprimir conta</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => tabDetail && onRequestCloseTab(tabDetail)}
                      className="flex-1 py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-black shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-2"
                    >
                      <Receipt className="w-5 h-5" />
                      <span>Fechar Conta • R$ {(tabDetail?.subtotal || 0).toFixed(2)}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Launch Products Catalog (Col 5) */}
            <div className={`lg:col-span-5 flex flex-col bg-white border-neutral-200 ${isCompactLayout ? 'border-t' : 'h-full overflow-hidden'}`}>
              {/* Search and Category Filters */}
              <div className="p-4 border-b border-neutral-200 space-y-3 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-3 pointer-events-none" />
                  <input
                    type="text"
                    data-admin-search="comanda"
                    value={prodSearch}
                    onChange={(e) => setProdSearch(e.target.value)}
                    placeholder="Buscar produto por nome ou código..."
                    className="w-full bg-neutral-100 border border-neutral-200 rounded-xl pl-9 pr-3 py-2 text-xs font-semibold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                {/* Category Pills */}
                <div className="relative">
                  <div className="flex items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1 pr-8 sm:pr-0 text-[11px] scrollbar-none">
                    {categoryPills.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCategoryFilter(c.id as any)}
                        className={`px-2.5 py-1 rounded-lg font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          categoryFilter === c.id
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                  <div className="pointer-events-none sm:hidden absolute right-0 top-0 bottom-1 w-7 bg-gradient-to-l from-white via-white/90 to-transparent flex items-center justify-end pr-0.5">
                    <span className="text-[10px] font-black text-neutral-400">›</span>
                  </div>
                </div>
              </div>

              {/* Products Grid / List */}
              <div className={`p-3 space-y-2 ${isCompactLayout ? 'pb-6' : 'flex-1 overflow-y-auto'}`}>
                {filteredProducts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-neutral-400">
                    Nenhum produto encontrado.
                  </div>
                ) : (
                  filteredProducts.map((p) => {
                    const isSelected = selectedProduct?.id === p.id;
                    const isPromo = isProductPromoActive(p);
                    const effectivePrice = getEffectiveProductPrice(p);
                    const hasCase = canSellProductCase(p, settings, 'local');
                    const isCombo = isComboProduct(p.id, settings);
                    const comboMetrics = isCombo ? calculateComboMetrics(p, settings, products) : null;
                    const isOutOfStock = p.stock <= 0;
                    const hasAddons = getProductAddonGroups(p, settings).length > 0;
                    const productActiveItems = activeItems.filter((it) => it.productId === p.id);
                    const inTabUnitQty = productActiveItems
                      .filter((it) => it.saleUnit !== 'case')
                      .reduce((sum, it) => sum + it.quantity, 0);
                    const inTabCaseQty = productActiveItems
                      .filter((it) => it.saleUnit === 'case')
                      .reduce((sum, it) => sum + it.quantity, 0);
                    const inTabSummary =
                      inTabUnitQty > 0 || inTabCaseQty > 0
                        ? formatUnitAndCaseCount(inTabUnitQty, inTabCaseQty, p.caseSize)
                        : '';

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
                        className={`p-2.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500/10 shadow-xs cursor-pointer'
                            : isOutOfStock
                            ? 'opacity-40 bg-neutral-50 border-neutral-200 cursor-not-allowed'
                            : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <ProductThumb product={p} alt={p.name} size="md" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-bold text-neutral-900 truncate">
                                {p.name}
                              </span>
                              {inTabSummary && (
                                <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 border border-emerald-300 text-[9px] font-black rounded shrink-0">
                                  {inTabSummary}
                                </span>
                              )}
                              {isCombo && (
                                <span className="px-1.5 py-0.2 bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black rounded uppercase shrink-0">
                                  Combo
                                </span>
                              )}
                              {p.isCold && <Snowflake className="w-3 h-3 text-sky-500 shrink-0" />}
                              {isPromo && (
                                <span className="px-1 py-0.2 bg-red-100 text-red-700 text-[9px] font-black rounded uppercase shrink-0">
                                  PROMO
                                </span>
                              )}
                            </div>
                            {isCombo ? (
                              <div className="mt-0.5 space-y-0.5">
                                {comboMetrics?.itemsSummaryText && (
                                  <span className="block text-[10px] font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md truncate">
                                    {comboMetrics.itemsSummaryText}
                                  </span>
                                )}
                                <span
                                  className={`inline-block text-[10px] font-bold ${
                                    isOutOfStock
                                      ? 'text-red-600'
                                      : p.stock <= 5
                                      ? 'text-amber-600'
                                      : 'text-neutral-500'
                                  }`}
                                >
                                  Disponível: {p.stock}
                                </span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 text-[10px] text-neutral-400 mt-0.5 flex-wrap">
                                  <span>{p.volume}</span>
                                  <span>•</span>
                                  <span className={p.stock <= p.minStock ? 'text-amber-600 font-bold' : ''}>
                                    Estoque: {formatStockWithCases(p.stock, p.caseSize)}
                                  </span>
                                </div>
                                {hasAddons && (
                                  <span className="inline-block mt-0.5 text-[10px] font-semibold text-neutral-500">
                                    adicionais só no balcão e na loja
                                  </span>
                                )}
                              </>
                            )}
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
                const hasCase = canSellProductCase(selectedProduct, settings, 'local');
                const caseUnavailable = hasCase && selectedProduct.stock < Number(selectedProduct.caseSize);
                const isCase = itemSaleUnit === 'case' && hasCase && !caseUnavailable;
                const unitEffPrice = getEffectiveProductPrice(selectedProduct);
                const activeUnitPrice = isCase ? Number(selectedProduct.casePrice) : unitEffPrice;
                const maxQty = isCase
                  ? Math.max(1, Math.floor(selectedProduct.stock / Number(selectedProduct.caseSize)))
                  : Math.max(1, selectedProduct.stock);

                const selectedInTabItems = activeItems.filter(
                  (it) => it.productId === selectedProduct.id
                );
                const selectedInTabUnitQty = selectedInTabItems
                  .filter((it) => it.saleUnit !== 'case')
                  .reduce((sum, it) => sum + it.quantity, 0);
                const selectedInTabCaseQty = selectedInTabItems
                  .filter((it) => it.saleUnit === 'case')
                  .reduce((sum, it) => sum + it.quantity, 0);
                const selectedInTabSummary =
                  selectedInTabUnitQty > 0 || selectedInTabCaseQty > 0
                    ? formatUnitAndCaseCount(
                        selectedInTabUnitQty,
                        selectedInTabCaseQty,
                        selectedProduct.caseSize
                      )
                    : '';
                const launchQtyLabel = formatUnitAndCaseCount(
                  !isCase ? itemQuantity : 0,
                  isCase ? itemQuantity : 0,
                  selectedProduct.caseSize
                );

                return (
                  <>
                    {/* Compact Drawer Backdrop (<640px width or <800px height) */}
                    {isCompactLayout && (
                      <div
                        onClick={() => setSelectedProduct(null)}
                        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] animate-in fade-in duration-150"
                      />
                    )}
                    <form
                      onSubmit={handleAddItem}
                      className={
                        isCompactLayout
                          ? 'fixed inset-x-0 bottom-0 z-50 max-w-lg mx-auto rounded-t-3xl bg-white p-4 shadow-2xl border-t border-neutral-200 space-y-3 animate-in slide-in-from-bottom-2 shrink-0'
                          : 'p-4 bg-neutral-50 border-t border-neutral-200 space-y-3 shrink-0'
                      }
                    >
                      {addItemError && (
                        <div className="p-2 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-[11px] text-red-700 font-bold">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>{addItemError}</span>
                        </div>
                      )}

                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                              Lançar Item
                            </span>
                            {selectedInTabSummary && (
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300">
                                Na comanda: {selectedInTabSummary}
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-black text-neutral-900 truncate block">
                            {selectedProduct.name}
                            {isCase ? ` — Caixa c/${selectedProduct.caseSize}` : ''}
                          </span>
                          {getProductAddonGroups(selectedProduct, settings).length > 0 && (
                            <span className="inline-block mt-0.5 text-[10px] font-semibold text-neutral-500">
                              adicionais só no balcão e na loja
                            </span>
                          )}
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
                          <Plus className="w-4 h-4 shrink-0" />
                          <span className="truncate">
                            {isAddingItem ? 'Lançando...' : `Adicionar (${launchQtyLabel})`}
                          </span>
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

        {/* Fixed Footer when compact (<640px width or <800px height): Imprimir conta & Fechar Conta always visible */}
        {isCompactLayout && (
          <div className="p-3 bg-white border-t border-neutral-200 shrink-0 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenPreBill}
              className="py-3.5 px-3.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border border-neutral-300 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-1.5 shrink-0"
            >
              <Printer className="w-4 h-4 text-neutral-700" />
              <span>Imprimir conta</span>
            </button>
            <button
              type="button"
              onClick={() => tabDetail && onRequestCloseTab(tabDetail)}
              className="flex-1 py-3.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-black shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <Receipt className="w-5 h-5" />
              <span>Fechar Conta • R$ {(tabDetail?.subtotal || 0).toFixed(2)}</span>
            </button>
          </div>
        )}

        {/* Sub-Dialog: 80mm Pre-Bill ("Imprimir conta") */}
        {isPreBillModalOpen && tabDetail && (() => {
          const subtotalVal = Math.round((tabDetail.subtotal || 0) * 100) / 100;
          const optionalFee10 = Math.round(subtotalVal * 0.10 * 100) / 100;
          const totalWithFee10 = Math.round((subtotalVal + optionalFee10) * 100) / 100;
          const now = new Date();

          return (
            <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
              <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[90vh]">
                <div className="print:hidden bg-neutral-900 text-white p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Printer className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-black uppercase tracking-wider">
                      Pré-Conta • Mesa {allTableNumbers}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsPreBillModalOpen(false)}
                    className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Printable 80mm Pre-Bill Paper */}
                <div
                  id="receipt-to-print"
                  className="p-6 overflow-y-auto flex-1 font-mono text-xs text-neutral-800 bg-neutral-50/50 space-y-4"
                >
                  <div className="text-center pb-3 border-b border-dashed border-neutral-300">
                    <h3 className="font-black text-sm uppercase tracking-wider text-neutral-900">
                      {settings?.storeName || 'Depósito'}
                    </h3>
                    {settings?.cnpjOrCpf && (
                      <p className="text-[11px] text-neutral-500 mt-0.5">CNPJ/CPF: {settings.cnpjOrCpf}</p>
                    )}
                    {settings?.address && <p className="text-[11px] text-neutral-500">{settings.address}</p>}
                    {settings?.phone && <p className="text-[11px] text-neutral-500">Tel: {settings.phone}</p>}
                    <p className="text-[10px] font-bold text-neutral-600 mt-1">
                      *** PRÉ-CONTA DE CONFERÊNCIA ***
                    </p>
                  </div>

                  <div className="space-y-1 text-[11px] border-b border-dashed border-neutral-300 pb-3">
                    <div className="flex justify-between font-bold text-neutral-900">
                      <span>
                        MESA {allTableNumbers}
                        {tabDetail.tableLabel ? ` (${tabDetail.tableLabel})` : ''}
                      </span>
                      <span>{now.toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>
                        {tabDetail.customerName ? `Cliente: ${tabDetail.customerName}` : 'Cliente na Mesa'}
                        {tabDetail.peopleCount ? ` (${tabDetail.peopleCount}p)` : ''}
                      </span>
                      <span>{now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    {tabDetail.notes && (
                      <p className="text-[10px] text-neutral-500 italic mt-1">{tabDetail.notes}</p>
                    )}
                  </div>

                  {/* Items */}
                  <div className="space-y-1.5 border-b border-dashed border-neutral-300 pb-3">
                    <div className="flex justify-between font-bold text-[10px] uppercase text-neutral-500 pb-1">
                      <span>Item / Qtd</span>
                      <span>Total</span>
                    </div>
                    {groupedActiveItems.length === 0 ? (
                      <p className="text-[11px] text-neutral-500 text-center py-2">Nenhum item consumido.</p>
                    ) : (
                      groupedActiveItems.map((it) => {
                        const isCase = it.saleUnit === 'case' && it.unitsPerSale > 1;
                        return (
                          <div key={it.key} className="flex justify-between items-start text-[11px]">
                            <div className="pr-2">
                              <span>
                                {isCase
                                  ? `${it.quantity} cx (${it.quantity * it.unitsPerSale} un) ${it.productName}`
                                  : `${it.quantity} un ${it.productName}`}
                              </span>
                              {it.comboItems && it.comboItems.length > 0 && (
                                <div className="pl-2 mt-0.5 space-y-0.5 text-[10px] text-neutral-600 font-semibold">
                                  {it.comboItems.map((ci, ciIdx) => (
                                    <div key={`${ci.productId}-${ciIdx}`}>{formatOrderItemComboLine(ci)}</div>
                                  ))}
                                </div>
                              )}
                              <div className="text-[10px] text-neutral-400">
                                {it.quantity} {isCase ? 'cx' : 'un'} × R$ {it.unitPrice.toFixed(2)}
                              </div>
                            </div>
                            <span className="font-bold whitespace-nowrap">
                              R$ {(it.unitPrice * it.quantity).toFixed(2)}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Totals */}
                  <div className="space-y-1.5 pt-1 text-xs">
                    <div className="flex justify-between text-neutral-700">
                      <span>Subtotal:</span>
                      <span>R$ {subtotalVal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-neutral-700">
                      <span>Taxa de serviço (opcional):</span>
                      <span>R$ {optionalFee10.toFixed(2)}</span>
                    </div>
                    <div className="pt-1.5 border-t border-dashed border-neutral-300 space-y-1">
                      <div className="flex justify-between text-xs font-bold text-neutral-800">
                        <span>Total sem taxa:</span>
                        <span>R$ {subtotalVal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-black text-neutral-950">
                        <span>Total com taxa (10%):</span>
                        <span>R$ {totalWithFee10.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-center pt-3 border-t border-dashed border-neutral-300 text-[10px] font-bold text-neutral-700 uppercase">
                    CONFERÊNCIA — NÃO É COMPROVANTE DE PAGAMENTO
                  </div>
                </div>

                <div className="print:hidden p-4 bg-white border-t border-neutral-200 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-400 text-neutral-950 rounded-2xl text-xs font-black shadow-md flex items-center justify-center gap-2 transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimir conta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPreBillModalOpen(false)}
                    className="py-3 px-5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-2xl text-xs font-bold transition-colors"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

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
