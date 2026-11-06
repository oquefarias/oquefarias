import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  Banknote,
  QrCode,
  CreditCard,
  Filter,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Check,
} from 'lucide-react';
import { CashSession, PaymentHistoryItem, PaymentsHistorySummary } from '../../types';
import { api } from '../../services/api';
import { formatCurrencyBRL, formatCashSessionDateTime } from './CashSessionModals';

interface PaymentsHistorySectionProps {
  currentSession: CashSession | null;
  cashSessions: CashSession[];
}

type PeriodOption = 'session' | 'today' | '7d' | 'custom';

const CHANNEL_OPTIONS: { id: 'online' | 'balcao' | 'mesa'; label: string }[] = [
  { id: 'online', label: 'Delivery' },
  { id: 'balcao', label: 'PDV Balcão' },
  { id: 'mesa', label: 'Mesas' },
];

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_debito: 'Cartão Débito',
  cartao_credito: 'Cartão Crédito',
  cartao: 'Cartão',
};

export const PaymentsHistorySection: React.FC<PaymentsHistorySectionProps> = ({
  currentSession,
  cashSessions,
}) => {
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['online', 'balcao', 'mesa']);
  const [paymentMethod, setPaymentMethod] = useState<string>('all');
  const [showCancelled, setShowCancelled] = useState<boolean>(true);
  const [period, setPeriod] = useState<PeriodOption>('session');
  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [offset, setOffset] = useState<number>(0);
  const limit = 100;

  const [items, setItems] = useState<PaymentHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [summary, setSummary] = useState<PaymentsHistorySummary>({
    entriesTotal: 0,
    entriesCount: 0,
    cancelledTotal: 0,
    cancelledCount: 0,
    balance: 0,
    byPaymentMethod: {
      dinheiro: 0,
      pix: 0,
      cartao_debito: 0,
      cartao_credito: 0,
    },
  });
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadPayments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      let fromParam: string | undefined;
      let toParam: string | undefined;
      let sessionIdParam: string | undefined;

      if (period === 'session' && selectedSessionId) {
        sessionIdParam = selectedSessionId;
      } else if (period === 'custom') {
        if (customFrom) {
          fromParam = new Date(`${customFrom}T00:00:00`).toISOString();
        }
        if (customTo) {
          toParam = new Date(`${customTo}T23:59:59.999`).toISOString();
        }
      }

      const activeChannels =
        selectedChannels.length > 0 && selectedChannels.length < 3
          ? selectedChannels
          : undefined;

      const res = await api.getPaymentsHistory({
        channels: activeChannels,
        paymentMethod: paymentMethod !== 'all' ? paymentMethod : undefined,
        showCancelled,
        period,
        sessionId: sessionIdParam,
        from: fromParam,
        to: toParam,
        search: debouncedSearch || undefined,
        limit,
        offset,
      });

      setItems(res.items || []);
      setTotalCount(res.totalCount || 0);
      setSummary(res.summary);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar histórico de pagamentos.');
    } finally {
      setIsLoading(false);
    }
  }, [
    selectedChannels,
    paymentMethod,
    showCancelled,
    period,
    selectedSessionId,
    customFrom,
    customTo,
    debouncedSearch,
    offset,
  ]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  const toggleChannel = (channelId: string) => {
    setOffset(0);
    setSelectedChannels((prev) => {
      if (prev.includes(channelId)) {
        if (prev.length === 1) return prev;
        return prev.filter((c) => c !== channelId);
      }
      return [...prev, channelId];
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Totals (5d) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 rounded-3xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Entradas (Vendas)
            </span>
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-black text-emerald-600">
            {formatCurrencyBRL(summary.entriesTotal)}
          </p>
          <p className="text-[11px] text-neutral-500 mt-1">
            {summary.entriesCount}{' '}
            {summary.entriesCount === 1 ? 'venda registrada' : 'vendas registradas'}
          </p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-3xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Cancelados / Estornados
            </span>
            <ArrowDownRight className="w-4 h-4 text-red-500" />
          </div>
          <p className="text-2xl font-black text-red-600">
            {formatCurrencyBRL(summary.cancelledTotal)}
          </p>
          <p className="text-[11px] text-neutral-500 mt-1">
            {summary.cancelledCount}{' '}
            {summary.cancelledCount === 1 ? 'cancelamento' : 'cancelamentos'}
          </p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-3xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
              Saldo Líquido
            </span>
            <Wallet className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-black text-neutral-900">
            {formatCurrencyBRL(summary.balance)}
          </p>
          <p className="text-[11px] text-neutral-500 mt-1">
            Total válido no filtro selecionado
          </p>
        </div>

        <div className="bg-white border border-neutral-200 rounded-3xl p-5 shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 block mb-2">
            Total por Forma de Pagamento
          </span>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-neutral-600 flex items-center gap-1.5 font-medium">
                <Banknote className="w-3.5 h-3.5 text-emerald-600" /> Dinheiro
              </span>
              <span className="font-bold text-neutral-900">
                {formatCurrencyBRL(summary.byPaymentMethod.dinheiro)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-600 flex items-center gap-1.5 font-medium">
                <QrCode className="w-3.5 h-3.5 text-amber-600" /> PIX
              </span>
              <span className="font-bold text-neutral-900">
                {formatCurrencyBRL(summary.byPaymentMethod.pix)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-600 flex items-center gap-1.5 font-medium">
                <CreditCard className="w-3.5 h-3.5 text-purple-600" /> Débito
              </span>
              <span className="font-bold text-neutral-900">
                {formatCurrencyBRL(summary.byPaymentMethod.cartao_debito)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-neutral-600 flex items-center gap-1.5 font-medium">
                <CreditCard className="w-3.5 h-3.5 text-blue-600" /> Crédito
              </span>
              <span className="font-bold text-neutral-900">
                {formatCurrencyBRL(summary.byPaymentMethod.cartao_credito)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters (5c) */}
      <div className="bg-white border border-neutral-200 rounded-3xl p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-black text-neutral-900">
            <Filter className="w-4 h-4 text-amber-500" />
            Filtros de Pagamentos
          </div>
          <button
            type="button"
            onClick={loadPayments}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-xs font-bold text-neutral-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Period */}
          <div>
            <label className="block text-xs font-bold text-neutral-600 mb-1.5">Período</label>
            <select
              value={
                period === 'session' && selectedSessionId
                  ? `session:${selectedSessionId}`
                  : period
              }
              onChange={(e) => {
                const val = e.target.value;
                setOffset(0);
                if (val.startsWith('session:')) {
                  setPeriod('session');
                  setSelectedSessionId(val.replace('session:', ''));
                } else {
                  setPeriod(val as PeriodOption);
                  setSelectedSessionId('');
                }
              }}
              className="w-full bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 text-xs font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="session">
                {currentSession ? 'Expediente atual (aberto)' : 'Último expediente'}
              </option>
              <option value="today">Hoje</option>
              <option value="7d">7 dias</option>
              <option value="custom">Personalizado</option>
              {cashSessions.length > 0 && (
                <optgroup label="Escolher expediente">
                  {cashSessions.map((s) => (
                    <option key={s.id} value={`session:${s.id}`}>
                      {formatCashSessionDateTime(s.openedAt)}
                      {s.closedAt ? ` → ${formatCashSessionDateTime(s.closedAt)}` : ' (Aberto)'}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* Payment method */}
          <div>
            <label className="block text-xs font-bold text-neutral-600 mb-1.5">
              Forma de Pagamento
            </label>
            <select
              value={paymentMethod}
              onChange={(e) => {
                setOffset(0);
                setPaymentMethod(e.target.value);
              }}
              className="w-full bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 text-xs font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">Todas as formas</option>
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">PIX</option>
              <option value="cartao_debito">Cartão de Débito</option>
              <option value="cartao_credito">Cartão de Crédito</option>
            </select>
          </div>

          {/* Search */}
          <div className="md:col-span-2">
            <label className="block text-xs font-bold text-neutral-600 mb-1.5">
              Buscar por nº do pedido ou cliente
            </label>
            <div className="relative">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Ex.: PED-1A2B, nome do cliente..."
                className="w-full bg-neutral-50 border border-neutral-300 rounded-xl pl-9 pr-3 py-2 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        </div>

        {period === 'custom' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-neutral-100">
            <div>
              <label className="block text-xs font-bold text-neutral-600 mb-1">Data inicial</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => {
                  setOffset(0);
                  setCustomFrom(e.target.value);
                }}
                className="w-full bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 text-xs font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-neutral-600 mb-1">Data final</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => {
                  setOffset(0);
                  setCustomTo(e.target.value);
                }}
                className="w-full bg-neutral-50 border border-neutral-300 rounded-xl px-3 py-2 text-xs font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-neutral-100">
          {/* Multi-select channels */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-neutral-600 mr-1">Canais:</span>
            {CHANNEL_OPTIONS.map((ch) => {
              const active = selectedChannels.includes(ch.id);
              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => toggleChannel(ch.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                    active
                      ? 'bg-amber-500 text-neutral-950 border-amber-500 shadow-2xs'
                      : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  <Check className={`w-3.5 h-3.5 ${active ? 'opacity-100' : 'opacity-0'}`} />
                  {ch.label}
                </button>
              );
            })}
          </div>

          {/* Show cancelled toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showCancelled}
              onChange={(e) => {
                setOffset(0);
                setShowCancelled(e.target.checked);
              }}
              className="rounded border-neutral-300 text-amber-500 focus:ring-amber-500"
            />
            <span className="text-xs font-bold text-neutral-700">
              Mostrar cancelados / estornados
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Payments Table (5a & 5b) */}
      <div className="bg-white border border-neutral-200 rounded-3xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-neutral-500 font-bold uppercase tracking-wider">
                <th className="py-3 px-4">Data / Hora</th>
                <th className="py-3 px-4">Pedido</th>
                <th className="py-3 px-4">Canal</th>
                <th className="py-3 px-4">Cliente</th>
                <th className="py-3 px-4">Pagamento</th>
                <th className="py-3 px-4">Detalhes</th>
                <th className="py-3 px-4 text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {isLoading && items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-neutral-400 font-bold">
                    Carregando histórico de pagamentos...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-neutral-400 font-bold">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const isCancelled = item.type === 'saida' || item.status === 'cancelado';
                  const cashRec = Number(item.cashReceived || 0);
                  const changeGiv = Number(item.changeGiven || 0);
                  const srvFee = Number(item.serviceFee || 0);
                  const discAmt = Number(item.discount || 0);

                  return (
                    <tr
                      key={item.id}
                      className={
                        isCancelled
                          ? 'bg-red-50/70 hover:bg-red-100/60 text-red-900 transition-colors'
                          : 'hover:bg-neutral-50/80 text-neutral-800 transition-colors'
                      }
                    >
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="font-bold">
                          {formatCashSessionDateTime(item.createdAt)}
                        </div>
                        {isCancelled && item.updatedAt && (
                          <div className="text-[10px] font-bold text-red-600 mt-0.5">
                            Cancelado em {formatCashSessionDateTime(item.updatedAt)}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono font-bold px-2 py-1 rounded-lg bg-neutral-100 text-neutral-900 border border-neutral-200">
                          {item.orderId}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-lg font-bold ${
                            item.source === 'mesa'
                              ? 'bg-purple-50 text-purple-800 border border-purple-200'
                              : item.source === 'balcao'
                              ? 'bg-sky-50 text-sky-800 border border-sky-200'
                              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          }`}
                        >
                          {item.channelLabel}
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-neutral-900">{item.customerName}</div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-bold">
                          {PAYMENT_LABELS[item.paymentMethod] || item.paymentMethod}
                        </span>
                        {isCancelled && (
                          <span className="block text-[10px] font-black text-red-600 uppercase mt-0.5">
                            Cancelado / estornado
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4">
                        {isCancelled ? (
                          <div className="text-red-700 font-semibold">
                            <span className="font-black">Motivo: </span>
                            {item.cancelReason || 'Cancelado'}
                          </div>
                        ) : (
                          <div className="space-y-0.5 text-neutral-600">
                            {item.paymentMethod === 'dinheiro' && cashRec > 0 && (
                              <div>
                                Recebido:{' '}
                                <span className="text-neutral-900 font-bold">
                                  {formatCurrencyBRL(cashRec)}
                                </span>
                                {changeGiv > 0 && (
                                  <>
                                    {' '}
                                    • Troco:{' '}
                                    <span className="text-amber-700 font-bold">
                                      {formatCurrencyBRL(changeGiv)}
                                    </span>
                                  </>
                                )}
                              </div>
                            )}
                            {item.source === 'mesa' && srvFee > 0 && (
                              <div className="text-purple-700 font-semibold">
                                Taxa de serviço: {formatCurrencyBRL(srvFee)}
                              </div>
                            )}
                            {discAmt > 0 && (
                              <div className="text-amber-700 font-semibold">
                                Desconto: -{formatCurrencyBRL(discAmt)}
                              </div>
                            )}
                            {(item.paymentMethod !== 'dinheiro' || cashRec <= 0) &&
                              (item.source !== 'mesa' || srvFee <= 0) &&
                              discAmt <= 0 && <span className="text-neutral-400">—</span>}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap text-right font-mono font-black text-sm">
                        {isCancelled ? (
                          <span className="text-red-600 line-through">
                            -{formatCurrencyBRL(item.amount)}
                          </span>
                        ) : (
                          <span className="text-emerald-700">
                            +{formatCurrencyBRL(item.amount)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-200 bg-neutral-50 text-xs text-neutral-600 font-medium">
            <span>
              Mostrando {offset + 1} a {Math.min(offset + limit, totalCount)} de {totalCount}{' '}
              registros
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={offset === 0 || isLoading}
                onClick={() => setOffset(Math.max(0, offset - limit))}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-800 font-bold disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Anterior
              </button>
              <button
                type="button"
                disabled={offset + limit >= totalCount || isLoading}
                onClick={() => setOffset(offset + limit)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-800 font-bold disabled:opacity-40 cursor-pointer"
              >
                Próxima <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
