import { describe, it, expect } from 'vitest';
import {
  sanitizeCsvCell,
  calculatePaymentAllocation,
  resolveCollectorIdentity,
  generateStaffCollectionsCsv,
  generateExpensesCsv,
  formatDateTime,
  formatDateOnly,
} from './csvExport';
import { type Payment, type User } from '../types';
import { type ExpenseDocument } from '../types/expense.types';

describe('CSV Export Engine', () => {
  describe('sanitizeCsvCell & Security Protections', () => {
    it('returns empty quoted string for null and undefined', () => {
      expect(sanitizeCsvCell(null)).toBe('""');
      expect(sanitizeCsvCell(undefined)).toBe('""');
    });

    it('returns standard numeric strings for numbers', () => {
      expect(sanitizeCsvCell(1250.5)).toBe('1250.5');
      expect(sanitizeCsvCell(0)).toBe('0');
      expect(sanitizeCsvCell(NaN)).toBe('0');
    });

    it('neutralizes spreadsheet formula injection (=, +, -, @, \\t, \\r)', () => {
      expect(sanitizeCsvCell('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
      expect(sanitizeCsvCell('+1234567890')).toBe('"\' +1234567890"'.replace(/ /g, ''));
      expect(sanitizeCsvCell('-cmd|"/C calc"!A0')).toBe('"\'-cmd|""/C calc""!A0"');
      expect(sanitizeCsvCell('@IMPORTXML("url")')).toBe('\"\'@IMPORTXML(\"\"url\"\")\"');
      expect(sanitizeCsvCell('\tmalicious')).toBe('\"\'\tmalicious\"');
      expect(sanitizeCsvCell('\rmalicious')).toBe('\"\'\rmalicious\"');
    });

    it('preserves valid numeric negative strings without corruption', () => {
      // Pure numeric strings like "-150.50" are recognized as numbers
      expect(sanitizeCsvCell('-150.50')).toBe('-150.50');
      expect(sanitizeCsvCell('100.00')).toBe('100.00');
    });

    it('escapes quotes and wraps strings with commas or quotes according to RFC 4180', () => {
      expect(sanitizeCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(sanitizeCsvCell('Hello "Quoted" World')).toBe('"Hello ""Quoted"" World"');
      expect(sanitizeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('formats dates consistently', () => {
      expect(formatDateOnly('2026-10-26T10:30:00Z')).toBe('2026-10-26');
      expect(formatDateOnly('2026-10-26')).toBe('2026-10-26');
      expect(formatDateOnly(null)).toBe('—');
    });
  });

  describe('Feature 3A — Staff Collection CSV Export', () => {
    const mockStaffUsers: User[] = [
      {
        uid: 'staff_1',
        name: 'Rahul Kumar',
        displayName: 'Rahul',
        email: 'rahul@dailyfresh.test',
        role: 'staff',
        status: 'active',
        createdAt: '2026-01-01',
      },
      {
        uid: 'staff_2',
        name: 'Vipin Das',
        displayName: 'Vipin',
        email: 'vipin@dailyfresh.test',
        role: 'delivery_staff',
        status: 'active',
        createdAt: '2026-01-01',
      },
    ];

    it('calculates integer paise allocation strictly for Primary, Bakery and Cross-Division payments', () => {
      // 1. Pure Primary
      const p1: Payment = {
        id: 'pay_1',
        amount: 500,
        division: 'primary',
        clientId: 'c1',
        clientName: 'Shop A',
        method: 'cash',
        createdAt: '2026-10-26T10:00:00Z',
      };
      const alloc1 = calculatePaymentAllocation(p1);
      expect(alloc1.amountPaise).toBe(50000);
      expect(alloc1.primaryPaise).toBe(50000);
      expect(alloc1.bakeryPaise).toBe(0);
      expect(alloc1.primaryPaise + alloc1.bakeryPaise).toBe(alloc1.amountPaise);

      // 2. Pure Bakery
      const p2: Payment = {
        id: 'pay_2',
        amount: 350.5,
        division: 'bakery',
        clientId: 'c2',
        clientName: 'Shop B',
        method: 'upi',
        createdAt: '2026-10-26T11:00:00Z',
      };
      const alloc2 = calculatePaymentAllocation(p2);
      expect(alloc2.amountPaise).toBe(35050);
      expect(alloc2.primaryPaise).toBe(0);
      expect(alloc2.bakeryPaise).toBe(35050);
      expect(alloc2.primaryPaise + alloc2.bakeryPaise).toBe(alloc2.amountPaise);

      // 3. Primary payment with cross-division allocation to bakery otherInvoiceId
      const p3: Payment = {
        id: 'pay_3',
        amount: 1000,
        division: 'primary',
        clientId: 'c3',
        clientName: 'Shop C',
        method: 'upi',
        invoiceId: 'inv_prim_1',
        otherInvoiceId: 'inv_bake_1',
        appliedAmount: 600,
        appliedToOtherBill: 400,
        createdAt: '2026-10-26T12:00:00Z',
      };
      const alloc3 = calculatePaymentAllocation(p3);
      expect(alloc3.amountPaise).toBe(100000);
      expect(alloc3.primaryPaise).toBe(60000);
      expect(alloc3.bakeryPaise).toBe(40000);
      expect(alloc3.primaryPaise + alloc3.bakeryPaise).toBe(alloc3.amountPaise);
    });

    it('identifies Admin-recorded collections clearly when All Collectors is selected', () => {
      // Admin payment
      const adminPay: Payment = {
        id: 'pay_admin_1',
        amount: 800,
        division: 'primary',
        clientId: 'c1',
        clientName: 'Shop A',
        method: 'cash',
        staffId: 'admin_uid_999',
        staffName: 'Admin Rijash',
        recordedBy: 'Admin Rijash',
        createdAt: '2026-10-26T10:00:00Z',
      };
      const adminIdentity = resolveCollectorIdentity(adminPay, mockStaffUsers);
      expect(adminIdentity.collectorRole).toBe('Admin');
      expect(adminIdentity.isIdentifiedAsAdmin).toBe(true);
      expect(adminIdentity.collectorName).toContain('Admin');

      // Staff payment
      const staffPay: Payment = {
        id: 'pay_staff_1',
        amount: 300,
        division: 'bakery',
        clientId: 'c2',
        clientName: 'Shop B',
        method: 'upi',
        staffId: 'staff_1',
        staffName: 'Rahul Kumar',
        recordedBy: 'Rahul Kumar',
        createdAt: '2026-10-26T10:30:00Z',
      };
      const staffIdentity = resolveCollectorIdentity(staffPay, mockStaffUsers);
      expect(staffIdentity.collectorRole).toBe('Staff');
      expect(staffIdentity.isIdentifiedAsAdmin).toBe(false);
      expect(staffIdentity.collectorName).toBe('Rahul Kumar');
    });

    it('generates Excel UTF-8 BOM, required columns, and reconciled summary for staff collections', () => {
      const samplePayments: Payment[] = [
        {
          id: 'pay_001',
          amount: 500,
          division: 'primary',
          clientId: 'client_101',
          clientName: 'Green Valley Mart',
          method: 'cash',
          reference: 'RCP-001',
          staffId: 'staff_1',
          staffName: 'Rahul Kumar',
          invoiceId: 'INV-101',
          billDate: '2026-10-26',
          createdAt: '2026-10-26T09:15:00Z',
        },
        {
          id: 'pay_002',
          amount: 750,
          division: 'bakery',
          clientId: 'client_102',
          clientName: 'City Supermarket',
          method: 'upi',
          reference: 'UPI/998877/UTR',
          staffId: 'admin_01',
          staffName: 'Admin Office',
          invoiceId: 'INV-102',
          otherInvoiceId: 'INV-103',
          appliedAmount: 450,
          appliedToOtherBill: 300,
          billDate: '2026-10-26',
          createdAt: '2026-10-26T11:45:00Z',
          isCorrected: true,
          originalAmount: 850,
          correctionReason: 'Typo during invoice entry',
        },
      ];

      const res = generateStaffCollectionsCsv(samplePayments, {
        dateLabel: '2026-10-26',
        divisionFilter: 'all',
        staffFilterLabel: 'All Staff',
        staffUsers: mockStaffUsers,
      });

      // 1. Excel UTF-8 BOM
      expect(res.csv.startsWith('\uFEFF')).toBe(true);

      // 2. Contains headers
      expect(res.csv).toContain('"Collection Date & Time"');
      expect(res.csv).toContain('"Delivery / Bill Date"');
      expect(res.csv).toContain('"Collector Name"');
      expect(res.csv).toContain('"Collector Role"');
      expect(res.csv).toContain('"Collector ID"');
      expect(res.csv).toContain('"Customer Name"');
      expect(res.csv).toContain('"Customer ID"');
      expect(res.csv).toContain('"Payment ID"');
      expect(res.csv).toContain('"Payment Reference"');
      expect(res.csv).toContain('"Payment Method"');
      expect(res.csv).toContain('"Total Collected (INR)"');
      expect(res.csv).toContain('"Primary Foods Allocated (INR)"');
      expect(res.csv).toContain('"Bakery Foods Allocated (INR)"');
      expect(res.csv).toContain('"Related Invoices / Orders"');
      expect(res.csv).toContain('"Payment Correction Status"');

      // 3. Totals reconciliation
      // Pay 1: 500 total, 500 primary, 0 bakery
      // Pay 2: 750 total, division bakery with 300 applied to other bill (primary) -> 300 primary, 450 bakery
      // Sum: 1250 total, 800 primary, 450 bakery
      expect(res.totalCollected).toBe(1250);
      expect(res.primaryAllocated).toBe(800);
      expect(res.bakeryAllocated).toBe(450);
      expect(res.primaryAllocated + res.bakeryAllocated).toBe(res.totalCollected);

      // 4. Correction status verification
      expect(res.csv).toContain('Corrected (Original: INR 850.00 Reason: Typo during invoice entry)');

      // 5. Admin clear identification
      expect(res.csv).toContain('"Admin"');
      expect(res.csv).toContain('"Admin Office"');

      // 6. Multiple invoices linked in 1 row without row duplication
      expect(res.csv).toContain('"INV-102, INV-103"');
      expect(res.recordCount).toBe(2);
    });

    it('handles empty payments list gracefully', () => {
      const res = generateStaffCollectionsCsv([], {
        dateLabel: '2026-10-26',
        divisionFilter: 'primary',
      });
      expect(res.csv.startsWith('\uFEFF')).toBe(true);
      expect(res.totalCollected).toBe(0);
      expect(res.recordCount).toBe(0);
      expect(res.csv).toContain('"Total Records Exported","0"');
    });
  });

  describe('Feature 3B — All Expenses CSV Export', () => {
    const sampleExpenses: ExpenseDocument[] = [
      {
        id: 'exp_001',
        businessDay: '2026-10-26',
        category: 'CNG',
        customExpenseName: 'Morning Delivery Van 1',
        amount: 450,
        notes: 'Filled at Pump 4',
        createdBy: 'staff_1',
        creatorName: 'Rahul Kumar',
        creatorRole: 'staff',
        createdAt: '2026-10-26T06:00:00Z',
        updatedAt: '2026-10-26T06:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: 'exp_002',
        businessDay: '2026-10-26',
        category: 'Daily Food Expense',
        amount: 200,
        notes: 'Lunch for delivery crew',
        createdBy: 'admin_1',
        creatorName: 'Admin',
        creatorRole: 'admin',
        adminName: 'Rijash EK',
        createdAt: '2026-10-26T13:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
      },
      {
        id: 'exp_003_voided',
        businessDay: '2026-10-26',
        category: 'Petrol',
        customExpenseName: 'Accidental Duplicate Entry',
        amount: 1500,
        notes: 'Wrong amount entered',
        createdBy: 'staff_1',
        creatorName: 'Rahul Kumar',
        creatorRole: 'staff',
        createdAt: '2026-10-26T10:00:00Z',
        isEdited: false,
        editCount: 0,
        auditTrail: [],
        isVoided: true,
        voidReason: 'Duplicate bill entered by mistake',
        voidedAt: '2026-10-26T11:00:00Z',
        voidedByUid: 'admin_1',
        voidedByName: 'Rijash EK',
        voidedByAdminName: 'Rijash EK',
        voidedByRole: 'admin',
      },
    ];

    it('exports active expenses by default, strictly excluding voided expenses from financial totals', () => {
      // Export without voided expenses (default)
      const res = generateExpensesCsv(sampleExpenses, {
        isAdmin: true,
        dateLabel: '2026-10-26',
        includeVoided: false,
      });

      expect(res.csv.startsWith('\uFEFF')).toBe(true);
      expect(res.activeTotalAmount).toBe(650); // 450 + 200 (1500 voided excluded!)
      expect(res.activeCount).toBe(2);
      expect(res.voidedCount).toBe(0);
      expect(res.totalRecords).toBe(2);

      // Verify the voided expense row is NOT present
      expect(res.csv).not.toContain('exp_003_voided');
      expect(res.csv).not.toContain('Duplicate bill entered by mistake');
      expect(res.csv).toContain('450.00');
      expect(res.csv).toContain('200.00');
    });

    it('allows Admin to export all expenses including voided when explicitly requested, without contaminating active totals', () => {
      const res = generateExpensesCsv(sampleExpenses, {
        isAdmin: true,
        dateLabel: '2026-10-26',
        includeVoided: true,
      });

      // 1. Records count
      expect(res.activeCount).toBe(2);
      expect(res.voidedCount).toBe(1);
      expect(res.totalRecords).toBe(3);

      // 2. CRITICAL: Active total remains 650.00 — strictly excludes the 1500.00 voided expense!
      expect(res.activeTotalAmount).toBe(650);

      // 3. Voided details are present for audit
      expect(res.csv).toContain('"exp_003_voided"');
      expect(res.csv).toContain('"Voided"');
      expect(res.csv).toContain('"Duplicate bill entered by mistake"');
      expect(res.csv).toContain('"Rijash EK"');

      // 4. Operator attribution for admin records
      expect(res.csv).toContain('"Admin (Rijash EK)"');

      // 5. Active totals clearly summarized
      expect(res.csv).toContain('"Active Expense Total (INR)","650.00"');
      expect(res.csv).toContain('"Voided Records Count (Excluded from Total)","1"');
    });

    it('prevents non-admin staff from exporting voided expenses even if requested', () => {
      const res = generateExpensesCsv(sampleExpenses, {
        isAdmin: false, // Staff user
        dateLabel: '2026-10-26',
        includeVoided: true, // Non-admin should not get voided
      });

      expect(res.voidedCount).toBe(0);
      expect(res.totalRecords).toBe(2);
      expect(res.csv).not.toContain('exp_003_voided');
    });

    it('handles empty expense list gracefully', () => {
      const res = generateExpensesCsv([], {
        isAdmin: true,
        dateLabel: '2026-10-26',
      });
      expect(res.csv.startsWith('\uFEFF')).toBe(true);
      expect(res.activeTotalAmount).toBe(0);
      expect(res.totalRecords).toBe(0);
      expect(res.csv).toContain('"Total Exported Records","0"');
    });
  });
});
