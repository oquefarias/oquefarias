import React, { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Product,
  StoreSettings,
  StoreCategoryItem,
  ProductSortMode,
  slugifyCategoryId,
  resolveStoreCategories,
  getCategoryDisplayName,
  getEffectiveProductPrice,
  isComboProduct,
  isProductHiddenFromStore,
} from '../../types';
import { api } from '../../services/api';
import {
  ArrowUp,
  Package,
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  AlertTriangle,
  Layers,
  LayoutList,
  Boxes,
  ListPlus,
} from 'lucide-react';
import { AddonGroupsManager } from './AddonGroupsManager';
import { CombosManager } from './CombosManager';
import { CollapsibleSection } from '../common/CollapsibleSection';
import { ProductThumb } from '../common/ProductThumb';

const STORAGE_KEY_SHOW_ARROWS = 'deposito_admin_show_sort_arrows_v1';

interface SortableRowProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}

const SortableRow: React.FC<SortableRowProps> = ({ id, children, disabled }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-3 bg-white hover:bg-neutral-50 flex items-center justify-between gap-3 text-xs transition-shadow ${
        isDragging ? 'shadow-xl ring-2 ring-amber-400 rounded-xl bg-amber-50/40 relative' : ''
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {!disabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="px-1.5 py-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 font-black text-sm leading-none tracking-tighter cursor-grab active:cursor-grabbing touch-none select-none shrink-0"
            title="Segure e arraste para reordenar"
            aria-label="Arrastar para reordenar"
          >
            ⋮⋮
          </button>
        )}
        {children}
      </div>
    </div>
  );
};

interface StoreOrganizationSectionProps {
  products: Product[];
  settings: StoreSettings;
  onSettingsUpdated?: (next: Partial<StoreSettings>) => void;
  externalEditingComboId?: string | null;
  onClearExternalEditingComboId?: () => void;
  collapsedSections?: Record<string, boolean>;
  onToggleSection?: (sectionId: string) => void;
}

