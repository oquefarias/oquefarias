import { useState, useEffect, useSyncExternalStore } from 'react';
import { api } from './services/api';
import { Navbar } from './components/Navbar';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { CustomerStorefront } from './components/customer/CustomerStorefront';
import { AdminLoginModal } from './components/admin/AdminLoginModal';
import { ShieldCheck, Lock, ArrowRight, AlertCircle, ArrowLeft } from 'lucide-react';

export default function App() {
  const subscribe = (callback: () => void) => api.subscribe(callback);
  const getSnapshot = () => api.getVersion();

  useSyncExternalStore(subscribe, getSnapshot);

  const products = api.getProducts();
  const orders = api.getOrders();
  const settings = api.getSettings();
  const deliveryAreas = api.getDeliveryAreas();
  const customers = api.getCustomers();

  // Determine if current URL is the administrative path (/control-panel)
  const checkIsAdmRoute = (): boolean => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase();
    const search = window.location.search.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return (
      path === '/control-panel' ||
      path === '/control-panel/' ||
      path.startsWith('/control-panel') ||
      search.includes('control-panel') ||
      hash.includes('control-panel')
    );
  };

  const [isAdmRoute, setIsAdmRoute] = useState<boolean>(checkIsAdmRoute);
  const [isAdminAuth, setIsAdminAuth] = useState<boolean>(() => api.isAdminAuthenticated());
  
  // Direct PIN login state on /control-panel
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  // Listen to popstate (browser back/forward) & keyboard shortcut for the owner (Alt + C)
  useEffect(() => {
    const handleLocationChange = () => {
      setIsAdmRoute(checkIsAdmRoute());
      setIsAdminAuth(api.isAdminAuthenticated());
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Shortcut Alt + C or Ctrl + Shift + C to quickly open /control-panel
      if ((e.altKey && (e.key === 'c' || e.key === 'C')) || 
          (e.ctrlKey && e.shiftKey && (e.key === 'c' || e.key === 'C'))) {
        e.preventDefault();
        navigateTo('/control-panel');
      }
    };

    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    api.syncWithBackend();
  }, []);

  // Quick navigation helpers
  const navigateTo = (path: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', path);
      setIsAdmRoute(checkIsAdmRoute());
    }
  };

  const handleAdminLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) {
      setPinError('Digite o PIN de segurança.');
      return;
    }
    setIsVerifying(true);
    setPinError('');

    const isOk = await api.verifyAdminPin(pinInput);
    setIsVerifying(false);

    if (isOk) {
      setPinInput('');
      setIsAdminAuth(true);
    } else {
      setPinError('Senha de acesso incorreta. Tente novamente.');
    }
  };

  const handleLockAdmin = () => {
    api.logoutAdmin();
    setIsAdminAuth(false);
  };

  const handleToggleStoreOpen = async () => {
    const next = !settings.isOpen;
    await api.updateSettings({ isOpen: next });
  };

  const pendingOrdersCount = orders.filter(o => o.status === 'pendente').length;

  // =====================================================================
  // ROUTE 1: /control-panel (COMPUTADOR DO DONO DO DEPÓSITO)
  // =====================================================================
  if (isAdmRoute) {
    return (
      <div className="min-h-screen bg-neutral-100 text-neutral-900 flex flex-col font-sans antialiased selection:bg-amber-500 selection:text-white">
        {/* Admin Navbar */}
        <Navbar
          isAdmin={isAdminAuth}
          settings={settings}
          pendingOrdersCount={pendingOrdersCount}
          onToggleStoreOpen={handleToggleStoreOpen}
          onLockAdmin={handleLockAdmin}
          onPreviewCustomerView={() => navigateTo('/')}
        />

        <main className="flex-1">
          {isAdminAuth ? (
            /* Authenticated Admin Dashboard */
            <AdminDashboard
              products={products}
              orders={orders}
              settings={settings}
              deliveryAreas={deliveryAreas}
              customers={customers}
              onLockDashboard={handleLockAdmin}
              onPreviewCustomerView={() => navigateTo('/')}
            />
          ) : (
            /* Dedicated Secure Login Screen for /control-panel */
            <div className="max-w-md mx-auto px-4 py-16">
              <div className="bg-white rounded-3xl shadow-xl border border-neutral-200 overflow-hidden">
                <div className="bg-neutral-900 text-white p-8 text-center">
                  {settings.logoUrl ? (
                    <img
                      src={settings.logoUrl}
                      alt={settings.storeName}
                      className="w-16 h-16 rounded-2xl mx-auto mb-3 object-cover border border-amber-500/40 shadow-md"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-amber-500/20 text-amber-400 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-amber-500/30">
                      <ShieldCheck className="w-9 h-9" />
                    </div>
                  )}

                  <h2 className="text-xl font-black">{settings.storeName}</h2>
                  <p className="text-xs text-amber-400 font-mono mt-1">Acesso Restrito: Computador do Dono (/control-panel)</p>
                  <p className="text-xs text-neutral-400 mt-2">
                    Digite sua senha de acesso para desbloquear o gerenciamento do seu depósito.
                  </p>
                </div>

                <form onSubmit={handleAdminLoginSubmit} className="p-8 space-y-4">
                  <div>
                    <label className="text-xs font-bold text-neutral-700 block mb-1 flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-600" />
                      <span>PIN / Senha do Dono</span>
                    </label>
                    <input
                      type="password"
                      autoFocus
                      maxLength={12}
                      placeholder="Senha de acesso"
                      value={pinInput}
                      onChange={(e) => {
                        setPinInput(e.target.value);
                        if (pinError) setPinError('');
                      }}
                      className="w-full px-4 py-3 bg-neutral-50 border border-neutral-300 rounded-2xl text-center text-xl tracking-widest font-mono font-bold focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                    <p className="text-[11px] text-neutral-400 mt-1 text-center">
                      Senha padrão inicial: <strong className="font-mono text-neutral-700">1234</strong> (alterável nas configurações)
                    </p>
                  </div>

                  {pinError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{pinError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isVerifying || !pinInput.trim()}
                    className="w-full py-3.5 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 text-white font-black text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    {isVerifying ? (
                      <span>Verificando...</span>
                    ) : (
                      <>
                        <span>Acessar Meu Depósito</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>

                  <div className="pt-2 text-center">
                    <button
                      type="button"
                      onClick={() => navigateTo('/')}
                      className="text-xs font-semibold text-neutral-500 hover:text-neutral-800 flex items-center justify-center gap-1 mx-auto"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Voltar para o site dos clientes</span>
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>

        <footer className="bg-neutral-900 text-neutral-500 py-4 text-center text-xs border-t border-neutral-800">
          <p>© {new Date().getFullYear()} {settings.storeName} • Painel Administrativo do Dono (/control-panel)</p>
        </footer>
      </div>
    );
  }

  // =====================================================================
  // ROUTE 2: / (SITE PÚBLICO DOS CLIENTES)
  // ZERO botões de admin, ZERO senhas, ZERO risco de clientes acessarem!
  // =====================================================================
  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900 flex flex-col font-sans antialiased selection:bg-amber-500 selection:text-white">
      {/* Customer Header - Clean e-commerce */}
      <Navbar
        isAdmin={false}
        settings={settings}
        pendingOrdersCount={0}
        onToggleStoreOpen={() => {}}
        onLockAdmin={() => {}}
      />

      {/* Customer Storefront */}
      <main className="flex-1">
        <CustomerStorefront
          products={products}
          settings={settings}
          deliveryAreas={deliveryAreas}
        />
      </main>

      {/* Clean Customer Footer - NO admin buttons at all */}
      <footer className="bg-neutral-900 text-neutral-400 py-8 text-xs border-t border-neutral-800 print:hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {settings.logoUrl && (
              <img src={settings.logoUrl} alt={settings.storeName} className="w-6 h-6 rounded-lg object-cover" />
            )}
            <p
              onDoubleClick={() => navigateTo('/control-panel')}
              className="select-none cursor-default"
              title=""
            >
              © {new Date().getFullYear()} {settings.storeName} • Todos os direitos reservados
            </p>
          </div>

          <div className="flex items-center gap-4 text-neutral-500 text-[11px]">
            <span>Beba com moderação</span>
            <span>•</span>
            <span>Proibida venda para menores de 18 anos</span>
            <span>•</span>
            <span>{settings.openingHours}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
