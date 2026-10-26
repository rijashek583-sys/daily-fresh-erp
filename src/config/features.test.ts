import { describe, it, expect, beforeEach } from 'vitest';
import {
  FEATURE_REGISTRY,
  isFeatureEnabled,
  checkFeatureAccess,
  applyRemoteFeatureOverrides,
  clearFeatureOverrides,
  getFeatureDefinition,
  type FeatureKey,
} from './features';
import { type AppUser } from '../types/auth.types';

describe('Centralized Feature Registry & Rollout System', () => {
  beforeEach(() => {
    clearFeatureOverrides();
  });

  const adminUser: AppUser = {
    uid: 'u_admin',
    name: 'Admin User',
    displayName: 'Admin',
    email: 'admin@dailyfresh.com',
    role: 'admin',
    photoURL: null,
    status: 'active',
  };

  const staffUser: AppUser = {
    uid: 'u_staff',
    name: 'Staff Member',
    displayName: 'Staff',
    email: 'staff@dailyfresh.com',
    role: 'staff',
    photoURL: null,
    status: 'active',
  };

  describe('1. Canonical Feature Definitions & Rollout Readiness', () => {
    it('contains all core ERP features in the registry', () => {
      const expectedKeys: FeatureKey[] = [
        'product_sales_report',
        'division_breakdown',
        'share_bill_jpg',
        'daily_expense_tracker',
        'balance_receivable_report',
        'expense_void_audit',
        'csv_exports',
        'daily_billing',
        'client_ledger',
        'bulk_ordering',
        'payments_collection',
        'staff_management',
        'client_management',
        'product_management',
        'trash_recovery',
        'app_update_system',
        'windows_desktop_updater',
        'android_native_updater',
      ];

      expectedKeys.forEach((key) => {
        const def = getFeatureDefinition(key);
        expect(def, `Feature '${key}' must exist in registry`).toBeDefined();
        expect(def?.key).toBe(key);
        expect(def?.name).toBeTruthy();
        expect(def?.description).toBeTruthy();
      });
    });

    it('enables all production-stage ERP features by default for universal rollout', () => {
      expect(isFeatureEnabled('product_sales_report')).toBe(true);
      expect(isFeatureEnabled('division_breakdown')).toBe(true);
      expect(isFeatureEnabled('daily_billing')).toBe(true);
      expect(isFeatureEnabled('client_ledger')).toBe(true);
      expect(isFeatureEnabled('payments_collection')).toBe(true);
      expect(isFeatureEnabled('app_update_system')).toBe(true);
    });
  });

  describe('2. Separation of Feature Flags vs Role Authorization', () => {
    it('grants access to admin for admin-restricted feature (product_sales_report)', () => {
      const res = checkFeatureAccess('product_sales_report', adminUser);
      expect(res.isEnabled).toBe(true);
      expect(res.isAuthorized).toBe(true);
      expect(res.canAccess).toBe(true);
      expect(res.reason).toBeUndefined();
    });

    it('denies access to staff for admin-restricted feature while keeping feature flag enabled', () => {
      const res = checkFeatureAccess('product_sales_report', staffUser);
      expect(res.isEnabled).toBe(true); // Feature is enabled in deployment
      expect(res.isAuthorized).toBe(false); // Staff is not authorized
      expect(res.canAccess).toBe(false); // Net access is denied
      expect(res.reason).toContain('restricted to roles: admin');
    });

    it('denies unauthenticated users for role-restricted features', () => {
      const res = checkFeatureAccess('staff_management', null);
      expect(res.isEnabled).toBe(true);
      expect(res.isAuthorized).toBe(false);
      expect(res.canAccess).toBe(false);
      expect(res.reason).toContain('Authentication required');
    });

    it('allows both admin and staff for unrestricted features (daily_billing, payments_collection)', () => {
      const adminBilling = checkFeatureAccess('daily_billing', adminUser);
      const staffBilling = checkFeatureAccess('daily_billing', staffUser);

      expect(adminBilling.canAccess).toBe(true);
      expect(staffBilling.canAccess).toBe(true);

      const adminPayments = checkFeatureAccess('payments_collection', adminUser);
      const staffPayments = checkFeatureAccess('payments_collection', staffUser);

      expect(adminPayments.canAccess).toBe(true);
      expect(staffPayments.canAccess).toBe(true);
    });
  });

  describe('3. Dynamic Remote Overrides (Emergency Kill Switch)', () => {
    it('disables a feature dynamically when remote manifest sends override false', () => {
      expect(isFeatureEnabled('bulk_ordering')).toBe(true);

      applyRemoteFeatureOverrides({ bulk_ordering: false });

      expect(isFeatureEnabled('bulk_ordering')).toBe(false);
      const res = checkFeatureAccess('bulk_ordering', adminUser);
      expect(res.isEnabled).toBe(false);
      expect(res.isAuthorized).toBe(true);
      expect(res.canAccess).toBe(false);
      expect(res.reason).toContain('disabled');
    });

    it('restores default state when overrides are cleared', () => {
      applyRemoteFeatureOverrides({ product_sales_report: false });
      expect(isFeatureEnabled('product_sales_report')).toBe(false);

      clearFeatureOverrides();
      expect(isFeatureEnabled('product_sales_report')).toBe(true);
    });

    it('gracefully handles null or invalid override objects', () => {
      expect(() => applyRemoteFeatureOverrides(null)).not.toThrow();
      expect(() => applyRemoteFeatureOverrides(undefined)).not.toThrow();
      expect(isFeatureEnabled('daily_billing')).toBe(true);
    });
  });

  describe('4. Platform Runtime Filtering', () => {
    it('only enables windows_desktop_updater on electron runtime', () => {
      expect(isFeatureEnabled('windows_desktop_updater', { runtime: 'electron' })).toBe(true);
      expect(isFeatureEnabled('windows_desktop_updater', { runtime: 'web' })).toBe(false);
      expect(isFeatureEnabled('windows_desktop_updater', { runtime: 'capacitor' })).toBe(false);
    });

    it('only enables android_native_updater on capacitor runtime', () => {
      expect(isFeatureEnabled('android_native_updater', { runtime: 'capacitor' })).toBe(true);
      expect(isFeatureEnabled('android_native_updater', { runtime: 'web' })).toBe(false);
      expect(isFeatureEnabled('android_native_updater', { runtime: 'electron' })).toBe(false);
    });
  });
});
