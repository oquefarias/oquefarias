import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Erro capturado na interface:', error, errorInfo);
  }

  handleReload = (): void => {
    this.setState({ hasError: false });
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-neutral-200 shadow-lg p-6 sm:p-8 max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base sm:text-lg font-black text-neutral-900">
                Algo deu errado nesta tela. Toque para recarregar
              </h2>
              <p className="text-xs text-neutral-500">
                Seus dados e pedidos estão salvos. Recarregue a página para continuar.
              </p>
            </div>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-600 text-neutral-950 font-black text-xs sm:text-sm rounded-2xl shadow-sm transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Recarregar tela</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
