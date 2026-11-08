import React from 'react';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

export const COLLAPSED_SECTIONS_STORAGE_KEY = 'deposito_admin_collapsed_sections_v1';

export function loadCollapsedSectionsMap(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'boolean') {
          result[k] = v;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveCollapsedSectionsMap(map: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(COLLAPSED_SECTIONS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore localStorage quota / private mode errors
  }
}

interface CollapsibleSectionProps {
  sectionId: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  collapsed: boolean;
  onToggle: (sectionId: string) => void;
  rightContent?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  variant?: 'default' | 'amber' | 'dark';
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  sectionId,
  title,
  subtitle,
  icon,
  badge,
  collapsed,
  onToggle,
  rightContent,
  children,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  variant = 'default',
}) => {
  const containerClasses =
    variant === 'dark'
      ? 'bg-neutral-900 text-white rounded-3xl border border-neutral-800 shadow-xs overflow-hidden'
      : variant === 'amber'
      ? 'bg-white rounded-3xl border border-amber-200 shadow-xs overflow-hidden'
      : 'bg-white rounded-3xl border border-neutral-200 shadow-xs overflow-hidden';

  const headerHoverClasses =
    variant === 'dark'
      ? 'hover:bg-neutral-800/70'
      : variant === 'amber'
      ? 'hover:bg-amber-50/40'
      : 'hover:bg-neutral-50/80';

  const subtitleClasses =
    variant === 'dark' ? 'text-neutral-400' : 'text-neutral-500';

  const pillClasses =
    variant === 'dark'
      ? 'bg-neutral-800 text-neutral-200 border-neutral-700'
      : 'bg-neutral-100 text-neutral-700 border-neutral-200';

  return (
    <div className={`${containerClasses} ${className}`}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onClick={() => onToggle(sectionId)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle(sectionId);
          }
        }}
        className={`w-full px-4 sm:px-5 py-3.5 flex flex-wrap items-center justify-between gap-2 text-left transition-colors cursor-pointer select-none ${headerHoverClasses} ${
          !collapsed
            ? variant === 'dark'
              ? 'border-b border-neutral-800'
              : 'border-b border-neutral-100'
            : ''
        } ${headerClassName}`}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            className={`w-7 h-7 rounded-xl border flex items-center justify-center shrink-0 transition-transform ${pillClasses}`}
            title={collapsed ? 'Expandir seção' : 'Recolher seção'}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform duration-200 ${
                collapsed ? '-rotate-90' : 'rotate-0'
              }`}
            />
          </span>
          {icon && <span className="shrink-0 flex items-center">{icon}</span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-black text-sm sm:text-base leading-tight">
                {title}
              </span>
              {badge}
            </div>
            {subtitle && (
              <p className={`text-[11px] ${subtitleClasses} mt-0.5 line-clamp-1`}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {rightContent}
          <button
            type="button"
            onClick={() => onToggle(sectionId)}
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-colors cursor-pointer ${pillClasses}`}
          >
            {collapsed ? 'Expandir' : 'Recolher'}
          </button>
        </div>
      </div>

      {!collapsed && <div className={`p-4 sm:p-5 ${bodyClassName}`}>{children}</div>}
    </div>
  );
};

interface CollapseAllToolbarProps {
  onCollapseAll: () => void;
  onExpandAll: () => void;
  allCollapsed?: boolean;
  allExpanded?: boolean;
  label?: string;
}

export const CollapseAllToolbar: React.FC<CollapseAllToolbarProps> = ({
  onCollapseAll,
  onExpandAll,
  allCollapsed = false,
  allExpanded = false,
  label = 'Seções da tela:',
}) => {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {label && (
        <span className="text-[11px] font-bold text-neutral-500 mr-0.5 hidden sm:inline">
          {label}
        </span>
      )}
      <button
        type="button"
        onClick={onCollapseAll}
        disabled={allCollapsed}
        className="px-2.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 disabled:opacity-45 text-neutral-700 border border-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-default"
        title="Recolher todas as seções desta tela"
      >
        <ChevronsDownUp className="w-3.5 h-3.5 text-neutral-600" />
        <span>Recolher tudo</span>
      </button>
      <button
        type="button"
        onClick={onExpandAll}
        disabled={allExpanded}
        className="px-2.5 py-1.5 rounded-xl bg-neutral-100 hover:bg-neutral-200 disabled:opacity-45 text-neutral-700 border border-neutral-200 text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:cursor-default"
        title="Expandir todas as seções desta tela"
      >
        <ChevronsUpDown className="w-3.5 h-3.5 text-neutral-600" />
        <span>Expandir tudo</span>
      </button>
    </div>
  );
};
