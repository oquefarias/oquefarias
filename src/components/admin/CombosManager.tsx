import React, { useState, useMemo, useEffect } from 'react';
import {
  Product,
  StoreSettings,
  StoreCategoryItem,
  ComboComponentItem,
  isComboProduct,
  calculateComboMetrics,
  getEffectiveProductPrice,
  getCategoryDisplayName,
  formatComboComponentProductName,
  isProductHiddenFromStore,
} from '../../types';
import { api } from '../../services/api';
import { optimizeProductImageFile } from '../../utils/imageOptimizer';
import {
  Package,
  Plus,
  Edit2,
  Trash2,
  X,
  Search,
  Check,
  AlertTriangle,
  Upload,
  Snowflake,
  Eye,
  EyeOff,
  Boxes,
  Truck,
  Utensils,
  HelpCircle,
} from 'lucide-react';

interface CombosManagerProps {
  products: Product[];
  categories: StoreCategoryItem[];
  settings: StoreSettings;
  onSettingsUpdated?: (next: Partial<StoreSettings>) => void;
  onProductSaved?: (savedProduct: Product, isNew: boolean) => void;
  onProductDeleted?: (productId: string) => void;
  onSavedFeedback: (msg: string) => void;
  onErrorNotice: (msg: string) => void;
  externalEditingComboId?: string | null;
  onClearExternalEditingComboId?: () => void;
}

