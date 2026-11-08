import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
  Send,
  Check,
  X,
  AlertTriangle,
  RefreshCw,
  Trash2,
  TrendingUp,
  Package,
  ShoppingCart,
  Clock,
  Tag,
} from 'lucide-react';
import {
  Product,
  StoreSettings,
  AdminAssistantMessage,
  AdminAssistantProposal,
} from '../../types';
import { api } from '../../services/api';

interface AdminAssistantSectionProps {
  products: Product[];
  settings: StoreSettings;
  onRefreshState?: () => Promise<void> | void;
}

const QUICK_QUESTIONS: Array<{ label: string; prompt: string; icon: React.ReactNode }> = [
  {
    label: 'Resumo e lucro de hoje',
    prompt: 'Qual o resumo de vendas, faturamento, custos e lucro líquido do expediente de hoje?',
    icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
  },
  {
    label: 'Mais vendidos (7 dias)',
    prompt: 'Quais foram os 10 produtos mais vendidos e que deram mais lucro nos últimos 7 dias?',
    icon: <Tag className="w-3.5 h-3.5 text-amber-400" />,
  },
  {
    label: 'Estoque baixo / comprar',
    prompt: 'Quais produtos estão com estoque baixo e qual a sugestão de compra para os próximos 7 dias?',
    icon: <ShoppingCart className="w-3.5 h-3.5 text-sky-400" />,
  },
  {
    label: 'Produtos parados',
    prompt: 'Quais produtos ativos com estoque não tiveram nenhuma venda nos últimos 15 dias?',
    icon: <Package className="w-3.5 h-3.5 text-orange-400" />,
  },
  {
    label: 'Pedidos e mesas agora',
    prompt: 'Como estão os pedidos em andamento e as mesas abertas neste momento?',
    icon: <Clock className="w-3.5 h-3.5 text-purple-400" />,
  },
];

