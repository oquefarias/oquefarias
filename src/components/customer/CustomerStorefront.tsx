import React, { useState, useMemo, useEffect } from 'react';
import confetti from 'canvas-confetti';
import { Product, StoreSettings, ProductCategory, Order, PaymentMethod, DeliveryArea, CustomerProfile } from '../../types';
import { api } from '../../services/api';
import { CustomerAuthModal } from './CustomerAuthModal';
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
  Compass,
  Building2,
  Loader2,
} from 'lucide-react';
import {
  calculateDistanceKm,
  geocodeAddress,
  resolveAddressOrCep,
  fetchAddressByCep,
  fetchCoordinatesByCepBrasilApi,
} from '../../utils/geo';

interface CustomerStorefrontProps {
  products: Product[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
}

interface CartItem {
  product: Product;
  quantity: number;
}

export const CustomerStorefront: React.FC<CustomerStorefrontProps> = ({ products, settings, deliveryAreas }) => {
  const [selectedCategory, setSelectedCategory] = useState<ProductCategory | 'todas'>('todas');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyCold, setOnlyCold] = useState<boolean>(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState<boolean>(false);

  // Customer Account state
  const [currentCustomer, setCurrentCustomer] = useState<CustomerProfile | null>(() => api.getCurrentCustomer());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  
  // Checkout form state
  const [deliveryType, setDeliveryType] = useState<'delivery' | 'retirada'>('delivery');
  const [customerName, setCustomerName] = useState<string>(currentCustomer?.name || '');
  const [customerPhone, setCustomerPhone] = useState<string>(currentCustomer?.phone || '');
  const [cep, setCep] = useState<string>(currentCustomer?.cep || '');
  const [isSearchingCep, setIsSearchingCep] = useState<boolean>(false);
  const [cepNotice, setCepNotice] = useState<string>('');
  const [address, setAddress] = useState<string>(currentCustomer?.address || '');
  const [addressNumber, setAddressNumber] = useState<string>(currentCustomer?.number || '');
  const [neighborhood, setNeighborhood] = useState<string>(currentCustomer?.neighborhood || (deliveryAreas[0]?.name || ''));
  const [complement, setComplement] = useState<string>(currentCustomer?.complement || '');
  const [reference, setReference] = useState<string>(currentCustomer?.reference || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [cashChangeFor, setCashChangeFor] = useState<string>('');
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [placedOrder, setPlacedOrder] = useState<Order | null>(null);
  const [copiedPix, setCopiedPix] = useState<boolean>(false);
  const [checkingDistance, setCheckingDistance] = useState<boolean>(false);
  const [customerDistance, setCustomerDistance] = useState<{ km: number; inside: boolean } | null>(null);

  // Keep fields synced when currentCustomer changes
  useEffect(() => {
    if (currentCustomer) {
      setCustomerName(currentCustomer.name);
      setCustomerPhone(currentCustomer.phone);
      if (currentCustomer.cep) setCep(currentCustomer.cep);
      setAddress(currentCustomer.address);
      setAddressNumber(currentCustomer.number);
      if (currentCustomer.neighborhood) setNeighborhood(currentCustomer.neighborhood);
      if (currentCustomer.complement) setComplement(currentCustomer.complement);
      if (currentCustomer.reference) setReference(currentCustomer.reference);
      if (currentCustomer.distanceKm !== undefined && currentCustomer.isWithinDeliveryRadius !== undefined) {
        setCustomerDistance({
          km: currentCustomer.distanceKm,
          inside: currentCustomer.isWithinDeliveryRadius,
        });
      }
    }
  }, [currentCustomer]);

  // Handle CEP search in checkout
  const handleSearchCheckoutCep = async (cleanCepArg?: string) => {
    const rawDigits = (cleanCepArg || cep).replace(/\D/g, '');
    if (rawDigits.length !== 8) {
      setCepNotice('Digite um CEP válido com 8 dígitos.');
      return;
    }
    setIsSearchingCep(true);
    setCepNotice('');
    try {
      const viaCep = await fetchAddressByCep(rawDigits);
      const brasilApi = await fetchCoordinatesByCepBrasilApi(rawDigits);

      if (!viaCep && !brasilApi) {
        setCepNotice('CEP não encontrado. Digite a rua manualmente.');
        return;
      }

      const street = viaCep?.logradouro || brasilApi?.street || '';
      const nh = viaCep?.bairro || brasilApi?.neighborhood || '';
      if (street) setAddress(street);
      if (nh) setNeighborhood(nh);

      let lat = brasilApi?.lat;
      let lng = brasilApi?.lng;
      if ((lat === undefined || lng === undefined) && street) {
        const geo = await geocodeAddress(`${street} ${nh} ${viaCep?.localidade || ''} Brasil`);
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
        }
      }

      if (lat !== undefined && lng !== undefined && settings.storeLatitude && settings.storeLongitude) {
        const d = calculateDistanceKm(settings.storeLatitude, settings.storeLongitude, lat, lng);
        const maxRadius = settings.deliveryRadiusKm || 5;
        const inside = d <= maxRadius;
        setCustomerDistance({ km: d, inside });
        setCepNotice(
          inside
            ? `✓ CEP localizado! Distância: ${d} km (Dentro do raio de entrega de ${maxRadius} km).`
            : `⚠️ CEP a ${d} km do depósito (Fora do raio de entrega de ${maxRadius} km).`
        );
      } else {
        setCepNotice('Rua e bairro preenchidos pelo CEP!');
      }
    } catch {
      setCepNotice('Erro ao buscar o CEP.');
    } finally {
      setIsSearchingCep(false);
    }
  };

  // Active delivery areas
  const activeAreas = useMemo(() => deliveryAreas.filter(a => a.active), [deliveryAreas]);

  // Check if chosen neighborhood is covered by delivery
  const matchedArea = useMemo(() => {
    return activeAreas.find(a => a.name.toLowerCase().trim() === neighborhood.toLowerCase().trim());
  }, [activeAreas, neighborhood]);

  const handleCheckDistance = async () => {
    if (!address.trim()) {
      alert('Por favor, digite a rua do seu endereço para verificar.');
      return;
    }
    setCheckingDistance(true);
    try {
      const fullQuery = `${address}${addressNumber ? `, ${addressNumber}` : ''}${neighborhood ? `, ${neighborhood}` : ''}, Brasil`;
      const res = await resolveAddressOrCep(fullQuery);
      if (res && settings.storeLatitude && settings.storeLongitude) {
        const d = calculateDistanceKm(settings.storeLatitude, settings.storeLongitude, res.lat, res.lng);
        const maxRadius = settings.deliveryRadiusKm || 5;
        setCustomerDistance({ km: d, inside: d <= maxRadius });
      } else {
        alert('Endereço não localizado com precisão. Verifique a rua, número ou CEP digitados.');
      }
    } catch {
      alert('Não foi possível verificar a distância no momento.');
    } finally {
      setCheckingDistance(false);
    }
  };

  const isAreaCovered = useMemo(() => {
    if (deliveryType === 'retirada') return true;
    if (customerDistance && !customerDistance.inside) {
      return false;
    }
    if (matchedArea) return true;
    if (settings.deliveryModel === 'radius' || (settings.deliveryRadiusKm && activeAreas.length === 0)) {
      return true;
    }
    if (activeAreas.length === 0) return true;
    return !!matchedArea;
  }, [deliveryType, activeAreas.length, matchedArea, customerDistance, settings.deliveryModel, settings.deliveryRadiusKm]);

  // Filter products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.active) return false;
      if (selectedCategory !== 'todas' && p.category !== selectedCategory) return false;
      if (onlyCold && !p.isCold) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          p.name.toLowerCase().includes(query) ||
          p.volume.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [products, selectedCategory, onlyCold, searchQuery]);

