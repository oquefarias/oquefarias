import React, { useState, useMemo, useEffect } from 'react';
import {
  Product,
  Order,
  StoreSettings,
  OrderStatus,
  ProductCategory,
  PaymentMethod,
  DeliveryArea,
  CustomerProfile,
  Coupon,
  SaleUnit,
  ShortcutAction,
  DEFAULT_SHORTCUTS,
  ProductSortMode,
  StockAdjustReason,
  hasProductStockCase,
  hasProductCase,
  canSellProductCase,
  formatStockWithCases,
  isProductPromoActive,
  getEffectiveProductPrice,
  getPromoDiscountPercent,
  sortProductsByPreference,
  sortProductsForStore,
  resolveStoreCategories,
  getCategoryDisplayName,
  formatCategoryLabel,
  OrderItemAddon,
  getProductAddonGroups,
  buildOrderItemAddonsSignature,
  formatOrderItemAddonLine,
  OrderItemComboComponent,
  isComboProduct,
  calculateComboMetrics,
  formatOrderItemComboLine,
  isProductHiddenFromStore,
  CashSession,
  CashSessionSummary,
} from '../../types';
import {
  api,
  isNetworkOrTimeoutError,
  ORDER_NETWORK_EXHAUSTED_MESSAGE,
} from '../../services/api';
import { soundService } from '../../utils/sound';
import { PrintReceiptModal } from '../PrintReceiptModal';
import { ProductAddonsModal } from '../ProductAddonsModal';
import { QRCodeModal } from '../QRCodeModal';
import { GoogleDeliveryRadiusMap } from './GoogleDeliveryRadiusMap';
import { CustomerModal } from './CustomerModal';
import { ImportProductsModal } from './ImportProductsModal';
import { TablesManager } from './tables/TablesManager';
import { StoreOrganizationSection } from './StoreOrganizationSection';
import { StockHistorySection } from './StockHistorySection';
import {
  OpenCashSessionModal,
  CloseCashSessionModal,
  CashClosingReceiptModal,
  formatCashSessionBadgeDate,
  formatCashSessionDateTime,
  formatCashSessionDuration,
  formatCashDifferenceLabel,
} from './CashSessionModals';
import { PaymentsHistorySection } from './PaymentsHistorySection';
import {
  calculateDistanceKm,
  buildSingleDeliveryRouteUrl,
  buildMultiStopDeliveryRoute,
} from '../../utils/geo';
import {
  optimizeProductImageFile,
  fetchAndOptimizeExistingProductImage,
  formatBytesCompactPtBr,
} from '../../utils/imageOptimizer';
import QRCode from 'qrcode';
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
  Ticket,
  Tag,
  Utensils,
  FileSpreadsheet,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  Keyboard,
  Navigation,
  History,
} from 'lucide-react';

const SHORTCUT_ACTION_ITEMS: Array<{
  action: ShortcutAction;
  label: string;
  description: string;
}> = [
  {
    action: 'pdv',
    label: 'PDV Balcão (e focar na busca)',
    description: 'Abre a aba PDV Balcão e posiciona o cursor no campo de busca de produtos',
  },
  {
    action: 'mesas',
    label: 'Mesas & Comandas',
    description: 'Abre a aba Mesas & Comandas',
  },
  {
    action: 'pedidos',
    label: 'Pedidos',
    description: 'Abre a aba de Pedidos',
  },
  {
    action: 'estoque',
    label: 'Estoque',
    description: 'Abre a aba de Estoque',
  },
  {
    action: 'finalizar',
    label: 'Finalizar Venda (PDV) / Receber e Fechar (Mesa)',
    description: 'Conclui a venda no PDV ou fecha a conta da mesa quando o botão está habilitado',
  },
  {
    action: 'busca',
    label: 'Focar na busca de produtos',
    description: 'Posiciona o cursor no campo de busca da tela aberta',
  },
  {
    action: 'fecharModal',
    label: 'Fechar janela / modal aberto',
    description: 'Fecha o modal aberto no momento sem limpar o que foi digitado nas outras telas',
  },
  {
    action: 'newProduct',
    label: 'Novo produto (Estoque)',
    description: 'Abre o cadastro de novo produto',
  },
  {
    action: 'saveProduct',
    label: 'Salvar produto (no modal de cadastro)',
    description: 'Salva o produto que está sendo cadastrado ou editado',
  },
  {
    action: 'saveAndNewProduct',
    label: 'Salvar e cadastrar outro (no modal de cadastro)',
    description: 'Salva o produto e já abre outro em branco mantendo categoria, volume, caixa e gelada',
  },
];

const FORBIDDEN_BROWSER_SHORTCUTS = new Set([
  'F5',
  'F7',
  'F11',
  'F12',
  'TAB',
  'ENTER',
  'CTRL+W',
  'CTRL+T',
  'CTRL+N',
  'CTRL+R',
  'CTRL+L',
  'CTRL+P',
  'ALT+F4',
]);

function formatKeyboardEventCombo(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null;
  }
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && e.key.length > 1) parts.push('Shift');

  let baseKey = e.key;
  if (baseKey === ' ') baseKey = 'Space';
  else if (baseKey === 'Escape') baseKey = 'Escape';
  else if (/^f\d+$/i.test(baseKey)) baseKey = baseKey.toUpperCase();
  else if (baseKey.length === 1) baseKey = baseKey === '/' ? '/' : baseKey.toUpperCase();

  parts.push(baseKey);
  return parts.join('+');
}

