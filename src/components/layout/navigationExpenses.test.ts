import { describe, it, expect } from 'vitest';
import sidebarCode from './Sidebar.tsx?raw';
import mobileSidebarCode from './MobileSidebar.tsx?raw';
import bottomNavCode from './StaffBottomNav.tsx?raw';
import routerCode from '../../app/router.tsx?raw';

describe('Navigation Structure & Role Visibility for Expenses', () => {
  it('includes Expenses in desktop Sidebar for Admin between Daily Bill and Client Ledger', () => {
    expect(sidebarCode).toContain('ReceiptText');

    const dailyBillIdx = sidebarCode.indexOf("{ label: 'Daily Bill', href: '/billing'");
    const expensesIdx = sidebarCode.indexOf("{ label: 'Expenses', href: '/expenses', icon: ReceiptText }");
    const ledgerIdx = sidebarCode.indexOf("{ label: 'Client Ledger', href: '/ledger'");

    expect(dailyBillIdx).toBeGreaterThan(-1);
    expect(expensesIdx).toBeGreaterThan(-1);
    expect(ledgerIdx).toBeGreaterThan(-1);

    expect(dailyBillIdx).toBeLessThan(expensesIdx);
    expect(expensesIdx).toBeLessThan(ledgerIdx);
  });

  it('includes My Expenses in desktop Sidebar for Staff below Payment & Collection', () => {
    const paymentsIdx = sidebarCode.indexOf("{ label: 'Payment & Collection', href: '/payments'");
    const myExpensesIdx = sidebarCode.indexOf("{ label: 'My Expenses', href: '/expenses', icon: ReceiptText }");

    expect(paymentsIdx).toBeGreaterThan(-1);
    expect(myExpensesIdx).toBeGreaterThan(-1);
    expect(paymentsIdx).toBeLessThan(myExpensesIdx);
  });

  it('includes Expenses for Admin and My Expenses for Staff in MobileSidebar drawer', () => {
    expect(mobileSidebarCode).toContain('ReceiptText');
    expect(mobileSidebarCode).toContain("{ label: 'Expenses', href: '/expenses', icon: ReceiptText }");
    expect(mobileSidebarCode).toContain("{ label: 'My Expenses', href: '/expenses', icon: ReceiptText }");
  });

  it('preserves mobile bottom bar without adding extra tab for expenses', () => {
    expect(bottomNavCode).not.toContain('/expenses');
    expect(bottomNavCode).toContain('const staffBottomNavItems');
    // Verify 3 tabs for staff
    const staffMatch = bottomNavCode.match(/const staffBottomNavItems: NavItem\[\] = \[([\s\S]*?)\];/);
    expect(staffMatch).not.toBeNull();
    const staffItems = (staffMatch![1].match(/label:/g) || []).length;
    expect(staffItems).toBe(3);
  });

  it('registers /expenses in router.tsx', () => {
    expect(routerCode).toContain("const ExpensesPage = safeLazy(() => import('../features/expenses/ExpensesPage')");
    expect(routerCode).toContain("{ path: '/expenses', element: <SuspenseWrapper><ExpensesPage /></SuspenseWrapper> }");
  });
});