  // Cart math
  const cartSubtotal = useMemo(() => {
    return cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  }, [cart]);

  const deliveryFee = useMemo(() => {
    if (deliveryType === 'retirada') return 0;
    if (settings.freeDeliveryThreshold > 0 && cartSubtotal >= settings.freeDeliveryThreshold) {
      return 0;
    }
    if (matchedArea) {
      return matchedArea.fee;
    }
    let fee = settings.deliveryFee || 5.0;
    if (customerDistance && settings.pricePerKm && settings.pricePerKm > 0) {
      const extraKm = Math.max(0, customerDistance.km - 1);
      fee += extraKm * settings.pricePerKm;
    }
    return Math.round(fee * 100) / 100;
  }, [deliveryType, cartSubtotal, settings, matchedArea, customerDistance]);

  const cartTotal = cartSubtotal + deliveryFee;
  const totalCartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        if (existing.quantity >= product.stock) return prev;
        return prev.map((i) =>
          i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.product.id === productId);
      if (!existing) return prev;
      if (existing.quantity <= 1) {
        return prev.filter((i) => i.product.id !== productId);
      }
      return prev.map((i) =>
        i.product.id === productId ? { ...i, quantity: i.quantity - 1 } : i
      );
    });
  };

  const getCartQuantity = (productId: string) => {
    const item = cart.find((i) => i.product.id === productId);
    return item ? item.quantity : 0;
  };

  const formatCurrency = (val: number) => {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  // Submit order to depot
  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings.isOpen) {
      alert(settings.closedMessage || 'Desculpe, o depósito está fechado no momento para novos pedidos.');
      return;
    }
    if (cart.length === 0) return;
    if (!customerName.trim() || !customerPhone.trim()) {
      alert('Por favor preencha seu nome e telefone.');
      return;
    }

    if (deliveryType === 'delivery') {
      if (!address.trim() || !addressNumber.trim() || !neighborhood.trim()) {
        alert('Por favor preencha o endereço completo de entrega.');
        return;
      }
      if (!isAreaCovered) {
        alert(`Desculpe! O bairro "${neighborhood}" não está na nossa área de entrega atendida.`);
        return;
      }
    }

    if (cartSubtotal < settings.minOrderValue) {
      alert(`O pedido mínimo para entrega é de ${formatCurrency(settings.minOrderValue)}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const order = await api.createOrder({
        source: 'online',
        customer: {
          name: customerName,
          phone: customerPhone,
          cep: deliveryType === 'delivery' ? cep : undefined,
          address: deliveryType === 'delivery' ? address : 'Retirada no Depósito',
          number: deliveryType === 'delivery' ? addressNumber : 'S/N',
          neighborhood: deliveryType === 'delivery' ? neighborhood : 'Depósito',
          complement,
          reference,
          distanceKm: customerDistance?.km,
          isWithinDeliveryRadius: customerDistance?.inside,
        },
        deliveryType,
        items: cart.map((i) => ({
          productId: i.product.id,
          name: i.product.name,
          volume: i.product.volume,
          price: i.product.price,
          costPrice: i.product.costPrice,
          quantity: i.quantity,
          isCold: i.product.isCold,
        })),
        subtotal: cartSubtotal,
        deliveryFee,
        total: cartTotal,
        paymentMethod,
        cashChangeFor: paymentMethod === 'dinheiro' && cashChangeFor ? parseFloat(cashChangeFor) : undefined,
        notes: orderNotes,
      });

      // Save customer profile permanently
      const updatedProfile = await api.saveCustomerProfile({
        name: customerName,
        phone: customerPhone,
        cep: deliveryType === 'delivery' ? cep : (currentCustomer?.cep || ''),
        address: deliveryType === 'delivery' ? address : (currentCustomer?.address || ''),
        number: deliveryType === 'delivery' ? addressNumber : (currentCustomer?.number || ''),
        neighborhood: deliveryType === 'delivery' ? neighborhood : (currentCustomer?.neighborhood || ''),
        complement,
        reference,
        distanceKm: customerDistance?.km,
        isWithinDeliveryRadius: customerDistance?.inside,
      });
      setCurrentCustomer(updatedProfile);

      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });

      setPlacedOrder(order);
      setCart([]);
      setIsCartOpen(false);
    } catch (err: any) {
      console.error('Falha ao processar pedido:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyPix = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(settings.pixKey);
      setCopiedPix(true);
      setTimeout(() => setCopiedPix(false), 2500);
    }
  };

  const categories = [
    { id: 'todas', label: 'Todas as Bebidas', icon: Sparkles },
    { id: 'cervejas', label: 'Cervejas', icon: Beer },
    { id: 'destilados', label: 'Destilados & Drinks', icon: Wine },
    { id: 'nao_alcoolicos', label: 'Refrigerantes & Sucos', icon: Coffee },
    { id: 'vinhos', label: 'Vinhos & Espumantes', icon: Wine },
    { id: 'gelo_carvao', label: 'Gelo & Carvão', icon: Flame },
    { id: 'petiscos', label: 'Petiscos & Copos', icon: Package },
  ];

  // ORDER TRACKING SCREEN IF ORDER PLACED
  if (placedOrder) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="bg-white rounded-3xl shadow-xl border border-amber-200 overflow-hidden">
          <div className="bg-radial from-amber-500 to-amber-600 text-white p-6 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-xs">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl font-black">Pedido Recebido com Sucesso!</h2>
            <p className="text-amber-100 text-sm mt-1">
              O depósito já recebeu seu pedido e a equipe está separando suas bebidas!
            </p>
            <div className="inline-block mt-3 px-4 py-1.5 bg-white/25 rounded-full text-xs font-bold uppercase tracking-wider">
              Comanda #{placedOrder.id}
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="bg-neutral-50 p-5 rounded-2xl border border-neutral-200">
              <h3 className="font-bold text-sm text-neutral-800 mb-4 flex items-center justify-between">
                <span>Status da sua Entrega</span>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                  {placedOrder.status === 'pendente' && 'Recebido no Depósito'}
                  {placedOrder.status === 'em_separacao' && 'Em Separação no Estoque'}
                  {placedOrder.status === 'em_rota' && (placedOrder.deliveryType === 'delivery' ? 'A Caminho com Motoboy' : 'Pronto p/ Retirada')}
                  {placedOrder.status === 'concluido' && 'Entregue com Sucesso!'}
                  {placedOrder.status === 'cancelado' && 'Cancelado'}
                </span>
              </h3>

              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <div className="flex flex-col items-center">
                  <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold">✓</div>
                  <span className="mt-1 font-semibold text-neutral-800">Recebido</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    ['em_separacao', 'em_rota', 'concluido'].includes(placedOrder.status)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-amber-400 text-amber-950 animate-pulse'
                  }`}>
                    {['em_separacao', 'em_rota', 'concluido'].includes(placedOrder.status) ? '✓' : '2'}
                  </div>
                  <span className="mt-1 font-semibold text-neutral-800">Separando</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    ['em_rota', 'concluido'].includes(placedOrder.status)
                      ? 'bg-emerald-500 text-white'
                      : 'bg-neutral-200 text-neutral-500'
                  }`}>
                    {['em_rota', 'concluido'].includes(placedOrder.status) ? '✓' : '3'}
                  </div>
                  <span className="mt-1 font-semibold text-neutral-800">A Caminho</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                    placedOrder.status === 'concluido' ? 'bg-emerald-500 text-white' : 'bg-neutral-200 text-neutral-500'
                  }`}>
                    {placedOrder.status === 'concluido' ? '✓' : '4'}
                  </div>
                  <span className="mt-1 font-semibold text-neutral-800">Entregue</span>
                </div>
              </div>
            </div>

            {placedOrder.paymentMethod === 'pix' && (
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
                    className="flex items-center gap-1 px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-xs font-bold transition-colors"
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
                {placedOrder.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between items-center py-1 border-b border-neutral-100 last:border-0">
                    <div>
                      <span className="font-bold text-neutral-800">{it.quantity}x </span>
                      <span className="text-neutral-700">{it.name}</span>
                      <span className="text-neutral-400 block">{it.volume} {it.isCold ? '• Gelada ❄️' : ''}</span>
                    </div>
                    <span className="font-semibold text-neutral-900">
                      {formatCurrency(it.price * it.quantity)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-3 pt-3 border-t border-neutral-200 space-y-1 text-xs">
                <div className="flex justify-between text-neutral-500">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(placedOrder.subtotal)}</span>
                </div>
                <div className="flex justify-between text-neutral-500">
                  <span>Taxa de Entrega ({placedOrder.customer.neighborhood}):</span>
                  <span>{placedOrder.deliveryFee === 0 ? 'Grátis' : formatCurrency(placedOrder.deliveryFee)}</span>
                </div>
                <div className="flex justify-between text-sm font-black text-neutral-900 pt-1">
                  <span>Total:</span>
                  <span className="text-amber-600">{formatCurrency(placedOrder.total)}</span>
                </div>
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

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <a
                href={`https://wa.me/${settings.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(
                  `Olá! Fiz o pedido #${placedOrder.id} de ${formatCurrency(placedOrder.total)} pelo site.`
                )}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-sm transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Falar no WhatsApp do Depósito</span>
              </a>

              <button
                onClick={() => setPlacedOrder(null)}
                className="py-3 px-5 border border-neutral-300 hover:bg-neutral-100 text-neutral-700 font-bold rounded-xl text-sm transition-colors"
              >
                Fazer Novo Pedido
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24">
      {/* Store Closed Warning Banner if offline */}
      {!settings.isOpen && (
        <div className="mb-6 p-4 bg-red-600 text-white rounded-3xl shadow-lg border border-red-700 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center font-black text-lg shrink-0">
              🔴
            </div>
            <div>
              <h4 className="font-black text-sm uppercase tracking-wide">
                Depósito Fechado no Momento
              </h4>
              <p className="text-xs text-red-100 mt-0.5">
                {settings.closedMessage || 'No momento não estamos aceitando novos pedidos de entrega.'}
              </p>
            </div>
          </div>
          <div className="text-right text-xs text-red-100 font-medium shrink-0">
            Horário de expediente: <strong className="text-white">{settings.openingHours}</strong>
          </div>
        </div>
      )}

      {/* Customer Account Recognition Bar */}
      <div className="mb-6 bg-white p-3.5 rounded-2xl border border-neutral-200 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
            <User className="w-4 h-4" />
          </div>
          <div>
            {currentCustomer ? (
              <div>
                <p className="text-xs font-bold text-neutral-900">
                  Olá, <span className="text-amber-600">{currentCustomer.name}</span>! 👋
                </p>
                <p className="text-[11px] text-neutral-500">
                  Entregando em: {currentCustomer.address}, {currentCustomer.number} ({currentCustomer.neighborhood})
                </p>
              </div>
            ) : (
              <div>
                <p className="text-xs font-bold text-neutral-900">Já tem cadastro?</p>
                <p className="text-[11px] text-neutral-500">Acesse com seu WhatsApp para carregar seu endereço salvo.</p>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => setIsAuthModalOpen(true)}
          className="px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-xl text-xs font-bold transition-colors"
        >
          {currentCustomer ? 'Alterar Endereço / Dados' : 'Entrar / Cadastrar'}
        </button>
      </div>

      {/* Store Hero Banner */}
      <div className="relative rounded-3xl overflow-hidden bg-gradient-to-r from-neutral-900 via-amber-950 to-neutral-900 text-white p-6 sm:p-10 mb-8 shadow-xl">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-semibold mb-3">
              <span className={`w-2 h-2 rounded-full ${settings.isOpen ? 'bg-emerald-400 animate-ping' : 'bg-red-400'}`}></span>
              {settings.isOpen ? `Depósito Aberto • Entrega em até ${settings.estimatedDeliveryTime}` : 'Depósito Fechado no Momento'}
            </div>
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight leading-tight">
              {settings.storeName}
            </h1>
            <p className="mt-2 text-sm sm:text-base text-neutral-300 leading-relaxed">
              Cervejas trincando de geladas, destilados, vinhos, gelo, carvão e petiscos entregues direto na sua porta!
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-4 text-xs sm:text-sm text-neutral-300">
              <div className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-400" />
                <span>{settings.openingHours}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Truck className="w-4 h-4 text-amber-400" />
                <span>
                  {activeAreas.length} bairros atendidos com entrega rápida
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-amber-400" />
                <span>{settings.address}</span>
              </div>
            </div>
          </div>

          {/* Store Logo / Profile Photo Display */}
          {settings.logoUrl && (
            <div className="shrink-0 hidden md:block">
              <img
                src={settings.logoUrl}
                alt={settings.storeName}
                className="w-28 h-28 rounded-3xl object-cover border-2 border-amber-400/40 shadow-2xl"
              />
            </div>
          )}
        </div>
      </div>

      {/* Search & Cold Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mb-6">
        <div className="relative w-full sm:max-w-md">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="Buscar cerveja, whisky, refri, gelo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-neutral-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 shadow-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 text-xs font-bold"
            >
              Limpar
            </button>
          )}
        </div>

        <button
          onClick={() => setOnlyCold(!onlyCold)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl font-bold text-xs sm:text-sm transition-all border ${
            onlyCold
              ? 'bg-sky-500 text-white border-sky-600 shadow-md shadow-sky-500/20'
              : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          <span>❄️</span>
          <span>Apenas Super Geladas</span>
        </button>
      </div>

      {/* Category Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 scrollbar-none">
        {categories.map((cat) => {
          const Icon = cat.icon;
          const isActive = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id as ProductCategory | 'todas')}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25 scale-[1.02]'
                  : 'bg-white text-neutral-700 hover:bg-amber-50 border border-neutral-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Products Grid */}
      {products.length === 0 ? (
        <div className="text-center py-20 px-4 bg-white rounded-3xl border border-dashed border-neutral-300">
          <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Beer className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-black text-neutral-900">Catálogo em Atualização</h3>
          <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">
            O depósito está atualizando o estoque e os produtos disponíveis. Em breve novas bebidas geladas estarão cadastradas para entrega!
          </p>
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-dashed border-neutral-300">
          <Beer className="w-12 h-12 text-neutral-300 mx-auto mb-3" />
          <h3 className="text-base font-bold text-neutral-800">Nenhum produto encontrado</h3>
          <p className="text-xs text-neutral-500 mt-1">Tente buscar por outro termo ou limpar os filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {filteredProducts.map((product) => {
            const qty = getCartQuantity(product.id);
            const isOutOfStock = product.stock <= 0;

            return (
              <div
                key={product.id}
                className="bg-white rounded-3xl border border-neutral-200 shadow-xs hover:shadow-md transition-all overflow-hidden flex flex-col group"
              >
                <div className="relative aspect-square bg-neutral-100 overflow-hidden">
                  <img
                    src={product.image}
                    alt={product.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    loading="lazy"
                  />
                  {product.isCold && (
                    <div className="absolute top-2 left-2 bg-sky-500/95 backdrop-blur-xs text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                      <span>❄️</span>
                      <span>GELADA</span>
                    </div>
                  )}
                  {isOutOfStock && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center">
                      <span className="bg-red-500 text-white text-xs font-black px-3 py-1 rounded-full uppercase">
                        Esgotado
                      </span>
                    </div>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                      {product.volume}
                    </span>
                    <h3 className="font-bold text-sm text-neutral-900 leading-snug line-clamp-2 mt-0.5">
                      {product.name}
                    </h3>
                    <p className="text-xs text-neutral-500 line-clamp-1 mt-1">
                      {product.description}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-neutral-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-neutral-400 block font-medium">Preço</span>
                      <span className="text-base sm:text-lg font-black text-neutral-900">
                        {formatCurrency(product.price)}
                      </span>
                    </div>

                    {isOutOfStock ? (
                      <span className="text-xs font-bold text-neutral-400">Indisponível</span>
                    ) : qty === 0 ? (
                      <button
                        onClick={() => addToCart(product)}
                        className="flex items-center gap-1 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm shadow-amber-500/20 active:scale-95"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Adicionar</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 bg-neutral-100 p-1 rounded-xl">
                        <button
                          onClick={() => removeFromCart(product.id)}
                          className="w-7 h-7 bg-white hover:bg-neutral-200 text-neutral-800 rounded-lg flex items-center justify-center font-bold text-sm shadow-xs"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center font-black text-xs text-neutral-900">{qty}</span>
                        <button
                          onClick={() => addToCart(product)}
                          disabled={qty >= product.stock}
                          className="w-7 h-7 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 text-white rounded-lg flex items-center justify-center font-bold text-sm shadow-xs"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating Cart Button */}
      {totalCartCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-md px-4">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full flex items-center justify-between bg-neutral-950 text-white p-4 rounded-2xl shadow-2xl hover:bg-neutral-900 transition-all border border-neutral-700 active:scale-98"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black">
                {totalCartCount}
              </div>
              <div className="text-left">
                <span className="text-xs text-neutral-400 block font-medium">Ver Sacola</span>
                <span className="font-bold text-sm text-neutral-100">
                  {cart.length} {cart.length === 1 ? 'item' : 'itens'} adicionados
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-base font-black text-amber-400">
                {formatCurrency(cartTotal)}
              </span>
              <ArrowRight className="w-5 h-5 text-neutral-300" />
            </div>
          </button>
        </div>
      )}

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
              {/* Selected items */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Itens Selecionados
                </h4>
                {cart.map((item) => (
                  <div key={item.product.id} className="flex items-center justify-between gap-3 p-3 bg-neutral-50 rounded-2xl border border-neutral-200">
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-12 h-12 rounded-xl object-cover"
                    />
                    <div className="flex-1 min-w-0">
                      <h5 className="font-bold text-xs text-neutral-900 truncate">{item.product.name}</h5>
                      <span className="text-[11px] text-neutral-500 block">
                        {item.product.volume} • {formatCurrency(item.product.price)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-neutral-200">
                      <button
                        type="button"
                        onClick={() => removeFromCart(item.product.id)}
                        className="w-6 h-6 flex items-center justify-center text-neutral-600 hover:bg-neutral-100 rounded-lg"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-5 text-center font-black text-xs text-neutral-900">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => addToCart(item.product)}
                        disabled={item.quantity >= item.product.stock}
                        className="w-6 h-6 flex items-center justify-center text-neutral-600 hover:bg-neutral-100 rounded-lg disabled:opacity-30"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    <span className="font-bold text-xs text-neutral-900 w-16 text-right">
                      {formatCurrency(item.product.price * item.quantity)}
                    </span>
                  </div>
                ))}
              </div>

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
                      ✓ Endereço Salvo
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

                {deliveryType === 'delivery' && (
                  <div className="space-y-3 pt-1">
                    {/* CEP Search Card */}
                    <div className="p-3.5 bg-amber-50/80 border border-amber-300 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-amber-600" />
                          <span>Preencher Endereço por CEP</span>
                        </label>
                        <span className="text-[10px] text-amber-800 font-bold bg-amber-200/60 px-2 py-0.5 rounded">
                          Raio Máx: {settings.deliveryRadiusKm || 5} km
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
                          {isSearchingCep ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                          <span>Buscar</span>
                        </button>
                      </div>

                      {cepNotice && (
                        <p className="text-[11px] font-bold text-amber-950 bg-amber-100/90 p-2 rounded-xl">
                          {cepNotice}
                        </p>
                      )}
                    </div>

                    {/* Delivery Radius / Coverage Info Banner */}
                    {settings.deliveryRadiusKm && !cepNotice && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex flex-wrap items-center justify-between gap-2 text-xs text-amber-950">
                        <div className="flex items-center gap-2">
                          <Compass className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>
                            Entregamos em até <strong>{settings.deliveryRadiusKm} km</strong> de distância do depósito!
                          </span>
                        </div>
                        {address && (
                          <button
                            type="button"
                            onClick={handleCheckDistance}
                            disabled={checkingDistance}
                            className="text-[11px] font-bold text-amber-700 hover:text-amber-900 bg-white px-2.5 py-1 rounded-lg border border-amber-300 shadow-2xs transition-colors shrink-0"
                          >
                            {checkingDistance ? 'Calculando...' : 'Checar Distância'}
                          </button>
                        )}
                      </div>
                    )}

                    {customerDistance && (
                      <div className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                        customerDistance.inside
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-red-50 text-red-800 border border-red-200'
                      }`}>
                        {customerDistance.inside ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span>
                              Distância: <strong>{customerDistance.km} km</strong> — Dentro da área de entrega!
                            </span>
                          </>
                        ) : (
                          <>
                            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                            <span>
                              Distância: <strong>{customerDistance.km} km</strong> — Fora do raio máximo de {settings.deliveryRadiusKm} km. Escolha Retirada no Depósito.
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    {/* Bairro Selector with delivery area enforcement */}
                    <div>
                      <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                        Selecione seu Bairro * (Áreas Atendidas pelo Depósito)
                      </label>
                      {activeAreas.length === 0 ? (
                        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs">
                          <p className="font-bold">Nenhum bairro de entrega fixo cadastrado</p>
                          <p className="mt-0.5 text-[11px] text-amber-700">
                            Informe seu bairro no campo abaixo ou selecione a opção Retirada no Depósito.
                          </p>
                          <input
                            type="text"
                            required
                            placeholder="Digite seu bairro..."
                            value={neighborhood}
                            onChange={(e) => setNeighborhood(e.target.value)}
                            className="mt-2 w-full px-3 py-2 bg-white border border-amber-300 rounded-xl text-xs font-bold text-neutral-900"
                          />
                        </div>
                      ) : (
                        <>
                          <select
                            value={neighborhood}
                            onChange={(e) => setNeighborhood(e.target.value)}
                            className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs font-bold text-neutral-900"
                            required
                          >
                            {activeAreas.map(area => (
                              <option key={area.id} value={area.name}>
                                {area.name} — Taxa: {formatCurrency(area.fee)} ({area.estimatedTime})
                              </option>
                            ))}
                          </select>

                          {!isAreaCovered && (
                            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
                              <div>
                                <strong>Bairro fora da área de entrega!</strong>
                                <p className="mt-0.5 text-[11px]">
                                  Nosso depósito entrega nos seguintes bairros: {activeAreas.map(a => a.name).join(', ')}.
                                  Você também pode escolher <strong>Retirar no Depósito</strong>.
                                </p>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2">
                        <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Rua / Avenida *</label>
                        <input
                          type="text"
                          required
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
                          placeholder="123"
                          value={addressNumber}
                          onChange={(e) => setAddressNumber(e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Complemento / Apto</label>
                        <input
                          type="text"
                          placeholder="Apto 42B"
                          value={complement}
                          onChange={(e) => setComplement(e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-neutral-600 block mb-1">Ponto de Referência</label>
                        <input
                          type="text"
                          placeholder="Ex: Portão cinza"
                          value={reference}
                          onChange={(e) => setReference(e.target.value)}
                          className="w-full px-3 py-2 bg-neutral-50 border border-neutral-300 rounded-xl text-xs"
                        />
                      </div>
                    </div>
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
                      paymentMethod === 'pix' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-neutral-200 text-neutral-700'
                    }`}
                  >
                    ⚡ PIX (Instantâneo)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cartao_credito')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                      paymentMethod === 'cartao_credito' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-neutral-200 text-neutral-700'
                    }`}
                  >
                    💳 Cartão de Crédito
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('cartao_debito')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                      paymentMethod === 'cartao_debito' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-neutral-200 text-neutral-700'
                    }`}
                  >
                    💳 Cartão de Débito
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('dinheiro')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-bold transition-all ${
                      paymentMethod === 'dinheiro' ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-neutral-200 text-neutral-700'
                    }`}
                  >
                    💵 Dinheiro
                  </button>
                </div>

                {paymentMethod === 'dinheiro' && (
                  <div className="mt-2 bg-neutral-50 p-3 rounded-xl border border-neutral-200">
                    <label className="text-[11px] font-semibold text-neutral-700 block mb-1">
                      Precisa de troco para quanto?
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="Ex: 50 ou 100"
                      value={cashChangeFor}
                      onChange={(e) => setCashChangeFor(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-xs"
                    />
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

              {/* Total summary */}
              <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-2 text-xs">
                <div className="flex justify-between text-neutral-600">
                  <span>Subtotal:</span>
                  <span>{formatCurrency(cartSubtotal)}</span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>Taxa de Entrega:</span>
                  <span>{deliveryFee === 0 ? 'Grátis' : formatCurrency(deliveryFee)}</span>
                </div>
                <div className="flex justify-between text-base font-black text-neutral-900 pt-2 border-t border-neutral-200">
                  <span>Total Final:</span>
                  <span className="text-amber-600">{formatCurrency(cartTotal)}</span>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || cart.length === 0 || !isAreaCovered || !settings.isOpen}
                className="w-full py-4 bg-amber-500 hover:bg-amber-600 disabled:bg-neutral-300 disabled:cursor-not-allowed text-white font-black text-base rounded-2xl shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
              >
                {!settings.isOpen ? (
                  <span>🔴 Depósito Fechado no Momento</span>
                ) : isSubmitting ? (
                  <span>Enviando pedido...</span>
                ) : (
                  <>
                    <span>Confirmar e Enviar Pedido</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Customer Auth / Register Modal */}
      <CustomerAuthModal
        isOpen={isAuthModalOpen}
        deliveryAreas={deliveryAreas}
        currentCustomer={currentCustomer}
        settings={settings}
        onSuccess={(cust) => {
          setCurrentCustomer(cust);
          setIsAuthModalOpen(false);
        }}
        onClose={() => setIsAuthModalOpen(false)}
      />
    </div>
  );
};