export const AdminAssistantSection: React.FC<AdminAssistantSectionProps> = ({
  products,
  settings,
  onRefreshState,
}) => {
  const [messages, setMessages] = useState<AdminAssistantMessage[]>([
    {
      id: 'welcome-msg',
      role: 'assistant',
      content:
        'Olá! Sou o assistente de gestão do seu depósito. Posso consultar faturamento, lucro/prejuízo do expediente, produtos mais vendidos, estoque baixo, sugestão de compra ou preparar alterações de preços, promoções, estoque e combos para você confirmar com 1 clique.',
      createdAt: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [confirmingIds, setConfirmingIds] = useState<Record<string, boolean>>({});
  const [remainingToday, setRemainingToday] = useState<number | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setIsSending(false);
    setConfirmingIds({});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending]);

  const sendQuestion = async (textToSend?: string) => {
    const cleanText = (textToSend !== undefined ? textToSend : input).trim();
    if (!cleanText || isSending) return;

    setErrorBanner(null);
    setFeedbackBanner(null);

    const userMsg: AdminAssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: cleanText,
      createdAt: new Date().toISOString(),
    };

    const historyForApi = [...messages, userMsg].filter((m) => m.id !== 'welcome-msg');
    setMessages((prev) => [...prev, userMsg]);
    if (textToSend === undefined) {
      setInput('');
    }
    setIsSending(true);

    try {
      const response = await api.askAdminAssistant(cleanText, historyForApi);
      setRemainingToday(response.remainingToday);

      const assistantMsg: AdminAssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.reply,
        createdAt: new Date().toISOString(),
        proposals: Array.isArray(response.proposals)
          ? response.proposals.map((p) => ({ ...p, status: p.status || 'pending' }))
          : [],
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setErrorBanner(err?.message || 'Não foi possível consultar o assistente agora.');
    } finally {
      setIsSending(false);
    }
  };

  const updateProposalStatus = (
    messageId: string,
    proposalId: string,
    status: 'confirmed' | 'ignored'
  ) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !Array.isArray(m.proposals)) return m;
        return {
          ...m,
          proposals: m.proposals.map((p) => (p.id === proposalId ? { ...p, status } : p)),
        };
      })
    );
  };

  const handleIgnoreProposal = (messageId: string, proposalId: string) => {
    updateProposalStatus(messageId, proposalId, 'ignored');
  };

  const handleConfirmProposal = async (messageId: string, proposal: AdminAssistantProposal) => {
    if (!proposal || confirmingIds[proposal.id]) return;

    setErrorBanner(null);
    setFeedbackBanner(null);
    setConfirmingIds((prev) => ({ ...prev, [proposal.id]: true }));

    try {
      if (proposal.type === 'price') {
        const target = products.find((p) => p.id === proposal.productId);
        if (!target) {
          throw new Error('Produto não encontrado no catálogo.');
        }
        await api.saveProduct({
          ...target,
          price: Number(proposal.newPrice ?? target.price),
          costPrice:
            proposal.newCostPrice !== undefined
              ? Number(proposal.newCostPrice)
              : target.costPrice,
        });
        setFeedbackBanner(`Preço de "${target.name}" atualizado com sucesso!`);
      } else if (proposal.type === 'promo') {
        if (!proposal.productId) {
          throw new Error('Produto inválido na proposta de promoção.');
        }
        if (proposal.promoPrice && Number(proposal.promoPrice) > 0) {
          await api.setProductPromotion(
            proposal.productId,
            Number(proposal.promoPrice),
            proposal.promoEndsAt || null
          );
          setFeedbackBanner(`Promoção aplicada em "${proposal.productName || 'produto'}"!`);
        } else {
          await api.clearProductPromotion(proposal.productId);
          setFeedbackBanner(`Promoção encerrada para "${proposal.productName || 'produto'}".`);
        }
      } else if (proposal.type === 'description') {
        const target = products.find((p) => p.id === proposal.productId);
        if (!target) {
          throw new Error('Produto não encontrado no catálogo.');
        }
        await api.saveProduct({
          ...target,
          description: String(proposal.newDescription || '').trim(),
        });
        setFeedbackBanner(`Descrição de "${target.name}" atualizada!`);
      } else if (proposal.type === 'stock_adjust') {
        if (!proposal.productId) {
          throw new Error('Produto inválido para ajuste de estoque.');
        }
        await api.adjustProductStock(proposal.productId, {
          mode: proposal.stockMode === 'set' ? 'set' : 'delta',
          value: Math.trunc(Number(proposal.stockQuantity) || 0),
          reason: proposal.stockReason || 'ajuste',
          note: proposal.stockNote || 'Ajuste confirmado via Assistente IA',
        });
        setFeedbackBanner(`Estoque de "${proposal.productName || 'produto'}" ajustado!`);
      } else if (proposal.type === 'combo') {
        const comboItems = Array.isArray(proposal.comboItems) ? proposal.comboItems : [];
        if (comboItems.length === 0) {
          throw new Error('O combo precisa ter pelo menos 1 produto.');
        }

        let comboProductId = proposal.comboId || '';
        const existingCombo = comboProductId
          ? products.find((p) => p.id === comboProductId)
          : undefined;

        if (existingCombo) {
          await api.saveProduct({
            ...existingCombo,
            name: proposal.comboName || existingCombo.name,
            price: Number(proposal.comboPrice ?? existingCombo.price),
            volume: proposal.comboVolume || existingCombo.volume || 'Combo',
          });
        } else {
          comboProductId = `combo_${Date.now()}`;
          await api.saveProduct({
            id: comboProductId,
            name: proposal.comboName || 'Novo Combo',
            category: proposal.comboCategory || 'combos',
            volume: proposal.comboVolume || 'Combo',
            price: Number(proposal.comboPrice) || 10,
            costPrice: 0,
            stock: 0,
            minStock: 0,
            isCold: true,
            sku: '',
            active: true,
            description: comboItems
              .map((ci) => `${ci.quantity}x ${ci.productName || ci.productId}`)
              .join(' + '),
          });
        }

        const nextCombos = {
          ...(settings.combos || {}),
          [comboProductId]: comboItems.map((ci) => ({
            productId: ci.productId,
            quantity: Math.max(1, Math.floor(Number(ci.quantity) || 1)),
          })),
        };
        await api.updateSettings({ combos: nextCombos });
        setFeedbackBanner(`Combo "${proposal.comboName}" salvo com sucesso!`);
      }

      updateProposalStatus(messageId, proposal.id, 'confirmed');
      if (onRefreshState) {
        await onRefreshState();
      }
    } catch (err: any) {
      setErrorBanner(err?.message || 'Erro ao confirmar a proposta.');
    } finally {
      setConfirmingIds((prev) => ({ ...prev, [proposal.id]: false }));
    }
  };

  const handleClearConversation = () => {
    setIsSending(false);
    setConfirmingIds({});
    setErrorBanner(null);
    setFeedbackBanner(null);
    setMessages([
      {
        id: 'welcome-msg',
        role: 'assistant',
        content:
          'Conversa limpa! Escolha uma pergunta rápida acima ou digite o que deseja consultar ou ajustar.',
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-white">Assistente IA do Depósito</h2>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                Somente Leitura + Propostas com Confirmação
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              Consulte vendas, lucro líquido, giro de estoque e peça sugestões. Nenhuma alteração é salva sem você clicar em Confirmar.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {remainingToday !== null && (
            <span className="text-xs text-zinc-400 bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 rounded-lg">
              Restantes hoje: <strong className="text-zinc-200">{remainingToday}</strong>/100
            </span>
          )}
          <button
            type="button"
            onClick={handleClearConversation}
            disabled={isSending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Limpar conversa
          </button>
        </div>
      </div>

      {/* Quick Questions Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5">
        <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2.5">
          Perguntas Rápidas
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_QUESTIONS.map((q) => (
            <button
              key={q.label}
              type="button"
              disabled={isSending}
              onClick={() => sendQuestion(q.prompt)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-zinc-950 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-amber-500/40 transition-colors disabled:opacity-50"
            >
              {q.icon}
              <span>{q.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Feedback & Error Banners */}
      {errorBanner && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3.5 flex items-center justify-between gap-3 text-red-200 text-xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-300 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {feedbackBanner && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 flex items-center justify-between gap-3 text-emerald-200 text-xs">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{feedbackBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackBanner(null)}
            className="text-emerald-300 hover:text-white p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col h-[520px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[90%] sm:max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    isUser
                      ? 'bg-amber-500 text-zinc-950 font-medium'
                      : 'bg-zinc-950 border border-zinc-800 text-zinc-100'
                  }`}
                >
                  {msg.content}
                </div>

                {/* Proposals attached to Assistant Message */}
                {Array.isArray(msg.proposals) && msg.proposals.length > 0 && (
                  <div className="w-full max-w-[90%] sm:max-w-[80%] mt-2.5 space-y-2.5">
                    {msg.proposals.map((prop) => {
                      const isConfirming = Boolean(confirmingIds[prop.id]);
                      const status = prop.status || 'pending';

                      return (
                        <div
                          key={prop.id}
                          className="bg-amber-500/10 border border-amber-500/40 rounded-xl p-3.5 text-zinc-100 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                                  Proposta de Alteração
                                </span>
                              </div>
                              <h4 className="text-sm font-bold text-white mt-0.5">
                                {prop.title}
                              </h4>
                              <p className="text-xs text-amber-100/90 mt-1">
                                {prop.summary}
                              </p>
                            </div>

                            {status === 'confirmed' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                                <Check className="w-3.5 h-3.5" />
                                Confirmado
                              </span>
                            ) : status === 'ignored' ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-400 border border-zinc-700 shrink-0">
                                Ignorado
                              </span>
                            ) : (
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  disabled={isConfirming}
                                  onClick={() => handleConfirmProposal(msg.id, prop)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors disabled:opacity-50"
                                >
                                  {isConfirming ? (
                                    <>
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      <span>Salvando...</span>
                                    </>
                                  ) : (
                                    <>
                                      <Check className="w-3.5 h-3.5" />
                                      <span>Confirmar</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={isConfirming}
                                  onClick={() => handleIgnoreProposal(msg.id, prop.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 transition-colors disabled:opacity-50"
                                >
                                  <X className="w-3.5 h-3.5" />
                                  <span>Ignorar</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {isSending && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 w-fit">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Consultando dados da loja...</span>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendQuestion();
          }}
          className="p-3 border-t border-zinc-800 bg-zinc-950/60 rounded-b-xl flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isSending}
            placeholder="Pergunte sobre vendas, lucro, estoque ou peça para ajustar um preço/promoção..."
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={isSending || !input.trim()}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Enviar</span>
          </button>
        </form>
      </div>
    </div>
  );
};
