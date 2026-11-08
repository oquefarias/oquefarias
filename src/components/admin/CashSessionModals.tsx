import React, { useState, useEffect } from 'react';
import { CashSession, CashSessionSummary, StoreSettings } from '../../types';
import { api } from '../../services/api';
import {
  X,
  DollarSign,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Receipt,
  Lock,
  Unlock,
} from 'lucide-react';

export function formatCashSessionBadgeDate(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const wd = weekdays[d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${time} (${wd} ${day}/${month})`;
}

export function formatCashSessionDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

export function formatCashSessionDuration(openedAt: string, closedAt?: string | null): string {
  const startMs = new Date(openedAt).getTime();
  const endMs = closedAt ? new Date(closedAt).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return '0 min';
  const totalMinutes = Math.max(1, Math.floor((endMs - startMs) / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

export function formatCurrencyBRL(val: number): string {
  return (Number(val) || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function formatCashDifferenceLabel(diff?: number | null): {
  text: string;
  tone: 'emerald' | 'amber' | 'red' | 'neutral';
} {
  if (diff === null || diff === undefined || Number.isNaN(Number(diff))) {
    return { text: 'Em aberto', tone: 'neutral' };
  }
  const rounded = Math.round(Number(diff) * 100) / 100;
  if (Math.abs(rounded) < 0.005) {
    return { text: 'Bateu', tone: 'emerald' };
  }
  if (rounded > 0) {
    return { text: `Sobrou ${formatCurrencyBRL(rounded)}`, tone: 'emerald' };
  }
  return { text: `Faltou ${formatCurrencyBRL(Math.abs(rounded))}`, tone: 'red' };
}

interface OpenCashSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (session: CashSession) => void;
}

export const OpenCashSessionModal: React.FC<OpenCashSessionModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [openingCashInput, setOpeningCashInput] = useState<string>('0');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    setIsSubmitting(false);
    if (isOpen) {
      setOpeningCashInput('0');
      setError('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const parsedValue = Number(String(openingCashInput).replace(',', '.'));
  const isInvalid =
    openingCashInput.trim() === '' || !Number.isFinite(parsedValue) || parsedValue < 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || isInvalid) return;

    const cleanVal = Math.round(parsedValue * 100) / 100;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await api.openCashSession(cleanVal);
      setIsSubmitting(false);
      onSuccess(res.session);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      if (err?.status === 409 && err?.session) {
        onSuccess(err.session);
        onClose();
        return;
      }
      setError(err?.message || 'Erro ao abrir o expediente.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-neutral-200 overflow-hidden flex flex-col">
        <div className="bg-neutral-900 text-white p-5 sm:p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
              <Unlock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black">Abrir expediente</h2>
              <p className="text-xs text-neutral-400">
                Inicia o turno do caixa e coloca a loja online como Aberta
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-6 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-black text-neutral-800 mb-1.5">
              Dinheiro inicial na gaveta (troco)
            </label>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-sm font-black text-neutral-400">R$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                autoFocus
                value={openingCashInput}
                onChange={(e) => setOpeningCashInput(e.target.value)}
                placeholder="0,00"
                className="w-full pl-10 pr-4 py-3 bg-neutral-50 border border-neutral-300 rounded-2xl text-lg font-black text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              {[0, 50, 100, 150, 200].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setOpeningCashInput(String(val))}
                  className={`px-2.5 py-1 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    !isInvalid && Math.round(parsedValue * 100) === val * 100
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border-neutral-200'
                  }`}
                >
                  R$ {val}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isInvalid}
              className="flex-1 py-3 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-2xl text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? 'Abrindo...' : 'Abrir'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

interface CloseCashSessionModalProps {
  isOpen: boolean;
  session: CashSession | null;
  openTablesCount: number;
  onClose: () => void;
  onSuccess: (closedSession: CashSession) => void;
}

export const CloseCashSessionModal: React.FC<CloseCashSessionModalProps> = ({
  isOpen,
  session,
  openTablesCount,
  onClose,
  onSuccess,
}) => {
  const [liveSession, setLiveSession] = useState<CashSession | null>(session);
  const [liveOpenTablesCount, setLiveOpenTablesCount] = useState<number>(openTablesCount);
  const [countedCashInput, setCountedCashInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [confirmingWithOpenTables, setConfirmingWithOpenTables] = useState<boolean>(false);

  useEffect(() => {
    setIsSubmitting(false);
    setConfirmingWithOpenTables(false);
    setError('');
    setLiveSession(session);
    setLiveOpenTablesCount(openTablesCount);
    if (isOpen && session) {
      setCountedCashInput('');
      setNotes('');
      api
        .getCurrentCashSession()
        .then((res) => {
          if (res.session) {
            setLiveSession(res.session);
          }
          setLiveOpenTablesCount(res.openTablesCount || 0);
        })
        .catch(() => {});
    }
  }, [isOpen, session?.id, openTablesCount]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        if (confirmingWithOpenTables) {
          setConfirmingWithOpenTables(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, confirmingWithOpenTables, onClose]);

  if (!isOpen || !liveSession) return null;

  const summary = liveSession.summary;
  const expectedCash = summary.expectedCash;
  const hasCountedTyped = countedCashInput.trim() !== '';
  const parsedCounted = hasCountedTyped ? Number(countedCashInput.replace(',', '.')) : NaN;
  const isCountedValid = hasCountedTyped && Number.isFinite(parsedCounted) && parsedCounted >= 0;
  const liveDiff = isCountedValid
    ? Math.round((parsedCounted - expectedCash) * 100) / 100
    : null;
  const diffBadge = formatCashDifferenceLabel(liveDiff);

  const executeCloseSession = async () => {
    if (isSubmitting || !isCountedValid) return;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await api.closeCashSession(liveSession.id, {
        countedCash: Math.round(parsedCounted * 100) / 100,
        notes: notes.trim() || undefined,
      });
      setIsSubmitting(false);
      setConfirmingWithOpenTables(false);
      onSuccess(res.session);
    } catch (err: any) {
      setIsSubmitting(false);
      setError(err?.message || 'Erro ao fechar o expediente.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !isCountedValid) return;
    if (liveOpenTablesCount > 0 && !confirmingWithOpenTables) {
      setConfirmingWithOpenTables(true);
      return;
    }
    await executeCloseSession();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl w-full max-w-xl max-h-[94vh] shadow-2xl border border-neutral-200 overflow-hidden flex flex-col">
        <div className="bg-neutral-900 text-white p-4 sm:p-6 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black truncate">Fechar expediente</h2>
              <p className="text-xs text-neutral-400 truncate">
                Aberto desde {formatCashSessionBadgeDate(liveSession.openedAt)} • Duração:{' '}
                {formatCashSessionDuration(liveSession.openedAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-bold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}

          {liveOpenTablesCount > 0 && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-xs text-amber-950 space-y-1">
              <div className="flex items-center gap-2 font-black">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  {liveOpenTablesCount}{' '}
                  {liveOpenTablesCount === 1 ? 'mesa aberta' : 'mesas abertas'} — o que for fechado
                  depois entra no próximo expediente
                </span>
              </div>
            </div>
          )}

          {/* Resumo do Expediente (Item 3) */}
          <div className="bg-neutral-50 rounded-2xl p-4 border border-neutral-200 space-y-3 text-xs">
            <div className="flex items-center justify-between border-b border-neutral-200 pb-2">
              <span className="font-black text-neutral-900 uppercase tracking-wider text-[11px]">
                Resumo do Expediente
              </span>
              <span className="font-black text-sm text-amber-600">
                Total: {formatCurrencyBRL(summary.totalRevenue)} ({summary.ordersCount}{' '}
                {summary.ordersCount === 1 ? 'venda' : 'vendas'})
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Canais */}
              <div className="bg-white p-3 rounded-xl border border-neutral-200 space-y-1.5">
                <span className="text-[10px] font-black uppercase text-neutral-400 block">
                  Por Canal de Venda
                </span>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Vendas Online ({summary.onlineCount}):</span>
                  <span className="font-bold text-neutral-900">
                    {formatCurrencyBRL(summary.onlineRevenue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Vendas Balcão ({summary.posCount}):</span>
                  <span className="font-bold text-neutral-900">
                    {formatCurrencyBRL(summary.posRevenue)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">Vendas Mesas ({summary.mesaCount}):</span>
                  <span className="font-bold text-neutral-900">
                    {formatCurrencyBRL(summary.mesaRevenue)}
                  </span>
                </div>
              </div>

              {/* Formas de pagamento */}
              <div className="bg-white p-3 rounded-xl border border-neutral-200 space-y-1.5">
                <span className="text-[10px] font-black uppercase text-neutral-400 block">
                  Por Forma de Pagamento
                </span>
                <div className="flex justify-between">
                  <span className="text-neutral-600">💵 Dinheiro:</span>
                  <span className="font-bold text-emerald-700">
                    {formatCurrencyBRL(summary.paymentBreakdown.dinheiro)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">⚡ PIX:</span>
                  <span className="font-bold text-neutral-900">
                    {formatCurrencyBRL(summary.paymentBreakdown.pix)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">💳 Débito:</span>
                  <span className="font-bold text-neutral-900">
                    {formatCurrencyBRL(summary.paymentBreakdown.cartao_debito)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-600">💳 Crédito:</span>
                  <span className="font-bold text-neutral-900">
                    {formatCurrencyBRL(summary.paymentBreakdown.cartao_credito)}
                  </span>
                </div>
              </div>
            </div>

            {/* Indicadores extras */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
              <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
                <span className="text-[10px] text-neutral-400 font-bold block">Taxa garçons</span>
                <span className="font-black text-neutral-900">
                  {formatCurrencyBRL(summary.serviceFeeTotal)}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
                <span className="text-[10px] text-neutral-400 font-bold block">Descontos</span>
                <span className="font-black text-neutral-900">
                  {formatCurrencyBRL(summary.discountTotal)}
                </span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
                <span className="text-[10px] text-neutral-400 font-bold block">Cancelados</span>
                <span className="font-black text-red-600">{summary.cancelledCount} ped.</span>
              </div>
              <div className="bg-white p-2.5 rounded-xl border border-neutral-200">
                <span className="text-[10px] text-neutral-400 font-bold block">Ticket médio</span>
                <span className="font-black text-neutral-900">
                  {formatCurrencyBRL(summary.avgTicket)}
                </span>
              </div>
            </div>

            {/* Lucro / Prejuízo dos Produtos */}
            {(() => {
              const netProfit = Number(summary.netProfit || 0);
              const productsRev = Number(summary.productsRevenue ?? summary.totalRevenue ?? 0);
              const totalCost = Number(summary.totalCost ?? 0);
              const marginPct =
                typeof summary.profitMarginPercent === 'number'
                  ? summary.profitMarginPercent
                  : productsRev > 0
                  ? Math.round((netProfit / productsRev) * 1000) / 10
                  : 0;
              const missingCost = Math.max(0, Math.floor(Number(summary.missingCostItemsCount) || 0));
              const isLoss = netProfit < 0;

              return (
                <div
                  className={`rounded-xl p-3 border space-y-1.5 ${
                    isLoss
                      ? 'bg-red-50/80 border-red-200 text-red-950'
                      : 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-black uppercase tracking-wider text-[10px] opacity-80">
                      Resultado dos Produtos (sem taxas)
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-black ${
                        isLoss
                          ? 'bg-red-100 text-red-700 border border-red-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      Margem: {marginPct.toFixed(1).replace('.', ',')}%
                    </span>
                  </div>
                  <div className="flex justify-between text-neutral-700 text-[11px]">
                    <span>Produtos vendidos (− descontos):</span>
                    <span className="font-bold">{formatCurrencyBRL(productsRev)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-700 text-[11px]">
                    <span>− Custo dos itens vendidos:</span>
                    <span className="font-bold">{formatCurrencyBRL(totalCost)}</span>
                  </div>
                  <div
                    className={`flex justify-between items-center pt-1.5 border-t text-sm font-black ${
                      isLoss
                        ? 'border-red-200 text-red-700'
                        : 'border-emerald-200 text-emerald-700'
                    }`}
                  >
                    <span>{isLoss ? 'Prejuízo estimado:' : 'Lucro estimado:'}</span>
                    <span>
                      {isLoss
                        ? `Prejuízo ${formatCurrencyBRL(Math.abs(netProfit))}`
                        : `Lucro ${formatCurrencyBRL(netProfit)}`}
                    </span>
                  </div>
                  {missingCost > 0 && (
                    <p className="text-[10px] text-amber-800 bg-amber-50/90 border border-amber-200 rounded-lg px-2.5 py-1.5 font-semibold leading-snug">
                      {missingCost} {missingCost === 1 ? 'item vendido' : 'itens vendidos'} sem
                      preço de custo — o lucro pode estar maior que o real. Cadastre o custo em
                      Estoque.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Conferência da Gaveta */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3 space-y-1">
              <div className="flex justify-between text-neutral-700">
                <span>Dinheiro inicial na gaveta (troco):</span>
                <span className="font-bold">{formatCurrencyBRL(summary.openingCash)}</span>
              </div>
              <div className="flex justify-between text-neutral-700">
                <span>+ Vendas em dinheiro no expediente:</span>
                <span className="font-bold">
                  {formatCurrencyBRL(summary.paymentBreakdown.dinheiro)}
                </span>
              </div>
              <div className="flex justify-between items-center pt-1.5 border-t border-emerald-200 text-sm font-black text-emerald-950">
                <span>Dinheiro esperado na gaveta:</span>
                <span>{formatCurrencyBRL(expectedCash)}</span>
              </div>
            </div>
          </div>

          {/* Dinheiro contado na gaveta */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black text-neutral-800">
                Dinheiro contado na gaveta *
              </label>
              <button
                type="button"
                onClick={() => setCountedCashInput(expectedCash.toFixed(2))}
                className="text-[11px] font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
              >
                Preencher valor esperado ({formatCurrencyBRL(expectedCash)})
              </button>
            </div>
            <div className="relative flex items-center">
              <span className="absolute left-3.5 text-sm font-black text-neutral-400">R$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                autoFocus
                value={countedCashInput}
                onChange={(e) => {
                  setCountedCashInput(e.target.value);
                  if (confirmingWithOpenTables) setConfirmingWithOpenTables(false);
                }}
                placeholder={expectedCash.toFixed(2)}
                className="w-full pl-10 pr-4 py-3 bg-neutral-50 border border-neutral-300 rounded-2xl text-lg font-black text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {isCountedValid && (
              <div
                className={`p-3 rounded-2xl border flex items-center justify-between text-xs font-black ${
                  diffBadge.tone === 'emerald'
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                    : diffBadge.tone === 'red'
                    ? 'bg-red-50 border-red-300 text-red-800'
                    : 'bg-neutral-100 border-neutral-200 text-neutral-800'
                }`}
              >
                <span>Diferença na gaveta (contado − esperado):</span>
                <span className="text-sm">{diffBadge.text}</span>
              </div>
            )}
          </div>

          {/* Observação */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Observação do fechamento (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Retirada de sangria, troco conferido por..."
              className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3.5 py-2.5 text-xs font-medium text-neutral-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Confirmação na tela caso haja mesas abertas */}
          {confirmingWithOpenTables && liveOpenTablesCount > 0 && (
            <div className="p-4 bg-amber-100/90 border-2 border-amber-400 rounded-2xl space-y-3 animate-in fade-in">
              <div className="flex items-start gap-2.5 text-xs text-amber-950">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-black text-sm">Confirmar fechamento com mesas abertas?</p>
                  <p className="mt-0.5 font-semibold">
                    Ainda há {liveOpenTablesCount}{' '}
                    {liveOpenTablesCount === 1 ? 'mesa aberta' : 'mesas abertas'} — o que for
                    fechado depois entra no próximo expediente.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setConfirmingWithOpenTables(false)}
                  className="px-3.5 py-2 bg-white hover:bg-neutral-100 text-neutral-800 rounded-xl text-xs font-bold border border-amber-300 cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={executeCloseSession}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-black shadow-xs cursor-pointer"
                >
                  {isSubmitting ? 'Fechando...' : 'Sim, fechar expediente mesmo assim'}
                </button>
              </div>
            </div>
          )}

          {/* Actions */}
          {!confirmingWithOpenTables && (
            <div className="pt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 py-3 px-4 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-2xl text-xs font-bold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !isCountedValid}
                className="flex-2 py-3 px-4 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white rounded-2xl text-xs font-black shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-4 h-4 text-amber-400" />
                <span>{isSubmitting ? 'Fechando expediente...' : 'Fechar expediente'}</span>
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

interface CashClosingReceiptModalProps {
  session: CashSession | null;
  settings: StoreSettings;
  onClose: () => void;
}

export const CashClosingReceiptModal: React.FC<CashClosingReceiptModalProps> = ({
  session,
  settings,
  onClose,
}) => {
  useEffect(() => {
    if (!session) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, onClose]);

  if (!session) return null;

  const s = session.summary;
  const diffInfo = formatCashDifferenceLabel(s.cashDifference);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-150">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200 flex flex-col max-h-[92vh]">
        {/* Header hidden on print */}
        <div className="print:hidden bg-neutral-900 text-white px-5 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-amber-400" />
            <h3 className="font-black text-sm uppercase tracking-wider">
              Comprovante de Fechamento de Caixa
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 80mm Printable Receipt Body */}
        <div
          id="receipt-to-print"
          className="p-6 overflow-y-auto flex-1 text-neutral-900 bg-white font-mono text-xs leading-relaxed space-y-3"
        >
          <div className="text-center border-b-2 border-dashed border-neutral-400 pb-3">
            <h2 className="text-base font-black uppercase text-neutral-900">
              {settings.storeName}
            </h2>
            {settings.cnpjOrCpf && (
              <p className="text-[11px] text-neutral-600">CNPJ/CPF: {settings.cnpjOrCpf}</p>
            )}
            <p className="text-[11px] text-neutral-600">{settings.address}</p>
            <div className="mt-2 inline-block px-3 py-1 bg-neutral-100 rounded text-[11px] font-black uppercase tracking-wider">
              {session.closedAt ? 'FECHAMENTO DE EXPEDIENTE' : 'PARCIAL DE EXPEDIENTE'}
            </div>
          </div>

          <div className="space-y-1 border-b border-dashed border-neutral-300 pb-3 text-[11px]">
            <div className="flex justify-between">
              <span className="text-neutral-500">Abertura:</span>
              <span className="font-bold">{formatCashSessionDateTime(session.openedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Fechamento:</span>
              <span className="font-bold">
                {session.closedAt ? formatCashSessionDateTime(session.closedAt) : 'Em aberto'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Duração:</span>
              <span className="font-bold">
                {formatCashSessionDuration(session.openedAt, session.closedAt)}
              </span>
            </div>
          </div>

          {/* Vendas por Canal */}
          <div className="space-y-1 border-b border-dashed border-neutral-300 pb-3 text-[11px]">
            <p className="font-black uppercase text-neutral-700 mb-1">Vendas por Canal</p>
            <div className="flex justify-between">
              <span>Online ({s.onlineCount}):</span>
              <span className="font-bold">{formatCurrencyBRL(s.onlineRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Balcão ({s.posCount}):</span>
              <span className="font-bold">{formatCurrencyBRL(s.posRevenue)}</span>
            </div>
            <div className="flex justify-between">
              <span>Mesas ({s.mesaCount}):</span>
              <span className="font-bold">{formatCurrencyBRL(s.mesaRevenue)}</span>
            </div>
            <div className="flex justify-between pt-1 border-t border-neutral-200 font-black text-xs">
              <span>TOTAL VENDAS ({s.ordersCount}):</span>
              <span>{formatCurrencyBRL(s.totalRevenue)}</span>
            </div>
          </div>

          {/* Por Forma de Pagamento */}
          <div className="space-y-1 border-b border-dashed border-neutral-300 pb-3 text-[11px]">
            <p className="font-black uppercase text-neutral-700 mb-1">Por Forma de Pagamento</p>
            <div className="flex justify-between">
              <span>Dinheiro:</span>
              <span className="font-bold">{formatCurrencyBRL(s.paymentBreakdown.dinheiro)}</span>
            </div>
            <div className="flex justify-between">
              <span>PIX:</span>
              <span className="font-bold">{formatCurrencyBRL(s.paymentBreakdown.pix)}</span>
            </div>
            <div className="flex justify-between">
              <span>Cartão de Débito:</span>
              <span className="font-bold">
                {formatCurrencyBRL(s.paymentBreakdown.cartao_debito)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cartão de Crédito:</span>
              <span className="font-bold">
                {formatCurrencyBRL(s.paymentBreakdown.cartao_credito)}
              </span>
            </div>
          </div>

          {/* Indicadores */}
          <div className="space-y-1 border-b border-dashed border-neutral-300 pb-3 text-[11px]">
            <div className="flex justify-between">
              <span>Taxa de serviço (garçons):</span>
              <span className="font-bold">{formatCurrencyBRL(s.serviceFeeTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Descontos concedidos:</span>
              <span className="font-bold">{formatCurrencyBRL(s.discountTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Pedidos cancelados:</span>
              <span className="font-bold">{s.cancelledCount}</span>
            </div>
            <div className="flex justify-between">
              <span>Ticket médio:</span>
              <span className="font-bold">{formatCurrencyBRL(s.avgTicket)}</span>
            </div>
          </div>

          {/* Resultado (Lucro / Prejuízo) */}
          {(() => {
            const netProfit = Number(s.netProfit || 0);
            const productsRev = Number(s.productsRevenue ?? s.totalRevenue ?? 0);
            const totalCost = Number(s.totalCost ?? 0);
            const marginPct =
              typeof s.profitMarginPercent === 'number'
                ? s.profitMarginPercent
                : productsRev > 0
                ? Math.round((netProfit / productsRev) * 1000) / 10
                : 0;
            const missingCost = Math.max(0, Math.floor(Number(s.missingCostItemsCount) || 0));
            const isLoss = netProfit < 0;

            return (
              <div className="space-y-1 border-b border-dashed border-neutral-300 pb-3 text-[11px]">
                <p className="font-black uppercase text-neutral-700 mb-1">
                  Resultado dos Produtos
                </p>
                <div className="flex justify-between">
                  <span>Venda de produtos (− desc.):</span>
                  <span className="font-bold">{formatCurrencyBRL(productsRev)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Custo dos itens vendidos:</span>
                  <span className="font-bold">{formatCurrencyBRL(totalCost)}</span>
                </div>
                <div
                  className={`flex justify-between font-black pt-1 border-t border-neutral-200 ${
                    isLoss ? 'text-red-700' : 'text-emerald-700'
                  }`}
                >
                  <span>{isLoss ? 'PREJUÍZO ESTIMADO:' : 'LUCRO ESTIMADO:'}</span>
                  <span>
                    {isLoss
                      ? `Prejuízo ${formatCurrencyBRL(Math.abs(netProfit))}`
                      : `Lucro ${formatCurrencyBRL(netProfit)}`}{' '}
                    ({marginPct.toFixed(1).replace('.', ',')}%)
                  </span>
                </div>
                {missingCost > 0 && (
                  <p className="text-[10px] text-amber-800 pt-1 leading-snug">
                    * {missingCost} {missingCost === 1 ? 'item vendido' : 'itens vendidos'} sem
                    preço de custo — o lucro pode estar maior que o real. Cadastre o custo em
                    Estoque.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Conferência da Gaveta */}
          <div className="space-y-1 border-b border-dashed border-neutral-300 pb-3 text-[11px]">
            <p className="font-black uppercase text-neutral-700 mb-1">Conferência da Gaveta</p>
            <div className="flex justify-between">
              <span>Dinheiro inicial (troco):</span>
              <span className="font-bold">{formatCurrencyBRL(s.openingCash)}</span>
            </div>
            <div className="flex justify-between">
              <span>+ Vendas em dinheiro:</span>
              <span className="font-bold">{formatCurrencyBRL(s.paymentBreakdown.dinheiro)}</span>
            </div>
            <div className="flex justify-between font-black">
              <span>= Esperado na gaveta:</span>
              <span>{formatCurrencyBRL(s.expectedCash)}</span>
            </div>
            {s.countedCash !== null && s.countedCash !== undefined && (
              <>
                <div className="flex justify-between font-black">
                  <span>Contado na gaveta:</span>
                  <span>{formatCurrencyBRL(s.countedCash)}</span>
                </div>
                <div className="flex justify-between font-black pt-1 border-t border-neutral-200">
                  <span>Diferença:</span>
                  <span>{diffInfo.text}</span>
                </div>
              </>
            )}
          </div>

          {session.notes && (
            <div className="text-[11px] bg-neutral-50 border border-neutral-200 p-2 rounded">
              <span className="font-bold">Obs: </span>
              <span>{session.notes}</span>
            </div>
          )}

          <div className="pt-2 text-center text-[10px] text-neutral-500">
            Impresso em {formatCashSessionDateTime(new Date().toISOString())}
          </div>
        </div>

        {/* Footer hidden on print */}
        <div className="print:hidden p-4 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer"
          >
            Fechar
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black rounded-xl shadow-xs transition-colors text-xs cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir fechamento</span>
          </button>
        </div>
      </div>
    </div>
  );
};
