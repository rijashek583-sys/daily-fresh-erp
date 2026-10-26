/**
 * Daily Fresh ERP — Centralized Feature Registry & Rollout System
 *
 * ARCHITECTURAL PRINCIPLES:
 * 1. Single Implementation: All features are developed once in the shared codebase.
 * 2. Automatic Rollout: Once deployed to production, every eligible user receives the
 *    feature immediately without individual device configurations or manual updates.
 * 3. Feature Flags vs Authorization (STRICT SEPARATION):
 *    - Feature flags (`enabled`) control deployment readiness, staged rollouts, and kill switches.
 *    - Authorization (`authorized`) controls role-based access permissions (e.g. admin vs staff).
 *    - CRITICAL: Hiding a UI element behind a feature flag or gate is a client-side presentation
 *      convenience. It NEVER replaces server-side Firestore Security Rules or backend validation.
 * 4. Safe Configuration Propagation: Remote manifest overrides can disable a feature in an
 *    emergency without requiring a full code rebuild.
 */

import { useState, useEffect } from 'react';
import { type UserRole, type AppUser } from '../types/auth.types';
import { getRuntimeEnvironment, type RuntimeEnvironment } from './distribution';

export type FeatureKey =
  | 'share_bill_jpg'
  | 'daily_expense_tracker'
  | 'balance_receivable_report'
  | 'expense_void_audit'
  | 'csv_exports'
  | 'product_sales_report'
  | 'division_breakdown'
  | 'daily_billing'
  | 'client_ledger'
  | 'bulk_ordering'
  | 'payments_collection'
  | 'staff_management'
  | 'client_management'
  | 'product_management'
  | 'trash_recovery'
  | 'app_update_system'
  | 'windows_desktop_updater'
  | 'android_native_updater';

export type FeatureCategory = 'billing' | 'operations' | 'reports' | 'admin' | 'distribution';
export type FeatureStage = 'production' | 'staged_rollout' | 'beta' | 'disabled';

export interface FeatureDefinition {
  key: FeatureKey;
  name: string;
  description: string;
  category: FeatureCategory;
  stage: FeatureStage;
  defaultEnabled: boolean;
  minVersion?: string;
  allowedRoles?: UserRole[];
  supportedRuntimes?: RuntimeEnvironment[];
}

export interface FeatureEvaluationContext {
  user?: AppUser | null;
  runtime?: RuntimeEnvironment;
  currentVersion?: string;
}

export interface FeatureAccessResult {
  isEnabled: boolean;
  isAuthorized: boolean;
  canAccess: boolean;
  reason?: string;
}

/**
 * Authoritative Canonical Feature Registry.
 * All production-ready features have defaultEnabled: true so they are
 * immediately available to all eligible users upon production release.
 */
