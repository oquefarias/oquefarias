import React, { useState, useMemo, useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import {
  CustomerProfile,
  DeliveryArea,
  Order,
  OrderStatus,
  PaymentMethod,
  ProductCategory,
  Product,
  StoreSettings,
  SaleUnit,
  isProductPromoActive,
  getEffectiveProductPrice,
  getPromoDiscountPercent,
  hasProductCase,
  canSellProductCase,
  resolveStoreCategories,
  sortProductsForStore,
  OrderItemAddon,
  getProductAddonGroups,
  buildOrderItemAddonsSignature,
  formatOrderItemAddonLine,
  OrderItemComboComponent,
  isComboProduct,
  calculateComboMetrics,
  formatOrderItemComboLine,
  isProductHiddenFromStore,
  getActiveDeliveryAreasSorted,
  findMatchingActiveDeliveryArea,
  formatDeliveryAreaOptionLabel,
} from '../../types';
import {
  api,
  CouponValidationResult,
  CustomerDeliveryQuoteResult,
  isNetworkOrTimeoutError,
  ORDER_NETWORK_EXHAUSTED_MESSAGE,
} from '../../services/api';
import { CustomerAuthModal } from './CustomerAuthModal';
import { ProductAddonsModal } from '../ProductAddonsModal';
import { 
  Beer, 
  Wine, 
  Flame, 
  Coffee, 
  Sparkles, 
  ShoppingBag, 
  Search, 
  Plus, 
  Minus, 
  Clock, 
  MapPin, 
  CheckCircle2, 
  Truck, 
  Check, 
  Copy, 
  ArrowRight,
  MessageCircle,
  Package,
  X,
  User,
  AlertTriangle,
  Building2,
  Loader2,
  Ticket,
  Lock,
  Eye,
  EyeOff,
  Home,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { fetchAddressByCep } from '../../utils/geo';

interface CustomerStorefrontProps {
  products: Product[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
}

interface CartItem {
  lineId: string;
  product: Product;
  quantity: number;
  saleUnit: SaleUnit;
  addons?: OrderItemAddon[];
  addonsTotal?: number;
  comboItems?: OrderItemComboComponent[];
}

export const CustomerStorefront: React.FC<CustomerStorefrontProps> = ({ products, settings, deliveryAreas }) => {
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'todas'>('todas');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyCold, setOnlyCold] = useState<boolean>(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedUnits, setSelectedUnits] = useState<Record<string, SaleUnit>>({});
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);
  const [addonModalState, setAddonModalState] = useState<{
    product: Product;
    saleUnit: SaleUnit;
  } | null>(null);

  // Customer Account state
  const [currentCustomer, setCurrentCustomer] = useState<CustomerProfile | null>(() => api.getCurrentCustomer());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  
  // Checkout form state
  const activeAreas = useMemo(
    () => getActiveDeliveryAreasSorted(deliveryAreas),
    [deliveryAreas]
  );
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'retirada'>('delivery');
  const [customerName, setCustomerName] = useState<string>(currentCustomer?.name || '');
  const [customerPhone, setCustomerPhone] = useState<string>(currentCustomer?.phone || '');
  const [cep, setCep] = useState<string>(currentCustomer?.cep || '');
  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepNotice, setCepNotice] = useState<string>('');
  const [address, setAddress] = useState<string>(currentCustomer?.address || '');
  const [addressNumber, setAddressNumber] = useState<string>(currentCustomer?.number || '');
  const [selectedDeliveryAreaId, setSelectedDeliveryAreaId] = useState<string>(() => {
    const matched = findMatchingActiveDeliveryArea(activeAreas, currentCustomer?.neighborhood);
    return matched ? matched.id : '';
  });
  const [neighborhood, setNeighborhood] = useState<string>(() => {
    const matched = findMatchingActiveDeliveryArea(activeAreas, currentCustomer?.neighborhood);
    return matched ? matched.name : '';
  });
  const [complement, setComplement] = useState<string>(currentCustomer?.complement || '');
  const [reference, setReference] = useState<string>(currentCustomer?.reference || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [cashChangeFor, setCashChangeFor] = useState<string>('');
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [checkoutClientRequestId, setCheckoutClientRequestId] = useState<string>(() => crypto.randomUUID());
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [copiedPix, setCopiedPix] = useState<boolean>(false);
  const [deliveryQuote, setDeliveryQuote] = useState<CustomerDeliveryQuoteResult | null>(null);
  const [checkoutCity, setCheckoutCity] = useState<string>(currentCustomer?.city || '');
  const [checkoutState, setCheckoutState] = useState<string>(currentCustomer?.state || '');

  // Checkout mode & logged-in address selection state
  const [checkoutEntryStep, setCheckoutEntryStep] = useState<'choice' | 'guest'>('choice');
  const [authModalInitialTab, setAuthModalInitialTab] = useState<'login' | 'cadastro'>('login');
  const [loggedAddressMode, setLoggedAddressMode] = useState<'saved' | 'custom'>('saved');
  const [saveCustomAddressToAccount, setSaveCustomAddressToAccount] = useState<boolean>(false);

  // Guest order tracking & post-order account conversion state
  const [trackedGuestToken, setTrackedGuestToken] = useState<string>('');
  const [guestTrackingError, setGuestTrackingError] = useState<string>('');
  const [savedGuestOrdersCount, setSavedGuestOrdersCount] = useState<number>(
    () => api.getSavedGuestOrders().length
  );
  const [guestConvertPhone, setGuestConvertPhone] = useState<string>('');
  const [guestConvertPassword, setGuestConvertPassword] = useState<string>('');
  const [showGuestConvertPassword, setShowGuestConvertPassword] = useState<boolean>(false);
  const [isConvertingGuest, setIsConvertingGuest] = useState<boolean>(false);
  const [guestConvertError, setGuestConvertError] = useState<string>('');
  const [guestConvertSuccess, setGuestConvertSuccess] = useState<boolean>(false);

  // Coupon state
  const [couponInput, setCouponInput] = useState<string>('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResult | null>(null);
  const [couponError, setCouponError] = useState<string>('');
  const [isValidatingCoupon, setIsValidatingCoupon] = useState<boolean>(false);

  // Customer Orders ("Meus pedidos") state
  const [isMyOrdersOpen, setIsMyOrdersOpen] = useState<boolean>(false);
  const [myOrders, setMyOrders] = useState<Order[]>([]);
  const [isLoadingMyOrders, setIsLoadingMyOrders] = useState<boolean>(false);
  const [myOrdersError, setMyOrdersError] = useState<string>('');
  const [outOfStockNotices, setOutOfStockNotices] = useState<string[]>([]);

  const refreshSavedGuestOrdersCount = () => {
    setSavedGuestOrdersCount(api.getSavedGuestOrders().length);
  };

  // Detect /pedido/:id?t=<token> on initial load or browser navigation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkTrackingUrl = async () => {
      const pathMatch = window.location.pathname.match(/^\/pedido\/([^/?#]+)/i);
      const params = new URLSearchParams(window.location.search);
      const tok = (params.get('t') || '').trim();
      if (!pathMatch || !pathMatch[1] || !tok) return;

      const orderId = decodeURIComponent(pathMatch[1]);
      setGuestTrackingError('');
      try {
        const res = await api.trackGuestOrder(orderId, tok);
        if (res?.order) {
          setTrackedGuestToken(tok);
          setPlacedOrder({ ...res.order, guestToken: tok });
          setGuestConvertPhone(res.order.customer?.phone || '');
          refreshSavedGuestOrdersCount();
        }
      } catch (err: any) {
        setGuestTrackingError(err?.message || 'Pedido não encontrado ou link de acompanhamento inválido.');
      }
    };

    checkTrackingUrl();
    window.addEventListener('popstate', checkTrackingUrl);
    return () => window.removeEventListener('popstate', checkTrackingUrl);
  }, []);

  const handleOpenMyOrders = async () => {
    setIsMyOrdersOpen(true);
    setIsLoadingMyOrders(true);
    setMyOrdersError('');
    try {
      const mergedById = new Map<string, Order>();

      if (api.isCustomerAuthenticated()) {
        try {
          const accountList = await api.getCustomerOrders();
          for (const ord of accountList) {
            mergedById.set(ord.id, ord);
          }
        } catch (err: any) {
          if (api.getSavedGuestOrders().length === 0) {
            throw err;
          }
        }
      }

      const guestSaved = api.getSavedGuestOrders();
      if (guestSaved.length > 0) {
        const trackedResults = await Promise.allSettled(
          guestSaved.map((g) => api.trackGuestOrder(g.id, g.token))
        );
        for (let i = 0; i < guestSaved.length; i++) {
          const res = trackedResults[i];
          const g = guestSaved[i];
          if (res.status === 'fulfilled' && res.value?.order) {
            mergedById.set(res.value.order.id, {
              ...res.value.order,
              guestToken: g.token,
              trackingUrl: g.trackingUrl,
            });
          }
        }
      }

      const combined = Array.from(mergedById.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      setMyOrders(combined);
      refreshSavedGuestOrdersCount();
    } catch (err: any) {
      setMyOrdersError(err.message || 'Não foi possível carregar seus pedidos.');
    } finally {
      setIsLoadingMyOrders(false);
    }
  };

  // Poll placedOrder status every 30 seconds ONLY while the tab is visible; stop when concluido, entregue, or cancelado
  useEffect(() => {
    if (!placedOrder) return;
    const currentStatus = String(placedOrder.status || '').toLowerCase();
    if (
      currentStatus === 'concluido' ||
      currentStatus === 'entregue' ||
      currentStatus === 'cancelado'
    ) {
      return;
    }

    const orderId = placedOrder.id;
    const guestTok =
      placedOrder.guestToken || trackedGuestToken || api.getGuestTokenForOrder(orderId) || '';
    const canPollCustomer = api.isCustomerAuthenticated() && Boolean(placedOrder.customerId);
    const canPollGuest = Boolean(guestTok);

    if (!canPollCustomer && !canPollGuest) return;

    const fetchCurrentOrder = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try {
        if (canPollCustomer) {
          const updated = await api.getCustomerOrder(orderId);
          if (updated && updated.id === orderId) {
            setPlacedOrder(updated);
          }
        } else if (canPollGuest) {
          const res = await api.trackGuestOrder(orderId, guestTok);
          if (res?.order && res.order.id === orderId) {
            setPlacedOrder({ ...res.order, guestToken: guestTok });
          }
        }
      } catch {
        // Ignore transient network errors during background refresh
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchCurrentOrder();
      }
    };

    const interval = setInterval(fetchCurrentOrder, 30000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [
    placedOrder?.id,
    placedOrder?.status,
    placedOrder?.customerId,
    placedOrder?.guestToken,
    trackedGuestToken,
  ]);

  const applySavedCustomerAddressToState = (cust: CustomerProfile) => {
    setCustomerName(cust.name);
    setCustomerPhone(cust.phone);
    setCep(cust.cep || '');
    setAddress(cust.address || '');
    setAddressNumber(cust.number || '');
    const matched = findMatchingActiveDeliveryArea(activeAreas, cust.neighborhood);
    setSelectedDeliveryAreaId(matched ? matched.id : '');
    setNeighborhood(matched ? matched.name : '');
    setCheckoutCity(cust.city || '');
    setCheckoutState(cust.state || '');
    setComplement(cust.complement || '');
    setReference(cust.reference || '');
  };

  // Keep fields synced when currentCustomer or activeAreas changes
  useEffect(() => {
    if (currentCustomer) {
      setLoggedAddressMode('saved');
      setSaveCustomAddressToAccount(false);
      applySavedCustomerAddressToState(currentCustomer);
    } else {
      setLoggedAddressMode('saved');
      setSaveCustomAddressToAccount(false);
      setDeliveryQuote(null);
    }
  }, [currentCustomer, activeAreas]);

  const refreshServerDeliveryQuote = async (
    subtotalVal: number,
    nhVal: string,
    areaIdVal?: string
  ) => {
    if (!api.isCustomerAuthenticated() || loggedAddressMode === 'custom') return null;
    const quote = await api.getCustomerDeliveryQuote(subtotalVal, nhVal, areaIdVal);
    if (quote) {
      setDeliveryQuote(quote);
    }
    return quote;
  };

  // Handle optional CEP search in checkout using ViaCEP (never blocks if it fails)
  const handleSearchCheckoutCep = async (cleanCepArg?: string) => {
    const rawDigits = (cleanCepArg || cep).replace(/\D/g, '');
    if (rawDigits.length !== 8) {
      return;
    }
    setIsSearchingCep(true);
    setCepNotice('');
    try {
      const viaCep = await fetchAddressByCep(rawDigits);
      if (!viaCep) {
        setCepNotice('Não foi possível buscar pelo CEP. Preencha a rua e escolha seu bairro abaixo.');
        return;
      }

      if (viaCep.logradouro) {
        setAddress(viaCep.logradouro);
      }
      if (viaCep.localidade) setCheckoutCity(viaCep.localidade);
      if (viaCep.uf) setCheckoutState(viaCep.uf);

      if (viaCep.bairro) {
        const matched = findMatchingActiveDeliveryArea(activeAreas, viaCep.bairro);
        if (matched) {
          setSelectedDeliveryAreaId(matched.id);
          setNeighborhood(matched.name);
          setCepNotice(`Rua e bairro (${matched.name}) preenchidos pelo CEP!`);
          return;
        }
      }

      setCepNotice('Rua preenchida pelo CEP! Agora escolha seu bairro na lista abaixo.');
    } catch {
      // Se falhar, segue normal sem travar (1b)
    } finally {
      setIsSearchingCep(false);
    }
  };

  // Matched active delivery area for the currently selected neighborhood
  const matchedArea = useMemo(() => {
    if (selectedDeliveryAreaId) {
      const byId = activeAreas.find((a) => a.id === selectedDeliveryAreaId);
      if (byId) return byId;
    }
    if (neighborhood) {
      return findMatchingActiveDeliveryArea(activeAreas, neighborhood);
    }
    return undefined;
  }, [activeAreas, selectedDeliveryAreaId, neighborhood]);

  // Saved customer's neighborhood matched against active areas (1d)
  const savedCustomerMatchedArea = useMemo(() => {
    if (!currentCustomer?.neighborhood) return undefined;
    return findMatchingActiveDeliveryArea(activeAreas, currentCustomer.neighborhood);
  }, [activeAreas, currentCustomer?.neighborhood]);

  const [checkoutError, setCheckoutError] = useState<string>('');
  const [submittingStatusText, setSubmittingStatusText] = useState<string>('');
  const [canRetryOrderSubmit, setCanRetryOrderSubmit] = useState<boolean>(false);

  const isAreaCovered = useMemo(() => {
    if (deliveryType === 'retirada') return true;
    return Boolean(matchedArea);
  }, [deliveryType, matchedArea]);

  const showOutOfStock = Boolean(settings.showOutOfStock);
  const lastProductsFetchAtRef = React.useRef<number>(Date.now());

  // Loja do cliente: não faz polling periódico de produtos.
  // Recarrega apenas quando o cliente volta para a aba depois de 5 min (e logo antes de finalizar o pedido).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const FIVE_MIN_MS = 5 * 60 * 1000;
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastProductsFetchAtRef.current >= FIVE_MIN_MS
      ) {
        lastProductsFetchAtRef.current = Date.now();
        api.reloadProducts().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // If a product in the cart goes out of stock (stock < 1), becomes inactive, or is hidden from online store, remove it and notify the customer
  useEffect(() => {
    if (cart.length === 0 || products.length === 0) return;
    const productMap = new Map<string, Product>(products.map((p) => [p.id, p]));
    const exhaustedNames = new Set<string>();
    let hasExhausted = false;

    for (const item of cart) {
      const fresh = productMap.get(item.product.id);
      if (!fresh || !fresh.active || fresh.stock < 1 || isProductHiddenFromStore(item.product.id, settings)) {
        hasExhausted = true;
        exhaustedNames.add(fresh?.name || item.product.name);
      }
    }

    if (hasExhausted) {
      setCart((prev) => {
        const next = prev.filter((item) => {
          const fresh = productMap.get(item.product.id);
          return Boolean(
            fresh &&
              fresh.active &&
              fresh.stock >= 1 &&
              !isProductHiddenFromStore(item.product.id, settings)
          );
        });
        if (next.length === 0) {
          setCheckoutClientRequestId(crypto.randomUUID());
        }
        return next;
      });
      const messages = Array.from(exhaustedNames).map(
        (name) => `${name} ficou indisponível no delivery e saiu do carrinho`
      );
      setOutOfStockNotices((prev) => {
        const combined = [...prev];
        for (const msg of messages) {
          if (!combined.includes(msg)) combined.push(msg);
        }
        return combined;
      });
    }
  }, [products, cart, settings]);

  // Visible products in the store (respecting showOutOfStock and hiddenFromStoreIds settings)
  const storeVisibleProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.active) return false;
      if (isProductHiddenFromStore(p.id, settings)) return false;
      if (!showOutOfStock && p.stock < 1) return false;
      return true;
    });
  }, [products, showOutOfStock, settings]);

  const storeCategories = useMemo(
    () => resolveStoreCategories(settings, products),
    [settings, products]
  );

  const knownCategoryIds = useMemo(
    () => new Set(storeCategories.map((c) => c.id)),
    [storeCategories]
  );

  const baseVisibleProducts = useMemo(() => {
    return onlyCold ? storeVisibleProducts.filter((p) => p.isCold) : storeVisibleProducts;
  }, [storeVisibleProducts, onlyCold]);

  // Active promotional products
  const promoProducts = useMemo(() => {
    const activePromos = storeVisibleProducts.filter((p) => isProductPromoActive(p));
    return sortProductsForStore(activePromos, settings, storeVisibleProducts);
  }, [storeVisibleProducts, settings]);

  // Combined carousel items: preferred products (featuredProductIds visible in store) + promoProducts without duplicates
  const featuredAndPromoCarouselProducts = useMemo(() => {
    const visibleById = new Map<string, Product>(storeVisibleProducts.map((p) => [p.id, p]));
    const seen = new Set<string>();
    const combined: Product[] = [];

    const featuredIds = Array.isArray(settings.featuredProductIds) ? settings.featuredProductIds : [];
    for (const id of featuredIds) {
      const prod = visibleById.get(id);
      if (prod && !seen.has(prod.id)) {
        seen.add(prod.id);
        combined.push(prod);
      }
    }

    for (const prod of promoProducts) {
      if (!seen.has(prod.id)) {
        seen.add(prod.id);
        combined.push(prod);
      }
    }

    return combined;
  }, [storeVisibleProducts, settings.featuredProductIds, promoProducts]);

  // Products filtered by search query and cold filter across the entire catalog
  const searchFilteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseVisibleProducts;
    return baseVisibleProducts.filter((p) => {
      if (
        p.name.toLowerCase().includes(query) ||
        p.volume.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
      ) {
        return true;
      }
      if (isComboProduct(p.id, settings)) {
        const metrics = calculateComboMetrics(p, settings, products);
        if (metrics?.itemsSummaryText.toLowerCase().includes(query)) return true;
      }
      return false;
    });
  }, [baseVisibleProducts, searchQuery, settings, products]);

  // Keep filteredProducts for empty-state checks
  const filteredProducts = useMemo(() => {
    return sortProductsForStore(searchFilteredProducts, settings, storeVisibleProducts);
  }, [searchFilteredProducts, settings, storeVisibleProducts]);

  // Continuous page grouped by category (always groups searchFilteredProducts across all categories with items)
  const groupedCategorySections = useMemo(() => {
    const sections: { id: string; name: string; items: Product[] }[] = [];
    for (const cat of storeCategories) {
      const catProducts = searchFilteredProducts.filter((p) => p.category === cat.id);
      if (catProducts.length > 0) {
        sections.push({
          id: cat.id,
          name: cat.name,
          items: sortProductsForStore(catProducts, settings, storeVisibleProducts),
        });
      }
    }
    const otherProducts = searchFilteredProducts.filter(
      (p) => !p.category || !knownCategoryIds.has(p.category)
    );
    if (otherProducts.length > 0) {
      sections.push({
        id: 'outros',
        name: 'Outros',
        items: sortProductsForStore(otherProducts, settings, storeVisibleProducts),
      });
    }
    return sections;
  }, [storeCategories, searchFilteredProducts, knownCategoryIds, settings, storeVisibleProducts]);

  const getSelectedUnit = (product: Product): SaleUnit => {
    if (!canSellProductCase(product, settings, 'store')) return 'unit';
    if (product.stock < Number(product.caseSize)) return 'unit';
    return selectedUnits[product.id] || 'unit';
  };

  const getCartItemUnitPrice = (product: Product, saleUnit: SaleUnit, addonsTotal = 0): number => {
    const base =
      saleUnit === 'case' && canSellProductCase(product, settings, 'store')
        ? Number(product.casePrice)
        : getEffectiveProductPrice(product);
    return Math.round((base + (Number(addonsTotal) || 0)) * 100) / 100;
  };

  const getCartTotalUnitsForProduct = (productId: string, cartList: CartItem[] = cart): number => {
    return cartList
      .filter((i) => i.product.id === productId)
      .reduce((sum, i) => {
        const cp = products.find((p) => p.id === i.product.id) || i.product;
        const mult = i.saleUnit === 'case' && canSellProductCase(cp, settings, 'store') ? Number(cp.caseSize) : 1;
        return sum + i.quantity * mult;
      }, 0);
  };

  // Cart math (using casePrice for 'case', effective promotional price for 'unit', plus addonsTotal)
  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => {
      const currentProd = products.find((p) => p.id === item.product.id) || item.product;
      return sum + getCartItemUnitPrice(currentProd, item.saleUnit, item.addonsTotal) * item.quantity;
    }, 0);
  }, [cart, products]);

  const cartPromoSavings = useMemo(() => {
    return cart.reduce((sum, item) => {
      if (item.saleUnit === 'case') return sum;
      const currentProd = products.find((p) => p.id === item.product.id) || item.product;
      if (isProductPromoActive(currentProd)) {
        const diff = currentProd.price - getEffectiveProductPrice(currentProd);
        if (diff > 0) return sum + diff * item.quantity;
      }
      return sum;
    }, 0);
  }, [cart, products]);

  // Fetch delivery quote from server whenever customer is logged in and using saved address
  useEffect(() => {
    if (!currentCustomer || !api.isCustomerAuthenticated() || loggedAddressMode === 'custom') {
      setDeliveryQuote(null);
      return;
    }
    refreshServerDeliveryQuote(cartSubtotal, neighborhood, selectedDeliveryAreaId);
  }, [
    currentCustomer?.id,
    cartSubtotal,
    neighborhood,
    selectedDeliveryAreaId,
    isCartOpen,
    loggedAddressMode,
  ]);

  const deliveryFee = useMemo(() => {
    if (deliveryType === 'retirada') return 0;
    if (settings.freeDeliveryThreshold > 0 && cartSubtotal >= settings.freeDeliveryThreshold) {
      return 0;
    }
    if (matchedArea) {
      return Math.round(Number(matchedArea.fee) * 100) / 100;
    }
    if (deliveryQuote && deliveryQuote.isValidArea && loggedAddressMode === 'saved') {
      return deliveryQuote.deliveryFee;
    }
    return 0;
  }, [deliveryType, deliveryQuote, loggedAddressMode, cartSubtotal, settings.freeDeliveryThreshold, matchedArea]);

  const cartDiscount = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon.type === 'percent') {
      let disc = (appliedCoupon.value / 100) * cartSubtotal;
      if (appliedCoupon.maxDiscount !== undefined && appliedCoupon.maxDiscount !== null && appliedCoupon.maxDiscount > 0) {
        disc = Math.min(disc, appliedCoupon.maxDiscount);
      }
      disc = Math.min(disc, cartSubtotal);
      return Math.round(disc * 100) / 100;
    }
    return Math.min(appliedCoupon.value, cartSubtotal);
  }, [appliedCoupon, cartSubtotal]);

  const totalSavings = Math.round((cartPromoSavings + cartDiscount) * 100) / 100;
  const cartTotal = Math.max(0, cartSubtotal - cartDiscount + deliveryFee);
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleApplyCoupon = async () => {
    if (!couponInput.trim()) return;
    if (!api.isCustomerAuthenticated() || !currentCustomer) {
      setCouponError('Faça login ou crie sua conta para aplicar cupons de desconto.');
      setIsAuthModalOpen(true);
      return;
    }

    setIsValidatingCoupon(true);
    setCouponError('');
    try {
      const itemsPayload = cart.map((i) => ({
        productId: i.product.id,
        quantity: i.quantity,
        saleUnit: i.saleUnit,
        addons: i.addons?.map((a) => ({
          groupId: a.groupId,
          optionId: a.optionId,
          quantity: a.quantity,
        })),
      }));
      const res = await api.validateCoupon(couponInput.trim(), cartSubtotal, itemsPayload);
      setAppliedCoupon(res);
      setCouponError('');
    } catch (err: any) {
      setAppliedCoupon(null);
      setCouponError(err.message || 'Cupom inválido.');
    } finally {
      setIsValidatingCoupon(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponError('');
  };

  const appendCartLine = (
    product: Product,
    saleUnit: SaleUnit,
    qtyToAdd: number,
    addons?: OrderItemAddon[],
    addonsTotal?: number
  ) => {
    const isCase = saleUnit === 'case' && canSellProductCase(product, settings, 'store');
    const unitsPerSale = isCase ? Number(product.caseSize) : 1;
    const addonsSig = buildOrderItemAddonsSignature(addons);
    const lineId = `${product.id}::${saleUnit}::${addonsSig}`;

    setCart((prev) => {
      const usedUnits = getCartTotalUnitsForProduct(product.id, prev);
      if (usedUnits + unitsPerSale * qtyToAdd > product.stock) return prev;

      const existing = prev.find((i) => i.lineId === lineId);
      if (existing) {
        return prev.map((i) =>
          i.lineId === lineId ? { ...i, quantity: i.quantity + qtyToAdd } : i
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
          quantity: qtyToAdd,
          saleUnit,
          addons: addons && addons.length > 0 ? addons : undefined,
          addonsTotal: addons && addons.length > 0 ? addonsTotal : undefined,
          comboItems: comboItems && comboItems.length > 0 ? comboItems : undefined,
        },
      ];
    });
  };

  const addToCart = (product: Product, unitOverride?: SaleUnit) => {
    const saleUnit: SaleUnit = unitOverride || getSelectedUnit(product);
    const applicableGroups = getProductAddonGroups(product, settings);
    if (applicableGroups.length > 0) {
      setAddonModalState({ product, saleUnit });
      return;
    }
    appendCartLine(product, saleUnit, 1);
  };

  const changeCartLineQuantity = (lineId: string, delta: number) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.lineId === lineId);
      if (!existing) return prev;
      const currentProd = products.find((p) => p.id === existing.product.id) || existing.product;
      const isCase = existing.saleUnit === 'case' && canSellProductCase(currentProd, settings, 'store');
      const unitsPerSale = isCase ? Number(currentProd.caseSize) : 1;

      if (delta > 0) {
        const usedUnits = getCartTotalUnitsForProduct(currentProd.id, prev);
        if (usedUnits + unitsPerSale * delta > currentProd.stock) return prev;
      }

      const nextQty = existing.quantity + delta;
      const next =
        nextQty <= 0
          ? prev.filter((i) => i.lineId !== lineId)
          : prev.map((i) => (i.lineId === lineId ? { ...i, quantity: nextQty } : i));

      if (next.length === 0) {
        setCheckoutClientRequestId(crypto.randomUUID());
      }
      return next;
    });
  };

  const removeFromCart = (productId: string, saleUnit: SaleUnit = 'unit') => {
    setCart((prev) => {
      // Find the last matching line for this product + saleUnit
      const matchingLines = prev.filter((i) => i.product.id === productId && i.saleUnit === saleUnit);
      if (matchingLines.length === 0) return prev;
      const targetLine = matchingLines[matchingLines.length - 1];
      const next =
        targetLine.quantity <= 1
          ? prev.filter((i) => i.lineId !== targetLine.lineId)
          : prev.map((i) =>
              i.lineId === targetLine.lineId ? { ...i, quantity: i.quantity - 1 } : i
            );
      if (next.length === 0) {
        setCheckoutClientRequestId(crypto.randomUUID());
      }
      return next;
    });
  };

  const getCartQuantity = (productId: string, saleUnit: SaleUnit = 'unit') => {
    return cart
      .filter((i) => i.product.id === productId && i.saleUnit === saleUnit)
      .reduce((sum, i) => sum + i.quantity, 0);
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const hasCheckoutCashTyped = cashChangeFor.trim() !== '';
  const checkoutCashNum = hasCheckoutCashTyped ? parseFloat(cashChangeFor) : 0;
  const isCheckoutCashInvalid =
    paymentMethod === 'dinheiro' &&
    hasCheckoutCashTyped &&
    (Number.isNaN(checkoutCashNum) || Math.round(checkoutCashNum * 100) < Math.round(cartTotal * 100));

  // Submit order to depot (supports logged-in saved address, logged-in custom address, and guest quick checkout)
  const submitCustomerOrder = async () => {
    if (isSubmitting) return;
    setCheckoutError('');
    setCanRetryOrderSubmit(false);
    setSubmittingStatusText('');
    if (!settings.isOpen) {
      setCheckoutError(settings.closedMessage || 'Desculpe, o depósito está fechado no momento para novos pedidos.');
      return;
    }
    if (cart.length === 0 || isCheckoutCashInvalid) return;

    const isLogged = Boolean(api.isCustomerAuthenticated() && currentCustomer);
    if (!isLogged && checkoutEntryStep === 'choice') {
      return;
    }

    const cleanName = customerName.trim();
    const cleanPhone = customerPhone.trim();
    const cleanPhoneDigits = cleanPhone.replace(/\D/g, '');

    if (cleanName.length < 2 || cleanName.length > 80) {
      setCheckoutError('Por favor informe seu nome (entre 2 e 80 caracteres).');
      return;
    }
    if (cleanPhoneDigits.length < 10 || cleanPhoneDigits.length > 13) {
      setCheckoutError('Por favor informe um WhatsApp válido com DDD.');
      return;
    }

    const isUsingCustomAddress =
      !isLogged || loggedAddressMode === 'custom' || !currentCustomer?.address;
    const effectiveAddress = isUsingCustomAddress
      ? address.trim()
      : (currentCustomer?.address || address).trim();
    const effectiveNumber = isUsingCustomAddress
      ? addressNumber.trim()
      : (currentCustomer?.number || addressNumber).trim();
    const effectiveComplement = isUsingCustomAddress
      ? complement.trim()
      : (currentCustomer?.complement || complement || '').trim();
    const effectiveReference = isUsingCustomAddress
      ? reference.trim()
      : (currentCustomer?.reference || reference || '').trim();
    const effectiveCep = isUsingCustomAddress
      ? cep.trim()
      : (currentCustomer?.cep || cep || '').trim();

    if (deliveryType === 'delivery') {
      if (effectiveAddress.length < 2 || effectiveAddress.length > 120) {
        setCheckoutError('Informe a rua do endereço de entrega (entre 2 e 120 caracteres).');
        return;
      }
      if (effectiveNumber.length < 1 || effectiveNumber.length > 20) {
        setCheckoutError('Informe o número do imóvel (entre 1 e 20 caracteres).');
        return;
      }
      if (effectiveComplement.length > 80) {
        setCheckoutError('O complemento deve ter no máximo 80 caracteres.');
        return;
      }
      if (effectiveReference.length > 120) {
        setCheckoutError('O ponto de referência deve ter no máximo 120 caracteres.');
        return;
      }
      if (effectiveCep && effectiveCep.replace(/\D/g, '').length !== 8) {
        setCheckoutError('CEP inválido. Digite os 8 números do CEP ou deixe em branco.');
        return;
      }
      if (!matchedArea) {
        setCheckoutError('Escolha um bairro da lista de entrega.');
        return;
      }
    }

    if (cartSubtotal < settings.minOrderValue) {
      setCheckoutError(`O pedido mínimo é de ${formatCurrency(settings.minOrderValue)}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      // Refresh products right before finalizing the order
      lastProductsFetchAtRef.current = Date.now();
      await api.reloadProducts().catch(() => {});

      // If logged-in customer chose "Outro endereço" (or had no saved address) and checked "Salvar este endereço na minha conta"
      if (
        isLogged &&
        currentCustomer &&
        deliveryType === 'delivery' &&
        isUsingCustomAddress &&
        saveCustomAddressToAccount &&
        matchedArea
      ) {
        try {
          const updatedProfile = await api.updateCustomerMe({
            name: cleanName,
            phone: cleanPhone,
            cep: effectiveCep || undefined,
            address: effectiveAddress,
            number: effectiveNumber,
            neighborhood: matchedArea.name,
            deliveryAreaId: matchedArea.id,
            complement: effectiveComplement || undefined,
            reference: effectiveReference || undefined,
            city: checkoutCity.trim() || undefined,
            state: checkoutState.trim() || undefined,
          });
          setCurrentCustomer(updatedProfile);
        } catch (saveAddrErr: any) {
          console.warn('Aviso ao salvar endereço na conta:', saveAddrErr);
        }
      }

      const orderItemsPayload = cart.map((i) => {
        const currentProd = products.find((p) => p.id === i.product.id) || i.product;
        const isCase = i.saleUnit === 'case' && canSellProductCase(currentProd, settings, 'store');
        const effPrice = getCartItemUnitPrice(currentProd, i.saleUnit, i.addonsTotal);
        const unitsPerSale = isCase ? Number(currentProd.caseSize) : 1;
        return {
          productId: currentProd.id,
          name: currentProd.name,
          volume: currentProd.volume,
          price: effPrice,
          originalPrice: isCase ? Number(currentProd.casePrice) : currentProd.price,
          costPrice: currentProd.costPrice,
          quantity: i.quantity,
          saleUnit: isCase ? ('case' as const) : ('unit' as const),
          unitsPerSale,
          isCold: currentProd.isCold,
          addons:
            i.addons && i.addons.length > 0
              ? i.addons.map((a) => ({
                  groupId: a.groupId,
                  optionId: a.optionId,
                  groupName: a.groupName,
                  optionName: a.optionName,
                  price: a.price,
                  quantity: a.quantity,
                }))
              : undefined,
          addonsTotal: i.addonsTotal,
          comboItems: i.comboItems && i.comboItems.length > 0 ? i.comboItems : undefined,
        };
      });

      const orderPayload: any = {
        source: 'online',
        clientRequestId: checkoutClientRequestId,
        couponCode: isLogged ? appliedCoupon?.code : undefined,
        deliveryType,
        deliveryAreaId: deliveryType === 'delivery' ? matchedArea?.id : undefined,
        customer: {
          name: cleanName,
          phone: cleanPhone,
          cep: deliveryType === 'delivery' ? effectiveCep || undefined : undefined,
          address: deliveryType === 'delivery' ? effectiveAddress : 'Retirada no Depósito',
          number: deliveryType === 'delivery' ? effectiveNumber : 'S/N',
          neighborhood: deliveryType === 'delivery' ? (matchedArea?.name || '') : 'Depósito',
          deliveryAreaId: deliveryType === 'delivery' ? matchedArea?.id : undefined,
          complement: deliveryType === 'delivery' ? effectiveComplement || undefined : undefined,
          reference: deliveryType === 'delivery' ? effectiveReference || undefined : undefined,
        },
        items: orderItemsPayload,
        subtotal: cartSubtotal,
        deliveryFee,
        total: cartTotal,
        paymentMethod,
        cashChangeFor:
          paymentMethod === 'dinheiro' && hasCheckoutCashTyped && !Number.isNaN(checkoutCashNum)
            ? Math.round(checkoutCashNum * 100) / 100
            : undefined,
        notes: orderNotes,
      };

      if (isLogged) {
        if (deliveryType === 'delivery' && isUsingCustomAddress && matchedArea) {
          orderPayload.deliveryAddress = {
            cep: effectiveCep || undefined,
            address: effectiveAddress,
            number: effectiveNumber,
            neighborhood: matchedArea.name,
            deliveryAreaId: matchedArea.id,
            complement: effectiveComplement || undefined,
            reference: effectiveReference || undefined,
            city: checkoutCity.trim() || undefined,
            state: checkoutState.trim() || undefined,
          };
        }
      } else {
        orderPayload.guest = {
          name: cleanName,
          phone: cleanPhone,
          cep: deliveryType === 'delivery' ? effectiveCep || undefined : undefined,
          address: deliveryType === 'delivery' ? effectiveAddress : 'Retirada no Depósito',
          number: deliveryType === 'delivery' ? effectiveNumber : 'S/N',
          neighborhood: deliveryType === 'delivery' ? (matchedArea?.name || '') : 'Depósito',
          deliveryAreaId: deliveryType === 'delivery' ? matchedArea?.id : undefined,
          complement: deliveryType === 'delivery' ? effectiveComplement || undefined : undefined,
          reference: deliveryType === 'delivery' ? effectiveReference || undefined : undefined,
          city: deliveryType === 'delivery' ? checkoutCity.trim() || undefined : undefined,
          state: deliveryType === 'delivery' ? checkoutState.trim() || undefined : undefined,
        };
      }

      const order = await api.createOrder(orderPayload, {
        onStatusMessage: (msg) => setSubmittingStatusText(msg),
      });

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });

      setPlacedOrder(order);
      if (!isLogged && order.guestToken) {
        setTrackedGuestToken(order.guestToken);
        setGuestConvertPhone(cleanPhone);
        setGuestConvertPassword('');
        setGuestConvertError('');
        setGuestConvertSuccess(false);
        refreshSavedGuestOrdersCount();
      }
      setCart([]);
      setCheckoutClientRequestId(crypto.randomUUID());
      setAppliedCoupon(null);
      setCouponInput('');
      setCouponError('');
      setCheckoutError('');
      setCanRetryOrderSubmit(false);
      setSubmittingStatusText('');
      setIsCartOpen(false);
    } catch (err: any) {
      console.error('Falha ao processar pedido:', err);
      setSubmittingStatusText('');

      if (err?.isNetworkRetryExhausted || isNetworkOrTimeoutError(err)) {
        // Mantém o MESMO checkoutClientRequestId para não duplicar ao tocar em "Tentar de novo"
        setCheckoutError(ORDER_NETWORK_EXHAUSTED_MESSAGE);
        setCanRetryOrderSubmit(true);
        return;
      }

      setCanRetryOrderSubmit(false);
      const rawMessage: string = err.message || 'Não foi possível finalizar o pedido. Verifique o estoque dos itens.';
      const lowerMsg = rawMessage.toLowerCase();
      if (
        lowerMsg.includes('estoque') ||
        lowerMsg.includes('indisponível') ||
        lowerMsg.includes('indisponivel') ||
        lowerMsg.includes('não encontrado')
      ) {
        await api.reloadProducts().catch(() => {});
        const freshProducts = api.getProducts();
        const freshMap = new Map(freshProducts.map((p) => [p.id, p]));
        const stockWarnings: string[] = [];

        setCart((prevCart) => {
          const nextCart: CartItem[] = [];
          const remainingByProd = new Map<string, number>();

          for (const item of prevCart) {
            const fp = freshMap.get(item.product.id);
            if (!fp || !fp.active || fp.stock <= 0) {
              const exhaustedMsg = `${fp?.name || item.product.name} esgotou e saiu do carrinho`;
              stockWarnings.push(exhaustedMsg);
              setOutOfStockNotices((prev) => (prev.includes(exhaustedMsg) ? prev : [...prev, exhaustedMsg]));
              continue;
            }
            const avail = remainingByProd.has(fp.id) ? remainingByProd.get(fp.id)! : fp.stock;
            const isCase = item.saleUnit === 'case' && canSellProductCase(fp, settings, 'store');
            const mult = isCase ? Number(fp.caseSize) : 1;
            const requestedUnits = item.quantity * mult;

            if (requestedUnits <= avail) {
              remainingByProd.set(fp.id, avail - requestedUnits);
              nextCart.push({ ...item, product: fp });
            } else {
              const maxQty = Math.floor(avail / mult);
              if (maxQty > 0) {
                remainingByProd.set(fp.id, avail - maxQty * mult);
                nextCart.push({ ...item, product: fp, quantity: maxQty });
              } else if (isCase && avail > 0) {
                // Convert to available loose units if a full case is no longer available
                remainingByProd.set(fp.id, 0);
                const sig = buildOrderItemAddonsSignature(item.addons);
                nextCart.push({
                  ...item,
                  lineId: `${fp.id}::unit::${sig}`,
                  product: fp,
                  quantity: avail,
                  saleUnit: 'unit',
                });
              }
              stockWarnings.push(`Só restam ${fp.stock} unidades de ${fp.name}`);
            }
          }
          return nextCart;
        });

        const uniqueWarnings = Array.from(new Set(stockWarnings));
        if (uniqueWarnings.length > 0) {
          setCheckoutError(uniqueWarnings.join(' • '));
        } else {
          setCheckoutError(rawMessage);
        }
      } else {
        setCheckoutError(rawMessage);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitCustomerOrder();
  };

  const handleCopyPix = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(settings.pixKey);
      setCopiedPix(true);
      setTimeout(() => setCopiedPix(false), 2500);
    }
  };

  const categories = useMemo(() => {
    const getCategoryIcon = (catId: string) => {
      switch (catId) {
        case 'cervejas':
          return Beer;
        case 'destilados':
        case 'vinhos':
          return Wine;
        case 'nao_alcoolicos':
          return Coffee;
        case 'gelo_carvao':
          return Flame;
        default:
          return Package;
      }
    };

    const list: { id: string; label: string; icon: any }[] = [
      { id: 'todas', label: 'Início', icon: Sparkles },
    ];

    for (const sec of groupedCategorySections) {
      list.push({
        id: sec.id,
        label: sec.name,
        icon: getCategoryIcon(sec.id),
      });
    }

    return list;
  }, [groupedCategorySections]);

  // If the currently selected category becomes empty, switch back to 'todas'
  useEffect(() => {
    if (selectedCategory !== 'todas' && !categories.some((c) => c.id === selectedCategory)) {
      setSelectedCategory('todas');
    }
  }, [categories, selectedCategory]);

  // Refs & IntersectionObserver for continuous category scroll navigation (MUST be before `if (placedOrder)`)
  const catalogTopRef = useRef<HTMLDivElement | null>(null);
  const categoryNavScrollRef = useRef<HTMLDivElement | null>(null);
  const featuredCarouselScrollRef = useRef<HTMLDivElement | null>(null);
  const isManualScrollingRef = useRef<boolean>(false);
  const manualScrollTimeoutRef = useRef<number | null>(null);

  // Mouse drag-to-scroll state for desktop / preview horizontal lists
  const dragStateRef = useRef<{
    activeKey: string | null;
    startX: number;
    scrollLeft: number;
    hasMoved: boolean;
  }>({
    activeKey: null,
    startX: 0,
    scrollLeft: 0,
    hasMoved: false,
  });

  const scrollHorizontalContainer = (
    ref: React.RefObject<HTMLDivElement | null>,
    delta: number
  ) => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: delta, behavior: 'smooth' });
  };

  const getHorizontalDragProps = (
    ref: React.RefObject<HTMLDivElement | null>,
    key: string
  ) => ({
    onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !ref.current) return;
      dragStateRef.current = {
        activeKey: key,
        startX: e.pageX - ref.current.offsetLeft,
        scrollLeft: ref.current.scrollLeft,
        hasMoved: false,
      };
    },
    onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => {
      const st = dragStateRef.current;
      if (st.activeKey !== key || !ref.current) return;
      const x = e.pageX - ref.current.offsetLeft;
      const walk = x - st.startX;
      if (Math.abs(walk) > 5) {
        st.hasMoved = true;
        e.preventDefault();
        ref.current.scrollLeft = st.scrollLeft - walk * 1.25;
      }
    },
    onMouseUp: () => {
      if (dragStateRef.current.activeKey === key) {
        dragStateRef.current.activeKey = null;
      }
    },
    onMouseLeave: () => {
      if (dragStateRef.current.activeKey === key) {
        dragStateRef.current.activeKey = null;
      }
    },
    onClickCapture: (e: React.MouseEvent<HTMLDivElement>) => {
      if (dragStateRef.current.hasMoved) {
        e.preventDefault();
        e.stopPropagation();
        dragStateRef.current.hasMoved = false;
      }
    },
  });

  const handleSelectCategoryPill = (catId: ProductCategory | 'todas') => {
    setSelectedCategory(catId);
    isManualScrollingRef.current = true;
    if (manualScrollTimeoutRef.current !== null) {
      window.clearTimeout(manualScrollTimeoutRef.current);
    }
    manualScrollTimeoutRef.current = window.setTimeout(() => {
      isManualScrollingRef.current = false;
      manualScrollTimeoutRef.current = null;
    }, 750);

    if (typeof window === 'undefined') return;
    if (catId === 'todas') {
      if (catalogTopRef.current) {
        catalogTopRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }

    const sectionEl = document.getElementById(`cat-section-${catId}`);
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    return () => {
      if (manualScrollTimeoutRef.current !== null) {
        window.clearTimeout(manualScrollTimeoutRef.current);
      }
    };
  }, []);

  // Keep active category pill centered/visible inside horizontal category bar
  useEffect(() => {
    const navEl = categoryNavScrollRef.current;
    if (!navEl) return;
    const pillEl = navEl.querySelector<HTMLElement>(`[data-cat-pill="${selectedCategory}"]`);
    if (!pillEl) return;
    const navRect = navEl.getBoundingClientRect();
    const pillRect = pillEl.getBoundingClientRect();
    const offset = pillRect.left - navRect.left - navRect.width / 2 + pillRect.width / 2;
    navEl.scrollBy({ left: offset, behavior: 'smooth' });
  }, [selectedCategory]);

  // Observe `#cat-section-${section.id}` during page scroll to highlight the active category pill
  useEffect(() => {
    if (placedOrder || typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }
    if (groupedCategorySections.length === 0) return;

    const visibleRatios = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const catId = entry.target.getAttribute('data-cat-section-id');
          if (!catId) continue;
          if (entry.isIntersecting) {
            visibleRatios.set(catId, entry.intersectionRatio);
          } else {
            visibleRatios.delete(catId);
          }
        }

        if (isManualScrollingRef.current) return;

        if (window.scrollY < 160) {
          setSelectedCategory('todas');
          return;
        }

        // Pick the first category in catalog order that is currently intersecting in the upper viewport zone
        for (const sec of groupedCategorySections) {
          if (visibleRatios.has(sec.id)) {
            setSelectedCategory(sec.id as ProductCategory);
            break;
          }
        }
      },
      {
        root: null,
        rootMargin: '-125px 0px -58% 0px',
        threshold: [0, 0.1, 0.25, 0.5],
      }
    );

    for (const sec of groupedCategorySections) {
      const el = document.getElementById(`cat-section-${sec.id}`);
      if (el) observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [placedOrder, groupedCategorySections]);

  const getStatusBadgeInfo = (status: OrderStatus, delivType: 'delivery' | 'retirada' | 'local') => {
    switch (status) {
      case 'pendente':
        return { label: 'Recebido', className: 'bg-amber-100 text-amber-800 border-amber-300' };
      case 'em_separacao':
        return { label: 'Em preparo', className: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'em_rota':
        return {
          label: delivType === 'delivery' ? 'Saiu para entrega' : 'Pronto para retirada',
          className: 'bg-purple-100 text-purple-800 border-purple-300',
        };
      case 'concluido':
        return { label: 'Entregue', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
      case 'cancelado':
        return { label: 'Pedido cancelado', className: 'bg-red-100 text-red-800 border-red-300' };
      default:
        return { label: 'Recebido', className: 'bg-amber-100 text-amber-800 border-amber-300' };
    }
  };

  const buildOrderWhatsAppUrl = (order: Order) => {
    const rawDigits = (settings.whatsapp || '').replace(/\D/g, '');
    const phoneDigits =
      rawDigits.length === 10 || rawDigits.length === 11 ? `55${rawDigits}` : rawDigits;
    const host = typeof window !== 'undefined' ? window.location.host : '';
    const orderNumber = String(order.id).replace(/^#/, '');
    const customerEmail = order.customer.email || currentCustomer?.email || '';
    const lines: string[] = [];

    lines.push(`🔔 Novo Pedido via ${host}`);
    lines.push(`🧾 Pedido: #${orderNumber}`);
    lines.push('');
    lines.push(`👤 Cliente: ${order.customer.name}`);
    lines.push(`📞 Telefone: ${order.customer.phone}`);
    lines.push(`✉️ E-mail: ${customerEmail}`);
    lines.push('');
    lines.push('🛍️ Itens do Pedido:');
    for (const it of order.items) {
      const itemTotal = (Number(it.price) * Number(it.quantity)).toFixed(2);
      const isCase = it.saleUnit === 'case' && (it.unitsPerSale || 1) > 1;
      const label = isCase
        ? `${it.quantity} cx ${it.name}${it.volume ? ` ${it.volume}` : ''} (c/${it.unitsPerSale})`
        : `${it.quantity}x ${it.name}${it.volume ? ` ${it.volume}` : ''}`;
      lines.push(`- ${label} - R$ ${itemTotal}`);
      if (Array.isArray(it.comboItems) && it.comboItems.length > 0) {
        for (const ci of it.comboItems) {
          lines.push(`   ${formatOrderItemComboLine(ci)}`);
        }
      }
      if (Array.isArray(it.addons) && it.addons.length > 0) {
        for (const addon of it.addons) {
          lines.push(`   ${formatOrderItemAddonLine(addon)}`);
        }
      }
    }
    lines.push('');
    lines.push(`🛒 Valor dos itens: R$ ${Number(order.subtotal).toFixed(2)}`);
    if (order.couponCode && order.discount && Number(order.discount) > 0) {
      lines.push(`🏷️ Cupom ${order.couponCode}: - R$ ${Number(order.discount).toFixed(2)}`);
    }
    if (order.deliveryType === 'delivery') {
      lines.push(`🛵 Taxa de entrega: R$ ${Number(order.deliveryFee).toFixed(2)}`);
    }
    lines.push('');
    lines.push(`💰 Total a Pagar: R$ ${Number(order.total).toFixed(2)}`);
    lines.push('');
    lines.push(
      `🍽️ Tipo entrega: ${
        order.deliveryType === 'retirada' ? 'Retirar meu pedido' : 'Entrega no endereço'
      }`
    );
    if (order.deliveryType === 'delivery') {
      const comp = order.customer.complement ? ` ${order.customer.complement}` : '';
      const city = order.customer.city || currentCustomer?.city || '';
      const cityPart = city ? `, ${city}` : '';
      lines.push(
        `📍 Endereço: ${order.customer.address}, ${order.customer.number}${comp} - ${order.customer.neighborhood}${cityPart}`
      );
    }
    const payMap: Record<string, string> = {
      dinheiro: 'Dinheiro',
      pix: 'Pix',
      cartao_credito: 'Cartão',
      cartao_debito: 'Cartão',
    };
    lines.push(`💳 Pagamento: ${payMap[order.paymentMethod] || 'Pix'}`);
    if (order.paymentMethod === 'dinheiro' && order.cashChangeFor && Number(order.cashChangeFor) > 0) {
      lines.push(`💵 Troco para: R$ ${Number(order.cashChangeFor).toFixed(2)}`);
    }

    const message = lines.join('\n');
    return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;
  };

  // ORDER TRACKING SCREEN IF ORDER PLACED OR SELECTED
  if (placedOrder) {
    const badge = getStatusBadgeInfo(placedOrder.status, placedOrder.deliveryType);
    const timelineSteps = [
      {
        key: 'recebido',
        label: 'Recebido',
        done: ['pendente', 'em_separacao', 'em_rota', 'concluido'].includes(placedOrder.status),
        current: placedOrder.status === 'pendente',
      },
      {
        key: 'confirmado',
        label: 'Confirmado',
        done: ['em_separacao', 'em_rota', 'concluido'].includes(placedOrder.status),
        current: false,
      },
      {
        key: 'preparo',
        label: 'Em preparo',
        done: ['em_separacao', 'em_rota', 'concluido'].includes(placedOrder.status),
        current: placedOrder.status === 'em_separacao',
      },
      {
        key: 'rota',
        label: placedOrder.deliveryType === 'retirada' ? 'Pronto para retirada' : 'Saiu para entrega',
        done: ['em_rota', 'concluido'].includes(placedOrder.status),
        current: placedOrder.status === 'em_rota',
      },
      {
        key: 'entregue',
        label: 'Entregue',
        done: placedOrder.status === 'concluido',
        current: placedOrder.status === 'concluido',
      },
    ];

    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl shadow-xl border border-amber-200 overflow-hidden">
          <div className="bg-radial from-amber-500 to-amber-600 text-white p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-xs">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black">Acompanhamento do Pedido</h2>
            <p className="text-amber-100 text-sm mt-1">
              Atualização automática a cada 15 segundos • Realizado em{' '}
              {new Date(placedOrder.createdAt).toLocaleString('pt-BR')}
            </p>
            <div className="inline-block mt-3 px-4 py-1.5 bg-white/25 rounded-full text-xs font-bold uppercase tracking-wider">
              Pedido #{placedOrder.id}
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-neutral-50 p-5 rounded-2xl border border-neutral-200">
              <h3 className="font-bold text-sm text-neutral-800 mb-4 flex items-center justify-between">
                <span>Status do Pedido</span>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${badge.className}`}>
                  {badge.label}
                </span>
              </h3>

              {placedOrder.status === 'cancelado' ? (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-300 text-red-800 flex items-center gap-3">
                  <AlertTriangle className="w-6 h-6 text-red-600 shrink-0" />
                  <div>
                    <p className="font-black text-sm text-red-900">Pedido cancelado</p>
                    <p className="text-xs text-red-700 mt-0.5">
                      Este pedido foi cancelado. Caso tenha dúvidas, entre em contato pelo WhatsApp da loja.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-1.5 text-center text-[11px]">
                  {timelineSteps.map((step, index) => (
                    <div key={step.key} className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold transition-all ${
                          step.done
                            ? step.current && placedOrder.status !== 'concluido'
                              ? 'bg-amber-500 text-neutral-950 ring-4 ring-amber-200 animate-pulse'
                              : 'bg-emerald-500 text-white'
                            : 'bg-neutral-200 text-neutral-500'
                        }`}
                      >
                        {step.done ? '✓' : index + 1}
                      </div>
                      <span
                        className={`mt-1.5 font-semibold leading-tight ${
                          step.done ? 'text-neutral-900' : 'text-neutral-400'
                        }`}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {placedOrder.paymentMethod === 'pix' && placedOrder.status !== 'cancelado' && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-bold text-amber-900 text-sm flex items-center gap-1.5">
                    <span>⚡ Pagamento via PIX</span>
                  </h4>
                  <span className="font-mono font-bold text-amber-900 text-base">
                    {formatCurrency(placedOrder.total)}
                  </span>
                </div>
                <p className="text-xs text-amber-800 mb-3">
                  Copie a chave Pix do depósito abaixo para realizar o pagamento:
                </p>
                <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-amber-200">
                  <span className="text-xs font-mono font-bold text-neutral-800 flex-1 truncate">
                    {settings.pixKey}
                  </span>
                  <button
                    onClick={handleCopyPix}
                    className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    {copiedPix ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedPix ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
                <p className="text-[11px] text-amber-700 mt-2">
                  Favorecido: <strong className="font-semibold">{settings.pixReceiver}</strong>
                </p>
              </div>
            )}

            <div className="border border-neutral-200 rounded-2xl p-4">
              <h4 className="font-bold text-neutral-900 text-sm mb-3">Itens do Pedido</h4>
              <div className="space-y-2 text-xs">
                {placedOrder.items.map((it, idx) => {
                  const isCase = it.saleUnit === 'case' && (it.unitsPerSale || 1) > 1;
                  const wasPromo = !isCase && it.originalPrice !== undefined && it.originalPrice > it.price;
                  return (
                    <div key={idx} className="flex justify-between items-start py-1.5 border-b border-neutral-100 last:border-0">
                      <div>
                        <span className="font-bold text-neutral-800">
                          {isCase ? `${it.quantity} cx ` : `${it.quantity}x `}
                        </span>
                        <span className="text-neutral-700">
                          {it.name}
                          {isCase ? ` (c/${it.unitsPerSale})` : ''}
                        </span>
                        {wasPromo && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-black rounded uppercase">
                            PROMO
                          </span>
                        )}
                        <span className="text-neutral-400 block">{it.volume} {it.isCold ? '• Gelada ❄️' : ''}</span>
                        {Array.isArray(it.comboItems) && it.comboItems.length > 0 && (
                          <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-amber-300">
                            {it.comboItems.map((ci, cIdx) => (
                              <div key={cIdx} className="text-[11px] font-semibold text-neutral-600">
                                {formatOrderItemComboLine(ci)}
                              </div>
                            ))}
                          </div>
                        )}
                        {Array.isArray(it.addons) && it.addons.length > 0 && (
                          <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-amber-300">
                            {it.addons.map((addon, aIdx) => (
                              <div key={aIdx} className="text-[11px] font-semibold text-neutral-600">
                                {formatOrderItemAddonLine(addon)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        {wasPromo && it.originalPrice && (
                          <span className="text-[10px] text-neutral-400 line-through mr-1.5">
                            {formatCurrency(it.originalPrice * it.quantity)}
                          </span>
                        )}
                        <span className="font-semibold text-neutral-900">
                          {formatCurrency(it.price * it.quantity)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 pt-3 border-t border-neutral-200 space-y-1 text-xs">
                <div className="flex justify-between text-neutral-500">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(placedOrder.subtotal)}</span>
                </div>
                {placedOrder.couponCode && placedOrder.discount && placedOrder.discount > 0 ? (
                  <div className="flex justify-between text-emerald-600 font-bold">
                    <span>Cupom ({placedOrder.couponCode}):</span>
                    <span>-{formatCurrency(placedOrder.discount)}</span>
                  </div>
                ) : null}
                {placedOrder.deliveryType === 'delivery' && (
                  <div className="flex justify-between text-neutral-500">
                    <span>Taxa de Entrega ({placedOrder.customer.neighborhood}):</span>
                    <span>{placedOrder.deliveryFee === 0 ? 'Grátis' : formatCurrency(placedOrder.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black text-neutral-900 pt-1">
                  <span>Total:</span>
                  <span className="text-amber-600">{formatCurrency(placedOrder.total)}</span>
                </div>
                <div className="flex justify-between text-neutral-600 pt-1 border-t border-neutral-200/70">
                  <span>Forma de Pagamento:</span>
                  <span className="font-bold text-neutral-900">
                    {placedOrder.paymentMethod === 'pix' && 'PIX'}
                    {placedOrder.paymentMethod === 'cartao_credito' && 'Cartão de Crédito'}
                    {placedOrder.paymentMethod === 'cartao_debito' && 'Cartão de Débito'}
                    {placedOrder.paymentMethod === 'dinheiro' && 'Dinheiro'}
                  </span>
                </div>
                {placedOrder.cashChangeFor !== undefined && placedOrder.cashChangeFor !== null && (
                  <div className="flex justify-between text-amber-800 font-semibold">
                    <span>Troco:</span>
                    <span>Troco para {formatCurrency(placedOrder.cashChangeFor)}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-neutral-50 p-4 rounded-2xl text-xs space-y-1 text-neutral-700 border border-neutral-200">
              <p className="font-bold text-neutral-900">
                {placedOrder.deliveryType === 'delivery' ? '🛵 Endereço de Entrega' : '🏪 Retirada no Depósito'}
              </p>
              {placedOrder.deliveryType === 'delivery' ? (
                <>
                  <p>{placedOrder.customer.address}, {placedOrder.customer.number} - {placedOrder.customer.neighborhood}</p>
                  {placedOrder.customer.complement && <p>Compl: {placedOrder.customer.complement}</p>}
                  {placedOrder.customer.reference && <p className="text-amber-800 font-medium">Ref: {placedOrder.customer.reference}</p>}
                </>
              ) : (
                <p>Retirar diretamente no endereço: {settings.address}</p>
              )}
            </div>

            {/* Post-Order Account Creation Offer for Guest Orders (Requirement 3e) */}
            {!currentCustomer && !placedOrder.customerId && (
              <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50 via-white to-amber-50/70 border-2 border-amber-300 shadow-xs space-y-3">
                {guestConvertSuccess ? (
                  <div className="flex items-center gap-3 text-emerald-800">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-black text-sm">Conta criada com sucesso!</p>
                      <p className="text-xs text-emerald-700">
                        Seus dados e seu endereço já ficaram salvos para o próximo pedido.
                      </p>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (isConvertingGuest) return;
                      setGuestConvertError('');
                      let digits = guestConvertPhone.replace(/\D/g, '');
                      if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
                        digits = digits.slice(2);
                      }
                      if (digits.length < 10 || digits.length > 11) {
                        setGuestConvertError('Confirme um WhatsApp válido com DDD (10 ou 11 dígitos).');
                        return;
                      }
                      if (guestConvertPassword.length < 8) {
                        setGuestConvertError('A senha precisa ter no mínimo 8 caracteres.');
                        return;
                      }
                      setIsConvertingGuest(true);
                      try {
                        const tok =
                          placedOrder.guestToken ||
                          trackedGuestToken ||
                          api.getGuestTokenForOrder(placedOrder.id) ||
                          undefined;
                        const createdCust = await api.registerCustomer({
                          name: placedOrder.customer.name,
                          phone: guestConvertPhone.trim(),
                          password: guestConvertPassword,
                          cep: placedOrder.customer.cep,
                          address:
                            placedOrder.deliveryType === 'delivery' ? placedOrder.customer.address : '',
                          number:
                            placedOrder.deliveryType === 'delivery' ? placedOrder.customer.number : '',
                          neighborhood:
                            placedOrder.deliveryType === 'delivery' ? placedOrder.customer.neighborhood : '',
                          deliveryAreaId:
                            placedOrder.deliveryType === 'delivery' ? placedOrder.customer.deliveryAreaId : undefined,
                          complement: placedOrder.customer.complement,
                          reference: placedOrder.customer.reference,
                          city: placedOrder.customer.city,
                          state: placedOrder.customer.state,
                          guestOrderId: placedOrder.id,
                          guestToken: tok,
                        });
                        setCurrentCustomer(createdCust);
                        setGuestConvertSuccess(true);
                        setPlacedOrder((prev) =>
                          prev ? { ...prev, customerId: createdCust.id } : prev
                        );
                      } catch (err: any) {
                        setGuestConvertError(err?.message || 'Não foi possível criar a conta.');
                      } finally {
                        setIsConvertingGuest(false);
                      }
                    }}
                    className="space-y-3"
                  >
                    <div>
                      <h4 className="font-black text-sm text-neutral-900 flex items-center gap-1.5">
                        <User className="w-4 h-4 text-amber-600" />
                        <span>Quer salvar seus dados para a próxima? Crie uma senha</span>
                      </h4>
                      <p className="text-xs text-neutral-600 mt-0.5">
                        Aproveitamos o nome e endereço deste pedido (<strong>{placedOrder.customer.name}</strong>
                        {placedOrder.deliveryType === 'delivery' && placedOrder.customer.address
                          ? ` • ${placedOrder.customer.address}, ${placedOrder.customer.number}`
                          : ''}
                        ).
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[11px] font-bold text-neutral-700 block mb-1">
                          Confirme seu WhatsApp
                        </label>
                        <input
                          type="tel"
                          required
                          value={guestConvertPhone}
                          onChange={(e) => {
                            setGuestConvertPhone(e.target.value);
                            if (guestConvertError) setGuestConvertError('');
                          }}
                          placeholder="(11) 99999-9999"
                          className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-semibold outline-amber-500"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-neutral-700 block mb-1">
                          Crie uma senha (mín. 8 caracteres)
                        </label>
                        <div className="relative">
                          <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                          <input
                            type={showGuestConvertPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            value={guestConvertPassword}
                            onChange={(e) => {
                              setGuestConvertPassword(e.target.value);
                              if (guestConvertError) setGuestConvertError('');
                            }}
                            placeholder="Mínimo 8 caracteres"
                            className="w-full pl-8 pr-9 py-2 bg-white border border-neutral-300 rounded-xl text-xs font-semibold outline-amber-500"
                          />
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setShowGuestConvertPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-800 cursor-pointer"
                          >
                            {showGuestConvertPassword ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    {guestConvertError && (
                      <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 p-2 rounded-xl">
                        {guestConvertError}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isConvertingGuest}
                      className="w-full sm:w-auto px-5 py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:opacity-50 text-white font-black text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isConvertingGuest ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Salvando seus dados...</span>
                        </>
                      ) : (
                        <>
                          <span>Salvar meus dados</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <a
                href={buildOrderWhatsAppUrl(placedOrder)}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-sm transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Falar sobre o Pedido no WhatsApp</span>
              </a>

              {(currentCustomer || savedGuestOrdersCount > 0) && (
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/pedido/')) {
                      try {
                        window.history.replaceState({}, '', '/');
                      } catch {}
                    }
                    setPlacedOrder(null);
                    handleOpenMyOrders();
                  }}
                  className="py-3 px-4 border border-neutral-300 hover:bg-neutral-100 text-neutral-700 font-bold rounded-xl text-sm transition-colors cursor-pointer"
                >
                  Meus pedidos
                </button>
              )}

              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/pedido/')) {
                    try {
                      window.history.replaceState({}, '', '/');
                    } catch {}
                  }
                  setPlacedOrder(null);
                }}
                className="py-3 px-5 border border-neutral-300 hover:bg-neutral-100 text-neutral-700 font-bold rounded-xl text-sm transition-colors cursor-pointer"
              >
                Voltar à Loja
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={catalogTopRef} className="max-w-5xl mx-auto px-3 sm:px-6 pt-3 sm:pt-5 pb-36 md:pb-28">
      {/* Store Closed Warning Banner if offline */}
      {!settings.isOpen && (
        <div className="mb-3 p-3.5 bg-red-600 text-white rounded-2xl shadow-md border border-red-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-black text-sm shrink-0">
              🔴
            </div>
            <div>
              <h4 className="font-black text-xs sm:text-sm uppercase tracking-wide">
                Depósito Fechado no Momento
              </h4>
              <p className="text-[11px] sm:text-xs text-red-100 mt-0.5">
                {settings.closedMessage || 'No momento não estamos aceitando novos pedidos de entrega.'}
              </p>
            </div>
          </div>
          <div className="text-xs text-red-100 font-medium shrink-0">
            Horário: <strong className="text-white">{settings.openingHours}</strong>
          </div>
        </div>
      )}

      {guestTrackingError && (
        <div className="mb-3 p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-2xl flex items-center justify-between gap-3 text-xs font-bold">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{guestTrackingError}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setGuestTrackingError('');
              if (typeof window !== 'undefined' && window.location.pathname.startsWith('/pedido/')) {
                try {
                  window.history.replaceState({}, '', '/');
                } catch {}
              }
            }}
            className="p-1 hover:bg-red-100 rounded-lg text-red-700 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Compact Delivery App Store Header (Yooga / iFood reference) */}
      <header className="bg-white rounded-2xl border border-neutral-200 shadow-xs p-3.5 sm:p-4 mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {settings.logoUrl ? (
              <img
                src={settings.logoUrl}
                alt={settings.storeName}
                width={56}
                height={56}
                loading="lazy"
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border border-neutral-200 shrink-0 bg-neutral-100"
              />
            ) : (
              <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-500 text-neutral-950 flex items-center justify-center shrink-0 shadow-xs">
                <Beer className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-xl font-black text-neutral-900 truncate">
                  {settings.storeName}
                </h1>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide ${
                    settings.isOpen
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      : 'bg-red-100 text-red-800 border border-red-200'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      settings.isOpen ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  {settings.isOpen ? 'Aberto' : 'Fechado'}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-xs text-neutral-600 font-medium">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>{settings.estimatedDeliveryTime || '30-45 min'}</span>
                </span>
                <span className="text-neutral-300">•</span>
                <span>
                  Mín. <strong className="text-neutral-800">{formatCurrency(settings.minOrderValue || 0)}</strong>
                </span>
                <span className="text-neutral-300">•</span>
                <span className="inline-flex items-center gap-1">
                  <Truck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>{activeAreas.length} bairros atendidos</span>
                </span>
              </div>
            </div>
          </div>

          {/* Desktop Quick Actions */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {(currentCustomer || savedGuestOrdersCount > 0) && (
              <button
                type="button"
                onClick={handleOpenMyOrders}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-xl text-xs font-black transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Package className="w-3.5 h-3.5 text-amber-600" />
                <span>Meus Pedidos</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setAuthModalInitialTab('login');
                setIsAuthModalOpen(true);
              }}
              className="px-3.5 py-2 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <User className="w-3.5 h-3.5" />
              <span>{currentCustomer ? currentCustomer.name.split(' ')[0] : 'Entrar / Conta'}</span>
            </button>
            {currentCustomer && (
              <button
                type="button"
                onClick={() => {
                  api.logoutCustomer();
                  setCurrentCustomer(null);
                  setCheckoutEntryStep('choice');
                  setAppliedCoupon(null);
                  setMyOrders([]);
                }}
                className="px-2.5 py-2 bg-neutral-100 hover:bg-red-50 text-neutral-600 hover:text-red-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Sair
              </button>
            )}
          </div>
        </div>

        {/* Logged-in Delivery Address Bar */}
        {currentCustomer && (
          <div className="mt-3 pt-2.5 border-t border-neutral-100 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 min-w-0 text-neutral-700">
              <MapPin className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span className="truncate">
                {currentCustomer.address ? (
                  <>
                    Entregar em:{' '}
                    <strong className="text-neutral-900">
                      {currentCustomer.address}, {currentCustomer.number}
                    </strong>{' '}
                    <span className="text-neutral-500">({currentCustomer.neighborhood})</span>
                  </>
                ) : (
                  <>
                    Olá, <strong className="text-neutral-900">{currentCustomer.name}</strong>! Cadastre seu endereço para entrega.
                  </>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setAuthModalInitialTab('login');
                setIsAuthModalOpen(true);
              }}
              className="text-[11px] font-black text-amber-700 hover:text-amber-800 shrink-0 cursor-pointer"
            >
              Alterar
            </button>
          </div>
        )}
      </header>

      {/* Out-of-Stock Cart Removal Notices */}
      {outOfStockNotices.length > 0 && (
        <div className="mb-3 space-y-2">
          {outOfStockNotices.map((notice) => (
            <div
              key={notice}
              className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl shadow-xs flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 text-xs font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{notice}</span>
              </div>
              <button
                type="button"
                onClick={() =>
                  setOutOfStockNotices((prev) => prev.filter((m) => m !== notice))
                }
                className="p-1 hover:bg-amber-200/60 rounded-lg text-amber-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Optional Top Featured & Promo Carousel (settings.showFeaturedCarousel !== false) */}
      {settings.showFeaturedCarousel !== false && featuredAndPromoCarouselProducts.length > 0 && (
        <section className="mb-4">
          <div className="flex items-center justify-between mb-2 px-0.5">
            <h2 className="text-sm sm:text-base font-black text-neutral-900 flex items-center gap-1.5">
              <span>🔥 Destaques & Promoções</span>
            </h2>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-neutral-400 mr-1 hidden sm:inline">
                Arraste ou use as setas
              </span>
              <button
                type="button"
                onClick={() => scrollHorizontalContainer(featuredCarouselScrollRef, -280)}
                className="w-7 h-7 rounded-lg bg-white hover:bg-neutral-50 border border-neutral-200 text-neutral-700 flex items-center justify-center shadow-2xs active:scale-95 cursor-pointer"
                aria-label="Rolar destaques para a esquerda"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => scrollHorizontalContainer(featuredCarouselScrollRef, 280)}
                className="w-7 h-7 rounded-lg bg-white hover:bg-neutral-50 border border-neutral-200 text-neutral-700 flex items-center justify-center shadow-2xs active:scale-95 cursor-pointer"
                aria-label="Rolar destaques para a direita"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={featuredCarouselScrollRef}
            {...getHorizontalDragProps(featuredCarouselScrollRef, 'carousel')}
            className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-none cursor-grab active:cursor-grabbing select-none"
          >
            {featuredAndPromoCarouselProducts.map((product) => {
              const isCombo = isComboProduct(product.id, settings);
              const comboMetrics = isCombo ? calculateComboMetrics(product, settings, products) : null;
              const activeUnit = getSelectedUnit(product);
              const hasCase = !isCombo && canSellProductCase(product, settings, 'store');
              const isCaseSelected = activeUnit === 'case' && hasCase;
              const unitsPerSale = isCaseSelected ? Number(product.caseSize) : 1;
              const qty = getCartQuantity(product.id, activeUnit);
              const usedUnits = getCartTotalUnitsForProduct(product.id);
              const canAddMore = usedUnits + unitsPerSale <= product.stock;
              const isOutOfStock = product.stock <= 0;
              const promoActive = isProductPromoActive(product);
              const discountPct = promoActive ? getPromoDiscountPercent(product) : 0;
              const effPrice = getEffectiveProductPrice(product);
              const displayPrice = isCaseSelected ? Number(product.casePrice) : effPrice;
              const hasComboSavings = Boolean(
                isCombo && comboMetrics && comboMetrics.separatePrice > effPrice
              );

              return (
                <div
                  key={`carousel-${product.id}`}
                  className={`min-w-[245px] sm:min-w-[270px] max-w-[275px] bg-white rounded-2xl border p-2.5 shadow-2xs flex items-center gap-2.5 shrink-0 ${
                    promoActive ? 'border-red-200' : 'border-neutral-200'
                  }`}
                >
                  <div className="relative w-18 h-18 sm:w-20 sm:h-20 rounded-xl bg-neutral-100 overflow-hidden shrink-0">
                    {product.imageUrl || product.image ? (
                      <img
                        src={product.imageUrl || product.image}
                        alt={product.name}
                        width={80}
                        height={80}
                        loading="lazy"
                        draggable={false}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-300">
                        <Package className="w-6 h-6" />
                      </div>
                    )}
                    {promoActive && (
                      <span className="absolute top-1 left-1 bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-xs">
                        -{discountPct}%
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex flex-col justify-between h-full">
                    <div>
                      <div className="flex items-center gap-1 flex-wrap">
                        {isCombo && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[9px] font-black uppercase">
                            Combo
                          </span>
                        )}
                        {product.isCold && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 text-[9px] font-black">
                            ❄️ Gelada
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-xs text-neutral-900 leading-tight line-clamp-2 mt-0.5">
                        {product.name}
                      </h3>
                    </div>

                    <div className="mt-1.5 flex items-end justify-between gap-1.5">
                      <div className="min-w-0">
                        {promoActive && !isCaseSelected ? (
                          <>
                            <span className="text-[10px] text-neutral-400 line-through block leading-none">
                              {formatCurrency(product.price)}
                            </span>
                            <span className="text-xs sm:text-sm font-black text-red-600 block leading-tight">
                              {formatCurrency(displayPrice)}
                            </span>
                          </>
                        ) : hasComboSavings && comboMetrics ? (
                          <>
                            <span className="text-[10px] text-neutral-400 line-through block leading-none">
                              {formatCurrency(comboMetrics.separatePrice)}
                            </span>
                            <span className="text-xs sm:text-sm font-black text-neutral-900 block leading-tight">
                              {formatCurrency(displayPrice)}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs sm:text-sm font-black text-neutral-900 block leading-tight">
                            {formatCurrency(displayPrice)}
                          </span>
                        )}
                      </div>

                      {isOutOfStock ? (
                        <span className="text-[10px] font-bold text-neutral-400 bg-neutral-100 px-2 py-1 rounded-lg">
                          Esgotado
                        </span>
                      ) : qty === 0 ? (
                        <button
                          type="button"
                          disabled={!canAddMore}
                          onClick={() => addToCart(product, activeUnit)}
                          className="w-8 h-8 rounded-full bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 text-neutral-950 flex items-center justify-center shadow-sm active:scale-95 cursor-pointer shrink-0"
                          aria-label={`Adicionar ${product.name}`}
                        >
                          <Plus className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-1 bg-neutral-900 text-white rounded-full px-1.5 py-0.5 shadow-sm">
                          <button
                            type="button"
                            onClick={() => removeFromCart(product.id, activeUnit)}
                            className="w-6 h-6 rounded-full hover:bg-neutral-700 flex items-center justify-center cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="text-[11px] font-black min-w-[14px] text-center">{qty}</span>
                          <button
                            type="button"
                            disabled={!canAddMore}
                            onClick={() => addToCart(product, activeUnit)}
                            className="w-6 h-6 rounded-full bg-amber-500 text-neutral-950 disabled:opacity-40 flex items-center justify-center cursor-pointer"
                          >
                            <Plus className="w-3 h-3 stroke-[2.5]" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Sticky Top Search + Super Geladas Filter + Horizontal Category Bar */}
      <div className="sticky top-0 z-30 bg-neutral-100/95 backdrop-blur-md pt-2 pb-2.5 -mx-3 px-3 sm:-mx-6 sm:px-6 border-b border-neutral-200/80 shadow-xs mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="Buscar bebida, combo, gelo, carvão..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-14 py-2 bg-white border border-neutral-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 text-[11px] font-bold cursor-pointer"
              >
                Limpar
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setOnlyCold(!onlyCold)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs transition-all border shrink-0 cursor-pointer ${
              onlyCold
                ? 'bg-sky-500 text-white border-sky-600 shadow-xs'
                : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
            }`}
          >
            <span>❄️</span>
            <span className="hidden xs:inline sm:inline">Super Geladas</span>
            <span className="inline xs:hidden sm:hidden">Geladas</span>
          </button>
        </div>

        {/* Category Pills Navigation with Side Arrows + Mouse Drag */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => scrollHorizontalContainer(categoryNavScrollRef, -220)}
            className="w-7 h-7 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200 text-neutral-700 flex items-center justify-center shrink-0 shadow-2xs active:scale-95 cursor-pointer"
            aria-label="Rolar categorias para a esquerda"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div
            ref={categoryNavScrollRef}
            {...getHorizontalDragProps(categoryNavScrollRef, 'categories')}
            className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5 cursor-grab active:cursor-grabbing select-none"
          >
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  draggable={false}
                  data-cat-pill={cat.id}
                  onClick={() => handleSelectCategoryPill(cat.id as ProductCategory | 'todas')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all shrink-0 cursor-pointer ${
                    isActive
                      ? 'bg-neutral-900 text-amber-400 shadow-xs'
                      : 'bg-white text-neutral-600 hover:bg-neutral-50 border border-neutral-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 pointer-events-none" />
                  <span className="pointer-events-none">{cat.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => scrollHorizontalContainer(categoryNavScrollRef, 220)}
            className="w-7 h-7 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-200 text-neutral-700 flex items-center justify-center shrink-0 shadow-2xs active:scale-95 cursor-pointer"
            aria-label="Rolar categorias para a direita"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Continuous Category-Grouped Product List (Yooga / iFood Horizontal Cards) */}
      {products.length === 0 ? (
        <div className="text-center py-16 px-4 bg-white rounded-2xl border border-dashed border-neutral-300">
          <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Beer className="w-7 h-7" />
          </div>
          <h3 className="text-base font-black text-neutral-900">Catálogo em Atualização</h3>
          <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
            O depósito está atualizando o estoque e os produtos disponíveis. Em breve novas bebidas geladas estarão cadastradas!
          </p>
        </div>
      ) : groupedCategorySections.length === 0 ? (
        <div className="text-center py-14 bg-white rounded-2xl border border-dashed border-neutral-300">
          <Beer className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
          <h3 className="text-sm font-bold text-neutral-800">Nenhum produto encontrado</h3>
          <p className="text-xs text-neutral-500 mt-1">Tente buscar por outro termo ou limpar os filtros.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedCategorySections.map((section) => (
            <section
              key={section.id}
              id={`cat-section-${section.id}`}
              data-cat-section-id={section.id}
              className="scroll-mt-32 space-y-2.5"
            >
              <div className="flex items-center justify-between border-b border-neutral-200 pb-1.5">
                <h2 className="text-base sm:text-lg font-black text-neutral-900 tracking-tight">
                  {section.name}
                </h2>
                <span className="text-[11px] font-bold text-neutral-400">
                  {section.items.length} {section.items.length === 1 ? 'item' : 'itens'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {section.items.map((product) => {
                  const isCombo = isComboProduct(product.id, settings);
                  const comboMetrics = isCombo ? calculateComboMetrics(product, settings, products) : null;
                  const hasCase = !isCombo && canSellProductCase(product, settings, 'store');
                  const caseUnavailable = hasCase && product.stock < Number(product.caseSize);
                  const activeUnit = getSelectedUnit(product);
                  const isCaseSelected = activeUnit === 'case' && hasCase;
                  const unitsPerSale = isCaseSelected ? Number(product.caseSize) : 1;
                  const qty = getCartQuantity(product.id, activeUnit);
                  const usedUnits = getCartTotalUnitsForProduct(product.id);
                  const canAddMore = usedUnits + unitsPerSale <= product.stock;
                  const isOutOfStock = product.stock <= 0;
                  const promoActive = isProductPromoActive(product);
                  const discountPct = promoActive ? getPromoDiscountPercent(product) : 0;
                  const effPrice = getEffectiveProductPrice(product);
                  const displayPrice = isCaseSelected ? Number(product.casePrice) : effPrice;
                  const hasComboSavings = Boolean(
                    isCombo && comboMetrics && comboMetrics.separatePrice > effPrice
                  );

                  return (
                    <div
                      key={product.id}
                      className={`bg-white rounded-2xl border p-3 sm:p-3.5 shadow-2xs hover:shadow-md transition-all flex items-stretch justify-between gap-3 ${
                        promoActive ? 'border-red-200' : 'border-neutral-200'
                      }`}
                    >
                      {/* Left Column: Badges, Title, Combo/Description, Unit vs Case, Price */}
                      <div className="flex-1 min-w-0 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isCombo ? (
                              <span className="px-1.5 py-0.5 rounded-md bg-amber-100 border border-amber-300 text-amber-900 text-[10px] font-black uppercase tracking-wider">
                                Combo
                              </span>
                            ) : (
                              product.volume && (
                                <span className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                                  {product.volume}
                                </span>
                              )
                            )}
                            {product.isCold && (
                              <span className="px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 text-[10px] font-black">
                                ❄️ Gelada
                              </span>
                            )}
                            {promoActive && (
                              <span className="px-1.5 py-0.5 rounded-md bg-red-600 text-white text-[10px] font-black">
                                -{discountPct}% OFF
                              </span>
                            )}
                          </div>

                          <h3 className="font-bold text-sm sm:text-base text-neutral-900 leading-snug line-clamp-2 mt-1">
                            {product.name}
                          </h3>

                          {isCombo && comboMetrics?.itemsSummaryText ? (
                            <p className="mt-1 text-[11px] sm:text-xs font-bold text-amber-950 bg-amber-50 border border-amber-200/80 rounded-lg px-2 py-1 leading-snug">
                              Itens do combo: {comboMetrics.itemsSummaryText}
                            </p>
                          ) : product.description ? (
                            <p className="text-xs text-neutral-500 line-clamp-2 mt-1 leading-relaxed">
                              {product.description}
                            </p>
                          ) : null}

                          {hasCase && (
                            <div className="mt-2 max-w-[230px]">
                              <div className="grid grid-cols-2 gap-1 p-0.5 bg-neutral-100 rounded-lg border border-neutral-200">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedUnits((prev) => ({ ...prev, [product.id]: 'unit' }))
                                  }
                                  className={`py-1 px-1.5 rounded-md text-[10px] font-bold transition-all leading-tight text-center cursor-pointer ${
                                    !isCaseSelected
                                      ? 'bg-white text-neutral-900 shadow-2xs'
                                      : 'text-neutral-600 hover:text-neutral-900'
                                  }`}
                                >
                                  <span>Unidade</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={caseUnavailable}
                                  onClick={() =>
                                    setSelectedUnits((prev) => ({ ...prev, [product.id]: 'case' }))
                                  }
                                  className={`py-1 px-1.5 rounded-md text-[10px] font-bold transition-all leading-tight text-center ${
                                    caseUnavailable
                                      ? 'opacity-40 cursor-not-allowed text-neutral-400'
                                      : isCaseSelected
                                      ? 'bg-amber-500 text-neutral-950 shadow-2xs cursor-pointer'
                                      : 'text-neutral-600 hover:text-neutral-900 cursor-pointer'
                                  }`}
                                >
                                  <span>Caixa c/{product.caseSize}</span>
                                </button>
                              </div>
                              {caseUnavailable && !isOutOfStock && (
                                <p className="text-[10px] text-neutral-400 font-semibold mt-0.5">
                                  Sem caixa fechada no estoque
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Price at base of left column */}
                        <div className="mt-2.5 pt-1 flex items-baseline gap-2 flex-wrap">
                          {isCaseSelected ? (
                            <>
                              <span className="text-sm sm:text-base font-black text-neutral-900">
                                {formatCurrency(displayPrice)}
                              </span>
                              <span className="text-[10px] font-bold text-amber-700">
                                Caixa c/{product.caseSize} un.
                              </span>
                            </>
                          ) : promoActive ? (
                            <>
                              <span className="text-sm sm:text-base font-black text-red-600">
                                {formatCurrency(effPrice)}
                              </span>
                              <span className="text-xs text-neutral-400 line-through font-medium">
                                {formatCurrency(product.price)}
                              </span>
                            </>
                          ) : hasComboSavings && comboMetrics ? (
                            <>
                              <span className="text-sm sm:text-base font-black text-neutral-900">
                                {formatCurrency(effPrice)}
                              </span>
                              <span className="text-xs text-neutral-400 line-through font-medium">
                                {formatCurrency(comboMetrics.separatePrice)}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm sm:text-base font-black text-neutral-900">
                              {formatCurrency(product.price)}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Column: Square Photo + Floating + / - qty + Control */}
                      <div className="relative shrink-0 w-24 h-24 sm:w-28 sm:h-28 self-center">
                        <div className="w-full h-full rounded-2xl bg-neutral-100 border border-neutral-100 overflow-hidden">
                          {product.imageUrl || product.image ? (
                            <img
                              src={product.imageUrl || product.image}
                              alt={product.name}
                              width={112}
                              height={112}
                              loading="lazy"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-300">
                              <Package className="w-8 h-8" />
                            </div>
                          )}
                        </div>

                        {isOutOfStock ? (
                          <div className="absolute inset-0 rounded-2xl bg-black/60 backdrop-blur-[1px] flex items-center justify-center">
                            <span className="bg-red-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase">
                              Esgotado
                            </span>
                          </div>
                        ) : qty === 0 ? (
                          <button
                            type="button"
                            disabled={!canAddMore}
                            onClick={() => addToCart(product, activeUnit)}
                            className="absolute -bottom-1.5 -right-1.5 w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 text-neutral-950 flex items-center justify-center shadow-md border-2 border-white active:scale-95 transition-transform cursor-pointer"
                            aria-label={`Adicionar ${product.name}`}
                          >
                            <Plus className="w-4 h-4 stroke-[2.75]" />
                          </button>
                        ) : (
                          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 flex items-center justify-between gap-1 bg-neutral-950 text-white rounded-full p-1 shadow-md border border-neutral-700 min-w-[92px]">
                            <button
                              type="button"
                              onClick={() => removeFromCart(product.id, activeUnit)}
                              className="w-6 h-6 rounded-full bg-neutral-800 hover:bg-neutral-700 text-white flex items-center justify-center cursor-pointer"
                              aria-label="Diminuir quantidade"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="text-xs font-black px-1 text-center">{qty}</span>
                            <button
                              type="button"
                              disabled={!canAddMore}
                              onClick={() => addToCart(product, activeUnit)}
                              className="w-6 h-6 rounded-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-neutral-950 flex items-center justify-center cursor-pointer"
                              aria-label="Aumentar quantidade"
                            >
                              <Plus className="w-3 h-3 stroke-[2.75]" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Floating Bag Bar ("Ver Sacola") positioned above mobile bottom navigation */}
      {totalCartCount > 0 && (
        <div className="fixed bottom-[68px] md:bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4">
          <button
            type="button"
            onClick={() => {
              if (!currentCustomer) {
                setCheckoutEntryStep('choice');
              }
              setIsCartOpen(true);
            }}
            className="w-full flex items-center justify-between bg-neutral-950 text-white p-3.5 sm:p-4 rounded-2xl shadow-2xl hover:bg-neutral-900 transition-all border border-neutral-800 active:scale-98 cursor-pointer"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500 text-neutral-950 flex items-center justify-center font-black text-sm">
                {totalCartCount}
              </div>
              <div className="text-left">
                <span className="text-xs text-neutral-300 block font-bold">Ver Sacola</span>
                <span className="font-bold text-xs sm:text-sm text-white">
                  {cart.length} {cart.length === 1 ? 'item' : 'itens'}
                </span>
                {totalSavings > 0 && (
                  <span className="text-[10px] font-bold text-emerald-400 block">
                    Economia de {formatCurrency(totalSavings)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm sm:text-base font-black text-amber-400">
                {formatCurrency(cartTotal)}
              </span>
              <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5 text-neutral-300" />
            </div>
          </button>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar (Início, Pedidos, Perfil) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-neutral-200 px-4 py-1.5 flex items-center justify-around shadow-lg">
        <button
          type="button"
          onClick={() => {
            setSelectedCategory('todas');
            if (typeof window !== 'undefined') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          className="flex flex-col items-center justify-center gap-0.5 py-1 px-4 text-neutral-800 hover:text-amber-600 cursor-pointer"
        >
          <Home className="w-5 h-5 text-amber-600" />
          <span className="text-[10px] font-black">Início</span>
        </button>

        <button
          type="button"
          onClick={handleOpenMyOrders}
          className="flex flex-col items-center justify-center gap-0.5 py-1 px-4 text-neutral-600 hover:text-amber-600 cursor-pointer"
        >
          <Package className="w-5 h-5" />
          <span className="text-[10px] font-bold">Pedidos</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setAuthModalInitialTab('login');
            setIsAuthModalOpen(true);
          }}
          className="flex flex-col items-center justify-center gap-0.5 py-1 px-4 text-neutral-600 hover:text-amber-600 cursor-pointer"
        >
          <User className="w-5 h-5" />
          <span className="text-[10px] font-bold">
            {currentCustomer ? currentCustomer.name.split(' ')[0] : 'Perfil'}
          </span>
        </button>
      </nav>


      {/* Cart & Checkout Drawer */}
      {isCartOpen && (
        <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col justify-between overflow-y-auto">
            <div className="p-5 border-b border-neutral-200 flex items-center justify-between bg-neutral-50 sticky top-0 z-10">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-amber-500" />
                <h3 className="font-black text-lg text-neutral-900">Finalizar Pedido</h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-700">
                  {totalCartCount} itens
                </span>
              </div>
              <button
                onClick={() => setIsCartOpen(false)}
                className="p-1 hover:bg-neutral-200 rounded-lg text-neutral-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCheckoutSubmit} className="p-6 space-y-6 flex-1">
              {outOfStockNotices.length > 0 && (
                <div className="space-y-2">
                  {outOfStockNotices.map((notice) => (
                    <div
                      key={`cart-${notice}`}
                      className="p-3 bg-amber-50 border border-amber-300 text-amber-900 rounded-xl flex items-center justify-between gap-2 text-xs font-bold"
                    >
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>{notice}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setOutOfStockNotices((prev) => prev.filter((m) => m !== notice))
                        }
                        className="p-0.5 hover:bg-amber-200/60 rounded text-amber-800 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Selected items */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Itens Selecionados
                </h4>
                {cart.map((item) => {
                  const currentProd = products.find((p) => p.id === item.product.id) || item.product;
                  const isCase = item.saleUnit === 'case' && canSellProductCase(currentProd, settings, 'store');
                  const unitsPerSale = isCase ? Number(currentProd.caseSize) : 1;
                  const promoActive = !isCase && isProductPromoActive(currentProd);
                  const effPrice = getCartItemUnitPrice(currentProd, item.saleUnit, item.addonsTotal);
                  const usedUnits = getCartTotalUnitsForProduct(currentProd.id);
                  const canAddMore = usedUnits + unitsPerSale <= currentProd.stock;

                  return (
                    <div
                      key={item.lineId}
                      className="flex items-start justify-between gap-2.5 p-3 bg-neutral-50 rounded-2xl border border-neutral-200"
                    >
                      {currentProd.imageUrl || currentProd.image ? (
                        <img
                          src={currentProd.imageUrl || currentProd.image}
                          alt={currentProd.name}
                          width={44}
                          height={44}
                          loading="lazy"
                          className="w-11 h-11 rounded-xl object-cover shrink-0 mt-0.5"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-xl bg-neutral-200 flex items-center justify-center text-neutral-400 shrink-0 mt-0.5">
                          <Package className="w-5 h-5" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-1.5">
                          <h5 className="font-bold text-xs text-neutral-900 line-clamp-2 break-words leading-snug">
                            {isCase
                              ? `${currentProd.name} — Caixa c/${currentProd.caseSize}`
                              : currentProd.name}
                          </h5>
                          {promoActive && (
                            <span className="px-1.5 py-0.5 bg-red-600 text-white text-[9px] font-black rounded uppercase shrink-0">
                              -{getPromoDiscountPercent(currentProd)}%
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-neutral-500 block mt-0.5">
                          {currentProd.volume} •{' '}
                          {promoActive ? (
                            <>
                              <span className="line-through text-neutral-400 mr-1">
                                {formatCurrency(currentProd.price + (item.addonsTotal || 0))}
                              </span>
                              <strong className="text-red-600">{formatCurrency(effPrice)}</strong>
                            </>
                          ) : (
                            formatCurrency(effPrice)
                          )}
                        </span>
                        {(() => {
                          const comboLines =
                            Array.isArray(item.comboItems) && item.comboItems.length > 0
                              ? item.comboItems
                              : isComboProduct(currentProd.id, settings)
                              ? calculateComboMetrics(currentProd, settings, products).orderComboItems
                              : [];
                          return comboLines.length > 0 ? (
                            <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-amber-400">
                              {comboLines.map((ci, cIdx) => (
                                <div
                                  key={`${ci.productId}-${cIdx}`}
                                  className="text-[11px] font-semibold text-neutral-600 leading-tight"
                                >
                                  {formatOrderItemComboLine(ci)}
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })()}
                        {Array.isArray(item.addons) && item.addons.length > 0 && (
                          <div className="mt-1 space-y-0.5 pl-2 border-l-2 border-amber-400">
                            {item.addons.map((addon, aIdx) => (
                              <div
                                key={`${addon.groupId || addon.groupName}-${addon.optionId || addon.optionName}-${aIdx}`}
                                className="text-[11px] font-semibold text-neutral-600 leading-tight"
                              >
                                {formatOrderItemAddonLine(addon)}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-neutral-200 shrink-0">
                        <button
                          type="button"
                          onClick={() => changeCartLineQuantity(item.lineId, -1)}
                          className="w-6 h-6 flex items-center justify-center text-neutral-600 hover:bg-neutral-100 rounded-lg"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-5 text-center font-black text-xs text-neutral-900">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => changeCartLineQuantity(item.lineId, 1)}
                          disabled={!canAddMore}
                          className="w-6 h-6 flex items-center justify-center text-neutral-600 hover:bg-neutral-100 rounded-lg disabled:opacity-30"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <span className="font-bold text-xs text-neutral-900 shrink-0 text-right min-w-[3.75rem] pt-1">
                        {formatCurrency(effPrice * item.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* PRIMEIRA TELA DO CHECKOUT (Requirement 1): shown when customer is not logged in and hasn't chosen guest checkout yet */}
              {!currentCustomer && checkoutEntryStep === 'choice' ? (
                <div className="space-y-4 pt-2">
                  <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200">
                    <h4 className="font-black text-sm text-neutral-900">
                      Como você prefere finalizar seu pedido?
                    </h4>
                    <p className="text-xs text-neutral-600 mt-0.5">
                      Escolha uma opção abaixo antes de informar seus dados de entrega e pagamento.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthModalInitialTab('login');
                        setIsAuthModalOpen(true);
                      }}
                      className="w-full p-5 rounded-2xl border-2 border-amber-500 bg-amber-50/60 hover:bg-amber-100/70 text-left transition-all flex items-center justify-between gap-4 cursor-pointer shadow-xs group"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="w-11 h-11 rounded-2xl bg-amber-500 text-neutral-950 flex items-center justify-center shrink-0 font-black shadow-xs">
                          <User className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="font-black text-base text-neutral-900 block">
                            Entrar ou criar conta
                          </span>
                          <span className="text-xs text-neutral-600 font-medium block mt-0.5">
                            Seus endereços ficam salvos para a próxima.
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-amber-700 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setCheckoutError('');
                        setCheckoutEntryStep('guest');
                      }}
                      className="w-full p-5 rounded-2xl border-2 border-neutral-300 hover:border-neutral-900 bg-white hover:bg-neutral-50 text-left transition-all flex items-center justify-between gap-4 cursor-pointer shadow-xs group"
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="w-11 h-11 rounded-2xl bg-neutral-900 text-white flex items-center justify-center shrink-0 font-black shadow-xs">
                          <ShoppingBag className="w-5 h-5" />
                        </div>
                        <div>
                          <span className="font-black text-base text-neutral-900 block">
                            Pedido rápido sem cadastro
                          </span>
                          <span className="text-xs text-neutral-600 font-medium block mt-0.5">
                            Só nome, WhatsApp, endereço e pagamento.
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="w-5 h-5 text-neutral-700 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* When in Guest Checkout mode, allow switching to Login / Create Account keeping typed fields */}
                  {!currentCustomer && (
                    <div className="p-3 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-between gap-2 text-xs">
                      <span className="text-neutral-700 font-semibold">
                        Modo: <strong>Pedido rápido sem cadastro</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthModalInitialTab('cadastro');
                          setIsAuthModalOpen(true);
                        }}
                        className="text-amber-700 hover:text-amber-900 font-black underline cursor-pointer shrink-0"
                      >
                        Entrar ou criar conta
                      </button>
                    </div>
                  )}

                  {/* Delivery or Pickup */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2">
                      Forma de Recebimento
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setDeliveryType('delivery')}
                        className={`p-3 rounded-2xl border text-center transition-all ${
                          deliveryType === 'delivery'
                            ? 'border-amber-500 bg-amber-50/50 text-amber-900 font-bold'
                            : 'border-neutral-200 text-neutral-600'
                        }`}
                      >
                        <Truck className="w-5 h-5 mx-auto mb-1 text-amber-600" />
                        <span className="text-xs block">Entrega Delivery</span>
                        <span className="text-[10px] text-neutral-500">
                          {deliveryFee === 0 ? 'Frete Grátis' : formatCurrency(deliveryFee)}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setDeliveryType('retirada')}
                        className={`p-3 rounded-2xl border text-center transition-all ${
                          deliveryType === 'retirada'
                            ? 'border-amber-500 bg-amber-50/50 text-amber-900 font-bold'
                            : 'border-neutral-200 text-neutral-600'
                        }`}
                      >
                        <MapPin className="w-5 h-5 mx-auto mb-1 text-amber-600" />
                        <span className="text-xs block">Retirar no Depósito</span>
                        <span className="text-[10px] text-emerald-600 font-bold">Sem taxa</span>
                      </button>
                    </div>
                  </div>

                  {/* Customer data & Address */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                        Seus Dados para o Pedido
                      </h4>
                      {currentCustomer && (
                        <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-semibold">
                          ✓ Conta Conectada
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Seu Nome *</label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: Carlos Eduardo"
                          value={customerName}
                          onChange={(e) => setCustomerName(e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-neutral-600 block mb-1">WhatsApp / Celular *</label>
                        <input
                          type="tel"
                          required
                          placeholder="(11) 98888-7777"
                          value={customerPhone}
                          onChange={(e) => setCustomerPhone(e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                        />
                      </div>
                    </div>

                    {/* Logged-in customer: "Entregar em:" selector */}
                    {currentCustomer && deliveryType === 'delivery' && (
                      <div className="space-y-2.5 pt-1">
                        <label className="text-xs font-black text-neutral-800 block">
                          Entregar em:
                        </label>

                        {currentCustomer.address ? (
                          <div className="space-y-2">
                            <button
                              type="button"
                              onClick={() => {
                                setLoggedAddressMode('saved');
                                setSaveCustomAddressToAccount(false);
                                applySavedCustomerAddressToState(currentCustomer);
                              }}
                              className={`w-full p-3.5 rounded-2xl border-2 text-left transition-all flex items-start gap-3 cursor-pointer ${
                                loggedAddressMode === 'saved'
                                  ? 'border-amber-500 bg-amber-50/60'
                                  : 'border-neutral-200 bg-white hover:border-neutral-300'
                              }`}
                            >
                              <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                                  loggedAddressMode === 'saved'
                                    ? 'bg-amber-500 text-neutral-950'
                                    : 'bg-neutral-100 text-neutral-600'
                                }`}
                              >
                                <Home className="w-4 h-4" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-black text-xs text-neutral-900">Casa</span>
                                  {loggedAddressMode === 'saved' && (
                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-950">
                                      Selecionado
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-neutral-700 font-medium mt-0.5 break-words">
                                  {currentCustomer.address}, {currentCustomer.number}
                                  {savedCustomerMatchedArea
                                    ? ` — ${savedCustomerMatchedArea.name}`
                                    : currentCustomer.neighborhood
                                    ? ` — ${currentCustomer.neighborhood}`
                                    : ''}
                                </p>
                                {(currentCustomer.complement || currentCustomer.reference) && (
                                  <p className="text-[11px] text-neutral-500 mt-0.5">
                                    {[currentCustomer.complement, currentCustomer.reference]
                                      .filter(Boolean)
                                      .join(' • ')}
                                  </p>
                                )}
                              </div>
                            </button>

                            {/* 1d) Se um cliente antigo tiver um bairro salvo que não bate com nenhum bairro ativo, no checkout mostre "Escolha seu bairro na lista" com o <select> em branco e não deixe finalizar entrega sem escolher */}
                            {loggedAddressMode === 'saved' && !savedCustomerMatchedArea && (
                              <div className="p-3.5 bg-amber-50 border-2 border-amber-400 rounded-2xl space-y-2">
                                <label className="text-xs font-black text-amber-950 block">
                                  Escolha seu bairro na lista *
                                </label>
                                <select
                                  value={selectedDeliveryAreaId}
                                  onChange={(e) => {
                                    const nextId = e.target.value;
                                    setSelectedDeliveryAreaId(nextId);
                                    const found = activeAreas.find((a) => a.id === nextId);
                                    setNeighborhood(found ? found.name : '');
                                    setCheckoutError('');
                                  }}
                                  className="w-full px-3 py-2.5 bg-white border border-amber-400 rounded-xl text-xs font-bold text-neutral-900 outline-none"
                                  required
                                >
                                  <option value="">Escolha seu bairro na lista</option>
                                  {activeAreas.map((area) => (
                                    <option key={area.id} value={area.id}>
                                      {formatDeliveryAreaOptionLabel(area)}
                                    </option>
                                  ))}
                                </select>
                                <p className="text-[11px] text-neutral-600 leading-relaxed">
                                  Seu bairro não está na lista? No momento não entregamos aí — você pode escolher{' '}
                                  <button
                                    type="button"
                                    onClick={() => setDeliveryType('retirada')}
                                    className="font-bold text-amber-900 underline cursor-pointer"
                                  >
                                    Retirada na loja
                                  </button>{' '}
                                  ou{' '}
                                  {(() => {
                                    const wDigits = (settings.whatsapp || '').replace(/\D/g, '');
                                    const wUrl = wDigits
                                      ? `https://wa.me/${wDigits.startsWith('55') ? wDigits : `55${wDigits}`}`
                                      : null;
                                    return wUrl ? (
                                      <a
                                        href={wUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="font-bold text-emerald-700 hover:text-emerald-800 underline"
                                      >
                                        falar com a gente no WhatsApp
                                      </a>
                                    ) : (
                                      <strong>falar com a gente no WhatsApp</strong>
                                    );
                                  })()}
                                  .
                                </p>
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setLoggedAddressMode('custom');
                                setSaveCustomAddressToAccount(false);
                                setDeliveryQuote(null);
                                setCepNotice('');
                                setCep('');
                                setAddress('');
                                setAddressNumber('');
                                setSelectedDeliveryAreaId('');
                                setNeighborhood('');
                                setComplement('');
                                setReference('');
                              }}
                              className={`w-full p-3.5 rounded-2xl border-2 text-left transition-all flex items-center gap-3 cursor-pointer ${
                                loggedAddressMode === 'custom'
                                  ? 'border-amber-500 bg-amber-50/60'
                                  : 'border-neutral-200 bg-white hover:border-neutral-300'
                              }`}
                            >
                              <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                  loggedAddressMode === 'custom'
                                    ? 'bg-amber-500 text-neutral-950'
                                    : 'bg-neutral-100 text-neutral-600'
                                }`}
                              >
                                <MapPin className="w-4 h-4" />
                              </div>
                              <div className="flex-1">
                                <span className="font-black text-xs text-neutral-900 block">
                                  Outro endereço (só neste pedido)
                                </span>
                                <span className="text-[11px] text-neutral-500 block">
                                  Informe outro endereço de entrega para este pedido
                                </span>
                              </div>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* Address Form Fields: shown for Guest Delivery OR Logged-in with "Outro endereço" (or if logged-in customer has no saved address yet) */}
                    {deliveryType === 'delivery' &&
                      (!currentCustomer ||
                        loggedAddressMode === 'custom' ||
                        !currentCustomer.address) && (
                        <div className="space-y-3 pt-1">
                          {/* CEP (opcional) */}
                          <div className="p-3.5 bg-amber-50/80 border border-amber-300 rounded-2xl space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                                <Building2 className="w-3.5 h-3.5 text-amber-600" />
                                <span>CEP (opcional)</span>
                              </label>
                              <span className="text-[10px] text-amber-800 font-bold bg-amber-200/60 px-2 py-0.5 rounded">
                                Preenche a rua
                              </span>
                            </div>

                            <div className="flex gap-2">
                              <input
                                type="text"
                                maxLength={9}
                                placeholder="Digite seu CEP (ex: 01310-100)"
                                value={cep}
                                onChange={(e) => {
                                  let val = e.target.value.replace(/\D/g, '');
                                  if (val.length > 8) val = val.slice(0, 8);
                                  let f = val;
                                  if (val.length > 5) f = `${val.slice(0, 5)}-${val.slice(5)}`;
                                  setCep(f);
                                  if (val.length === 8) handleSearchCheckoutCep(val);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSearchCheckoutCep();
                                  }
                                }}
                                className="w-full px-3 py-2 bg-white border border-amber-300 rounded-xl font-mono font-bold text-xs outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => handleSearchCheckoutCep()}
                                disabled={isSearchingCep}
                                className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-neutral-950 font-black rounded-xl text-xs flex items-center gap-1 shrink-0 cursor-pointer"
                              >
                                {isSearchingCep ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Search className="w-3.5 h-3.5" />
                                )}
                                <span>Buscar</span>
                              </button>
                            </div>

                            {cepNotice && (
                              <p className="text-[11px] font-bold text-amber-950 bg-amber-100/90 p-2 rounded-xl">
                                {cepNotice}
                              </p>
                            )}
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2">
                              <label className="text-[11px] font-semibold text-neutral-600 block mb-1">
                                Rua / Avenida *
                              </label>
                              <input
                                type="text"
                                required
                                maxLength={120}
                                placeholder="Ex: Rua das Palmeiras"
                                value={address}
                                onChange={(e) => setAddress(e.target.value)}
                                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Número *</label>
                              <input
                                type="text"
                                required
                                maxLength={20}
                                placeholder="123"
                                value={addressNumber}
                                onChange={(e) => setAddressNumber(e.target.value)}
                                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[11px] font-semibold text-neutral-600 block mb-1">
                                Complemento / Apto
                              </label>
                              <input
                                type="text"
                                maxLength={80}
                                placeholder="Apto 42B"
                                value={complement}
                                onChange={(e) => setComplement(e.target.value)}
                                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                              />
                            </div>
                            <div>
                              <label className="text-[11px] font-semibold text-neutral-600 block mb-1">
                                Ponto de referência
                              </label>
                              <input
                                type="text"
                                maxLength={120}
                                placeholder="Ex: Portão cinza"
                                value={reference}
                                onChange={(e) => setReference(e.target.value)}
                                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                              />
                            </div>
                          </div>

                          {/* BAIRRO SELECT (1b & 1c) */}
                          <div>
                            <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                              Bairro *
                            </label>
                            <select
                              value={selectedDeliveryAreaId}
                              onChange={(e) => {
                                const nextId = e.target.value;
                                setSelectedDeliveryAreaId(nextId);
                                const found = activeAreas.find((a) => a.id === nextId);
                                setNeighborhood(found ? found.name : '');
                                setCheckoutError('');
                              }}
                              className="w-full px-3 py-2.5 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-900"
                              required
                            >
                              <option value="">Escolha seu bairro na lista</option>
                              {activeAreas.map((area) => (
                                <option key={area.id} value={area.id}>
                                  {formatDeliveryAreaOptionLabel(area)}
                                </option>
                              ))}
                            </select>

                            <p className="text-[11px] text-neutral-600 mt-1.5 leading-relaxed">
                              Seu bairro não está na lista? No momento não entregamos aí — você pode escolher{' '}
                              <button
                                type="button"
                                onClick={() => setDeliveryType('retirada')}
                                className="font-bold text-amber-900 underline cursor-pointer"
                              >
                                Retirada na loja
                              </button>{' '}
                              ou{' '}
                              {(() => {
                                const wDigits = (settings.whatsapp || '').replace(/\D/g, '');
                                const wUrl = wDigits
                                  ? `https://wa.me/${wDigits.startsWith('55') ? wDigits : `55${wDigits}`}`
                                  : null;
                                return wUrl ? (
                                  <a
                                    href={wUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold text-emerald-700 hover:text-emerald-800 underline"
                                  >
                                    falar com a gente no WhatsApp
                                  </a>
                                ) : (
                                  <strong>falar com a gente no WhatsApp</strong>
                                );
                              })()}
                              .
                            </p>
                          </div>

                          {/* Checkbox "Salvar este endereço na minha conta" (unchecked by default) when logged-in customer chooses "Outro endereço" */}
                          {currentCustomer &&
                            (loggedAddressMode === 'custom' || !currentCustomer.address) && (
                              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-50/70 border border-amber-200 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={saveCustomAddressToAccount}
                                  onChange={(e) => setSaveCustomAddressToAccount(e.target.checked)}
                                  className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                                />
                                <span className="text-xs font-bold text-neutral-800">
                                  Salvar este endereço na minha conta
                                </span>
                              </label>
                            )}
                        </div>
                      )}
                  </div>

                  {/* Payment Method */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                      Forma de Pagamento
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('pix')}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentMethod === 'pix'
                            ? 'border-amber-500 bg-amber-50 text-amber-900'
                            : 'border-neutral-200 text-neutral-700'
                        }`}
                      >
                        PIX (pagar agora)
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cartao_credito')}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentMethod === 'cartao_credito'
                            ? 'border-amber-500 bg-amber-50 text-amber-900'
                            : 'border-neutral-200 text-neutral-700'
                        }`}
                      >
                        {deliveryType === 'retirada'
                          ? 'Cartão de crédito (na retirada)'
                          : 'Cartão de crédito (na entrega)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cartao_debito')}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentMethod === 'cartao_debito'
                            ? 'border-amber-500 bg-amber-50 text-amber-900'
                            : 'border-neutral-200 text-neutral-700'
                        }`}
                      >
                        {deliveryType === 'retirada'
                          ? 'Cartão de débito (na retirada)'
                          : 'Cartão de débito (na entrega)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('dinheiro')}
                        className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                          paymentMethod === 'dinheiro'
                            ? 'border-amber-500 bg-amber-50 text-amber-900'
                            : 'border-neutral-200 text-neutral-700'
                        }`}
                      >
                        {deliveryType === 'retirada' ? 'Dinheiro (na retirada)' : 'Dinheiro (na entrega)'}
                      </button>
                    </div>

                    {paymentMethod === 'dinheiro' && (
                      <div className="mt-2 bg-neutral-50 p-3 rounded-xl border border-neutral-200 space-y-1">
                        <label className="text-[11px] font-semibold text-neutral-700 block">
                          Precisa de troco para quanto?
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Ex: 50 ou 100"
                          value={cashChangeFor}
                          onChange={(e) => setCashChangeFor(e.target.value)}
                          className={`w-full px-3 py-2 bg-white border rounded-lg text-xs ${
                            isCheckoutCashInvalid ? 'border-red-400' : 'border-neutral-300'
                          }`}
                        />
                        {isCheckoutCashInvalid && (
                          <p className="text-[11px] font-bold text-red-600">
                            O valor do troco precisa ser maior que o total do pedido
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-neutral-600 block mb-1">
                      Observações para o depósito (opcional)
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Ex: Mandar as latinhas bem geladas!"
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                    />
                  </div>

                  {/* Cupom de Desconto — EXCLUSIVO para clientes com conta (escondido no pedido rápido sem cadastro) */}
                  {currentCustomer && (
                    <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-neutral-800 flex items-center gap-1.5">
                          <Ticket className="w-4 h-4 text-amber-600" />
                          <span>Cupom de Desconto</span>
                        </label>
                        {appliedCoupon && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                            ✓ Ativo
                          </span>
                        )}
                      </div>

                      {appliedCoupon ? (
                        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 p-2.5 rounded-xl">
                          <div>
                            <span className="font-black text-emerald-950 font-mono tracking-wider">
                              {appliedCoupon.code}
                            </span>
                            <span className="text-emerald-700 ml-2 font-semibold">
                              (-{formatCurrency(cartDiscount)}
                              {appliedCoupon.type === 'percent' && appliedCoupon.maxDiscount
                                ? ` • ${appliedCoupon.value}% até ${formatCurrency(appliedCoupon.maxDiscount)}`
                                : appliedCoupon.type === 'percent'
                                ? ` • ${appliedCoupon.value}% OFF`
                                : ''}
                              )
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleRemoveCoupon}
                            className="text-[11px] text-red-600 hover:text-red-800 font-bold underline cursor-pointer"
                          >
                            Remover
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="Ex: PROMO10"
                              value={couponInput}
                              onChange={(e) => {
                                setCouponInput(e.target.value.toUpperCase());
                                if (couponError) setCouponError('');
                              }}
                              className="flex-1 px-3 py-2 bg-white border border-neutral-300 rounded-xl font-mono font-bold uppercase text-xs outline-amber-500"
                            />
                            <button
                              type="button"
                              onClick={handleApplyCoupon}
                              disabled={isValidatingCoupon || !couponInput.trim()}
                              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-neutral-950 font-black rounded-xl text-xs transition-colors cursor-pointer"
                            >
                              {isValidatingCoupon ? 'Validando...' : 'Aplicar'}
                            </button>
                          </div>
                          {couponError && (
                            <p className="text-[11px] font-bold text-red-600 bg-red-50 p-2 rounded-xl border border-red-200">
                              {couponError}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Total summary */}
                  <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-2 text-xs">
                    <div className="flex justify-between text-neutral-600">
                      <span>Subtotal:</span>
                      <span>{formatCurrency(cartSubtotal)}</span>
                    </div>
                    {cartPromoSavings > 0 && (
                      <div className="flex justify-between text-emerald-600 font-bold">
                        <span>Economia nas Promoções:</span>
                        <span>-{formatCurrency(cartPromoSavings)}</span>
                      </div>
                    )}
                    {cartDiscount > 0 && (
                      <div className="flex justify-between text-emerald-600 font-bold">
                        <span>Desconto do Cupom ({appliedCoupon?.code}):</span>
                        <span>-{formatCurrency(cartDiscount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-neutral-600">
                      <span>
                        Taxa de Entrega
                        {deliveryType === 'delivery' && matchedArea ? ` (${matchedArea.name})` : ''}:
                      </span>
                      <span>
                        {deliveryType === 'retirada'
                          ? 'Sem taxa'
                          : !matchedArea
                          ? 'Escolha o bairro'
                          : deliveryFee === 0
                          ? 'Grátis'
                          : formatCurrency(deliveryFee)}
                      </span>
                    </div>
                    <div className="flex justify-between text-base font-black text-neutral-900 pt-2 border-t border-neutral-200">
                      <span>Total Final:</span>
                      <span className="text-amber-600">{formatCurrency(cartTotal)}</span>
                    </div>
                    {totalSavings > 0 && (
                      <div className="mt-2 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-black text-xs text-center">
                        🎉 Você economizou {formatCurrency(totalSavings)}
                      </div>
                    )}
                  </div>

                  {isSubmitting && submittingStatusText && (
                    <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-amber-900 text-xs font-bold flex items-center gap-2">
                      <Loader2 className="w-4 h-4 shrink-0 text-amber-600 animate-spin" />
                      <span>{submittingStatusText}</span>
                    </div>
                  )}

                  {checkoutError && (
                    <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-bold space-y-2.5">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                        <span>{checkoutError}</span>
                      </div>
                      {canRetryOrderSubmit && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => submitCustomerOrder()}
                          className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-black text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          <span>Tentar de novo</span>
                        </button>
                      )}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      cart.length === 0 ||
                      !isAreaCovered ||
                      !settings.isOpen ||
                      isCheckoutCashInvalid
                    }
                    className="w-full py-4 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-black text-base rounded-2xl shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {!settings.isOpen ? (
                      <span>🔴 Depósito Fechado no Momento</span>
                    ) : isSubmitting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span>{submittingStatusText || 'Enviando pedido...'}</span>
                      </>
                    ) : (
                      <>
                        <span>Confirmar e Enviar Pedido</span>
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Customer Orders ("Meus pedidos") Modal */}
      {isMyOrdersOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden border border-neutral-200 my-6">
            <div className="p-5 bg-neutral-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-500" />
                <h3 className="font-black text-base">Meus Pedidos</h3>
              </div>
              <button
                onClick={() => setIsMyOrdersOpen(false)}
                className="p-1 hover:bg-neutral-800 rounded-lg text-neutral-400 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 max-h-[70vh] overflow-y-auto space-y-3">
              {isLoadingMyOrders ? (
                <div className="py-10 text-center text-neutral-500 text-xs flex flex-col items-center gap-2">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-500" />
                  <span>Carregando seus pedidos...</span>
                </div>
              ) : myOrdersError ? (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-bold">
                  {myOrdersError}
                </div>
              ) : myOrders.length === 0 ? (
                <div className="py-10 text-center text-neutral-500 text-xs">
                  <p className="font-bold text-neutral-800 text-sm mb-1">Você ainda não fez nenhum pedido</p>
                  <p>Escolha suas bebidas favoritas na loja e faça seu primeiro pedido!</p>
                </div>
              ) : (
                myOrders.map((ord) => {
                  const stBadge = getStatusBadgeInfo(ord.status, ord.deliveryType);
                  return (
                    <button
                      key={ord.id}
                      type="button"
                      onClick={() => {
                        setIsMyOrdersOpen(false);
                        setPlacedOrder(ord);
                      }}
                      className="w-full text-left p-4 rounded-2xl border border-neutral-200 hover:border-amber-400 hover:bg-amber-50/40 transition-all flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-sm text-neutral-900">#{ord.id}</span>
                          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${stBadge.className}`}>
                            {stBadge.label}
                          </span>
                        </div>
                        <p className="text-xs text-neutral-500">
                          {new Date(ord.createdAt).toLocaleString('pt-BR')}
                        </p>
                        <div className="space-y-1 pt-0.5">
                          {ord.items.map((i, idx) => (
                            <div key={idx} className="text-xs text-neutral-700">
                              <span className="font-semibold">
                                {i.saleUnit === 'case' && (i.unitsPerSale || 1) > 1
                                  ? `${i.quantity} cx ${i.name} (c/${i.unitsPerSale})`
                                  : `${i.quantity}x ${i.name}`}
                              </span>
                              {Array.isArray(i.comboItems) && i.comboItems.length > 0 && (
                                <div className="pl-2.5 text-[11px] text-neutral-500">
                                  {i.comboItems.map((ci, cIdx) => (
                                    <div key={cIdx}>{formatOrderItemComboLine(ci)}</div>
                                  ))}
                                </div>
                              )}
                              {Array.isArray(i.addons) && i.addons.length > 0 && (
                                <div className="pl-2.5 text-[11px] text-neutral-500">
                                  {i.addons.map((a, aIdx) => (
                                    <div key={aIdx}>{formatOrderItemAddonLine(a)}</div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-black text-sm text-amber-600">{formatCurrency(ord.total)}</p>
                        <span className="text-[11px] font-bold text-neutral-500 flex items-center justify-end gap-1 mt-0.5">
                          <span>Acompanhar</span>
                          <ArrowRight className="w-3 h-3" />
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Product Addons Selection Modal / Mobile Drawer */}
      {addonModalState && (
        <ProductAddonsModal
          product={addonModalState.product}
          initialSaleUnit={addonModalState.saleUnit}
          addonGroups={getProductAddonGroups(addonModalState.product, settings)}
          availableStockUnits={Math.max(
            0,
            addonModalState.product.stock - getCartTotalUnitsForProduct(addonModalState.product.id)
          )}
          onClose={() => setAddonModalState(null)}
          onConfirm={({ product, saleUnit, quantity, addons, addonsTotal }) => {
            appendCartLine(product, saleUnit, quantity, addons, addonsTotal);
            setAddonModalState(null);
          }}
        />
      )}

      {/* Customer Auth / Register Modal */}
      <CustomerAuthModal
        isOpen={isAuthModalOpen}
        deliveryAreas={deliveryAreas}
        currentCustomer={currentCustomer}
        settings={settings}
        initialTab={authModalInitialTab}
        initialRegisterData={{
          name: customerName,
          phone: customerPhone,
          cep,
          address,
          number: addressNumber,
          neighborhood,
          deliveryAreaId: selectedDeliveryAreaId || undefined,
          city: checkoutCity,
          state: checkoutState,
          complement,
          reference,
        }}
        onSuccess={(cust) => {
          setCurrentCustomer(cust);
          setIsAuthModalOpen(false);
        }}
        onClose={() => setIsAuthModalOpen(false)}
        onLogout={() => {
          setCurrentCustomer(null);
          setCheckoutEntryStep('choice');
          setAppliedCoupon(null);
          setMyOrders([]);
        }}
      />
    </div>
  );
};
