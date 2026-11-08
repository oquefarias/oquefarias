import React from 'react';
import { Order, OrderItemComboComponent, StoreSettings, formatOrderItemComboLine } from '../../../types';
import { X, Printer, CheckCircle2 } from 'lucide-react';

interface TableReceiptModalProps {
  order: Order | null;
  settings: StoreSettings;
  isOpen: boolean;
  onClose: () => void;
}

export const TableReceiptModal: React.FC<TableReceiptModalProps> = ({
  order,
  settings,
  isOpen,
  onClose,
}) => {
  if (!isOpen || !order) return null;

  const handlePrint = () => {
    window.print();
  };

  const paymentLabels: Record<string, string> = {
    pix: 'PIX',
    cartao_credito: 'Cartão de Crédito',
    cartao_debito: 'Cartão de Débito',
    dinheiro: 'Dinheiro',
  };

  const groupedItems = (() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        volume?: string;
        price: number;
        quantity: number;
        saleUnit?: 'unit' | 'case';
        unitsPerSale?: number;
        comboItems?: OrderItemComboComponent[];
      }
    >();

    for (const it of order.items) {
      const saleUnit = it.saleUnit === 'case' ? 'case' : 'unit';
      const unitsPerSale = it.unitsPerSale && it.unitsPerSale > 1 ? it.unitsPerSale : 1;
      const key = `${it.productId || it.name}::${saleUnit}::${Number(it.price).toFixed(2)}`;
      const existing = map.get(key);
      if (existing) {
        existing.quantity += it.quantity;
        if (!existing.comboItems && it.comboItems && it.comboItems.length > 0) {
          existing.comboItems = it.comboItems;
        }
      } else {
        map.set(key, {
          key,
          name: it.name,
          volume: it.volume,
          price: it.price,
          quantity: it.quantity,
          saleUnit,
          unitsPerSale,
          comboItems: it.comboItems && it.comboItems.length > 0 ? it.comboItems : undefined,
        });
      }
    }

    return Array.from(map.values());
  })();

  const serviceFeeInfo = (() => {
    const discountVal = order.discount || 0;
    const computedFee = Math.max(
      0,
      Math.round((order.total - order.subtotal + discountVal) * 100) / 100
    );
    const match = order.notes?.match(/Taxa de servi[çc]o\s*\((\d+(?:[.,]\d+)?)%\)\s*:\s*R\$\s*(\d+(?:[.,]\d+)?)/i);
    if (match) {
      const pct = parseFloat(match[1].replace(',', '.')) || 10;
      const amount = computedFee > 0 ? computedFee : parseFloat(match[2].replace(',', '.')) || 0;
      return amount > 0 ? { percent: pct, amount } : null;
    }
    if (computedFee > 0.009) {
      const pct = order.subtotal > 0 ? Math.round((computedFee / order.subtotal) * 100) : 10;
      return { percent: pct, amount: computedFee };
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-neutral-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Top notification bar */}
        <div className="print:hidden bg-emerald-500 text-neutral-950 p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5" />
            <span className="text-xs font-black uppercase tracking-wider">Conta Fechada com Sucesso!</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Printable Receipt Paper */}
        <div
          id="receipt-to-print"
          className="p-6 overflow-y-auto flex-1 font-mono text-xs text-neutral-800 bg-neutral-50/50 space-y-4"
        >
          <div className="text-center pb-3 border-b border-dashed border-neutral-300">
            <h3 className="font-black text-sm uppercase tracking-wider text-neutral-900">{settings.storeName || 'Depósito'}</h3>
            {settings.cnpjOrCpf && <p className="text-[11px] text-neutral-500 mt-0.5">CNPJ/CPF: {settings.cnpjOrCpf}</p>}
            {settings.address && <p className="text-[11px] text-neutral-500">{settings.address}</p>}
            {settings.phone && <p className="text-[11px] text-neutral-500">Tel: {settings.phone}</p>}
            <p className="text-[10px] text-neutral-400 mt-1">*** COMPROVANTE NÃO FISCAL ***</p>
          </div>

          <div className="space-y-1 text-[11px] border-b border-dashed border-neutral-300 pb-3">
            <div className="flex justify-between">
              <span>PEDIDO: #{order.id}</span>
              <span>{new Date(order.createdAt).toLocaleDateString('pt-BR')}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-bold">{order.customer.name}</span>
              <span>{new Date(order.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            {order.notes && (
              <p className="text-[10px] text-neutral-500 italic mt-1">{order.notes}</p>
            )}
          </div>

          {/* Items */}
          <div className="space-y-1.5 border-b border-dashed border-neutral-300 pb-3">
            <div className="flex justify-between font-bold text-[10px] uppercase text-neutral-500 pb-1">
              <span>Item / Qtd</span>
              <span>Total</span>
            </div>
            {groupedItems.map((it) => {
              const isCase = it.saleUnit === 'case' && (it.unitsPerSale || 1) > 1;
              return (
                <div key={it.key} className="flex justify-between items-start text-[11px]">
                  <div className="pr-2">
                    <span>
                      {isCase
                        ? `${it.quantity} cx (${it.quantity * (it.unitsPerSale || 1)} un) ${it.name}`
                        : `${it.quantity} un ${it.name}`}
                    </span>
                    {it.volume && <span className="text-[10px] text-neutral-500"> ({it.volume})</span>}
                    {it.comboItems && it.comboItems.length > 0 && (
                      <div className="pl-2 mt-0.5 space-y-0.5 text-[10px] text-neutral-600 font-semibold">
                        {it.comboItems.map((ci, ciIdx) => (
                          <div key={`${ci.productId}-${ciIdx}`}>{formatOrderItemComboLine(ci)}</div>
                        ))}
                      </div>
                    )}
                    <div className="text-[10px] text-neutral-400">
                      {it.quantity} {isCase ? 'cx' : 'un'} × R$ {it.price.toFixed(2)}
                    </div>
                  </div>
                  <span className="font-bold whitespace-nowrap">
                    R$ {(it.price * it.quantity).toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Totals */}
          <div className="space-y-1.5 pt-1 text-xs">
            <div className="flex justify-between text-neutral-600">
              <span>Subtotal:</span>
              <span>R$ {order.subtotal.toFixed(2)}</span>
            </div>
            {serviceFeeInfo && (
              <div className="flex justify-between text-neutral-700 font-semibold">
                <span>Taxa de serviço ({serviceFeeInfo.percent}%):</span>
                <span>R$ {serviceFeeInfo.amount.toFixed(2)}</span>
              </div>
            )}
            {order.discount !== undefined && order.discount > 0 && (
              <div className="flex justify-between text-emerald-700 font-bold">
                <span>Desconto:</span>
                <span>- R$ {order.discount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-black text-neutral-950 pt-1 border-t border-dashed border-neutral-300">
              <span>TOTAL A PAGAR:</span>
              <span>R$ {order.total.toFixed(2)}</span>
            </div>

            <div className="pt-2 text-[11px] text-neutral-600 space-y-0.5">
              <div className="flex justify-between">
                <span>Forma de Pagamento:</span>
                <span className="font-bold uppercase text-neutral-900">
                  {paymentLabels[order.paymentMethod] || order.paymentMethod}
                </span>
              </div>
              {order.cashChangeFor !== undefined && order.cashChangeFor !== null && (
                <>
                  <div className="flex justify-between">
                    <span>Recebido:</span>
                    <span>R$ {order.cashChangeFor.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-amber-800">
                    <span>Troco:</span>
                    <span>R$ {Math.max(0, order.cashChangeFor - order.total).toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="text-center pt-3 border-t border-dashed border-neutral-300 text-[10px] text-neutral-400">
            Obrigado pela preferência! Volte sempre!
          </div>
        </div>

        {/* Action buttons */}
        <div className="print:hidden p-4 bg-white border-t border-neutral-200 flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex-1 py-3 px-4 bg-amber-500 hover:bg-amber-400 text-neutral-950 rounded-2xl text-xs font-black shadow-md flex items-center justify-center gap-2 transition-colors"
          >
            <Printer className="w-4 h-4" />
            <span>Imprimir Comprovante</span>
          </button>
          <button
            onClick={onClose}
            className="py-3 px-5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-2xl text-xs font-bold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
