import React from 'react';
import { cn } from '../../lib/utils';

// ─── Button ───────────────────────────────────────────────────────────────────
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className,
  disabled,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-full transition-all duration-200 ease-out cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-offset-2 hover:scale-[1.02] hover:shadow-md active:scale-[0.98] active:shadow-none';

  const variants = {
    primary: 'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] shadow-sm shadow-red-900/20 hover:shadow-red-900/40',
    secondary: 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-gray-700 dark:hover:text-white',
    ghost: 'text-gray-900 dark:text-white hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white',
    danger: 'bg-red-500 text-white hover:bg-red-600 shadow-sm shadow-red-500/20 hover:shadow-red-500/40',
    outline: 'border-2 border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 dark:hover:border-gray-600 dark:hover:bg-gray-800 dark:hover:text-white',
  };

  const sizes = {
    sm: 'px-4 py-1.5 text-xs h-9',
    md: 'px-5 py-2 text-sm h-10',
    lg: 'px-6 py-2.5 text-base h-11',
  };

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      style={variant === 'primary' ? { '--tw-ring-color': 'var(--color-primary)' } as React.CSSProperties : {}}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : icon}
      {children}
    </button>
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────
interface BadgeProps {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' | 'gray';
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}

export function Badge({ variant = 'default', children, className, dot }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    success: 'bg-[var(--color-success-bg)] text-[var(--color-success)] dark:text-green-400',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
    danger: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
    purple: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400',
    gray: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  };

  const dotColors: Record<string, string> = {
    success: 'bg-[var(--color-success)]', warning: 'bg-amber-500',
    danger: 'bg-red-500', info: 'bg-blue-500',
    purple: 'bg-violet-500', default: 'bg-gray-400', gray: 'bg-gray-400',
  };

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />}
      {children}
    </span>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
interface CardProps {
  id?: string;
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  padding?: boolean;
}

