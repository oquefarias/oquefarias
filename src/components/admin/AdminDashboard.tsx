import React, { useState, useMemo, useEffect } from 'react';
import { Product, Order, StoreSettings, OrderStatus, ProductCategory, PaymentMethod, DeliveryArea, CustomerProfile } from '../../types';
import { api } from '../../services/api';
import { soundService } from '../../utils/sound';
import { PrintReceiptModal } from '../PrintReceiptModal';
import { QRCodeModal } from '../QRCodeModal';
import { GoogleDeliveryRadiusMap } from './GoogleDeliveryRadiusMap';
import { CustomerModal } from './CustomerModal';
import { calculateDistanceKm } from '../../utils/geo';
import {
  Bell,
  Package,
  ShoppingCart,
  BarChart3,
  Settings as SettingsIcon,
  Search,
  Plus,
  Printer,
  MessageCircle,
  CheckCircle2,
  QrCode,
  DollarSign,
  TrendingUp,
  Truck,
  RotateCcw,
  Edit2,
  Trash2,
  MapPin,
  Users,
  Lock,
  X,
  Eye,
  EyeOff,
  Upload,
  Camera,
  Image as ImageIcon,
  Copy,
  Compass,
  AlertTriangle,
} from 'lucide-react';

// Compress image uploaded from computer so it stays lightweight and fast
function compressImageFile(file: File, maxDim: number = 600, quality: number = 0.88): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const rawUrl = e.target?.result as string;
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } else {
          resolve(rawUrl);
        }
      };
      img.src = rawUrl;
    };
    reader.readAsDataURL(file);
  });
}