export const FEATURE_REGISTRY: Record<FeatureKey, FeatureDefinition> = {
  product_sales_report: {
    key: 'product_sales_report',
    name: 'Product Sales Report',
    description: 'Product-wise sales aggregation, division breakdowns, subtotal reconciliation, CSV and print exports.',
    category: 'reports',
    stage: 'production',
    defaultEnabled: true,
    minVersion: '1.0.9',
    allowedRoles: ['admin'],
  },
  division_breakdown: {
    key: 'division_breakdown',
    name: 'Primary & Bakery Division Breakdown',
    description: 'Strict separation of Primary Foods (Kuboos, Roomali, Wheat Kuboos) and Bakery Foods (Soft Kuboos, etc.).',
    category: 'billing',
    stage: 'production',
    defaultEnabled: true,
    minVersion: '1.0.8',
  },
  share_bill_jpg: {
    key: 'share_bill_jpg',
    name: 'Share Bill as JPG Image',
    description: 'Generates a single high-quality JPG image of bills for instant sharing via WhatsApp or direct download.',
    category: 'billing',
    stage: 'production',
    defaultEnabled: true,
  },
  daily_billing: {
    key: 'daily_billing',
    name: 'Daily Billing Engine',
    description: 'Route-based order generation, daily delivery entries, invoice printing, and price recalculations.',
    category: 'billing',
    stage: 'production',
    defaultEnabled: true,
  },
  client_ledger: {
    key: 'client_ledger',
    name: 'Client Statement & Ledger',
    description: 'Comprehensive financial statement with opening balance, billings, and payment reconciliations.',
    category: 'operations',
    stage: 'production',
    defaultEnabled: true,
  },
  bulk_ordering: {
    key: 'bulk_ordering',
    name: 'Bulk Order Entry',
    description: 'High-speed spreadsheet-style batch order entry across delivery routes.',
    category: 'operations',
    stage: 'production',
    defaultEnabled: true,
    allowedRoles: ['admin'],
  },
  payments_collection: {
    key: 'payments_collection',
    name: 'Payments Collection',
    description: 'Receipt generation, cash/online collection recording, and outstanding balance tracking.',
    category: 'operations',
    stage: 'production',
    defaultEnabled: true,
  },
  staff_management: {
    key: 'staff_management',
    name: 'Staff Account Management',
    description: 'Admin provisioning of staff accounts and role assignments.',
    category: 'admin',
    stage: 'production',
    defaultEnabled: true,
    allowedRoles: ['admin'],
  },
  client_management: {
    key: 'client_management',
    name: 'Client Master Data',
    description: 'Client profile creation, pricing configurations, and opening balance settings.',
    category: 'operations',
    stage: 'production',
    defaultEnabled: true,
  },
  product_management: {
    key: 'product_management',
    name: 'Product Catalog',
    description: 'Product item definitions, unit types, standard pricing, and division mapping.',
    category: 'admin',
    stage: 'production',
    defaultEnabled: true,
    allowedRoles: ['admin'],
  },
  trash_recovery: {
    key: 'trash_recovery',
    name: 'Trash & Soft-Delete Recovery',
    description: 'Safe restoration of mistakenly soft-deleted orders, clients, or products.',
    category: 'admin',
    stage: 'production',
    defaultEnabled: true,
    allowedRoles: ['admin'],
  },
  app_update_system: {
    key: 'app_update_system',
    name: 'Application Update System',
    description: 'Centralized version manifest discovery, proactive update notifications, and safe reload with dirty-form protection.',
    category: 'distribution',
    stage: 'production',
    defaultEnabled: true,
  },
  windows_desktop_updater: {
    key: 'windows_desktop_updater',
    name: 'Windows Desktop Auto-Updater',
    description: 'Background download and in-app launch of NSIS Setup.exe installer for Windows desktop app.',
    category: 'distribution',
    stage: 'production',
    defaultEnabled: true,
    supportedRuntimes: ['electron'],
  },
  android_native_updater: {
    key: 'android_native_updater',
    name: 'Android Native APK Updater',
    description: 'In-app download and native Android package installer intent execution for APK release.',
    category: 'distribution',
    stage: 'production',
    defaultEnabled: true,
    supportedRuntimes: ['capacitor'],
  },
  daily_expense_tracker: {
    key: 'daily_expense_tracker',
    name: 'Daily Expense Tracker',
    description: 'Operational expense logging, admin attribution, 2:00 AM IST business-day tracking, and daily reporting.',
    category: 'operations',
    stage: 'production',
    defaultEnabled: true,
  },
  balance_receivable_report: {
    key: 'balance_receivable_report',
    name: 'Division-wise Balance Receivable Report',
    description: 'Outstanding balance calculations across ALL, Primary Foods, and Bakery Foods with invoice breakdown.',
    category: 'reports',
    stage: 'production',
    defaultEnabled: true,
    minVersion: '1.0.12',
    allowedRoles: ['admin'],
  },
  expense_void_audit: {
    key: 'expense_void_audit',
    name: 'Admin Expense Void & Audit Trail',
    description: 'Admin-only expense voiding with mandatory reason, immutable audit history, and active total isolation.',
    category: 'operations',
    stage: 'production',
    defaultEnabled: true,
    minVersion: '1.0.12',
    allowedRoles: ['admin'],
  },
  csv_exports: {
    key: 'csv_exports',
    name: 'Staff Collections & Expense CSV Downloads',
    description: 'Excel-compatible RFC 4180 CSV exports with UTF-8 BOM, formula-injection protection, and reconciled totals.',
    category: 'reports',
    stage: 'production',
    defaultEnabled: true,
    minVersion: '1.0.12',
  },
};

// Memory-cached dynamic runtime overrides (from version manifest or emergency config)
let remoteFeatureOverrides: Record<string, boolean> = {};
const featureChangeListeners = new Set<() => void>();

function notifyFeatureListeners() {
  featureChangeListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // ignore
    }
  });
}

/**
 * Subscribes to feature flag configuration changes.
 */
export function subscribeToFeatures(callback: () => void): () => void {
  featureChangeListeners.add(callback);
  return () => {
    featureChangeListeners.delete(callback);
  };
}