export function Card({ children, className, hover, padding = true }: CardProps) {
  return (
    <div className={cn(
      'bg-[var(--color-card)] rounded-3xl border border-black/[0.04] dark:border-white/[0.04]',
      'shadow-[var(--shadow-soft)] flex flex-col h-full',
      hover && 'hover:shadow-[var(--shadow-hover)] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer',
      padding && 'p-8',
      className,
    )}>
      {children}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
interface SkeletonProps { className?: string; }

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded-2xl bg-gray-100 dark:bg-gray-800', className)} />;
}

export function SkeletonCard() {
  return (
    <Card>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
    </Card>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-4 px-6">
          <Skeleton className="h-10 w-10 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-20 px-6 text-center', className)}>
      {icon && (
        <div className="w-16 h-16 bg-gray-50 dark:bg-gray-800/50 rounded-full flex items-center justify-center mb-5 text-gray-400 dark:text-gray-500">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-[var(--color-text-main)] mb-1.5">{title}</h3>
      {description && <p className="text-sm text-gray-500 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ─── Page Header ──────────────────────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 sm:mb-10', className)}>
      <div>
        <h1 className="text-3xl font-semibold text-[var(--color-text-main)] tracking-tight">{title}</h1>
        {description && <p className="text-sm text-[var(--color-text-muted)] mt-1.5">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 shrink-0">{actions}</div>}
    </div>
  );
}

// ─── Search Input ─────────────────────────────────────────────────────────────
interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onClear?: () => void;
}

export function SearchInput({ className, value, onClear, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </span>
      <input
        type="text"
        value={value}
        className={cn(
          'w-full pl-11 pr-10 py-3 text-sm rounded-full transition-all duration-200 font-medium',
          'bg-[var(--color-input-bg)] text-[var(--color-text-main)]',
          'border border-[#E5E7EB] dark:border-gray-700',
          'hover:border-[var(--color-primary)]',
          'outline-none focus:outline-none focus:ring-0 focus:border-2 focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]',
          'placeholder-gray-400 dark:placeholder-gray-500',
        )}
        {...props}
      />
      {value && onClear && (
        <button onClick={onClear} className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
interface AvatarProps {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
];

export function Avatar({ name, size = 'md', className }: AvatarProps) {
  const safeName = name || 'User';
  const initials = safeName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const color = AVATAR_COLORS[safeName.charCodeAt(0) % AVATAR_COLORS.length];
  const sizes = { sm: 'w-8 h-8 text-[11px]', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base', xl: 'w-16 h-16 text-xl' };

  return (
    <div className={cn('rounded-full flex items-center justify-center font-medium shrink-0 shadow-sm border border-black/5 dark:border-white/5', color, sizes[size], className)}>
      {initials}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
interface StatCardProps {
  id?: string;
  label: string;
  value: string;
  change?: number;
  icon: React.ReactNode;
  iconBg?: string;
  loading?: boolean;
  subtitle?: string;
}

export function StatCard({ id, label, value, change, icon, iconBg = 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]', loading, subtitle }: StatCardProps) {
  if (loading) return <SkeletonCard />;

  return (
    <Card id={id} className="group" hover>
      <div className="flex items-center justify-between mb-5">
        <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300', iconBg)}>
          {icon}
        </div>
        {change !== undefined && (
          <span className={cn(
            'flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full',
            change >= 0 ? 'text-[var(--color-success)] bg-[var(--color-success-bg)]' : 'text-red-600 bg-red-100 dark:bg-red-950/40 dark:text-red-400',
          )}>
            {change >= 0 ? '↗' : '↘'} {Math.abs(change)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-semibold text-[var(--color-text-main)] tracking-tight mb-1">{value}</p>
        <p className="text-sm font-medium text-[var(--color-text-muted)]">{label}</p>
        {subtitle && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">{subtitle}</p>}
      </div>
    </Card>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────
export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  onRowClick?: (row: T) => void;
  emptyState?: React.ReactNode;
  keyExtractor: (row: T) => string;
}

export function DataTable<T>({ columns, data, loading, onRowClick, emptyState, keyExtractor }: DataTableProps<T>) {
  if (loading) return <div className="py-2"><SkeletonTable /></div>;
  if (data.length === 0) return <>{emptyState ?? <EmptyState title="No data found" description="Nothing to display here yet." />}</>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {columns.map(col => (
               <th key={col.key} className={cn(
                'px-6 py-4 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest whitespace-nowrap border-b border-black/[0.04] dark:border-white/[0.04]',
                col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                col.width,
              )}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.02] dark:divide-white/[0.02]">
          {data.map(row => (
            <tr
              key={keyExtractor(row)}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'transition-colors',
                onRowClick && 'cursor-pointer hover:bg-gray-50/80 dark:hover:bg-gray-800/30',
              )}
            >
              {columns.map(col => (
                <td key={col.key} className={cn(
                  'px-6 py-4 text-sm font-medium text-gray-700 dark:text-gray-300 first:rounded-l-2xl last:rounded-r-2xl border-b border-black/[0.02] dark:border-white/[0.02]',
                  col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left',
                )}>
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
}

export function Input({ label, error, hint, id, className, ...props }: InputProps) {
  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-main)] ml-1">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'w-full px-4 h-10 text-sm rounded-xl transition-all duration-200 font-medium',
          'bg-[var(--color-input-bg)] text-[var(--color-text-main)]',
          'border border-[#E5E7EB] dark:border-gray-700',
          'hover:border-[var(--color-primary)]',
          'outline-none focus:outline-none focus:ring-0 focus:border-2 focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]',
          'placeholder-gray-400 dark:placeholder-gray-600',
          error ? 'border-red-400 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800' : '',
          className,
        )}
        {...props}
      />
      {error && <p className="text-xs text-red-500 font-medium ml-1">{error}</p>}
      {hint && !error && <p className="text-xs text-gray-400 ml-1">{hint}</p>}
    </div>
  );
}

// ─── Select ───────────────────────────────────────────────────────────────────
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  options: { value: string; label: string }[];
}

export function Select({ label, error, id, options, className, ...props }: SelectProps) {
  return (
    <div className="space-y-2">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-main)] ml-1">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cn(
          'w-full px-4 h-10 text-sm rounded-xl transition-all duration-200 font-medium appearance-none bg-no-repeat',
          'bg-[var(--color-input-bg)] text-[var(--color-text-main)]',
          'border border-[#E5E7EB] dark:border-gray-700',
          'hover:border-[var(--color-primary)]',
          'outline-none focus:outline-none focus:ring-0 focus:border-2 focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]',
          error ? 'border-red-400 bg-red-50/50 dark:bg-red-950/20 dark:border-red-800' : '',
          className,
        )}
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`,
          backgroundPosition: 'right 1rem center',
          backgroundSize: '1.25rem 1.25rem',
        }}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p className="text-xs text-red-500 font-medium ml-1">{error}</p>}
    </div>
  );
}

// ─── Section Divider ──────────────────────────────────────────────────────────
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 my-8">
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
    </div>
  );
}

// ─── Status Select ─────────────────────────────────────────────────────────────
interface StatusSelectProps {
  value: string;
  options: { value: string; label: string; dotClass: string; bgClass: string; textClass: string }[];
  onChange: (value: string) => void;
  readonly?: boolean;
}

export function StatusSelect({ value, options, onChange, readonly = false }: StatusSelectProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const selected = options.find(o => o.value === value) || options[0];

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!readonly) setOpen(!open);
        }}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold h-8 transition-all duration-200 outline-none',
          selected.bgClass,
          selected.textClass,
          !readonly && 'cursor-pointer hover:shadow-sm hover:-translate-y-px active:translate-y-0',
          readonly && 'cursor-default'
        )}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', selected.dotClass)} />
        {selected.label}
        {!readonly && (
          <svg className={cn("w-3.5 h-3.5 ml-0.5 transition-transform duration-200 opacity-60", open && "rotate-180")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && !readonly && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-36 bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-1.5 z-50 animate-in fade-in zoom-in-95 duration-200">
          {options.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors',
                value === opt.value ? 'bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white' : 'text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', opt.dotClass)} />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export * from './DivisionTabs';