export const CombosManager: React.FC<CombosManagerProps> = ({
  products,
  categories,
  settings,
  onSettingsUpdated,
  onProductSaved,
  onProductDeleted,
  onSavedFeedback,
  onErrorNotice,
  externalEditingComboId,
  onClearExternalEditingComboId,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [category, setCategory] = useState('combos');
  const [image, setImage] = useState('');
  const [isCold, setIsCold] = useState(true);
  const [active, setActive] = useState(true);
  const [appearsInDelivery, setAppearsInDelivery] = useState(true);
  const [description, setDescription] = useState('');
  const [comboItems, setComboItems] = useState<ComboComponentItem[]>([]);

  // Component search state inside modal
  const [itemSearch, setItemSearch] = useState('');
  const [selectedComponentId, setSelectedComponentId] = useState('');
  const [selectedComponentQty, setSelectedComponentQty] = useState<number>(1);

  const [modalError, setModalError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [initialImage, setInitialImage] = useState('');
  const [photoOptimizedSummary, setPhotoOptimizedSummary] = useState('');
  const [showPhotoHelp, setShowPhotoHelp] = useState(false);
  const [confirmDeleteCombo, setConfirmDeleteCombo] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Suggest "Combos" category (id: 'combos' or existing category named 'Combos')
  const suggestedCombosCategoryId = useMemo(() => {
    const existing = categories.find(
      (c) => c.id.toLowerCase() === 'combos' || c.name.trim().toLowerCase() === 'combos'
    );
    return existing ? existing.id : 'combos';
  }, [categories]);

  const modalCategories = useMemo(() => {
    const hasCombosCat = categories.some(
      (c) => c.id.toLowerCase() === 'combos' || c.name.trim().toLowerCase() === 'combos'
    );
    if (hasCombosCat) return categories;
    return [{ id: 'combos', name: 'Combos' }, ...categories];
  }, [categories]);

  // List of all existing combo products
  const comboProducts = useMemo(() => {
    const combosMap = settings.combos || {};
    const ids = Object.keys(combosMap).filter(
      (id) => Array.isArray(combosMap[id]) && combosMap[id].length > 0
    );
    const productById = new Map<string, Product>(products.map((p) => [p.id, p]));
    return ids
      .map((id) => productById.get(id))
      .filter((p): p is Product => Boolean(p));
  }, [products, settings.combos]);

  // Eligible non-combo products that can be added inside a combo
  const eligibleComponentProducts = useMemo(() => {
    return products.filter((p) => {
      if (editingComboId && p.id === editingComboId) return false;
      if (isComboProduct(p.id, settings)) return false;
      return true;
    });
  }, [products, settings, editingComboId]);

  const filteredEligibleProducts = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    const alreadyInCombo = new Set(comboItems.map((ci) => ci.productId));
    return eligibleComponentProducts
      .filter((p) => !alreadyInCombo.has(p.id))
      .filter((p) => {
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          (p.volume && p.volume.toLowerCase().includes(q)) ||
          (p.sku && p.sku.toLowerCase().includes(q))
        );
      })
      .slice(0, 40);
  }, [eligibleComponentProducts, itemSearch, comboItems]);

  const openNewComboModal = () => {
    if (comboProducts.length >= 100) {
      onErrorNotice('Limite máximo de 100 combos atingido.');
      return;
    }
    setEditingComboId(null);
    setName('');
    setPriceStr('');
    setCategory(suggestedCombosCategoryId);
    setImage('');
    setInitialImage('');
    setPhotoOptimizedSummary('');
    setShowPhotoHelp(false);
    setIsCold(true);
    setActive(true);
    setAppearsInDelivery(true);
    setDescription('');
    setComboItems([]);
    setItemSearch('');
    setSelectedComponentId('');
    setSelectedComponentQty(1);
    setModalError('');
    setIsModalOpen(true);
  };

  const openEditComboModal = (comboProd: Product) => {
    const currentItems = settings.combos?.[comboProd.id] || [];
    const currentImg = comboProd.imageUrl || comboProd.image || '';
    setEditingComboId(comboProd.id);
    setName(comboProd.name);
    setPriceStr(String(comboProd.price || ''));
    setCategory(comboProd.category || suggestedCombosCategoryId);
    setImage(currentImg);
    setInitialImage(currentImg);
    setPhotoOptimizedSummary('');
    setShowPhotoHelp(false);
    setIsCold(comboProd.isCold !== false);
    setActive(comboProd.active !== false);
    setAppearsInDelivery(!isProductHiddenFromStore(comboProd.id, settings));
    setDescription(comboProd.description || '');
    setComboItems(currentItems.map((it) => ({ productId: it.productId, quantity: it.quantity })));
    setItemSearch('');
    setSelectedComponentId('');
    setSelectedComponentQty(1);
    setModalError('');
    setIsModalOpen(true);
  };

  useEffect(() => {
    if (externalEditingComboId) {
      const found = products.find((p) => p.id === externalEditingComboId);
      if (found && isComboProduct(found.id, settings)) {
        openEditComboModal(found);
      }
      onClearExternalEditingComboId?.();
    }
  }, [externalEditingComboId, products, settings]);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingPhoto(true);
    try {
      const optimized = await optimizeProductImageFile(file);
      setImage(optimized.dataUrl);
      setPhotoOptimizedSummary(
        `Foto otimizada: ${optimized.width}×${optimized.height}, ${optimized.kb} KB`
      );
      setModalError('');
    } catch (err: any) {
      setModalError(err?.message || 'Não foi possível carregar a foto.');
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleAddComponentItem = (productToAdd?: Product, qtyOverride?: number) => {
    setModalError('');
    if (comboItems.length >= 15) {
      setModalError('Um combo pode ter no máximo 15 itens.');
      return;
    }
    const targetId = productToAdd ? productToAdd.id : selectedComponentId;
    if (!targetId) {
      setModalError('Selecione um produto para adicionar ao combo.');
      return;
    }
    const targetProd = eligibleComponentProducts.find((p) => p.id === targetId);
    if (!targetProd) {
      setModalError('Produto inválido ou não pode fazer parte de um combo.');
      return;
    }
    const qty = Math.floor(Number(qtyOverride ?? selectedComponentQty) || 0);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      setModalError('A quantidade de cada item no combo deve ser um número inteiro de 1 a 99.');
      return;
    }
    if (comboItems.some((ci) => ci.productId === targetProd.id)) {
      setModalError('Este produto já está na lista do combo. Ajuste a quantidade dele abaixo.');
      return;
    }

    setComboItems((prev) => [...prev, { productId: targetProd.id, quantity: qty }]);
    setSelectedComponentId('');
    setSelectedComponentQty(1);
    setItemSearch('');
  };

  const handleUpdateComponentQty = (productId: string, rawQty: string) => {
    const parsed = parseInt(rawQty, 10);
    const clamped = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(99, parsed));
    setComboItems((prev) =>
      prev.map((ci) => (ci.productId === productId ? { ...ci, quantity: clamped } : ci))
    );
  };

  const handleRemoveComponentItem = (productId: string) => {
    setComboItems((prev) => prev.filter((ci) => ci.productId !== productId));
  };

  // Live metrics inside modal
  const liveModalMetrics = useMemo(() => {
    const parsedComboPrice = Math.max(0, Number(String(priceStr).replace(',', '.')) || 0);
    const productById = new Map<string, Product>(products.map((p) => [p.id, p]));

    let separateValue = 0;
    let totalCost = 0;
    let minAvailable = comboItems.length > 0 ? Infinity : 0;

    for (const ci of comboItems) {
      const comp = productById.get(ci.productId);
      const qty = Math.max(1, Math.floor(Number(ci.quantity) || 1));
      if (!comp) {
        minAvailable = 0;
        continue;
      }
      const effPrice = getEffectiveProductPrice(comp);
      separateValue += effPrice * qty;
      totalCost += (Number(comp.costPrice) || 0) * qty;

      if (comp.active === false) {
        minAvailable = 0;
      } else {
        const avail = Math.floor(Math.max(0, Number(comp.stock) || 0) / qty);
        if (avail < minAvailable) minAvailable = avail;
      }
    }

    if (!Number.isFinite(minAvailable) || minAvailable < 0) minAvailable = 0;
    separateValue = Math.round(separateValue * 100) / 100;
    totalCost = Math.round(totalCost * 100) / 100;
    const discount = Math.max(0, Math.round((separateValue - parsedComboPrice) * 100) / 100);
    const marginPercent =
      parsedComboPrice > 0
        ? Math.round(((parsedComboPrice - totalCost) / parsedComboPrice) * 1000) / 10
        : 0;

    return {
      comboPrice: parsedComboPrice,
      separateValue,
      discount,
      totalCost,
      marginPercent,
      availableStock: minAvailable,
    };
  }, [comboItems, priceStr, products]);

  const handleSaveCombo = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setModalError('Informe o nome do combo.');
      return;
    }

    const parsedPrice = Number(String(priceStr).replace(',', '.'));
    if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
      setModalError('Informe um preço válido maior que zero para o combo.');
      return;
    }

    if (comboItems.length === 0) {
      setModalError('Adicione pelo menos 1 produto para compor o combo.');
      return;
    }

    if (comboItems.length > 15) {
      setModalError('O combo pode ter no máximo 15 produtos.');
      return;
    }

    for (const ci of comboItems) {
      if (!Number.isInteger(ci.quantity) || ci.quantity < 1 || ci.quantity > 99) {
        setModalError('As quantidades dos itens devem ser números inteiros de 1 a 99.');
        return;
      }
      if (isComboProduct(ci.productId, settings)) {
        setModalError('Um combo não pode conter outro combo.');
        return;
      }
    }

    const isNew = !editingComboId;
    const comboId = editingComboId || `combo-${Date.now()}`;
    const existingProduct = editingComboId ? products.find((p) => p.id === editingComboId) : undefined;

    const productById = new Map<string, Product>(products.map((p) => [p.id, p]));
    const summaryVolume = comboItems
      .map((ci) => {
        const comp = productById.get(ci.productId);
        return comp ? `${ci.quantity}x ${comp.name}` : '';
      })
      .filter(Boolean)
      .join(' + ')
      .slice(0, 80);

    const trimmedImg = image.trim();
    const hadImageBefore = Boolean(initialImage.trim());
    let imageFieldForSave: string | null | undefined = undefined;
    if (isNew) {
      imageFieldForSave = trimmedImg;
    } else if (trimmedImg === '' && hadImageBefore) {
      imageFieldForSave = null;
    } else if (
      trimmedImg !== '' &&
      trimmedImg !== initialImage.trim() &&
      !trimmedImg.startsWith('/api/products/')
    ) {
      imageFieldForSave = trimmedImg;
    }

    const comboProductPayload: Omit<Product, 'image'> & { image?: string | null } = {
      id: comboId,
      name: trimmedName,
      category: category || suggestedCombosCategoryId,
      volume: existingProduct?.volume || summaryVolume || 'Combo',
      price: Math.round(parsedPrice * 100) / 100,
      promoPrice: existingProduct?.promoPrice ?? null,
      promoEndsAt: existingProduct?.promoEndsAt ?? null,
      caseSize: null,
      casePrice: null,
      costPrice: liveModalMetrics.totalCost,
      stock: liveModalMetrics.availableStock,
      minStock: existingProduct?.minStock ?? 5,
      isCold,
      ...(imageFieldForSave !== undefined ? { image: imageFieldForSave } : {}),
      sku: existingProduct?.sku || '',
      active,
      description: description.trim(),
    };

    setIsSaving(true);
    try {
      // 1. Create or update the combo product row in products table
      const savedProd = await api.saveProduct(comboProductPayload);

      // 2. Ensure category "Combos" exists in settings.categories if selected
      let nextCategories: StoreCategoryItem[] | undefined = undefined;
      const chosenCat = comboProductPayload.category;
      if (
        chosenCat &&
        !categories.some((c) => c.id === chosenCat) &&
        chosenCat.toLowerCase() === 'combos'
      ) {
        nextCategories = [...categories, { id: 'combos', name: 'Combos' }].slice(0, 50);
      }

      // 3. Persist settings.combos & hiddenFromStoreIds
      const nextCombos: Record<string, ComboComponentItem[]> = {
        ...(settings.combos || {}),
        [comboId]: comboItems.map((ci) => ({
          productId: ci.productId,
          quantity: Math.floor(Number(ci.quantity)),
        })),
      };

      const currentHidden = Array.isArray(settings.hiddenFromStoreIds) ? settings.hiddenFromStoreIds : [];
      const nextHiddenFromStoreIds = appearsInDelivery
        ? currentHidden.filter((id) => id !== comboId)
        : currentHidden.includes(comboId)
        ? currentHidden
        : [...currentHidden, comboId].slice(0, 2000);

      const settingsPayload: Partial<StoreSettings> = {
        combos: nextCombos,
        hiddenFromStoreIds: nextHiddenFromStoreIds,
        ...(nextCategories ? { categories: nextCategories } : {}),
      };

      const updatedSettings = await api.updateSettings(settingsPayload);
      onSettingsUpdated?.(updatedSettings);

      const finalComboProd: Product = {
        ...savedProd,
        stock: liveModalMetrics.availableStock,
        costPrice: liveModalMetrics.totalCost,
        caseSize: null,
        casePrice: null,
      };
      onProductSaved?.(finalComboProd, isNew);

      setIsModalOpen(false);
      onSavedFeedback(isNew ? 'Combo criado com sucesso' : 'Combo atualizado');
    } catch (err: any) {
      setModalError(err?.message || 'Erro ao salvar combo.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleComboActive = async (combo: Product) => {
    try {
      const { image: _ignoredImage, ...comboWithoutImage } = combo;
      const saved = await api.saveProduct({
        ...comboWithoutImage,
        active: !combo.active,
      });
      onProductSaved?.(saved, false);
      onSavedFeedback(saved.active ? 'Combo ativado' : 'Combo desativado');
    } catch (err: any) {
      onErrorNotice(err?.message || 'Não foi possível alterar o status do combo.');
    }
  };

  const handleToggleComboDeliveryVisibility = async (comboId: string) => {
    const currentHidden = Array.isArray(settings.hiddenFromStoreIds) ? settings.hiddenFromStoreIds : [];
    const isHidden = currentHidden.includes(comboId);
    const nextHidden = isHidden
      ? currentHidden.filter((id) => id !== comboId)
      : [...currentHidden, comboId].slice(0, 2000);
    onSettingsUpdated?.({ hiddenFromStoreIds: nextHidden });
    try {
      const updated = await api.updateSettings({ hiddenFromStoreIds: nextHidden });
      onSettingsUpdated?.(updated);
      onSavedFeedback(isHidden ? 'Combo liberado no delivery' : 'Combo definido para Só no balcão/mesa');
    } catch (err: any) {
      onSettingsUpdated?.({ hiddenFromStoreIds: currentHidden });
      onErrorNotice(err?.message || 'Não foi possível atualizar a visibilidade no delivery.');
    }
  };

  const handleConfirmDeleteCombo = async () => {
    if (!confirmDeleteCombo) return;
    setIsDeleting(true);
    try {
      await api.deleteProduct(confirmDeleteCombo.id);
      const nextCombos = { ...(settings.combos || {}) };
      delete nextCombos[confirmDeleteCombo.id];
      const nextHidden = (settings.hiddenFromStoreIds || []).filter((id) => id !== confirmDeleteCombo.id);
      onSettingsUpdated?.({ combos: nextCombos, hiddenFromStoreIds: nextHidden });
      onProductDeleted?.(confirmDeleteCombo.id);
      setConfirmDeleteCombo(null);
      onSavedFeedback('Combo removido');
    } catch (err: any) {
      onErrorNotice(err?.message || 'Não foi possível excluir o combo.');
    } finally {
      setIsDeleting(false);
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Boxes className="w-5 h-5 text-amber-500" />
            <h3 className="font-black text-sm sm:text-base text-neutral-900">
              Combos ({comboProducts.length}/100)
            </h3>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Ao vender um combo, o sistema baixa automaticamente o estoque de cada produto que está dentro dele.
          </p>
        </div>

        <button
          type="button"
          onClick={openNewComboModal}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl text-xs inline-flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Novo combo</span>
        </button>
      </div>

      {comboProducts.length === 0 ? (
        <div className="p-6 rounded-2xl bg-neutral-50 border border-dashed border-neutral-200 text-center space-y-2">
          <p className="text-xs font-bold text-neutral-600">
            Nenhum combo cadastrado ainda.
          </p>
          <p className="text-[11px] text-neutral-400">
            Exemplo: 1 Red Label 1L + 3 Red Bull + 4 Gelo de Coco por R$ 100,00.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {comboProducts.map((combo) => {
            const metrics = calculateComboMetrics(combo, settings, products);
            const effPrice = getEffectiveProductPrice(combo);
            return (
              <div
                key={combo.id}
                className="p-3.5 rounded-2xl border border-neutral-200 bg-neutral-50/60 hover:bg-white transition-colors flex items-start justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  {combo.imageUrl || combo.image ? (
                    <img
                      src={combo.imageUrl || combo.image}
                      alt={combo.name}
                      loading="lazy"
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-xl object-cover border border-neutral-200 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                      <Boxes className="w-5 h-5" />
                    </div>
                  )}
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-black text-neutral-900 text-xs sm:text-sm truncate">
                        {combo.name}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black uppercase">
                        Combo
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-neutral-600 text-[10px] font-bold">
                        {getCategoryDisplayName(combo.category, settings, products)}
                      </span>
                      {!combo.active && (
                        <span className="px-1.5 py-0.5 rounded bg-neutral-200 text-neutral-700 text-[10px] font-bold">
                          Desativado
                        </span>
                      )}
                      {isProductHiddenFromStore(combo.id, settings) && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold inline-flex items-center gap-1">
                          <Utensils className="w-3 h-3 text-amber-700" />
                          <span>Só no balcão/mesa</span>
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-neutral-600 font-medium leading-snug">
                      {metrics.itemsSummaryText}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                      <span className="font-black text-neutral-900">
                        {formatCurrency(effPrice)}
                      </span>
                      {metrics.discount > 0 && (
                        <span className="text-emerald-700 font-bold">
                          Separados: {formatCurrency(metrics.separatePrice)} (-{formatCurrency(metrics.discount)})
                        </span>
                      )}
                      <span className="text-neutral-500">
                        Custo: {formatCurrency(metrics.costPrice)} ({metrics.marginPercent.toFixed(1).replace('.', ',')}% margem)
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-lg font-black text-[10px] ${
                          metrics.availableStock > 0
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-red-100 text-red-700 border border-red-200'
                        }`}
                      >
                        Disponível: {metrics.availableStock}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleToggleComboActive(combo)}
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                          combo.active !== false
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-neutral-100 text-neutral-600 border-neutral-300 hover:bg-neutral-200'
                        }`}
                        title={
                          combo.active !== false
                            ? 'Ativo em todo lugar (clique para desativar)'
                            : 'Desativado em todo lugar (clique para ativar)'
                        }
                      >
                        {combo.active !== false ? (
                          <>
                            <Eye className="w-3 h-3 text-emerald-600" />
                            <span>Ativo</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="w-3 h-3 text-neutral-500" />
                            <span>Desativado</span>
                          </>
                        )}
                      </button>

                      {(() => {
                        const isHiddenFromDelivery = isProductHiddenFromStore(combo.id, settings);
                        return (
                          <button
                            type="button"
                            onClick={() => handleToggleComboDeliveryVisibility(combo.id)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                              !isHiddenFromDelivery
                                ? 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                            }`}
                            title={
                              !isHiddenFromDelivery
                                ? 'Aparece no delivery / loja online (clique para ocultar do delivery)'
                                : 'Só no balcão/mesa (clique para ativar no delivery)'
                            }
                          >
                            {!isHiddenFromDelivery ? (
                              <>
                                <Truck className="w-3 h-3 text-sky-600" />
                                <span>Aparece no delivery</span>
                              </>
                            ) : (
                              <>
                                <Utensils className="w-3 h-3 text-amber-700" />
                                <span>Só no balcão/mesa</span>
                              </>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditComboModal(combo)}
                    className="p-2 rounded-xl bg-white hover:bg-neutral-100 text-neutral-700 border border-neutral-200 cursor-pointer"
                    title="Editar combo"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteCombo(combo)}
                    className="p-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 cursor-pointer"
                    title="Excluir combo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Novo Combo / Editar Combo */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-2xl w-full shadow-2xl border border-neutral-200 overflow-hidden my-auto max-h-[94dvh] flex flex-col">
            <div className="p-4 sm:p-5 bg-neutral-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <Boxes className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base">
                  {editingComboId ? 'Editar combo' : 'Novo combo'}
                </h3>
              </div>
              <button
                type="button"
                disabled={isSaving}
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCombo} className="p-4 sm:p-6 space-y-5 overflow-y-auto flex-1 text-xs">
              {modalError && (
                <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="font-bold text-neutral-700 block mb-1">
                    Nome do combo *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Combo Red Label 1L + 3 Red Bull + 4 Gelo de Coco"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    Preço do combo (R$) *
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    placeholder="Ex: 100.00"
                    value={priceStr}
                    onChange={(e) => setPriceStr(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-black text-neutral-900 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    Categoria *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  >
                    {modalCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Photo upload & URL */}
                <div className="sm:col-span-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="font-bold text-neutral-700 block">
                      Foto do combo (opcional)
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPhotoHelp((v) => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                      <span>Como ajustar a foto</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    {image ? (
                      <img
                        src={image}
                        alt="Preview"
                        loading="lazy"
                        width={56}
                        height={56}
                        className="w-14 h-14 rounded-2xl object-cover border border-neutral-300 shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-2xl bg-neutral-100 border border-dashed border-neutral-300 flex items-center justify-center text-neutral-400 shrink-0">
                        <Package className="w-5 h-5" />
                      </div>
                    )}
                    <div className="flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          <span>{isUploadingPhoto ? 'Otimizando...' : 'Enviar foto'}</span>
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={handlePhotoUpload}
                            className="hidden"
                          />
                        </label>
                        {image && (
                          <button
                            type="button"
                            onClick={() => {
                              setImage('');
                              setPhotoOptimizedSummary('');
                            }}
                            className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs cursor-pointer"
                          >
                            Remover foto
                          </button>
                        )}
                        {photoOptimizedSummary && (
                          <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                            {photoOptimizedSummary}
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder="Ou cole o link (URL) da imagem..."
                        value={/^https?:\/\//i.test(image) ? image : ''}
                        onChange={(e) => {
                          setImage(e.target.value);
                          setPhotoOptimizedSummary('');
                        }}
                        className="w-full px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-xl text-xs"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-neutral-500 leading-relaxed">
                    Dica: use foto quadrada, com o produto centralizado e fundo claro. Tamanho ideal 600×600 px. Fotos grandes são reduzidas automaticamente para não deixar a loja lenta.
                  </p>
                  {showPhotoHelp && (
                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 space-y-1">
                      <p className="font-black">Como deixar a foto perfeita:</p>
                      <ul className="list-disc pl-4 space-y-0.5 text-amber-900 font-medium">
                        <li>No celular, abra a foto na galeria e toque em <strong>editar → cortar → 1:1</strong> (formato quadrado).</li>
                        <li>Evite print de tela com bordas pretas, relógio ou barra de bateria.</li>
                        <li>Prefira fundo branco ou claro com a bebida bem centralizada.</li>
                        <li>Aceitamos JPG, PNG e WebP (até 10 MB). Fotos acima de 5 MB podem levar alguns segundos a mais para otimizar.</li>
                      </ul>
                    </div>
                  )}
                </div>

                {/* Toggles: Gelada, Ativo/Desativado & Aparece no delivery */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setIsCold((v) => !v)}
                    className={`flex-1 py-2 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                      isCold
                        ? 'bg-sky-50 border-sky-300 text-sky-800'
                        : 'bg-neutral-50 border-neutral-200 text-neutral-600'
                    }`}
                  >
                    <Snowflake className="w-4 h-4" />
                    <span>{isCold ? 'Super Gelada' : 'Temperatura Ambiente'}</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActive((v) => !v)}
                    className={`flex-1 py-2 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                      active
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                        : 'bg-neutral-100 border-neutral-300 text-neutral-600'
                    }`}
                  >
                    {active ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    <span>{active ? 'Ativo' : 'Desativado'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAppearsInDelivery((v) => !v)}
                    className={`flex-1 py-2 px-3 rounded-xl border font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                      appearsInDelivery
                        ? 'bg-sky-50 border-sky-300 text-sky-800'
                        : 'bg-amber-50 border-amber-300 text-amber-900'
                    }`}
                  >
                    {appearsInDelivery ? (
                      <>
                        <Truck className="w-4 h-4 text-sky-600" />
                        <span>Aparece no delivery</span>
                      </>
                    ) : (
                      <>
                        <Utensils className="w-4 h-4 text-amber-700" />
                        <span>Só no balcão/mesa</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Composição do Combo (Lista de Itens) */}
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-neutral-900 text-xs sm:text-sm">
                    Itens que vêm dentro do combo ({comboItems.length}/15) *
                  </h4>
                  <span className="text-[11px] text-neutral-500">
                    Disponível calculado: <strong>{liveModalMetrics.availableStock}</strong>
                  </span>
                </div>

                {/* Search & Add Product to Combo */}
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar produto para colocar no combo (ex: Red Label, Red Bull, Gelo)..."
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
                    />
                  </div>

                  {itemSearch.trim().length > 0 && (
                    <div className="max-h-44 overflow-y-auto bg-white border border-neutral-200 rounded-xl divide-y divide-neutral-100 shadow-xs">
                      {filteredEligibleProducts.length === 0 ? (
                        <div className="p-3 text-center text-neutral-400 text-xs">
                          Nenhum produto encontrado.
                        </div>
                      ) : (
                        filteredEligibleProducts.map((prod) => (
                          <div
                            key={prod.id}
                            className="p-2.5 hover:bg-amber-50/60 flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-neutral-900 truncate">
                                {formatComboComponentProductName(prod)}
                              </div>
                              <div className="text-[11px] text-neutral-500">
                                Preço: {formatCurrency(getEffectiveProductPrice(prod))} • Custo:{' '}
                                {formatCurrency(Number(prod.costPrice) || 0)} • Estoque: {prod.stock} un
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleAddComponentItem(prod, 1)}
                              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-lg text-xs inline-flex items-center gap-1 shrink-0 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Adicionar</span>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* Quick select dropdown + quantity */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <select
                      value={selectedComponentId}
                      onChange={(e) => setSelectedComponentId(e.target.value)}
                      className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800"
                    >
                      <option value="">Ou escolha um produto na lista...</option>
                      {filteredEligibleProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {formatComboComponentProductName(p)} — {formatCurrency(getEffectiveProductPrice(p))} (Est: {p.stock})
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <label className="text-neutral-600 font-bold shrink-0">Qtd:</label>
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={selectedComponentQty}
                        onChange={(e) =>
                          setSelectedComponentQty(Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)))
                        }
                        className="w-16 px-2.5 py-2 bg-white border border-neutral-300 rounded-xl font-black text-center text-neutral-900"
                      />
                      <button
                        type="button"
                        disabled={!selectedComponentId}
                        onClick={() => handleAddComponentItem()}
                        className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-40 text-white font-black rounded-xl text-xs inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Incluir</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Selected component items list */}
                {comboItems.length === 0 ? (
                  <div className="p-4 rounded-xl bg-white border border-dashed border-neutral-200 text-center text-neutral-400 text-xs">
                    Busque ou selecione os produtos acima para montar o combo.
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100 bg-white border border-neutral-200 rounded-xl overflow-hidden">
                    {comboItems.map((ci) => {
                      const comp = products.find((p) => p.id === ci.productId);
                      const unitPrice = comp ? getEffectiveProductPrice(comp) : 0;
                      const unitCost = comp ? Number(comp.costPrice) || 0 : 0;
                      const maxCombosFromThis = comp
                        ? Math.floor(Math.max(0, Number(comp.stock) || 0) / ci.quantity)
                        : 0;

                      return (
                        <div
                          key={ci.productId}
                          className="p-2.5 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-neutral-900 truncate">
                              {comp ? formatComboComponentProductName(comp) : ci.productId}
                            </div>
                            <div className="text-[11px] text-neutral-500">
                              Avulso: {formatCurrency(unitPrice * ci.quantity)} ({ci.quantity}× {formatCurrency(unitPrice)}) • Custo: {formatCurrency(unitCost * ci.quantity)} • Estoque item: {comp?.stock ?? 0} un (dá p/ {maxCombosFromThis} combos)
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center gap-1">
                              <span className="text-[11px] font-bold text-neutral-500">Qtd:</span>
                              <input
                                type="number"
                                min={1}
                                max={99}
                                value={ci.quantity}
                                onChange={(e) => handleUpdateComponentQty(ci.productId, e.target.value)}
                                className="w-14 px-2 py-1 bg-neutral-50 border border-neutral-300 rounded-lg font-black text-center text-neutral-900"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveComponentItem(ci.productId)}
                              className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 cursor-pointer"
                              title="Remover item do combo"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Requirement 1.c: Live summary lines */}
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                  <p className="text-xs font-black text-neutral-900">
                    Valor dos itens separados: {formatCurrency(liveModalMetrics.separateValue)} — desconto do combo: {formatCurrency(liveModalMetrics.discount)}
                  </p>
                  <p className="text-xs font-bold text-neutral-700">
                    Custo: {formatCurrency(liveModalMetrics.totalCost)} — margem: {liveModalMetrics.marginPercent.toFixed(1).replace('.', ',')}%
                  </p>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 shrink-0">
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl inline-flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>{isSaving ? 'Salvando...' : 'Salvar combo'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Confirm Delete Combo */}
      {confirmDeleteCombo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-neutral-200 overflow-hidden p-6 space-y-4 text-xs">
            <div className="flex items-center gap-2.5 text-red-600">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="font-black text-base text-neutral-900">
                Excluir combo "{confirmDeleteCombo.name}"?
              </h3>
            </div>
            <p className="text-neutral-600 leading-relaxed">
              O combo será removido da loja. Os produtos individuais que fazem parte dele continuam normalmente no estoque.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDeleteCombo(null)}
                className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDeleteCombo}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black rounded-xl cursor-pointer"
              >
                {isDeleting ? 'Excluindo...' : 'Excluir combo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
