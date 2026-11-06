import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Product,
  StockMovement,
  StockMovementsSummary,
  formatStockMovementReason,
} from '../../types';
import { api } from '../../services/api';
import {
  Search,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Scale,
  RefreshCw,
  ExternalLink,
  UtensilsCrossed,
  Clock,
  Filter,
  ChevronDown,
} from 'lucide-react';

interface StockHistorySectionProps {
  products: Product[];
  selectedProductId: string;
  onSelectProductId: (productId: string) => void;
  onOpenOrderRef: (orderId: string) => void;
}

type PeriodPreset = 'hoje' | '7d' | '30d' | 'personalizado';

const REASON_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos os motivos' },
  { value: 'venda', label: 'Venda delivery/balcão' },
  { value: 'mesa', label: 'Mesa' },
  { value: 'cancelamento', label: 'Cancelamento' },
  { value: 'ajuste', label: 'Ajuste' },
  { value: 'entrada', label: 'Entrada de mercadoria' },
  { value: 'perda', label: 'Perda' },
  { value: 'contagem', label: 'Contagem' },
  { value: 'importacao', label: 'Importação' },
];

export const StockHistorySection: React.FC<StockHistorySectionProps> = ({
  products,
  selectedProductId,
  onSelectProductId,
  onOpenOrderRef,
}) => {
  const [direction, setDirection] = useState<'all' | 'in' | 'out'>('all');
  const [reason, setReason] = useState<string>('');
  const [period, setPeriod] = useState<PeriodPreset>('7d');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Product combobox search state
  const [productQuery, setProductQuery] = useState<string>('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState<boolean>(false);

  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [summary, setSummary] = useState<StockMovementsSummary>({
    totalIn: 0,
    totalOut: 0,
    balance: 0,
  });
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const filteredProductOptions = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const list = products.slice().sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!q) return list.slice(0, 60);
    return list
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          p.id.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [products, productQuery]);

  const computeDateRange = useCallback((): { from?: string; to?: string } => {
    const now = new Date();
    const endOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    ).toISOString();

    if (period === 'hoje') {
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0
      ).toISOString();
      return { from: startOfToday, to: endOfToday };
    }
    if (period === '7d') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
      return { from: start.toISOString(), to: endOfToday };
    }
    if (period === '30d') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
      return { from: start.toISOString(), to: endOfToday };
    }
    if (period === 'personalizado') {
      let fromIso: string | undefined;
      let toIso: string | undefined;
      if (customFrom) {
        const [y, m, d] = customFrom.split('-').map(Number);
        if (y && m && d) {
          fromIso = new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
        }
      }
      if (customTo) {
        const [y, m, d] = customTo.split('-').map(Number);
        if (y && m && d) {
          toIso = new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
        }
      }
      return { from: fromIso, to: toIso };
    }
    return {};
  }, [period, customFrom, customTo]);

  const fetchHistory = useCallback(
    async (beforeCursor?: string) => {
      if (beforeCursor) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError('');

      try {
        const { from, to } = computeDateRange();
        const res = await api.getStockMovements({
          productId: selectedProductId || undefined,
          reason: reason || undefined,
          direction: direction === 'all' ? '' : direction,
          from,
          to,
          limit: 100,
          before: beforeCursor,
        });

        if (beforeCursor) {
          setMovements((prev) => [...prev, ...res.items]);
        } else {
          setMovements(res.items);
          setSummary(res.summary);
        }
        setNextBefore(res.nextBefore);
      } catch (err: any) {
        setError(err.message || 'Erro ao carregar histórico de estoque.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [selectedProductId, reason, direction, computeDateRange]
  );

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary Cards at Top of Filtered Period */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 block">
              Total de Entradas (+)
            </span>
            <span className="text-2xl font-black text-emerald-700 mt-0.5 block">
              +{summary.totalIn}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
            <ArrowUpRight className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-red-50/70 border border-red-200 rounded-2xl p-4 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-700 block">
              Total de Saídas (−)
            </span>
            <span className="text-2xl font-black text-red-600 mt-0.5 block">
              −{summary.totalOut}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-red-500/15 text-red-600 flex items-center justify-center">
            <ArrowDownRight className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white border border-neutral-200 rounded-2xl p-4 flex items-center justify-between shadow-2xs">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 block">
              Saldo do Período
            </span>
            <span
              className={`text-2xl font-black mt-0.5 block ${
                summary.balance > 0
                  ? 'text-emerald-600'
                  : summary.balance < 0
                  ? 'text-red-600'
                  : 'text-neutral-800'
              }`}
            >
              {summary.balance > 0
                ? `+${summary.balance}`
                : summary.balance < 0
                ? `−${Math.abs(summary.balance)}`
                : '0'}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-neutral-100 text-neutral-700 flex items-center justify-center">
            <Scale className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Filters Card */}
      <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-2xs space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-black text-neutral-800 uppercase tracking-wider">
            <Filter className="w-4 h-4 text-amber-600" />
            <span>Filtros do Histórico</span>
          </div>

          <button
            type="button"
            onClick={() => fetchHistory()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* 1. Product Search / Selector */}
          <div className="relative">
            <label className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
              Produto
            </label>
            {selectedProduct ? (
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-300 rounded-xl text-xs font-bold text-amber-950">
                <span className="truncate">
                  {selectedProduct.name}{' '}
                  {selectedProduct.volume ? `(${selectedProduct.volume})` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onSelectProductId('');
                    setProductQuery('');
                  }}
                  className="p-0.5 hover:bg-amber-200/70 rounded text-amber-900 shrink-0 cursor-pointer"
                  title="Mostrar todos os produtos"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={productQuery}
                  onFocus={() => setIsProductDropdownOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIsProductDropdownOpen(false), 180);
                  }}
                  onChange={(e) => {
                    setProductQuery(e.target.value);
                    setIsProductDropdownOpen(true);
                  }}
                  placeholder="Todos os produtos (buscar...)"
                  className="w-full pl-8 pr-7 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-semibold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <ChevronDown className="w-3.5 h-3.5 text-neutral-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                {isProductDropdownOpen && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-neutral-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto divide-y divide-neutral-100">
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onSelectProductId('');
                        setProductQuery('');
                        setIsProductDropdownOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-50 cursor-pointer"
                    >
                      Todos os produtos
                    </button>
                    {filteredProductOptions.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-neutral-400 text-center">
                        Nenhum produto encontrado
                      </div>
                    ) : (
                      filteredProductOptions.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            onSelectProductId(p.id);
                            setProductQuery('');
                            setIsProductDropdownOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-amber-50 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="font-bold text-neutral-900 truncate">
                            {p.name} {p.volume ? `• ${p.volume}` : ''}
                          </span>
                          <span className="text-[10px] font-semibold text-neutral-400 shrink-0">
                            Est: {p.stock}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Direction Filter */}
          <div>
            <label className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
              Tipo
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 bg-neutral-100 rounded-xl border border-neutral-200">
              <button
                type="button"
                onClick={() => setDirection('all')}
                className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  direction === 'all'
                    ? 'bg-neutral-900 text-white shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => setDirection('in')}
                className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  direction === 'in'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Entradas
              </button>
              <button
                type="button"
                onClick={() => setDirection('out')}
                className={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                  direction === 'out'
                    ? 'bg-red-600 text-white shadow-2xs'
                    : 'text-neutral-600 hover:text-neutral-900'
                }`}
              >
                Saídas
              </button>
            </div>
          </div>

          {/* 3. Reason Filter */}
          <div>
            <label className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
              Motivo
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 4. Period Filter */}
          <div>
            <label className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
              Período
            </label>
            <div className="grid grid-cols-4 gap-1 p-1 bg-neutral-100 rounded-xl border border-neutral-200">
              {(
                [
                  { id: 'hoje', label: 'Hoje' },
                  { id: '7d', label: '7 dias' },
                  { id: '30d', label: '30 dias' },
                  { id: 'personalizado', label: 'Data' },
                ] as Array<{ id: PeriodPreset; label: string }>
              ).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    period === p.id
                      ? 'bg-neutral-900 text-white shadow-2xs'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {period === 'personalizado' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-neutral-100">
            <div>
              <label className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
                Data inicial
              </label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-semibold text-neutral-900"
              />
            </div>
            <div>
              <label className="text-[11px] font-bold text-neutral-500 uppercase block mb-1">
                Data final
              </label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-semibold text-neutral-900"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold">
          {error}
        </div>
      )}

      {/* Movements Table / List */}
      <div className="bg-white rounded-3xl border border-neutral-200 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-xs font-semibold text-neutral-400">
            Carregando movimentações de estoque...
          </div>
        ) : movements.length === 0 ? (
          <div className="p-12 text-center space-y-1">
            <Clock className="w-8 h-8 text-neutral-300 mx-auto mb-2" />
            <p className="text-sm font-bold text-neutral-700">
              Nenhuma movimentação encontrada neste período.
            </p>
            <p className="text-xs text-neutral-400">
              Altere os filtros acima para consultar outros produtos ou datas.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50 text-[11px] font-bold text-neutral-500 uppercase tracking-wider">
                    <th className="py-3 px-4">Data / Hora</th>
                    <th className="py-3 px-4">Produto</th>
                    <th className="py-3 px-4 text-center">Movimento</th>
                    <th className="py-3 px-4 text-center">Estoque Depois</th>
                    <th className="py-3 px-4">Motivo</th>
                    <th className="py-3 px-4">Referência</th>
                    <th className="py-3 px-4">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-xs">
                  {movements.map((m) => {
                    const isPositive = m.delta > 0;
                    const formattedDelta = isPositive
                      ? `+${m.delta}`
                      : `−${Math.abs(m.delta)}`;
                    const isOrderRef =
                      m.refType === 'pedido' ||
                      (typeof m.refId === 'string' && m.refId.startsWith('PED-'));
                    const isComandaRef = m.refType === 'comanda';

                    return (
                      <tr key={m.id} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-neutral-500">
                          {formatDateTime(m.createdAt)}
                        </td>
                        <td className="py-3 px-4 font-bold text-neutral-900">
                          <button
                            type="button"
                            onClick={() => onSelectProductId(m.productId)}
                            className="hover:text-amber-600 text-left transition-colors cursor-pointer"
                            title="Filtrar histórico por este produto"
                          >
                            {m.productName}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <span
                            className={`inline-block px-2.5 py-1 rounded-lg font-black text-xs ${
                              isPositive
                                ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                : 'bg-red-100 text-red-700 border border-red-200'
                            }`}
                          >
                            {formattedDelta}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-center font-black text-neutral-800 whitespace-nowrap">
                          {m.stockAfter}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-800 font-bold text-[11px]">
                            {formatStockMovementReason(m.reason)}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isOrderRef && m.refId ? (
                            <button
                              type="button"
                              onClick={() => onOpenOrderRef(m.refId!)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-black text-[11px] transition-colors cursor-pointer"
                              title="Abrir detalhes do pedido"
                            >
                              <span>{m.refId}</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          ) : isComandaRef ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-50 text-purple-900 border border-purple-200 font-bold text-[11px]">
                              <UtensilsCrossed className="w-3 h-3" />
                              <span>
                                {m.tableNumber ? `Mesa ${m.tableNumber}` : 'Comanda'}
                              </span>
                            </span>
                          ) : m.refId ? (
                            <span className="font-mono text-[11px] text-neutral-500">
                              {m.refId}
                            </span>
                          ) : (
                            <span className="text-neutral-300">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-neutral-600 max-w-xs truncate">
                          {m.note || <span className="text-neutral-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {nextBefore && (
              <div className="p-4 border-t border-neutral-100 bg-neutral-50/50 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => fetchHistory(nextBefore)}
                  className="px-5 py-2.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-black transition-colors cursor-pointer"
                >
                  {loadingMore ? 'Carregando mais...' : 'Carregar mais movimentações'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
