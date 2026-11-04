import React, { useState, useMemo } from 'react';
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
  AddonGroup,
  AddonOption,
} from '../../types';
import { api } from '../../services/api';
import {
  Plus,
  Edit2,
  Trash2,
  Check,
  X,
  Search,
  ListPlus,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

interface SortableOptionRowProps {
  id: string;
  children: React.ReactNode;
}

const SortableOptionRow: React.FC<SortableOptionRowProps> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`p-2.5 bg-white hover:bg-neutral-50 border border-neutral-200 rounded-xl flex items-center justify-between gap-2 text-xs transition-shadow ${
        isDragging ? 'shadow-lg ring-2 ring-amber-400 bg-amber-50/40 relative' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="px-1.5 py-1 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 font-black text-sm leading-none tracking-tighter cursor-grab active:cursor-grabbing touch-none select-none shrink-0"
          title="Segure e arraste para reordenar opção"
          aria-label="Arrastar para reordenar opção"
        >
          ⋮⋮
        </button>
        {children}
      </div>
    </div>
  );
};

interface AddonGroupsManagerProps {
  products: Product[];
  categories: StoreCategoryItem[];
  settings: StoreSettings;
  showArrows: boolean;
  onSettingsUpdated?: (next: Partial<StoreSettings>) => void;
  onSavedFeedback: (msg?: string) => void;
  onErrorNotice: (msg: string) => void;
}

export const AddonGroupsManager: React.FC<AddonGroupsManagerProps> = ({
  products,
  categories,
  settings,
  showArrows,
  onSettingsUpdated,
  onSavedFeedback,
  onErrorNotice,
}) => {
  const groups = useMemo<AddonGroup[]>(() => {
    return Array.isArray(settings.addonGroups) ? settings.addonGroups : [];
  }, [settings.addonGroups]);

  // Editor state (null = closed; 'new' or group.id)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState<string>('');
  const [groupActive, setGroupActive] = useState<boolean>(true);
  const [groupMin, setGroupMin] = useState<number>(0);
  const [groupMax, setGroupMax] = useState<number>(1);
  const [groupOptions, setGroupOptions] = useState<AddonOption[]>([]);
  const [groupCategoryIds, setGroupCategoryIds] = useState<string[]>([]);
  const [groupProductIds, setGroupProductIds] = useState<string[]>([]);

  // New option inputs inside editor
  const [newOptName, setNewOptName] = useState<string>('');
  const [newOptPrice, setNewOptPrice] = useState<string>('0');

  // Inline option edit state inside editor
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editOptName, setEditOptName] = useState<string>('');
  const [editOptPrice, setEditOptPrice] = useState<string>('0');
  const [confirmDeleteOptionId, setConfirmDeleteOptionId] = useState<string | null>(null);

  // Product search inside editor
  const [productSearch, setProductSearch] = useState<string>('');

  // In-screen confirmation for deleting a group
  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const persistAddonGroups = async (nextGroups: AddonGroup[], successMsg: string) => {
    setIsSaving(true);
    onErrorNotice('');
    try {
      onSettingsUpdated?.({ addonGroups: nextGroups });
      await api.updateSettings({ addonGroups: nextGroups });
      onSavedFeedback(successMsg);
      return true;
    } catch (err: any) {
      onErrorNotice(err?.message || 'Não foi possível salvar os grupos de adicionais.');
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const openNewGroupForm = () => {
    if (groups.length >= 30) {
      onErrorNotice('Limite máximo de 30 grupos de adicionais atingido.');
      return;
    }
    setEditingGroupId('__new__');
    setGroupName('');
    setGroupActive(true);
    setGroupMin(0);
    setGroupMax(1);
    setGroupOptions([]);
    setGroupCategoryIds([]);
    setGroupProductIds([]);
    setNewOptName('');
    setNewOptPrice('0');
    setEditingOptionId(null);
    setConfirmDeleteOptionId(null);
    setProductSearch('');
    onErrorNotice('');
  };

  const openEditGroupForm = (group: AddonGroup) => {
    setEditingGroupId(group.id);
    setGroupName(group.name);
    setGroupActive(group.active !== false);
    setGroupMin(Math.max(0, Math.min(10, Math.floor(Number(group.min) || 0))));
    setGroupMax(
      Math.max(
        Math.max(1, Math.floor(Number(group.min) || 0)),
        Math.min(10, Math.floor(Number(group.max) || 1))
      )
    );
    setGroupOptions(
      Array.isArray(group.options) ? group.options.map((o) => ({ ...o })) : []
    );
    setGroupCategoryIds(Array.isArray(group.categoryIds) ? [...group.categoryIds] : []);
    setGroupProductIds(Array.isArray(group.productIds) ? [...group.productIds] : []);
    setNewOptName('');
    setNewOptPrice('0');
    setEditingOptionId(null);
    setConfirmDeleteOptionId(null);
    setProductSearch('');
    onErrorNotice('');
  };

  const closeEditor = () => {
    setEditingGroupId(null);
    setEditingOptionId(null);
    setConfirmDeleteOptionId(null);
  };

  const handleAddOption = () => {
    const trimmed = newOptName.trim().slice(0, 60);
    if (!trimmed) {
      onErrorNotice('Informe o nome da opção de adicional.');
      return;
    }
    if (groupOptions.length >= 20) {
      onErrorNotice('Cada grupo pode ter no máximo 20 opções.');
      return;
    }
    const parsedPrice = Number(String(newOptPrice).replace(',', '.'));
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      onErrorNotice('O preço da opção deve ser maior ou igual a R$ 0,00.');
      return;
    }
    const cleanPrice = Math.round(parsedPrice * 100) / 100;
    const newOption: AddonOption = {
      id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      price: cleanPrice,
      active: true,
    };
    setGroupOptions((prev) => [...prev, newOption]);
    setNewOptName('');
    setNewOptPrice('0');
    onErrorNotice('');
  };

  const handleStartEditOption = (opt: AddonOption) => {
    setEditingOptionId(opt.id);
    setEditOptName(opt.name);
    setEditOptPrice(String(opt.price ?? 0));
    setConfirmDeleteOptionId(null);
  };

  const handleConfirmEditOption = (optId: string) => {
    const trimmed = editOptName.trim().slice(0, 60);
    if (!trimmed) {
      onErrorNotice('O nome da opção não pode ficar vazio.');
      return;
    }
    const parsedPrice = Number(String(editOptPrice).replace(',', '.'));
    if (Number.isNaN(parsedPrice) || parsedPrice < 0) {
      onErrorNotice('Preço inválido para a opção.');
      return;
    }
    const cleanPrice = Math.round(parsedPrice * 100) / 100;
    setGroupOptions((prev) =>
      prev.map((o) => (o.id === optId ? { ...o, name: trimmed, price: cleanPrice } : o))
    );
    setEditingOptionId(null);
  };

  const handleToggleOptionActive = (optId: string) => {
    setGroupOptions((prev) =>
      prev.map((o) => (o.id === optId ? { ...o, active: o.active === false ? true : false } : o))
    );
  };

  const handleDeleteOption = (optId: string) => {
    setGroupOptions((prev) => prev.filter((o) => o.id !== optId));
    setConfirmDeleteOptionId(null);
  };

  const handleOptionsDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setGroupOptions((prev) => {
      const oldIdx = prev.findIndex((o) => o.id === String(active.id));
      const newIdx = prev.findIndex((o) => o.id === String(over.id));
      if (oldIdx < 0 || newIdx < 0) return prev;
      return arrayMove(prev, oldIdx, newIdx);
    });
  };

  const handleMoveOptionArrow = (idx: number, dir: -1 | 1) => {
    setGroupOptions((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      return arrayMove(prev, idx, target);
    });
  };

  const toggleCategorySelection = (catId: string) => {
    setGroupCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const toggleProductSelection = (prodId: string) => {
    setGroupProductIds((prev) =>
      prev.includes(prodId) ? prev.filter((id) => id !== prodId) : [...prev, prodId]
    );
  };

  const handleSaveGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = groupName.trim().slice(0, 60);
    if (!trimmedName) {
      onErrorNotice('Informe o nome do grupo de adicionais (ex: Gelo, Copo).');
      return;
    }
    if (groupOptions.length === 0) {
      onErrorNotice('Adicione pelo menos 1 opção ao grupo antes de salvar.');
      return;
    }
    const cleanMin = Math.max(0, Math.min(10, Math.floor(Number(groupMin) || 0)));
    const cleanMax = Math.max(Math.max(1, cleanMin), Math.min(10, Math.floor(Number(groupMax) || 1)));

    const groupObj: AddonGroup = {
      id:
        editingGroupId && editingGroupId !== '__new__'
          ? editingGroupId
          : `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedName,
      active: groupActive,
      min: cleanMin,
      max: cleanMax,
      options: groupOptions.slice(0, 20),
      categoryIds: groupCategoryIds,
      productIds: groupProductIds,
    };

    const nextGroups =
      editingGroupId === '__new__'
        ? [...groups, groupObj]
        : groups.map((g) => (g.id === editingGroupId ? groupObj : g));

    const ok = await persistAddonGroups(
      nextGroups,
      editingGroupId === '__new__' ? 'Grupo de adicionais criado' : 'Grupo de adicionais atualizado'
    );
    if (ok) {
      closeEditor();
    }
  };

  const handleToggleGroupActiveQuick = async (group: AddonGroup) => {
    const nextGroups = groups.map((g) =>
      g.id === group.id ? { ...g, active: g.active === false ? true : false } : g
    );
    await persistAddonGroups(
      nextGroups,
      group.active === false ? 'Grupo ativado' : 'Grupo desativado'
    );
  };

  const handleConfirmDeleteGroup = async (groupId: string) => {
    const nextGroups = groups.filter((g) => g.id !== groupId);
    const ok = await persistAddonGroups(nextGroups, 'Grupo de adicionais excluído');
    if (ok) {
      setConfirmDeleteGroupId(null);
      if (editingGroupId === groupId) closeEditor();
    }
  };

  const filteredProductsForPicker = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 25);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.volume && p.volume.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [products, productSearch]);

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [products]);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-xs overflow-hidden">
      <div className="p-4 border-b border-neutral-200 bg-neutral-50/70 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="font-black text-neutral-900 text-sm flex items-center gap-2">
            <ListPlus className="w-4 h-4 text-amber-600" />
            4. Adicionais na escolha do produto ({groups.length}/30)
          </h4>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Crie grupos como &ldquo;Gelo&rdquo;, &ldquo;Copo&rdquo; ou &ldquo;Acompanhamentos&rdquo; e vincule a categorias ou produtos específicos.
          </p>
        </div>

        {!editingGroupId && (
          <button
            type="button"
            disabled={groups.length >= 30 || isSaving}
            onClick={openNewGroupForm}
            className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Novo Grupo de Adicionais
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Group Editor Form */}
        {editingGroupId && (
          <form
            onSubmit={handleSaveGroup}
            className="p-4 rounded-2xl bg-neutral-50 border-2 border-amber-300 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 pb-3">
              <h5 className="font-black text-neutral-900 text-sm">
                {editingGroupId === '__new__'
                  ? 'Novo Grupo de Adicionais'
                  : 'Editar Grupo de Adicionais'}
              </h5>
              <button
                type="button"
                onClick={closeEditor}
                className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Basic Group Settings */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="font-bold text-neutral-700 block mb-1">
                  Nome do Grupo * (ex: Gelo, Copo, Acompanhamentos)
                </label>
                <input
                  type="text"
                  required
                  maxLength={60}
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Ex: Gelo e Copo"
                  className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl font-semibold text-neutral-900"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Mínimo (0 = opcional)
                </label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={1}
                  value={groupMin}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(10, parseInt(e.target.value, 10) || 0));
                    setGroupMin(v);
                    if (groupMax < Math.max(1, v)) {
                      setGroupMax(Math.max(1, v));
                    }
                  }}
                  className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl font-bold text-neutral-900"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Máximo (1 a 10)
                </label>
                <input
                  type="number"
                  min={Math.max(1, groupMin)}
                  max={10}
                  step={1}
                  value={groupMax}
                  onChange={(e) => {
                    const v = Math.max(
                      Math.max(1, groupMin),
                      Math.min(10, parseInt(e.target.value, 10) || 1)
                    );
                    setGroupMax(v);
                  }}
                  className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl font-bold text-neutral-900"
                />
              </div>
            </div>

            {/* Active status toggle */}
            <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-neutral-200 text-xs">
              <div>
                <span className="font-bold text-neutral-800">Status do Grupo</span>
                <p className="text-[11px] text-neutral-500">
                  Quando desativado, este grupo não aparece para o cliente nem no balcão.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGroupActive((prev) => !prev)}
                className={`px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 cursor-pointer ${
                  groupActive
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    : 'bg-neutral-200 text-neutral-600 border border-neutral-300'
                }`}
              >
                {groupActive ? (
                  <>
                    <ToggleRight className="w-4 h-4" /> Ativo
                  </>
                ) : (
                  <>
                    <ToggleLeft className="w-4 h-4" /> Inativo
                  </>
                )}
              </button>
            </div>

            {/* Options Management */}
            <div className="bg-white p-3.5 rounded-xl border border-neutral-200 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-black text-neutral-900 text-xs">
                  Opções do Grupo ({groupOptions.length}/20) — segure ⋮⋮ para ordenar
                </span>
              </div>

              {/* Add New Option Row */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  maxLength={60}
                  value={newOptName}
                  onChange={(e) => setNewOptName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddOption();
                    }
                  }}
                  placeholder="Nome da opção (ex: Gelo de Coco, Copo 700ml)"
                  className="flex-1 px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-medium"
                />
                <div className="flex items-center gap-2">
                  <div className="relative w-32">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-neutral-400">
                      R$
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={newOptPrice}
                      onChange={(e) => setNewOptPrice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddOption();
                        }
                      }}
                      placeholder="0,00"
                      className="w-full pl-8 pr-2.5 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={groupOptions.length >= 20}
                    onClick={handleAddOption}
                    className="px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Incluir opção
                  </button>
                </div>
              </div>

              {/* Sortable Options List */}
              {groupOptions.length === 0 ? (
                <div className="p-4 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-xl">
                  Nenhuma opção adicionada ainda. Adicione pelo menos uma opção acima.
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleOptionsDragEnd}
                >
                  <SortableContext
                    items={groupOptions.map((o) => o.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1.5">
                      {groupOptions.map((opt, idx) => (
                        <SortableOptionRow key={opt.id} id={opt.id}>
                          <div className="flex items-center justify-between gap-2 w-full min-w-0">
                            {editingOptionId === opt.id ? (
                              <div className="flex flex-wrap items-center gap-1.5 flex-1">
                                <input
                                  type="text"
                                  maxLength={60}
                                  value={editOptName}
                                  onChange={(e) => setEditOptName(e.target.value)}
                                  className="flex-1 min-w-[140px] px-2.5 py-1 border border-amber-400 rounded-lg text-xs font-bold"
                                />
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={editOptPrice}
                                  onChange={(e) => setEditOptPrice(e.target.value)}
                                  className="w-24 px-2 py-1 border border-amber-400 rounded-lg text-xs font-bold"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleConfirmEditOption(opt.id)}
                                  className="p-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                                  title="Salvar opção"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingOptionId(null)}
                                  className="p-1.5 rounded-lg bg-neutral-200 text-neutral-700 hover:bg-neutral-300 cursor-pointer"
                                  title="Cancelar"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`font-bold truncate ${
                                      opt.active === false
                                        ? 'line-through text-neutral-400'
                                        : 'text-neutral-900'
                                    }`}
                                  >
                                    {opt.name}
                                  </span>
                                  <span
                                    className={`px-2 py-0.5 rounded font-bold text-[11px] shrink-0 ${
                                      opt.price > 0
                                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                    }`}
                                  >
                                    {opt.price > 0
                                      ? `+ R$ ${Number(opt.price).toFixed(2).replace('.', ',')}`
                                      : 'grátis'}
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {showArrows && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={idx === 0}
                                        onClick={() => handleMoveOptionArrow(idx, -1)}
                                        className="w-6 h-6 rounded bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                        title="Subir opção (↑)"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        disabled={idx === groupOptions.length - 1}
                                        onClick={() => handleMoveOptionArrow(idx, 1)}
                                        className="w-6 h-6 rounded bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40 text-neutral-800 font-black flex items-center justify-center cursor-pointer"
                                        title="Descer opção (↓)"
                                      >
                                        ↓
                                      </button>
                                    </>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => handleToggleOptionActive(opt.id)}
                                    className={`px-2 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                                      opt.active !== false
                                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                        : 'bg-neutral-200 text-neutral-600 hover:bg-neutral-300'
                                    }`}
                                  >
                                    {opt.active !== false ? 'Ativa' : 'Inativa'}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleStartEditOption(opt)}
                                    className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
                                    title="Editar opção"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>

                                  {confirmDeleteOptionId === opt.id ? (
                                    <div className="flex items-center gap-1 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-lg">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteOption(opt.id)}
                                        className="text-[10px] font-black text-red-700 hover:underline cursor-pointer"
                                      >
                                        Excluir
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteOptionId(null)}
                                        className="text-[10px] font-bold text-neutral-500 hover:underline cursor-pointer"
                                      >
                                        Não
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteOptionId(opt.id)}
                                      className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                                      title="Remover opção"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </SortableOptionRow>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* Categories and Products Linking */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
              {/* Categories Picker */}
              <div className="bg-white p-3.5 rounded-xl border border-neutral-200 space-y-2">
                <div className="font-black text-neutral-900">
                  Categorias onde este grupo aparece ({groupCategoryIds.length})
                </div>
                <p className="text-[11px] text-neutral-500">
                  Todos os produtos das categorias marcadas terão este grupo de adicionais.
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {categories.map((cat) => {
                    const selected = groupCategoryIds.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategorySelection(cat.id)}
                        className={`px-2.5 py-1.5 rounded-xl font-bold text-xs border transition-all cursor-pointer flex items-center gap-1 ${
                          selected
                            ? 'bg-amber-500 text-neutral-950 border-amber-500 shadow-xs'
                            : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                        }`}
                      >
                        {selected && <Check className="w-3 h-3" />}
                        <span>{cat.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Specific Products Picker */}
              <div className="bg-white p-3.5 rounded-xl border border-neutral-200 space-y-2">
                <div className="font-black text-neutral-900">
                  Ou produtos específicos ({groupProductIds.length})
                </div>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Buscar produto para vincular..."
                    className="w-full pl-8 pr-3 py-1.5 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                  />
                </div>

                {groupProductIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto py-1">
                    {groupProductIds.map((pid) => (
                      <span
                        key={pid}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-300 text-[11px] font-bold"
                      >
                        <span className="truncate max-w-[160px]">
                          {productNameById.get(pid) || pid}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleProductSelection(pid)}
                          className="hover:text-red-600 cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="max-h-36 overflow-y-auto divide-y divide-neutral-100 border border-neutral-200 rounded-xl">
                  {filteredProductsForPicker.map((prod) => {
                    const checked = groupProductIds.includes(prod.id);
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() => toggleProductSelection(prod.id)}
                        className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between gap-2 text-xs hover:bg-neutral-50 cursor-pointer ${
                          checked ? 'bg-amber-50/70 font-bold text-neutral-900' : 'text-neutral-700'
                        }`}
                      >
                        <span className="truncate">
                          {prod.name} {prod.volume ? `(${prod.volume})` : ''}
                        </span>
                        <span
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            checked
                              ? 'bg-amber-500 border-amber-500 text-neutral-950'
                              : 'border-neutral-300'
                          }`}
                        >
                          {checked && <Check className="w-3 h-3" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeEditor}
                className="px-4 py-2 rounded-xl bg-neutral-200 hover:bg-neutral-300 text-neutral-800 font-bold text-xs cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white font-black text-xs cursor-pointer"
              >
                {isSaving ? 'Salvando...' : 'Salvar Grupo de Adicionais'}
              </button>
            </div>
          </form>
        )}

        {/* Existing Groups List */}
        {groups.length === 0 ? (
          <div className="p-6 text-center text-xs text-neutral-400 border border-dashed border-neutral-200 rounded-2xl">
            Nenhum grupo de adicionais cadastrado. Clique em &ldquo;Novo Grupo de Adicionais&rdquo; para criar.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {groups.map((group) => {
              const isGroupActive = group.active !== false;
              const activeOptCount = (group.options || []).filter((o) => o.active !== false).length;

              return (
                <div
                  key={group.id}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                    isGroupActive
                      ? 'bg-white border-neutral-200'
                      : 'bg-neutral-50 border-neutral-200 opacity-75'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-black text-neutral-900 text-sm flex items-center gap-2">
                          <span>{group.name}</span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isGroupActive
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-neutral-200 text-neutral-600'
                            }`}
                          >
                            {isGroupActive ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-500 mt-0.5">
                          {group.min > 0 ? `Obrigatório (mín. ${group.min})` : 'Opcional'} • Máx.{' '}
                          {group.max} • {activeOptCount}/{(group.options || []).length} opções ativas
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleGroupActiveQuick(group)}
                          className="px-2 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-bold text-[11px] cursor-pointer"
                        >
                          {isGroupActive ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditGroupForm(group)}
                          className="p-1.5 rounded-lg text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 cursor-pointer"
                          title="Editar grupo"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {confirmDeleteGroupId === group.id ? (
                          <div className="flex items-center gap-1 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                            <button
                              type="button"
                              onClick={() => handleConfirmDeleteGroup(group.id)}
                              className="text-[11px] font-black text-red-700 hover:underline cursor-pointer"
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteGroupId(null)}
                              className="text-[11px] font-bold text-neutral-500 hover:underline cursor-pointer"
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteGroupId(group.id)}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600 hover:bg-red-50 cursor-pointer"
                            title="Excluir grupo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Options Pills Preview */}
                    <div className="flex flex-wrap gap-1">
                      {(group.options || []).map((opt) => (
                        <span
                          key={opt.id}
                          className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${
                            opt.active === false
                              ? 'bg-neutral-100 text-neutral-400 border-neutral-200 line-through'
                              : 'bg-amber-50/70 text-neutral-800 border-amber-200/80'
                          }`}
                        >
                          {opt.name}{' '}
                          <strong className="text-amber-900">
                            {opt.price > 0
                              ? `+R$ ${Number(opt.price).toFixed(2).replace('.', ',')}`
                              : 'grátis'}
                          </strong>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Linked Categories & Products Summary */}
                  <div className="pt-2 border-t border-neutral-100 text-[11px] text-neutral-500 flex flex-wrap gap-1.5">
                    {(group.categoryIds || []).length === 0 &&
                    (group.productIds || []).length === 0 ? (
                      <span className="text-amber-700 font-semibold">
                        Vinculado a nenhuma categoria ou produto ainda
                      </span>
                    ) : (
                      <>
                        {(group.categoryIds || []).map((cid) => (
                          <span
                            key={`c-${cid}`}
                            className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-bold"
                          >
                            Cat: {categoryNameById.get(cid) || cid}
                          </span>
                        ))}
                        {(group.productIds || []).length > 0 && (
                          <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-bold">
                            +{group.productIds.length}{' '}
                            {group.productIds.length === 1 ? 'produto' : 'produtos'}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