export const StoreOrganizationSection: React.FC<StoreOrganizationSectionProps> = ({
  products,
  settings,
  onSettingsUpdated,
  externalEditingComboId,
  onClearExternalEditingComboId,
  collapsedSections = {},
  onToggleSection,
}) => {
  const handleToggleSection = (sectionId: string) => {
    onToggleSection?.(sectionId);
  };
  // Show/hide optional arrows persisted in localStorage
  const [showArrows, setShowArrows] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_SHOW_ARROWS) === '1';
    } catch {
      return false;
    }
  });

  const toggleShowArrows = () => {
    setShowArrows((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_SHOW_ARROWS, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // Status feedback ("Ordem salva" or error message)
  const [saveNotice, setSaveNotice] = useState<string>('');
  const [errorNotice, setErrorNotice] = useState<string>('');

  const showSavedFeedback = (msg = 'Ordem salva') => {
    setErrorNotice('');
    setSaveNotice(msg);
    window.setTimeout(() => {
      setSaveNotice((curr) => (curr === msg ? '' : curr));
    }, 2500);
  };

  // Sensors for @dnd-kit: MouseSensor + TouchSensor (250ms hold delay so scrolling works)
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ---------------------------------------------------------------------------
  // 1. CATEGORIES STATE & ACTIONS
  // ---------------------------------------------------------------------------
  const resolvedCategories = useMemo(
    () => resolveStoreCategories(settings, products),
    [settings, products]
  );
  const [localCategories, setLocalCategories] = useState<StoreCategoryItem[]>(resolvedCategories);

  useEffect(() => {
    setLocalCategories(resolvedCategories);
  }, [resolvedCategories]);

  // Count products per category
  const productCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const cat = p.category || '';
      map.set(cat, (map.get(cat) || 0) + 1);
    }
    return map;
  }, [products]);

  const unlistedProductsCount = useMemo(() => {
    const catIds = new Set(localCategories.map((c) => c.id));
    return products.filter((p) => !catIds.has(p.category)).length;
  }, [products, localCategories]);

  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState<string>('');
  const [isSavingCategory, setIsSavingCategory] = useState<boolean>(false);

  // Modal/state for removing category with products
  const [removeCatDialog, setRemoveCatDialog] = useState<{
    category: StoreCategoryItem;
    productCount: number;
    moveTo: string;
    loading: boolean;
    error?: string;
  } | null>(null);

  const persistCategoriesOrder = async (
    nextCategories: StoreCategoryItem[],
    previousCategories: StoreCategoryItem[],
    successMsg = 'Ordem salva'
  ) => {
    setLocalCategories(nextCategories);
    onSettingsUpdated?.({ categories: nextCategories });
    try {
      await api.updateSettings({ categories: nextCategories });
      showSavedFeedback(successMsg);
    } catch (err: any) {
      setLocalCategories(previousCategories);
      onSettingsUpdated?.({ categories: previousCategories });
      setErrorNotice(err?.message || 'Não foi possível salvar a ordem das categorias.');
    }
  };

  const handleCategoriesDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localCategories.findIndex((c) => c.id === String(active.id));
    const newIndex = localCategories.findIndex((c) => c.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const prev = [...localCategories];
    const next = arrayMove(localCategories, oldIndex, newIndex);
    persistCategoriesOrder(next, prev);
  };

  const handleMoveCategoryArrow = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= localCategories.length) return;
    const prev = [...localCategories];
    const next = arrayMove(localCategories, index, targetIdx);
    persistCategoriesOrder(next, prev);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newCategoryName.trim().slice(0, 40);
    if (!trimmedName) return;

    if (localCategories.length >= 50) {
      setErrorNotice('Limite máximo de 50 categorias atingido.');
      return;
    }

    const baseSlug = slugifyCategoryId(trimmedName);
    if (!baseSlug || baseSlug === 'todas' || baseSlug === 'outros') {
      setErrorNotice('Informe um nome válido para a categoria.');
      return;
    }

    if (localCategories.some((c) => c.name.toLowerCase() === trimmedName.toLowerCase() || c.id === baseSlug)) {
      setErrorNotice('Já existe uma categoria com esse nome ou identificador.');
      return;
    }

    const prev = [...localCategories];
    const next = [...localCategories, { id: baseSlug, name: trimmedName }];
    setIsSavingCategory(true);
    setErrorNotice('');
    try {
      setLocalCategories(next);
      onSettingsUpdated?.({ categories: next });
      await api.updateSettings({ categories: next });
      setNewCategoryName('');
      showSavedFeedback('Categoria adicionada');
    } catch (err: any) {
      setLocalCategories(prev);
      onSettingsUpdated?.({ categories: prev });
      setErrorNotice(err?.message || 'Erro ao adicionar categoria.');
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleStartRenameCategory = (cat: StoreCategoryItem) => {
    setEditingCatId(cat.id);
    setEditingCatName(cat.name);
    setErrorNotice('');
  };

  const handleSaveRenameCategory = async (catId: string) => {
    const trimmed = editingCatName.trim().slice(0, 40);
    if (!trimmed) {
      setErrorNotice('O nome da categoria não pode ficar vazio.');
      return;
    }
    const prev = [...localCategories];
    const next = localCategories.map((c) => (c.id === catId ? { ...c, name: trimmed } : c));
    setEditingCatId(null);
    await persistCategoriesOrder(next, prev, 'Categoria renomeada');
  };

  const handleRequestRemoveCategory = async (cat: StoreCategoryItem) => {
    setErrorNotice('');
    if (localCategories.length <= 1) {
      setErrorNotice('A loja precisa manter pelo menos uma categoria.');
      return;
    }

    const count = productCountByCategory.get(cat.id) || 0;
    if (count === 0) {
      // Category with 0 products can be removed directly
      const prev = [...localCategories];
      const next = localCategories.filter((c) => c.id !== cat.id);
      setLocalCategories(next);
      try {
        const res = await api.removeAdminCategory(cat.id);
        if (res?.settings) {
          onSettingsUpdated?.(res.settings);
          if (Array.isArray(res.settings.categories)) {
            setLocalCategories(res.settings.categories);
          }
        }
        showSavedFeedback('Categoria removida');
      } catch (err: any) {
        setLocalCategories(prev);
        setErrorNotice(err?.message || 'Não foi possível remover a categoria.');
      }
      return;
    }

    const otherCats = localCategories.filter((c) => c.id !== cat.id);
    setRemoveCatDialog({
      category: cat,
      productCount: count,
      moveTo: otherCats[0]?.id || '',
      loading: false,
    });
  };

  const handleConfirmRemoveCategoryWithMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!removeCatDialog) return;
    if (!removeCatDialog.moveTo || removeCatDialog.moveTo === removeCatDialog.category.id) {
      setRemoveCatDialog((prev) =>
        prev ? { ...prev, error: 'Selecione para qual categoria os produtos devem ir.' } : null
      );
      return;
    }

    setRemoveCatDialog((prev) => (prev ? { ...prev, loading: true, error: undefined } : null));
    try {
      const res = await api.removeAdminCategory(removeCatDialog.category.id, removeCatDialog.moveTo);
      if (res?.settings) {
        onSettingsUpdated?.(res.settings);
        if (Array.isArray(res.settings.categories)) {
          setLocalCategories(res.settings.categories);
        }
      }
      setRemoveCatDialog(null);
      showSavedFeedback('Produtos movidos e categoria removida');
    } catch (err: any) {
      setRemoveCatDialog((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: err?.message || 'Erro ao mover produtos e remover categoria.',
            }
          : null
      );
    }
  };

  // ---------------------------------------------------------------------------
  // 2. FEATURED PRODUCTS ("Ordem de preferência na loja")
  // ---------------------------------------------------------------------------
  const validFeaturedIds = useMemo(() => {
    const raw = Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds : [];
    const productMap = new Set(products.map((p) => p.id));
    const seen = new Set<string>();
    const list: string[] = [];
    for (const id of raw) {
      if (typeof id === 'string' && productMap.has(id) && !seen.has(id)) {
        seen.add(id);
        list.push(id);
        if (list.length >= 50) break;
      }
    }
    return list;
  }, [settings.featuredProductIds, products]);

  const [localFeaturedIds, setLocalFeaturedIds] = useState<string[]>(validFeaturedIds);

  useEffect(() => {
    setLocalFeaturedIds(validFeaturedIds);
  }, [validFeaturedIds]);

  const featuredProductsList = useMemo(() => {
    const productMap = new Map<string, Product>(products.map((p) => [p.id, p]));
    return localFeaturedIds
      .map((id) => productMap.get(id))
      .filter((p): p is Product => Boolean(p));
  }, [localFeaturedIds, products]);

  const persistFeaturedIds = async (nextIds: string[], prevIds: string[]) => {
    const trimmed = nextIds.slice(0, 50);
    setLocalFeaturedIds(trimmed);
    onSettingsUpdated?.({ featuredProductIds: trimmed });
    try {
      await api.updateSettings({ featuredProductIds: trimmed });
      showSavedFeedback('Ordem salva');
    } catch (err: any) {
      setLocalFeaturedIds(prevIds);
      onSettingsUpdated?.({ featuredProductIds: prevIds });
      setErrorNotice(err?.message || 'Não foi possível salvar a ordem de preferência.');
    }
  };

  const handleFeaturedDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localFeaturedIds.indexOf(String(active.id));
    const newIndex = localFeaturedIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const prev = [...localFeaturedIds];
    const next = arrayMove(localFeaturedIds, oldIndex, newIndex);
    persistFeaturedIds(next, prev);
  };

  const handleMoveFeaturedArrow = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= localFeaturedIds.length) return;
    const prev = [...localFeaturedIds];
    const next = arrayMove(localFeaturedIds, index, targetIdx);
    persistFeaturedIds(next, prev);
  };

  const handleRemoveFeatured = (productId: string) => {
    const prev = [...localFeaturedIds];
    const next = localFeaturedIds.filter((id) => id !== productId);
    persistFeaturedIds(next, prev);
  };

  const isFeaturedCarouselEnabled = settings.showFeaturedCarousel !== false;

  const handleToggleFeaturedCarousel = async (next: boolean) => {
    const prev = settings.showFeaturedCarousel !== false;
    setErrorNotice('');
    onSettingsUpdated?.({ showFeaturedCarousel: next });
    try {
      await api.updateSettings({ showFeaturedCarousel: next });
      showSavedFeedback(next ? 'Carrossel ativado' : 'Carrossel ocultado');
    } catch (err: any) {
      onSettingsUpdated?.({ showFeaturedCarousel: prev });
      setErrorNotice(err?.message || 'Não foi possível atualizar o carrossel de destaques.');
    }
  };

  // ---------------------------------------------------------------------------
  // 3. STORE PRODUCT ORDER ("Organizar loja")
  // ---------------------------------------------------------------------------
  const [selectedOrgCategoryId, setSelectedOrgCategoryId] = useState<string>(
    () => localCategories[0]?.id || 'cervejas'
  );

  useEffect(() => {
    if (
      localCategories.length > 0 &&
      !localCategories.some((c) => c.id === selectedOrgCategoryId)
    ) {
      setSelectedOrgCategoryId(localCategories[0].id);
    }
  }, [localCategories, selectedOrgCategoryId]);

  const currentSortMode: ProductSortMode = settings.productSortMode || 'manual';

  const handleChangeSortMode = async (mode: ProductSortMode) => {
    const prevMode = settings.productSortMode || 'manual';
    onSettingsUpdated?.({ productSortMode: mode });
    try {
      await api.updateSettings({ productSortMode: mode });
      showSavedFeedback('Modo de ordenação salvo');
    } catch (err: any) {
      onSettingsUpdated?.({ productSortMode: prevMode });
      setErrorNotice(err?.message || 'Erro ao salvar modo de ordenação.');
    }
  };

  // Compute ordered products in the selected category for manual organization
  const orderedCategoryProducts = useMemo(() => {
    const catProducts = products.filter((p) => p.category === selectedOrgCategoryId);
    const savedOrder = settings.productOrder?.[selectedOrgCategoryId] || [];
    const rankMap = new Map<string, number>();
    savedOrder.forEach((id, idx) => {
      if (!rankMap.has(id)) rankMap.set(id, idx);
    });

    const origIdx = new Map<string, number>();
    catProducts.forEach((p, idx) => origIdx.set(p.id, idx));

    return [...catProducts].sort((a, b) => {
      const ra = rankMap.has(a.id) ? rankMap.get(a.id)! : 999999;
      const rb = rankMap.has(b.id) ? rankMap.get(b.id)! : 999999;
      if (ra !== rb) return ra - rb;
      return (origIdx.get(a.id) ?? 0) - (origIdx.get(b.id) ?? 0);
    });
  }, [products, selectedOrgCategoryId, settings.productOrder]);

  const [localCatProductIds, setLocalCatProductIds] = useState<string[]>(() =>
    orderedCategoryProducts.map((p) => p.id)
  );

  useEffect(() => {
    setLocalCatProductIds(orderedCategoryProducts.map((p) => p.id));
  }, [orderedCategoryProducts]);

  const localCatProducts = useMemo(() => {
    const map = new Map<string, Product>(
      orderedCategoryProducts.map((p) => [p.id, p])
    );
    return localCatProductIds
      .map((id) => map.get(id))
      .filter((p): p is Product => Boolean(p));
  }, [orderedCategoryProducts, localCatProductIds]);

  const persistCategoryProductOrder = async (nextIds: string[], prevIds: string[]) => {
    setLocalCatProductIds(nextIds);
    const nextProductOrder: Record<string, string[]> = {
      ...(settings.productOrder || {}),
      [selectedOrgCategoryId]: nextIds,
    };
    onSettingsUpdated?.({ productOrder: nextProductOrder });
    try {
      await api.updateSettings({ productOrder: nextProductOrder });
      showSavedFeedback('Ordem salva');
    } catch (err: any) {
      setLocalCatProductIds(prevIds);
      onSettingsUpdated?.({ productOrder: settings.productOrder || {} });
      setErrorNotice(err?.message || 'Não foi possível salvar a ordem dos produtos.');
    }
  };

  const handleOrgProductsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = localCatProductIds.indexOf(String(active.id));
    const newIndex = localCatProductIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const prev = [...localCatProductIds];
    const next = arrayMove(localCatProductIds, oldIndex, newIndex);
    persistCategoryProductOrder(next, prev);
  };

  const handleMoveOrgProductArrow = (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= localCatProductIds.length) return;
    const prev = [...localCatProductIds];
    const next = arrayMove(localCatProductIds, index, targetIdx);
    persistCategoryProductOrder(next, prev);
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-6">
      {/* Shared Status & Toggle Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3 rounded-2xl border border-neutral-200 shadow-2xs">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-neutral-700">
            Dica: segure e arraste pelo ícone <strong className="font-black text-neutral-900">⋮⋮</strong> para ordenar categorias e produtos.
          </span>
          {saveNotice && (
            <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 font-black text-xs inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>{saveNotice}</span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={toggleShowArrows}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
            showArrows
              ? 'bg-neutral-900 text-white border-neutral-900'
              : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
          }`}
        >
          {showArrows ? 'Ocultar setas (↑ ↓)' : 'Mostrar setas'}
        </button>
      </div>

      {errorNotice && (
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorNotice('')}
            className="p-1 hover:bg-red-100 rounded-lg text-red-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* 1. ORDEM DE PREFERÊNCIA NA LOJA ("Mostrar primeiro")                */}
      {/* =================================================================== */}
      <CollapsibleSection
        sectionId="estoque_preferencia"
        title={`Ordem de preferência na loja (${featuredProductsList.length}/50)`}
        subtitle="Esses produtos aparecem antes dos outros na loja, na busca e na categoria deles"
        icon={<ArrowUp className="w-5 h-5 text-amber-600" />}
        collapsed={Boolean(collapsedSections['estoque_preferencia'])}
        onToggle={handleToggleSection}
        variant="amber"
        rightContent={
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-2.5 py-1.5 rounded-xl bg-white/80 hover:bg-white border border-amber-200 text-xs font-bold text-neutral-800 shadow-2xs">
            <input
              type="checkbox"
              checked={isFeaturedCarouselEnabled}
              onChange={(e) => handleToggleFeaturedCarousel(e.target.checked)}
              className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
            />
            <span>Carrossel de destaques no topo</span>
          </label>
        }
      >
        {featuredProductsList.length === 0 ? (
          <div className="p-4 rounded-2xl bg-amber-50/50 border border-dashed border-amber-200 text-xs text-neutral-500 text-center">
            Nenhum produto na ordem de preferência. Clique em <strong>"Mostrar primeiro"</strong> em qualquer produto na tabela abaixo para que ele apareça antes dos outros.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleFeaturedDragEnd}
          >
            <SortableContext
              items={localFeaturedIds}
              strategy={verticalListSortingStrategy}
            >
              <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-2xl overflow-hidden">
                {featuredProductsList.map((fp, idx) => {
                  const isHiddenByStock = !settings.showOutOfStock && fp.stock < 1;
                  return (
                    <SortableRow key={`featured-sort-${fp.id}`} id={fp.id}>
                      <div className="flex items-center justify-between gap-3 w-full min-w-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="w-6 h-6 rounded-lg bg-amber-500 text-neutral-950 font-black flex items-center justify-center shrink-0">
                            {idx + 1}º
                          </span>
                          <ProductThumb product={fp} alt={fp.name} size="sm" />
                          <div className="min-w-0">
                            <div className="font-bold text-neutral-900 truncate flex items-center gap-1.5 flex-wrap">
                              <span>{fp.name}</span>
                              {isComboProduct(fp.id, settings) && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-black uppercase">
                                  Combo
                                </span>
                              )}
                              <span className="px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-neutral-600 text-[10px] font-bold">
                                {getCategoryDisplayName(fp.category, settings, products)}
                              </span>
                              {!fp.active && (
                                <span className="px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-700 text-[10px] font-bold">
                                  Desativado
                                </span>
                              )}
                              {isProductHiddenFromStore(fp.id, settings) && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-bold">
                                  Só no balcão/mesa
                                </span>
                              )}
                              {fp.active && isHiddenByStock && (
                                <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">
                                  Esgotado (oculto na loja)
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-neutral-500">
                              {fp.volume} • {formatCurrency(getEffectiveProductPrice(fp))} •{' '}
                              {isComboProduct(fp.id, settings)
                                ? `Disponível: ${fp.stock}`
                                : `Estoque: ${fp.stock} un`}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {showArrows && (
                            <>
                              <button
                                type="button"
                                disabled={idx === 0}
                                onClick={() => handleMoveFeaturedArrow(idx, -1)}
                                className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                title="Subir posição (↑)"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={idx === featuredProductsList.length - 1}
                                onClick={() => handleMoveFeaturedArrow(idx, 1)}
                                className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                title="Descer posição (↓)"
                              >
                                ↓
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveFeatured(fp.id)}
                            className="w-7 h-7 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 font-black flex items-center justify-center cursor-pointer ml-1"
                            title="Remover da ordem de preferência (✕)"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </SortableRow>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CollapsibleSection>

      {/* =================================================================== */}
      {/* 2. SEÇÃO "CATEGORIAS" & 3. "ORGANIZAR LOJA"                         */}
      {/* =================================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* CATEGORIAS GERENCIÁVEIS */}
        <CollapsibleSection
          sectionId="estoque_categorias"
          title={`Categorias (${localCategories.length}/50)`}
          subtitle="Vale para a loja, PDV Balcão e Mesas"
          icon={<Layers className="w-5 h-5 text-amber-500" />}
          collapsed={Boolean(collapsedSections['estoque_categorias'])}
          onToggle={handleToggleSection}
        >
          <div className="space-y-4">

            {/* Add Category Form */}
            <form onSubmit={handleAddCategory} className="flex items-center gap-2">
              <input
                type="text"
                maxLength={40}
                placeholder="Nova categoria (ex: Energéticos, Combos)..."
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                className="flex-1 px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="submit"
                disabled={isSavingCategory || !newCategoryName.trim()}
                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs inline-flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Adicionar</span>
              </button>
            </form>

            {/* Sortable Categories List */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleCategoriesDragEnd}
            >
              <SortableContext
                items={localCategories.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-2xl overflow-hidden max-h-[380px] overflow-y-auto">
                  {localCategories.map((cat, idx) => {
                    const count = productCountByCategory.get(cat.id) || 0;
                    const isEditing = editingCatId === cat.id;

                    return (
                      <SortableRow key={cat.id} id={cat.id} disabled={isEditing}>
                        <div className="flex items-center justify-between gap-2 w-full min-w-0">
                          {isEditing ? (
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <input
                                type="text"
                                maxLength={40}
                                value={editingCatName}
                                onChange={(e) => setEditingCatName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveRenameCategory(cat.id);
                                  } else if (e.key === 'Escape') {
                                    setEditingCatId(null);
                                  }
                                }}
                                autoFocus
                                className="flex-1 px-2.5 py-1 bg-neutral-50 border border-amber-400 rounded-lg text-xs font-bold text-neutral-900 focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveRenameCategory(cat.id)}
                                className="p-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                                title="Salvar nome"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingCatId(null)}
                                className="p-1.5 rounded-lg bg-neutral-200 hover:bg-neutral-300 text-neutral-700 cursor-pointer"
                                title="Cancelar"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-bold text-neutral-900 text-xs truncate">
                                    {cat.name}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded-md bg-neutral-100 text-neutral-600 font-bold text-[10px]">
                                    {count} {count === 1 ? 'produto' : 'produtos'}
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono text-neutral-400 block">
                                  id: {cat.id}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {showArrows && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={idx === 0}
                                      onClick={() => handleMoveCategoryArrow(idx, -1)}
                                      className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                      title="Subir categoria (↑)"
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      disabled={idx === localCategories.length - 1}
                                      onClick={() => handleMoveCategoryArrow(idx, 1)}
                                      className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                      title="Descer categoria (↓)"
                                    >
                                      ↓
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => handleStartRenameCategory(cat)}
                                  className="px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                  title="Renomear categoria"
                                >
                                  <Edit2 className="w-3 h-3" />
                                  <span className="hidden sm:inline">Renomear</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRequestRemoveCategory(cat)}
                                  className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer"
                                  title="Remover categoria"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </SortableRow>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {unlistedProductsCount > 0 && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-medium">
                Há {unlistedProductsCount} {unlistedProductsCount === 1 ? 'produto' : 'produtos'} com categoria fora da lista acima; eles aparecem no fim como <strong>"Outros"</strong>.
              </p>
            )}
          </div>
        </CollapsibleSection>

        {/* ORGANIZAR LOJA (ORDEM DOS PRODUTOS) */}
        <CollapsibleSection
          sectionId="estoque_ordem"
          title="Ordem dos produtos na loja"
          subtitle="Defina a ordenação automática ou arraste para organizar por categoria"
          icon={<LayoutList className="w-5 h-5 text-amber-500" />}
          collapsed={Boolean(collapsedSections['estoque_ordem'])}
          onToggle={handleToggleSection}
          rightContent={
            <div className="flex items-center gap-1.5 text-xs">
              <label className="font-bold text-neutral-600 hidden sm:inline">Ordem:</label>
              <select
                value={currentSortMode}
                onChange={(e) => handleChangeSortMode(e.target.value as ProductSortMode)}
                className="px-2.5 py-1 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="manual">Manual (arrastar)</option>
                <option value="az">Ordem alfabética (A–Z)</option>
                <option value="price_asc">Menor preço primeiro</option>
                <option value="price_desc">Maior preço primeiro</option>
              </select>
            </div>
          }
        >
          <div className="space-y-4">

            {currentSortMode !== 'manual' && (
              <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 text-xs flex items-center justify-between gap-2">
                <span>
                  A loja está usando ordenação automática (
                  <strong>
                    {currentSortMode === 'az'
                      ? 'Ordem alfabética (A–Z)'
                      : currentSortMode === 'price_asc'
                      ? 'Menor preço primeiro'
                      : 'Maior preço primeiro'}
                  </strong>
                  ). Mude para <strong>Manual (arrastar)</strong> para usar a ordem manual abaixo.
                </span>
                <button
                  type="button"
                  onClick={() => handleChangeSortMode('manual')}
                  className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-lg text-[11px] shrink-0 cursor-pointer"
                >
                  Usar Manual
                </button>
              </div>
            )}

            {/* Category selector for organizing products */}
            <div className="relative">
              <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1 pr-8 sm:pr-0 scrollbar-none">
                {localCategories.map((cat) => {
                  const count = productCountByCategory.get(cat.id) || 0;
                  const isSelected = selectedOrgCategoryId === cat.id;
                  return (
                    <button
                      key={`org-tab-${cat.id}`}
                      type="button"
                      onClick={() => setSelectedOrgCategoryId(cat.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                      }`}
                    >
                      {cat.name} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="pointer-events-none sm:hidden absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-white via-white/90 to-transparent flex items-center justify-end pr-1">
                <span className="text-xs font-black text-neutral-400">›</span>
              </div>
            </div>

            {/* Sortable Products within Selected Category */}
            {localCatProducts.length === 0 ? (
              <div className="p-8 rounded-2xl bg-neutral-50 border border-dashed border-neutral-200 text-xs text-neutral-400 text-center">
                Nenhum produto cadastrado nesta categoria.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleOrgProductsDragEnd}
              >
                <SortableContext
                  items={localCatProductIds}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-2xl overflow-hidden max-h-[340px] overflow-y-auto">
                    {localCatProducts.map((prod, idx) => {
                      const isPreferred = localFeaturedIds.includes(prod.id);
                      const effPrice = getEffectiveProductPrice(prod);

                      return (
                        <SortableRow key={`org-prod-${prod.id}`} id={prod.id}>
                          <div className="flex items-center justify-between gap-2 w-full min-w-0">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-5 text-center font-mono font-bold text-[11px] text-neutral-400 shrink-0">
                                {idx + 1}.
                              </span>
                              <ProductThumb product={prod} alt={prod.name} size="sm" />
                              <div className="min-w-0">
                                <div className="font-bold text-neutral-900 text-xs truncate flex items-center gap-1.5 flex-wrap">
                                  <span className="truncate">{prod.name}</span>
                                  {isPreferred && (
                                    <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black shrink-0">
                                      Mostrar primeiro
                                    </span>
                                  )}
                                  {!prod.active && (
                                    <span className="px-1.5 py-0.2 rounded bg-neutral-200 text-neutral-700 text-[9px] font-bold shrink-0">
                                      Desativado
                                    </span>
                                  )}
                                  {isProductHiddenFromStore(prod.id, settings) && (
                                    <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-bold shrink-0">
                                      Só no balcão/mesa
                                    </span>
                                  )}
                                </div>
                                <span className="text-[11px] text-neutral-500">
                                  {prod.volume} •{' '}
                                  <strong className="text-neutral-800">
                                    {formatCurrency(effPrice)}
                                  </strong>
                                </span>
                              </div>
                            </div>

                            {showArrows && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => handleMoveOrgProductArrow(idx, -1)}
                                  className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                  title="Subir produto (↑)"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === localCatProducts.length - 1}
                                  onClick={() => handleMoveOrgProductArrow(idx, 1)}
                                  className="w-7 h-7 rounded-lg bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                  title="Descer produto (↓)"
                                >
                                  ↓
                                </button>
                              </div>
                            )}
                          </div>
                        </SortableRow>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </CollapsibleSection>
      </div>

      {/* Section 4: Combos */}
      <CollapsibleSection
        sectionId="estoque_combos"
        title="Combos"
        subtitle="Monte kits com desconto que baixam automaticamente o estoque das bebidas de dentro"
        icon={<Boxes className="w-5 h-5 text-amber-500" />}
        collapsed={Boolean(collapsedSections['estoque_combos'] && !externalEditingComboId)}
        onToggle={handleToggleSection}
      >
        <CombosManager
          products={products}
          categories={localCategories}
          settings={settings}
          onSettingsUpdated={onSettingsUpdated}
          onSavedFeedback={showSavedFeedback}
          onErrorNotice={setErrorNotice}
          externalEditingComboId={externalEditingComboId}
          onClearExternalEditingComboId={onClearExternalEditingComboId}
        />
      </CollapsibleSection>

      {/* Section 5: Addon Groups ("Adicionais") */}
      <CollapsibleSection
        sectionId="estoque_adicionais"
        title={`Adicionais (${Array.isArray(settings.addonGroups) ? settings.addonGroups.length : 0}/30)`}
        subtitle="Gelo, copo, limão, energético e outros complementos para produtos"
        icon={<ListPlus className="w-5 h-5 text-amber-500" />}
        collapsed={Boolean(collapsedSections['estoque_adicionais'])}
        onToggle={handleToggleSection}
      >
        <AddonGroupsManager
          products={products}
          categories={localCategories}
          settings={settings}
          showArrows={showArrows}
          onSettingsUpdated={onSettingsUpdated}
          onSavedFeedback={showSavedFeedback}
          onErrorNotice={setErrorNotice}
        />
      </CollapsibleSection>

      {/* Modal: Remove Category that has products (choose moveTo category) */}
      {removeCatDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-neutral-200 overflow-hidden">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base">
                Remover categoria "{removeCatDialog.category.name}"
              </h3>
              <button
                type="button"
                disabled={removeCatDialog.loading}
                onClick={() => setRemoveCatDialog(null)}
                className="p-1.5 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmRemoveCategoryWithMove} className="p-6 space-y-4 text-xs">
              {removeCatDialog.error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                  {removeCatDialog.error}
                </div>
              )}

              <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-950 font-semibold leading-relaxed">
                Esta categoria possui <strong>{removeCatDialog.productCount}</strong>{' '}
                {removeCatDialog.productCount === 1 ? 'produto cadastrado' : 'produtos cadastrados'}.
                Escolha para qual outra categoria esses produtos devem ser movidos antes de remover:
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1.5">
                  Mover produtos para a categoria *
                </label>
                <select
                  required
                  value={removeCatDialog.moveTo}
                  onChange={(e) =>
                    setRemoveCatDialog((prev) =>
                      prev ? { ...prev, moveTo: e.target.value } : null
                    )
                  }
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900"
                >
                  {localCategories
                    .filter((c) => c.id !== removeCatDialog.category.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  disabled={removeCatDialog.loading}
                  onClick={() => setRemoveCatDialog(null)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={removeCatDialog.loading}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black rounded-xl shadow-sm cursor-pointer"
                >
                  {removeCatDialog.loading ? 'Movendo e removendo...' : 'Mover e Remover'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
