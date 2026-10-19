import React from 'react';
import { StoreSettings } from '../types';
import { soundService } from '../utils/sound';
import { Beer, Volume2, VolumeX, Eye, ShieldCheck, Power } from 'lucide-react';

interface NavbarProps {
  isAdmin: boolean;
  settings: StoreSettings;
  pendingOrdersCount: number;
  onToggleStoreOpen: () => void;
  onLockAdmin: () => void;
  onPreviewCustomerView?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  isAdmin,
  settings,
  pendingOrdersCount,
  onToggleStoreOpen,
  onLockAdmin,
  onPreviewCustomerView,
}) => {
  const [soundEnabled, setSoundEnabled] = React.useState<boolean>(soundService.isEnabled());

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundService.setSoundEnabled(next);
    if (next) soundService.playNewOrderSound();
  };

  return (
    <header className="bg-neutral-900 border-b border-neutral-800 text-white sticky top-0 z-40 print:hidden shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-3">
          {/* Logo & Store Brand */}
          <div className="flex items-center gap-3">
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.storeName}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl object-cover border border-amber-500/30 shadow-md shrink-0 bg-neutral-800"
              />
            ) : (
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-amber-500 text-neutral-950 flex items-center justify-center font-black shadow-md shadow-amber-500/20 shrink-0">
                <Beer className="w-6 h-6" />
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-black text-sm sm:text-base tracking-tight text-white line-clamp-1">
                  {settings.storeName}
                </span>
                <span className={`hidden sm:inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                  settings.isOpen
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                    : 'bg-red-500/20 text-red-400 border-red-500/30'
                }`}>
                  {settings.isOpen ? '🟢 Aberto' : '🔴 Fechado'}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 hidden sm:block truncate max-w-xs">
                {isAdmin ? 'Computador do Dono • /control-panel' : (settings.isOpen ? 'Bebidas estupidamente geladas na sua porta' : 'No momento fechado para pedidos')}
              </p>
            </div>
          </div>

          {/* ADMIN EXCLUSIVE HEADER CONTROLS (Only visible at /control-panel when authenticated) */}
          {isAdmin ? (
            <div className="flex items-center gap-2">
              {/* Online / Offline Quick Toggle */}
              <button
                onClick={onToggleStoreOpen}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs font-black transition-all shadow-sm ${
                  settings.isOpen
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-neutral-950 shadow-emerald-500/20'
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20'
                }`}
                title="Clique para abrir ou fechar o site para novos pedidos"
              >
                <Power className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {settings.isOpen ? 'Loja Online: Aberta' : 'Loja Online: Fechada'}
                </span>
                <span className="sm:hidden">
                  {settings.isOpen ? 'Aberta' : 'Fechada'}
                </span>
              </button>

              {/* Sound alert chime toggle */}
              <button
                onClick={toggleSound}
                className={`p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors border ${
                  soundEnabled
                    ? 'bg-neutral-800 text-amber-400 border-neutral-700 hover:bg-neutral-700'
                    : 'bg-neutral-800/50 text-neutral-500 border-neutral-800 hover:bg-neutral-800'
                }`}
                title="Campainha de novos pedidos"
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                <span className="hidden md:inline">{soundEnabled ? 'Campainha' : 'Mudo'}</span>
              </button>

              {/* Preview Customer Store */}
              {onPreviewCustomerView && (
                <button
                  onClick={onPreviewCustomerView}
                  className="flex items-center gap-1.5 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded-xl text-xs font-bold transition-colors"
                  title="Visualizar a loja como cliente"
                >
                  <Eye className="w-4 h-4 text-amber-400" />
                  <span className="hidden sm:inline">Ver Loja</span>
                </button>
              )}

              {/* Lock Panel */}
              <button
                onClick={onLockAdmin}
                className="flex items-center gap-1.5 px-3 py-2 bg-neutral-800 hover:bg-red-950/80 hover:text-red-400 text-neutral-300 border border-neutral-700 rounded-xl text-xs font-bold transition-colors"
                title="Bloquear tela do computador"
              >
                <span>Bloquear</span>
              </button>
            </div>
          ) : (
            /* CLIENT VIEW: Absolutely NO admin buttons, NO padlocks, NO switchers. 100% Customer E-commerce! */
            <div className="flex items-center gap-3">
              <div className="text-right">
                <span className="text-xs font-bold block text-neutral-200">
                  {settings.isOpen ? '⚡ Entrega em até 45 min' : 'Fechado no momento'}
                </span>
                <span className="text-[11px] text-neutral-400 block">
                  {settings.openingHours}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
