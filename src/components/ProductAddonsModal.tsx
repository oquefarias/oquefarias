import React, { useState, useMemo } from 'react';
import {
  Product,
  SaleUnit,
  AddonGroup,
  OrderItemAddon,
  hasProductCase,
  getEffectiveProductPrice,
  formatUnitAndCaseCount,
} from '../types';
import { X, Plus, Minus, Check, AlertCircle, ShoppingBag, Package } from 'lucide-react';

interface ProductAddonsModalProps {
  product: Product;
  initialSaleUnit?: SaleUnit;
  addonGroups: AddonGroup[];
  availableStockUnits: number;
  inCartSummary?: string;
  onClose: () => void;
  onConfirm: (payload: {
    product: Product;
    saleUnit: SaleUnit;
    quantity: number;
    addons: OrderItemAddon[];
    addonsTotal: number;
  }) => void;
}

export const ProductAddonsModal: React.FC<ProductAddonsModalProps> = ({
  product,
  initialSaleUnit = 'unit',
  addonGroups,
  availableStockUnits,
  inCartSummary,
  onClose,
  onConfirm,
}) => {
  const canSellCase = hasProductCase(product);
  const caseSize = Number(product.caseSize) || 1;
  const canAffordCase = canSellCase && availableStockUnits >= caseSize;

  const [saleUnit, setSaleUnit] = useState<SaleUnit>(
    initialSaleUnit === 'case' && canAffordCase ? 'case' : 'unit'
  );
  const [quantity, setQuantity] = useState<number>(1);

  // Map: groupId -> { [optionId]: quantity }
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, Record<string, number>>>({});

  const unitsPerSale = saleUnit === 'case' && canSellCase ? caseSize : 1;
  const maxItemQty = Math.max(0, Math.floor(availableStockUnits / unitsPerSale));

  const baseUnitPrice =
    saleUnit === 'case' && canSellCase
      ? Number(product.casePrice)
      : getEffectiveProductPrice(product);

  const getGroupTotalSelected = (groupId: string): number => {
    const groupMap = selectedByGroup[groupId];
    if (!groupMap) return 0;
    return (Object.values(groupMap) as number[]).reduce((sum, q) => sum + (Number(q) || 0), 0);
  };

  const setOptionQty = (group: AddonGroup, optionId: string, nextQty: number) => {
    const max = Math.max(Math.max(1, group.min || 0), group.max || 1);
    const clamped = Math.max(0, Math.min(max, Math.floor(nextQty)));

    setSelectedByGroup((prev) => {
      const currentGroup = { ...(prev[group.id] || {}) };

      // If group max is 1 and user is selecting an option (clamped === 1), replace any other option in this group
      if (max === 1 && clamped === 1) {
        return {
          ...prev,
          [group.id]: { [optionId]: 1 },
        };
      }

      const currentOptQty = currentGroup[optionId] || 0;
      const otherTotal = (Object.entries(currentGroup) as [string, number][]).reduce(
        (sum, [id, q]) => (id === optionId ? sum : sum + (Number(q) || 0)),
        0
      );

      const allowedForThisOption = Math.max(0, max - otherTotal);
      const finalQty = Math.min(clamped, allowedForThisOption);

      if (finalQty <= 0) {
        delete currentGroup[optionId];
      } else {
        currentGroup[optionId] = finalQty;
      }

      if (finalQty === currentOptQty && finalQty > 0) return prev;

      return {
        ...prev,
        [group.id]: currentGroup,
      };
    });
  };

  const { chosenAddons, addonsTotal, unsatisfiedGroups } = useMemo(() => {
    const list: OrderItemAddon[] = [];
    const missing: { group: AddonGroup; current: number; required: number }[] = [];

    for (const group of addonGroups) {
      const activeOptions = (group.options || []).filter((o) => o && o.active !== false);
      const groupMap = selectedByGroup[group.id] || {};
      let groupCount = 0;

      for (const opt of activeOptions) {
        const q = Math.floor(Number(groupMap[opt.id]) || 0);
        if (q > 0) {
          groupCount += q;
          list.push({
            groupId: group.id,
            optionId: opt.id,
            groupName: group.name,
            optionName: opt.name,
            price: Math.max(0, Math.round((Number(opt.price) || 0) * 100) / 100),
            quantity: q,
          });
        }
      }

      const minRequired = Math.max(0, Math.floor(Number(group.min) || 0));
      if (minRequired > 0 && groupCount < minRequired) {
        missing.push({
          group,
          current: groupCount,
          required: minRequired,
        });
      }
    }

    const totalAddons =
      Math.round(list.reduce((sum, a) => sum + a.price * a.quantity, 0) * 100) / 100;

    return {
      chosenAddons: list,
      addonsTotal: totalAddons,
      unsatisfiedGroups: missing,
    };
  }, [addonGroups, selectedByGroup]);

  const effectiveQuantity = Math.min(Math.max(1, quantity), Math.max(1, maxItemQty));
  const unitPriceWithAddons = Math.round((baseUnitPrice + addonsTotal) * 100) / 100;
  const finalLineTotal = Math.round(unitPriceWithAddons * effectiveQuantity * 100) / 100;
  const canConfirm = unsatisfiedGroups.length === 0 && maxItemQty >= 1;

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      product,
      saleUnit,
      quantity: effectiveQuantity,
      addons: chosenAddons,
      addonsTotal,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-zinc-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border-t sm:border border-zinc-800 rounded-t-2xl sm:rounded-2xl w-full max-w-lg max-h-[92dvh] sm:max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Product Summary */}
        <div className="p-4 border-b border-zinc-800 flex items-start justify-between gap-3 bg-zinc-950/60 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {product.imageUrl || product.image ? (
              <img
                src={product.imageUrl || product.image}
                alt={product.name}
                width={56}
                height={56}
                loading="lazy"
                className="w-14 h-14 rounded-xl object-cover bg-zinc-800 border border-zinc-700/60 shrink-0"
              />
            ) : (
              <div className="w-14 h-14 rounded-xl bg-zinc-800 border border-zinc-700/60 flex items-center justify-center text-zinc-500 shrink-0">
                <ShoppingBag className="w-6 h-6" />
              </div>
            )}
            <div className="min-w-0">
              <h3 className="font-bold text-white text-base leading-snug line-clamp-2">
                {product.name}
              </h3>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {product.volume && (
                  <span className="text-xs text-zinc-400 font-medium">{product.volume}</span>
                )}
                <span className="text-sm font-black text-amber-400">
                  R$ {baseUnitPrice.toFixed(2).replace('.', ',')}
                </span>
                {inCartSummary && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 border border-amber-500/30">
                    No carrinho: {inCartSummary}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Unit / Case Selector if product has closed case */}
        {canSellCase && (
          <div className="px-4 py-2.5 bg-zinc-950/40 border-b border-zinc-800/80 flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSaleUnit('unit');
                setQuantity(1);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all flex items-center justify-between ${
                saleUnit === 'unit'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>Unidade avulsa</span>
              <span>R$ {getEffectiveProductPrice(product).toFixed(2).replace('.', ',')}</span>
            </button>
            <button
              type="button"
              disabled={!canAffordCase}
              onClick={() => {
                if (!canAffordCase) return;
                setSaleUnit('case');
                setQuantity(1);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold border transition-all flex items-center justify-between ${
                saleUnit === 'case'
                  ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                  : canAffordCase
                  ? 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  : 'bg-zinc-900/40 border-zinc-800/50 text-zinc-600 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-1">
                <Package className="w-3.5 h-3.5" />
                Caixa c/ {product.caseSize}
              </span>
              <span>R$ {Number(product.casePrice).toFixed(2).replace('.', ',')}</span>
            </button>
          </div>
        )}

        {/* Scrollable Addon Groups Section */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Adicionais
            </h4>
            {addonsTotal > 0 && (
              <span className="text-xs font-bold text-emerald-400">
                + R$ {addonsTotal.toFixed(2).replace('.', ',')} / item
              </span>
            )}
          </div>

          {addonGroups.map((group) => {
            const activeOptions = (group.options || []).filter((o) => o && o.active !== false);
            const min = Math.max(0, Math.floor(Number(group.min) || 0));
            const max = Math.max(Math.max(1, min), Math.floor(Number(group.max) || 1));
            const selectedCount = getGroupTotalSelected(group.id);
            const isRequired = min > 0;
            const isSatisfied = selectedCount >= min;
            const isMaxReached = selectedCount >= max;

            return (
              <div
                key={group.id}
                className={`rounded-xl border transition-colors overflow-hidden ${
                  isRequired && !isSatisfied
                    ? 'border-amber-500/40 bg-zinc-950/70'
                    : 'border-zinc-800 bg-zinc-950/50'
                }`}
              >
                {/* Group Header */}
                <div className="px-3.5 py-2.5 bg-zinc-900/80 border-b border-zinc-800/80 flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <div className="font-bold text-white text-sm flex items-center gap-2">
                      <span>{group.name}</span>
                      {isSatisfied && isRequired && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                          <Check className="w-3.5 h-3.5" /> OK
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      {isRequired ? `Obrigatório: escolha ${min}` : 'Opcional'} • até {max}{' '}
                      {max === 1 ? 'opção' : 'opções'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                        isRequired && !isSatisfied
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : isSatisfied && selectedCount > 0
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                      }`}
                    >
                      {isRequired ? `Obrigatório: escolha ${min}` : 'Opcional'} (até {max})
                    </span>
                    <span className="text-[11px] font-mono font-bold text-zinc-400 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                      {selectedCount}/{max}
                    </span>
                  </div>
                </div>

                {/* Group Validation Message */}
                {isRequired && !isSatisfied && (
                  <div className="px-3.5 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-2 text-xs text-amber-300 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>
                      Escolha pelo menos {min} {min === 1 ? 'opção' : 'opções'} em &ldquo;{group.name}&rdquo; (faltam {min - selectedCount}).
                    </span>
                  </div>
                )}

                {/* Options List */}
                <div className="divide-y divide-zinc-800/60">
                  {activeOptions.map((opt) => {
                    const optQty = selectedByGroup[group.id]?.[opt.id] || 0;
                    const optPrice = Math.max(0, Number(opt.price) || 0);
                    const isSelected = optQty > 0;

                    return (
                      <div
                        key={opt.id}
                        onClick={() => {
                          if (max === 1) {
                            setOptionQty(group, opt.id, isSelected ? 0 : 1);
                          } else if (!isSelected && !isMaxReached) {
                            setOptionQty(group, opt.id, 1);
                          }
                        }}
                        className={`px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${
                          max === 1 || (!isSelected && !isMaxReached) ? 'cursor-pointer' : ''
                        } ${
                          isSelected
                            ? 'bg-amber-500/10 hover:bg-amber-500/15'
                            : 'hover:bg-zinc-900/60'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-zinc-100 leading-snug">
                            {opt.name}
                          </div>
                          <div
                            className={`text-xs font-bold mt-0.5 ${
                              optPrice > 0 ? 'text-amber-400' : 'text-emerald-400'
                            }`}
                          >
                            {optPrice > 0
                              ? `+ R$ ${optPrice.toFixed(2).replace('.', ',')}`
                              : 'grátis'}
                          </div>
                        </div>

                        {/* Option Control */}
                        {max === 1 ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOptionQty(group, opt.id, isSelected ? 0 : 1);
                            }}
                            className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                              isSelected
                                ? 'bg-amber-500 border-amber-400 text-zinc-950 font-black'
                                : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                            }`}
                          >
                            {isSelected ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </button>
                        ) : (
                          <div
                            className="flex items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {optQty > 0 ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setOptionQty(group, opt.id, optQty - 1)}
                                  className="w-7 h-7 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center justify-center transition-colors"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <span className="w-6 text-center text-xs font-black text-amber-400">
                                  {optQty}
                                </span>
                                <button
                                  type="button"
                                  disabled={isMaxReached}
                                  onClick={() => setOptionQty(group, opt.id, optQty + 1)}
                                  className="w-7 h-7 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold flex items-center justify-center transition-colors"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={isMaxReached}
                                onClick={() => setOptionQty(group, opt.id, 1)}
                                className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700 hover:border-amber-500/50 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 flex items-center justify-center transition-colors"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Sticky Footer with Quantity & Add to Cart Button */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/90 space-y-3 shrink-0">
          {(() => {
            const qtyLabel = formatUnitAndCaseCount(
              saleUnit === 'unit' ? effectiveQuantity : 0,
              saleUnit === 'case' ? effectiveQuantity : 0,
              canSellCase ? caseSize : null
            );
            return (
              <>
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    (Produto R$ {baseUnitPrice.toFixed(2).replace('.', ',')} + Adicionais R${' '}
                    {addonsTotal.toFixed(2).replace('.', ',')}) × {qtyLabel}
                  </span>
                  <span className="text-base font-black text-emerald-400">
                    Total: R$ {finalLineTotal.toFixed(2).replace('.', ',')}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Item Quantity Stepper */}
                  <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1 shrink-0">
                    <button
                      type="button"
                      disabled={effectiveQuantity <= 1}
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      className="w-9 h-9 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-300 flex items-center justify-center transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="px-2 min-w-12 text-center font-black text-white text-xs">
                      {qtyLabel}
                    </span>
                    <button
                      type="button"
                      disabled={effectiveQuantity >= maxItemQty}
                      onClick={() => setQuantity((q) => Math.min(maxItemQty, q + 1))}
                      className="w-9 h-9 rounded-lg hover:bg-zinc-800 disabled:opacity-40 text-zinc-300 flex items-center justify-center transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Confirm Button */}
                  <button
                    type="button"
                    disabled={!canConfirm}
                    onClick={handleConfirm}
                    className="flex-1 py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed text-zinc-950 font-black text-sm transition-all flex items-center justify-between gap-2 shadow-lg shadow-amber-500/10"
                  >
                    <span>Adicionar ({qtyLabel})</span>
                    <span>R$ {finalLineTotal.toFixed(2).replace('.', ',')}</span>
                  </button>
                </div>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
};
