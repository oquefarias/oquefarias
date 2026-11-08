import React, { useEffect, useState } from 'react';
import {
  Order,
  OrderItemAddon,
  OrderItemComboComponent,
  StoreSettings,
  buildOrderItemAddonsSignature,
  formatOrderItemAddonLine,
  formatOrderItemComboLine,
} from '../types';
import { Printer, X } from 'lucide-react';
import QRCode from 'qrcode';
import { buildSingleDeliveryRouteUrl } from '../utils/geo';

interface PrintReceiptModalProps {
  order: Order | null;
  settings: StoreSettings;
  onClose: () => void;
}

export const PrintReceiptModal: React.FC<PrintReceiptModalProps> = ({ order, settings, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  const isDeliveryRouteOrder = Boolean(
    order &&
    order.deliveryType === 'delivery' &&
    order.source !== 'balcao' &&
    order.source !== 'mesa'
  );

  const routeUrl =
    order && isDeliveryRouteOrder
      ? buildSingleDeliveryRouteUrl(order.customer, settings.address)
      : '';

  useEffect(() => {
    let active = true;
    if (!isDeliveryRouteOrder || !routeUrl) {
      setQrDataUrl('');
      return;
    }
    QRCode.toDataURL(routeUrl, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [isDeliveryRouteOrder, routeUrl]);

  useEffect(() => {
    if (!order) return;
    const closeKey = (settings.shortcuts?.fecharModal || 'Escape').toUpperCase();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (window.innerWidth < 768) return;
      if (e.key.toUpperCase() === closeKey || (closeKey === 'ESC' && e.key === 'Escape')) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [order, onClose, settings.shortcuts]);

  if (!order) return null;

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden border border-amber-200">
        {/* Controls - Hidden during print */}
        <div className="print:hidden bg-amber-900 text-amber-50 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Printer className="w-5 h-5 text-amber-300" />
            <h3 className="font-bold text-base">Comanda de Impressão #{order.id}</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-amber-800 rounded-lg text-amber-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Receipt Body */}
        <div className="p-6 text-neutral-900 bg-white font-mono text-sm leading-relaxed" id="receipt-to-print">
          {/* Header */}
          <div className="text-center border-b-2 border-dashed border-neutral-400 pb-4 mb-4">
            <h2 className="text-lg font-black tracking-tight uppercase text-neutral-900">{settings.storeName}</h2>
            <p className="text-xs text-neutral-600 mt-0.5">{settings.address}</p>
            <p className="text-xs text-neutral-600">Tel/Zap: {settings.phone}</p>
            {settings.cnpjOrCpf && <p className="text-xs text-neutral-500">CNPJ: {settings.cnpjOrCpf}</p>}
            <div className="mt-2 inline-block px-3 py-1 bg-neutral-100 rounded text-xs font-bold uppercase tracking-wider">
              {order.deliveryType === 'delivery' ? '🛵 PEDIDO DELIVERY' : '🏪 RETIRADA NO BALCÃO'}
            </div>
          </div>

          {/* Order Details */}
          <div className="text-xs space-y-1 border-b border-dashed border-neutral-300 pb-3 mb-3">
            <div className="flex justify-between">
              <span className="text-neutral-500">Comanda:</span>
              <span className="font-bold text-neutral-900">#{order.id}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Data/Hora:</span>
              <span className="text-neutral-700">{formatDate(order.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Origem:</span>
              <span className="font-semibold text-neutral-800 uppercase">{order.source === 'online' ? 'Site do Cliente' : 'Venda Balcão'}</span>
            </div>
          </div>

          {/* Customer / Delivery Address */}
          <div className="text-xs space-y-1 border-b border-dashed border-neutral-300 pb-3 mb-3 bg-neutral-50 p-2.5 rounded">
            <p className="font-bold text-neutral-900 text-sm">Cliente: {order.customer.name}</p>
            <p className="text-neutral-700">Telefone: {order.customer.phone}</p>
            {order.deliveryType === 'delivery' ? (
              <>
                <p className="text-neutral-900 font-medium mt-1">
                  Endereço: {order.customer.address}, Nº {order.customer.number}
                </p>
                <p className="text-neutral-700">Bairro: {order.customer.neighborhood}</p>
                {(order.customer.city || order.customer.state) && (
                  <p className="text-neutral-700">
                    Cidade: {[order.customer.city, order.customer.state].filter(Boolean).join(' - ')}
                    {order.customer.cep ? ` • CEP: ${order.customer.cep}` : ''}
                  </p>
                )}
                {order.customer.complement && <p className="text-neutral-600">Compl: {order.customer.complement}</p>}
                {order.customer.reference && (
                  <p className="text-neutral-900 font-semibold bg-amber-100 px-1.5 py-0.5 rounded mt-1">
                    Ref: {order.customer.reference}
                  </p>
                )}
                {isDeliveryRouteOrder && qrDataUrl && (
                  <div className="mt-3 pt-2.5 border-t border-dashed border-neutral-300 flex flex-col items-center text-center">
                    <img
                      src={qrDataUrl}
                      alt="QR Code Rota de Entrega"
                      className="w-[30mm] h-[30mm] object-contain mx-auto block"
                    />
                    <p className="text-[11px] font-bold text-neutral-900 mt-1">
                      Escaneie para abrir a rota
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-amber-800 font-bold mt-1">Retirada direta no depósito</p>
            )}
          </div>

          {/* Items */}
          <div className="border-b-2 border-dashed border-neutral-400 pb-3 mb-3">
            <div className="flex justify-between text-xs font-bold text-neutral-600 border-b border-neutral-200 pb-1 mb-2">
              <span>ITEM / QTD</span>
              <span>TOTAL</span>
            </div>
            <div className="space-y-2">
              {(() => {
                const map = new Map<
                  string,
                  {
                    key: string;
                    name: string;
                    volume: string;
                    price: number;
                    quantity: number;
                    isCold?: boolean;
                    saleUnit?: 'unit' | 'case';
                    unitsPerSale?: number;
                    addons?: OrderItemAddon[];
                    comboItems?: OrderItemComboComponent[];
                  }
                >();
                for (const item of order.items) {
                  const saleUnit = item.saleUnit === 'case' ? 'case' : 'unit';
                  const unitsPerSale = item.unitsPerSale && item.unitsPerSale > 1 ? item.unitsPerSale : 1;
                  const addonsSig = buildOrderItemAddonsSignature(item.addons);
                  const comboSig = Array.isArray(item.comboItems)
                    ? item.comboItems.map((ci) => `${ci.productId}:${ci.quantity}`).join('|')
                    : '';
                  const key = `${item.productId || item.name}::${saleUnit}::${Number(item.price).toFixed(2)}::${addonsSig}::${comboSig}`;
                  const existing = map.get(key);
                  if (existing) {
                    existing.quantity += item.quantity;
                  } else {
                    map.set(key, {
                      key,
                      name: item.name,
                      volume: item.volume,
                      price: item.price,
                      quantity: item.quantity,
                      isCold: item.isCold,
                      saleUnit,
                      unitsPerSale,
                      addons: item.addons,
                      comboItems: item.comboItems,
                    });
                  }
                }
                return Array.from(map.values()).map((item) => {
                  const isCase = item.saleUnit === 'case' && (item.unitsPerSale || 1) > 1;
                  return (
                    <div key={item.key} className="flex justify-between items-start text-xs">
                      <div className="pr-2">
                        <span className="font-bold text-neutral-900">
                          {isCase ? `${item.quantity} cx ` : `${item.quantity}x `}
                        </span>
                        <span className="font-semibold">
                          {item.name}
                          {isCase ? ` (c/${item.unitsPerSale})` : ''}
                        </span>
                        <span className="block text-[11px] text-neutral-500">
                          {item.volume} {item.isCold ? '• Gelada ❄️' : ''} ({formatCurrency(item.price)} {isCase ? 'cx' : 'un'})
                        </span>
                        {item.comboItems && item.comboItems.length > 0 && (
                          <div className="mt-0.5 space-y-0.5 pl-2">
                            {item.comboItems.map((ci, cIdx) => (
                              <span key={cIdx} className="block text-[11px] font-semibold text-neutral-800">
                                {formatOrderItemComboLine(ci)}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.addons && item.addons.length > 0 && (
                          <div className="mt-0.5 space-y-0.5 pl-2">
                            {item.addons.map((addon, aIdx) => (
                              <span key={aIdx} className="block text-[11px] font-semibold text-neutral-800">
                                {formatOrderItemAddonLine(addon)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <span className="font-bold text-neutral-900 whitespace-nowrap">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>
                  );
                });
              })()}
            </div>
          </div>

          {/* Totals & Payment */}
          <div className="text-xs space-y-1.5 border-b border-dashed border-neutral-300 pb-3 mb-3">
            <div className="flex justify-between text-neutral-600">
              <span>Subtotal Itens:</span>
              <span>{formatCurrency(order.subtotal)}</span>
            </div>
            <div className="flex justify-between text-neutral-600">
              <span>Taxa de Entrega:</span>
              <span>{order.deliveryFee === 0 ? 'GRÁTIS' : formatCurrency(order.deliveryFee)}</span>
            </div>
            <div className="flex justify-between text-base font-black text-neutral-900 pt-1 border-t border-neutral-200">
              <span>TOTAL A PAGAR:</span>
              <span className="text-amber-700">{formatCurrency(order.total)}</span>
            </div>
          </div>

          {/* Payment Method Details */}
          <div className="text-xs bg-neutral-100 p-2.5 rounded space-y-1 mb-3">
            <div className="flex justify-between font-bold">
              <span>Forma de Pagamento:</span>
              <span className="uppercase text-neutral-900">
                {order.paymentMethod === 'pix' && 'PIX'}
                {order.paymentMethod === 'cartao_credito' && 'Cartão de Crédito'}
                {order.paymentMethod === 'cartao_debito' && 'Cartão de Débito'}
                {order.paymentMethod === 'dinheiro' && 'Dinheiro'}
              </span>
            </div>
            {order.paymentMethod === 'dinheiro' && order.cashChangeFor !== undefined && order.cashChangeFor !== null && (
              <>
                <div className="flex justify-between text-neutral-700 font-semibold">
                  <span>Recebido:</span>
                  <span>{formatCurrency(order.cashChangeFor)}</span>
                </div>
                <div className="flex justify-between text-amber-800 font-bold">
                  <span>Troco:</span>
                  <span>{formatCurrency(Math.max(0, order.cashChangeFor - order.total))}</span>
                </div>
              </>
            )}
            {order.paymentMethod === 'pix' && (
              <p className="text-[11px] text-neutral-600">Chave Pix: {settings.pixKey}</p>
            )}
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="text-xs bg-amber-50 border border-amber-200 p-2 rounded mb-3">
              <span className="font-bold text-amber-900">Obs do Cliente: </span>
              <span className="text-amber-800 italic">{order.notes}</span>
            </div>
          )}

          {/* Motoboy Signature */}
          <div className="pt-4 text-center text-xs text-neutral-500 border-t border-dashed border-neutral-300">
            <div className="border-b border-neutral-400 w-3/4 mx-auto mb-1"></div>
            <p>Assinatura / Recebido por</p>
            <p className="text-[10px] mt-2 text-neutral-400">Obrigado pela preferência! Beba com moderação.</p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="print:hidden p-4 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-200 rounded-lg transition-colors"
          >
            Fechar
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg shadow-sm transition-colors text-sm"
          >
            <Printer className="w-4 h-4" />
            Imprimir Comanda
          </button>
        </div>
      </div>
    </div>
  );
};