function formatShortcutDisplay(key: string): string {
  if (!key) return '';
  if (key.toUpperCase() === 'ESCAPE') return 'Esc';
  return key;
}

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
  const [activeTab, setActiveTab] = useState<'pedidos' | 'estoque' | 'promocoes' | 'mesas' | 'pdv' | 'areas' | 'clientes' | 'cupons' | 'financeiro' | 'configuracoes'>('pedidos');
  
  // Promotions state
  const [isPromoModalOpen, setIsPromoModalOpen] = useState<boolean>(false);
  const [promoProductSearch, setPromoProductSearch] = useState<string>('');
  const [promoForm, setPromoForm] = useState<{
    productId: string;
    promoPrice: string;
    promoEndsAt: string;
  }>({
    productId: '',
    promoPrice: '',
    promoEndsAt: '',
  });
  const [isSavingPromo, setIsSavingPromo] = useState<boolean>(false);
  const [promoModalError, setPromoModalError] = useState<string>('');

  const activePromotions = useMemo(() => {
    return products.filter((p) => isProductPromoActive(p));
  }, [products]);

  const selectedPromoProduct = useMemo(() => {
    return products.find((p) => p.id === promoForm.productId) || null;
  }, [products, promoForm.productId]);

  const calculatedModalDiscountPercent = useMemo(() => {
    if (!selectedPromoProduct) return 0;
    const numPromo = parseFloat(promoForm.promoPrice);
    if (Number.isNaN(numPromo) || numPromo <= 0 || numPromo >= selectedPromoProduct.price) return 0;
    return Math.round(((selectedPromoProduct.price - numPromo) / selectedPromoProduct.price) * 100);
  }, [selectedPromoProduct, promoForm.promoPrice]);

  const toLocalDateTimeInputValue = (iso?: string | null) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleOpenNewPromo = () => {
    setPromoModalError('');
    setPromoProductSearch('');
    setPromoForm({
      productId: '',
      promoPrice: '',
      promoEndsAt: '',
    });
    setIsPromoModalOpen(true);
  };

  const handleOpenEditPromo = (prod: Product) => {
    setPromoModalError('');
    setPromoProductSearch(prod.name);
    setPromoForm({
      productId: prod.id,
      promoPrice: prod.promoPrice ? String(prod.promoPrice) : '',
      promoEndsAt: toLocalDateTimeInputValue(prod.promoEndsAt),
    });
    setIsPromoModalOpen(true);
  };

  const handleEndPromotion = (prod: Product) => {
    setConfirmModal({
      title: 'Encerrar Promoção',
      message: `Deseja encerrar a promoção de "${prod.name}"?`,
      onConfirm: async () => {
        await api.clearProductPromotion(prod.id);
      },
    });
  };

  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    setPromoModalError('');
    if (!selectedPromoProduct) {
      setPromoModalError('Selecione um produto para aplicar a promoção.');
      return;
    }

    const numPromo = parseFloat(promoForm.promoPrice);
    if (Number.isNaN(numPromo) || numPromo <= 0) {
      setPromoModalError('O preço promocional precisa ser maior que zero.');
      return;
    }

    if (numPromo >= selectedPromoProduct.price) {
      setPromoModalError(
        `O preço promocional precisa ser menor que o preço normal (${selectedPromoProduct.price.toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })}).`
      );
      return;
    }

    let isoEndsAt: string | null = null;
    if (promoForm.promoEndsAt && promoForm.promoEndsAt.trim()) {
      const parsedDate = new Date(promoForm.promoEndsAt);
      if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
        setPromoModalError('A data de término precisa ser uma data e hora no futuro.');
        return;
      }
      isoEndsAt = parsedDate.toISOString();
    }

    setIsSavingPromo(true);
    try {
      await api.setProductPromotion(selectedPromoProduct.id, numPromo, isoEndsAt);
      setIsPromoModalOpen(false);
    } catch (err: any) {
      setPromoModalError(err.message || 'Erro ao salvar promoção.');
    } finally {
      setIsSavingPromo(false);
    }
  };

  // Coupons state
  const [coupons, setCoupons] = useState<Coupon[]>(() => api.getCoupons());
  const [isCouponModalOpen, setIsCouponModalOpen] = useState<boolean>(false);
  const [couponForm, setCouponForm] = useState<{
    code: string;
    type: 'percent' | 'fixed';
    value: number;
    minOrder?: number;
    maxDiscount?: number;
    active: boolean;
    expiresAt?: string;
    maxUses?: number;
  }>({
    code: '',
    type: 'percent',
    value: 10,
    minOrder: undefined,
    maxDiscount: undefined,
    active: true,
    expiresAt: '',
    maxUses: undefined,
  });
  const [isSavingCoupon, setIsSavingCoupon] = useState<boolean>(false);
  const [couponModalError, setCouponModalError] = useState<string>('');

  useEffect(() => {
    setCoupons(api.getCoupons());
  }, [api.getVersion()]);

  useEffect(() => {
    api.getAdminCoupons().then(setCoupons).catch(() => {});
  }, []);
  
  // Orders filter
  const [orderStatusFilter, setOrderStatusFilter] = useState<OrderStatus | 'todos'>('todos');
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<Order | null>(null);
  const [isQRCodeModalOpen, setIsQRCodeModalOpen] = useState<boolean>(false);

  // Stock state
  const [estoqueSubTab, setEstoqueSubTab] = useState<'produtos' | 'historico'>('produtos');
  const [stockHistoryProductId, setStockHistoryProductId] = useState<string>('');
  const [stockSearch, setStockSearch] = useState<string>('');
  const [stockCategoryFilter, setStockCategoryFilter] = useState<ProductCategory | 'todas' | 'outros'>('todas');
  const [stockSortBy, setStockSortBy] = useState<'az' | 'price' | 'stock' | 'category'>('az');
  const [onlyLowStock, setOnlyLowStock] = useState<boolean>(false);
  const [onlyZeroCost, setOnlyZeroCost] = useState<boolean>(false);
  const [showStockValueHelp, setShowStockValueHelp] = useState<boolean>(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState<boolean>(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingComboIdForModal, setEditingComboIdForModal] = useState<string | null>(null);
  const [stockRowUnits, setStockRowUnits] = useState<Record<string, SaleUnit>>({});
  const [stockInlineErrorByProduct, setStockInlineErrorByProduct] = useState<Record<string, string>>({});
  const [stockInlineSuccessByProduct, setStockInlineSuccessByProduct] = useState<Record<string, string>>({});
  const stockInlineSuccessTimersRef = React.useRef<Record<string, number>>({});
  const [inlineStockEdit, setInlineStockEdit] = useState<{
    productId: string;
    value: string;
    reason: StockAdjustReason;
    unit: SaleUnit;
    saving?: boolean;
  } | null>(null);
  const pendingQuickStockRef = React.useRef<
    Record<
      string,
      {
        baseStock: number;
        accumulatedDelta: number;
        timerId: number;
      }
    >
  >({});
  const [stockAdjustModal, setStockAdjustModal] = useState<{
    product: Product;
    unit: SaleUnit;
    mode: 'add' | 'remove';
    quantity: string;
    error?: string;
    loading?: boolean;
  } | null>(null);

  const storeCategories = useMemo(
    () => resolveStoreCategories(settings, products),
    [settings, products]
  );

  const storeCategoryIdSet = useMemo(
    () => new Set(storeCategories.map((c) => c.id)),
    [storeCategories]
  );

  const hasUnlistedCategoryProducts = useMemo(
    () => products.some((p) => !storeCategoryIdSet.has(p.category)),
    [products, storeCategoryIdSet]
  );

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
  const [posSelectedUnits, setPosSelectedUnits] = useState<Record<string, SaleUnit>>({});
  const [posCart, setPosCart] = useState<
    Array<{
      lineId: string;
      product: Product;
      quantity: number;
      saleUnit: SaleUnit;
      addons?: OrderItemAddon[];
      addonsTotal?: number;
      comboItems?: OrderItemComboComponent[];
    }>
  >([]);
  const [posAddonModalState, setPosAddonModalState] = useState<{
    product: Product;
    saleUnit: SaleUnit;
  } | null>(null);
  const [posCustomerName, setPosCustomerName] = useState<string>('Cliente Balcão');
  const [posPaymentMethod, setPosPaymentMethod] = useState<PaymentMethod>('dinheiro');
  const [posCashGiven, setPosCashGiven] = useState<string>('');
  const [posClientRequestId, setPosClientRequestId] = useState<string>(() => crypto.randomUUID());
  const [isSubmittingPos, setIsSubmittingPos] = useState<boolean>(false);
  const [posSubmittingStatus, setPosSubmittingStatus] = useState<string>('');
  const [posError, setPosError] = useState<string>('');
  const [posCanRetry, setPosCanRetry] = useState<boolean>(false);

  // Order cancellation / reversal modal state
  const [cancelOrderModal, setCancelOrderModal] = useState<{
    order: Order;
    mode: 'completed' | 'active';
    reason: string;
    loading: boolean;
    error?: string;
  } | null>(null);

  const [settingsForm, setSettingsForm] = useState<StoreSettings>(() => ({
    ...settings,
    showOutOfStock: Boolean(settings.showOutOfStock),
    featuredProductIds: Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds : [],
    hiddenFromStoreIds: Array.isArray(settings.hiddenFromStoreIds) ? settings.hiddenFromStoreIds : [],
    categories: resolveStoreCategories(settings, products),
    productSortMode: settings.productSortMode || 'manual',
    productOrder: settings.productOrder || {},
    shortcuts: { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) },
  }));
  const [settingsSavedMessage, setSettingsSavedMessage] = useState<boolean>(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState<boolean>(false);
  const [isUploadingProductPhoto, setIsUploadingProductPhoto] = useState<boolean>(false);
  const [productPhotoOptimizedSummary, setProductPhotoOptimizedSummary] = useState<string>('');
  const [showProductPhotoHelp, setShowProductPhotoHelp] = useState<boolean>(false);

  // Batch optimize existing product photos state
  const [batchPhotoOpt, setBatchPhotoOpt] = useState<{
    running: boolean;
    current: number;
    total: number;
    beforeBytes: number;
    afterBytes: number;
    updatedCount: number;
    summaryText: string;
    errorText: string;
  }>({
    running: false,
    current: 0,
    total: 0,
    beforeBytes: 0,
    afterBytes: 0,
    updatedCount: 0,
    summaryText: '',
    errorText: '',
  });

  const storedPhotoProducts = useMemo(() => {
    return products.filter((p) => {
      const url = p.imageUrl || p.image || '';
      return url.startsWith('/api/products/') || url.startsWith('data:image/');
    });
  }, [products]);

  const handleBatchOptimizeProductPhotos = async () => {
    if (batchPhotoOpt.running) return;
    const targets = products.filter((p) => {
      const url = p.imageUrl || p.image || '';
      return url.startsWith('/api/products/') || url.startsWith('data:image/');
    });
    if (targets.length === 0) {
      setBatchPhotoOpt({
        running: false,
        current: 0,
        total: 0,
        beforeBytes: 0,
        afterBytes: 0,
        updatedCount: 0,
        summaryText: 'Nenhuma foto salva no banco precisou ser otimizada.',
        errorText: '',
      });
      return;
    }

    setBatchPhotoOpt({
      running: true,
      current: 0,
      total: targets.length,
      beforeBytes: 0,
      afterBytes: 0,
      updatedCount: 0,
      summaryText: '',
      errorText: '',
    });

    let totalBefore = 0;
    let totalAfter = 0;
    let updatedCount = 0;

    try {
      for (let i = 0; i < targets.length; i++) {
        const prod = targets[i];
        setBatchPhotoOpt((prev) => ({
          ...prev,
          current: i + 1,
        }));

        const srcUrl = prod.imageUrl || `/api/products/${encodeURIComponent(prod.id)}/image`;
        let optResult: Awaited<ReturnType<typeof fetchAndOptimizeExistingProductImage>> | null = null;
        try {
          optResult = await fetchAndOptimizeExistingProductImage(srcUrl);
        } catch {
          optResult = null;
        }
        if (!optResult) {
          continue;
        }

        const beforeItemBytes = optResult.originalStorageBytes;
        const afterCandidateBytes = optResult.newStorageBytes;
        totalBefore += beforeItemBytes;

        if (
          optResult.optimized.bytes < optResult.originalDecodedBytes &&
          afterCandidateBytes < beforeItemBytes
        ) {
          try {
            await api.updateProductImage(prod.id, optResult.optimized.dataUrl);
            totalAfter += afterCandidateBytes;
            updatedCount += 1;
          } catch {
            totalAfter += beforeItemBytes;
          }
        } else {
          totalAfter += beforeItemBytes;
        }

        setBatchPhotoOpt((prev) => ({
          ...prev,
          beforeBytes: totalBefore,
          afterBytes: totalAfter,
          updatedCount,
        }));
      }

      await api.reloadProducts();

      setBatchPhotoOpt({
        running: false,
        current: targets.length,
        total: targets.length,
        beforeBytes: totalBefore,
        afterBytes: totalAfter,
        updatedCount,
        summaryText: `Antes: ${formatBytesCompactPtBr(totalBefore)} — Depois: ${formatBytesCompactPtBr(totalAfter)}`,
        errorText: '',
      });
    } catch (err: any) {
      setBatchPhotoOpt((prev) => ({
        ...prev,
        running: false,
        errorText: err?.message || 'Erro ao otimizar fotos dos produtos.',
      }));
    }
  };

  // Shortcuts UI states
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState<boolean>(false);
  const [recordingShortcutAction, setRecordingShortcutAction] = useState<ShortcutAction | null>(null);
  const [shortcutWarning, setShortcutWarning] = useState<string>('');

  // Multi-order delivery route states
  const [selectedRouteOrderIds, setSelectedRouteOrderIds] = useState<string[]>([]);
  const [isMultiRouteModalOpen, setIsMultiRouteModalOpen] = useState<boolean>(false);
  const [multiRouteQrDataUrl, setMultiRouteQrDataUrl] = useState<string>('');

  useEffect(() => {
    setSettingsForm((prev) => ({
      ...prev,
      ...settings,
      showOutOfStock: Boolean(settings.showOutOfStock),
      featuredProductIds: Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds : [],
      hiddenFromStoreIds: Array.isArray(settings.hiddenFromStoreIds) ? settings.hiddenFromStoreIds : [],
      categories: resolveStoreCategories(settings, products),
      productSortMode: settings.productSortMode || 'manual',
      productOrder: settings.productOrder || {},
      shortcuts: { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) },
    }));
  }, [settings, products]);

  // Local optimistic state for instant order status changes without requiring page reload
  const [localOrders, setLocalOrders] = useState<Order[]>(orders);

  useEffect(() => {
    setLocalOrders(orders);
  }, [orders]);

  // Keep selectedRouteOrderIds clean of orders that are no longer eligible
  useEffect(() => {
    setSelectedRouteOrderIds((prev) => {
      if (prev.length === 0) return prev;
      const validIds = new Set(
        localOrders
          .filter(
            (o) =>
              o.deliveryType === 'delivery' &&
              o.source !== 'balcao' &&
              o.source !== 'mesa' &&
              (o.status === 'em_separacao' || o.status === 'em_rota')
          )
          .map((o) => o.id)
      );
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [localOrders]);

  // Sub-tab for Delivery Areas (Map vs Neighborhoods)
  const [areaSubTab, setAreaSubTab] = useState<'mapa' | 'bairros'>('mapa');

  const [panelError, setPanelError] = useState<string>('');
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => Promise<void> | void;
    loading?: boolean;
    error?: string;
  } | null>(null);

  useEffect(() => {
    const handleDbError = (e: Event) => {
      const customEvent = e as CustomEvent<{ message?: string }>;
      if (customEvent.detail?.message) {
        setPanelError(customEvent.detail.message);
      }
    };
    window.addEventListener('deposito_db_error', handleDbError);
    return () => {
      window.removeEventListener('deposito_db_error', handleDbError);
    };
  }, []);

  // Upload logo from computer
  const handleLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPanelError('Por favor selecione um arquivo de imagem (PNG, JPG, JPEG, WEBP).');
      return;
    }
    setIsUploadingLogo(true);
    try {
      const compressed = await compressImageFile(file, 400, 0.9);
      setSettingsForm(prev => ({ ...prev, logoUrl: compressed }));
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      setPanelError('Erro ao carregar a foto do computador. Tente outro arquivo.');
    } finally {
      setIsUploadingLogo(false);
    }
  };

  // Upload product photo from computer
  const handleProductPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingProductPhoto(true);
    try {
      const optimized = await optimizeProductImageFile(file);
      setProductForm(prev => ({ ...prev, image: optimized.dataUrl }));
      setProductPhotoOptimizedSummary(
        `Foto otimizada: ${optimized.width}×${optimized.height}, ${optimized.kb} KB`
      );
      setProductModalError('');
    } catch (err: any) {
      console.error('Erro ao processar imagem:', err);
      setProductModalError(err?.message || 'Erro ao carregar a foto do produto.');
    } finally {
      setIsUploadingProductPhoto(false);
      e.target.value = '';
    }
  };

  // Product form state
  const [productForm, setProductForm] = useState<{
    id: string;
    name: string;
    category: ProductCategory;
    volume: string;
    price: number;
    sellsCase: boolean;
    caseSize: number;
    casePrice: number;
    caseChannelStore: boolean;
    caseChannelLocal: boolean;
    costPrice: number;
    stock: number;
    minStock: number;
    isCold: boolean;
    active: boolean;
    appearsInDelivery: boolean;
    image: string;
    sku: string;
    description: string;
  }>({
    id: '',
    name: '',
    category: 'cervejas',
    volume: 'Lata 350ml',
    price: 0,
    sellsCase: false,
    caseSize: 0,
    casePrice: 0,
    caseChannelStore: true,
    caseChannelLocal: true,
    costPrice: 0,
    stock: 0,
    minStock: 12,
    isCold: true,
    active: true,
    appearsInDelivery: true,
    image: '',
    sku: '',
    description: '',
  });
  const [initialProductFormSnapshot, setInitialProductFormSnapshot] = useState<string>('');
  const [showDiscardProductConfirm, setShowDiscardProductConfirm] = useState<boolean>(false);
  const [productModalSuccessNotice, setProductModalSuccessNotice] = useState<string>('');
  const [productModalError, setProductModalError] = useState<string>('');
  const productFormRef = React.useRef<HTMLFormElement | null>(null);
  const productNameInputRef = React.useRef<HTMLInputElement | null>(null);

  const isProductFormDirty = useMemo(() => {
    if (!isProductModalOpen || !initialProductFormSnapshot) return false;
    return JSON.stringify(productForm) !== initialProductFormSnapshot;
  }, [isProductModalOpen, productForm, initialProductFormSnapshot]);

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const formatWhatsAppPhone = (rawPhone?: string | null): string | null => {
    if (!rawPhone) return null;
    const digits = String(rawPhone).replace(/\D/g, '');
    if (digits.length < 10) return null;
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }
    return digits;
  };

  const getOrderStatusLabelForWhatsApp = (order: Order): string => {
    switch (order.status) {
      case 'pendente':
        return 'Recebido';
      case 'em_separacao':
        return 'Em separação';
      case 'em_rota':
        return order.deliveryType === 'retirada' ? 'Pronto para retirada' : 'Saiu para entrega';
      case 'concluido':
        return order.deliveryType === 'retirada' ? 'Retirado / Concluído' : 'Entregue';
      case 'cancelado':
        return 'Cancelado';
      default:
        return 'Recebido';
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  };

  // Pending orders count (uses localOrders for instant real-time sync)
  const pendingOrders = useMemo(() => {
    return localOrders.filter(o => o.status === 'pendente');
  }, [localOrders]);

  // Low stock products count (only active non-combo products with stock <= minStock)
  const lowStockProducts = useMemo(() => {
    return products.filter(
      (p) => p.active && !isComboProduct(p.id, settings) && p.stock <= p.minStock
    );
  }, [products, settings]);

  // Active non-combo products with stock > 0 and costPrice === 0
  const zeroCostStockProducts = useMemo(() => {
    return products.filter(
      (p) =>
        p.active &&
        !isComboProduct(p.id, settings) &&
        p.stock > 0 &&
        (!p.costPrice || Number(p.costPrice) <= 0)
    );
  }, [products, settings]);

  // Filtered orders list (instant UI responsiveness without F5)
  const filteredOrders = useMemo(() => {
    if (orderStatusFilter === 'todos') return localOrders;
    return localOrders.filter(o => o.status === orderStatusFilter);
  }, [localOrders, orderStatusFilter]);

  // Filtered stock list (with admin-only view sorting: Nome A-Z / Preço / Estoque / Categoria)
  const filteredProducts = useMemo(() => {
    const matching = products.filter((p) => {
      if (stockCategoryFilter === 'outros') {
        if (storeCategoryIdSet.has(p.category)) return false;
      } else if (stockCategoryFilter !== 'todas' && p.category !== stockCategoryFilter) {
        return false;
      }
      if (onlyLowStock && (!p.active || isComboProduct(p.id, settings) || p.stock > p.minStock)) {
        return false;
      }
      if (
        onlyZeroCost &&
        (!p.active || isComboProduct(p.id, settings) || p.stock <= 0 || (Number(p.costPrice) || 0) > 0)
      ) {
        return false;
      }
      if (stockSearch.trim()) {
        const q = stockSearch.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.volume.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const catOrderRank = new Map<string, number>();
    storeCategories.forEach((c, idx) => catOrderRank.set(c.id, idx));

    return [...matching].sort((a, b) => {
      if (stockSortBy === 'price') {
        const diff = getEffectiveProductPrice(a) - getEffectiveProductPrice(b);
        if (Math.abs(diff) > 0.0001) return diff;
        return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      }
      if (stockSortBy === 'stock') {
        if (a.stock !== b.stock) return a.stock - b.stock;
        return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      }
      if (stockSortBy === 'category') {
        const ra = catOrderRank.has(a.category) ? catOrderRank.get(a.category)! : 999999;
        const rb = catOrderRank.has(b.category) ? catOrderRank.get(b.category)! : 999999;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
      }
      // default 'az'
      return a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' });
    });
  }, [
    products,
    settings,
    stockCategoryFilter,
    onlyLowStock,
    onlyZeroCost,
    stockSearch,
    stockSortBy,
    storeCategories,
    storeCategoryIdSet,
  ]);

  // Order status actions - Instant optimistic update without requiring page reload
  const handleUpdateStatus = async (orderId: string, newStatus: OrderStatus, notes?: string) => {
    const prevOrder = localOrders.find(o => o.id === orderId);
    setLocalOrders(prev =>
      prev.map(o =>
        o.id === orderId
          ? { ...o, status: newStatus, notes: notes !== undefined ? notes : o.notes, updatedAt: new Date().toISOString() }
          : o
      )
    );
    try {
      await api.updateOrderStatus(orderId, newStatus, notes);
      soundService.playSuccessSound();
    } catch (err: any) {
      if (prevOrder) {
        setLocalOrders(prev => prev.map(o => o.id === orderId ? prevOrder : o));
      }
      throw err;
    }
  };

  const handleConfirmCancelOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelOrderModal) return;
    const { order, mode, reason } = cancelOrderModal;
    const trimmedReason = reason.trim();
    if (mode === 'completed' && !trimmedReason) {
      setCancelOrderModal(prev => prev ? { ...prev, error: 'Informe o motivo do cancelamento da venda.' } : null);
      return;
    }

    const updatedNotes = trimmedReason
      ? `${order.notes ? `${order.notes} | ` : ''}Cancelado: ${trimmedReason}`
      : order.notes;

    setCancelOrderModal(prev => prev ? { ...prev, loading: true, error: undefined } : null);
    try {
      await handleUpdateStatus(order.id, 'cancelado', updatedNotes);
      setCancelOrderModal(null);
    } catch (err: any) {
      setCancelOrderModal(prev =>
        prev ? { ...prev, loading: false, error: err?.message || 'Erro ao cancelar pedido.' } : null
      );
    }
  };

  // Stock quick adjust: optimistic update + 600ms debounce per product without reloading the whole list
  const handleAdjustStock = (productId: string, delta: number, unit: SaleUnit = 'unit') => {
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const mult = unit === 'case' && prod.caseSize && prod.caseSize >= 2 ? Math.floor(prod.caseSize) : 1;
    const unitDelta = Math.round(delta * mult);
    if (unitDelta === 0) return;

    setStockInlineErrorByProduct((prev) => {
      if (!prev[productId]) return prev;
      const next = { ...prev };
      delete next[productId];
      return next;
    });

    let entry = pendingQuickStockRef.current[productId];
    if (!entry) {
      entry = {
        baseStock: prod.stock,
        accumulatedDelta: 0,
        timerId: 0,
      };
      pendingQuickStockRef.current[productId] = entry;
    }

    const nextAccumulated = entry.accumulatedDelta + unitDelta;
    const optimisticStock = entry.baseStock + nextAccumulated;

    entry.accumulatedDelta = nextAccumulated;
    if (optimisticStock >= 0) {
      api.setLocalProductStock(productId, optimisticStock);
    }

    if (entry.timerId) {
      window.clearTimeout(entry.timerId);
    }

    entry.timerId = window.setTimeout(async () => {
      const currentEntry = pendingQuickStockRef.current[productId];
      delete pendingQuickStockRef.current[productId];
      if (!currentEntry) return;

      const { baseStock, accumulatedDelta } = currentEntry;
      if (accumulatedDelta === 0) {
        api.setLocalProductStock(productId, baseStock);
        return;
      }

      try {
        const res = await api.adjustProductStock(productId, {
          mode: 'delta',
          value: accumulatedDelta,
          reason: 'ajuste',
        });
        api.setLocalProductStock(productId, res.stock);
      } catch (err: any) {
        api.setLocalProductStock(productId, baseStock);
        setStockInlineErrorByProduct((prev) => ({
          ...prev,
          [productId]: err?.message || 'O estoque não pode ficar negativo',
        }));
      }
    }, 600);
  };

  const showInlineStockSuccess = (productId: string, message: string) => {
    if (stockInlineSuccessTimersRef.current[productId]) {
      window.clearTimeout(stockInlineSuccessTimersRef.current[productId]);
    }
    setStockInlineSuccessByProduct((prev) => ({
      ...prev,
      [productId]: message,
    }));
    stockInlineSuccessTimersRef.current[productId] = window.setTimeout(() => {
      delete stockInlineSuccessTimersRef.current[productId];
      setStockInlineSuccessByProduct((prev) => {
        if (!prev[productId]) return prev;
        const next = { ...prev };
        delete next[productId];
        return next;
      });
    }, 3000);
  };

  const handleSaveInlineStockEdit = async (product: Product) => {
    if (!inlineStockEdit || inlineStockEdit.productId !== product.id || inlineStockEdit.saving) return;
    const chosenReason: StockAdjustReason = inlineStockEdit.reason || 'entrada';
    const isDeltaReason = chosenReason === 'entrada' || chosenReason === 'perda';
    const trimmed = inlineStockEdit.value.trim();
    const parsedVal = Number(trimmed);

    if (!trimmed || !Number.isInteger(parsedVal)) {
      setStockInlineErrorByProduct((prev) => ({
        ...prev,
        [product.id]: 'Informe um número inteiro.',
      }));
      return;
    }

    if (isDeltaReason && parsedVal <= 0) {
      setStockInlineErrorByProduct((prev) => ({
        ...prev,
        [product.id]: 'Informe uma quantidade maior que zero.',
      }));
      return;
    }

    if (!isDeltaReason && parsedVal < 0) {
      setStockInlineErrorByProduct((prev) => ({
        ...prev,
        [product.id]: 'O estoque não pode ficar negativo.',
      }));
      return;
    }

    const previousStock = product.stock;
    const hasStockCase = hasProductStockCase(product);
    const unitMultiplier =
      isDeltaReason && inlineStockEdit.unit === 'case' && hasStockCase
        ? Number(product.caseSize)
        : 1;
    const totalUnits = parsedVal * unitMultiplier;

    if (chosenReason === 'perda' && previousStock - totalUnits < 0) {
      setStockInlineErrorByProduct((prev) => ({
        ...prev,
        [product.id]: 'A perda não pode deixar o estoque negativo.',
      }));
      return;
    }

    setStockInlineErrorByProduct((prev) => {
      if (!prev[product.id]) return prev;
      const next = { ...prev };
      delete next[product.id];
      return next;
    });

    const mode: 'delta' | 'set' = isDeltaReason ? 'delta' : 'set';
    const apiValue =
      chosenReason === 'entrada'
        ? totalUnits
        : chosenReason === 'perda'
        ? -totalUnits
        : parsedVal;
    const optimisticStock =
      chosenReason === 'entrada'
        ? previousStock + totalUnits
        : chosenReason === 'perda'
        ? previousStock - totalUnits
        : parsedVal;

    const successMessage =
      chosenReason === 'entrada'
        ? `Entrada de ${totalUnits} un registrada`
        : chosenReason === 'perda'
        ? `Perda de ${totalUnits} un registrada`
        : chosenReason === 'contagem'
        ? `Contagem de ${parsedVal} un registrada`
        : `Ajuste para ${parsedVal} un registrado`;

    setInlineStockEdit((prev) => (prev ? { ...prev, saving: true } : null));

    if (optimisticStock >= 0) {
      api.setLocalProductStock(product.id, optimisticStock);
    }

    try {
      const res = await api.adjustProductStock(product.id, {
        mode,
        value: apiValue,
        reason: chosenReason,
      });
      api.setLocalProductStock(product.id, res.stock);
      setInlineStockEdit(null);
      showInlineStockSuccess(product.id, successMessage);
    } catch (err: any) {
      api.setLocalProductStock(product.id, previousStock);
      setInlineStockEdit((prev) => (prev ? { ...prev, saving: false } : null));
      setStockInlineErrorByProduct((prev) => ({
        ...prev,
        [product.id]: err?.message || 'O estoque não pode ficar negativo',
      }));
    }
  };

  const handleConfirmCustomStockAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stockAdjustModal) return;
    const qty = parseInt(stockAdjustModal.quantity, 10);
    if (!qty || qty <= 0) {
      setStockAdjustModal(prev => prev ? { ...prev, error: 'Informe uma quantidade inteira maior que zero.' } : null);
      return;
    }
    const delta = stockAdjustModal.mode === 'add' ? qty : -qty;
    setStockAdjustModal(prev => prev ? { ...prev, loading: true, error: undefined } : null);
    try {
      await api.adjustStock(stockAdjustModal.product.id, delta, stockAdjustModal.unit);
      setStockAdjustModal(null);
    } catch (err: any) {
      setStockAdjustModal(prev => prev ? { ...prev, loading: false, error: err?.message || 'Erro ao ajustar estoque.' } : null);
    }
  };

  const getCouponExpirationMs = (expiresAt?: string | null): number | null => {
    if (!expiresAt) return null;
    const str = String(expiresAt).trim();
    if (!str) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const ms = new Date(`${str}T23:59:59-03:00`).getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    const m = str.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.000)?(?:Z|\+00:00)$/);
    if (m) {
      const ms = new Date(`${m[1]}T23:59:59-03:00`).getTime();
      return Number.isNaN(ms) ? null : ms;
    }
    const ms = new Date(str).getTime();
    return Number.isNaN(ms) ? null : ms;
  };

  const formatCouponExpiresDate = (expiresAt?: string | null): string => {
    if (!expiresAt) return '';
    const str = String(expiresAt).trim();
    const dateMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateMatch && (/^\d{4}-\d{2}-\d{2}$/.test(str) || /T00:00:00(?:\.000)?(?:Z|\+00:00)$/.test(str))) {
      return `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
    }
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return str;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  };

  const isCouponEffectivelyActive = (c: Coupon): boolean => {
    if (!c.active) return false;
    const expMs = getCouponExpirationMs(c.expiresAt);
    if (expMs !== null && expMs < Date.now()) return false;
    if (c.maxUses !== null && c.maxUses !== undefined && c.usedCount >= c.maxUses) return false;
    return true;
  };

  // Coupon handlers
  const handleToggleCouponActive = async (coupon: Coupon) => {
    try {
      const updated = await api.updateAdminCoupon(coupon.code, { active: !coupon.active });
      setCoupons(prev => prev.map(c => c.code === coupon.code ? updated : c));
    } catch (err: any) {
      console.error('Falha ao atualizar status do cupom:', err);
    }
  };

  const handleDeleteCoupon = (code: string) => {
    setConfirmModal({
      title: 'Excluir Cupom',
      message: `Deseja realmente excluir o cupom ${code}?`,
      onConfirm: async () => {
        await api.deleteAdminCoupon(code);
        setCoupons(prev => prev.filter(c => c.code !== code));
      },
    });
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponForm.code.trim()) {
      setCouponModalError('O código do cupom é obrigatório.');
      return;
    }
    if (couponForm.value <= 0) {
      setCouponModalError('O valor do desconto deve ser maior que zero.');
      return;
    }

    setIsSavingCoupon(true);
    setCouponModalError('');
    try {
      const created = await api.createAdminCoupon({
        code: couponForm.code.toUpperCase().trim(),
        type: couponForm.type,
        value: couponForm.value,
        minOrder: couponForm.minOrder ? Number(couponForm.minOrder) : undefined,
        maxDiscount:
          couponForm.type === 'percent' && couponForm.maxDiscount
            ? Number(couponForm.maxDiscount)
            : undefined,
        maxUses: couponForm.maxUses ? Number(couponForm.maxUses) : undefined,
        expiresAt: couponForm.expiresAt ? couponForm.expiresAt.trim() : null,
        active: couponForm.active,
      });

      setCoupons(prev => [created, ...prev.filter(c => c.code !== created.code)]);
      setIsCouponModalOpen(false);
      setCouponForm({
        code: '',
        type: 'percent',
        value: 10,
        minOrder: undefined,
        maxDiscount: undefined,
        active: true,
        expiresAt: '',
        maxUses: undefined,
      });
    } catch (err: any) {
      setCouponModalError(err.message || 'Erro ao criar cupom.');
    } finally {
      setIsSavingCoupon(false);
    }
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

  const handleDeleteArea = (id: string) => {
    setConfirmModal({
      title: 'Remover Bairro',
      message: 'Tem certeza que deseja remover este bairro da sua área de entrega?',
      onConfirm: async () => {
        await api.deleteDeliveryArea(id);
      },
    });
  };

  // Product modal handlers
  const handleOpenNewProduct = () => {
    setEditingProduct(null);
    setProductModalError('');
    setProductModalSuccessNotice('');
    setProductPhotoOptimizedSummary('');
    setShowProductPhotoHelp(false);
    setShowDiscardProductConfirm(false);
    const defaultCategory = storeCategories[0]?.id || 'cervejas';
    const initialForm = {
      id: `prod-${Date.now()}`,
      name: '',
      category: defaultCategory as ProductCategory,
      volume: 'Lata 350ml',
      price: 5.00,
      sellsCase: false,
      caseSize: 0,
      casePrice: 0,
      caseChannelStore: true,
      caseChannelLocal: true,
      costPrice: 3.50,
      stock: 24,
      minStock: 12,
      isCold: true,
      active: true,
      appearsInDelivery: true,
      image: '',
      sku: `BEB-${Math.floor(100 + Math.random() * 900)}`,
      description: '',
    };
    setProductForm(initialForm);
    setInitialProductFormSnapshot(JSON.stringify(initialForm));
    setIsProductModalOpen(true);
    window.setTimeout(() => {
      productNameInputRef.current?.focus();
    }, 50);
  };

  const handleOpenEditProduct = (p: Product) => {
    if (isComboProduct(p.id, settings)) {
      setEditingComboIdForModal(p.id);
      return;
    }
    setEditingProduct(p);
    setProductModalError('');
    setProductModalSuccessNotice('');
    setProductPhotoOptimizedSummary('');
    setShowProductPhotoHelp(false);
    setShowDiscardProductConfirm(false);
    const chConfig = settings.caseSaleChannels?.[p.id];
    const hasCasePrice = hasProductCase(p);
    const sellsCase = hasCasePrice && (chConfig ? chConfig.store || chConfig.local : true);
    const initialForm = {
      id: p.id,
      name: p.name,
      category: p.category,
      volume: p.volume,
      price: p.price,
      sellsCase,
      caseSize: hasProductStockCase(p) ? Number(p.caseSize) : 0,
      casePrice: p.casePrice || 0,
      caseChannelStore: chConfig ? Boolean(chConfig.store) : true,
      caseChannelLocal: chConfig ? Boolean(chConfig.local) : true,
      costPrice: p.costPrice,
      stock: p.stock,
      minStock: p.minStock,
      isCold: p.isCold,
      active: p.active !== false,
      appearsInDelivery: !isProductHiddenFromStore(p.id, settings),
      image: p.imageUrl || p.image || '',
      sku: p.sku,
      description: p.description,
    };
    setProductForm(initialForm);
    setInitialProductFormSnapshot(JSON.stringify(initialForm));
    setIsProductModalOpen(true);
    window.setTimeout(() => {
      productNameInputRef.current?.focus();
    }, 50);
  };

  const handleDuplicateProduct = (p: Product) => {
    setEditingProduct(null);
    setProductModalError('');
    setProductModalSuccessNotice('');
    setProductPhotoOptimizedSummary('');
    setShowProductPhotoHelp(false);
    setShowDiscardProductConfirm(false);
    const chConfig = settings.caseSaleChannels?.[p.id];
    const hasCasePrice = hasProductCase(p);
    const sellsCase = hasCasePrice && (chConfig ? chConfig.store || chConfig.local : true);
    const dupForm = {
      id: `prod-${Date.now()}`,
      name: `${p.name} (cópia)`,
      category: p.category,
      volume: p.volume,
      price: p.price,
      sellsCase,
      caseSize: hasProductStockCase(p) ? Number(p.caseSize) : 0,
      casePrice: p.casePrice || 0,
      caseChannelStore: chConfig ? Boolean(chConfig.store) : true,
      caseChannelLocal: chConfig ? Boolean(chConfig.local) : true,
      costPrice: p.costPrice,
      stock: 0,
      minStock: p.minStock,
      isCold: p.isCold,
      active: p.active !== false,
      appearsInDelivery: !isProductHiddenFromStore(p.id, settings),
      image: p.imageUrl || p.image || '',
      sku: `BEB-${Math.floor(100 + Math.random() * 900)}`,
      description: p.description,
    };
    setProductForm(dupForm);
    setInitialProductFormSnapshot(JSON.stringify(dupForm));
    setIsProductModalOpen(true);
    window.setTimeout(() => {
      productNameInputRef.current?.focus();
      productNameInputRef.current?.select();
    }, 50);
  };

  const handleRequestCloseProductModal = () => {
    if (isProductFormDirty) {
      setShowDiscardProductConfirm(true);
      return;
    }
    setShowDiscardProductConfirm(false);
    setIsProductModalOpen(false);
  };

  const submitProductForm = async (mode: 'close' | 'new') => {
    setProductModalError('');
    setProductModalSuccessNotice('');

    if (!productForm.name.trim()) {
      setProductModalError('O nome do produto é obrigatório.');
      productNameInputRef.current?.focus();
      return;
    }

    let caseSize: number | null = null;
    let casePrice: number | null = null;

    const rawSize = Number(productForm.caseSize || 0);
    if (rawSize > 0) {
      if (!Number.isInteger(rawSize) || rawSize < 2 || rawSize > 100) {
        setProductModalError('Unidades por caixa deve ser um número inteiro entre 2 e 100.');
        return;
      }
      caseSize = rawSize;
    }

    if (productForm.sellsCase) {
      if (!caseSize || caseSize < 2 || caseSize > 100) {
        setProductModalError('Para vender caixa fechada, informe as unidades por caixa (2 a 100).');
        return;
      }
      const parsedPrice = Number(productForm.casePrice);
      if (Number.isNaN(parsedPrice) || parsedPrice <= 0) {
        setProductModalError('O preço da caixa fechada deve ser maior que zero.');
        return;
      }
      if (!productForm.caseChannelStore && !productForm.caseChannelLocal) {
        setProductModalError('Marque pelo menos onde vender a caixa fechada (Delivery ou Balcão/Mesa), ou desative "Vender caixa fechada".');
        return;
      }
      casePrice = Math.round(parsedPrice * 100) / 100;
    }

    const {
      sellsCase: _sellsCase,
      appearsInDelivery: _appearsInDelivery,
      caseChannelStore: _caseChannelStore,
      caseChannelLocal: _caseChannelLocal,
      ...restForm
    } = productForm;
    const productToSave: Product = {
      ...restForm,
      name: productForm.name.trim(),
      caseSize,
      casePrice,
      active: productForm.active !== false,
    };
    try {
      const savedProd = await api.saveProduct(productToSave);

      const settingsUpdates: Partial<StoreSettings> = {};

      const currentHidden = Array.isArray(settings.hiddenFromStoreIds) ? settings.hiddenFromStoreIds : [];
      const wasHidden = currentHidden.includes(savedProd.id);
      const shouldHide = productForm.appearsInDelivery === false;
      if (wasHidden !== shouldHide) {
        settingsUpdates.hiddenFromStoreIds = shouldHide
          ? [...currentHidden, savedProd.id].slice(0, 2000)
          : currentHidden.filter((id) => id !== savedProd.id);
      }

      const currentCaseChannels = { ...(settings.caseSaleChannels || {}) };
      const prevCh = currentCaseChannels[savedProd.id];
      if (productForm.sellsCase && casePrice && casePrice > 0) {
        const nextCh = {
          store: Boolean(productForm.caseChannelStore),
          local: Boolean(productForm.caseChannelLocal),
        };
        if (!prevCh || prevCh.store !== nextCh.store || prevCh.local !== nextCh.local) {
          currentCaseChannels[savedProd.id] = nextCh;
          settingsUpdates.caseSaleChannels = currentCaseChannels;
        }
      } else if (prevCh) {
        delete currentCaseChannels[savedProd.id];
        settingsUpdates.caseSaleChannels = currentCaseChannels;
      }

      if (Object.keys(settingsUpdates).length > 0) {
        setSettingsForm((prev) => ({ ...prev, ...settingsUpdates }));
        await api.updateSettings(settingsUpdates);
      }

      if (mode === 'new') {
        setEditingProduct(null);
        setShowDiscardProductConfirm(false);
        setProductPhotoOptimizedSummary('');
        const nextBlankForm = {
          id: `prod-${Date.now()}`,
          name: '',
          category: productForm.category,
          volume: productForm.volume,
          price: 0,
          sellsCase: productForm.sellsCase,
          caseSize: productForm.caseSize || 0,
          casePrice: productForm.casePrice || 0,
          caseChannelStore: productForm.caseChannelStore,
          caseChannelLocal: productForm.caseChannelLocal,
          costPrice: 0,
          stock: 0,
          minStock: productForm.minStock || 12,
          isCold: productForm.isCold,
          active: true,
          appearsInDelivery: productForm.appearsInDelivery !== false,
          image: '',
          sku: `BEB-${Math.floor(100 + Math.random() * 900)}`,
          description: '',
        };
        setProductForm(nextBlankForm);
        setInitialProductFormSnapshot(JSON.stringify(nextBlankForm));
        setProductModalSuccessNotice(`"${productToSave.name}" salvo! Cadastre o próximo produto.`);
        window.setTimeout(() => {
          productNameInputRef.current?.focus();
        }, 40);
      } else {
        setShowDiscardProductConfirm(false);
        setIsProductModalOpen(false);
      }
    } catch (err: any) {
      setProductModalError(err?.message || 'Erro ao salvar produto.');
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitProductForm('close');
  };

  const handleProductFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    const combo = formatKeyboardEventCombo(e.nativeEvent);
    const upperCombo = (combo || '').toUpperCase();
    const saveKey = (activeShortcuts.saveProduct || 'Ctrl+S').toUpperCase();
    const saveAndNewKey = (activeShortcuts.saveAndNewProduct || 'Ctrl+Enter').toUpperCase();

    if (upperCombo === saveKey || e.key.toUpperCase() === 'F9') {
      e.preventDefault();
      e.stopPropagation();
      submitProductForm('close');
      return;
    }

    if (upperCombo === saveAndNewKey) {
      e.preventDefault();
      e.stopPropagation();
      submitProductForm('new');
      return;
    }

    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toUpperCase() || '';
      if (tag === 'TEXTAREA' || tag === 'BUTTON') {
        return;
      }
      if (tag === 'INPUT' || tag === 'SELECT') {
        e.preventDefault();
        const formEl = productFormRef.current;
        if (!formEl) return;
        const fields = Array.from(
          formEl.querySelectorAll<HTMLElement>(
            'input:not([type="hidden"]):not([type="file"]):not([disabled]), select:not([disabled]), textarea:not([disabled])'
          )
        ).filter((el) => el.offsetParent !== null);
        const currentIndex = fields.indexOf(target!);
        if (currentIndex >= 0 && currentIndex + 1 < fields.length) {
          const nextField = fields[currentIndex + 1];
          nextField.focus();
          if (nextField instanceof HTMLInputElement && nextField.type !== 'checkbox') {
            nextField.select();
          }
        }
      }
    }
  };

  const handleToggleProductActive = async (p: Product) => {
    try {
      await api.saveProduct({
        ...p,
        active: !p.active,
      });
    } catch (err: any) {
      setPanelError(err?.message || 'Erro ao alterar status do produto.');
    }
  };

  const handleToggleProductDeliveryVisibility = async (productId: string) => {
    const currentHidden = Array.isArray(settings.hiddenFromStoreIds) ? settings.hiddenFromStoreIds : [];
    const isHidden = currentHidden.includes(productId);
    const nextHidden = isHidden
      ? currentHidden.filter((id) => id !== productId)
      : [...currentHidden, productId].slice(0, 2000);
    setSettingsForm((prev) => ({ ...prev, hiddenFromStoreIds: nextHidden }));
    try {
      await api.updateSettings({ hiddenFromStoreIds: nextHidden });
    } catch (err: any) {
      setPanelError(err?.message || 'Erro ao alterar visibilidade do produto no delivery.');
    }
  };

  // Preferred products ("Ordem de preferência na loja") helpers
  const validFeaturedIds = useMemo(() => {
    const raw = Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds : [];
    const productMap = new Set(products.map((p) => p.id));
    const seen = new Set<string>();
    const list: string[] = [];
    for (const id of raw) {
      if (typeof id === 'string' && productMap.has(id) && !seen.has(id)) {
        seen.add(id);
        list.push(id);
        if (list.length >= 50) break;
      }
    }
    return list;
  }, [settings.featuredProductIds, products]);

  const featuredProductsList = useMemo(() => {
    const productMap = new Map<string, Product>(products.map((p) => [p.id, p]));
    return validFeaturedIds
      .map((id) => productMap.get(id))
      .filter((p): p is Product => Boolean(p));
  }, [validFeaturedIds, products]);

  const saveFeaturedProductIds = async (nextIds: string[]) => {
    const trimmed = nextIds.slice(0, 50);
    setSettingsForm((prev) => ({ ...prev, featuredProductIds: trimmed }));
    try {
      await api.updateSettings({ featuredProductIds: trimmed });
    } catch (err: any) {
      setPanelError(err?.message || 'Erro ao atualizar a ordem de preferência na loja.');
    }
  };

  const handleToggleFeaturedProduct = async (productId: string) => {
    const exists = validFeaturedIds.includes(productId);
    if (exists) {
      await saveFeaturedProductIds(validFeaturedIds.filter((id) => id !== productId));
    } else {
      if (validFeaturedIds.length >= 50) {
        setPanelError('Você pode adicionar no máximo 50 produtos na ordem de preferência.');
        return;
      }
      await saveFeaturedProductIds([...validFeaturedIds, productId]);
    }
  };

  const handleMoveFeaturedProduct = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= validFeaturedIds.length) return;
    const next = [...validFeaturedIds];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    await saveFeaturedProductIds(next);
  };

  const handleRemoveFeaturedProduct = async (productId: string) => {
    await saveFeaturedProductIds(validFeaturedIds.filter((id) => id !== productId));
  };

  const handleDeleteProduct = (id: string) => {
    setConfirmModal({
      title: 'Remover Produto',
      message: 'Tem certeza que deseja remover este produto?',
      onConfirm: async () => {
        await api.deleteProduct(id);
      },
    });
  };

  // PDV Actions
  const getPosItemPrice = (product: Product, saleUnit: SaleUnit, addonsTotal: number = 0): number => {
    const base =
      saleUnit === 'case' && canSellProductCase(product, settings, 'local')
        ? Number(product.casePrice)
        : getEffectiveProductPrice(product);
    return Math.round((base + (Number(addonsTotal) || 0)) * 100) / 100;
  };

  const getPosUnitsPerSale = (product: Product, saleUnit: SaleUnit): number => {
    if (saleUnit === 'case' && canSellProductCase(product, settings, 'local')) {
      return Number(product.caseSize);
    }
    return 1;
  };

  const appendPosCartLine = (
    product: Product,
    saleUnit: SaleUnit = 'unit',
    qtyToAdd: number = 1,
    addons?: OrderItemAddon[],
    addonsTotal: number = 0
  ) => {
    const actualUnit: SaleUnit = saleUnit === 'case' && canSellProductCase(product, settings, 'local') ? 'case' : 'unit';
    const unitsPerSale = getPosUnitsPerSale(product, actualUnit);
    const sig = buildOrderItemAddonsSignature(addons);
    const lineId = `${product.id}::${actualUnit}::${sig}`;

    setPosCart(prev => {
      const currentTotalUnits = prev
        .filter(item => item.product.id === product.id)
        .reduce((sum, item) => sum + item.quantity * getPosUnitsPerSale(item.product, item.saleUnit), 0);

      const maxAddableQty = Math.floor(Math.max(0, product.stock - currentTotalUnits) / unitsPerSale);
      if (maxAddableQty <= 0) {
        return prev;
      }
      const effectiveAddQty = Math.min(qtyToAdd, maxAddableQty);

      const existing = prev.find(item => item.lineId === lineId);
      if (existing) {
        return prev.map(item =>
          item.lineId === lineId
            ? { ...item, quantity: item.quantity + effectiveAddQty }
            : item
        );
      }
      const isCombo = isComboProduct(product.id, settings);
      const comboItems = isCombo
        ? calculateComboMetrics(product, settings, products).orderComboItems
        : undefined;

      return [
        ...prev,
        {
          lineId,
          product,
          quantity: effectiveAddQty,
          saleUnit: actualUnit,
          addons: addons && addons.length > 0 ? addons : undefined,
          addonsTotal: addonsTotal > 0 ? addonsTotal : undefined,
          comboItems: comboItems && comboItems.length > 0 ? comboItems : undefined,
        },
      ];
    });
  };

  const addToPosCart = (product: Product, saleUnit: SaleUnit = 'unit') => {
    const actualUnit: SaleUnit = saleUnit === 'case' && canSellProductCase(product, settings, 'local') ? 'case' : 'unit';
    const applicableAddonGroups = getProductAddonGroups(product, settings);
    if (applicableAddonGroups.length > 0) {
      setPosAddonModalState({ product, saleUnit: actualUnit });
      return;
    }
    appendPosCartLine(product, actualUnit, 1);
  };

  const changePosCartLineQuantity = (lineId: string, delta: number) => {
    setPosCart(prev => {
      const existing = prev.find(item => item.lineId === lineId);
      if (!existing) return prev;

      if (delta > 0) {
        const unitsPerSale = getPosUnitsPerSale(existing.product, existing.saleUnit);
        const currentTotalUnits = prev
          .filter(item => item.product.id === existing.product.id)
          .reduce((sum, item) => sum + item.quantity * getPosUnitsPerSale(item.product, item.saleUnit), 0);
        if (currentTotalUnits + delta * unitsPerSale > existing.product.stock) {
          return prev;
        }
        return prev.map(item =>
          item.lineId === lineId ? { ...item, quantity: item.quantity + delta } : item
        );
      }

      const next =
        existing.quantity + delta <= 0
          ? prev.filter(item => item.lineId !== lineId)
          : prev.map(item =>
              item.lineId === lineId ? { ...item, quantity: item.quantity + delta } : item
            );
      if (next.length === 0) {
        setPosClientRequestId(crypto.randomUUID());
      }
      return next;
    });
  };

  const posSubtotal = useMemo(() => {
    return posCart.reduce(
      (sum, item) =>
        sum + getPosItemPrice(item.product, item.saleUnit, item.addonsTotal || 0) * item.quantity,
      0
    );
  }, [posCart]);

  const posHasCashTyped = posCashGiven.trim() !== '';
  const posCashNum = posHasCashTyped ? parseFloat(posCashGiven) : 0;
  const posCashShortfallCents =
    posPaymentMethod === 'dinheiro' && posHasCashTyped
      ? Math.round(posSubtotal * 100) - Math.round((Number.isNaN(posCashNum) ? 0 : posCashNum) * 100)
      : 0;
  const isPosCashShort =
    posPaymentMethod === 'dinheiro' && posHasCashTyped && (Number.isNaN(posCashNum) || posCashShortfallCents > 0);
  const posCashShortfall = Math.max(0, posCashShortfallCents / 100);

  const handleFinishPosSale = async () => {
    if (posCart.length === 0 || isSubmittingPos || isPosCashShort) return;
    setIsSubmittingPos(true);
    setPosError('');
    setPosCanRetry(false);
    setPosSubmittingStatus('');
    try {
      const shouldSendCash =
        posPaymentMethod === 'dinheiro' &&
        posHasCashTyped &&
        !Number.isNaN(posCashNum) &&
        Math.round(posCashNum * 100) >= Math.round(posSubtotal * 100);

      const order = await api.createOrder(
        {
          source: 'balcao',
          clientRequestId: posClientRequestId,
          customer: {
            name: posCustomerName.trim() || 'Cliente Balcão',
            phone: '(Balcão)',
            address: 'Venda Presencial no Depósito',
            number: 'Balcão',
            neighborhood: 'Loja Física',
          },
          deliveryType: 'retirada',
          items: posCart.map(i => {
            const isCase = i.saleUnit === 'case' && canSellProductCase(i.product, settings, 'local');
            const unitsPerSale = isCase ? Number(i.product.caseSize) : 1;
            const baseUnitPrice = isCase
              ? Number(i.product.casePrice)
              : getEffectiveProductPrice(i.product);
            const unitPrice = getPosItemPrice(i.product, i.saleUnit, i.addonsTotal || 0);
            return {
              productId: i.product.id,
              name: i.product.name,
              volume: i.product.volume,
              price: unitPrice,
              originalPrice: (isCase ? baseUnitPrice : i.product.price) + (i.addonsTotal || 0),
              costPrice: i.product.costPrice * unitsPerSale,
              quantity: i.quantity,
              saleUnit: isCase ? 'case' : 'unit',
              unitsPerSale,
              isCold: i.product.isCold,
              addons: i.addons && i.addons.length > 0 ? i.addons : undefined,
              addonsTotal: i.addonsTotal || undefined,
              comboItems: i.comboItems && i.comboItems.length > 0 ? i.comboItems : undefined,
            };
          }),
          subtotal: posSubtotal,
          deliveryFee: 0,
          total: posSubtotal,
          paymentMethod: posPaymentMethod,
          cashChangeFor: shouldSendCash ? Math.round(posCashNum * 100) / 100 : undefined,
        },
        {
          onStatusMessage: (msg) => setPosSubmittingStatus(msg),
        }
      );

      if (order.status !== 'concluido') {
        await api.updateOrderStatus(order.id, 'concluido').catch(() => {});
      }
      setSelectedReceiptOrder({ ...order, status: 'concluido' });

      setPosCart([]);
      setPosCashGiven('');
      setPosCustomerName('Cliente Balcão');
      setPosError('');
      setPosCanRetry(false);
      setPosSubmittingStatus('');
      setIsSubmittingPos(false);
      setPosClientRequestId(crypto.randomUUID());
    } catch (err: any) {
      console.error('Falha ao processar venda balcão:', err);
      setPosSubmittingStatus('');
      if (err?.isNetworkRetryExhausted || isNetworkOrTimeoutError(err)) {
        // Mantém o MESMO posClientRequestId para não duplicar ao tocar em "Tentar de novo"
        setPosError(ORDER_NETWORK_EXHAUSTED_MESSAGE);
        setPosCanRetry(true);
      } else {
        setPosCanRetry(false);
        setPosError(err.message || 'Não foi possível finalizar a venda.');
      }
    } finally {
      setIsSubmittingPos(false);
    }
  };

  // Financial Stats Calculation
  const financialStats = useMemo(() => {
    const today = new Date().toDateString();
    const todayOrders = localOrders.filter(
      o => new Date(o.createdAt).toDateString() === today && o.status !== 'cancelado'
    );
    const totalRevenueToday = todayOrders.reduce((sum, o) => sum + o.total, 0);

    let totalCostToday = 0;
    let serviceFeeTotalToday = 0;
    todayOrders.forEach(o => {
      o.items.forEach(it => {
        const cost = it.costPrice || it.price * 0.65;
        totalCostToday += cost * it.quantity;
      });
      if (o.notes) {
        const match = o.notes.match(/Taxa de servi[çc]o\s*\(\d+(?:[.,]\d+)?%\)\s*:\s*R\$\s*(\d+(?:[.,]\d+)?)/i);
        if (match && match[1]) {
          serviceFeeTotalToday += parseFloat(match[1].replace(',', '.')) || 0;
        }
      }
    });

    const netProfitToday = Math.max(0, totalRevenueToday - totalCostToday);
    const avgTicket = todayOrders.length > 0 ? totalRevenueToday / todayOrders.length : 0;

    const onlineOrders = todayOrders.filter(o => o.source === 'online');
    const posOrders = todayOrders.filter(o => o.source === 'balcao');
    const mesaOrders = todayOrders.filter(o => o.source === 'mesa');

    const onlineOrdersCount = onlineOrders.length;
    const posOrdersCount = posOrders.length;
    const mesaOrdersCount = mesaOrders.length;

    const onlineRevenue = onlineOrders.reduce((s, o) => s + o.total, 0);
    const posRevenue = posOrders.reduce((s, o) => s + o.total, 0);
    const mesaRevenue = mesaOrders.reduce((s, o) => s + o.total, 0);

    const paymentBreakdown = {
      pix: todayOrders.filter(o => o.paymentMethod === 'pix').reduce((s, o) => s + o.total, 0),
      cartao_credito: todayOrders.filter(o => o.paymentMethod === 'cartao_credito').reduce((s, o) => s + o.total, 0),
      cartao_debito: todayOrders.filter(o => o.paymentMethod === 'cartao_debito').reduce((s, o) => s + o.total, 0),
      dinheiro: todayOrders.filter(o => o.paymentMethod === 'dinheiro').reduce((s, o) => s + o.total, 0),
    };

    const activeNonComboProducts = products.filter(
      (p) => p.active && !isComboProduct(p.id, settings)
    );
    const totalStockUnits = activeNonComboProducts.reduce(
      (sum, p) => sum + Math.max(0, Number(p.stock) || 0),
      0
    );
    const totalStockCostValue =
      Math.round(
        activeNonComboProducts.reduce(
          (sum, p) => sum + Math.max(0, Number(p.costPrice) || 0) * Math.max(0, Number(p.stock) || 0),
          0
        ) * 100
      ) / 100;
    const totalStockSaleValue =
      Math.round(
        activeNonComboProducts.reduce(
          (sum, p) => sum + Math.max(0, Number(p.price) || 0) * Math.max(0, Number(p.stock) || 0),
          0
        ) * 100
      ) / 100;
    const totalStockValue = totalStockCostValue;

    return {
      todayOrdersCount: todayOrders.length,
      totalRevenueToday,
      netProfitToday,
      avgTicket,
      onlineOrdersCount,
      posOrdersCount,
      mesaOrdersCount,
      onlineRevenue,
      posRevenue,
      mesaRevenue,
      serviceFeeTotalToday: Math.round(serviceFeeTotalToday * 100) / 100,
      paymentBreakdown,
      totalStockUnits,
      totalStockCostValue,
      totalStockSaleValue,
      totalStockValue,
    };
  }, [localOrders, products, settings]);

  // =========================================================
  // EXPEDIENTE (CAIXA) & HISTÓRICO DE PAGAMENTOS STATE
  // =========================================================
  const [currentCashSession, setCurrentCashSession] = useState<CashSession | null>(null);
  const [latestClosedCashSession, setLatestClosedCashSession] = useState<CashSession | null>(null);
  const [openTablesCountForCash, setOpenTablesCountForCash] = useState<number>(0);
  const [cashSessionsList, setCashSessionsList] = useState<CashSession[]>([]);
  const [isLoadingCashData, setIsLoadingCashData] = useState<boolean>(false);

  const [isOpenCashModalOpen, setIsOpenCashModalOpen] = useState<boolean>(false);
  const [isCloseCashModalOpen, setIsCloseCashModalOpen] = useState<boolean>(false);
  const [closingReceiptSession, setClosingReceiptSession] = useState<CashSession | null>(null);

  const [financeiroSubTab, setFinanceiroSubTab] = useState<'resumo' | 'pagamentos'>('resumo');
  const [financeiroFilterMode, setFinanceiroFilterMode] = useState<
    'current_session' | 'session' | 'date_range'
  >('current_session');
  const [selectedFinanceiroSessionId, setSelectedFinanceiroSessionId] = useState<string>('');
  const [financeiroDateFrom, setFinanceiroDateFrom] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [financeiroDateTo, setFinanceiroDateTo] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [rangeSummary, setRangeSummary] = useState<CashSessionSummary | null>(null);
  const [isLoadingRangeSummary, setIsLoadingRangeSummary] = useState<boolean>(false);

  const refreshCashSessionsData = React.useCallback(async (includeHistory = false) => {
    try {
      setIsLoadingCashData(true);
      const currentRes = await api.getCurrentCashSession();
      setCurrentCashSession(currentRes.session || null);
      setOpenTablesCountForCash(currentRes.openTablesCount || 0);
      if (currentRes.latestClosedSession) {
        setLatestClosedCashSession(currentRes.latestClosedSession);
      }
      if (includeHistory) {
        const listRes = await api.getCashSessions(30);
        setCashSessionsList(listRes || []);
        if (!currentRes.latestClosedSession) {
          const firstClosed = (listRes || []).find((s) => Boolean(s.closedAt)) || null;
          setLatestClosedCashSession(firstClosed);
        }
      }
    } catch (err) {
      console.error('Erro ao consultar expediente atual:', err);
    } finally {
      setIsLoadingCashData(false);
    }
  }, []);

  useEffect(() => {
    refreshCashSessionsData(true);
  }, [refreshCashSessionsData]);

  useEffect(() => {
    if (activeTab === 'financeiro') {
      refreshCashSessionsData(true);
    } else if (activeTab === 'pdv' || activeTab === 'mesas') {
      refreshCashSessionsData(false);
    }
  }, [activeTab, localOrders.length, refreshCashSessionsData]);

  useEffect(() => {
    if (activeTab !== 'financeiro' || financeiroFilterMode !== 'date_range') return;
    let cancelled = false;
    const loadRange = async () => {
      setIsLoadingRangeSummary(true);
      try {
        const fromIso = financeiroDateFrom
          ? new Date(`${financeiroDateFrom}T00:00:00`).toISOString()
          : new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
        const toIso = financeiroDateTo
          ? new Date(`${financeiroDateTo}T23:59:59.999`).toISOString()
          : new Date().toISOString();
        const res = await api.getCashSummaryByRange(fromIso, toIso);
        if (!cancelled) {
          setRangeSummary(res.summary);
        }
      } catch (err) {
        console.error('Erro ao carregar resumo por período:', err);
      } finally {
        if (!cancelled) {
          setIsLoadingRangeSummary(false);
        }
      }
    };
    loadRange();
    return () => {
      cancelled = true;
    };
  }, [activeTab, financeiroFilterMode, financeiroDateFrom, financeiroDateTo, localOrders.length]);

  const handleOpenCashSessionSuccess = async (session: CashSession) => {
    setCurrentCashSession(session);
    setSettingsForm((prev) => ({ ...prev, isOpen: true }));
    await refreshCashSessionsData(true);
  };

  const handleCloseCashSessionSuccess = async (closedSession: CashSession) => {
    setCurrentCashSession(null);
    setLatestClosedCashSession(closedSession);
    setSettingsForm((prev) => ({ ...prev, isOpen: false }));
    setIsCloseCashModalOpen(false);
    await refreshCashSessionsData(true);
    setClosingReceiptSession(closedSession);
  };

  const displayedCashSession = useMemo<CashSession | null>(() => {
    if (financeiroFilterMode === 'date_range') return null;
    if (financeiroFilterMode === 'session' && selectedFinanceiroSessionId) {
      return (
        cashSessionsList.find((s) => s.id === selectedFinanceiroSessionId) ||
        (currentCashSession?.id === selectedFinanceiroSessionId ? currentCashSession : null) ||
        latestClosedCashSession
      );
    }
    return currentCashSession || latestClosedCashSession || cashSessionsList[0] || null;
  }, [
    financeiroFilterMode,
    selectedFinanceiroSessionId,
    cashSessionsList,
    currentCashSession,
    latestClosedCashSession,
  ]);

  const displayedSummary = useMemo<CashSessionSummary>(() => {
    if (financeiroFilterMode === 'date_range' && rangeSummary) {
      return rangeSummary;
    }
    if (displayedCashSession?.summary) {
      return displayedCashSession.summary;
    }
    return {
      ordersCount: 0,
      totalRevenue: 0,
      netProfit: 0,
      avgTicket: 0,
      onlineCount: 0,
      onlineRevenue: 0,
      posCount: 0,
      posRevenue: 0,
      mesaCount: 0,
      mesaRevenue: 0,
      paymentBreakdown: {
        dinheiro: 0,
        pix: 0,
        cartao_debito: 0,
        cartao_credito: 0,
      },
      serviceFeeTotal: 0,
      discountTotal: 0,
      cancelledCount: 0,
      openingCash: displayedCashSession?.openingCash || 0,
      expectedCash: displayedCashSession?.openingCash || 0,
      countedCash: displayedCashSession?.countedCash ?? null,
      cashDifference: null,
    };
  }, [financeiroFilterMode, rangeSummary, displayedCashSession]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.updateSettings(settingsForm);
      setSettingsSavedMessage(true);
      setTimeout(() => setSettingsSavedMessage(false), 3000);
    } catch (err) {
      console.error('Falha ao salvar configurações:', err);
    }
  };

  // Active keyboard shortcuts (merging defaults with saved settings)
  const activeShortcuts = useMemo<Record<ShortcutAction, string>>(() => {
    return {
      ...DEFAULT_SHORTCUTS,
      ...(settings.shortcuts || {}),
    };
  }, [settings.shortcuts]);

  const finishPosSaleRef = React.useRef(handleFinishPosSale);
  finishPosSaleRef.current = handleFinishPosSale;

  // Capture key when owner clicks "Alterar" in Configurações -> Atalhos do teclado
  useEffect(() => {
    if (!recordingShortcutAction) return;

    const handleRecordKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const combo = formatKeyboardEventCombo(e);
      if (!combo) return;

      const upperCombo = combo.toUpperCase();
      if (FORBIDDEN_BROWSER_SHORTCUTS.has(upperCombo)) {
        setShortcutWarning(
          `A tecla "${combo}" é reservada pelo navegador e não pode ser usada como atalho.`
        );
        setRecordingShortcutAction(null);
        return;
      }

      const currentShortcuts: Record<ShortcutAction, string> = {
        ...DEFAULT_SHORTCUTS,
        ...(settingsForm.shortcuts || {}),
      };

      const duplicateEntry = SHORTCUT_ACTION_ITEMS.find(
        (item) =>
          item.action !== recordingShortcutAction &&
          (currentShortcuts[item.action] || '').toUpperCase() === upperCombo
      );

      if (duplicateEntry) {
        setShortcutWarning(
          `⚠ A tecla "${formatShortcutDisplay(combo)}" já está em uso em "${duplicateEntry.label}".`
        );
      } else {
        setShortcutWarning('');
      }

      const updatedShortcuts = {
        ...currentShortcuts,
        [recordingShortcutAction]: combo,
      };
      setSettingsForm((prev) => ({
        ...prev,
        shortcuts: updatedShortcuts,
      }));
      setRecordingShortcutAction(null);
    };

    window.addEventListener('keydown', handleRecordKey, true);
    return () => window.removeEventListener('keydown', handleRecordKey, true);
  }, [recordingShortcutAction, settingsForm.shortcuts]);

  const openNewProductRef = React.useRef(handleOpenNewProduct);
  openNewProductRef.current = handleOpenNewProduct;
  const requestCloseProductModalRef = React.useRef(handleRequestCloseProductModal);
  requestCloseProductModalRef.current = handleRequestCloseProductModal;
  const submitProductFormRef = React.useRef(submitProductForm);
  submitProductFormRef.current = submitProductForm;

  // Desktop Keyboard Shortcuts Listener (/control-panel)
  useEffect(() => {
    if (recordingShortcutAction) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only active on desktop screens
      if (window.innerWidth < 768) return;

      const combo = formatKeyboardEventCombo(e);
      if (!combo) return;
      const upperCombo = combo.toUpperCase();

      const pdvKey = (activeShortcuts.pdv || 'F2').toUpperCase();
      const mesasKey = (activeShortcuts.mesas || 'F3').toUpperCase();
      const pedidosKey = (activeShortcuts.pedidos || 'F4').toUpperCase();
      const estoqueKey = (activeShortcuts.estoque || 'F8').toUpperCase();
      const finalizarKey = (activeShortcuts.finalizar || 'F9').toUpperCase();
      const buscaKey = (activeShortcuts.busca || '/').toUpperCase();
      const fecharKey = (activeShortcuts.fecharModal || 'Escape').toUpperCase();
      const newProductKey = (activeShortcuts.newProduct || 'F6').toUpperCase();
      const saveProductKey = (activeShortcuts.saveProduct || 'Ctrl+S').toUpperCase();
      const saveAndNewKey = (activeShortcuts.saveAndNewProduct || 'Ctrl+Enter').toUpperCase();

      // If Product Modal is open, handle Ctrl+S / F9 / Ctrl+Enter / Esc directly
      if (isProductModalOpen) {
        if (upperCombo === saveProductKey || e.key.toUpperCase() === 'F9') {
          e.preventDefault();
          e.stopPropagation();
          submitProductFormRef.current('close');
          return;
        }
        if (upperCombo === saveAndNewKey) {
          e.preventDefault();
          e.stopPropagation();
          submitProductFormRef.current('new');
          return;
        }
        const isFecharModal =
          upperCombo === fecharKey || (fecharKey === 'ESC' && e.key === 'Escape');
        if (isFecharModal) {
          e.preventDefault();
          e.stopPropagation();
          requestCloseProductModalRef.current();
          return;
        }
      }

      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toUpperCase() || '';
      const isTextField =
        tagName === 'INPUT' ||
        tagName === 'TEXTAREA' ||
        tagName === 'SELECT' ||
        Boolean(target?.isContentEditable);

      // Always preventDefault on F2, F3, F4, F6, F8, F9 (and configured action equivalents when triggered)
      if (['F2', 'F3', 'F4', 'F6', 'F8', 'F9'].includes(e.key.toUpperCase())) {
        e.preventDefault();
      }

      const isPdvShortcut = upperCombo === pdvKey;
      const isFinalizarShortcut = upperCombo === finalizarKey;
      const isNewProductShortcut = upperCombo === newProductKey;
      const isFecharShortcut =
        upperCombo === fecharKey || (fecharKey === 'ESC' && e.key === 'Escape');

      // Rule 3b: Do not fire shortcuts when cursor is inside a text field (input, textarea, select), EXCEPT F2 (pdv), F6 (newProduct), F9 (finalizar), and Esc (fecharModal)
      const allowedInInput =
        isPdvShortcut ||
        isFinalizarShortcut ||
        isNewProductShortcut ||
        isFecharShortcut ||
        e.key.toUpperCase() === 'F2' ||
        e.key.toUpperCase() === 'F6' ||
        e.key.toUpperCase() === 'F9' ||
        e.key === 'Escape';

      if (isTextField && !allowedInInput) {
        return;
      }

      if (isFecharShortcut) {
        if (isShortcutsModalOpen) {
          e.preventDefault();
          setIsShortcutsModalOpen(false);
          return;
        }
        if (isMultiRouteModalOpen) {
          e.preventDefault();
          setIsMultiRouteModalOpen(false);
          return;
        }
        if (confirmModal && !confirmModal.loading) {
          e.preventDefault();
          setConfirmModal(null);
          return;
        }
        if (cancelOrderModal && !cancelOrderModal.loading) {
          e.preventDefault();
          setCancelOrderModal(null);
          return;
        }
        if (stockAdjustModal && !stockAdjustModal.loading) {
          e.preventDefault();
          setStockAdjustModal(null);
          return;
        }
        if (isPromoModalOpen) {
          e.preventDefault();
          setIsPromoModalOpen(false);
          return;
        }
        if (isCouponModalOpen) {
          e.preventDefault();
          setIsCouponModalOpen(false);
          return;
        }
        if (isCustomerModalOpen) {
          e.preventDefault();
          setIsCustomerModalOpen(false);
          setEditingCustomer(null);
          return;
        }
        if (isQRCodeModalOpen) {
          e.preventDefault();
          setIsQRCodeModalOpen(false);
          return;
        }
        if (selectedReceiptOrder) {
          e.preventDefault();
          setSelectedReceiptOrder(null);
          return;
        }
        if (isProductModalOpen) {
          e.preventDefault();
          requestCloseProductModalRef.current();
          return;
        }
        if (isAreaModalOpen) {
          e.preventDefault();
          setIsAreaModalOpen(false);
          return;
        }
        if (isImportModalOpen) {
          e.preventDefault();
          setIsImportModalOpen(false);
          return;
        }
        return;
      }

      if (isNewProductShortcut) {
        e.preventDefault();
        setActiveTab('estoque');
        openNewProductRef.current();
        return;
      }

      if (isPdvShortcut) {
        e.preventDefault();
        setActiveTab('pdv');
        window.setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('[data-admin-search="pdv"]');
          if (input) {
            input.focus();
            input.select();
          }
        }, 40);
        return;
      }

      if (upperCombo === mesasKey) {
        e.preventDefault();
        setActiveTab('mesas');
        return;
      }

      if (upperCombo === pedidosKey) {
        e.preventDefault();
        setActiveTab('pedidos');
        return;
      }

      if (upperCombo === estoqueKey) {
        e.preventDefault();
        setActiveTab('estoque');
        return;
      }

      if (isFinalizarShortcut) {
        e.preventDefault();
        if (activeTab === 'pdv') {
          finishPosSaleRef.current();
        }
        return;
      }

      if (upperCombo === buscaKey) {
        e.preventDefault();
        // Focus search input of currently open modal or active tab
        const comandaSearch = document.querySelector<HTMLInputElement>('[data-admin-search="comanda"]');
        if (comandaSearch) {
          comandaSearch.focus();
          return;
        }
        const tabSearch = document.querySelector<HTMLInputElement>(`[data-admin-search="${activeTab}"]`);
        if (tabSearch) {
          tabSearch.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    recordingShortcutAction,
    activeShortcuts,
    activeTab,
    isShortcutsModalOpen,
    isMultiRouteModalOpen,
    confirmModal,
    cancelOrderModal,
    stockAdjustModal,
    isPromoModalOpen,
    isCouponModalOpen,
    isCustomerModalOpen,
    isQRCodeModalOpen,
    selectedReceiptOrder,
    isProductModalOpen,
    isAreaModalOpen,
    isImportModalOpen,
  ]);

  // Multi-order route calculation (nearest-neighbor from store, max 9 stops)
  const selectedRouteOrders = useMemo(() => {
    const idSet = new Set(selectedRouteOrderIds);
    return localOrders.filter((o) => idSet.has(o.id)).slice(0, 9);
  }, [localOrders, selectedRouteOrderIds]);

  const multiRouteResult = useMemo(() => {
    if (selectedRouteOrders.length === 0) {
      return { url: '', orderedStops: [] };
    }
    return buildMultiStopDeliveryRoute(selectedRouteOrders, settings);
  }, [selectedRouteOrders, settings]);

  useEffect(() => {
    let active = true;
    if (!isMultiRouteModalOpen || !multiRouteResult.url) {
      setMultiRouteQrDataUrl('');
      return;
    }
    QRCode.toDataURL(multiRouteResult.url, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (active) setMultiRouteQrDataUrl(url);
      })
      .catch(() => {
        if (active) setMultiRouteQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [isMultiRouteModalOpen, multiRouteResult.url]);

  const toggleSelectOrderForRoute = (orderId: string) => {
    setSelectedRouteOrderIds((prev) => {
      if (prev.includes(orderId)) {
        return prev.filter((id) => id !== orderId);
      }
      if (prev.length >= 9) {
        setPanelError('A rota com vários pedidos permite no máximo 9 paradas por vez.');
        return prev;
      }
      return [...prev, orderId];
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-20 overflow-x-hidden">
      {panelError && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-800 rounded-2xl shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs font-bold">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <span>{panelError}</span>
          </div>
          <button
            type="button"
            onClick={() => setPanelError('')}
            className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-black transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      )}

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

      {/* Fixed Top Bar: Expediente (Caixa) & Loja Online Toggle (2a & 2e) */}
      <div className="mb-4 bg-white p-3 sm:px-4 rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          {currentCashSession ? (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-100 text-emerald-900 border border-emerald-300 text-xs sm:text-sm font-black">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span>
                Expediente aberto desde {formatCashSessionBadgeDate(currentCashSession.openedAt)}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-200 text-neutral-700 border border-neutral-300 text-xs sm:text-sm font-bold">
              <span className="w-2.5 h-2.5 rounded-full bg-neutral-500 shrink-0" />
              <span>Expediente fechado</span>
            </span>
          )}

          {currentCashSession ? (
            <button
              type="button"
              onClick={async () => {
                await refreshCashSessionsData(false);
                setIsCloseCashModalOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs transition-colors shadow-2xs cursor-pointer"
            >
              Fechar expediente
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsOpenCashModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition-colors shadow-2xs cursor-pointer"
            >
              Abrir expediente
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !settingsForm.isOpen;
              setSettingsForm((prev) => ({ ...prev, isOpen: next }));
              api.updateSettings({ isOpen: next });
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer ${
              settingsForm.isOpen
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                : 'bg-neutral-100 text-neutral-600 border-neutral-300 hover:bg-neutral-200'
            }`}
            title="Abrir ou pausar a loja online independentemente do expediente"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                settingsForm.isOpen ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
            <span>Loja: {settingsForm.isOpen ? 'Aberta' : 'Fechada'}</span>
          </button>
        </div>
      </div>

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
            <span
              className={`hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${
                activeTab === 'pedidos'
                  ? 'bg-black/20 text-white'
                  : 'bg-neutral-200/80 text-neutral-600'
              }`}
            >
              {formatShortcutDisplay(activeShortcuts.pedidos)}
            </span>
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
            <span
              className={`hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${
                activeTab === 'estoque'
                  ? 'bg-black/20 text-white'
                  : 'bg-neutral-200/80 text-neutral-600'
              }`}
            >
              {formatShortcutDisplay(activeShortcuts.estoque)}
            </span>
            {lowStockProducts.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold flex items-center justify-center">
                {lowStockProducts.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('promocoes')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'promocoes' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Tag className="w-4 h-4" />
            <span>Promoções</span>
            {activePromotions.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-red-600 text-white text-[10px] font-black flex items-center justify-center">
                {activePromotions.length}
              </span>
            )}
          </button>

          {/* Mesas & Comandas Tab */}
          <button
            onClick={() => setActiveTab('mesas')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'mesas' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Utensils className="w-4 h-4" />
            <span>Mesas & Comandas</span>
            <span
              className={`hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${
                activeTab === 'mesas'
                  ? 'bg-black/20 text-white'
                  : 'bg-neutral-200/80 text-neutral-600'
              }`}
            >
              {formatShortcutDisplay(activeShortcuts.mesas)}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('pdv')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'pdv' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <ShoppingCart className="w-4 h-4" />
            <span>PDV Balcão</span>
            <span
              className={`hidden md:inline-block text-[10px] font-mono px-1.5 py-0.5 rounded ${
                activeTab === 'pdv'
                  ? 'bg-black/20 text-white'
                  : 'bg-neutral-200/80 text-neutral-600'
              }`}
            >
              {formatShortcutDisplay(activeShortcuts.pdv)}
            </span>
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

          {/* Cupons de Desconto Tab */}
          <button
            onClick={() => setActiveTab('cupons')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              activeTab === 'cupons' ? 'bg-amber-500 text-white shadow-sm' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <Ticket className="w-4 h-4" />
            <span>Cupons ({coupons.length})</span>
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
        <div className="flex flex-wrap items-center gap-2 px-1 sm:px-2 w-full sm:w-auto justify-end pt-2 sm:pt-0 border-t sm:border-t-0 border-neutral-100">
          <button
            type="button"
            onClick={() => setIsShortcutsModalOpen(true)}
            className="hidden md:inline-flex items-center justify-center w-8 h-8 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl text-xs font-black transition-colors cursor-pointer"
            title="Atalhos do teclado (?)"
          >
            ?
          </button>

          <button
            onClick={() => setIsQRCodeModalOpen(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold transition-colors"
          >
            <QrCode className="w-4 h-4 text-amber-400" />
            <span>QR Code</span>
          </button>

          <button
            onClick={onPreviewCustomerView}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl text-xs font-bold transition-colors"
            title="Ver o site como o cliente vê"
          >
            <span>👁️ Visualizar Loja</span>
          </button>

          <button
            onClick={onLockDashboard}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-colors"
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

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={selectedRouteOrderIds.length === 0}
                onClick={() => setIsMultiRouteModalOpen(true)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black transition-all ${
                  selectedRouteOrderIds.length > 0
                    ? 'bg-amber-500 hover:bg-amber-600 text-neutral-950 shadow-sm cursor-pointer'
                    : 'bg-neutral-100 text-neutral-400 border border-neutral-200 cursor-not-allowed'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Montar rota ({selectedRouteOrderIds.length})</span>
              </button>
              {selectedRouteOrderIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedRouteOrderIds([])}
                  className="px-2.5 py-2 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-xs font-bold transition-colors cursor-pointer"
                >
                  Limpar seleção
                </button>
              )}
              <div className="flex items-center gap-2 text-xs text-neutral-500 ml-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                <span className="hidden sm:inline">Monitoramento em tempo real ativo</span>
              </div>
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

                const isRouteEligible =
                  order.deliveryType === 'delivery' &&
                  order.source !== 'balcao' &&
                  order.source !== 'mesa' &&
                  (isSeparating || isEnRoute);
                const isSelectedForRoute = selectedRouteOrderIds.includes(order.id);

                const waPhone = formatWhatsAppPhone(order.customer?.phone);

                return (
                  <div
                    key={order.id}
                    className={`bg-white rounded-3xl border transition-all p-4 sm:p-5 shadow-xs flex flex-col justify-between min-w-0 overflow-hidden ${
                      isSelectedForRoute
                        ? 'border-amber-500 ring-2 ring-amber-500/30'
                        : isPending
                        ? 'border-amber-400 ring-2 ring-amber-400/30'
                        : 'border-neutral-300'
                    }`}
                  >
                    <div>
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-100 pb-3 mb-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                            {isRouteEligible && (
                              <label
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-950 text-[11px] font-bold cursor-pointer select-none"
                                title="Selecionar pedido para montar rota do motoboy"
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelectedForRoute}
                                  onChange={() => toggleSelectOrderForRoute(order.id)}
                                  className="w-3.5 h-3.5 rounded text-amber-600 focus:ring-amber-500 cursor-pointer"
                                />
                                <span>Rota</span>
                              </label>
                            )}
                            <span className="font-black text-base text-neutral-900">#{order.id}</span>
                            <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                              order.source === 'online'
                                ? 'bg-sky-100 text-sky-800 border border-sky-200'
                                : order.source === 'mesa'
                                ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            }`}>
                              {order.source === 'online' ? '📱 Site Online' : order.source === 'mesa' ? '🍽️ Mesa' : '🏪 Venda Balcão'}
                            </span>
                            {order.source === 'online' && !order.customerId && (
                              <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                                Sem cadastro
                              </span>
                            )}
                            <span className="text-xs text-neutral-400 font-medium">{formatDate(order.createdAt)}</span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="font-bold text-neutral-800 break-words">{order.customer.name}</span>
                            {order.customer.phone && (
                              <>
                                <span className="text-neutral-400">•</span>
                                <span className="text-neutral-600">{order.customer.phone}</span>
                              </>
                            )}
                          </div>
                        </div>

                        <span className={`px-2.5 py-1 rounded-xl text-xs font-black uppercase shrink-0 ${
                          isPending ? 'bg-amber-100 text-amber-900 animate-pulse' :
                          isSeparating ? 'bg-blue-100 text-blue-900' :
                          isEnRoute ? 'bg-purple-100 text-purple-900' :
                          isCompleted ? 'bg-emerald-100 text-emerald-800' :
                          'bg-neutral-100 text-neutral-600'
                        }`}>
                          {isPending && 'Pendente / Novo'}
                          {isSeparating && 'Em Separação'}
                          {isEnRoute && (order.deliveryType === 'delivery' ? 'Pronto / Em Rota' : 'Pronto Retirada')}
                          {isCompleted && 'Concluído'}
                          {isCanceled && 'Cancelado'}
                        </span>
                      </div>

                      <div className="bg-neutral-50 p-3 rounded-2xl text-xs mb-3 space-y-1.5 border border-neutral-100">
                        {order.deliveryType === 'delivery' ? (
                          <>
                            {!(order.customer.location_verified ?? order.customer.locationVerified) && (
                              <div className="px-2.5 py-1.5 rounded-xl bg-amber-100 border border-amber-300 text-amber-900 font-bold text-[11px] flex items-center gap-1.5">
                                <span>⚠ Localização não verificada — confira o endereço antes de enviar</span>
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 font-bold text-neutral-900">
                                <Truck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                <span>Entrega</span>
                              </div>
                              <a
                                href={buildSingleDeliveryRouteUrl(order.customer)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-bold text-[11px] transition-colors shrink-0"
                              >
                                <MapPin className="w-3 h-3" />
                                <span>Ver no mapa</span>
                              </a>
                            </div>
                            <p className="text-neutral-800 font-medium leading-snug">
                              {order.customer.address}, {order.customer.number} - <strong>{order.customer.neighborhood}</strong>
                              {order.customer.complement ? ` (${order.customer.complement})` : ''}
                              {order.customer.cep ? ` • CEP: ${order.customer.cep}` : ''}
                            </p>
                          </>
                        ) : order.source === 'mesa' || order.deliveryType === 'local' ? (
                          <div className="flex items-center gap-1.5 font-bold text-neutral-900">
                            <Utensils className="w-3.5 h-3.5 text-purple-600" />
                            <span>Consumo no Local: <strong>{order.customer.address || order.customer.name}</strong></span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 font-bold text-neutral-900">
                            <Package className="w-3.5 h-3.5 text-amber-600" />
                            <span>Retirada Presencial no Depósito</span>
                          </div>
                        )}
                        {order.customer.reference && (
                          <p className="text-neutral-600 italic">Ponto de Ref: {order.customer.reference}</p>
                        )}
                        {order.notes && (
                          <p className="text-amber-800 font-semibold bg-amber-50 p-1 rounded">Obs: {order.notes}</p>
                        )}
                      </div>

                      <div className="space-y-1.5 mb-4 text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400 block mb-1">
                          Itens do Pedido ({order.items.reduce((s, i) => s + i.quantity * (i.unitsPerSale || 1), 0)} un):
                        </span>
                        {order.items.map((it, idx) => {
                          const isCase = it.saleUnit === 'case';
                          const wasPromo = !isCase && it.originalPrice !== undefined && it.originalPrice > it.price;
                          return (
                            <div key={idx} className="flex justify-between items-start py-1 border-b border-neutral-100 last:border-0">
                              <div>
                                {isCase ? (
                                  <>
                                    <span className="font-black text-amber-600 text-sm">{it.quantity} cx </span>
                                    <span className="font-bold text-neutral-800">{it.name}</span>
                                    <span className="text-amber-700 font-bold text-[11px] ml-1">
                                      (c/{it.unitsPerSale || 12})
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-black text-amber-600 text-sm">{it.quantity}x </span>
                                    <span className="font-bold text-neutral-800">{it.name}</span>
                                  </>
                                )}
                                <span className="text-neutral-500 text-[11px] ml-1">
                                  {it.volume ? `(${it.volume}) ` : ''}{it.isCold ? '• Gelada ❄️' : ''}
                                </span>
                                {wasPromo && (
                                  <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-black rounded uppercase">
                                    PROMO ({formatCurrency(it.price)} un)
                                  </span>
                                )}
                                {it.comboItems && it.comboItems.length > 0 && (
                                  <div className="mt-0.5 space-y-0.5 pl-2">
                                    {it.comboItems.map((ci, cIdx) => (
                                      <p key={cIdx} className="text-[11px] font-semibold text-neutral-600">
                                        {formatOrderItemComboLine(ci)}
                                      </p>
                                    ))}
                                  </div>
                                )}
                                {it.addons && it.addons.length > 0 && (
                                  <div className="mt-0.5 space-y-0.5 pl-2">
                                    {it.addons.map((addon, aIdx) => (
                                      <p key={aIdx} className="text-[11px] font-semibold text-neutral-600">
                                        {formatOrderItemAddonLine(addon)}
                                      </p>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <div className="text-right shrink-0">
                                {wasPromo && it.originalPrice && (
                                  <span className="text-[10px] text-neutral-400 line-through mr-1.5">
                                    {formatCurrency(it.originalPrice * it.quantity)}
                                  </span>
                                )}
                                <span className="font-bold text-neutral-900">{formatCurrency(it.price * it.quantity)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between p-3 bg-neutral-100 rounded-2xl text-xs mb-4">
                        <div>
                          <span className="text-neutral-500 block">Pagamento:</span>
                          <span className="font-bold text-neutral-900 uppercase">
                            {order.paymentMethod === 'pix' && '⚡ PIX'}
                            {order.paymentMethod === 'cartao_credito' && '💳 Cartão de Crédito'}
                            {order.paymentMethod === 'cartao_debito' && '💳 Cartão de Débito'}
                            {order.paymentMethod === 'dinheiro' && '💵 Dinheiro'}
                          </span>
                          {order.cashChangeFor !== undefined && order.cashChangeFor !== null && (
                            <span className="block text-[11px] font-bold text-amber-800 mt-0.5">
                              Recebido: {formatCurrency(order.cashChangeFor)} • Troco: {formatCurrency(Math.max(0, order.cashChangeFor - order.total))}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <span className="text-neutral-500 block">Total a Cobrar:</span>
                          <span className="text-base font-black text-amber-600">{formatCurrency(order.total)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-neutral-100 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => setSelectedReceiptOrder(order)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold transition-colors"
                        >
                          <Printer className="w-3.5 h-3.5 text-neutral-600" />
                          <span>Imprimir Comanda</span>
                        </button>

                        {waPhone && (
                          <a
                            href={`https://wa.me/${waPhone}?text=${encodeURIComponent(
                              `Olá ${order.customer.name}! Seu pedido #${order.id} está: ${getOrderStatusLabelForWhatsApp(order)}. Total ${formatCurrency(order.total)}`
                            )}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold transition-colors"
                          >
                            <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                            <span>WhatsApp</span>
                          </a>
                        )}
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
                            {order.deliveryType === 'retirada' ? 'Pronto para retirada' : 'Despachar Motoboy'}
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
                        {isCompleted && (
                          <button
                            onClick={() =>
                              setCancelOrderModal({
                                order,
                                mode: 'completed',
                                reason: '',
                                loading: false,
                              })
                            }
                            className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold transition-colors"
                          >
                            Cancelar venda
                          </button>
                        )}
                        {!isCompleted && !isCanceled && (
                          <button
                            onClick={() =>
                              setCancelOrderModal({
                                order,
                                mode: 'active',
                                reason: '',
                                loading: false,
                              })
                            }
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
                data-admin-search="clientes"
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
                              {formatWhatsAppPhone(c.phone) && (
                                <a
                                  href={`https://wa.me/${formatWhatsAppPhone(c.phone)}?text=${encodeURIComponent(
                                    `Olá ${c.name}! Tudo bem? Falamos do ${settings.storeName}.`
                                  )}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Conversar no WhatsApp"
                                  className="p-1.5 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors inline-flex items-center justify-center"
                                >
                                  <MessageCircle className="w-4 h-4" />
                                </a>
                              )}

                              {/* Delete Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmModal({
                                    title: 'Excluir Cliente',
                                    message: `Deseja realmente excluir o cadastro de ${c.name}?`,
                                    onConfirm: async () => {
                                      await api.deleteCustomer(c.id);
                                    },
                                  });
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
      {/* TAB: CUPONS DE DESCONTO                                   */}
      {/* ========================================================= */}
      {activeTab === 'cupons' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-black text-neutral-900 flex items-center gap-2">
                <Ticket className="w-5 h-5 text-amber-500" />
                <span>Cupons de Desconto</span>
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Crie e gerencie cupons promocionais para seus clientes utilizarem no checkout online.
              </p>
            </div>

            <button
              onClick={() => {
                setCouponModalError('');
                setIsCouponModalOpen(true);
              }}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1.5 shadow-sm shadow-amber-500/20 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Cupom</span>
            </button>
          </div>

          {/* Quick Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Total de Cupons</span>
              <p className="text-2xl font-black text-neutral-900 mt-1">{coupons.length}</p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Cupons Ativos</span>
              <p className="text-2xl font-black text-emerald-600 mt-1">
                {coupons.filter(c => isCouponEffectivelyActive(c)).length}
              </p>
            </div>
            <div className="bg-white p-4 rounded-2xl border border-neutral-200">
              <span className="text-xs font-medium text-neutral-500">Usos Registrados</span>
              <p className="text-2xl font-black text-amber-600 mt-1">
                {coupons.reduce((sum, c) => sum + (c.usedCount || 0), 0)}
              </p>
            </div>
          </div>

          {/* Coupons Table */}
          <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-xs">
            {coupons.length === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <Ticket className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-neutral-900">Nenhum cupom cadastrado</h4>
                <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                  Crie cupons promocionais (ex: BEMVINDO10, SEXTOU, GELADA15) para aumentar as vendas do seu depósito.
                </p>
                <button
                  onClick={() => setIsCouponModalOpen(true)}
                  className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Criar Primeiro Cupom</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 uppercase tracking-wider font-bold">
                    <tr>
                      <th className="py-3 px-4">Código</th>
                      <th className="py-3 px-4">Desconto</th>
                      <th className="py-3 px-4">Pedido Mínimo</th>
                      <th className="py-3 px-4">Usos / Limite</th>
                      <th className="py-3 px-4">Validade</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {coupons.map((c) => {
                      const expMs = getCouponExpirationMs(c.expiresAt);
                      const isExpired = expMs !== null && expMs < Date.now();
                      const isMaxedOut = c.maxUses !== null && c.maxUses !== undefined && c.usedCount >= c.maxUses;
                      const isEffectivelyActive = Boolean(c.active && !isExpired && !isMaxedOut);

                      return (
                        <tr key={c.code} className="hover:bg-neutral-50/80 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-black text-sm text-neutral-900">
                            <span className="px-2.5 py-1 rounded-lg bg-neutral-100 border border-neutral-300">
                              {c.code}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-bold text-neutral-800">
                            {c.type === 'percent'
                              ? c.maxDiscount
                                ? `${c.value}% até ${formatCurrency(c.maxDiscount)}`
                                : `${c.value}% OFF`
                              : `${formatCurrency(c.value)} OFF`}
                          </td>
                          <td className="py-3.5 px-4 text-neutral-600">
                            {c.minOrder ? `R$ ${c.minOrder.toFixed(2)}` : 'Sem mínimo'}
                          </td>
                          <td className="py-3.5 px-4 text-neutral-600">
                            <span className="font-bold text-neutral-900">{c.usedCount}</span>
                            {c.maxUses ? ` / ${c.maxUses}` : ' / Ilimitado'}
                            {isMaxedOut && (
                              <span className="ml-1.5 text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded font-bold">
                                Esgotado
                              </span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-neutral-600">
                            {c.expiresAt ? (
                              <span className={isExpired ? 'text-red-600 font-bold' : ''}>
                                {formatCouponExpiresDate(c.expiresAt)}
                                {isExpired && ' (Expirado)'}
                              </span>
                            ) : (
                              'Sem expiração'
                            )}
                          </td>
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => handleToggleCouponActive(c)}
                              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                                isEffectivelyActive
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100'
                                  : isExpired || isMaxedOut
                                  ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                                  : 'bg-neutral-100 text-neutral-500 border-neutral-300 hover:bg-neutral-200'
                              }`}
                            >
                              {!c.active
                                ? '⚪ Desativado'
                                : isExpired
                                ? '🔴 Expirado'
                                : isMaxedOut
                                ? '🔴 Esgotado'
                                : '🟢 Ativo'}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteCoupon(c.code)}
                              title="Excluir Cupom"
                              className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: ESTOQUE                                              */}
      {/* ========================================================= */}
      {activeTab === 'estoque' && (
        <div className="space-y-6">
          {/* Sub-navigation: Produtos vs Histórico de Estoque */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-neutral-200 shadow-2xs">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setEstoqueSubTab('produtos')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  estoqueSubTab === 'produtos'
                    ? 'bg-neutral-900 text-white shadow-2xs'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                <Package className="w-4 h-4 text-amber-400" />
                <span>Produtos & Controle de Estoque</span>
              </button>
              <button
                type="button"
                onClick={() => setEstoqueSubTab('historico')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer ${
                  estoqueSubTab === 'historico'
                    ? 'bg-neutral-900 text-white shadow-2xs'
                    : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                }`}
              >
                <History className="w-4 h-4 text-amber-400" />
                <span>Histórico</span>
              </button>
            </div>
            {estoqueSubTab === 'historico' && (
              <button
                type="button"
                onClick={() => setEstoqueSubTab('produtos')}
                className="text-xs font-bold text-amber-700 hover:text-amber-800 cursor-pointer"
              >
                ← Voltar para lista de produtos
              </button>
            )}
          </div>

          {estoqueSubTab === 'historico' ? (
            <StockHistorySection
              products={products}
              selectedProductId={stockHistoryProductId}
              onSelectProductId={(pid) => setStockHistoryProductId(pid)}
              onOpenOrderRef={(orderId) => {
                const cleanId = orderId.replace(/^#/, '').trim();
                const found = localOrders.find(
                  (o) => o.id === cleanId || o.id === orderId
                );
                if (found) {
                  setSelectedReceiptOrder(found);
                } else {
                  setActiveTab('pedidos');
                  setOrderStatusFilter('todos');
                }
              }}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-white p-4 rounded-2xl border border-neutral-200">
                  <span className="text-xs font-medium text-neutral-500">Itens em Estoque</span>
                  <p className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">
                    {financialStats.totalStockUnits} <span className="text-xs font-normal text-neutral-500">un</span>
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
                <div className="bg-white p-4 rounded-2xl border border-neutral-200 relative">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-medium text-neutral-500">Custo do estoque</span>
                    <button
                      type="button"
                      onClick={() => setShowStockValueHelp((prev) => !prev)}
                      title="Soma de estoque × custo de cada produto ativo. Combos não entram porque o estoque deles é o dos produtos de dentro."
                      aria-label="Explicação do cálculo do custo do estoque"
                      className="w-4 h-4 rounded-full bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-[10px] font-black flex items-center justify-center transition-colors cursor-pointer shrink-0"
                    >
                      ?
                    </button>
                  </div>
                  {showStockValueHelp && (
                    <div className="mt-1.5 p-2 rounded-xl bg-neutral-900 text-white text-[11px] font-medium leading-snug">
                      Soma de estoque × custo de cada produto ativo. Combos não entram porque o estoque deles é o dos produtos de dentro.
                    </div>
                  )}
                  <p className="text-xl sm:text-2xl font-black text-neutral-900 mt-1">
                    {formatCurrency(financialStats.totalStockCostValue)}
                  </p>
                  <p className="text-[11px] font-semibold text-neutral-500 mt-0.5">
                    Valor de venda: <span className="font-bold text-neutral-700">{formatCurrency(financialStats.totalStockSaleValue)}</span>
                  </p>
                  {zeroCostStockProducts.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !onlyZeroCost;
                        setOnlyZeroCost(next);
                        if (next) {
                          setOnlyLowStock(false);
                          setStockCategoryFilter('todas');
                        }
                      }}
                      className={`mt-1.5 text-[11px] font-bold underline text-left transition-colors cursor-pointer block ${
                        onlyZeroCost ? 'text-red-700' : 'text-amber-700 hover:text-amber-800'
                      }`}
                    >
                      {zeroCostStockProducts.length}{' '}
                      {zeroCostStockProducts.length === 1 ? 'produto sem custo cadastrado' : 'produtos sem custo cadastrado'}
                      {onlyZeroCost ? ' (ver todos)' : ''}
                    </button>
                  )}
                </div>
              </div>

              {/* Categorias, Combos, Ordem de Preferência e Organizar Loja (@dnd-kit) */}
              <StoreOrganizationSection
                products={products}
                settings={settings}
                onSettingsUpdated={(next) => setSettingsForm((prev) => ({ ...prev, ...next }))}
                externalEditingComboId={editingComboIdForModal}
                onClearExternalEditingComboId={() => setEditingComboIdForModal(null)}
              />

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 w-full sm:max-w-xl">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type="text"
                      data-admin-search="estoque"
                      placeholder="Buscar produto ou SKU..."
                      value={stockSearch}
                      onChange={(e) => setStockSearch(e.target.value)}
                      className="w-full pl-9 pr-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 bg-white px-3 py-2 rounded-xl border border-neutral-200 text-xs">
                    <span className="font-bold text-neutral-500 whitespace-nowrap">Ordenar por:</span>
                    <select
                      value={stockSortBy}
                      onChange={(e) => setStockSortBy(e.target.value as 'az' | 'price' | 'stock' | 'category')}
                      className="bg-transparent font-bold text-neutral-900 focus:outline-none cursor-pointer"
                    >
                      <option value="az">Nome A–Z</option>
                      <option value="price">Preço</option>
                      <option value="stock">Estoque</option>
                      <option value="category">Categoria</option>
                    </select>
                  </div>

                  <button
                    onClick={() => {
                      const next = !onlyLowStock;
                      setOnlyLowStock(next);
                      if (next) setOnlyZeroCost(false);
                    }}
                    className={`px-3 py-2.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap cursor-pointer ${
                      onlyLowStock
                        ? 'bg-amber-500 text-white border-amber-600'
                        : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
                    }`}
                  >
                    ⚠️ Baixo Estoque
                  </button>

                  {onlyZeroCost && (
                    <button
                      type="button"
                      onClick={() => setOnlyZeroCost(false)}
                      className="px-3 py-2.5 rounded-xl text-xs font-bold border bg-red-600 text-white border-red-700 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      ✕ Sem custo cadastrado ({zeroCostStockProducts.length})
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <button
                    type="button"
                    disabled={batchPhotoOpt.running}
                    onClick={handleBatchOptimizeProductPhotos}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-3.5 py-2.5 bg-white hover:bg-neutral-50 disabled:opacity-50 text-neutral-800 border border-neutral-300 font-bold rounded-xl text-xs shadow-2xs transition-colors cursor-pointer"
                    title="Reduzir o tamanho das fotos já cadastradas no banco para economizar tráfego"
                  >
                    <ImageIcon className="w-4 h-4 text-amber-600" />
                    <span>
                      {batchPhotoOpt.running
                        ? `Otimizando (${batchPhotoOpt.current} de ${batchPhotoOpt.total})...`
                        : 'Otimizar fotos dos produtos'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsImportModalOpen(true)}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 font-bold rounded-xl text-xs shadow-2xs transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                    <span>Importar planilha (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleOpenNewProduct}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-xl text-xs shadow-xs transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Novo Produto ({formatShortcutDisplay(activeShortcuts.newProduct || 'F6')})</span>
                  </button>
                </div>
              </div>

              {(batchPhotoOpt.running || batchPhotoOpt.summaryText || batchPhotoOpt.errorText) && (
                <div className="p-4 rounded-2xl bg-white border border-neutral-200 shadow-2xs space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-black text-neutral-900">
                      {batchPhotoOpt.running
                        ? `Otimizando fotos dos produtos: ${batchPhotoOpt.current} de ${batchPhotoOpt.total}`
                        : 'Otimização de fotos dos produtos concluída'}
                    </span>
                    {batchPhotoOpt.summaryText && (
                      <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-900 font-black">
                        {batchPhotoOpt.summaryText}
                      </span>
                    )}
                  </div>
                  {batchPhotoOpt.running && batchPhotoOpt.total > 0 && (
                    <div className="w-full h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-200"
                        style={{
                          width: `${Math.round((batchPhotoOpt.current / batchPhotoOpt.total) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                  {batchPhotoOpt.errorText && (
                    <p className="text-red-600 font-bold">{batchPhotoOpt.errorText}</p>
                  )}
                </div>
              )}

              {/* Category Filter Row: flex-wrap on desktop, horizontal scroll with right fade/chevron on mobile */}
              <div className="relative">
                <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-2 pr-8 sm:pr-0 scrollbar-none">
                  {[
                    { id: 'todas', label: 'Todas as Categorias' },
                    ...storeCategories
                      .filter((c) => products.some((p) => p.category === c.id))
                      .map((c) => ({ id: c.id, label: c.name })),
                    ...(hasUnlistedCategoryProducts ? [{ id: 'outros', label: 'Outros' }] : []),
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setStockCategoryFilter(cat.id as ProductCategory | 'todas' | 'outros')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        stockCategoryFilter === cat.id
                          ? 'bg-neutral-900 text-white'
                          : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
                <div className="pointer-events-none sm:hidden absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-neutral-100 via-neutral-100/90 to-transparent flex items-center justify-end pr-1">
                  <span className="text-xs font-black text-neutral-500">›</span>
                </div>
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
                        const isCombo = isComboProduct(p.id, settings);
                        const comboMetrics = isCombo ? calculateComboMetrics(p, settings, products) : null;
                        const displayStock = comboMetrics ? comboMetrics.availableStock : p.stock;
                        const isLow = isCombo ? displayStock <= 0 : p.stock <= p.minStock;
                        const promoActive = isProductPromoActive(p);
                        const effectivePrice = getEffectiveProductPrice(p);
                        const displayCostPrice = comboMetrics ? comboMetrics.costPrice : p.costPrice;
                        const margin = comboMetrics
                          ? comboMetrics.marginPercent
                          : effectivePrice > 0
                          ? ((effectivePrice - p.costPrice) / effectivePrice) * 100
                          : 0;
                        const hasStockCase = !isCombo && hasProductStockCase(p);
                        const sellsStoreCase = !isCombo && canSellProductCase(p, settings, 'store');
                        const sellsLocalCase = !isCombo && canSellProductCase(p, settings, 'local');
                        const sellsCaseAnywhere = sellsStoreCase || sellsLocalCase;
                        const rowUnit: SaleUnit = hasStockCase && stockRowUnits[p.id] === 'case' ? 'case' : 'unit';
                        const isEditingInline = inlineStockEdit?.productId === p.id;
                        const rowStockError = stockInlineErrorByProduct[p.id];

                        return (
                          <tr key={p.id} className="hover:bg-neutral-50 transition-colors">
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-3">
                                {p.imageUrl || p.image ? (
                                  <img
                                    src={p.imageUrl || p.image}
                                    alt={p.name}
                                    loading="lazy"
                                    width={40}
                                    height={40}
                                    className="w-10 h-10 rounded-xl object-cover border border-neutral-200 shrink-0"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-400 shrink-0">
                                    <Package className="w-5 h-5" />
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-bold text-neutral-900 text-sm">{p.name}</span>
                                    {isCombo && (
                                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black rounded uppercase tracking-wider">
                                        Combo
                                      </span>
                                    )}
                                    {promoActive && (
                                      <span className="px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-black rounded uppercase tracking-wider">
                                        PROMO
                                      </span>
                                    )}
                                    {hasStockCase && (
                                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold rounded">
                                        Caixa c/{p.caseSize}{!sellsCaseAnywhere ? ' (só estoque)' : ''}
                                      </span>
                                    )}
                                    {p.active === false && (
                                      <span className="px-1.5 py-0.5 bg-neutral-200 text-neutral-700 border border-neutral-300 text-[10px] font-bold rounded">
                                        Desativado
                                      </span>
                                    )}
                                    {isProductHiddenFromStore(p.id, settings) && (
                                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold rounded inline-flex items-center gap-1">
                                        <Utensils className="w-3 h-3 text-amber-700" />
                                        <span>Só no balcão/mesa</span>
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-neutral-500">
                                    {isCombo && comboMetrics?.itemsSummaryText
                                      ? comboMetrics.itemsSummaryText
                                      : `${p.volume} ${p.isCold ? '• Gelada ❄️' : ''}`}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-semibold text-neutral-800 block">
                                {storeCategoryIdSet.has(p.category)
                                  ? getCategoryDisplayName(p.category, settings, products)
                                  : 'Outros'}
                              </span>
                              <span className="text-[10px] font-mono text-neutral-400">{p.sku}</span>
                            </td>
                            <td className="py-3 px-4 font-mono text-neutral-600">
                              {formatCurrency(displayCostPrice)}
                            </td>
                            <td className="py-3 px-4 font-mono">
                              {promoActive ? (
                                <div>
                                  <span className="text-[10px] text-neutral-400 line-through block">
                                    {formatCurrency(p.price)}
                                  </span>
                                  <span className="font-black text-red-600">
                                    {formatCurrency(effectivePrice)}
                                  </span>
                                </div>
                              ) : (
                                <span className="font-bold text-neutral-900">{formatCurrency(p.price)}</span>
                              )}
                              {sellsCaseAnywhere && p.casePrice && (
                                <div className="text-[10px] text-amber-700 font-bold mt-0.5">
                                  Cx c/{p.caseSize}: {formatCurrency(p.casePrice)}
                                  {sellsStoreCase && !sellsLocalCase ? ' (Delivery)' : !sellsStoreCase && sellsLocalCase ? ' (Balcão/Mesa)' : ''}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className={`font-bold px-1.5 py-0.5 rounded text-[11px] ${
                                margin >= 30 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                              }`}>
                                {margin.toFixed(0)}%
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex flex-col gap-0.5">
                                <div className="flex items-center gap-2">
                                  {isCombo ? (
                                    <span className={`font-black text-sm ${displayStock <= 0 ? 'text-red-600' : 'text-neutral-900'}`}>
                                      Disponível: {displayStock}
                                    </span>
                                  ) : (
                                    <>
                                      <span className={`font-black text-sm ${isLow ? 'text-red-600' : 'text-neutral-900'}`}>
                                        {formatStockWithCases(p.stock, p.caseSize)}
                                      </span>
                                      {isLow && (
                                        <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                                          Baixo (Min: {p.minStock})
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3 px-4">
                              {isCombo ? (
                                <div className="flex items-center justify-center">
                                  <span className="px-2.5 py-1 rounded-lg bg-neutral-100 border border-neutral-200 text-neutral-500 text-[10px] font-bold">
                                    Estoque dos itens
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-1.5">
                                  {isEditingInline ? (
                                    (() => {
                                      const curReason: StockAdjustReason = inlineStockEdit?.reason || 'entrada';
                                      const isDeltaMode = curReason === 'entrada' || curReason === 'perda';
                                      const curUnit: SaleUnit =
                                        isDeltaMode && hasStockCase && inlineStockEdit?.unit === 'case'
                                          ? 'case'
                                          : 'unit';
                                      const rawTyped = (inlineStockEdit?.value ?? '').trim();
                                      const parsedTyped = rawTyped !== '' ? Number(rawTyped) : NaN;
                                      const isValidInt =
                                        rawTyped !== '' &&
                                        Number.isInteger(parsedTyped) &&
                                        (isDeltaMode ? parsedTyped > 0 : parsedTyped >= 0);
                                      const caseMult = curUnit === 'case' && hasStockCase ? Number(p.caseSize) : 1;
                                      const deltaUnits = isValidInt ? parsedTyped * caseMult : 0;
                                      const resultingStock =
                                        curReason === 'entrada'
                                          ? p.stock + deltaUnits
                                          : curReason === 'perda'
                                          ? p.stock - deltaUnits
                                          : isValidInt
                                          ? parsedTyped
                                          : p.stock;
                                      const isNegativeLoss = curReason === 'perda' && isValidInt && resultingStock < 0;

                                      const fieldLabel =
                                        curReason === 'entrada'
                                          ? 'Quantidade que chegou'
                                          : curReason === 'perda'
                                          ? 'Quantidade perdida'
                                          : 'Estoque contado (novo total)';

                                      return (
                                        <div className="flex flex-col gap-2 p-2.5 rounded-xl bg-neutral-100 border border-neutral-300 w-64 text-left shadow-xs">
                                          <div>
                                            <label className="block text-[10px] font-bold text-neutral-600 mb-0.5">
                                              Motivo
                                            </label>
                                            <select
                                              disabled={inlineStockEdit?.saving}
                                              value={curReason}
                                              onChange={(e) => {
                                                const nextReason = e.target.value as StockAdjustReason;
                                                const nextIsDelta =
                                                  nextReason === 'entrada' || nextReason === 'perda';
                                                setStockInlineErrorByProduct((prev) => {
                                                  if (!prev[p.id]) return prev;
                                                  const next = { ...prev };
                                                  delete next[p.id];
                                                  return next;
                                                });
                                                setInlineStockEdit((prev) =>
                                                  prev
                                                    ? {
                                                        ...prev,
                                                        reason: nextReason,
                                                        value: nextIsDelta ? '' : String(p.stock),
                                                        unit: nextIsDelta ? prev.unit : 'unit',
                                                      }
                                                    : null
                                                );
                                              }}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Escape') {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setInlineStockEdit(null);
                                                }
                                              }}
                                              className="w-full px-2 py-1.5 bg-white border border-neutral-300 rounded-lg text-xs font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                            >
                                              <option value="entrada">Entrada de mercadoria</option>
                                              <option value="perda">Perda/quebra</option>
                                              <option value="contagem">Contagem</option>
                                              <option value="ajuste">Ajuste</option>
                                            </select>
                                          </div>

                                          <div>
                                            <label className="block text-[10px] font-bold text-neutral-600 mb-0.5">
                                              {fieldLabel}
                                            </label>
                                            <div className="flex items-center gap-1.5">
                                              <input
                                                type="number"
                                                step={1}
                                                min={isDeltaMode ? 1 : 0}
                                                autoFocus
                                                disabled={inlineStockEdit?.saving}
                                                value={inlineStockEdit?.value ?? ''}
                                                onChange={(e) =>
                                                  setInlineStockEdit((prev) =>
                                                    prev ? { ...prev, value: e.target.value } : null
                                                  )
                                                }
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    if (!isNegativeLoss) {
                                                      handleSaveInlineStockEdit(p);
                                                    }
                                                  } else if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setInlineStockEdit(null);
                                                  }
                                                }}
                                                placeholder={isDeltaMode ? 'Ex: 50' : String(p.stock)}
                                                className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-neutral-300 rounded-lg text-xs font-black text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                              />

                                              {isDeltaMode && hasStockCase && (
                                                <div className="inline-flex bg-white p-0.5 rounded-lg border border-neutral-300 text-[10px] shrink-0">
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setInlineStockEdit((prev) =>
                                                        prev ? { ...prev, unit: 'unit' } : null
                                                      )
                                                    }
                                                    className={`px-2 py-1 rounded-md font-black transition-colors cursor-pointer ${
                                                      curUnit === 'unit'
                                                        ? 'bg-neutral-900 text-white'
                                                        : 'text-neutral-600 hover:text-neutral-900'
                                                    }`}
                                                  >
                                                    un
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      setInlineStockEdit((prev) =>
                                                        prev ? { ...prev, unit: 'case' } : null
                                                      )
                                                    }
                                                    className={`px-2 py-1 rounded-md font-black transition-colors cursor-pointer ${
                                                      curUnit === 'case'
                                                        ? 'bg-amber-500 text-neutral-950'
                                                        : 'text-neutral-600 hover:text-neutral-900'
                                                    }`}
                                                  >
                                                    cx
                                                  </button>
                                                </div>
                                              )}
                                            </div>

                                            {isDeltaMode && curUnit === 'case' && hasStockCase && isValidInt && (
                                              <p className="text-[11px] font-bold text-amber-800 mt-1">
                                                {parsedTyped} cx de {p.caseSize} = {deltaUnits} un
                                              </p>
                                            )}
                                          </div>

                                          {isValidInt && (
                                            <div
                                              className={`px-2.5 py-1.5 rounded-lg border text-center ${
                                                isNegativeLoss
                                                  ? 'bg-red-50 border-red-300 text-red-800'
                                                  : curReason === 'entrada'
                                                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                                                  : curReason === 'perda'
                                                  ? 'bg-amber-50 border-amber-300 text-amber-950'
                                                  : 'bg-white border-neutral-300 text-neutral-900'
                                              }`}
                                            >
                                              <p className="text-sm font-black tracking-tight">
                                                {curReason === 'entrada'
                                                  ? `${p.stock} + ${deltaUnits} = ${resultingStock} un`
                                                  : curReason === 'perda'
                                                  ? `${p.stock} − ${deltaUnits} = ${resultingStock} un`
                                                  : `Novo total: ${parsedTyped} un (antes ${p.stock})`}
                                              </p>
                                              {isNegativeLoss && (
                                                <p className="text-[10px] font-bold text-red-700 mt-0.5">
                                                  Estoque não pode ficar negativo
                                                </p>
                                              )}
                                            </div>
                                          )}

                                          <div className="flex items-center justify-end gap-1.5 pt-0.5">
                                            <button
                                              type="button"
                                              disabled={inlineStockEdit?.saving}
                                              onClick={() => setInlineStockEdit(null)}
                                              className="px-2.5 py-1 rounded-lg bg-white hover:bg-neutral-200 text-neutral-600 text-[10px] font-bold border border-neutral-200 cursor-pointer"
                                            >
                                              Esc
                                            </button>
                                            <button
                                              type="button"
                                              disabled={
                                                inlineStockEdit?.saving || !isValidInt || isNegativeLoss
                                              }
                                              onClick={() => handleSaveInlineStockEdit(p)}
                                              className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 disabled:text-neutral-500 text-neutral-950 text-[10px] font-black cursor-pointer disabled:cursor-not-allowed"
                                            >
                                              {inlineStockEdit?.saving ? '...' : 'Salvar (Enter)'}
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })()
                                  ) : (
                                    <>
                                      {hasStockCase && (
                                        <div className="inline-flex bg-neutral-100 p-0.5 rounded-lg border border-neutral-200 text-[10px]">
                                          <button
                                            type="button"
                                            onClick={() => setStockRowUnits(prev => ({ ...prev, [p.id]: 'unit' }))}
                                            className={`px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                                              rowUnit === 'unit'
                                                ? 'bg-white text-neutral-900 shadow-2xs'
                                                : 'text-neutral-500 hover:text-neutral-800'
                                            }`}
                                          >
                                            Unidades
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setStockRowUnits(prev => ({ ...prev, [p.id]: 'case' }))}
                                            className={`px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer ${
                                              rowUnit === 'case'
                                                ? 'bg-amber-500 text-neutral-950 shadow-2xs'
                                                : 'text-neutral-500 hover:text-neutral-800'
                                            }`}
                                          >
                                            Caixas (c/{p.caseSize})
                                          </button>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-center gap-1">
                                        {rowUnit === 'case' ? (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, -5, 'case')}
                                              className="px-1.5 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-[10px] cursor-pointer"
                                              title={`Remover 5 caixas (${5 * (p.caseSize || 1)} un)`}
                                            >
                                              -5cx
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, -1, 'case')}
                                              className="px-1.5 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-[10px] cursor-pointer"
                                              title={`Remover 1 caixa (${p.caseSize} un)`}
                                            >
                                              −1cx
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, 1, 'case')}
                                              className="px-1.5 h-6 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded font-bold text-[10px] cursor-pointer"
                                              title={`Adicionar 1 caixa (${p.caseSize} un)`}
                                            >
                                              +1cx
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, 5, 'case')}
                                              className="px-1.5 h-6 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold text-[10px] cursor-pointer"
                                              title={`Adicionar 5 caixas (${5 * (p.caseSize || 1)} un)`}
                                            >
                                              +5cx
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, -10, 'unit')}
                                              className="w-6 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-[10px] cursor-pointer"
                                            >
                                              −10
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, -1, 'unit')}
                                              className="w-6 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-xs cursor-pointer"
                                            >
                                              −1
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, 1, 'unit')}
                                              className="w-6 h-6 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded font-bold text-xs cursor-pointer"
                                            >
                                              +1
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleAdjustStock(p.id, 10, 'unit')}
                                              className="w-6 h-6 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold text-[10px] cursor-pointer"
                                            >
                                              +10
                                            </button>
                                          </>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setStockInlineErrorByProduct((prev) => {
                                              if (!prev[p.id]) return prev;
                                              const next = { ...prev };
                                              delete next[p.id];
                                              return next;
                                            });
                                            setInlineStockEdit({
                                              productId: p.id,
                                              value: '',
                                              reason: 'entrada',
                                              unit: 'unit',
                                              saving: false,
                                            });
                                          }}
                                          className="px-2 h-6 bg-neutral-900 hover:bg-neutral-800 text-white rounded font-bold text-[10px] cursor-pointer ml-0.5"
                                          title="Digitar entrada, perda ou contagem de estoque (Enter salva, Esc cancela)"
                                        >
                                          Digitar
                                        </button>
                                      </div>
                                    </>
                                  )}

                                  {stockInlineSuccessByProduct[p.id] && (
                                    <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-bold">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                                      <span>{stockInlineSuccessByProduct[p.id]}</span>
                                    </div>
                                  )}

                                  {rowStockError && (
                                    <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[10px] font-bold">
                                      <span>{rowStockError}</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setStockInlineErrorByProduct((prev) => {
                                            const next = { ...prev };
                                            delete next[p.id];
                                            return next;
                                          })
                                        }
                                        className="hover:text-red-900 cursor-pointer"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                {!isCombo && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setStockHistoryProductId(p.id);
                                      setEstoqueSubTab('historico');
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="px-2 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-100 transition-colors cursor-pointer"
                                    title="Ver histórico de entradas e saídas deste produto"
                                  >
                                    <History className="w-3.5 h-3.5 text-amber-600" />
                                    <span>Histórico</span>
                                  </button>
                                )}

                                {(() => {
                                  const isFeatured = validFeaturedIds.includes(p.id);
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleFeaturedProduct(p.id)}
                                      className={`px-2 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                                        isFeatured
                                          ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200'
                                          : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-100'
                                      }`}
                                      title="Mostrar primeiro"
                                    >
                                      <ArrowUp
                                        className={`w-3.5 h-3.5 ${
                                          isFeatured ? 'text-amber-600' : 'text-neutral-400'
                                        }`}
                                      />
                                      <span>Mostrar primeiro</span>
                                    </button>
                                  );
                                })()}

                                <button
                                  type="button"
                                  onClick={() => handleToggleProductActive(p)}
                                  className={`px-2 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                                    p.active !== false
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                                      : 'bg-neutral-100 text-neutral-600 border-neutral-300 hover:bg-neutral-200'
                                  }`}
                                  title={
                                    p.active !== false
                                      ? 'Ativo em todo lugar (clique para desativar)'
                                      : 'Desativado em todo lugar (clique para ativar)'
                                  }
                                >
                                  {p.active !== false ? (
                                    <>
                                      <Eye className="w-3.5 h-3.5 text-emerald-600" />
                                      <span>Ativo</span>
                                    </>
                                  ) : (
                                    <>
                                      <EyeOff className="w-3.5 h-3.5 text-neutral-500" />
                                      <span>Desativado</span>
                                    </>
                                  )}
                                </button>

                                {(() => {
                                  const isHiddenFromDelivery = isProductHiddenFromStore(p.id, settings);
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => handleToggleProductDeliveryVisibility(p.id)}
                                      className={`px-2 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 border transition-colors cursor-pointer ${
                                        !isHiddenFromDelivery
                                          ? 'bg-sky-50 text-sky-800 border-sky-200 hover:bg-sky-100'
                                          : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
                                      }`}
                                      title={
                                        !isHiddenFromDelivery
                                          ? 'Aparece no delivery / loja online (clique para ocultar do delivery)'
                                          : 'Só no balcão/mesa (clique para ativar no delivery)'
                                      }
                                    >
                                      {!isHiddenFromDelivery ? (
                                        <>
                                          <Truck className="w-3.5 h-3.5 text-sky-600" />
                                          <span>Aparece no delivery</span>
                                        </>
                                      ) : (
                                        <>
                                          <Utensils className="w-3.5 h-3.5 text-amber-700" />
                                          <span>Só no balcão/mesa</span>
                                        </>
                                      )}
                                    </button>
                                  );
                                })()}

                                {!isCombo && (
                                  <button
                                    type="button"
                                    onClick={() => handleDuplicateProduct(p)}
                                    className="px-2 py-1 text-neutral-600 hover:text-neutral-900 bg-white hover:bg-neutral-100 border border-neutral-200 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                                    title="Duplicar produto"
                                  >
                                    <Copy className="w-3.5 h-3.5 text-neutral-500" />
                                    <span>Duplicar</span>
                                  </button>
                                )}

                                <button
                                  onClick={() => handleOpenEditProduct(p)}
                                  className="p-1.5 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200 rounded-lg transition-colors"
                                  title={isCombo ? 'Editar combo' : 'Editar produto'}
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteProduct(p.id)}
                                  className="p-1.5 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title={isCombo ? 'Excluir combo' : 'Excluir produto'}
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
            </>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: PROMOÇÕES DE PRODUTOS                                */}
      {/* ========================================================= */}
      {activeTab === 'promocoes' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-3xl border border-neutral-200">
            <div>
              <h3 className="text-lg font-black text-neutral-900 flex items-center gap-2">
                <Tag className="w-5 h-5 text-red-600" />
                <span>Promoções de Produtos</span>
              </h3>
              <p className="text-xs text-neutral-500 mt-0.5">
                Gerencie ofertas com desconto direto nos produtos. Os preços promocionais ativos aparecem automaticamente em destaque na loja.
              </p>
            </div>

            <button
              onClick={handleOpenNewPromo}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1.5 shadow-sm shadow-amber-500/20 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Nova promoção</span>
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-xs">
            {activePromotions.length === 0 ? (
              <div className="text-center py-14 px-4">
                <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Tag className="w-6 h-6" />
                </div>
                <h4 className="font-bold text-sm text-neutral-900">Nenhuma promoção ativa no momento</h4>
                <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
                  Clique em <strong>Nova promoção</strong> para destacar produtos com desconto na vitrine da loja.
                </p>
                <button
                  onClick={handleOpenNewPromo}
                  className="mt-4 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Nova promoção</span>
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-neutral-700">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 uppercase tracking-wider font-bold">
                    <tr>
                      <th className="py-3 px-4">Produto</th>
                      <th className="py-3 px-4">Preço Normal</th>
                      <th className="py-3 px-4">Preço Promocional</th>
                      <th className="py-3 px-4">Desconto</th>
                      <th className="py-3 px-4">Término</th>
                      <th className="py-3 px-4 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {activePromotions.map((prod) => {
                      const discountPct = getPromoDiscountPercent(prod);
                      const promoVal = getEffectiveProductPrice(prod);

                      return (
                        <tr key={prod.id} className="hover:bg-neutral-50/80 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              {prod.imageUrl || prod.image ? (
                                <img
                                  src={prod.imageUrl || prod.image}
                                  alt={prod.name}
                                  loading="lazy"
                                  width={44}
                                  height={44}
                                  className="w-11 h-11 rounded-xl object-cover border border-neutral-200 shrink-0"
                                />
                              ) : (
                                <div className="w-11 h-11 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-400 shrink-0">
                                  <Package className="w-5 h-5" />
                                </div>
                              )}
                              <div>
                                <div className="font-bold text-neutral-900 text-sm flex items-center gap-2">
                                  <span>{prod.name}</span>
                                  <span className="px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-black rounded uppercase">
                                    PROMO
                                  </span>
                                </div>
                                <div className="text-[11px] text-neutral-500">
                                  {prod.volume} • Estoque: {formatStockWithCases(prod.stock, prod.caseSize)}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-neutral-400 line-through">
                            {formatCurrency(prod.price)}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-black text-sm text-red-600">
                            {formatCurrency(promoVal)}
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-800 font-black text-xs">
                              -{discountPct}% OFF
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-medium text-neutral-700">
                            {prod.promoEndsAt ? formatDate(prod.promoEndsAt) : 'Sem data de término'}
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => handleOpenEditPromo(prod)}
                                className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl font-bold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>Editar</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleEndPromotion(prod)}
                                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl font-bold text-xs inline-flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>Encerrar promoção</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: MESAS & COMANDAS                                     */}
      {/* ========================================================= */}
      {activeTab === 'mesas' && (
        <TablesManager
          products={products}
          settings={settings}
          hasOpenCashSession={Boolean(currentCashSession)}
          onRequestOpenCashSession={() => setIsOpenCashModalOpen(true)}
        />
      )}

      {/* ========================================================= */}
      {/* TAB: PDV BALCÃO                                           */}
      {/* ========================================================= */}
      {activeTab === 'pdv' && (
        <div className="space-y-4">
          {!currentCashSession && (
            <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs text-amber-900 font-bold">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                <span>Abra o expediente para registrar as vendas no caixa</span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpenCashModalOpen(true)}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black rounded-xl text-xs transition-colors cursor-pointer shrink-0"
              >
                Abrir expediente
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4 min-w-0">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  data-admin-search="pdv"
                  placeholder="Buscar bebida para adicionar no caixa..."
                  value={posSearch}
                  onChange={(e) => setPosSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>
            </div>

            {/* PDV Category Filter Row: flex-wrap on desktop, horizontal scroll with right fade/chevron on mobile */}
            <div className="relative">
              <div className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap sm:overflow-visible pb-1.5 pr-8 sm:pr-0 scrollbar-none">
                {[
                  { id: 'todas', label: 'Todas Categorias' },
                  ...storeCategories
                    .filter((c) => products.some((p) => p.active !== false && p.category === c.id))
                    .map((c) => ({ id: c.id, label: c.name })),
                  ...(products.some((p) => p.active !== false && !storeCategoryIdSet.has(p.category))
                    ? [{ id: 'outros', label: 'Outros' }]
                    : []),
                ].map((cat) => (
                  <button
                    key={`pdv-cat-${cat.id}`}
                    type="button"
                    onClick={() => setPosCategory(cat.id as ProductCategory | 'todas')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      posCategory === cat.id
                        ? 'bg-neutral-900 text-white'
                        : 'bg-white text-neutral-600 hover:bg-neutral-100 border border-neutral-200'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <div className="pointer-events-none sm:hidden absolute right-0 top-0 bottom-1.5 w-8 bg-gradient-to-l from-neutral-100 via-neutral-100/90 to-transparent flex items-center justify-end pr-1">
                <span className="text-xs font-black text-neutral-500">›</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3 max-h-[600px] overflow-y-auto pr-1">
              {products.length === 0 ? (
                <div className="col-span-2 sm:col-span-3 p-10 text-center bg-white rounded-2xl border border-dashed border-neutral-300">
                  <Package className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
                  <p className="text-sm font-bold text-neutral-700">Nenhum produto cadastrado no estoque</p>
                  <p className="text-xs text-neutral-400 mt-1">Cadastre seus produtos na aba "Estoque" para realizar vendas no balcão.</p>
                </div>
              ) : (
                sortProductsForStore(
                  products.filter((p) => {
                    if (p.active === false) return false;
                    if (posCategory === 'outros') {
                      if (storeCategoryIdSet.has(p.category)) return false;
                    } else if (posCategory !== 'todas' && p.category !== posCategory) {
                      return false;
                    }
                    if (posSearch.trim()) {
                      const q = posSearch.toLowerCase();
                      return (
                        p.name.toLowerCase().includes(q) ||
                        p.volume.toLowerCase().includes(q) ||
                        p.sku.toLowerCase().includes(q)
                      );
                    }
                    return true;
                  }),
                  settings,
                  products
                ).map(product => {
                    const isCombo = isComboProduct(product.id, settings);
                    const comboMetrics = isCombo ? calculateComboMetrics(product, settings, products) : null;
                    const sellsCase = !isCombo && canSellProductCase(product, settings, 'local');
                    const hasCaseStock = sellsCase && product.stock >= (product.caseSize || 2);
                    const selectedUnit: SaleUnit =
                      sellsCase && posSelectedUnits[product.id] === 'case' && hasCaseStock ? 'case' : 'unit';

                    const inCartItems = posCart.filter(i => i.product.id === product.id);
                    const totalQtyInCart = inCartItems.reduce((s, i) => s + i.quantity, 0);
                    const isOutOfStock = product.stock <= 0;
                    const promoActive = isProductPromoActive(product);
                    const unitEffPrice = getEffectiveProductPrice(product);
                    const displayPrice =
                      selectedUnit === 'case' && sellsCase ? Number(product.casePrice) : unitEffPrice;

                    return (
                      <div
                        key={product.id}
                        className={`text-left p-3 rounded-2xl border transition-all flex flex-col justify-between ${
                          isOutOfStock
                            ? 'opacity-40 bg-neutral-100 border-neutral-200'
                            : totalQtyInCart > 0
                            ? 'border-amber-500 bg-amber-50/40 shadow-xs'
                            : 'bg-white border-neutral-200 hover:border-amber-400 hover:shadow-xs'
                        }`}
                      >
                        <div>
                          <div className="flex justify-between items-start gap-1">
                            <span className="text-[10px] font-bold text-neutral-400 uppercase">
                              {isCombo ? 'COMBO' : product.volume}
                            </span>
                            <div className="flex items-center gap-1">
                              {isCombo && (
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                                  Combo
                                </span>
                              )}
                              {promoActive && selectedUnit === 'unit' && (
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-red-600 text-white uppercase">
                                  PROMO
                                </span>
                              )}
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-neutral-100 text-neutral-600">
                                {isCombo
                                  ? `Disponível: ${product.stock}`
                                  : `Est: ${formatStockWithCases(product.stock, product.caseSize)}`}
                              </span>
                            </div>
                          </div>
                          <h4 className="font-bold text-xs text-neutral-900 mt-1 line-clamp-2">{product.name}</h4>
                          {isCombo && comboMetrics?.itemsSummaryText && (
                            <p className="text-[10px] text-neutral-500 mt-0.5 line-clamp-2">
                              {comboMetrics.itemsSummaryText}
                            </p>
                          )}

                          {sellsCase && (
                            <div className="mt-2 space-y-1">
                              <div className="grid grid-cols-2 gap-1 bg-neutral-100 p-0.5 rounded-lg border border-neutral-200 text-[10px]">
                                <button
                                  type="button"
                                  onClick={() => setPosSelectedUnits(prev => ({ ...prev, [product.id]: 'unit' }))}
                                  className={`py-1 px-1.5 rounded-md font-bold transition-colors cursor-pointer truncate ${
                                    selectedUnit === 'unit'
                                      ? 'bg-white text-neutral-900 shadow-2xs'
                                      : 'text-neutral-600 hover:text-neutral-900'
                                  }`}
                                >
                                  <span className="sm:hidden">Un</span>
                                  <span className="hidden sm:inline">Unidade ({formatCurrency(unitEffPrice)})</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={!hasCaseStock}
                                  onClick={() => setPosSelectedUnits(prev => ({ ...prev, [product.id]: 'case' }))}
                                  className={`py-1 px-1.5 rounded-md font-bold transition-colors truncate ${
                                    !hasCaseStock
                                      ? 'text-neutral-400 cursor-not-allowed'
                                      : selectedUnit === 'case'
                                      ? 'bg-amber-500 text-neutral-950 shadow-2xs cursor-pointer'
                                      : 'text-neutral-600 hover:text-neutral-900 cursor-pointer'
                                  }`}
                                >
                                  <span className="sm:hidden">Cx {product.caseSize}</span>
                                  <span className="hidden sm:inline">Caixa c/{product.caseSize} ({formatCurrency(Number(product.casePrice))})</span>
                                </button>
                              </div>
                              {!hasCaseStock && !isOutOfStock && (
                                <p className="text-[9px] text-amber-700 font-semibold">
                                  Sem caixa fechada no estoque
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mt-3 pt-2 border-t border-neutral-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div>
                            {promoActive && selectedUnit === 'unit' && (
                              <span className="text-[10px] text-neutral-400 line-through block">
                                {formatCurrency(product.price)}
                              </span>
                            )}
                            <span className={`font-black text-sm ${promoActive && selectedUnit === 'unit' ? 'text-red-600' : 'text-neutral-900'}`}>
                              {formatCurrency(displayPrice)}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={isOutOfStock}
                            onClick={() => !isOutOfStock && addToPosCart(product, selectedUnit)}
                            className="w-full sm:w-auto justify-center px-2.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 text-white rounded-xl text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span>Adicionar</span>
                            {totalQtyInCart > 0 && (
                              <span className="ml-0.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-neutral-950 font-black text-[10px]">
                                {totalQtyInCart}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-neutral-200 p-4 sm:p-5 shadow-xs flex flex-col justify-between h-fit min-w-0">
            <div>
              <div className="flex items-center justify-between border-b border-neutral-200 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-amber-500" />
                  <h3 className="font-black text-base text-neutral-900">Caixa Balcão</h3>
                </div>
                {posCart.length > 0 && (
                  <button
                    onClick={() => {
                      setPosCart([]);
                      setPosError('');
                      setPosCanRetry(false);
                      setPosSubmittingStatus('');
                      setPosClientRequestId(crypto.randomUUID());
                    }}
                    className="text-xs text-neutral-400 hover:text-red-500 font-semibold"
                  >
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
                  posCart.map(item => {
                    const isCase = item.saleUnit === 'case' && canSellProductCase(item.product, settings, 'local');
                    const effPrice = getPosItemPrice(item.product, item.saleUnit, item.addonsTotal || 0);
                    return (
                      <div key={item.lineId} className="flex items-start justify-between gap-2 p-2 bg-neutral-50 rounded-xl text-xs">
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-neutral-900 truncate">
                            {isCase
                              ? `${item.product.name} — Caixa c/${item.product.caseSize}`
                              : item.product.name}
                          </div>
                          {item.comboItems && item.comboItems.length > 0 && (
                            <div className="mt-0.5 space-y-0.5">
                              {item.comboItems.map((ci, cIdx) => (
                                <p key={cIdx} className="text-[10px] font-semibold text-neutral-600">
                                  {formatOrderItemComboLine(ci)}
                                </p>
                              ))}
                            </div>
                          )}
                          {item.addons && item.addons.length > 0 && (
                            <div className="mt-0.5 space-y-0.5">
                              {item.addons.map((addon, aIdx) => (
                                <p key={aIdx} className="text-[10px] font-semibold text-neutral-600">
                                  {formatOrderItemAddonLine(addon)}
                                </p>
                              ))}
                            </div>
                          )}
                          <div className="text-[10px] text-neutral-500 mt-0.5">
                            {formatCurrency(effPrice)} {isCase ? `cx (${item.quantity * (item.product.caseSize || 1)} un)` : 'un'}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => changePosCartLineQuantity(item.lineId, -1)}
                            className="w-10 h-10 min-w-[40px] min-h-[40px] sm:w-7 sm:h-7 sm:min-w-[28px] sm:min-h-[28px] shrink-0 flex items-center justify-center bg-white border border-neutral-200 rounded-lg text-neutral-700 hover:bg-neutral-200 font-black text-sm sm:text-xs"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-black">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => changePosCartLineQuantity(item.lineId, 1)}
                            className="w-10 h-10 min-w-[40px] min-h-[40px] sm:w-7 sm:h-7 sm:min-w-[28px] sm:min-h-[28px] shrink-0 flex items-center justify-center bg-white border border-neutral-200 rounded-lg text-neutral-700 hover:bg-neutral-200 font-black text-sm sm:text-xs"
                          >
                            +
                          </button>
                        </div>

                        <span className="font-bold text-neutral-900 w-16 text-right shrink-0">
                          {formatCurrency(effPrice * item.quantity)}
                        </span>
                      </div>
                    );
                  })
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
                      step="0.01"
                      min="0"
                      placeholder="Ex: 50.00"
                      value={posCashGiven}
                      onChange={(e) => setPosCashGiven(e.target.value)}
                      className={`w-full px-2.5 py-1.5 bg-white border rounded-lg text-xs ${
                        isPosCashShort ? 'border-red-400' : 'border-neutral-300'
                      }`}
                    />
                    {isPosCashShort && (
                      <p className="text-red-600 font-bold text-xs pt-1">
                        Falta R$ {posCashShortfall.toFixed(2).replace('.', ',')}
                      </p>
                    )}
                    {!isPosCashShort && posHasCashTyped && Math.round(posCashNum * 100) >= Math.round(posSubtotal * 100) && (
                      <p className="text-emerald-700 font-bold text-xs pt-1">
                        Troco a Devolver: {formatCurrency(Math.max(0, posCashNum - posSubtotal))}
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

              {isSubmittingPos && posSubmittingStatus && (
                <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs font-bold flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 shrink-0 text-amber-600 animate-spin" />
                  <span>{posSubmittingStatus}</span>
                </div>
              )}

              {posError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-bold space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                    <span>{posError}</span>
                  </div>
                  {posCanRetry && (
                    <button
                      type="button"
                      disabled={isSubmittingPos}
                      onClick={handleFinishPosSale}
                      className="w-full py-2 px-3 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-black text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span>Tentar de novo</span>
                    </button>
                  )}
                </div>
              )}

              <button
                onClick={handleFinishPosSale}
                disabled={posCart.length === 0 || isSubmittingPos || isPosCashShort}
                className="w-full py-3.5 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 text-white font-black text-sm rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5 text-amber-400" />
                <span>{isSubmittingPos ? (posSubmittingStatus || 'Enviando...') : 'Finalizar Venda & Imprimir'}</span>
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB: FINANCEIRO (CAIXA & RELATÓRIOS)                      */}
      {/* ========================================================= */}
      {activeTab === 'financeiro' && (
        <div className="space-y-6">
          {/* Sub-tabs: Resumo & Expedientes | Pagamentos */}
          <div className="bg-white p-3 rounded-2xl border border-neutral-200 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setFinanceiroSubTab('resumo')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                  financeiroSubTab === 'resumo'
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900'
                }`}
              >
                📊 Resumo & Expedientes
              </button>
              <button
                type="button"
                onClick={() => setFinanceiroSubTab('pagamentos')}
                className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer ${
                  financeiroSubTab === 'pagamentos'
                    ? 'bg-neutral-900 text-white shadow-xs'
                    : 'bg-neutral-100 text-neutral-600 hover:text-neutral-900'
                }`}
              >
                💳 Pagamentos
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refreshCashSessionsData(true)}
                disabled={isLoadingCashData}
                className="px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isLoadingCashData ? 'animate-spin' : ''}`} />
                <span>Atualizar</span>
              </button>
            </div>
          </div>

          {financeiroSubTab === 'pagamentos' ? (
            <PaymentsHistorySection
              currentSession={currentCashSession}
              cashSessions={cashSessionsList}
            />
          ) : (
            <div className="space-y-6">
              {/* Filter Bar (4a): Default = Expediente atual (or latest closed), selector for any session or date range */}
              <div className="bg-white p-4 sm:p-5 rounded-3xl border border-neutral-200 shadow-xs space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-amber-600 block">
                      Período do Caixa & Relatórios
                    </span>
                    <h3 className="text-base sm:text-lg font-black text-neutral-900 mt-0.5">
                      {financeiroFilterMode === 'date_range'
                        ? `Filtro por datas (${financeiroDateFrom} até ${financeiroDateTo})`
                        : displayedCashSession
                        ? displayedCashSession.closedAt
                          ? `Expediente fechado (${formatCashSessionDateTime(
                              displayedCashSession.openedAt
                            )} → ${formatCashSessionDateTime(displayedCashSession.closedAt)})`
                          : `Expediente atual • Aberto desde ${formatCashSessionBadgeDate(
                              displayedCashSession.openedAt
                            )}`
                        : 'Nenhum expediente registrado ainda'}
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={
                        financeiroFilterMode === 'session'
                          ? `session:${selectedFinanceiroSessionId}`
                          : financeiroFilterMode
                      }
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'current_session') {
                          setFinanceiroFilterMode('current_session');
                          setSelectedFinanceiroSessionId('');
                        } else if (val === 'date_range') {
                          setFinanceiroFilterMode('date_range');
                          setSelectedFinanceiroSessionId('');
                        } else if (val.startsWith('session:')) {
                          setFinanceiroFilterMode('session');
                          setSelectedFinanceiroSessionId(val.replace('session:', ''));
                        }
                      }}
                      className="px-3.5 py-2.5 bg-neutral-100 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="current_session">
                        {currentCashSession
                          ? 'Expediente atual (aberto)'
                          : latestClosedCashSession
                          ? `Último expediente fechado (${formatCashSessionDateTime(
                              latestClosedCashSession.openedAt
                            )})`
                          : 'Expediente atual'}
                      </option>
                      <option value="date_range">📅 Filtrar por datas do calendário</option>
                      {cashSessionsList.length > 0 && (
                        <optgroup label="Escolher expediente da lista">
                          {cashSessionsList.map((sess) => (
                            <option key={sess.id} value={`session:${sess.id}`}>
                              {formatCashSessionDateTime(sess.openedAt)}
                              {sess.closedAt
                                ? ` → ${formatCashSessionDateTime(sess.closedAt)}`
                                : ' (Aberto agora)'}{' '}
                              — {formatCurrency(sess.summary?.totalRevenue || 0)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>

                    {displayedCashSession && (
                      <button
                        type="button"
                        onClick={() => setClosingReceiptSession(displayedCashSession)}
                        className="px-3.5 py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-black flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Printer className="w-4 h-4 text-amber-400" />
                        <span>Ver / Imprimir 80mm</span>
                      </button>
                    )}
                  </div>
                </div>

                {financeiroFilterMode === 'date_range' && (
                  <div className="pt-3 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-end">
                    <div>
                      <label className="block text-xs font-bold text-neutral-600 mb-1">
                        Data inicial
                      </label>
                      <input
                        type="date"
                        value={financeiroDateFrom}
                        onChange={(e) => setFinanceiroDateFrom(e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-neutral-600 mb-1">
                        Data final
                      </label>
                      <input
                        type="date"
                        value={financeiroDateTo}
                        onChange={(e) => setFinanceiroDateTo(e.target.value)}
                        className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-900"
                      />
                    </div>
                    <div className="text-xs text-neutral-500 pb-1">
                      {isLoadingRangeSummary
                        ? 'Calculando vendas do período...'
                        : `${displayedSummary.ordersCount} vendas encontradas no período`}
                    </div>
                  </div>
                )}
              </div>

              {/* Top KPI Cards (Item 3) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
                  <div className="flex items-center justify-between text-neutral-500 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Faturamento</span>
                    <DollarSign className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h3 className="text-2xl font-black text-neutral-900">
                    {formatCurrency(displayedSummary.totalRevenue)}
                  </h3>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    {displayedSummary.ordersCount}{' '}
                    {displayedSummary.ordersCount === 1 ? 'venda válida' : 'vendas válidas'}
                    {displayedSummary.cancelledCount > 0
                      ? ` • ${displayedSummary.cancelledCount} cancelada(s)`
                      : ''}
                  </p>
                </div>

                <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
                  <div className="flex items-center justify-between text-neutral-500 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">Ticket Médio</span>
                    <BarChart3 className="w-4 h-4 text-sky-500" />
                  </div>
                  <h3 className="text-2xl font-black text-neutral-900">
                    {formatCurrency(displayedSummary.avgTicket)}
                  </h3>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Taxa garçom: {formatCurrency(displayedSummary.serviceFeeTotal)} • Descontos:{' '}
                    {formatCurrency(displayedSummary.discountTotal)}
                  </p>
                </div>

                <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
                  <div className="flex items-center justify-between text-neutral-500 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Canais de Venda
                    </span>
                    <Truck className="w-4 h-4 text-purple-500" />
                  </div>
                  <div className="space-y-1 text-xs font-bold text-neutral-800 mt-1">
                    <div className="flex justify-between">
                      <span>📱 Online ({displayedSummary.onlineCount}):</span>
                      <span>{formatCurrency(displayedSummary.onlineRevenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>🏪 Balcão ({displayedSummary.posCount}):</span>
                      <span>{formatCurrency(displayedSummary.posRevenue)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>🍻 Mesas ({displayedSummary.mesaCount}):</span>
                      <span>{formatCurrency(displayedSummary.mesaRevenue)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white p-5 rounded-3xl border border-neutral-200 shadow-xs">
                  <div className="flex items-center justify-between text-neutral-500 mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider">
                      Gaveta (Dinheiro)
                    </span>
                    <TrendingUp className="w-4 h-4 text-amber-500" />
                  </div>
                  <h3 className="text-2xl font-black text-emerald-700">
                    {formatCurrency(displayedSummary.expectedCash)}
                  </h3>
                  <div className="text-[11px] text-neutral-500 mt-1 space-y-0.5">
                    <div>
                      Troco inicial {formatCurrency(displayedSummary.openingCash)} + Vendas{' '}
                      {formatCurrency(displayedSummary.paymentBreakdown.dinheiro)}
                    </div>
                    {displayedSummary.countedCash !== null && (
                      <div className="font-bold text-neutral-800">
                        Contado: {formatCurrency(displayedSummary.countedCash)} (
                        <span
                          className={
                            formatCashDifferenceLabel(displayedSummary.cashDifference).tone ===
                            'red'
                              ? 'text-red-600'
                              : formatCashDifferenceLabel(displayedSummary.cashDifference).tone ===
                                'amber'
                              ? 'text-amber-600'
                              : 'text-emerald-600'
                          }
                        >
                          {formatCashDifferenceLabel(displayedSummary.cashDifference).text}
                        </span>
                        )
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Payment Breakdown & Detailed Cash Closing Card */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-3xl border border-neutral-200 p-6 shadow-xs">
                  <h4 className="font-bold text-sm text-neutral-900 mb-4">
                    Entradas por Forma de Pagamento
                  </h4>
                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex justify-between font-bold mb-1">
                        <span>💵 Dinheiro</span>
                        <span>{formatCurrency(displayedSummary.paymentBreakdown.dinheiro)}</span>
                      </div>
                      <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-emerald-500 h-2.5 rounded-full"
                          style={{
                            width: `${
                              displayedSummary.totalRevenue > 0
                                ? (displayedSummary.paymentBreakdown.dinheiro /
                                    displayedSummary.totalRevenue) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-bold mb-1">
                        <span>⚡ PIX</span>
                        <span>{formatCurrency(displayedSummary.paymentBreakdown.pix)}</span>
                      </div>
                      <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-amber-500 h-2.5 rounded-full"
                          style={{
                            width: `${
                              displayedSummary.totalRevenue > 0
                                ? (displayedSummary.paymentBreakdown.pix /
                                    displayedSummary.totalRevenue) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-bold mb-1">
                        <span>💳 Cartão de Débito</span>
                        <span>
                          {formatCurrency(displayedSummary.paymentBreakdown.cartao_debito)}
                        </span>
                      </div>
                      <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-purple-500 h-2.5 rounded-full"
                          style={{
                            width: `${
                              displayedSummary.totalRevenue > 0
                                ? (displayedSummary.paymentBreakdown.cartao_debito /
                                    displayedSummary.totalRevenue) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-bold mb-1">
                        <span>💳 Cartão de Crédito</span>
                        <span>
                          {formatCurrency(displayedSummary.paymentBreakdown.cartao_credito)}
                        </span>
                      </div>
                      <div className="w-full bg-neutral-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-blue-500 h-2.5 rounded-full"
                          style={{
                            width: `${
                              displayedSummary.totalRevenue > 0
                                ? (displayedSummary.paymentBreakdown.cartao_credito /
                                    displayedSummary.totalRevenue) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-neutral-900 text-white rounded-3xl p-6 shadow-xs flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                      Resumo Completo do Expediente (Item 3)
                    </span>
                    <h4 className="text-xl font-black mt-1">Conferência do Caixa</h4>
                    <div className="mt-4 space-y-2 text-xs border-t border-neutral-800 pt-4">
                      <div className="flex justify-between text-neutral-300">
                        <span>Vendas Online:</span>
                        <span className="font-bold">
                          {displayedSummary.onlineCount} pedidos (
                          {formatCurrency(displayedSummary.onlineRevenue)})
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300">
                        <span>Vendas Balcão:</span>
                        <span className="font-bold">
                          {displayedSummary.posCount} vendas (
                          {formatCurrency(displayedSummary.posRevenue)})
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300">
                        <span>Vendas Mesas:</span>
                        <span className="font-bold">
                          {displayedSummary.mesaCount} contas (
                          {formatCurrency(displayedSummary.mesaRevenue)})
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300">
                        <span>Taxa de serviço dos garçons:</span>
                        <span className="font-mono font-bold text-amber-300">
                          {formatCurrency(displayedSummary.serviceFeeTotal)}
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300">
                        <span>Descontos concedidos:</span>
                        <span className="font-mono font-bold text-neutral-200">
                          {formatCurrency(displayedSummary.discountTotal)}
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300">
                        <span>Pedidos cancelados (não somam):</span>
                        <span className="font-mono font-bold text-red-400">
                          {displayedSummary.cancelledCount}
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300 pt-2 border-t border-neutral-800">
                        <span>Dinheiro inicial (troco):</span>
                        <span className="font-mono font-bold text-neutral-200">
                          {formatCurrency(displayedSummary.openingCash)}
                        </span>
                      </div>
                      <div className="flex justify-between text-neutral-300">
                        <span>Vendas em Dinheiro:</span>
                        <span className="font-mono font-bold text-emerald-400">
                          {formatCurrency(displayedSummary.paymentBreakdown.dinheiro)}
                        </span>
                      </div>
                      <div className="flex justify-between text-white font-bold">
                        <span>Dinheiro esperado na gaveta:</span>
                        <span className="font-mono text-emerald-400">
                          {formatCurrency(displayedSummary.expectedCash)}
                        </span>
                      </div>
                      {displayedSummary.countedCash !== null && (
                        <>
                          <div className="flex justify-between text-neutral-300">
                            <span>Dinheiro contado na gaveta:</span>
                            <span className="font-mono font-bold text-white">
                              {formatCurrency(displayedSummary.countedCash)}
                            </span>
                          </div>
                          <div className="flex justify-between text-neutral-300">
                            <span>Diferença do caixa:</span>
                            <span className="font-mono font-black text-amber-400">
                              {formatCashDifferenceLabel(displayedSummary.cashDifference).text}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] text-neutral-400 uppercase">
                        Faturamento Total:
                      </span>
                      <div className="text-2xl font-black text-amber-400">
                        {formatCurrency(displayedSummary.totalRevenue)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {displayedCashSession && (
                        <button
                          type="button"
                          onClick={() => setClosingReceiptSession(displayedCashSession)}
                          className="flex items-center gap-2 px-4 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                        >
                          <Printer className="w-4 h-4" />
                          <span>Imprimir Fechamento</span>
                        </button>
                      )}
                      {currentCashSession &&
                        (!displayedCashSession ||
                          displayedCashSession.id === currentCashSession.id) && (
                          <button
                            type="button"
                            onClick={async () => {
                              await refreshCashSessionsData(false);
                              setIsCloseCashModalOpen(true);
                            }}
                            className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black transition-colors cursor-pointer"
                          >
                            Fechar expediente
                          </button>
                        )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 4b) Lista "Expedientes anteriores" */}
              <div className="bg-white rounded-3xl border border-neutral-200 overflow-hidden shadow-xs">
                <div className="p-5 border-b border-neutral-200 flex items-center justify-between">
                  <div>
                    <h4 className="font-black text-base text-neutral-900">
                      Expedientes anteriores
                    </h4>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Histórico de abertura e fechamento do caixa, duração, faturamento e conferência de gaveta.
                    </p>
                  </div>
                </div>

                {cashSessionsList.length === 0 ? (
                  <div className="p-10 text-center text-xs text-neutral-500">
                    Nenhum expediente foi aberto ainda. Clique em "Abrir expediente" no topo do painel.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-neutral-700">
                      <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 uppercase tracking-wider font-bold">
                        <tr>
                          <th className="py-3 px-4">Abertura</th>
                          <th className="py-3 px-4">Fechamento</th>
                          <th className="py-3 px-4">Duração</th>
                          <th className="py-3 px-4">Faturamento</th>
                          <th className="py-3 px-4">Diferença do Caixa</th>
                          <th className="py-3 px-4 text-right">Ações</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {cashSessionsList.map((sess) => {
                          const isOpen = !sess.closedAt;
                          const diffInfo = formatCashDifferenceLabel(
                            sess.summary?.cashDifference ?? null
                          );
                          return (
                            <tr
                              key={sess.id}
                              className="hover:bg-neutral-50/80 transition-colors"
                            >
                              <td className="py-3.5 px-4 font-bold text-neutral-900 whitespace-nowrap">
                                {formatCashSessionDateTime(sess.openedAt)}
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                {isOpen ? (
                                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black text-[10px] uppercase">
                                    Aberto agora
                                  </span>
                                ) : (
                                  <span className="font-medium text-neutral-700">
                                    {formatCashSessionDateTime(sess.closedAt)}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-neutral-600 whitespace-nowrap">
                                {formatCashSessionDuration(sess.openedAt, sess.closedAt)}
                              </td>
                              <td className="py-3.5 px-4 font-mono font-black text-neutral-900 whitespace-nowrap">
                                {formatCurrency(sess.summary?.totalRevenue || 0)}
                                <span className="block text-[10px] font-sans font-normal text-neutral-400">
                                  {sess.summary?.ordersCount || 0} vendas
                                </span>
                              </td>
                              <td className="py-3.5 px-4 whitespace-nowrap">
                                {isOpen ? (
                                  <span className="text-neutral-400">—</span>
                                ) : (
                                  <span
                                    className={`px-2.5 py-1 rounded-lg font-bold text-xs ${
                                      diffInfo.tone === 'emerald'
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                        : diffInfo.tone === 'amber'
                                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                        : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}
                                  >
                                    {diffInfo.text}
                                  </span>
                                )}
                              </td>
                              <td className="py-3.5 px-4 text-right whitespace-nowrap">
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFinanceiroFilterMode('session');
                                      setSelectedFinanceiroSessionId(sess.id);
                                      window.scrollTo({ top: 0, behavior: 'smooth' });
                                    }}
                                    className="px-3 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 font-bold text-xs transition-colors cursor-pointer"
                                  >
                                    Ver resumo
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setClosingReceiptSession(sess)}
                                    className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                                  >
                                    <Printer className="w-3.5 h-3.5 text-amber-400" />
                                    <span>Ver / Imprimir</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
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
                    step="0.01"
                    min="0"
                    value={settingsForm.freeDeliveryThreshold}
                    onChange={(e) => setSettingsForm({ ...settingsForm, freeDeliveryThreshold: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Pedido Mínimo (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={settingsForm.minOrderValue}
                    onChange={(e) => setSettingsForm({ ...settingsForm, minOrderValue: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>
            </div>

            {/* EXIBIÇÃO DE ESTOQUE & ORDEM DOS PRODUTOS NA LOJA */}
            <div className="pt-4 border-t border-neutral-100 space-y-3">
              <h4 className="font-black text-sm text-neutral-900">Vitrine & Estoque na Loja Online</h4>
              <label className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-neutral-50 border border-neutral-200 cursor-pointer">
                <div>
                  <span className="font-bold text-xs sm:text-sm text-neutral-900 block">
                    Mostrar produtos esgotados na loja (como 'Esgotado')
                  </span>
                  <span className="text-[11px] text-neutral-500 block mt-0.5">
                    Quando desligado (padrão), produtos com estoque zerado ficam ocultos na loja online e categorias vazias somem do menu.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(settingsForm.showOutOfStock)}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      showOutOfStock: e.target.checked,
                    })
                  }
                  className="w-5 h-5 rounded text-amber-500 focus:ring-amber-500 shrink-0 cursor-pointer"
                />
              </label>

              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <label className="font-bold text-xs sm:text-sm text-neutral-900 block">
                    Ordem dos produtos na loja
                  </label>
                  <span className="text-[11px] text-neutral-500 block mt-0.5">
                    Produtos marcados como "Mostrar primeiro" aparecem no topo, seguidos desta ordenação (preço considera promoção ativa).
                  </span>
                </div>
                <select
                  value={settingsForm.productSortMode || 'manual'}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      productSortMode: e.target.value as ProductSortMode,
                    })
                  }
                  className="px-3 py-2 bg-white border border-neutral-300 rounded-xl font-bold text-neutral-900 shrink-0"
                >
                  <option value="manual">Manual (arrastar)</option>
                  <option value="az">Ordem alfabética (A–Z)</option>
                  <option value="price_asc">Menor preço primeiro</option>
                  <option value="price_desc">Maior preço primeiro</option>
                </select>
              </div>

              {/* OTIMIZAR FOTOS JÁ EXISTENTES NO BANCO */}
              <div className="p-4 rounded-2xl bg-neutral-50 border border-neutral-200 space-y-3 text-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-xs sm:text-sm text-neutral-900 block">
                      Otimizar fotos cadastradas ({storedPhotoProducts.length} com foto no banco)
                    </span>
                    <span className="text-[11px] text-neutral-500 block mt-0.5">
                      Reduz automaticamente fotos pesadas já cadastradas (máx. 600×600 px, WebP/JPEG leve) para deixar a loja mais rápida e economizar tráfego do banco.
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={batchPhotoOpt.running}
                    onClick={handleBatchOptimizeProductPhotos}
                    className="px-4 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white font-black rounded-xl text-xs inline-flex items-center justify-center gap-2 shrink-0 cursor-pointer transition-colors"
                  >
                    <ImageIcon className="w-4 h-4 text-amber-400" />
                    <span>
                      {batchPhotoOpt.running
                        ? `${batchPhotoOpt.current} de ${batchPhotoOpt.total}`
                        : 'Otimizar fotos dos produtos'}
                    </span>
                  </button>
                </div>

                {batchPhotoOpt.running && batchPhotoOpt.total > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold text-neutral-700">
                      <span>Progresso: {batchPhotoOpt.current} de {batchPhotoOpt.total}</span>
                      <span>{Math.round((batchPhotoOpt.current / batchPhotoOpt.total) * 100)}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-neutral-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 transition-all duration-200"
                        style={{
                          width: `${Math.round((batchPhotoOpt.current / batchPhotoOpt.total) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {batchPhotoOpt.summaryText && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-black flex flex-wrap items-center justify-between gap-2">
                    <span>{batchPhotoOpt.summaryText}</span>
                    <span className="text-[11px] font-bold text-emerald-700">
                      ({batchPhotoOpt.updatedCount} fotos reduzidas de {batchPhotoOpt.total})
                    </span>
                  </div>
                )}

                {batchPhotoOpt.errorText && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                    {batchPhotoOpt.errorText}
                  </div>
                )}
              </div>
            </div>

            {/* ATALHOS DO TECLADO (DESKTOP) */}
            <div className="pt-4 border-t border-neutral-100 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="font-black text-sm text-neutral-900 flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-amber-500" />
                    <span>Atalhos do teclado</span>
                  </h4>
                  <p className="text-[11px] text-neutral-500 mt-0.5">
                    Atalhos rápidos para uso no computador. Clique em "Alterar" e pressione a nova tecla desejada.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsForm((prev) => ({
                      ...prev,
                      shortcuts: { ...DEFAULT_SHORTCUTS },
                    }));
                    setRecordingShortcutAction(null);
                    setShortcutWarning('');
                  }}
                  className="px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Restaurar padrão
                </button>
              </div>

              {shortcutWarning && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold flex items-center justify-between gap-2">
                  <span>{shortcutWarning}</span>
                  <button
                    type="button"
                    onClick={() => setShortcutWarning('')}
                    className="p-1 hover:bg-amber-200/60 rounded text-amber-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-2xl overflow-hidden text-xs">
                {SHORTCUT_ACTION_ITEMS.map((item) => {
                  const currentKey =
                    settingsForm.shortcuts?.[item.action] || DEFAULT_SHORTCUTS[item.action];
                  const isRecording = recordingShortcutAction === item.action;
                  const duplicateOther = SHORTCUT_ACTION_ITEMS.find(
                    (other) =>
                      other.action !== item.action &&
                      (
                        settingsForm.shortcuts?.[other.action] ||
                        DEFAULT_SHORTCUTS[other.action]
                      ).toUpperCase() === currentKey.toUpperCase()
                  );

                  return (
                    <div
                      key={item.action}
                      className="p-3 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <span className="font-bold text-neutral-900 block">{item.label}</span>
                        <span className="text-[11px] text-neutral-500 block">{item.description}</span>
                        {duplicateOther && (
                          <span className="text-[11px] text-amber-700 font-bold block mt-0.5">
                            ⚠ Tecla também atribuída a "{duplicateOther.label}"
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`px-3 py-1.5 rounded-lg font-mono font-black text-xs border ${
                            isRecording
                              ? 'bg-amber-100 text-amber-900 border-amber-400 animate-pulse'
                              : 'bg-neutral-100 text-neutral-900 border-neutral-300'
                          }`}
                        >
                          {isRecording
                            ? 'Pressione uma tecla...'
                            : formatShortcutDisplay(currentKey)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setShortcutWarning('');
                            setRecordingShortcutAction(isRecording ? null : item.action);
                          }}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                            isRecording
                              ? 'bg-neutral-900 text-white'
                              : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-800'
                          }`}
                        >
                          {isRecording ? 'Cancelar' : 'Alterar'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-neutral-100 flex items-center justify-end">
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
                    step="0.01"
                    min="0"
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
                type="button"
                onClick={handleRequestCloseProductModal}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              ref={productFormRef}
              onSubmit={handleSaveProduct}
              onKeyDown={handleProductFormKeyDown}
              className="p-6 space-y-4 text-xs"
            >
              {showDiscardProductConfirm && (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-950 space-y-3">
                  <div className="flex items-center gap-2 font-black text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Descartar alterações?</span>
                  </div>
                  <p className="text-[11px] text-amber-900 font-medium">
                    Você alterou os dados deste produto. Se fechar agora, as alterações não salvas serão perdidas.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDiscardProductConfirm(false)}
                      className="px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 font-bold text-xs cursor-pointer"
                    >
                      Continuar editando
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowDiscardProductConfirm(false);
                        setIsProductModalOpen(false);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs cursor-pointer"
                    >
                      Descartar
                    </button>
                  </div>
                </div>
              )}

              {productModalSuccessNotice && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{productModalSuccessNotice}</span>
                </div>
              )}

              {productModalError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold text-xs">
                  {productModalError}
                </div>
              )}

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Nome do Produto *</label>
                <input
                  ref={productNameInputRef}
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
                    {storeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    {!storeCategoryIdSet.has(productForm.category) && productForm.category && (
                      <option value={productForm.category}>
                        {formatCategoryLabel(productForm.category)}
                      </option>
                    )}
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
                  <label className="font-bold text-neutral-700 block mb-1">Preço de Venda (Unidade R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={productForm.price}
                    onChange={(e) => setProductForm({ ...productForm, price: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Preço de Custo (Unidade R$) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={productForm.costPrice}
                    onChange={(e) => setProductForm({ ...productForm, costPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              {/* Caixa para Entrada de Estoque vs. Vender Caixa Fechada */}
              <div className="p-3.5 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-3">
                <div>
                  <label className="font-black text-neutral-900 text-xs block mb-1">
                    📦 Unidades por caixa (para entrada de estoque)
                  </label>
                  <p className="text-[10px] text-neutral-500 mb-1.5">
                    Opcional (2 a 100). Libera os botões +1cx / −1cx no Estoque mesmo sem vender caixa fechada ao cliente.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={2}
                      max={100}
                      step={1}
                      placeholder="Ex: 12, 15, 24 (deixe vazio se não usar caixa)"
                      value={productForm.caseSize > 0 ? productForm.caseSize : ''}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const parsed = raw === '' ? 0 : parseInt(raw, 10) || 0;
                        setProductForm({
                          ...productForm,
                          caseSize: parsed,
                          ...(parsed === 0 ? { sellsCase: false } : {}),
                        });
                      }}
                      className="w-full sm:w-64 px-3 py-2 bg-white border border-amber-300 rounded-xl font-bold text-neutral-900"
                    />
                    {productForm.caseSize > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setProductForm({
                            ...productForm,
                            caseSize: 0,
                            sellsCase: false,
                            casePrice: 0,
                          })
                        }
                        className="px-2.5 py-2 rounded-xl bg-white hover:bg-neutral-100 text-neutral-600 border border-neutral-300 text-[11px] font-bold cursor-pointer"
                      >
                        Limpar
                      </button>
                    )}
                  </div>
                </div>

                <div className="pt-2.5 border-t border-amber-200/80 space-y-2.5">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div>
                      <span className="font-black text-neutral-900 text-xs block">
                        Vender caixa fechada
                      </span>
                      <span className="text-[10px] text-neutral-500">
                        Habilita a venda do fardo/engradado fechado com preço próprio nos canais escolhidos
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={productForm.sellsCase}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        const nextSize = productForm.caseSize >= 2 ? productForm.caseSize : 12;
                        setProductForm({
                          ...productForm,
                          sellsCase: checked,
                          caseSize: checked ? nextSize : productForm.caseSize,
                          casePrice:
                            checked && productForm.casePrice <= 0
                              ? Math.round((productForm.price || 0) * nextSize * 100) / 100
                              : productForm.casePrice,
                        });
                      }}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                    />
                  </label>

                  {productForm.sellsCase && (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="font-bold text-neutral-700 block mb-1">
                            Preço da caixa fechada (R$) *
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            required={productForm.sellsCase}
                            value={productForm.casePrice}
                            onChange={(e) =>
                              setProductForm({
                                ...productForm,
                                casePrice: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl font-bold text-neutral-900"
                          />
                        </div>

                        <div>
                          <label className="font-bold text-neutral-700 block mb-1">
                            Onde vender a caixa fechada
                          </label>
                          <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-white border border-amber-300 rounded-xl">
                            <label className="inline-flex items-center gap-1.5 font-bold text-neutral-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={productForm.caseChannelStore}
                                onChange={(e) =>
                                  setProductForm({
                                    ...productForm,
                                    caseChannelStore: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                              />
                              <span>Delivery</span>
                            </label>
                            <label className="inline-flex items-center gap-1.5 font-bold text-neutral-800 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={productForm.caseChannelLocal}
                                onChange={(e) =>
                                  setProductForm({
                                    ...productForm,
                                    caseChannelLocal: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                              />
                              <span>Balcão/Mesa</span>
                            </label>
                          </div>
                        </div>
                      </div>

                      {productForm.caseSize >= 2 && productForm.casePrice > 0 && (
                        <div className="p-2.5 rounded-xl bg-white border border-amber-200 text-[11px] flex flex-col gap-0.5">
                          {(() => {
                            const unitInCase = productForm.casePrice / productForm.caseSize;
                            const looseTotal = (productForm.price || 0) * productForm.caseSize;
                            const savingsCase = looseTotal - productForm.casePrice;
                            const savingsUnit = (productForm.price || 0) - unitInCase;
                            return (
                              <>
                                <div className="font-bold text-neutral-800">
                                  Na caixa, cada unidade sai por{' '}
                                  <span className="text-amber-700 font-black">{formatCurrency(unitInCase)}</span>
                                </div>
                                {savingsCase > 0.009 ? (
                                  <div className="text-emerald-700 font-semibold">
                                    Economia de <strong>{formatCurrency(savingsUnit)}/un</strong> ({formatCurrency(savingsCase)} na caixa em relação à unidade avulsa)
                                  </div>
                                ) : savingsCase < -0.009 ? (
                                  <div className="text-amber-700 font-semibold">
                                    Atenção: o preço da caixa está maior que {productForm.caseSize} unidades avulsas ({formatCurrency(looseTotal)})
                                  </div>
                                ) : (
                                  <div className="text-neutral-500">
                                    Mesmo valor unitário da venda avulsa ({formatCurrency(looseTotal)} em {productForm.caseSize} un)
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    {editingProduct ? 'Estoque Atual (em unidades) *' : 'Estoque Inicial (em unidades) *'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={productForm.stock}
                    onChange={(e) =>
                      setProductForm({
                        ...productForm,
                        stock: Math.max(0, parseInt(e.target.value, 10) || 0),
                      })
                    }
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold"
                  />
                  {productForm.caseSize >= 2 && (
                    <span className="text-[10px] text-neutral-500 block mt-0.5">
                      Equivale a: {formatStockWithCases(productForm.stock, productForm.caseSize)}
                    </span>
                  )}
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

                <div className="flex flex-col gap-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-neutral-800">
                    <input
                      type="checkbox"
                      checked={productForm.isCold}
                      onChange={(e) => setProductForm({ ...productForm, isCold: e.target.checked })}
                      className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                    />
                    <span>❄️ Opção Gelada</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-neutral-800">
                    <input
                      type="checkbox"
                      checked={productForm.active !== false}
                      onChange={(e) => setProductForm({ ...productForm, active: e.target.checked })}
                      className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>{productForm.active !== false ? '✅ Ativo' : '🚫 Desativado'}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer font-bold text-neutral-800">
                    <input
                      type="checkbox"
                      checked={productForm.appearsInDelivery !== false}
                      onChange={(e) => setProductForm({ ...productForm, appearsInDelivery: e.target.checked })}
                      className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500"
                    />
                    <span>
                      {productForm.appearsInDelivery !== false
                        ? '🛵 Aparece no delivery'
                        : '🍻 Aparece no delivery (Só no balcão/mesa)'}
                    </span>
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="font-bold text-neutral-700 block">Foto da Bebida / Produto</label>
                  <button
                    type="button"
                    onClick={() => setShowProductPhotoHelp((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Como ajustar a foto</span>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  {productForm.image ? (
                    <img
                      src={productForm.image}
                      alt="Preview"
                      loading="lazy"
                      width={56}
                      height={56}
                      className="w-14 h-14 rounded-xl object-cover border border-neutral-300 shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-400 shrink-0">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="file"
                        id="product-computer-file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleProductPhotoUpload}
                        className="hidden"
                      />
                      <label
                        htmlFor="product-computer-file"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5 text-amber-400" />
                        <span>{isUploadingProductPhoto ? 'Otimizando...' : 'Carregar Foto'}</span>
                      </label>
                      {productForm.image && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductForm({ ...productForm, image: '' });
                            setProductPhotoOptimizedSummary('');
                          }}
                          className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs cursor-pointer"
                        >
                          Remover foto
                        </button>
                      )}
                      {productPhotoOptimizedSummary && (
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold text-[11px]">
                          {productPhotoOptimizedSummary}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-neutral-500">
                      JPG, PNG ou WebP (máx. 10 MB no arquivo original)
                    </p>
                  </div>
                </div>

                <div>
                  <input
                    type="url"
                    placeholder="Ou cole o link da imagem (https://...)"
                    value={productForm.image}
                    onChange={(e) => {
                      setProductForm({ ...productForm, image: e.target.value });
                      setProductPhotoOptimizedSummary('');
                    }}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                  />
                </div>

                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  Dica: use foto quadrada, com o produto centralizado e fundo claro. Tamanho ideal 600×600 px. Fotos grandes são reduzidas automaticamente para não deixar a loja lenta.
                </p>

                {showProductPhotoHelp && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-950 space-y-1">
                    <p className="font-black">Como deixar a foto perfeita:</p>
                    <ul className="list-disc pl-4 space-y-0.5 text-amber-900 font-medium">
                      <li>No celular, abra a foto na galeria e toque em <strong>editar → cortar → 1:1</strong> (formato quadrado).</li>
                      <li>Evite print de tela com bordas pretas, relógio ou barra de bateria.</li>
                      <li>Prefira fundo branco ou claro com a bebida bem centralizada.</li>
                      <li>Aceitamos JPG, PNG e WebP (até 10 MB). Fotos acima de 5 MB podem levar alguns segundos a mais para otimizar.</li>
                    </ul>
                  </div>
                )}
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

              <div className="pt-3 border-t border-neutral-200 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleRequestCloseProductModal}
                  className="px-4 py-2 font-medium text-neutral-600 hover:bg-neutral-100 rounded-xl cursor-pointer"
                >
                  Cancelar ({formatShortcutDisplay(activeShortcuts.fecharModal || 'Escape')})
                </button>
                <button
                  type="button"
                  onClick={() => submitProductForm('new')}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl shadow-xs inline-flex items-center gap-2 cursor-pointer"
                >
                  <span>Salvar e novo</span>
                  <span className="px-1.5 py-0.5 rounded bg-neutral-700 text-amber-300 font-mono text-[10px]">
                    {formatShortcutDisplay(activeShortcuts.saveAndNewProduct || 'Ctrl+Enter')}
                  </span>
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl shadow-xs inline-flex items-center gap-2 cursor-pointer"
                >
                  <span>Salvar</span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-600/30 text-neutral-950 font-mono text-[10px]">
                    {formatShortcutDisplay(activeShortcuts.saveProduct || 'Ctrl+S')}
                  </span>
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

      {/* Coupon Modal */}
      {isCouponModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200 my-6">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base flex items-center gap-2">
                <Ticket className="w-5 h-5 text-amber-500" />
                <span>Criar Novo Cupom de Desconto</span>
              </h3>
              <button
                onClick={() => setIsCouponModalOpen(false)}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCoupon} className="p-6 space-y-4 text-xs">
              {couponModalError && (
                <p className="p-2.5 rounded-xl bg-red-50 text-red-800 border border-red-200 font-bold">
                  {couponModalError}
                </p>
              )}

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Código do Cupom *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: PROMO10, BEMVINDO15"
                  value={couponForm.code}
                  onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-mono font-bold uppercase text-sm"
                />
                <p className="text-[10px] text-neutral-400 mt-1">Os clientes digitarão esse código exatamente no checkout.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Tipo de Desconto *</label>
                  <select
                    value={couponForm.type}
                    onChange={(e) => setCouponForm({ ...couponForm, type: e.target.value as 'percent' | 'fixed' })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-medium"
                  >
                    <option value="percent">Porcentagem (%)</option>
                    <option value="fixed">Valor Fixo (R$)</option>
                  </select>
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">
                    {couponForm.type === 'percent' ? 'Desconto (%) *' : 'Desconto (R$) *'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={couponForm.value}
                    onChange={(e) => setCouponForm({ ...couponForm, value: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900"
                  />
                </div>
              </div>

              {couponForm.type === 'percent' && (
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Desconto máximo (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Opcional — teto em reais (ex: 15.00)"
                    value={couponForm.maxDiscount ?? ''}
                    onChange={(e) =>
                      setCouponForm({
                        ...couponForm,
                        maxDiscount: e.target.value ? parseFloat(e.target.value) : undefined,
                      })
                    }
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Pedido Mínimo (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    placeholder="Opcional (ex: 50)"
                    value={couponForm.minOrder ?? ''}
                    onChange={(e) => setCouponForm({ ...couponForm, minOrder: e.target.value ? parseFloat(e.target.value) : undefined })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>

                <div>
                  <label className="font-bold text-neutral-700 block mb-1">Limite Máximo de Usos</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Ilimitado se vazio"
                    value={couponForm.maxUses ?? ''}
                    onChange={(e) => setCouponForm({ ...couponForm, maxUses: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                    className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Data de Expiração (Opcional)</label>
                <input
                  type="date"
                  value={couponForm.expiresAt || ''}
                  onChange={(e) => setCouponForm({ ...couponForm, expiresAt: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-neutral-800">
                  <input
                    type="checkbox"
                    checked={couponForm.active}
                    onChange={(e) => setCouponForm({ ...couponForm, active: e.target.checked })}
                    className="w-4 h-4 rounded text-amber-500 focus:ring-amber-500"
                  />
                  <span>Cupom Ativo e pronto para uso</span>
                </label>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsCouponModalOpen(false)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingCoupon}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl shadow-sm cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                >
                  {isSavingCoupon ? (
                    <span>Salvando...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Salvar Cupom</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Promotion Modal */}
      {isPromoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200 my-6">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-500" />
                <span>{promoForm.productId && isProductPromoActive(selectedPromoProduct || { price: 0 }) ? 'Editar Promoção' : 'Nova Promoção'}</span>
              </h3>
              <button
                onClick={() => setIsPromoModalOpen(false)}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePromotion} className="p-6 space-y-4 text-xs">
              {promoModalError && (
                <p className="p-2.5 rounded-xl bg-red-50 text-red-800 border border-red-200 font-bold">
                  {promoModalError}
                </p>
              )}

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Buscar e Selecionar Produto *</label>
                <div className="relative mb-2">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    placeholder="Digite o nome ou SKU para filtrar..."
                    value={promoProductSearch}
                    onChange={(e) => setPromoProductSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                  />
                </div>
                <select
                  required
                  value={promoForm.productId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const found = products.find((p) => p.id === pid);
                    setPromoForm((prev) => ({
                      ...prev,
                      productId: pid,
                      promoPrice:
                        found && found.promoPrice && found.promoPrice > 0
                          ? String(found.promoPrice)
                          : prev.promoPrice,
                    }));
                  }}
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900"
                >
                  <option value="">-- Selecione um produto --</option>
                  {products
                    .filter((p) => {
                      if (!promoProductSearch.trim()) return true;
                      const q = promoProductSearch.toLowerCase();
                      return (
                        p.name.toLowerCase().includes(q) ||
                        p.sku.toLowerCase().includes(q) ||
                        p.volume.toLowerCase().includes(q)
                      );
                    })
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.volume}) — Normal: {formatCurrency(p.price)}
                      </option>
                    ))}
                </select>
              </div>

              {selectedPromoProduct && (
                <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 flex items-center gap-3">
                  {selectedPromoProduct.imageUrl || selectedPromoProduct.image ? (
                    <img
                      src={selectedPromoProduct.imageUrl || selectedPromoProduct.image}
                      alt={selectedPromoProduct.name}
                      loading="lazy"
                      width={48}
                      height={48}
                      className="w-12 h-12 rounded-xl object-cover border border-neutral-200 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-400 shrink-0">
                      <Package className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-neutral-900 truncate">{selectedPromoProduct.name}</p>
                    <p className="text-[11px] text-neutral-500">
                      Preço normal: <strong className="text-neutral-900">{formatCurrency(selectedPromoProduct.price)}</strong> • Estoque: {formatStockWithCases(selectedPromoProduct.stock, selectedPromoProduct.caseSize)}
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Preço promocional (R$) *</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="Ex: 7.99"
                    value={promoForm.promoPrice}
                    onChange={(e) => setPromoForm({ ...promoForm, promoPrice: e.target.value })}
                    className="flex-1 px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl font-bold text-neutral-900 text-sm"
                  />
                  <div className="px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 font-black text-xs whitespace-nowrap">
                    {calculatedModalDiscountPercent > 0 ? `-${calculatedModalDiscountPercent}% OFF` : '0% OFF'}
                  </div>
                </div>
                {selectedPromoProduct && (
                  <p className="text-[10px] text-neutral-500 mt-1">
                    Deve ser maior que R$ 0,00 e menor que {formatCurrency(selectedPromoProduct.price)}.
                  </p>
                )}
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">Termina em (Opcional — Data e Hora)</label>
                <input
                  type="datetime-local"
                  value={promoForm.promoEndsAt}
                  onChange={(e) => setPromoForm({ ...promoForm, promoEndsAt: e.target.value })}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-neutral-800"
                />
                <p className="text-[10px] text-neutral-400 mt-1">
                  Deixe em branco para manter a promoção ativa sem data de término.
                </p>
              </div>

              <div className="pt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsPromoModalOpen(false)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingPromo}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl shadow-sm cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                >
                  {isSavingPromo ? (
                    <span>Salvando...</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Salvar Promoção</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Custom Stock Entry / Adjustment Modal */}
      {stockAdjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-neutral-200">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-black text-base">Entrada / Ajuste de Estoque</h3>
                <p className="text-xs text-neutral-400 mt-0.5">{stockAdjustModal.product.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setStockAdjustModal(null)}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCustomStockAdjust} className="p-6 space-y-4 text-xs">
              {stockAdjustModal.error && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                  {stockAdjustModal.error}
                </div>
              )}

              <div className="p-3 bg-neutral-50 rounded-2xl border border-neutral-200 flex items-center justify-between">
                <span className="text-neutral-500 font-medium">Estoque Atual:</span>
                <span className="font-black text-sm text-neutral-900">
                  {formatStockWithCases(stockAdjustModal.product.stock, stockAdjustModal.product.caseSize)}
                </span>
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1.5">Tipo de Operação</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setStockAdjustModal({ ...stockAdjustModal, mode: 'add' })}
                    className={`py-2.5 rounded-xl font-bold border transition-all cursor-pointer ${
                      stockAdjustModal.mode === 'add'
                        ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                        : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    + Entrada (Adicionar)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStockAdjustModal({ ...stockAdjustModal, mode: 'remove' })}
                    className={`py-2.5 rounded-xl font-bold border transition-all cursor-pointer ${
                      stockAdjustModal.mode === 'remove'
                        ? 'bg-red-600 text-white border-red-700 shadow-xs'
                        : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                    }`}
                  >
                    - Baixa (Remover)
                  </button>
                </div>
              </div>

              {hasProductCase(stockAdjustModal.product) && (
                <div>
                  <label className="font-bold text-neutral-700 block mb-1.5">Contar em</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setStockAdjustModal({ ...stockAdjustModal, unit: 'unit' })}
                      className={`py-2.5 rounded-xl font-bold border transition-all cursor-pointer ${
                        stockAdjustModal.unit === 'unit'
                          ? 'bg-neutral-900 text-white border-neutral-900'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                      }`}
                    >
                      Unidades Avulsas
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockAdjustModal({ ...stockAdjustModal, unit: 'case' })}
                      className={`py-2.5 rounded-xl font-bold border transition-all cursor-pointer ${
                        stockAdjustModal.unit === 'case'
                          ? 'bg-amber-500 text-neutral-950 border-amber-600'
                          : 'bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-neutral-100'
                      }`}
                    >
                      Caixas (c/{stockAdjustModal.product.caseSize} un)
                    </button>
                  </div>
                </div>
              )}

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Quantidade de {stockAdjustModal.unit === 'case' ? `Caixas (c/${stockAdjustModal.product.caseSize})` : 'Unidades'} *
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={stockAdjustModal.quantity}
                  onChange={(e) => setStockAdjustModal({ ...stockAdjustModal, quantity: e.target.value })}
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-black text-base text-neutral-900"
                />
                {stockAdjustModal.unit === 'case' && stockAdjustModal.product.caseSize && (parseInt(stockAdjustModal.quantity, 10) || 0) > 0 && (
                  <p className="text-[11px] text-amber-800 font-bold mt-1.5">
                    O servidor converterá para{' '}
                    {(parseInt(stockAdjustModal.quantity, 10) || 0) * stockAdjustModal.product.caseSize} unidades no estoque.
                  </p>
                )}
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStockAdjustModal(null)}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-bold cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={stockAdjustModal.loading}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl shadow-sm cursor-pointer"
                >
                  {stockAdjustModal.loading ? 'Salvando...' : 'Confirmar Ajuste'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Cancel / Reverse Order Confirmation */}
      {cancelOrderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-neutral-200 overflow-hidden">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <div>
                <h3 className="font-black text-base">
                  {cancelOrderModal.mode === 'completed'
                    ? `Cancelar Venda #${cancelOrderModal.order.id}`
                    : `Cancelar Pedido #${cancelOrderModal.order.id}`}
                </h3>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {cancelOrderModal.order.customer.name} • {formatCurrency(cancelOrderModal.order.total)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelOrderModal(null)}
                disabled={cancelOrderModal.loading}
                className="p-1.5 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmCancelOrder} className="p-6 space-y-4 text-xs">
              {cancelOrderModal.error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                  {cancelOrderModal.error}
                </div>
              )}

              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-amber-950 font-semibold leading-relaxed">
                {cancelOrderModal.mode === 'completed'
                  ? 'Atenção: O estoque dos itens volta e a venda sai do caixa do dia.'
                  : 'Tem certeza que deseja cancelar este pedido? O estoque dos itens será devolvido automaticamente.'}
              </div>

              <div>
                <label className="font-bold text-neutral-700 block mb-1">
                  Motivo do cancelamento {cancelOrderModal.mode === 'completed' ? '*' : '(opcional)'}
                </label>
                <input
                  type="text"
                  required={cancelOrderModal.mode === 'completed'}
                  placeholder="Ex: Cliente desistiu, erro de lançamento..."
                  value={cancelOrderModal.reason}
                  onChange={(e) => setCancelOrderModal({ ...cancelOrderModal, reason: e.target.value })}
                  className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl font-medium text-neutral-900"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCancelOrderModal(null)}
                  disabled={cancelOrderModal.loading}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-bold cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={cancelOrderModal.loading}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black rounded-xl shadow-sm cursor-pointer"
                >
                  {cancelOrderModal.loading ? 'Cancelando...' : 'Confirmar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Generic Confirmar / Voltar Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-neutral-200 overflow-hidden">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <h3 className="font-black text-base">{confirmModal.title}</h3>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                disabled={confirmModal.loading}
                className="p-1.5 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              {confirmModal.error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-bold">
                  {confirmModal.error}
                </div>
              )}

              <p className="text-neutral-700 font-medium text-sm leading-relaxed">
                {confirmModal.message}
              </p>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  disabled={confirmModal.loading}
                  className="flex-1 py-2.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-xl font-bold cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={confirmModal.loading}
                  onClick={async () => {
                    setConfirmModal((prev) => (prev ? { ...prev, loading: true, error: undefined } : null));
                    try {
                      await confirmModal.onConfirm();
                      setConfirmModal(null);
                    } catch (err: any) {
                      setConfirmModal((prev) =>
                        prev ? { ...prev, loading: false, error: err?.message || 'Erro ao confirmar ação.' } : null
                      );
                    }
                  }}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black rounded-xl shadow-sm cursor-pointer"
                >
                  {confirmModal.loading ? 'Aguarde...' : 'Confirmar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImportProductsModal
        isOpen={isImportModalOpen}
        existingProducts={products}
        settings={settings}
        onClose={() => setIsImportModalOpen(false)}
        onImported={() => api.reloadProducts()}
      />

      {/* Modal: Keyboard Shortcuts List ("?") */}
      {isShortcutsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl border border-neutral-200 overflow-hidden">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Keyboard className="w-5 h-5 text-amber-400" />
                <h3 className="font-black text-base">Atalhos do Teclado</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(false)}
                className="p-1.5 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-3 text-xs">
              <div className="divide-y divide-neutral-100 border border-neutral-200 rounded-2xl overflow-hidden">
                {SHORTCUT_ACTION_ITEMS.map((item) => {
                  const keyLabel = formatShortcutDisplay(
                    activeShortcuts[item.action] || DEFAULT_SHORTCUTS[item.action]
                  );
                  return (
                    <div
                      key={`modal-shortcut-${item.action}`}
                      className="p-3 bg-white flex items-center justify-between gap-3"
                    >
                      <div>
                        <span className="font-bold text-neutral-900 block">{item.label}</span>
                        <span className="text-[11px] text-neutral-500 block">{item.description}</span>
                      </div>
                      <span className="px-3 py-1.5 rounded-lg bg-neutral-100 border border-neutral-300 font-mono font-black text-xs text-neutral-900 shrink-0">
                        {keyLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-neutral-500">
                  Você pode personalizar as teclas na aba <strong>Configurações</strong>.
                </span>
                <button
                  type="button"
                  onClick={() => setIsShortcutsModalOpen(false)}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-bold rounded-xl cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Multi-Order Delivery Route ("Montar rota (N)") */}
      {isMultiRouteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-amber-200 overflow-hidden my-6 max-h-[92vh] flex flex-col">
            <div className="print:hidden p-5 bg-neutral-900 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Navigation className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="font-black text-base">
                    Rota de Entrega ({multiRouteResult.orderedStops.length}{' '}
                    {multiRouteResult.orderedStops.length === 1 ? 'parada' : 'paradas'})
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    Ordenada automaticamente pela parada mais próxima a partir do depósito
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMultiRouteModalOpen(false)}
                className="p-1.5 hover:bg-neutral-800 rounded-xl text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Printable 80mm Route Sheet */}
            <div
              id="receipt-to-print"
              className="p-6 overflow-y-auto flex-1 font-mono text-xs text-neutral-900 bg-white space-y-4"
            >
              <div className="text-center border-b-2 border-dashed border-neutral-400 pb-3">
                <h2 className="text-base font-black uppercase text-neutral-900">
                  {settings.storeName}
                </h2>
                <p className="text-[11px] text-neutral-600">Saída: {settings.address}</p>
                <p className="text-xs font-black uppercase mt-1">
                  🛵 ROTEIRO DO MOTOBOY ({multiRouteResult.orderedStops.length}{' '}
                  {multiRouteResult.orderedStops.length === 1 ? 'PARADA' : 'PARADAS'})
                </p>
              </div>

              {multiRouteQrDataUrl && (
                <div className="flex flex-col items-center text-center py-2 border-b border-dashed border-neutral-300">
                  <img
                    src={multiRouteQrDataUrl}
                    alt="QR Code da Rota Completa"
                    className="w-52 h-52 print:w-[42mm] print:h-[42mm] object-contain mx-auto block"
                  />
                  <p className="text-xs font-bold text-neutral-900 mt-1.5">
                    Escaneie para abrir a rota no Google Maps
                  </p>
                  <a
                    href={multiRouteResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="print:hidden mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-sans font-bold text-xs transition-colors"
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Abrir rota no navegador</span>
                  </a>
                </div>
              )}

              <div className="space-y-3">
                <div className="font-bold text-xs uppercase text-neutral-600 border-b border-neutral-200 pb-1">
                  Ordem de Paradas:
                </div>
                {multiRouteResult.orderedStops.map((stop) => {
                  const ord = stop.order;
                  const payLabel =
                    ord.paymentMethod === 'pix'
                      ? 'PIX'
                      : ord.paymentMethod === 'cartao_credito'
                      ? 'Cartão de Crédito'
                      : ord.paymentMethod === 'cartao_debito'
                      ? 'Cartão de Débito'
                      : 'Dinheiro';

                  return (
                    <div
                      key={`route-stop-${ord.id}`}
                      className="p-3 rounded-xl bg-neutral-50 border border-neutral-200 space-y-1 text-xs"
                    >
                      <div className="flex items-center justify-between font-black text-neutral-900">
                        <span>
                          {stop.stopNumber}. {ord.customer.name} (#{ord.id})
                        </span>
                        <span>{formatCurrency(ord.total)}</span>
                      </div>
                      <p className="text-neutral-800 font-medium">
                        End.: {stop.writtenAddress}
                        {ord.customer.complement ? ` (${ord.customer.complement})` : ''}
                      </p>
                      {ord.customer.reference && (
                        <p className="text-neutral-600 italic">Ref: {ord.customer.reference}</p>
                      )}
                      {!stop.isVerified && (
                        <p className="font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded inline-block text-[11px]">
                          ⚠ Confira o endereço escrito
                        </p>
                      )}
                      <div className="pt-1 border-t border-dashed border-neutral-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span>
                          Pagamento: <strong>{payLabel}</strong>
                        </span>
                        <span>
                          Valor a receber: <strong>{formatCurrency(ord.total)}</strong>
                        </span>
                      </div>
                      {ord.paymentMethod === 'dinheiro' &&
                        ord.cashChangeFor !== undefined &&
                        ord.cashChangeFor !== null && (
                          <div className="text-[11px] font-bold text-amber-800">
                            Troco p/ {formatCurrency(ord.cashChangeFor)} (Levar{' '}
                            {formatCurrency(Math.max(0, ord.cashChangeFor - ord.total))})
                          </div>
                        )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="print:hidden p-4 bg-neutral-100 border-t border-neutral-200 flex items-center justify-between gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsMultiRouteModalOpen(false)}
                className="px-4 py-2.5 text-xs font-bold text-neutral-700 hover:bg-neutral-200 rounded-xl transition-colors cursor-pointer"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black rounded-xl shadow-sm transition-colors text-xs cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir rota</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDV Addon Selection Modal */}
      {posAddonModalState && (
        <ProductAddonsModal
          product={posAddonModalState.product}
          initialSaleUnit={posAddonModalState.saleUnit}
          addonGroups={getProductAddonGroups(posAddonModalState.product, settings)}
          availableStockUnits={(() => {
            const currentTotalUnits = posCart
              .filter(item => item.product.id === posAddonModalState.product.id)
              .reduce((sum, item) => sum + item.quantity * getPosUnitsPerSale(item.product, item.saleUnit), 0);
            return Math.max(0, posAddonModalState.product.stock - currentTotalUnits);
          })()}
          onClose={() => setPosAddonModalState(null)}
          onConfirm={({ product: confirmedProduct, saleUnit: confirmedUnit, quantity, addons, addonsTotal }) => {
            appendPosCartLine(
              confirmedProduct,
              confirmedUnit,
              quantity,
              addons,
              addonsTotal
            );
            setPosAddonModalState(null);
          }}
        />
      )}

      {/* Cash Session Modals (Abrir / Fechar Expediente & Recibo 80mm) */}
      <OpenCashSessionModal
        isOpen={isOpenCashModalOpen}
        onClose={() => setIsOpenCashModalOpen(false)}
        onSuccess={handleOpenCashSessionSuccess}
      />

      <CloseCashSessionModal
        isOpen={isCloseCashModalOpen}
        session={currentCashSession}
        openTablesCount={openTablesCountForCash}
        onClose={() => setIsCloseCashModalOpen(false)}
        onSuccess={handleCloseCashSessionSuccess}
      />

      <CashClosingReceiptModal
        session={closingReceiptSession}
        settings={settings}
        onClose={() => setClosingReceiptSession(null)}
      />

      {/* End Modals */}
    </div>
  );
};