interface AdminDashboardProps {
  products: Product[];
  orders: Order[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  customers: CustomerProfile[];
  onLockDashboard: () => void;
  onPreviewCustomerView: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  products,
  orders,
  settings,
  deliveryAreas,
  customers,
  onLockDashboard,
  onPreviewCustomerView,
}) => {
  const [activeTab, setActiveTab] = useState<'pedidos' | 'estoque' | 'pdv' | 'areas' | 'clientes' | 'financeiro' | 'configuracoes'>('pedidos');
  
  // Orders filter
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatus | 'todos'>('todos');
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<Order | null>(null);
  const [isQRCodeModalOpen, setIsQRCodeModalOpen] = useState<boolean>(false);

  // Stock state
  const [stockSearch, setStockSearch] = useState<string>('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState<ProductCategory | 'todas'>('todas');
  const [onlyLowStock, setOnlyLowStock] = useState<boolean>(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Delivery Areas state
  const [isAreaModalOpen, setIsAreaModalOpen] = useState<boolean>(false);
  const [editingArea, setEditingArea] = useState<DeliveryArea | null>(null);
  const [areaForm, setAreaForm] = useState<{ id: string; name: string; fee: number; estimatedTime: string; active: boolean }>({
    id: '',
    name: '',
    fee: 5.00,
    estimatedTime: '30 a 45 min',
    active: true,
  });

  // Customers state
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerProfile | null>(null);
  const [customerSearch, setCustomerSearch] = useState<string>('');

  // PDV Counter State
  const [posSearch, setPosSearch] = useState<string>('');
  const [posCategory, setPosCategory] = useState<ProductCategory | 'todas'>('todas');
  const [posCart, setPosCart] = useState<Array<{ product: Product; quantity: number }>>([]);
  const [posCustomerName, setPosCustomerName] = useState<string>('Cliente Balcão');
  const [posPaymentMethod, setPosPaymentMethod] = useState<PaymentMethod>('dinheiro');
  const [posCashGiven, setPosCashGiven] = useState<string>('');

  const [settingsForm, setSettingsForm] = useState<StoreSettings>({ ...settings });
  const [settingsSavedMessage, setSettingsSavedMessage] = useState<boolean>(false);
  const [showPin, setShowPin] = useState<boolean>(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState<boolean>(false);
  const [isUploadingProductPhoto, setIsUploadingProductPhoto] = useState<boolean>(false);

  // Local optimistic state for instant order status changes without requiring page reload
  const [localOrders, setLocalOrders] = useState<Order[]>(orders);

  useEffect(() => {
    setLocalOrders(orders);
  }, [orders]);

  // Sub-tab for Delivery Areas (Map vs Neighborhoods)
  const [areaSubTab, setAreaSubTab] = useState<'mapa' | 'bairros'>('mapa');

  // Upload logo from computer
  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecione um arquivo de imagem (PNG, JPG, JPEG, WEBP).');
      return;
    }
    setIsUploadingLogo(true);
    try {
      const compressed = await compressImageFile(file, 400, 0.9);
      setSettingsForm(prev => ({ ...prev, logoUrl: compressed }));
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      alert('Erro ao carregar a foto do computador. Tente outro arquivo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  // Upload product photo from computer
  const handleProductPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecione um arquivo de imagem.');
      return;
    }
    setIsUploadingProductPhoto(true);
    try {
      const compressed = await compressImageFile(file, 600, 0.88);
      setProductForm(prev => ({ ...prev, image: compressed }));
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      alert('Erro ao carregar a foto do produto.');
    } finally {
      setIsUploadingProductPhoto(false);
    }
  };

  // Product form state
  const [productForm, setProductForm] = useState<{
    id: string;
    name: string;
    category: ProductCategory;
    volume: string;
    price: number;
    costPrice: number;
    stock: number;
    minStock: number;
    isCold: boolean;
    image: string;
    sku: string;
    description: string;
  }>({
    id: '',
    name: '',
    category: 'cervejas',
    volume: 'Lata 350ml',
    price: 0,
    costPrice: 0,
    stock: 0,
    minStock: 12,
    isCold: true,
    image: '',
    sku: '',
    description: '',
  });

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  // Pending orders count (uses localOrders for instant real-time sync)
  const pendingOrders = useMemo(() => {
    return localOrders.filter(o => o.status === 'pendente');
  }, [localOrders]);

  // Low stock products count
  const lowStockProducts = useMemo(() => {
    return products.filter(p => p.stock <= p.minStock);
  }, [products]);

  // Filtered orders list (instant UI responsiveness without F5)
  const filteredOrders = useMemo(() => {
    if (orderStatusFilter === 'todos') return localOrders;
    return localOrders.filter(o => o.status === orderStatusFilter);
  }, [localOrders, orderStatusFilter]);

  // Filtered stock list
  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      if (stockCategoryFilter !== 'todas' && p.category !== stockCategoryFilter) return false;
      if (onlyLowStock && p.stock > p.minStock) return false;
      if (stockSearch.trim()) {
        const q = stockSearch.toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.volume.toLowerCase().includes(q);
      }
      return true;
    });
  }, [products, stockCategoryFilter, onlyLowStock, stockSearch]);

  // Order status actions - Instant optimistic update without requiring page reload
  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus) => {
    // 1. Instant local update
    setLocalOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: newStatus, updatedAt: new Date().toISOString() } : o));
    soundService.playSuccessSound();
    // 2. Persist to API and Supabase
    await api.updateOrderStatus(orderId, newStatus);
  };

  // Stock quick adjust
  const handleAdjustStock = async (productId: string, delta: number) => {
    await api.adjustStock(productId, delta);
  };

  // Delivery Area handlers
  const handleOpenNewArea = () => {
    setEditingArea(null);
    setAreaForm({
      id: `area-${Date.now()}`,
      name: '',
      fee: 6.00,
      estimatedTime: '30 a 45 min',
      active: true,
    });
    setIsAreaModalOpen(true);
  };

  const handleOpenEditArea = (area: DeliveryArea) => {
    setEditingArea(area);
    setAreaForm({ ...area });
    setIsAreaModalOpen(true);
  };

  const handleSaveArea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!areaForm.name.trim()) return;
    await api.saveDeliveryArea(areaForm);
    setIsAreaModalOpen(false);
  };

  const handleDeleteArea = async (id: string) => {
    if (confirm('Tem certeza que deseja remover este bairro da sua área de entrega?')) {
      await api.deleteDeliveryArea(id);
    }
  };

  // Product modal handlers
  const handleOpenNewProduct = () => {
    setEditingProduct(null);
    setProductForm({
      id: `prod-${Date.now()}`,
      name: '',
      category: 'cervejas',
      volume: 'Lata 350ml',
      price: 5.00,
      costPrice: 3.50,
      stock: 24,
      minStock: 12,
      isCold: true,
      image: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=500&auto=format&fit=crop&q=80',
      sku: `BEB-${Math.floor(100 + Math.random() * 900)}`,
      description: '',
    });
    setIsProductModalOpen(true);
  };

  const handleOpenEditProduct = (p: Product) => {
    setEditingProduct(p);
    setProductForm({
      id: p.id,
      name: p.name,
      category: p.category,
      volume: p.volume,
      price: p.price,
      costPrice: p.costPrice,
      stock: p.stock,
      minStock: p.minStock,
      isCold: p.isCold,
      image: p.image,
      sku: p.sku,
      description: p.description,
    });
    setIsProductModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const productToSave: Product = {
      ...productForm,
      active: true,
    };
    await api.saveProduct(productToSave);
    setIsProductModalOpen(false);
  };

  const handleDeleteProduct = async (id: string) => {
    if (confirm('Tem certeza que deseja remover este produto?')) {
      await api.deleteProduct(id);
    }
  };

  // PDV Actions
  const addToPosCart = (product: Product) => {
    setPosCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map(item => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromPosCart = (productId: string) => {
    setPosCart(prev => {
      const existing = prev.find(item => item.product.id === productId);
      if (!existing) return prev;
      if (existing.quantity <= 1) return prev.filter(item => item.product.id !== productId);
      return prev.map(item => item.product.id === productId ? { ...item, quantity: item.quantity - 1 } : item);
    });
  };

  const posSubtotal = useMemo(() => {
    return posCart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }, [posCart]);

  const handleFinishPosSale = async () => {
    if (posCart.length === 0) return;
    const cashNum = parseFloat(posCashGiven);
    const order = await api.createOrder({
      source: 'balcao',
      customer: {
        name: posCustomerName.trim() || 'Cliente Balcão',
        phone: '(Balcão)',
        address: 'Venda Presencial no Depósito',
        number: 'Balcão',
        neighborhood: 'Loja Física',
      },
      deliveryType: 'retirada',
      items: posCart.map(i => ({
        productId: i.product.id,
        name: i.product.name,
        volume: i.product.volume,
        price: i.product.price,
        costPrice: i.product.costPrice,
        quantity: i.quantity,
        isCold: i.product.isCold,
      })),
      subtotal: posSubtotal,
      deliveryFee: 0,
      total: posSubtotal,
      paymentMethod: posPaymentMethod,
      cashChangeFor: posPaymentMethod === 'dinheiro' && cashNum ? cashNum : undefined,
    });

    await api.updateOrderStatus(order.id, 'concluido');
    setSelectedReceiptOrder(order);

    setPosCart([]);
    setPosCashGiven('');
    setPosCustomerName('Cliente Balcão');
  };

  // Financial Stats Calculation
  const financialStats = useMemo(() => {
    const today = new Date().toDateString();
    const todayOrders = localOrders.filter(o => new Date(o.createdAt).toDateString() === today && o.status !== 'cancelado');
    const totalRevenueToday = todayOrders.reduce((sum, o) => sum + o.total, 0);
    
    let totalCostToday = 0;
    todayOrders.forEach(o => {
      o.items.forEach(it => {
        const cost = it.costPrice || it.price * 0.65;
        totalCostToday += cost * it.quantity;
      });
    });

    const netProfitToday = Math.max(0, totalRevenueToday - totalCostToday);
    const avgTicket = todayOrders.length > 0 ? totalRevenueToday / todayOrders.length : 0;
    const onlineOrdersCount = todayOrders.filter(o => o.source === 'online').length;
    const posOrdersCount = todayOrders.filter(o => o.source === 'balcao').length;

    const paymentBreakdown = {
      pix: todayOrders.filter(o => o.paymentMethod === 'pix').reduce((s, o) => s + o.total, 0),
      cartao_credito: todayOrders.filter(o => o.paymentMethod === 'cartao_credito').reduce((s, o) => s + o.total, 0),
      cartao_debito: todayOrders.filter(o => o.paymentMethod === 'cartao_debito').reduce((s, o) => s + o.total, 0),
      dinheiro: todayOrders.filter(o => o.paymentMethod === 'dinheiro').reduce((s, o) => s + o.total, 0),
    };

    const totalStockValue = products.reduce((sum, p) => sum + p.price * p.stock, 0);

    return {
      todayOrdersCount: todayOrders.length,
      totalRevenueToday,
      netProfitToday,
      avgTicket,
      onlineOrdersCount,
      posOrdersCount,
      paymentBreakdown,
      totalStockValue,
    };
  }, [localOrders, products]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.updateSettings(settingsForm);
    setSettingsSavedMessage(true);
    setTimeout(() => setSettingsSavedMessage(false), 3000);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-20">
      {/* Pending orders alert banner */}
      {pendingOrders.length > 0 && (
        <div className="mb-6 p-4 bg-amber-500 text-neutral-950 rounded-2xl shadow-lg border border-amber-600 flex flex-col sm:flex-row items-center justify-between gap-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-neutral-950 text-amber-400 flex items-center justify-center font-black text-lg">
              {pendingOrders.length}
            </div>
            <div>
              <h4 className="font-black text-base uppercase tracking-tight">
                🔔 {pendingOrders.length === 1 ? 'Novo Pedido Aguardando Separação!' : `${pendingOrders.length} Novos Pedidos Aguardando Separação!`}
              </h4>
              <p className="text-xs font-semibold text-neutral-900">
                Chegou pedido novo do site. Confira os itens e envie para a entrega!
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveTab('pedidos');
                setOrderStatusFilter('pendente');
              }}
              className="px-4 py-2 bg-neutral-950 hover:bg-neutral-900 text-white font-bold rounded-xl text-xs transition-colors"
            >
              Ver Pedidos
            </button>
            <button
              onClick={() => soundService.playNewOrderSound()}
              className="px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-xs transition-colors"
              title="Testar campainha"
            >
              🔔 Tocar Som
            </button>
          </div>
        </div>
      )}

      {/* Owner System Navigation Bar */}
      <div className="bg-white p-2 rounded-2xl border border-neutral-200 shadow-xs mb-6 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            onClick={() => setActiveTab('pedidos')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'pedidos' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Bell className="w-4 h-4" />
            <span>Pedidos</span>
            {pendingOrders.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                {pendingOrders.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('estoque')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'estoque' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Package className="w-4 h-4" />
            <span>Estoque</span>
            {lowStockProducts.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold flex items-center justify-center">
                {lowStockProducts.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('pdv')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'pdv' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>PDV Balcão</span>
          </button>

          {/* Áreas de Entrega Tab */}
          <button
            onClick={() => setActiveTab('areas')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'areas' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>Áreas de Entrega</span>
            <span className="w-5 h-5 rounded-full bg-neutral-100 text-neutral-600 text-[10px] font-bold flex items-center justify-center">
              {deliveryAreas.length}
            </span>
          </button>

          {/* Clientes Cadastrados Tab */}
          <button
            onClick={() => setActiveTab('clientes')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'clientes' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>Clientes ({customers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('financeiro')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'financeiro' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Caixa & Relatórios</span>
          </button>

          <button
            onClick={() => setActiveTab('configuracoes')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'configuracoes' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <SettingsIcon className="w-4 h-4" />
            <span>Configurações</span>
          </button>
        </div>

        {/* Security & Preview controls */}
        <div className="flex items-center gap-2 px-2">
          <button
            onClick={() => setIsQRCodeModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold transition-colors"
          >
            <QrCode className="w-4 h-4 text-amber-400" />
            <span>QR Code</span>
          </button>

          <button
            onClick={onPreviewCustomerView}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl text-xs font-bold transition-colors"
            title="Ver o site como o cliente vê"
          >
            <span>👁️ Visualizar Loja</span>
          </button>

          <button
            onClick={onLockDashboard}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-colors"
            title="Bloquear o painel"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Bloquear Painel</span>
          </button>
        </div>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: PEDIDOS                                            */}
      {/* ========================================================= */}
      {activeTab === 'pedidos' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {[
                { id: 'todos', label: 'Todos os Pedidos', count: localOrders.length },
                { id: 'pendente', label: 'Novos / Pendentes', count: localOrders.filter(o => o.status === 'pendente').length },
                { id: 'em_separacao', label: 'Em Separação', count: localOrders.filter(o => o.status === 'em_separacao').length },
                { id: 'em_rota', label: 'Em Rota / Despachados', count: localOrders.filter(o => o.status === 'em_rota').length },
                { id: 'concluido', label: 'Concluídos', count: localOrders.filter(o => o.status === 'concluido').length },
                { id: 'cancelado', label: 'Cancelados', count: localOrders.filter(o => o.status === 'cancelado').length },
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => setOrderStatusFilter(item.id as OrderStatus | 'todos')}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors whitespace-nowrap ${
                    orderStatusFilter === item.id
                      ? 'bg-neutral-900 text-white'
                      : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-md ${
                    orderStatusFilter === item.id ? 'bg-amber-500 text-neutral-950 font-black' : 'bg-neutral-200 text-neutral-700'
                  }`}>
                    {item.count}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Monitoramento em tempo real ativo</span>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-16 text-center bg-white rounded-3xl border border-dashed border-neutral-300">
              <Package className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
              <h3 className="font-bold text-base text-neutral-800">Nenhum pedido neste status</h3>
              <p className="text-xs text-neutral-500 mt-1">Os pedidos dos clientes aparecerão aqui assim que forem feitos.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredOrders.map(order => {
                const isPending = order.status === 'pendente';
                const isSeparating = order.status === 'em_separacao';
                const isEnRoute = order.status === 'em_rota';
                const isCompleted = order.status === 'concluido';
                const isCanceled = order.status === 'cancelado';

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-3xl border transition-all p-5 shadow-xs flex flex-col justify-between ${
                      isPending ? 'border-amber-400 ring-2 ring-amber-400/30' : 'border-neutral-300'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between border-b border-neutral-100 pb-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-base text-neutral-900">#{order.id}</span>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                              order.source === 'online'
                                ? 'bg-sky-100 text-sky-800 border border-sky-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {order.source === 'online' ? '📱 Site Online' : '🏪 Venda Balcão'}
                            </span>
                            <span className="text-xs text-neutral-400 font-medium">{formatDate(order.createdAt)}</span>
                          </div>

                          <div className="mt-1 flex items-center gap-2 text-xs">
                            <span className="font-bold text-neutral-800">{order.customer.name}</span>
                            <span className="text-neutral-400">•</span>
                            <span className="text-neutral-600">{order.customer.phone}</span>
                          </div>
                        </div>

                        <span className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase ${
                          isPending ? 'bg-amber-100 text-amber-900 animate-pulse' :
                          isSeparating ? 'bg-blue-100 text-blue-900' :
                          isEnRoute ? 'bg-purple-100 text-purple-900' :
                          isCompleted ? 'bg-emerald-100 text-emerald-800' :
                          'bg-neutral-100 text-neutral-600'
                        }`}>
                          {isPending && 'Pendente / Novo'}
                          {isSeparating && 'Em Separação'}
                          {isEnRoute && (order.deliveryType === 'delivery' ? 'Em Rota' : 'Pronto Retirada')}
                          {isCompleted && 'Concluído'}
                          {isCanceled && 'Cancelado'}
                        </span>
                      </div>

                      <div className="bg-neutral-50 p-3 rounded-2xl text-xs mb-3 space-y-0.5 border border-neutral-100">
                        <div className="flex items-center gap-1.5 font-bold text-neutral-900">
                          {order.deliveryType === 'delivery' ? (
                            <>
                              <Truck className="w-3.5 h-3.5 text-amber-600" />
                              <span>Entrega: {order.customer.address}, {order.customer.number} - <strong>{order.customer.neighborhood}</strong></span>
                            </>
                          ) : (
                            <>
                              <Package className="w-3.5 h-3.5 text-amber-600" />
                              <span>Retirada Presencial no Depósito</span>
                            </>
                          )}
                        </div>
                        {order.customer.reference && (
                          <p className="text-neutral-600 italic">Ponto de Ref: {order.customer.reference}</p>
                        )}
                        {order.notes && (
                          <p className="text-amber-800 font-semibold bg-amber-50 p-1 rounded">Obs: {order.notes}</p>
                        )}
                      </div>

                      <div className="space-y-1.5 mb-4 text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                          Itens do Pedido ({order.items.reduce((s, i) => s + i.quantity, 0)} un):
                        </span>
                        {order.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between items-center py-1 border-b border-neutral-100 last:border-0">
                            <div>
                              <span className="font-black text-amber-600 text-sm">{it.quantity}x </span>
                              <span className="font-bold text-neutral-800">{it.name}</span>
                              <span className="text-neutral-500 text-[11px] ml-1">
                                ({it.volume}) {it.isCold ? '• Gelada ❄️' : ''}
                              </span>
                            </div>
                            <span className="font-bold text-neutral-900">{formatCurrency(it.price * it.quantity)}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between p-3 bg-neutral-100 rounded-2xl text-xs mb-4">
                        <div>
                          <span className="text-neutral-500 block">Pagamento:</span>
                          <span className="font-bold text-neutral-900 uppercase">
                            {order.paymentMethod === 'pix' && '⚡ PIX'}
                            {order.paymentMethod === 'cartao_credito' && '💳 Cartão de Crédito'}
                            {order.paymentMethod === 'cartao_debito' && '💳 Cartão de Débito'}
                            {order.paymentMethod === 'dinheiro' && `💵 Dinheiro ${order.cashChangeFor ? `(Troco p/ ${formatCurrency(order.cashChangeFor)})` : ''}`}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-neutral-500 block">Total a Cobrar:</span>
                          <span className="text-base font-black text-amber-600">{formatCurrency(order.total)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setSelectedReceiptOrder(order)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5 text-neutral-600" />
                          <span>Imprimir Comanda</span>
                        </button>

                        <a
                          href={`https://wa.me/${order.customer.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                            `Olá ${order.customer.name}! Recebemos seu pedido #${order.id} no ${settings.storeName}.`
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold transition-colors"
                        >
                          <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                          <span>WhatsApp</span>
                        </a>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {isPending && (
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'em_separacao')}
                            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                          >
                            Iniciar Separação
                          </button>
                        )}
                        {isSeparating && (
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'em_rota')}
                            className="px-3.5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                          >
                            Despachar Motoboy
                          </button>
                        )}
                        {isEnRoute && (
                          <button
                            onClick={() => handleUpdateStatus(order.id, 'concluido')}
                            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
                          >
                            Marcar Entregue
                          </button>
                        )}
                        {!isCompleted && !isCanceled && (
                          <button
                            onClick={() => {
                              if (confirm('Deseja realmente cancelar este pedido?')) {
                                handleUpdateStatus(order.id, 'cancelado');
                              }
                            }}
                            className="p-2 text-neutral-400 hover:text-red-600 rounded-xl hover:bg-red-50 text-xs transition-colors"
                            title="Cancelar pedido"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: ÁREAS DE ENTREGA & BAIRROS ATENDIDOS                */}
      {/* ========================================================= */}
      {activeTab === 'areas' && (
        <div className="space-y-6">
          {/* Sub-tab Navigation */}
          <div className="flex flex-wrap items-center gap-2 p-1.5 bg-neutral-100 rounded-2xl w-fit">
            <button
              type="button"
              onClick={() => setAreaSubTab('mapa')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all ${
                areaSubTab === 'mapa'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <Compass className="w-4 h-4 text-amber-500" />
              <span>🗺️ Raio no Mapa (km)</span>
            </button>
            <button
              type="button"
              onClick={() => setAreaSubTab('bairros')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all ${
                areaSubTab === 'bairros'
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              <MapPin className="w-4 h-4 text-amber-500" />
              <span>📋 Bairros Cadastrados ({deliveryAreas.length})</span>
            </button>
          </div>

          {areaSubTab === 'mapa' ? (
            <GoogleDeliveryRadiusMap
              settings={settings}
              onSave={async (updated) => {
                await api.updateSettings(updated);
              }}
            />
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-5 rounded-3xl border border-neutral-200">
                <div>
                  <h3 className="font-black text-lg text-neutral-900 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-amber-500" />
                    <span>Bairros e Regiões de Entrega Permitidas</span>
                  </h3>
                  <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
                    Cadastre aqui bairros específicos atendidos pelo seu depósito com taxas individuais por bairro.
                  </p>
                </div>

                <button
                  onClick={handleOpenNewArea}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-xs transition-colors shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  <span>Cadastrar Novo Bairro</span>
                </button>
              </div>

              {deliveryAreas.length === 0 ? (
                <div className="bg-white rounded-3xl p-12 text-center border border-dashed border-neutral-300">
                  <MapPin className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
                  <h4 className="font-bold text-base text-neutral-800">Nenhum bairro individual cadastrado</h4>
                  <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                    Você pode usar o <strong>Raio no Mapa (km)</strong> acima para atender automaticamente qualquer cliente dentro da sua distância, ou cadastrar bairros pontuais aqui.
                  </p>
                  <button
                    onClick={handleOpenNewArea}
                    className="mt-4 inline-flex items-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs transition-colors shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Cadastrar Bairro Específico</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {deliveryAreas.map(area => (
                    <div
                      key={area.id}
                      className={`bg-white rounded-3xl border p-5 transition-all shadow-xs flex flex-col justify-between ${
                        area.active ? 'border-neutral-200' : 'border-neutral-200 bg-neutral-50 opacity-60'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Bairro / Região</span>
                            <h4 className="text-base font-black text-neutral-900">{area.name}</h4>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            area.active ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-600'
                          }`}>
                            {area.active ? 'Ativo' : 'Pausado'}
                          </span>
                        </div>

                        <div className="mt-4 pt-3 border-t border-neutral-100 space-y-2 text-xs">
                          <div className="flex justify-between items-center">
                            <span className="text-neutral-500">Taxa de Entrega:</span>
                            <span className="font-black text-sm text-neutral-900">{formatCurrency(area.fee)}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-neutral-500">Tempo Estimado:</span>
                            <span className="font-semibold text-neutral-700">{area.estimatedTime}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleOpenEditArea(area)}
                          className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg text-xs font-semibold flex items-center gap-1"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          <span>Editar</span>
                        </button>
                        <button
                          onClick={() => handleDeleteArea(area.id)}
                          className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg text-xs"
                          title="Excluir bairro"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: CLIENTES CADASTRADOS                                 */}
      {/* ========================================================= */}
      {activeTab === 'clientes' && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-3xl border border-neutral-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-black text-lg text-neutral-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-amber-500" />
                <span>Base de Clientes Cadastrados</span>
              </h3>
              <p className="text-xs text-neutral-500 mt-1">
                Cadastre clientes diretamente pelo <strong>CEP</strong> para preencher o endereço automático e verificar se o cliente está dentro do raio de entrega de <strong>{settings.deliveryRadiusKm || 5} km</strong>.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <span className="text-[11px] text-neutral-400 block font-medium">Total de Clientes</span>
                <span className="text-xl font-black text-neutral-900">{customers.length}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  setEditingCustomer(null);
                  setIsCustomerModalOpen(true);
                }}
                className="px-5 py-3 bg-amber-500 hover:bg-amber-600 text-neutral-950 rounded-2xl font-black text-xs shadow-sm transition-all flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Cadastrar Cliente por CEP</span>
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative w-full sm:max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input
                type="text"
                placeholder="Buscar cliente por nome, telefone, bairro ou CEP..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-neutral-200 rounded-2xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
              />
              {customerSearch && (
                <button
                  type="button"
                  onClick={() => setCustomerSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 text-xs font-bold"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <span className="text-xs text-neutral-500 font-medium hidden sm:inline">
              Raio de entrega da loja: <strong>{settings.deliveryRadiusKm || 5} km</strong>
            </span>
          </div>

          <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-neutral-700">
                <thead className="bg-neutral-50 border-b border-neutral-200 font-bold uppercase tracking-wider text-neutral-500">
                  <tr>
                    <th className="py-3 px-4">Nome do Cliente</th>
                    <th className="py-3 px-4">WhatsApp / Telefone</th>
                    <th className="py-3 px-4">Endereço Principal</th>
                    <th className="py-3 px-4">CEP & Bairro</th>
                    <th className="py-3 px-4 text-center">Raio de Entrega</th>
                    <th className="py-3 px-4 text-center">Pedidos</th>
                    <th className="py-3 px-4 text-right">Total Gasto</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {(() => {
                    const filtered = customers.filter((c) => {
                      if (!customerSearch.trim()) return true;
                      const q = customerSearch.toLowerCase();
                      return (
                        c.name.toLowerCase().includes(q) ||
                        c.phone.includes(q) ||
                        (c.address && c.address.toLowerCase().includes(q)) ||
                        (c.neighborhood && c.neighborhood.toLowerCase().includes(q)) ||
                        (c.cep && c.cep.includes(q)) ||
                        (c.city && c.city.toLowerCase().includes(q))
                      );
                    });

                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-neutral-400">
                            <Users className="w-10 h-10 mx-auto mb-2 text-neutral-300" />
                            <p className="font-bold text-neutral-700 text-sm">
                              {customerSearch ? 'Nenhum cliente encontrado na busca' : 'Nenhum cliente cadastrado ainda'}
                            </p>
                            <p className="text-xs text-neutral-400 mt-1 max-w-md mx-auto">
                              Clique no botão <strong>"Cadastrar Cliente por CEP"</strong> acima para cadastrar seu primeiro cliente ou aguarde os pedidos automáticos pelo site.
                            </p>
                          </td>
                        </tr>
                      );
                    }

                    return filtered.map((c) => {
                      // Calculate or retrieve delivery radius status
                      let dist = c.distanceKm;
                      let inside = c.isWithinDeliveryRadius;

                      if (dist === undefined && c.latitude && c.longitude && settings.storeLatitude && settings.storeLongitude) {
                        dist = calculateDistanceKm(
                          settings.storeLatitude,
                          settings.storeLongitude,
                          c.latitude,
                          c.longitude
                        );
                        inside = dist <= (settings.deliveryRadiusKm || 5);
                      }

                      return (
                        <tr key={c.id} className="hover:bg-neutral-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-neutral-900 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-800 font-black flex items-center justify-center text-xs shrink-0">
                                {c.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <span className="block font-bold">{c.name}</span>
                                {c.city && (
                                  <span className="text-[10px] text-neutral-400 font-normal">
                                    {c.city}{c.state ? ` - ${c.state}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 font-mono font-medium text-neutral-700">
                            {c.phone}
                          </td>

                          <td className="py-3.5 px-4">
                            <span className="font-medium text-neutral-800">{c.address}, {c.number}</span>
                            {c.complement && (
                              <span className="block text-[11px] text-neutral-500">{c.complement}</span>
                            )}
                            {c.reference && (
                              <span className="block text-[10px] text-neutral-400 italic">Ref: {c.reference}</span>
                            )}
                          </td>

                          <td className="py-3.5 px-4">
                            <div className="space-y-0.5">
                              {c.cep && (
                                <span className="inline-block px-1.5 py-0.5 bg-neutral-100 border border-neutral-200 rounded font-mono text-[10px] font-bold text-neutral-700">
                                  CEP {c.cep}
                                </span>
                              )}
                              <span className="block font-semibold text-neutral-800">{c.neighborhood}</span>
                            </div>
                          </td>

                          {/* RAIO DE ENTREGA */}
                          <td className="py-3.5 px-4 text-center">
                            {dist !== undefined ? (
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-black border ${
                                  inside
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                    : 'bg-red-50 text-red-800 border-red-300'
                                }`}
                              >
                                {inside ? (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>No raio ({dist} km)</span>
                                  </>
                                ) : (
                                  <>
                                    <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                                    <span>Fora ({dist} km)</span>
                                  </>
                                )}
                              </span>
                            ) : (
                              <span className="text-[11px] text-neutral-400 italic">
                                CEP sem GPS
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-center font-black">
                            {c.totalOrdersCount || 0}
                          </td>

                          <td className="py-3.5 px-4 text-right font-mono font-bold text-emerald-700">
                            {formatCurrency(c.totalSpent || 0)}
                          </td>

                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Edit Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCustomer(c);
                                  setIsCustomerModalOpen(true);
                                }}
                                title="Editar Cliente / Conferir CEP"
                                className="p-1.5 text-neutral-600 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>

                              {/* WhatsApp Contact */}
                              <a
                                href={`https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(
                                  `Olá ${c.name}! Tudo bem? Falamos do ${settings.storeName}.`
                                )}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Conversar no WhatsApp"
                                className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors inline-flex items-center justify-center"
                              >
                                <MessageCircle className="w-4 h-4" />
                              </a>

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={async () => {
                                  if (confirm(`Deseja realmente excluir o cadastro de ${c.name}?`)) {
                                    await api.deleteCustomer(c.id);
                                  }
                                }}
                                title="Excluir Cliente"
                                className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: ESTOQUE                                              */}
      {/* ========================================================= */}
      {activeTab === 'estoque' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Itens em Estoque</span>
              <p className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">
                {products.reduce((s, p) => s + p.stock, 0)} <span className="text-xs font-normal text-neutral-500">un</span>
              </p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Produtos Cadastrados</span>
              <p className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">{products.length}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Estoque Baixo</span>
              <p className={`text-xl sm:text-2xl font-black mt-1 ${lowStockProducts.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {lowStockProducts.length}
              </p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Valor em Estoque</span>
              <p className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">
                {formatCurrency(financialStats.totalStockValue)}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2 w-full sm:max-w-md">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Buscar produto ou SKU..."
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <button
                onClick={() => setOnlyLowStock(!onlyLowStock)}
                className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap ${
                  onlyLowStock
                    ? 'bg-amber-500 text-white border-amber-600'
                    : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                }`}
              >
                ⚠️ Baixo Estoque
              </button>
            </div>

            <button
              onClick={handleOpenNewProduct}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Produto</span>
            </button>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
            {[
              { id: 'todas', label: 'Todas as Categorias' },
              { id: 'cervejas', label: 'Cervejas' },
              { id: 'destilados', label: 'Destilados' },
              { id: 'nao_alcoolicos', label: 'Não Alcoólicos' },
              { id: 'vinhos', label: 'Vinhos' },
              { id: 'gelo_carvao', label: 'Gelo & Carvão' },
              { id: 'petiscos', label: 'Petiscos' },
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setStockCategoryFilter(cat.id as ProductCategory | 'todas')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${
                  stockCategoryFilter === cat.id ? 'bg-neutral-900 text-white' : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-neutral-700">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-bold uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Produto</th>
                    <th className="py-3 px-4">Categoria / SKU</th>
                    <th className="py-3 px-4">Custo</th>
                    <th className="py-3 px-4">Venda</th>
                    <th className="py-3 px-4">Margem</th>
                    <th className="py-3 px-4">Estoque Atual</th>
                    <th className="py-3 px-4 text-center">Ajuste Rápido</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredProducts.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-neutral-400">
                        <Package className="w-10 h-10 mx-auto mb-2 text-neutral-300" />
                        <p className="font-bold text-neutral-700 text-sm">Nenhum produto cadastrado no estoque</p>
                        <p className="text-xs text-neutral-400 mt-1">Clique no botão "+ Novo Produto" acima para cadastrar suas bebidas e definir estoque.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredProducts.map(p => {
                    const isLow = p.stock <= p.minStock;
                    const margin = p.price > 0 ? ((p.price - p.costPrice) / p.price) * 100 : 0;

                    return (
                      <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <img
                              src={p.image}
                              alt={p.name}
                              className="w-10 h-10 rounded-xl object-cover border border-neutral-200 shrink-0"
                            />
                            <div>
                              <div className="font-bold text-neutral-900 text-sm">{p.name}</div>
                              <div className="text-[11px] text-neutral-500">
                                {p.volume} {p.isCold ? '• Gelada ❄️' : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-neutral-800 capitalize block">{p.category}</span>
                          <span className="text-[10px] font-mono text-neutral-400">{p.sku}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-neutral-600">{formatCurrency(p.costPrice)}</td>
                        <td className="py-3 px-4 font-mono font-bold text-neutral-900">{formatCurrency(p.price)}</td>
                        <td className="py-3 px-4">
                          <span className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                            margin >= 30 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {margin.toFixed(0)}%
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className={`font-black text-sm ${isLow ? 'text-red-600' : 'text-neutral-900'}`}>
                              {p.stock} un
                            </span>
                            {isLow && (
                              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                                Baixo (Min: {p.minStock})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => handleAdjustStock(p.id, -10)}
                              className="w-6 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-[10px]"
                            >
                              -10
                            </button>
                            <button
                              onClick={() => handleAdjustStock(p.id, -1)}
                              className="w-6 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-xs"
                            >
                              -1
                            </button>
                            <button
                              onClick={() => handleAdjustStock(p.id, 1)}
                              className="w-6 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-xs"
                            >
                              +1
                            </button>
                            <button
                              onClick={() => handleAdjustStock(p.id, 10)}
                              className="w-6 h-6 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold text-[10px]"
                            >
                              +10
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleOpenEditProduct(p)}
                              className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200 rounded-lg transition-colors"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteProduct(p.id)}
                              className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: PDV BALCÃO                                           */}
      {/* ========================================================= */}
      {activeTab === 'pdv' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  placeholder="Buscar bebida para adicionar no caixa..."
                  value={posSearch}
                  onChange={(e) => setPosSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <select
                value={posCategory}
                onChange={(e) => setPosCategory(e.target.value as ProductCategory | 'todas')}
                className="px-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs font-bold"
              >
                <option value="todas">Todas Categorias</option>
                <option value="cervejas">Cervejas</option>
                <option value="destilados">Destilados</option>
                <option value="nao_alcoolicos">Não Alcoólicos</option>
                <option value="vinhos">Vinhos</option>
                <option value="gelo_carvao">Gelo & Carvão</option>
                <option value="petiscos">Petiscos</option>
              </select>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-1">
              {products.length === 0 ? (
                <div className="col-span-2 sm:col-span-3 p-10 text-center bg-white rounded-2xl border border-dashed border-neutral-300">
                  <Package className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-neutral-700">Nenhum produto cadastrado no estoque</p>
                  <p className="text-xs text-neutral-400 mt-1">Cadastre seus produtos na aba "Estoque" para realizar vendas no balcão.</p>
                </div>
              ) : (
                products
                  .filter(p => {
                    if (posCategory !== 'todas' && p.category !== posCategory) return false;
                    if (posSearch.trim()) {
                      const q = posSearch.toLowerCase();
                      return p.name.toLowerCase().includes(q) || p.volume.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
                    }
                    return true;
                  })
                  .map(product => {
                    const inCart = posCart.find(i => i.product.id === product.id);
                    const isOutOfStock = product.stock <= 0;

                    return (
                      <button
                        key={product.id}
                        onClick={() => !isOutOfStock && addToPosCart(product)}
                        disabled={isOutOfStock}
                        className={`text-left p-3 rounded-2xl border transition-all flex flex-col justify-between ${
                          isOutOfStock
                            ? 'opacity-40 bg-neutral-100 border-neutral-200 cursor-not-allowed'
                            : inCart
                            ? 'border-amber-500 bg-amber-50/40 shadow-xs'
                            : 'bg-white border-neutral-200 hover:border-amber-400 hover:shadow-xs'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start gap-1">
                            <span className="text-[10px] font-bold text-neutral-400 uppercase">{product.volume}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-600">
                              Est: {product.stock}
                            </span>
                          </div>
                          <h4 className="font-bold text-xs text-neutral-900 mt-1 line-clamp-2">{product.name}</h4>
                        </div>

                        <div className="mt-3 pt-2 border-t border-neutral-100 flex items-center justify-between">
                          <span className="font-black text-sm text-neutral-900">{formatCurrency(product.price)}</span>
                          {inCart && (
                            <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-black text-xs flex items-center justify-center">
                              {inCart.quantity}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-neutral-200 p-5 shadow-xs flex flex-col justify-between h-fit">
            <div>
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-amber-500" />
                  <h3 className="font-black text-base text-neutral-900">Caixa Balcão</h3>
                </div>
                {posCart.length > 0 && (
                  <button onClick={() => setPosCart([])} className="text-xs text-neutral-400 hover:text-red-500 font-semibold">
                    Limpar
                  </button>
                )}
              </div>

              <div className="mb-4">
                <label className="text-[11px] font-bold text-neutral-600 block mb-1">Identificação do Cliente</label>
                <input
                  type="text"
                  value={posCustomerName}
                  onChange={(e) => setPosCustomerName(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs font-medium"
                />
              </div>

              <div className="space-y-2 mb-4 max-h-56 overflow-y-auto pr-1">
                {posCart.length === 0 ? (
                  <div className="text-center py-8 text-neutral-400 text-xs">
                    Nenhum produto adicionado.<br />Clique nos produtos ao lado para incluir no caixa.
                  </div>
                ) : (
                  posCart.map(item => (
                    <div key={item.product.id} className="flex items-center justify-between gap-2 p-2 bg-neutral-50 rounded-xl text-xs">
                      <div className="flex-1 truncate">
                        <div className="font-bold text-neutral-900 truncate">{item.product.name}</div>
                        <div className="text-[10px] text-neutral-500">{formatCurrency(item.product.price)} un</div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => removeFromPosCart(item.product.id)}
                          className="w-5 h-5 flex items-center justify-center bg-white rounded text-neutral-600 hover:bg-neutral-200 font-bold"
                        >
                          -
                        </button>
                        <span className="w-5 text-center font-black">{item.quantity}</span>
                        <button
                          onClick={() => addToPosCart(item.product)}
                          className="w-5 h-5 flex items-center justify-center bg-white rounded text-neutral-600 hover:bg-neutral-200 font-bold"
                        >
                          +
                        </button>
                      </div>

                      <span className="font-bold text-neutral-900 w-16 text-right">
                        {formatCurrency(item.product.price * item.quantity)}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2 mb-4">
                <label className="text-[11px] font-bold text-neutral-600 block">Forma de Pagamento</label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { id: 'dinheiro', label: '💵 Dinheiro' },
                    { id: 'pix', label: '⚡ PIX' },
                    { id: 'cartao_debito', label: '💳 Débito' },
                    { id: 'cartao_credito', label: '💳 Crédito' },
                  ].map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPosPaymentMethod(m.id as PaymentMethod)}
                      className={`p-2 rounded-xl border text-left font-bold transition-all ${
                        posPaymentMethod === m.id
                          ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>

                {posPaymentMethod === 'dinheiro' && posSubtotal > 0 && (
                  <div className="mt-2 bg-neutral-50 p-2.5 rounded-xl border border-neutral-200 space-y-1 text-xs">
                    <label className="text-[11px] font-bold text-neutral-700 block">Valor Recebido (Dinheiro):</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="Ex: 50.00"
                      value={posCashGiven}
                      onChange={(e) => setPosCashGiven(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-white border border-neutral-300 rounded-lg text-xs"
                    />
                    {parseFloat(posCashGiven) > posSubtotal && (
                      <p className="text-emerald-700 font-bold text-xs pt-1">
                        Troco a Devolver: {formatCurrency(parseFloat(posCashGiven) - posSubtotal)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-neutral-200 space-y-3">
              <div className="flex justify-between items-baseline">
                <span className="text-xs font-bold text-neutral-500">Total a Pagar:</span>
                <span className="text-2xl font-black text-amber-600">{formatCurrency(posSubtotal)}</span>
              </div>

              <button
                onClick={handleFinishPosSale}
                disabled={posCart.length === 0}
                className="w-full py-3.5 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 text-white font-black text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5 text-amber-400" />
                <span>Finalizar Venda & Imprimir</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: FINANCEIRO                                           */}
      {/* ========================================================= */}
      {activeTab === 'financeiro' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
              <div className="flex items-center justify-between text-neutral-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Faturamento Hoje</span>
                <DollarSign className="w-4 h-4 text-emerald-500" />
              </div>
              <h3 className="text-2xl font-black text-neutral-900">{formatCurrency(financialStats.totalRevenueToday)}</h3>
              <p className="text-[11px] text-neutral-500 mt-1">{financialStats.todayOrdersCount} vendas realizadas hoje</p>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
              <div className="flex items-center justify-between text-neutral-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Lucro Estimado</span>
                <TrendingUp className="w-4 h-4 text-amber-500" />
              </div>
              <h3 className="text-2xl font-black text-amber-600">{formatCurrency(financialStats.netProfitToday)}</h3>
              <p className="text-[11px] text-neutral-500 mt-1">
                Margem média: {financialStats.totalRevenueToday > 0 ? ((financialStats.netProfitToday / financialStats.totalRevenueToday) * 100).toFixed(0) : 0}%
              </p>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
              <div className="flex items-center justify-between text-neutral-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Ticket Médio</span>
                <BarChart3 className="w-4 h-4 text-sky-500" />
              </div>
              <h3 className="text-2xl font-black text-neutral-900">{formatCurrency(financialStats.avgTicket)}</h3>
              <p className="text-[11px] text-neutral-500 mt-1">Valor médio por cliente</p>
            </div>

            <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
              <div className="flex items-center justify-between text-neutral-500 mb-2">
                <span className="text-xs font-bold uppercase tracking-wider">Canais de Venda</span>
                <Truck className="w-4 h-4 text-purple-500" />
              </div>
              <div className="flex items-center justify-between text-sm font-bold text-neutral-800 mt-1">
                <span>📱 Online: {financialStats.onlineOrdersCount}</span>
                <span>🏪 Balcão: {financialStats.posOrdersCount}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs">
              <h4 className="font-bold text-sm text-neutral-900 mb-4">Entradas por Forma de Pagamento</h4>
              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between font-bold mb-1">
                    <span>⚡ PIX</span>
                    <span>{formatCurrency(financialStats.paymentBreakdown.pix)}</span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-amber-500 h-2.5 rounded-full"
                      style={{
                        width: `${financialStats.totalRevenueToday > 0 ? (financialStats.paymentBreakdown.pix / financialStats.totalRevenueToday) * 100 : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between font-bold mb-1">
                    <span>💳 Cartão de Crédito</span>
                    <span>{formatCurrency(financialStats.paymentBreakdown.cartao_credito)}</span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-blue-500 h-2.5 rounded-full"
                      style={{
                        width: `${financialStats.totalRevenueToday > 0 ? (financialStats.paymentBreakdown.cartao_credito / financialStats.totalRevenueToday) * 100 : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between font-bold mb-1">
                    <span>💳 Cartão de Débito</span>
                    <span>{formatCurrency(financialStats.paymentBreakdown.cartao_debito)}</span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-purple-500 h-2.5 rounded-full"
                      style={{
                        width: `${financialStats.totalRevenueToday > 0 ? (financialStats.paymentBreakdown.cartao_debito / financialStats.totalRevenueToday) * 100 : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between font-bold mb-1">
                    <span>💵 Dinheiro em Gaveta</span>
                    <span>{formatCurrency(financialStats.paymentBreakdown.dinheiro)}</span>
                  </div>
                  <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-2.5 rounded-full"
                      style={{
                        width: `${financialStats.totalRevenueToday > 0 ? (financialStats.paymentBreakdown.dinheiro / financialStats.totalRevenueToday) * 100 : 0}%`,
                      }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-neutral-900 text-white rounded-3xl p-6 shadow-xs flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                  Fechamento do Caixa
                </span>
                <h4 className="text-xl font-black mt-1">Resumo Financeiro do Depósito</h4>
                <div className="mt-5 space-y-2 text-xs border-t border-neutral-800 pt-4">
                  <div className="flex justify-between text-neutral-300">
                    <span>Vendas Online (Delivery):</span>
                    <span className="font-bold">{financialStats.onlineOrdersCount} pedidos</span>
                  </div>
                  <div className="flex justify-between text-neutral-300">
                    <span>Vendas Presenciais (Balcão):</span>
                    <span className="font-bold">{financialStats.posOrdersCount} vendas</span>
                  </div>
                  <div className="flex justify-between text-neutral-300">
                    <span>Total em Dinheiro na Gaveta:</span>
                    <span className="font-mono font-bold text-emerald-400">{formatCurrency(financialStats.paymentBreakdown.dinheiro)}</span>
                  </div>
                  <div className="flex justify-between text-neutral-300">
                    <span>Total Digital (Pix + Cartões):</span>
                    <span className="font-mono font-bold text-amber-400">
                      {formatCurrency(financialStats.paymentBreakdown.pix + financialStats.paymentBreakdown.cartao_credito + financialStats.paymentBreakdown.cartao_debito)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-neutral-800 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-neutral-400 uppercase">Total do Dia:</span>
                  <div className="text-2xl font-black text-amber-400">{formatCurrency(financialStats.totalRevenueToday)}</div>
                </div>
                <button
                  onClick={() => window.print()}
                  className="flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-bold transition-colors"
                >
                  <Printer className="w-4 h-4" />
                  <span>Imprimir Fechamento</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: CONFIGURAÇÕES                                        */}
      {/* ========================================================= */}
      {activeTab === 'configuracoes' && (
        <div className="max-w-4xl mx-auto space-y-6">
          {settingsSavedMessage && (
            <div className="p-4 bg-emerald-500 text-white rounded-2xl font-bold text-sm shadow-md flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              <span>Configurações salvas e atualizadas com sucesso!</span>
            </div>
          )}

          <form onSubmit={handleSaveSettings} className="bg-white rounded-3xl border border-neutral-200 p-6 sm:p-8 shadow-xs space-y-6">


            {/* PIN / SENHA DE ACESSO AO PAINEL */}
            <div className="bg-neutral-50 p-5 rounded-2xl border border-neutral-200 space-y-2">
              <label className="font-bold text-xs text-neutral-800 block">
                PIN / Senha de Acesso ao Painel
              </label>
              <div className="max-w-xs relative">
                <input
                  type={showPin ? 'text' : 'password'}
                  value={settingsForm.adminPin}
                  onChange={(e) => setSettingsForm({ ...settingsForm, adminPin: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-sm font-mono font-bold pr-10 focus:border-amber-400 outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                >
                  {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* ONLINE / OFFLINE STATUS SECTION */}
            <div className="bg-neutral-900 text-white p-6 rounded-3xl space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full ${settingsForm.isOpen ? 'bg-emerald-400 animate-ping' : 'bg-red-500'}`}></span>
                    <h4 className="font-black text-base">
                      Status da Loja Online: {settingsForm.isOpen ? 'ABERTA (Recebendo Pedidos)' : 'FECHADA (Pausada)'}
                    </h4>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1">
                    Você pode abrir ou fechar a qualquer momento com um clique, mesmo fora do horário habitual!
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    const next = !settingsForm.isOpen;
                    setSettingsForm({ ...settingsForm, isOpen: next });
                    api.updateSettings({ isOpen: next });
                  }}
                  className={`px-5 py-2.5 rounded-2xl font-black text-xs transition-all shadow-md flex items-center gap-2 ${
                    settingsForm.isOpen
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-neutral-950'
                  }`}
                >
                  <span>{settingsForm.isOpen ? '🔴 Pausar / Fechar Agora' : '🟢 Abrir Loja Agora'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-3 border-t border-neutral-800">
                <div>
                  <label className="font-bold text-neutral-300 block mb-1">Horário de Expediente / Atendimento</label>
                  <input
                    type="text"
                    value={settingsForm.openingHours}
                    onChange={(e) => setSettingsForm({ ...settingsForm, openingHours: e.target.value })}
                    placeholder="Ex: Segunda a Domingo: 10:00 às 00:00"
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-xl text-white font-medium"
                    required
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Exibido no banner para os clientes saberem seu horário.</p>
                </div>

                <div>
                  <label className="font-bold text-neutral-300 block mb-1">Mensagem quando a Loja estiver Fechada</label>
                  <input
                    type="text"
                    value={settingsForm.closedMessage || ''}
                    onChange={(e) => setSettingsForm({ ...settingsForm, closedMessage: e.target.value })}
                    placeholder="Ex: No momento estamos fechados. Voltamos amanhã às 10h!"
                    className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-xl text-white font-medium"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Aparece para o cliente caso ele tente comprar com a loja fechada.</p>
                </div>
              </div>
            </div>

            {/* STORE PROFILE & LOGO SECTION */}
            <div>
              <h3 className="font-black text-lg text-neutral-900">Identidade & Perfil do Depósito</h3>
              <p className="text-xs text-neutral-500 mt-0.5">Personalize o nome da loja e a foto de perfil/logotipo.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-center p-5 bg-neutral-50 rounded-2xl border border-neutral-200">
              <div className="flex flex-col items-center text-center">
                <span className="text-xs font-bold text-neutral-700 mb-2">Foto de Perfil / Logo</span>
                <div className="relative group">
                  {settingsForm.logoUrl ? (
                    <img
                      src={settingsForm.logoUrl}
                      alt="Logo da Loja"
                      className="w-24 h-24 rounded-2xl object-cover border-2 border-amber-500 shadow-md bg-white"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-2xl bg-amber-500 text-neutral-950 flex items-center justify-center font-black text-xl shadow-md">
                      🍺
                    </div>
                  )}

                  {settingsForm.logoUrl && (
                    <button
                      type="button"
                      onClick={() => setSettingsForm({ ...settingsForm, logoUrl: '' })}
                      className="absolute -top-2 -right-2 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 shadow-xs"
                      title="Remover foto"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Upload Button from Computer */}
                <div className="mt-3">
                  <input
                    type="file"
                    id="logo-computer-file"
                    accept="image/*"
                    onChange={handleLogoFileUpload}
                    className="hidden"
                  />
                  <label
                    htmlFor="logo-computer-file"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors shadow-xs"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isUploadingLogo ? 'Carregando...' : 'Carregar do PC'}</span>
                  </label>
                </div>
              </div>

              <div className="sm:col-span-2 space-y-3 text-xs">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Nome do Depósito / Loja *</label>
                  <input
                    type="text"
                    value={settingsForm.storeName}
                    onChange={(e) => setSettingsForm({ ...settingsForm, storeName: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl font-bold text-neutral-900 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    Ou colar link da imagem (URL)
                  </label>
                  <input
                    type="url"
                    value={settingsForm.logoUrl || ''}
                    onChange={(e) => setSettingsForm({ ...settingsForm, logoUrl: e.target.value })}
                    placeholder="https://..."
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl"
                  />
                </div>

                {/* Pre-made logo options */}
                <div className="pt-1">
                  <span className="text-[11px] text-neutral-500 block mb-1">Ou escolha um modelo pronto:</span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Chopp & Barril', url: 'https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=300&auto=format&fit=crop&q=80' },
                      { label: 'Adega & Vinhos', url: 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=300&auto=format&fit=crop&q=80' },
                      { label: 'Cervejaria Premium', url: 'https://images.unsplash.com/photo-1618886614638-80e3c153d31a?w=300&auto=format&fit=crop&q=80' },
                      { label: 'Destilaria & Gin', url: 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=300&auto=format&fit=crop&q=80' },
                    ].map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSettingsForm({ ...settingsForm, logoUrl: preset.url })}
                        className="px-2.5 py-1 bg-white hover:bg-neutral-100 border border-neutral-300 rounded-lg text-[11px] font-medium transition-colors"
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">

              <div>
                <label className="font-bold text-neutral-700 block mb-1">CNPJ ou CPF</label>
                <input
                  type="text"
                  value={settingsForm.cnpjOrCpf}
                  onChange={(e) => setSettingsForm({ ...settingsForm, cnpjOrCpf: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">WhatsApp de Atendimento</label>
                <input
                  type="text"
                  value={settingsForm.whatsapp}
                  onChange={(e) => setSettingsForm({ ...settingsForm, whatsapp: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  required
                />
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Telefone Fixo / Celular</label>
                <input
                  type="text"
                  value={settingsForm.phone}
                  onChange={(e) => setSettingsForm({ ...settingsForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="font-bold text-neutral-700 block mb-1">Endereço Completo do Depósito</label>
                <input
                  type="text"
                  value={settingsForm.address}
                  onChange={(e) => setSettingsForm({ ...settingsForm, address: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  required
                />
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-100">
              <h4 className="font-black text-sm text-neutral-900 mb-1">Chave PIX do Depósito</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Chave Pix</label>
                  <input
                    type="text"
                    value={settingsForm.pixKey}
                    onChange={(e) => setSettingsForm({ ...settingsForm, pixKey: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Nome do Favorecido</label>
                  <input
                    type="text"
                    value={settingsForm.pixReceiver}
                    onChange={(e) => setSettingsForm({ ...settingsForm, pixReceiver: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-100">
              <h4 className="font-black text-sm text-neutral-900 mb-1">Regras Gerais de Entrega</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Frete Grátis a partir de (R$)</label>
                  <input
                    type="number"
                    step="10"
                    value={settingsForm.freeDeliveryThreshold}
                    onChange={(e) => setSettingsForm({ ...settingsForm, freeDeliveryThreshold: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Pedido Mínimo (R$)</label>
                  <input
                    type="number"
                    step="5"
                    value={settingsForm.minOrderValue}
                    onChange={(e) => setSettingsForm({ ...settingsForm, minOrderValue: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-100 flex items-center justify-between">
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Deseja realmente apagar todos os produtos, pedidos, clientes e bairros de simulação?')) {
                    await api.clearAllSimulationData();
                    alert('Todos os dados de simulação foram apagados com sucesso!');
                  }
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-xl transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Zerar Dados de Simulação</span>
              </button>

              <button
                type="submit"
                className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-2xl shadow-sm transition-colors"
              >
                Salvar Alterações
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: CADASTRO / EDIÇÃO DE BAIRRO DE ENTREGA              */}
      {/* ========================================================= */}
      {isAreaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base">
                {editingArea ? 'Editar Bairro de Entrega' : 'Novo Bairro Atendido'}
              </h3>
              <button
                onClick={() => setIsAreaModalOpen(false)}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveArea} className="p-6 space-y-4 text-xs">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Nome do Bairro / Região *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Jardim América, Centro, Vila Nova..."
                  value={areaForm.name}
                  onChange={(e) => setAreaForm({ ...areaForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900 text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Taxa de Entrega (R$) *</label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={areaForm.fee}
                    onChange={(e) => setAreaForm({ ...areaForm, fee: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Tempo Estimado</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: 25 a 35 min"
                    value={areaForm.estimatedTime}
                    onChange={(e) => setAreaForm({ ...areaForm, estimatedTime: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-neutral-800">
                  <input
                    type="checkbox"
                    checked={areaForm.active}
                    onChange={(e) => setAreaForm({ ...areaForm, active: e.target.checked })}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <span>Bairro Ativo para Receber Pedidos</span>
                </label>
              </div>

              <div className="pt-3 border-t border-neutral-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAreaModalOpen(false)}
                  className="px-4 py-2 font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs"
                >
                  Salvar Bairro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: PRODUTO                                            */}
      {/* ========================================================= */}
      {isProductModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-neutral-200">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base">
                {editingProduct ? 'Editar Bebida / Produto' : 'Cadastrar Nova Bebida'}
              </h3>
              <button
                onClick={() => setIsProductModalOpen(false)}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="p-6 space-y-4 text-xs">
              <div>
                <label className="font-bold text-neutral-700 block mb-1">Nome do Produto *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Cerveja Heineken Lata 350ml"
                  value={productForm.name}
                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Categoria *</label>
                  <select
                    value={productForm.category}
                    onChange={(e) => setProductForm({ ...productForm, category: e.target.value as ProductCategory })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium"
                  >
                    <option value="cervejas">Cervejas</option>
                    <option value="destilados">Destilados</option>
                    <option value="nao_alcoolicos">Não Alcoólicos</option>
                    <option value="vinhos">Vinhos</option>
                    <option value="gelo_carvao">Gelo & Carvão</option>
                    <option value="petiscos">Petiscos & Copos</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Volume / Embalagem *</label>
                  <input
                    type="text"
                    required
                    placeholder="Lata 350ml / Garrafa 1L / 5kg"
                    value={productForm.volume}
                    onChange={(e) => setProductForm({ ...productForm, volume: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Preço de Venda (R$) *</label>
                  <input
                    type="number"
                    step="0.10"
                    required
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Preço de Custo (R$) *</label>
                  <input
                    type="number"
                    step="0.10"
                    required
                    value={productForm.costPrice}
                    onChange={(e) => setProductForm({ ...productForm, costPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Qtd em Estoque *</label>
                  <input
                    type="number"
                    required
                    value={productForm.stock}
                    onChange={(e) => setProductForm({ ...productForm, stock: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Estoque Mínimo (Alerta) *</label>
                  <input
                    type="number"
                    required
                    value={productForm.minStock}
                    onChange={(e) => setProductForm({ ...productForm, minStock: parseInt(e.target.value, 10) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Código / SKU</label>
                  <input
                    type="text"
                    value={productForm.sku}
                    onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-mono"
                  />
                </div>

                <div className="flex items-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-neutral-800">
                    <input
                      type="checkbox"
                      checked={productForm.isCold}
                      onChange={(e) => setProductForm({ ...productForm, isCold: e.target.checked })}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                    />
                    <span>❄️ Opção Gelada</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Foto da Bebida / Produto</label>
                
                <div className="flex items-center gap-3 mb-2">
                  {productForm.image ? (
                    <img
                      src={productForm.image}
                      alt="Preview"
                      className="w-14 h-14 rounded-xl object-cover border border-neutral-300"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-400">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <div className="space-y-1">
                    <input
                      type="file"
                      id="product-computer-file"
                      accept="image/*"
                      onChange={handleProductPhotoUpload}
                      className="hidden"
                    />
                    <label
                      htmlFor="product-computer-file"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isUploadingProductPhoto ? 'Carregando...' : 'Carregar Foto do Computador'}</span>
                    </label>
                    <p className="text-[10px] text-neutral-500">Escolha uma foto salva no seu computador</p>
                  </div>
                </div>

                <div>
                  <input
                    type="url"
                    placeholder="Ou cole o link da imagem (https://...)"
                    value={productForm.image}
                    onChange={(e) => setProductForm({ ...productForm, image: e.target.value })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Descrição</label>
                <textarea
                  rows={2}
                  placeholder="Informações sobre a bebida..."
                  value={productForm.description}
                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                />
              </div>

              <div className="pt-3 border-t border-neutral-200 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsProductModalOpen(false)}
                  className="px-4 py-2 font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl shadow-xs"
                >
                  Salvar Produto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedReceiptOrder && (
        <PrintReceiptModal
          order={selectedReceiptOrder}
          settings={settings}
          onClose={() => setSelectedReceiptOrder(null)}
        />
      )}

      <QRCodeModal
        settings={settings}
        isOpen={isQRCodeModalOpen}
        onClose={() => setIsQRCodeModalOpen(false)}
      />

      <CustomerModal
        isOpen={isCustomerModalOpen}
        customer={editingCustomer}
        settings={settings}
        deliveryAreas={deliveryAreas}
        onSave={async (custData) => {
          await api.saveCustomerProfile(custData);
          setIsCustomerModalOpen(false);
          setEditingCustomer(null);
        }}
        onClose={() => {
          setIsCustomerModalOpen(false);
          setEditingCustomer(null);
        }}
      />

      {/* End Modals */}
    </div>
  );
};
