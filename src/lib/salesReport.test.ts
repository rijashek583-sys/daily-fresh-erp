import { describe, it, expect } from 'vitest';
import {
  calculateProductSalesReport,
  getDateRangeBoundaries,
  isOrderValidForSales,
  resolveLineItemTotal,
  resolveItemDivision,
  sanitizeCsvCell,
  generateSalesReportCsv,
  renderSalesReportPrintHtml,
  type SalesReportFilter,
} from './salesReport';
import { type Order, type Product } from '../types';

// Mock catalog products
const mockProducts: Product[] = [
  { id: 'prod_kuboos', name: 'Kuboos', status: 'active', displayOrder: 1, division: 'primary', unit: 'pkt' },
  { id: 'prod_roomali', name: 'Roomali', status: 'active', displayOrder: 2, division: 'primary', unit: 'pkt' },
  { id: 'prod_wheat_kuboos', name: 'Wheat Kuboos', status: 'active', displayOrder: 3, division: 'primary', unit: 'pkt' },
  { id: 'prod_soft_kuboos', name: 'Soft Kuboos', status: 'active', displayOrder: 4, division: 'bakery', unit: 'pkt' },
  { id: 'prod_poratta', name: 'Poratta', status: 'active', displayOrder: 5, division: 'bakery', unit: 'pkt' },
  { id: 'prod_burger_bun', name: 'Burger Bun', status: 'active', displayOrder: 6, division: 'bakery', unit: 'pkt' },
  { id: 'prod_milk_bread', name: 'Milk Bread', status: 'active', displayOrder: 7, division: 'bakery', unit: 'loaf' },
];

// Helper to construct sample orders
const createMockOrder = (overrides: Partial<Order> = {}): Order => ({
  id: overrides.id || `ord_${Math.random().toString(36).substring(2, 9)}`,
  clientId: overrides.clientId || 'client_1',
  clientName: overrides.clientName || 'Test Client',
  deliveryDate: overrides.deliveryDate || '2026-10-23',
  createdAt: overrides.createdAt || '2026-10-23T08:00:00.000Z',
  updatedAt: overrides.updatedAt || '2026-10-23T08:00:00.000Z',
  subtotal: overrides.subtotal || 100,
  tax: overrides.tax || 0,
  total: overrides.total || 100,
  paymentStatus: overrides.paymentStatus || 'pending',
  items: overrides.items || [
    { productId: 'prod_kuboos', productName: 'Kuboos', qty: 10, unitPrice: 10, total: 100 },
  ],
  ...overrides,
});

