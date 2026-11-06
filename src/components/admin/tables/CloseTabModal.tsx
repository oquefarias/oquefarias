import React, { useState } from 'react';
import {
  TabDetail,
  PaymentMethod,
  Order,
  OrderItemComboComponent,
  StoreSettings,
  DEFAULT_SHORTCUTS,
  formatOrderItemComboLine,
} from '../../../types';
import {
  api,
  isNetworkOrTimeoutError,
  ORDER_NETWORK_EXHAUSTED_MESSAGE,
} from '../../../services/api';
import {
  X,
  CreditCard,
  DollarSign,
  QrCode,
  Users,
  Percent,
  CheckCircle2,
  AlertCircle,
  Receipt,
  Calculator,
  Loader2,
} from 'lucide-react';

interface CloseTabModalProps {
  tab: TabDetail | null;
  isOpen: boolean;
  settings?: StoreSettings;
  hasOpenCashSession?: boolean;
  onRequestOpenCashSession?: () => void;
  onClose: () => void;
  onSuccess: (order: Order) => void;
}

export const CloseTabModal: React.FC<CloseTabModalProps> = ({
  tab,
  isOpen,
  settings,
  hasOpenCashSession = true,
  onRequestOpenCashSession,
  onClose,
  onSuccess,
}) => {
  const [currentTab, setCurrentTab] = useState<TabDetail | null>(tab);
  const [includeServiceFee, setIncludeServiceFee] = useState<boolean>(false);
  const [serviceFeePercent, setServiceFeePercent] = useState<number>(10);
  const [discount, setDiscount] = useState<string>('0');
  const [splitPeople, setSplitPeople] = useState<number>(tab?.peopleCount || 1);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('dinheiro');
  const [cashChangeFor, setCashChangeFor] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittingStatusText, setSubmittingStatusText] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [canRetryClose, setCanRetryClose] = useState<boolean>(false);

  React.useEffect(() => {
    setCurrentTab(tab);
    setIsSubmitting(false);
    if (tab) {
      setSplitPeople(tab.peopleCount || 1);
      setDiscount('0');
      setCashChangeFor('');
      setIncludeServiceFee(false);
      setServiceFeePercent(10);
      setNotes('');
      setError('');
      setCanRetryClose(false);
      setSubmittingStatusText('');
      setIsSubmitting(false);
    }
  }, [tab]);

  const computeTotalForSubtotal = React.useCallback(
    (sub: number) => {
      const feePct = includeServiceFee ? Math.max(0, Math.min(20, serviceFeePercent)) : 0;
      const feeAmt = Math.round(sub * (feePct / 100) * 100) / 100;
      const maxDisc = Math.round((sub + feeAmt) * 100) / 100;
      const rawDisc = discount.trim() === '' ? 0 : parseFloat(discount);
      const discInvalid =
        Number.isNaN(rawDisc) ||
        Math.round(rawDisc * 100) < 0 ||
        Math.round(rawDisc * 100) > Math.round(maxDisc * 100);
      const validDisc = discInvalid ? 0 : Math.max(0, Math.round(rawDisc * 100) / 100);
      return Math.max(0, Math.round((sub + feeAmt - validDisc) * 100) / 100);
    },
    [includeServiceFee, serviceFeePercent, discount]
  );

  React.useEffect(() => {
    if (!isOpen || !currentTab?.id || isSubmitting) return;

    const checkTabUpdate = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        const fresh = await api.getTabDetail(currentTab.id);
        const oldSubCents = Math.round((currentTab.subtotal || 0) * 100);
        const newSubCents = Math.round((fresh.subtotal || 0) * 100);
        const oldActiveCount = currentTab.items.filter((i) => i.status === 'active').length;
        const newActiveCount = fresh.items.filter((i) => i.status === 'active').length;
        if (oldSubCents !== newSubCents || oldActiveCount !== newActiveCount) {
          setCurrentTab(fresh);
          const newTotal = computeTotalForSubtotal(fresh.subtotal || 0);
          setError(`A conta mudou: novo total R$ ${newTotal.toFixed(2)}`);
        }
      } catch {
        // Ignored during background check
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkTabUpdate();
      }
    };

    const interval = setInterval(checkTabUpdate, 15000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [isOpen, currentTab, isSubmitting, computeTotalForSubtotal]);

  const allTableNumbers = React.useMemo(() => {
    if (!currentTab) return '';
    const nums = [
      currentTab.tableNumber,
      ...(currentTab.linkedTables || []).map((lt) => lt.number),
    ].sort((a, b) => a - b);
    return nums.join(' + ');
  }, [currentTab]);

  const groupedActiveItems = React.useMemo(() => {
    if (!currentTab) return [];
    const active = currentTab.items.filter((i) => i.status === 'active');
    const map = new Map<
      string,
      {
        key: string;
        productName: string;
        saleUnit: 'unit' | 'case';
        unitsPerSale: number;
        unitPrice: number;
        quantity: number;
        comboItems?: OrderItemComboComponent[];
      }
    >();

    for (const it of active) {
      const saleUnit = it.saleUnit === 'case' ? 'case' : 'unit';
      const unitsPerSale = it.unitsPerSale && it.unitsPerSale > 1 ? it.unitsPerSale : 1;
      const key = `${it.productId}::${saleUnit}::${Number(it.unitPrice).toFixed(2)}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += it.quantity;
        if (!existing.comboItems && it.comboItems && it.comboItems.length > 0) {
          existing.comboItems = it.comboItems;
        }
      } else {
        map.set(key, {
          key,
          productName: it.productName,
          saleUnit,
          unitsPerSale,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          comboItems: it.comboItems && it.comboItems.length > 0 ? it.comboItems : undefined,
        });
      }
    }

    return Array.from(map.values());
  }, [currentTab]);

  const subtotal = currentTab?.subtotal || 0;
  const feePercentVal = includeServiceFee ? Math.max(0, Math.min(20, serviceFeePercent)) : 0;
  const serviceFeeAmount = Math.round(subtotal * (feePercentVal / 100) * 100) / 100;
  const maxDiscountAllowed = Math.round((subtotal + serviceFeeAmount) * 100) / 100;

  const rawDiscountNum = discount.trim() === '' ? 0 : parseFloat(discount);
  const isDiscountInvalid =
    Number.isNaN(rawDiscountNum) ||
    Math.round(rawDiscountNum * 100) < 0 ||
    Math.round(rawDiscountNum * 100) > Math.round(maxDiscountAllowed * 100);
  const numDiscount = isDiscountInvalid ? 0 : Math.max(0, Math.round(rawDiscountNum * 100) / 100);
  const total = Math.max(0, Math.round((subtotal + serviceFeeAmount - numDiscount) * 100) / 100);

  const hasCashTyped = cashChangeFor.trim() !== '';
  const numCashGiven = hasCashTyped ? parseFloat(cashChangeFor) : 0;
  const cashShortfallCents =
    paymentMethod === 'dinheiro' && hasCashTyped
      ? Math.round(total * 100) - Math.round((Number.isNaN(numCashGiven) ? 0 : numCashGiven) * 100)
      : 0;
  const isCashShort = paymentMethod === 'dinheiro' && hasCashTyped && (Number.isNaN(numCashGiven) || cashShortfallCents > 0);
  const cashShortfall = Math.max(0, cashShortfallCents / 100);
  const changeDue = Math.max(0, Math.round(((Number.isNaN(numCashGiven) ? 0 : numCashGiven) - total) * 100) / 100);

  const totalCents = Math.round(total * 100);
  const people = Math.max(1, splitPeople);
  const baseCents = Math.floor(totalCents / people);
  const extraPeople = totalCents - baseCents * people;
  const normalPeople = people - extraPeople;
  const splitDisplayText =
    people <= 1
      ? `R$ ${(totalCents / 100).toFixed(2).replace('.', ',')} por pessoa`
      : extraPeople === 0
      ? `R$ ${(baseCents / 100).toFixed(2).replace('.', ',')} por pessoa`
      : `${normalPeople} × R$ ${(baseCents / 100).toFixed(2).replace('.', ',')} + ${extraPeople} × R$ ${((baseCents + 1) / 100).toFixed(2).replace('.', ',')}`;

  const submitCloseTab = async () => {
    if (!currentTab || isSubmitting || isDiscountInvalid || isCashShort) return;
    setIsSubmitting(true);
    setError('');
    setCanRetryClose(false);
    setSubmittingStatusText('');

    try {
      const shouldSendCash =
        paymentMethod === 'dinheiro' &&
        hasCashTyped &&
        !Number.isNaN(numCashGiven) &&
        Math.round(numCashGiven * 100) >= Math.round(total * 100);

      const res = await api.closeTab(
        currentTab.id,
        {
          payment_method: paymentMethod,
          service_fee_percent: feePercentVal,
          discount: numDiscount,
          cash_change_for: shouldSendCash ? Math.round(numCashGiven * 100) / 100 : undefined,
          notes: notes.trim() || undefined,
          expected_subtotal: subtotal,
        },
        {
          onStatusMessage: (msg) => setSubmittingStatusText(msg),
        }
      );

      setSubmittingStatusText('');
      setCanRetryClose(false);
      onSuccess(res.order);
      setIsSubmitting(false);
    } catch (err: any) {
      setSubmittingStatusText('');

      if (err?.isNetworkRetryExhausted || isNetworkOrTimeoutError(err)) {
        setError(ORDER_NETWORK_EXHAUSTED_MESSAGE);
        setCanRetryClose(true);
        setIsSubmitting(false);
        return;
      }

      setCanRetryClose(false);
      let errMsg = err.message || 'Erro ao fechar comanda.';
      try {
        const fresh = await api.getTabDetail(currentTab.id);
        const oldSubCents = Math.round(subtotal * 100);
        const newSubCents = Math.round((fresh.subtotal || 0) * 100);
        setCurrentTab(fresh);
        if (oldSubCents !== newSubCents) {
          const newTotal = computeTotalForSubtotal(fresh.subtotal || 0);
          errMsg = `A conta mudou: novo total R$ ${newTotal.toFixed(2)}`;
        }
      } catch {
        // Ignored if tab reload fails
      }
      setError(errMsg);
      setIsSubmitting(false);
    }
  };

  const handleConfirmClose = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCloseTab();
  };

  const submitRef = React.useRef(submitCloseTab);
  submitRef.current = submitCloseTab;

  React.useEffect(() => {
    if (!isOpen || !currentTab) return;
    const shortcuts = { ...DEFAULT_SHORTCUTS, ...(settings?.shortcuts || {}) };
    const finishKey = (shortcuts.finalizar || 'F9').toUpperCase();
    const closeKey = (shortcuts.fecharModal || 'Escape').toUpperCase();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (window.innerWidth < 768) return;
      const pressed = e.key.toUpperCase();
      if (pressed === finishKey) {
        e.preventDefault();
        e.stopPropagation();
        submitRef.current();
      } else if (pressed === closeKey || (closeKey === 'ESC' && e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, currentTab, onClose, settings?.shortcuts]);

  if (!isOpen || !currentTab) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-lg max-h-[92vh] shadow-2xl border border-neutral-100 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-neutral-900 p-4 sm:p-6 text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 shrink-0 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Receipt className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black truncate">
                Fechar Conta • Mesa {allTableNumbers}
              </h2>
              <p className="text-xs text-neutral-400 truncate">
                {currentTab.customerName || 'Sem identificação'} • {currentTab.items.filter((i) => i.status === 'active').length} itens
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleConfirmClose} className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
          {!hasOpenCashSession && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 font-bold">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>Abra o expediente para registrar as vendas no caixa</span>
              </div>
              {onRequestOpenCashSession && (
                <button
                  type="button"
                  onClick={onRequestOpenCashSession}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black rounded-xl text-xs transition-colors shrink-0 cursor-pointer"
                >
                  Abrir expediente
                </button>
              )}
            </div>
          )}

          {isSubmitting && submittingStatusText && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-2 text-xs text-amber-900 font-bold">
              <Loader2 className="w-4 h-4 shrink-0 text-amber-600 animate-spin" />
              <span>{submittingStatusText}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-bold space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              {canRetryClose && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitCloseTab()}
                  className="w-full py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-black text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Tentar de novo</span>
                </button>
              )}
            </div>
          )}

          {/* Subtotal & Items Preview */}
          <div className="bg-neutral-50 rounded-2xl p-4 border border-neutral-200 space-y-2">
            {groupedActiveItems.length > 0 && (
              <div className="max-h-28 overflow-y-auto space-y-1 pb-2 border-b border-neutral-200 text-xs text-neutral-600">
                {groupedActiveItems.map((it) => {
                  const isCase = it.saleUnit === 'case' && it.unitsPerSale > 1;
                  const totalUnits = it.quantity * it.unitsPerSale;
                  return (
                    <div key={it.key}>
                      <div className="flex justify-between items-center">
                        <span className="truncate pr-2">
                          {isCase
                            ? `${it.quantity} cx ${it.productName} (${totalUnits} un)`
                            : `${it.quantity}x ${it.productName}`}
                        </span>
                        <span className="font-bold text-neutral-800 shrink-0">
                          R$ {(it.unitPrice * it.quantity).toFixed(2)}
                        </span>
                      </div>
                      {it.comboItems && it.comboItems.length > 0 && (
                        <div className="pl-2 mt-0.5 space-y-0.5 text-[10px] text-amber-800 font-semibold">
                          {it.comboItems.map((ci, ciIdx) => (
                            <div key={`${ci.productId}-${ciIdx}`}>{formatOrderItemComboLine(ci)}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-between items-center text-sm font-bold text-neutral-800">
              <span>Subtotal dos Produtos:</span>
              <span>R$ {subtotal.toFixed(2)}</span>
            </div>

            {/* Service Fee Toggle */}
            <div className="pt-2 border-t border-neutral-200 flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-bold text-neutral-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeServiceFee}
                  onChange={(e) => setIncludeServiceFee(e.target.checked)}
                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500 border-neutral-300"
                />
                <span>Taxa de serviço</span>
              </label>

              {includeServiceFee && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center bg-white border border-neutral-300 rounded-xl px-2 py-1">
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={serviceFeePercent}
                      onChange={(e) => setServiceFeePercent(Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0)))}
                      className="w-10 text-xs font-bold text-center focus:outline-hidden"
                    />
                    <Percent className="w-3 h-3 text-neutral-400" />
                  </div>
                  <span className="text-xs font-bold text-amber-700">+ R$ {serviceFeeAmount.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Discount */}
            <div className="pt-2 border-t border-neutral-200 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-700">Desconto manual:</span>
                <div className="flex items-center gap-1.5 w-32">
                  <span className="text-xs text-neutral-400 font-bold">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0,00"
                    className={`w-full bg-white border rounded-xl px-2.5 py-1 text-xs font-bold text-neutral-900 focus:outline-hidden focus:ring-2 ${
                      isDiscountInvalid ? 'border-red-400 focus:ring-red-500' : 'border-neutral-300 focus:ring-amber-500'
                    }`}
                  />
                </div>
              </div>
              {isDiscountInvalid && (
                <p className="text-[11px] font-bold text-red-600 text-right">
                  O desconto não pode ser maior que o valor da conta.
                </p>
              )}
            </div>

            {/* Total Highlight */}
            <div className="pt-3 border-t border-neutral-300 flex justify-between items-center">
              <span className="text-base font-black text-neutral-900">Total a Pagar:</span>
              <span className="text-2xl font-black text-amber-600">R$ {total.toFixed(2)}</span>
            </div>
          </div>

          {/* Split Bill Calculator */}
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 shrink-0 rounded-xl bg-amber-500/20 text-amber-800 flex items-center justify-center">
                <Calculator className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-amber-950 block">Dividir Conta</span>
                <span className="text-[11px] text-amber-800 font-medium block">
                  {splitDisplayText}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSplitPeople((p) => Math.max(1, p - 1))}
                className="w-8 h-8 rounded-lg bg-white border border-amber-200 text-amber-900 font-black flex items-center justify-center hover:bg-amber-100 transition-colors"
              >
                -
              </button>
              <span className="w-6 text-center text-xs font-black text-amber-950">{splitPeople}</span>
              <button
                type="button"
                onClick={() => setSplitPeople((p) => p + 1)}
                className="w-8 h-8 rounded-lg bg-white border border-amber-200 text-amber-900 font-black flex items-center justify-center hover:bg-amber-100 transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* Payment Method Selector */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-2">
              Forma de Pagamento
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { id: 'dinheiro', label: 'Dinheiro', icon: DollarSign },
                { id: 'pix', label: 'PIX', icon: QrCode },
                { id: 'cartao_debito', label: 'Débito', icon: CreditCard },
                { id: 'cartao_credito', label: 'Crédito', icon: CreditCard },
              ].map((m) => {
                const Icon = m.icon;
                const isSelected = paymentMethod === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id as PaymentMethod)}
                    className={`p-3 rounded-2xl border text-center flex flex-col items-center gap-1.5 transition-all ${
                      isSelected
                        ? 'border-amber-500 bg-amber-500/10 text-amber-900 font-black shadow-xs ring-2 ring-amber-500/20'
                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 font-semibold'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-amber-600' : 'text-neutral-500'}`} />
                    <span className="text-xs">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cash Change details if Dinheiro */}
          {paymentMethod === 'dinheiro' && (
            <div className="bg-neutral-50 p-3.5 rounded-2xl border border-neutral-200 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-neutral-700">
                  Valor recebido em dinheiro:
                </label>
                <div className="flex items-center gap-1.5 w-36">
                  <span className="text-xs font-bold text-neutral-400">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashChangeFor}
                    onChange={(e) => setCashChangeFor(e.target.value)}
                    placeholder={total.toFixed(2)}
                    className="w-full bg-white border border-neutral-300 rounded-xl px-2.5 py-1.5 text-xs font-bold text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>

              {/* Quick suggestion buttons */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {[total, Math.ceil(total / 10) * 10, Math.ceil(total / 20) * 20, Math.ceil(total / 50) * 50, 100].filter(
                  (v, i, arr) => v >= total && arr.indexOf(v) === i
                ).slice(0, 4).map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setCashChangeFor(String(amt))}
                    className="px-2 py-1 rounded-lg bg-neutral-200 hover:bg-neutral-300 text-neutral-800 text-[11px] font-bold transition-colors whitespace-nowrap"
                  >
                    R$ {amt.toFixed(2)}
                  </button>
                ))}
              </div>

              {isCashShort && (
                <div className="flex justify-between items-center pt-2 border-t border-red-200 text-xs text-red-600 font-black">
                  <span>Valor insuficiente:</span>
                  <span>Falta R$ {cashShortfall.toFixed(2).replace('.', ',')}</span>
                </div>
              )}

              {!isCashShort && hasCashTyped && Math.round(numCashGiven * 100) >= Math.round(total * 100) && (
                <div className="flex justify-between items-center pt-2 border-t border-neutral-200 text-xs">
                  <span className="font-bold text-neutral-700">Troco a devolver:</span>
                  <span className="text-sm font-black text-amber-700">
                    R$ {changeDue.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Closing Notes */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Observações no Pedido (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Pago com nota de 100, cortesia de 1 água..."
              className="w-full bg-neutral-100 border border-neutral-200 rounded-xl px-3 py-2 text-xs font-medium text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {isSubmitting && submittingStatusText && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center gap-2 text-xs text-amber-900 font-bold">
              <Loader2 className="w-4 h-4 shrink-0 text-amber-600 animate-spin" />
              <span>{submittingStatusText}</span>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-bold space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              {canRetryClose && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => submitCloseTab()}
                  className="w-full py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-black text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Tentar de novo</span>
                </button>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-2xl text-xs font-bold transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isDiscountInvalid || isCashShort}
              className="flex-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{isSubmitting ? (submittingStatusText || 'Finalizando...') : `Receber e Fechar (R$ ${total.toFixed(2)})`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
