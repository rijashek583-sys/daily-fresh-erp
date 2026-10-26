import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(
  amount: number,
  currency = 'INR',
  locale = 'en-IN',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(
  date: string | Date,
  options: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  },
): string {
  return new Intl.DateTimeFormat('en-IN', options).format(
    typeof date === 'string' ? new Date(date) : date,
  );
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = now.getTime() - d.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return 'U';
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');
}

/**
 * Canonical set of Primary Foods product names (exact, lowercase).
 * Business rule (confirmed 2026-10-23):
 *   PRIMARY FOODS  — Kuboos, Roomali, Wheat Kuboos ONLY.
 *   BAKERY FOODS   — every other product, including Soft Kuboos and Burger Bun.
 *
 * This set is the single source of truth for the name-match fallback.
 * The Firestore product.division field takes precedence when present.
 */
const PRIMARY_PRODUCT_NAMES = new Set<string>(['kuboos', 'roomali', 'wheat kuboos']);

export function getProductDivision(product: { name: string, division?: string } | undefined | null): 'primary' | 'bakery' {
  if (!product) return 'bakery';
  // Trust the canonical Firestore division field when explicitly set.
  if (product.division === 'primary' || product.division === 'bakery') {
    return product.division;
  }
  // Fallback for items that pre-date the division field:
  // exact match against the confirmed primary-foods list — no fuzzy matching.
  return PRIMARY_PRODUCT_NAMES.has(product.name.trim().toLowerCase()) ? 'primary' : 'bakery';
}

/**
 * Returns the current date in YYYY-MM-DD format based on local India/Kerala timezone (Asia/Kolkata).
 * Eliminates UTC conversion shifting (+/- 1 day error).
 */
export function getTodayLocalDateString(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}

