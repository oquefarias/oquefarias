import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { StoreSettings } from '../types';
import { X, Printer, Copy, Check, Smartphone, Beer } from 'lucide-react';

interface QRCodeModalProps {
  settings: StoreSettings;
  isOpen: boolean;
  onClose: () => void;
}

export const QRCodeModal: React.FC<QRCodeModalProps> = ({ settings, isOpen, onClose }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  // The client store URL
  const currentUrl = typeof window !== 'undefined' ? window.location.origin : 'https://deposito-express.com';
  // Point directly to the clean customer storefront root
  const customerStoreUrl = `${currentUrl}/`;

  useEffect(() => {
    if (isOpen) {
      QRCode.toDataURL(customerStoreUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#1c1917',
          light: '#ffffff',
        },
      })
        .then((url: string) => setQrDataUrl(url))
        .catch((err: unknown) => console.error('Error generating QR Code', err));
    }
  }, [isOpen, customerStoreUrl]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(customerStoreUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-neutral-200">
        {/* Controls - Hidden during print */}
        <div className="print:hidden bg-neutral-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-base">QR Code & Link da Loja para Clientes</h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Printable Display Flyer for Depot Counter */}
        <div className="p-8 text-center bg-radial from-amber-50 to-white" id="flyer-to-print">
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt={settings.storeName}
              className="w-20 h-20 rounded-3xl object-cover mx-auto mb-4 border-2 border-amber-500 shadow-md"
            />
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 bg-amber-500 text-white rounded-2xl shadow-lg mb-4">
              <Beer className="w-8 h-8" />
            </div>
          )}

          <h2 className="text-2xl font-black text-neutral-900 uppercase tracking-tight">
            {settings.storeName}
          </h2>
          <p className="text-sm font-semibold text-amber-700 mt-1">
            Peça no conforto da sua casa ou antecipe sua retirada!
          </p>

          <div className="my-6 p-4 bg-white rounded-2xl shadow-md border border-neutral-200 inline-block">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="QR Code da Loja" className="w-64 h-64 mx-auto rounded-lg" />
            ) : (
              <div className="w-64 h-64 bg-neutral-100 flex items-center justify-center text-neutral-400 text-sm">
                Gerando QR Code...
              </div>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-lg font-bold text-neutral-900">
              📸 Aponte a câmera do seu celular
            </p>
            <p className="text-sm text-neutral-600 max-w-sm mx-auto">
              Acesse nosso cardápio completo, cervejas estupidamente geladas, combos e faça seu pedido direto pelo celular!
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-neutral-200 flex flex-col items-center gap-1 text-xs text-neutral-500">
            <span className="font-medium text-neutral-700">WhatsApp: {settings.phone}</span>
            <span>{settings.address}</span>
            <span className="text-amber-800 font-semibold">{settings.openingHours}</span>
          </div>
        </div>

        {/* Actions - Hidden when printing */}
        <div className="print:hidden p-5 bg-neutral-100 border-t border-neutral-200 space-y-3">
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-neutral-300 text-xs text-neutral-700">
            <span className="truncate flex-1 font-mono">{customerStoreUrl}</span>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg font-medium transition-colors shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado!' : 'Copiar Link'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-200 rounded-xl transition-colors"
            >
              Fechar
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-sm transition-colors text-sm"
            >
              <Printer className="w-4 h-4" />
              Imprimir Placa de Balcão (A4)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