/**
 * Sets runtime feature overrides (e.g. delivered via remote version.json manifest).
 * Ensures safe propagation without requiring a code deploy.
 */
export function applyRemoteFeatureOverrides(overrides?: Record<string, boolean> | null): void {
  if (!overrides || typeof overrides !== 'object') return;
  remoteFeatureOverrides = { ...overrides };
  notifyFeatureListeners();
}

/**
 * Returns current dynamic overrides.
 */
export function getFeatureOverrides(): Record<string, boolean> {
  return { ...remoteFeatureOverrides };
}

/**
 * Clears any dynamic runtime overrides.
 */
export function clearFeatureOverrides(): void {
  remoteFeatureOverrides = {};
  notifyFeatureListeners();
}

/**
 * Returns the definition for a specific feature.
 */
export function getFeatureDefinition(key: FeatureKey): FeatureDefinition | undefined {
  return FEATURE_REGISTRY[key];
}

/**
 * Evaluates whether a feature is globally or conditionally enabled.
 * NOTE: This checks feature rollout readiness, NOT user authorization.
 */
export function isFeatureEnabled(key: FeatureKey, context?: FeatureEvaluationContext): boolean {
  const def = FEATURE_REGISTRY[key];
  if (!def) return false;

  // 1. Check remote runtime override first (e.g. emergency kill switch)
  if (typeof remoteFeatureOverrides[key] === 'boolean') {
    return remoteFeatureOverrides[key];
  }

  // 2. Disabled stage
  if (def.stage === 'disabled') {
    return false;
  }

  // 3. Supported runtime check (if platform-specific)
  if (def.supportedRuntimes && def.supportedRuntimes.length > 0) {
    const activeRuntime = context?.runtime || getRuntimeEnvironment();
    if (!def.supportedRuntimes.includes(activeRuntime)) {
      return false;
    }
  }

  return def.defaultEnabled;
}

/**
 * Comprehensive feature access check.
 * Strictly separates feature enablement from role authorization.
 */
export function checkFeatureAccess(
  key: FeatureKey,
  user?: AppUser | null,
  context?: FeatureEvaluationContext
): FeatureAccessResult {
  const def = FEATURE_REGISTRY[key];
  if (!def) {
    return {
      isEnabled: false,
      isAuthorized: false,
      canAccess: false,
      reason: `Unknown feature key: ${key}`,
    };
  }

  const enabled = isFeatureEnabled(key, { ...context, user });

  // Role authorization check
  let authorized = true;
  let reason: string | undefined;

  if (def.allowedRoles && def.allowedRoles.length > 0) {
    if (!user) {
      authorized = false;
      reason = 'Authentication required';
    } else if (!def.allowedRoles.includes(user.role)) {
      authorized = false;
      reason = `Feature restricted to roles: ${def.allowedRoles.join(', ')}`;
    }
  }

  return {
    isEnabled: enabled,
    isAuthorized: authorized,
    canAccess: enabled && authorized,
    reason: !enabled ? `Feature '${def.name}' is currently disabled in this environment` : reason,
  };
}

/**
 * React hook to reactively query a feature's access status.
 */
export function useFeature(key: FeatureKey, user?: AppUser | null) {
  const [, setTick] = useState(0);

  useEffect(() => {
    return subscribeToFeatures(() => {
      setTick((t) => t + 1);
    });
  }, []);

  return checkFeatureAccess(key, user);
}

/**
 * React hook to inspect all registered features.
 */
export function useAllFeatures(user?: AppUser | null) {
  const [, setTick] = useState(0);

  useEffect(() => {
    return subscribeToFeatures(() => {
      setTick((t) => t + 1);
    });
  }, []);

  const results: Record<FeatureKey, FeatureAccessResult> = {} as any;
  (Object.keys(FEATURE_REGISTRY) as FeatureKey[]).forEach((key) => {
    results[key] = checkFeatureAccess(key, user);
  });
  return results;
}

/**
 * Declarative FeatureGate component.
 * Conditionally renders children if the feature is enabled and the user is authorized.
 */
export function FeatureGate({
  feature,
  user,
  fallback = null,
  children,
}: {
  feature: FeatureKey;
  user?: AppUser | null;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { canAccess } = useFeature(feature, user);
  if (!canAccess) {
    return (fallback ?? null) as React.ReactElement | null;
  }
  return (children ?? null) as React.ReactElement | null;
}