describe('Product Sales Report — Business Calculations & Validity', () => {
  // ── 1. Order Validity & Exclusion Rules ────────────────────────────────────
  describe('Order validity filter', () => {
    it('includes valid orders regardless of payment status (pending, partial, paid)', () => {
      const pendingOrd = createMockOrder({ id: 'o1', paymentStatus: 'pending' });
      const partialOrd = createMockOrder({ id: 'o2', paymentStatus: 'partial' });
      const paidOrd = createMockOrder({ id: 'o3', paymentStatus: 'paid' });

      expect(isOrderValidForSales(pendingOrd)).toBe(true);
      expect(isOrderValidForSales(partialOrd)).toBe(true);
      expect(isOrderValidForSales(paidOrd)).toBe(true);
    });

    it('excludes deleted, soft-deleted, or trashed orders', () => {
      const deletedAtOrd = createMockOrder({ id: 'o_del', deletedAt: '2026-10-23T09:00:00.000Z' } as any);
      const isDeletedOrd = createMockOrder({ id: 'o_isdel', isDeleted: true } as any);
      const statusCancelledOrd = createMockOrder({ id: 'o_canc', status: 'cancelled' } as any);
      const statusDeletedOrd = createMockOrder({ id: 'o_statusdel', status: 'deleted' } as any);
      const statusTrashOrd = createMockOrder({ id: 'o_trash', status: 'trash' } as any);

      expect(isOrderValidForSales(deletedAtOrd)).toBe(false);
      expect(isOrderValidForSales(isDeletedOrd)).toBe(false);
      expect(isOrderValidForSales(statusCancelledOrd)).toBe(false);
      expect(isOrderValidForSales(statusDeletedOrd)).toBe(false);
      expect(isOrderValidForSales(statusTrashOrd)).toBe(false);
    });

    it('excludes null, undefined, or malformed orders', () => {
      expect(isOrderValidForSales(null)).toBe(false);
      expect(isOrderValidForSales(undefined)).toBe(false);
      expect(isOrderValidForSales('string')).toBe(false);
      expect(isOrderValidForSales(123)).toBe(false);
    });
  });

  // ── 2. Line Item Total & Division Resolution ──────────────────────────────
  describe('Line item calculations & division mapping', () => {
    it('uses stored line total when valid', () => {
      expect(resolveLineItemTotal({ productId: 'p1', productName: 'Kuboos', qty: 10, unitPrice: 20, total: 200 })).toBe(200);
    });

    it('falls back to qty * unitPrice when line total is missing, NaN, or undefined', () => {
      expect(resolveLineItemTotal({ productId: 'p1', productName: 'Kuboos', qty: 5, unitPrice: 15, total: undefined as any })).toBe(75);
      expect(resolveLineItemTotal({ productId: 'p1', productName: 'Kuboos', qty: 4, unitPrice: 20, total: NaN })).toBe(80);
      expect(resolveLineItemTotal({ productId: 'p1', productName: 'Kuboos', qty: 0, unitPrice: 20, total: 0 })).toBe(0);
    });

    it('maps only Kuboos, Roomali, Wheat Kuboos to primary', () => {
      expect(resolveItemDivision({ productId: 'prod_kuboos', productName: 'Kuboos', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('primary');
      expect(resolveItemDivision({ productId: 'prod_roomali', productName: 'Roomali', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('primary');
      expect(resolveItemDivision({ productId: 'prod_wheat_kuboos', productName: 'Wheat Kuboos', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('primary');
    });

    it('maps Soft Kuboos, Poratta, Burger Bun, and any other product to bakery', () => {
      expect(resolveItemDivision({ productId: 'prod_soft_kuboos', productName: 'Soft Kuboos', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
      expect(resolveItemDivision({ productId: 'prod_poratta', productName: 'Poratta', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
      expect(resolveItemDivision({ productId: 'prod_burger_bun', productName: 'Burger Bun', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
      expect(resolveItemDivision({ productId: 'unknown', productName: 'Custom Cake', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
    });

    it('resolves division when catalog product has missing, empty, or undefined division field', () => {
      const productsWithoutDiv: Product[] = [
        { id: 'p_k', name: 'Kuboos', status: 'active', displayOrder: 1 } as Product,
        { id: 'p_r', name: 'Roomali', status: 'active', displayOrder: 2, division: '' as any } as Product,
        { id: 'p_wk', name: 'Wheat Kuboos', status: 'active', displayOrder: 3, division: undefined } as Product,
        { id: 'p_sk', name: 'Soft Kuboos', status: 'active', displayOrder: 4 } as Product,
        { id: 'p_p', name: 'Poratta', status: 'active', displayOrder: 5 } as Product,
        { id: 'p_bb', name: 'Burger Bun', status: 'active', displayOrder: 6 } as Product,
      ];

      expect(resolveItemDivision({ productId: 'p_k', productName: 'Kuboos', qty: 1, unitPrice: 10, total: 10 }, productsWithoutDiv)).toBe('primary');
      expect(resolveItemDivision({ productId: 'p_r', productName: 'Roomali', qty: 1, unitPrice: 10, total: 10 }, productsWithoutDiv)).toBe('primary');
      expect(resolveItemDivision({ productId: 'p_wk', productName: 'Wheat Kuboos', qty: 1, unitPrice: 10, total: 10 }, productsWithoutDiv)).toBe('primary');
      expect(resolveItemDivision({ productId: 'p_sk', productName: 'Soft Kuboos', qty: 1, unitPrice: 10, total: 10 }, productsWithoutDiv)).toBe('bakery');
      expect(resolveItemDivision({ productId: 'p_p', productName: 'Poratta', qty: 1, unitPrice: 10, total: 10 }, productsWithoutDiv)).toBe('bakery');
      expect(resolveItemDivision({ productId: 'p_bb', productName: 'Burger Bun', qty: 1, unitPrice: 10, total: 10 }, productsWithoutDiv)).toBe('bakery');
    });

    it('resolves division when product is missing from catalog (historical / deleted product)', () => {
      // Empty catalog
      expect(resolveItemDivision({ productId: 'missing_1', productName: 'Kuboos', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('primary');
      expect(resolveItemDivision({ productId: 'missing_2', productName: 'Roomali', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('primary');
      expect(resolveItemDivision({ productId: 'missing_3', productName: 'Wheat Kuboos', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('primary');
      expect(resolveItemDivision({ productId: 'missing_4', productName: 'Soft Kuboos', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('bakery');
      expect(resolveItemDivision({ productId: 'missing_5', productName: 'Poratta', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('bakery');
      expect(resolveItemDivision({ productId: 'missing_6', productName: 'Burger Bun', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('bakery');
      expect(resolveItemDivision({ productId: 'missing_7', productName: 'Custom Roll', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('bakery');
    });

    it('handles conflicting division fields between item and catalog product (catalog precedence)', () => {
      // Item says 'primary' (legacy mistake), but catalog says 'bakery' (corrected Poratta): catalog wins
      const legacyPorattaItem = { productId: 'prod_poratta', productName: 'Poratta', division: 'primary', qty: 10, unitPrice: 15, total: 150 };
      expect(resolveItemDivision(legacyPorattaItem, mockProducts)).toBe('bakery');

      // Item says 'bakery', but catalog says 'primary' (Kuboos): catalog wins
      const legacyKuboosItem = { productId: 'prod_kuboos', productName: 'Kuboos', division: 'bakery', qty: 10, unitPrice: 10, total: 100 };
      expect(resolveItemDivision(legacyKuboosItem, mockProducts)).toBe('primary');

      // Missing catalog, but item has explicit division: item division is preserved via fallback
      expect(resolveItemDivision({ productId: 'unk', productName: 'Special Bread', division: 'bakery', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('bakery');
      expect(resolveItemDivision({ productId: 'unk', productName: 'Special Paratha', division: 'primary', qty: 1, unitPrice: 10, total: 10 }, [])).toBe('primary');
    });

    it('handles case-insensitivity and whitespace padding cleanly', () => {
      expect(resolveItemDivision({ productId: '', productName: '  kuboos  ', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('primary');
      expect(resolveItemDivision({ productId: '', productName: 'ROOMALI', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('primary');
      expect(resolveItemDivision({ productId: '', productName: 'wheat kuboos', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('primary');
      expect(resolveItemDivision({ productId: '', productName: '  soft KUBOOS  ', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
      expect(resolveItemDivision({ productId: '', productName: '  poratta  ', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
      expect(resolveItemDivision({ productId: '', productName: 'BURGER BUN', qty: 1, unitPrice: 10, total: 10 }, mockProducts)).toBe('bakery');
    });
  });

  // ── 3. Date Boundary Handling ──────────────────────────────────────────────
  describe('Date range boundaries (Asia/Kolkata)', () => {
    // Friday Oct 23, 2026 IST
    const fixedFriday = new Date('2026-10-23T11:00:00+05:30');

    it('computes today correctly', () => {
      const b = getDateRangeBoundaries('today', undefined, undefined, fixedFriday);
      expect(b.from).toBe('2026-10-23');
      expect(b.to).toBe('2026-10-23');
    });

    it('computes yesterday correctly', () => {
      const b = getDateRangeBoundaries('yesterday', undefined, undefined, fixedFriday);
      expect(b.from).toBe('2026-10-22');
      expect(b.to).toBe('2026-10-22');
    });

    it('computes this_week starting Monday and capped at today', () => {
      const b = getDateRangeBoundaries('this_week', undefined, undefined, fixedFriday);
      // Oct 23 is Friday. Monday of that week is Oct 19.
      expect(b.from).toBe('2026-10-19');
      expect(b.to).toBe('2026-10-23'); // Capped at today
    });

    it('computes this_month starting 1st and capped at today', () => {
      const b = getDateRangeBoundaries('this_month', undefined, undefined, fixedFriday);
      expect(b.from).toBe('2026-10-01');
      expect(b.to).toBe('2026-10-23'); // Capped at today
    });

    it('handles custom date range inclusive and re-orders inverted dates', () => {
      const b = getDateRangeBoundaries('custom', '2026-10-10', '2026-10-15', fixedFriday);
      expect(b.from).toBe('2026-10-10');
      expect(b.to).toBe('2026-10-15');

      const inverted = getDateRangeBoundaries('custom', '2026-10-20', '2026-10-05', fixedFriday);
      expect(inverted.from).toBe('2026-10-05');
      expect(inverted.to).toBe('2026-10-20');
    });
  });

  // ── 4. Core Sales Aggregation, Ranking, and Subtotals ───────────────────────
  describe('Full Sales Report Calculation', () => {
    const fixedRefDate = new Date('2026-10-23T12:00:00+05:30');

    it('calculates correct totals for multiple products and payment statuses', () => {
      const orders: Order[] = [
        // Order 1: Paid order (Primary: Kuboos, Bakery: Soft Kuboos)
        createMockOrder({
          id: 'o1',
          deliveryDate: '2026-10-23',
          paymentStatus: 'paid',
          items: [
            { productId: 'prod_kuboos', productName: 'Kuboos', qty: 50, unitPrice: 19, total: 950 },
            { productId: 'prod_soft_kuboos', productName: 'Soft Kuboos', qty: 30, unitPrice: 22, total: 660 },
          ],
        }),
        // Order 2: Pending order (Primary: Roomali, Bakery: Burger Bun)
        createMockOrder({
          id: 'o2',
          deliveryDate: '2026-10-23',
          paymentStatus: 'pending',
          items: [
            { productId: 'prod_roomali', productName: 'Roomali', qty: 20, unitPrice: 10, total: 200 },
            { productId: 'prod_burger_bun', productName: 'Burger Bun', qty: 15, unitPrice: 38, total: 570 },
          ],
        }),
        // Order 3: Partially paid direct sale with variable price for Kuboos
        createMockOrder({
          id: 'o3',
          orderType: 'direct',
          clientId: 'direct',
          clientName: 'Direct Sale',
          deliveryDate: '2026-10-23',
          paymentStatus: 'partial',
          items: [
            { productId: 'prod_kuboos', productName: 'Kuboos', qty: 50, unitPrice: 21, total: 1050 }, // different unit price!
            { productId: 'prod_poratta', productName: 'Poratta', qty: 40, unitPrice: 15, total: 600 },
          ],
        }),
      ];

      const filter: SalesReportFilter = {
        preset: 'today',
        division: 'all',
      };

      const result = calculateProductSalesReport(orders, mockProducts, filter, fixedRefDate);

      // Verify grand totals:
      // Kuboos: 50 * 19 (950) + 50 * 21 (1050) = 100 qty, ₹2,000 total. Avg price = 20.00
      // Soft Kuboos: 30 qty, ₹660 total. Avg price = 22.00
      // Roomali: 20 qty, ₹200 total. Avg price = 10.00
      // Burger Bun: 15 qty, ₹570 total. Avg price = 38.00
      // Poratta: 40 qty, ₹600 total. Avg price = 15.00
      // Grand Sales = 2000 + 660 + 200 + 570 + 600 = ₹4,030.00
      // Grand Qty = 100 + 30 + 20 + 15 + 40 = 205 units

      expect(result.summary.totalSales).toBe(4030);
      expect(result.summary.totalQty).toBe(205);
      expect(result.summary.uniqueProductsCount).toBe(5);
      expect(result.summary.validOrdersCount).toBe(3);

      // Primary: Kuboos (2000) + Roomali (200) = ₹2,200. Qty = 120
      expect(result.summary.primarySales).toBe(2200);
      expect(result.summary.primaryQty).toBe(120);

      // Bakery: Soft Kuboos (660) + Burger Bun (570) + Poratta (600) = ₹1,830. Qty = 85
      expect(result.summary.bakerySales).toBe(1830);
      expect(result.summary.bakeryQty).toBe(85);

      // Subtotals reconcile strictly
      expect(result.summary.primarySales + result.summary.bakerySales).toBe(result.summary.totalSales);
      expect(result.summary.isReconciled).toBe(true);

      // Verify Kuboos row details
      const kuboosRow = result.rows.find(r => r.productName === 'Kuboos')!;
      expect(kuboosRow).toBeDefined();
      expect(kuboosRow.totalQty).toBe(100);
      expect(kuboosRow.totalSales).toBe(2000);
      expect(kuboosRow.averagePrice).toBe(20); // (950 + 1050) / 100 = 20.00
      expect(kuboosRow.rankAmount).toBe(1); // highest sales amount
      expect(kuboosRow.rankQty).toBe(1); // highest quantity
      expect(kuboosRow.shareOfTotal).toBeCloseTo((2000 / 4030) * 100, 1);
    });

    it('respects division filter (Primary only)', () => {
      const orders: Order[] = [
        createMockOrder({
          deliveryDate: '2026-10-23',
          items: [
            { productId: 'prod_kuboos', productName: 'Kuboos', qty: 10, unitPrice: 20, total: 200 },
            { productId: 'prod_soft_kuboos', productName: 'Soft Kuboos', qty: 5, unitPrice: 30, total: 150 },
          ],
        }),
      ];

      const result = calculateProductSalesReport(orders, mockProducts, { preset: 'today', division: 'primary' }, fixedRefDate);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].productName).toBe('Kuboos');
      expect(result.summary.totalSales).toBe(200);
      expect(result.summary.bakerySales).toBe(0);
      expect(result.summary.isReconciled).toBe(true);
    });

    it('respects division filter (Bakery only)', () => {
      const orders: Order[] = [
        createMockOrder({
          deliveryDate: '2026-10-23',
          items: [
            { productId: 'prod_kuboos', productName: 'Kuboos', qty: 10, unitPrice: 20, total: 200 },
            { productId: 'prod_soft_kuboos', productName: 'Soft Kuboos', qty: 5, unitPrice: 30, total: 150 },
            { productId: 'prod_poratta', productName: 'Poratta', qty: 10, unitPrice: 15, total: 150 },
          ],
        }),
      ];

      const result = calculateProductSalesReport(orders, mockProducts, { preset: 'today', division: 'bakery' }, fixedRefDate);
      expect(result.rows).toHaveLength(2);
      expect(result.summary.totalSales).toBe(300);
      expect(result.summary.primarySales).toBe(0);
      expect(result.summary.isReconciled).toBe(true);
    });

    it('reproduces and verifies the AL BAIN production scenario', () => {
      // Live AL BAIN order: 44 Kuboos (836), 22 Roomali (220), 44 Soft kuboos (968), 10 Burger Bun (380)
      const alBainOrder = createMockOrder({
        id: 'qCe6C5ga2wkZmpS54iiq',
        clientId: 'CLT-1784727677046-y72v0v',
        clientName: 'AL BAIN',
        deliveryDate: '2026-10-23',
        division: 'all',
        items: [
          { productId: 'prod_kuboos', productName: 'Kuboos', qty: 44, unitPrice: 19, total: 836 },
          { productId: 'prod_roomali', productName: 'Roomali', qty: 22, unitPrice: 10, total: 220 },
          { productId: 'prod_soft_kuboos', productName: 'Soft kuboos', qty: 44, unitPrice: 22, total: 968 },
          { productId: 'prod_burger_bun', productName: 'Burger Bun', qty: 10, unitPrice: 38, total: 380 },
        ],
      });

      const result = calculateProductSalesReport([alBainOrder], mockProducts, { preset: 'today', division: 'all' }, fixedRefDate);
      expect(result.summary.primarySales).toBe(1056); // 836 + 220
      expect(result.summary.bakerySales).toBe(1348); // 968 + 380
      expect(result.summary.totalSales).toBe(2404);
      expect(result.summary.isReconciled).toBe(true);
    });

    it('ignores cancelled and trashed orders in calculations', () => {
      const validOrd = createMockOrder({ id: 'v1', deliveryDate: '2026-10-23', items: [{ productId: 'p1', productName: 'Kuboos', qty: 10, unitPrice: 10, total: 100 }] });
      const trashedOrd = createMockOrder({ id: 't1', deliveryDate: '2026-10-23', deletedAt: '2026-10-23T10:00:00Z', items: [{ productId: 'p1', productName: 'Kuboos', qty: 50, unitPrice: 10, total: 500 }] } as any);
      const cancelledOrd = createMockOrder({ id: 'c1', deliveryDate: '2026-10-23', status: 'cancelled', items: [{ productId: 'p1', productName: 'Kuboos', qty: 50, unitPrice: 10, total: 500 }] } as any);

      const result = calculateProductSalesReport([validOrd, trashedOrd, cancelledOrd], mockProducts, { preset: 'today', division: 'all' }, fixedRefDate);
      expect(result.summary.totalSales).toBe(100);
      expect(result.summary.totalQty).toBe(10);
      expect(result.summary.validOrdersCount).toBe(1);
    });

    it('handles empty results gracefully', () => {
      const result = calculateProductSalesReport([], mockProducts, { preset: 'today', division: 'all' }, fixedRefDate);
      expect(result.rows).toHaveLength(0);
      expect(result.summary.totalSales).toBe(0);
      expect(result.summary.totalQty).toBe(0);
      expect(result.summary.uniqueProductsCount).toBe(0);
      expect(result.summary.validOrdersCount).toBe(0);
      expect(result.summary.isReconciled).toBe(true);
    });
  });

  // ── 5. CSV Safety, Escaping, and Print HTML ────────────────────────────────
  describe('CSV escaping & formula-injection prevention', () => {
    it('preserves valid negative numbers without single quote prefixing', () => {
      expect(sanitizeCsvCell(-500)).toBe('-500');
      expect(sanitizeCsvCell('-500.50')).toBe('-500.50');
    });

    it('sanitizes strings that start with formula characters (=, +, -, @, tab, cr)', () => {
      expect(sanitizeCsvCell('=SUM(A1:B1)')).toBe(`"'=SUM(A1:B1)"`);
      expect(sanitizeCsvCell('+cmd|')).toBe(`"'+cmd|"`);
      expect(sanitizeCsvCell('-attack')).toBe(`"'-attack"`);
      expect(sanitizeCsvCell('@calc')).toBe(`"'@calc"`);
    });

    it('correctly escapes quotes according to RFC 4180', () => {
      expect(sanitizeCsvCell('Burger "Deluxe" Bun')).toBe('"Burger ""Deluxe"" Bun"');
    });

    it('handles Unicode and Malayalam characters seamlessly', () => {
      const malayalam = 'കുബൂസ് (Kuboos)';
      expect(sanitizeCsvCell(malayalam)).toBe(`"${malayalam}"`);
    });

    it('generates a complete CSV string with UTF-8 BOM', () => {
      const fixedDate = new Date('2026-10-23T12:00:00+05:30');
      const orders = [
        createMockOrder({
          deliveryDate: '2026-10-23',
          items: [{ productId: 'prod_kuboos', productName: 'Kuboos', qty: 10, unitPrice: 20, total: 200 }],
        }),
      ];
      const result = calculateProductSalesReport(orders, mockProducts, { preset: 'today', division: 'all' }, fixedDate);
      const csv = generateSalesReportCsv(result, { preset: 'today', division: 'all' });

      expect(csv.startsWith('\uFEFF')).toBe(true);
      expect(csv).toContain('Daily Fresh ERP — Product-wise Sales Report');
      expect(csv).toContain('Kuboos');
      expect(csv).toContain('200.00');
    });

    it('generates valid print-friendly HTML containing company details and summary', () => {
      const fixedDate = new Date('2026-10-23T12:00:00+05:30');
      const orders = [
        createMockOrder({
          deliveryDate: '2026-10-23',
          items: [{ productId: 'prod_kuboos', productName: 'Kuboos', qty: 10, unitPrice: 20, total: 200 }],
        }),
      ];
      const result = calculateProductSalesReport(orders, mockProducts, { preset: 'today', division: 'all' }, fixedDate);
      const html = renderSalesReportPrintHtml(result, { preset: 'today', division: 'all' });

      expect(html).toContain('Daily Fresh Food Products');
      expect(html).toContain('Product-wise Sales Report');
      expect(html).toContain('₹200.00');
    });
  });
});
