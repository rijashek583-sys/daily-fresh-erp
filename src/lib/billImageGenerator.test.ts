import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getBillJpgFilename,
  buildWhatsAppUrl,
  generateBillCanvas,
  generateBillJpgBlob,
  downloadBillJpg,
  shareBillAsJpg,
  shareDailyBillJpg,
  shareOrderInvoiceJpg,
} from './billImageGenerator';
import {
  buildUnifiedInvoiceDataFromOrder,
  buildUnifiedInvoiceDataFromDailyBill,
  renderUnifiedInvoiceHtml,
  type UnifiedInvoiceData,
  type DailyBillInvoiceData,
  type PrintOrderInvoiceOptions,
} from './invoicePrint';

describe('Bill Image Generator (JPG) & Sharing Engine', () => {
  describe('getBillJpgFilename', () => {
    it('creates standard filename for a clean alphanumeric bill number', () => {
      expect(getBillJpgFilename('INV-20261024-001')).toBe('DailyFresh_Bill_INV-20261024-001.jpg');
      expect(getBillJpgFilename('BILL-DF102')).toBe('DailyFresh_Bill_BILL-DF102.jpg');
    });

    it('sanitizes special characters, slashes, and spaces in bill number', () => {
      expect(getBillJpgFilename('BILL #123/A B')).toBe('DailyFresh_Bill_BILL__123_A_B.jpg');
      expect(getBillJpgFilename('ORD:999*XYZ')).toBe('DailyFresh_Bill_ORD_999_XYZ.jpg');
    });
  });

  describe('buildWhatsAppUrl', () => {
    it('builds direct chat URL when phone number is provided', () => {
      expect(buildWhatsAppUrl('9072265888')).toBe('https://wa.me/9072265888');
      expect(buildWhatsAppUrl('+91 90722-65888')).toBe('https://wa.me/919072265888');
    });

    it('builds direct chat URL with pre-filled encoded message text', () => {
      const url = buildWhatsAppUrl('9072265888', 'Hello! Here is your bill.');
      expect(url).toBe('https://wa.me/9072265888?text=Hello!%20Here%20is%20your%20bill.');
    });

    it('builds generic WhatsApp URL when phone is not provided', () => {
      expect(buildWhatsAppUrl(undefined, 'Invoice details')).toBe('https://wa.me/?text=Invoice%20details');
      expect(buildWhatsAppUrl('')).toBe('https://wa.me/');
    });
  });

  describe('buildUnifiedInvoiceDataFromDailyBill', () => {
    const mockDailyBill: DailyBillInvoiceData = {
      clientId: 'c101',
      clientName: 'City Supermarket',
      region: 'Kasargod',
      deliveryDate: '2026-10-24',
      billNumber: 'BILL-CS101-20261024',
      clientPhone: '9876543210',
      clientAddress: 'Main Bazar, Kasargod',
      items: [
        { productName: 'Fresh Kuboos', qty: 50, unitPrice: 8, total: 400, division: 'primary', unit: 'Pkt' },
        { productName: 'Poratta Pack', qty: 30, unitPrice: 15, total: 450, division: 'bakery', unit: 'Pkt' },
      ],
      subtotal: 850,
      oldBalance: 200,
      grandTotal: 1050,
      paidAmount: 500,
      outstandingBalance: 550,
      primarySubtotal: 400,
      bakerySubtotal: 450,
      primaryOldBalance: 100,
      bakeryOldBalance: 100,
      primaryPaid: 250,
      bakeryPaid: 250,
      primaryReceived: 250,
      bakeryReceived: 250,
      primaryAppliedToBill: 250,
      bakeryAppliedToBill: 250,
      primaryAppliedToPrevious: 0,
      bakeryAppliedToPrevious: 0,
      primaryBillRemaining: 150,
      bakeryBillRemaining: 200,
      primaryPreviousRemaining: 100,
      bakeryPreviousRemaining: 100,
      primaryOutstanding: 250,
      bakeryOutstanding: 300,
      primaryExcess: 0,
      bakeryExcess: 0,
      primaryCreditApplied: 0,
      bakeryCreditApplied: 0,
    };

    it('preserves exact financial values without altering business calculations', () => {
      const unified = buildUnifiedInvoiceDataFromDailyBill(mockDailyBill);

      expect(unified.billNumber).toBe('BILL-CS101-20261024');
      expect(unified.client.name).toBe('City Supermarket');
      expect(unified.client.phone).toBe('9876543210');
      expect(unified.client.address).toBe('Main Bazar, Kasargod');
      expect(unified.subtotal).toBe(850);
      expect(unified.previousBalance).toBe(200);
      expect(unified.totalPaid).toBe(500);
      expect(unified.totalOutstanding).toBe(550);
      expect(unified.divisionLabel).toBe('Primary & Bakery Foods');

      // Canonical Division Subtotal Reconciliation
      expect(unified.divisionBreakdown?.primary?.subtotal).toBe(400);
      expect(unified.divisionBreakdown?.bakery?.subtotal).toBe(450);
      expect(unified.divisionBreakdown!.primary!.subtotal + unified.divisionBreakdown!.bakery!.subtotal).toBe(unified.subtotal);
    });

    it('maps item unit prices and rates accurately', () => {
      const unified = buildUnifiedInvoiceDataFromDailyBill(mockDailyBill);
      expect(unified.items).toHaveLength(2);
      expect(unified.items[0]).toMatchObject({
        productName: 'Fresh Kuboos',
        qty: 50,
        unit: 'Pkt',
        unitPrice: 8,
        rate: 8,
        total: 400,
        division: 'primary',
      });
      expect(unified.items[1]).toMatchObject({
        productName: 'Poratta Pack',
        qty: 30,
        unit: 'Pkt',
        unitPrice: 15,
        rate: 15,
        total: 450,
        division: 'bakery',
      });
    });
  });

  describe('buildUnifiedInvoiceDataFromOrder', () => {
    it('builds unified invoice data from order options with tax and discounts if present', () => {
      const options: PrintOrderInvoiceOptions = {
        order: {
          id: 'ORD-2026-99',
          orderType: 'client',
          clientId: 'client-1',
          clientName: 'Sunrise Bakers',
          deliveryDate: '2026-10-24',
          items: [
            { productId: 'p1', productName: 'Wheat Kuboos', qty: 20, unitPrice: 10, total: 200 },
          ],
          subtotal: 200,
          tax: 10,
          total: 210,
          creditApplied: 0,
          paidAmount: 210,
          paymentStatus: 'paid',
          division: 'primary',
          createdAt: '2026-10-24T10:00:00Z',
          updatedAt: '2026-10-24T10:00:00Z',
        },
        client: {
          id: 'client-1',
          name: 'Sunrise Bakers',
          region: 'Manjeswar',
          phone: '9845012345',
          totalRevenue: 5000,
          outstanding: 0,
          status: 'active',
          totalOrders: 10,
        },
        previousBalance: 0,
      };

      const unified = buildUnifiedInvoiceDataFromOrder(options);
      expect(unified.billNumber).toBe('ORD-2026-99');
      expect(unified.client.name).toBe('Sunrise Bakers');
      expect(unified.client.phone).toBe('9845012345');
      expect(unified.subtotal).toBe(200);
      expect(unified.tax).toBe(10);
      expect(unified.statusText).toBe('PAID');
      expect(unified.totalOutstanding).toBe(0);
    });

    it('attributes a ₹222 cross-division payment as ₹70 to the Primary invoice and ₹152 to the Bakery invoice', () => {
      const baseOrder = {
        orderType: 'client' as const,
        clientId: 'client-cross',
        clientName: 'Cross Division Customer',
        subtotal: 70,
        tax: 0,
        total: 70,
        creditApplied: 0,
        paidAmount: 70,
        paymentStatus: 'paid' as const,
        division: 'primary' as const,
        createdAt: '2026-10-25T10:00:00Z',
        updatedAt: '2026-10-25T10:00:00Z',
        deliveryDate: '2026-10-25',
        items: [{ productId: 'kuboos', productName: 'Kuboos', qty: 7, unitPrice: 10, total: 70 }],
      };
      const ledger: any[] = [
        { id: 'inv-p', type: 'invoice', clientId: 'client-cross', invoiceId: 'inv-primary', amount: 70, division: 'primary', createdAt: '2026-10-25T10:00:00Z' },
        { id: 'inv-b', type: 'invoice', clientId: 'client-cross', invoiceId: 'inv-bakery', amount: 152, division: 'bakery', createdAt: '2026-10-25T10:00:00Z' },
        { id: 'pay-p', type: 'payment', clientId: 'client-cross', invoiceId: 'inv-primary', amount: 70, appliedAmount: 70, division: 'primary', createdAt: '2026-10-25T10:00:00Z' },
        { id: 'pay-b', type: 'payment', clientId: 'client-cross', invoiceId: 'inv-bakery', amount: 152, appliedAmount: 152, division: 'bakery', createdAt: '2026-10-25T10:00:00Z' },
      ];

      const unified = buildUnifiedInvoiceDataFromOrder({
        order: { ...baseOrder, id: 'inv-primary' },
        client: { id: 'client-cross', name: 'Cross Division Customer', region: 'Kasargod', status: 'active', totalOrders: 2, totalRevenue: 222, outstanding: 0 },
        payments: [{
          id: 'payment-222', clientId: 'client-cross', clientName: 'Cross Division Customer', invoiceId: 'inv-primary', otherInvoiceId: 'inv-bakery',
          amount: 222, appliedAmount: 70, appliedToOtherBill: 152, division: 'primary', method: 'cash', createdAt: '2026-10-25T10:00:00Z',
        }],
        ledger,
      });

      expect(unified.paymentReceivedForBill).toBe(70);
      expect(unified.totalPaid).toBe(70);
      expect(unified.appliedToBill).toBe(70);
      expect(unified.billRemaining).toBe(0);
      expect(unified.totalOutstanding).toBe(0);
    });

    it('marks duplicate ledger postings for the same payment as unresolved instead of double-counting them', () => {
      const order: any = {
        id: 'inv-duplicate', orderType: 'client', clientId: 'client-duplicate', clientName: 'Duplicate Check',
        deliveryDate: '2026-10-25', items: [{ productId: 'p1', productName: 'Kuboos', qty: 7, unitPrice: 10, total: 70 }],
        subtotal: 70, tax: 0, total: 70, paidAmount: 70, paymentStatus: 'paid', division: 'primary',
        createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z',
      };
      const ledger: any[] = [
        { id: 'inv', type: 'invoice', clientId: 'client-duplicate', invoiceId: 'inv-duplicate', amount: 70, division: 'primary', createdAt: '2026-10-25T10:00:00Z' },
        { id: 'pay-a', type: 'payment', paymentId: 'payment-1', clientId: 'client-duplicate', invoiceId: 'inv-duplicate', amount: 70, appliedAmount: 70, division: 'primary', createdAt: '2026-10-25T10:00:00Z' },
        { id: 'pay-b', type: 'payment', paymentId: 'payment-1', clientId: 'client-duplicate', invoiceId: 'inv-duplicate', amount: 70, appliedAmount: 70, division: 'primary', createdAt: '2026-10-25T10:00:00Z' },
      ];

      const unified = buildUnifiedInvoiceDataFromOrder({ order, previousBalance: 0, ledger });

      expect(unified.allocationWarning).toContain('duplicate ledger posting');
      expect(unified.statusText).toBe('ALLOCATION REVIEW REQUIRED');
      expect(unified.totalPaid).toBe(0);
      expect(unified.billRemaining).toBe(70);
      expect(unified.totalOutstanding).toBe(70);
      expect(renderUnifiedInvoiceHtml(unified)).toContain('Payment Allocation Status:');
    });

    it('does not treat a legacy counterpart payment without invoice allocation as settlement', () => {
      const order: any = {
        id: 'inv-bakery-legacy', orderType: 'client', clientId: 'client-legacy', clientName: 'Legacy Check',
        deliveryDate: '2026-10-25', items: [{ productId: 'p2', productName: 'Burger Bun', qty: 15.2, unitPrice: 10, total: 152 }],
        subtotal: 152, tax: 0, total: 152, paidAmount: 152, paymentStatus: 'paid', division: 'bakery',
        createdAt: '2026-10-25T10:00:00Z', updatedAt: '2026-10-25T10:00:00Z',
      };
      const payments: any[] = [{
        id: 'legacy-parent', clientId: 'client-legacy', clientName: 'Legacy Check', invoiceId: 'inv-primary-legacy',
        amount: 222, appliedAmount: 70, appliedToOtherBill: 152, division: 'primary', method: 'cash', createdAt: '2026-10-25T10:00:00Z',
      }];

      const unified = buildUnifiedInvoiceDataFromOrder({ order, payments, previousBalance: 0, ledger: [] });

      expect(unified.allocationWarning).toContain('legacy cross-division payment');
      expect(unified.statusText).toBe('ALLOCATION REVIEW REQUIRED');
      expect(unified.totalPaid).toBe(0);
      expect(unified.billRemaining).toBe(152);
      expect(unified.totalOutstanding).toBe(152);
    });
  });

  describe('Canvas Rendering & Layout Robustness', () => {
    let mockContext: any;
    let mockCanvas: any;

    beforeEach(() => {
      mockContext = {
        scale: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
        fillStyle: '',
        strokeStyle: '',
        font: '',
        textAlign: '',
        lineWidth: 1,
      };

      mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext),
        toBlob: vi.fn((cb: (b: Blob | null) => void) => {
          cb(new Blob(['fake-jpg-content'], { type: 'image/jpeg' }));
        }),
      };

      const mockBody = {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      };

      Object.defineProperty(globalThis, 'document', {
        value: {
          createElement: vi.fn((tag: string) => {
            if (tag === 'canvas') return mockCanvas;
            if (tag === 'a') return { href: '', download: '', click: vi.fn() };
            return {};
          }),
          body: mockBody,
        },
        configurable: true,
        writable: true,
      });

      Object.defineProperty(globalThis, 'URL', {
        value: {
          createObjectURL: vi.fn(() => 'blob:mock-url'),
          revokeObjectURL: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('dynamically increases canvas height for bills with many line items', () => {
      const singleItemBill: UnifiedInvoiceData = {
        billNumber: 'B-001',
        deliveryDate: '24 Oct 2026',
        isDirectSale: false,
        client: { name: 'Client A' },
        divisionLabel: 'Primary Foods',
        items: [{ productName: 'Kuboos', qty: 10, total: 80, division: 'primary' }],
        subtotal: 80,
        creditApplied: 0,
        netDue: 80,
        totalPaid: 80,
        billRemaining: 0,
        statusText: 'PAID',
        statusBadgeClass: 'badge-paid',
        previousBalance: 0,
        totalOutstanding: 0,
        hasAdvanceCredit: false,
        primaryAdvanceCredit: 0,
        bakeryAdvanceCredit: 0,
        totalAdvanceCredit: 0,
      };

      const manyItemsBill: UnifiedInvoiceData = {
        ...singleItemBill,
        billNumber: 'B-002',
        items: Array.from({ length: 25 }, (_, i) => ({
          productName: `Item #${i + 1} Special Food Product`,
          qty: 5,
          total: 50,
          division: i % 2 === 0 ? 'primary' : 'bakery',
        })),
        divisionLabel: 'Primary & Bakery Foods',
      };

      const canvas1 = generateBillCanvas(singleItemBill);
      const height1 = canvas1.height;

      const canvas2 = generateBillCanvas(manyItemsBill);
      const height2 = canvas2.height;

      // The 25-item bill must produce a taller canvas to fit all items without clipping
      expect(height2).toBeGreaterThan(height1);
    });

    it('generates a JPG Blob using canvas.toBlob', async () => {
      const sampleBill: UnifiedInvoiceData = {
        billNumber: 'B-BLOB',
        deliveryDate: '24 Oct 2026',
        isDirectSale: false,
        client: { name: 'Blob Customer' },
        divisionLabel: 'Primary Foods',
        items: [{ productName: 'Kuboos', qty: 10, total: 80, division: 'primary' }],
        subtotal: 80,
        creditApplied: 0,
        netDue: 80,
        totalPaid: 80,
        billRemaining: 0,
        statusText: 'PAID',
        statusBadgeClass: 'badge-paid',
        previousBalance: 0,
        totalOutstanding: 0,
        hasAdvanceCredit: false,
        primaryAdvanceCredit: 0,
        bakeryAdvanceCredit: 0,
        totalAdvanceCredit: 0,
      };

      const blob = await generateBillJpgBlob(sampleBill);
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('image/jpeg');
    });

    it('downloads the JPG image file with correct filename', async () => {
      const sampleBill: UnifiedInvoiceData = {
        billNumber: 'B-DL-101',
        deliveryDate: '24 Oct 2026',
        isDirectSale: false,
        client: { name: 'Download Customer' },
        divisionLabel: 'Primary Foods',
        items: [{ productName: 'Kuboos', qty: 10, total: 80, division: 'primary' }],
        subtotal: 80,
        creditApplied: 0,
        netDue: 80,
        totalPaid: 80,
        billRemaining: 0,
        statusText: 'PAID',
        statusBadgeClass: 'badge-paid',
        previousBalance: 0,
        totalOutstanding: 0,
        hasAdvanceCredit: false,
        primaryAdvanceCredit: 0,
        bakeryAdvanceCredit: 0,
        totalAdvanceCredit: 0,
      };

      const fileName = await downloadBillJpg(sampleBill);
      expect(fileName).toBe('DailyFresh_Bill_B-DL-101.jpg');
    });
  });

  describe('Web Share API & Download Fallback Handling', () => {
    let mockContext: any;
    let mockCanvas: any;

    const sampleBill: UnifiedInvoiceData = {
      billNumber: 'B-SHARE',
      deliveryDate: '24 Oct 2026',
      isDirectSale: false,
      client: { name: 'Share Customer', phone: '9072265888' },
      divisionLabel: 'Primary Foods',
      items: [{ productName: 'Kuboos', qty: 10, total: 80, division: 'primary' }],
      subtotal: 80,
      creditApplied: 0,
      netDue: 80,
      totalPaid: 80,
      billRemaining: 0,
      statusText: 'PAID',
      statusBadgeClass: 'badge-paid',
      previousBalance: 0,
      totalOutstanding: 0,
      hasAdvanceCredit: false,
      primaryAdvanceCredit: 0,
      bakeryAdvanceCredit: 0,
      totalAdvanceCredit: 0,
    };

    beforeEach(() => {
      mockContext = {
        scale: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        closePath: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        fillText: vi.fn(),
        measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
        fillStyle: '',
        strokeStyle: '',
        font: '',
        textAlign: '',
        lineWidth: 1,
      };

      mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => mockContext),
        toBlob: vi.fn((cb: (b: Blob | null) => void) => {
          cb(new Blob(['fake-jpg'], { type: 'image/jpeg' }));
        }),
      };

      const mockBody = {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      };

      Object.defineProperty(globalThis, 'document', {
        value: {
          createElement: vi.fn((tag: string) => {
            if (tag === 'canvas') return mockCanvas;
            if (tag === 'a') return { href: '', download: '', click: vi.fn() };
            return {};
          }),
          body: mockBody,
        },
        configurable: true,
        writable: true,
      });

      Object.defineProperty(globalThis, 'URL', {
        value: {
          createObjectURL: vi.fn(() => 'blob:mock-url'),
          revokeObjectURL: vi.fn(),
        },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('uses Web Share API when device supports file sharing', async () => {
      const shareMock = vi.fn().mockResolvedValue(undefined);
      const canShareMock = vi.fn().mockReturnValue(true);

      Object.defineProperty(navigator, 'canShare', {
        value: canShareMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'share', {
        value: shareMock,
        configurable: true,
        writable: true,
      });

      const res = await shareBillAsJpg(sampleBill);

      expect(res.success).toBe(true);
      expect(res.method).toBe('web_share');
      expect(res.fileName).toBe('DailyFresh_Bill_B-SHARE.jpg');
      expect(shareMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Daily Fresh'),
          files: expect.any(Array),
        })
      );
    });

    it('gracefully handles user cancellation of Web Share dialog without triggering download', async () => {
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      const shareMock = vi.fn().mockRejectedValue(abortError);
      const canShareMock = vi.fn().mockReturnValue(true);

      Object.defineProperty(navigator, 'canShare', {
        value: canShareMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(navigator, 'share', {
        value: shareMock,
        configurable: true,
        writable: true,
      });

      const res = await shareBillAsJpg(sampleBill);

      expect(res.success).toBe(false);
      expect(res.method).toBe('web_share');
      expect(res.error).toBe('Share cancelled');
    });

    it('falls back cleanly to direct file download when Web Share API is unsupported', async () => {
      // Desktop browser scenario: canShare returns false
      Object.defineProperty(navigator, 'canShare', {
        value: () => false,
        configurable: true,
        writable: true,
      });

      const res = await shareBillAsJpg(sampleBill);

      expect(res.success).toBe(true);
      expect(res.method).toBe('download');
      expect(res.fileName).toBe('DailyFresh_Bill_B-SHARE.jpg');
    });

    it('supports shareDailyBillJpg and shareOrderInvoiceJpg convenience methods', async () => {
      Object.defineProperty(navigator, 'canShare', {
        value: () => false,
        configurable: true,
        writable: true,
      });

      const mockDailyBill: DailyBillInvoiceData = {
        clientId: 'c1',
        clientName: 'Test Client',
        region: 'Test',
        deliveryDate: '2026-10-24',
        billNumber: 'B-100',
        items: [{ productName: 'Kuboos', qty: 10, total: 80, division: 'primary' }],
        subtotal: 80,
        outstandingBalance: 80,
      };

      const resDaily = await shareDailyBillJpg(mockDailyBill);
      expect(resDaily.success).toBe(true);
      expect(resDaily.fileName).toBe('DailyFresh_Bill_B-100.jpg');

      const mockOrderOptions: PrintOrderInvoiceOptions = {
        order: {
          id: 'ORD-555',
          clientId: 'c1',
          clientName: 'Test Client',
          deliveryDate: '2026-10-24',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 10, total: 80, unitPrice: 8 }],
          subtotal: 80,
          tax: 0,
          total: 80,
          createdAt: '2026-10-24T10:00:00Z',
          updatedAt: '2026-10-24T10:00:00Z',
        },
      };

      const resOrder = await shareOrderInvoiceJpg(mockOrderOptions);
      expect(resOrder.success).toBe(true);
      expect(resOrder.fileName).toBe('DailyFresh_Bill_ORD-555.jpg');
    });
  });

  describe('Staff mobile vs Admin desktop invoice equivalence & financial scenarios', () => {
    it('preserves route staff name and does NOT overwrite with payment audit string', () => {
      const dailyBillWithAudit: DailyBillInvoiceData = {
        clientId: 'client-cherkala',
        clientName: 'CHERKALA COMMITION',
        region: 'Cherkala',
        deliveryDate: '2026-10-24',
        billNumber: 'BILL-29BVMF-20261024',
        staffName: 'Daily Fresh Team',
        updatedInfo: 'Updated by Admin User on Oct 24',
        items: [
          { productName: 'Arabic Kuboos', qty: 7, unitPrice: 10, total: 70, division: 'primary' },
          { productName: 'Big Bun', qty: 8, unitPrice: 19, total: 152, division: 'bakery' },
        ],
        subtotal: 222,
        paidAmount: 1000,
        primarySubtotal: 70,
        bakerySubtotal: 152,
        primaryPaid: 70,
        bakeryPaid: 0,
        primaryReceived: 1000,
        bakeryReceived: 0,
        primaryAppliedToBill: 70,
        bakeryAppliedToBill: 0,
        primaryExcess: 930,
        bakeryExcess: 0,
        primaryBillRemaining: 0,
        bakeryBillRemaining: 152,
        primaryOutstanding: 0,
        bakeryOutstanding: 152,
        outstandingBalance: 152,
      };

      const unified = buildUnifiedInvoiceDataFromDailyBill(dailyBillWithAudit);

      // Route staff must remain 'Daily Fresh Team', never the audit note
      expect(unified.staffName).toBe('Daily Fresh Team');
      expect(unified.notes).toBe('Payment info: Updated by Admin User on Oct 24');
      expect(unified.updatedInfo).toBe('Updated by Admin User on Oct 24');

      // Financial allocation distinction
      expect(unified.subtotal).toBe(222);
      expect(unified.totalPaid).toBe(1000);
      expect(unified.appliedToBill).toBe(70);
      expect(unified.billRemaining).toBe(152);
      expect(unified.totalOutstanding).toBe(152);
      expect(unified.hasAdvanceCredit).toBe(true);
      expect(unified.totalAdvanceCredit).toBe(930);
      expect(unified.statusText).toBe('PARTIALLY PAID');

      // Verify canvas rendering succeeds and contains appropriate layout dimensions
      const canvas = generateBillCanvas(unified);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBeGreaterThan(0);
    });

    it('produces equivalent invoice fields between Admin Daily Bill and Staff Order views for fully paid bill', () => {
      const billDate = '2026-10-24';
      const items = [
        { productId: 'p1', productName: 'Arabic Kuboos', qty: 10, unitPrice: 10, total: 100, division: 'primary' as const },
        { productId: 'p2', productName: 'Poratta', qty: 10, unitPrice: 15, total: 150, division: 'bakery' as const },
      ];

      // Admin Daily Bill representation
      const adminDailyBill: DailyBillInvoiceData = {
        clientId: 'client-1',
        clientName: 'City Mart',
        region: 'Kasargod',
        deliveryDate: billDate,
        billNumber: 'BILL-CITY-20261024',
        staffName: 'Staff Member A',
        items,
        subtotal: 250,
        paidAmount: 250,
        primarySubtotal: 100,
        bakerySubtotal: 150,
        primaryPaid: 100,
        bakeryPaid: 150,
        primaryAppliedToBill: 100,
        bakeryAppliedToBill: 150,
        primaryBillRemaining: 0,
        bakeryBillRemaining: 0,
        primaryOutstanding: 0,
        bakeryOutstanding: 0,
        outstandingBalance: 0,
      };

      // Staff Order representation
      const staffOrderOptions: PrintOrderInvoiceOptions = {
        order: {
          id: 'ORD-CITY-20261024',
          clientId: 'client-1',
          clientName: 'City Mart',
          region: 'Kasargod',
          deliveryDate: billDate,
          staffName: 'Staff Member A',
          items: items.map(i => ({ productId: i.productId, productName: i.productName, qty: i.qty, unitPrice: i.unitPrice, total: i.total })),
          subtotal: 250,
          tax: 0,
          total: 250,
          paidAmount: 250,
          paymentStatus: 'paid',
          division: 'all',
          createdAt: `${billDate}T10:00:00Z`,
          updatedAt: `${billDate}T10:00:00Z`,
        },
        client: {
          id: 'client-1',
          name: 'City Mart',
          region: 'Kasargod',
          status: 'active',
          totalOrders: 1,
          totalRevenue: 250,
          outstanding: 0,
        },
        payments: [
          {
            id: 'pay-1',
            clientId: 'client-1',
            clientName: 'City Mart',
            amount: 100,
            invoiceId: 'ORD-CITY-20261024',
            division: 'primary',
            method: 'cash',
            createdAt: `${billDate}T10:00:00Z`,
          },
          {
            id: 'pay-2',
            clientId: 'client-1',
            clientName: 'City Mart',
            amount: 150,
            invoiceId: 'ORD-CITY-20261024',
            division: 'bakery',
            method: 'cash',
            createdAt: `${billDate}T10:00:00Z`,
          },
        ],
        products: [
          { id: 'p1', name: 'Arabic Kuboos', division: 'primary', displayOrder: 1, status: 'active' },
          { id: 'p2', name: 'Poratta', division: 'bakery', displayOrder: 2, status: 'active' },
        ],
        previousBalance: 0,
      };

      const adminUnified = buildUnifiedInvoiceDataFromDailyBill(adminDailyBill);
      const staffUnified = buildUnifiedInvoiceDataFromOrder(staffOrderOptions);

      // Financial parity
      expect(adminUnified.subtotal).toBe(staffUnified.subtotal);
      expect(adminUnified.netDue).toBe(staffUnified.netDue);
      expect(adminUnified.totalPaid).toBe(staffUnified.totalPaid);
      expect(adminUnified.appliedToBill).toBe(staffUnified.appliedToBill);
      expect(adminUnified.billRemaining).toBe(staffUnified.billRemaining);
      expect(adminUnified.totalOutstanding).toBe(staffUnified.totalOutstanding);
      expect(adminUnified.statusText).toBe('PAID');
      expect(staffUnified.statusText).toBe('PAID');

      // Route staff parity
      expect(adminUnified.staffName).toBe('Staff Member A');
      expect(staffUnified.staffName).toBe('Staff Member A');

      // Subtotals parity
      expect(adminUnified.divisionBreakdown?.primary?.subtotal).toBe(100);
      expect(staffUnified.divisionBreakdown?.primary?.subtotal).toBe(100);
      expect(adminUnified.divisionBreakdown?.bakery?.subtotal).toBe(150);
      expect(staffUnified.divisionBreakdown?.bakery?.subtotal).toBe(150);
    });

    it('accurately reconciles advance credit applied scenario', () => {
      const dailyBillWithCredit: DailyBillInvoiceData = {
        clientId: 'client-advance',
        clientName: 'Green Grocers',
        region: 'Kumbla',
        deliveryDate: '2026-10-24',
        billNumber: 'BILL-GG-01',
        items: [{ productName: 'Wheat Kuboos', qty: 20, unitPrice: 10, total: 200, division: 'primary' }],
        subtotal: 200,
        primarySubtotal: 200,
        primaryCreditApplied: 50,
        primaryAppliedToBill: 150,
        paidAmount: 150,
        outstandingBalance: 0,
      };

      const unified = buildUnifiedInvoiceDataFromDailyBill(dailyBillWithCredit);
      expect(unified.subtotal).toBe(200);
      expect(unified.creditApplied).toBe(50);
      expect(unified.netDue).toBe(150);
      expect(unified.totalPaid).toBe(150);
      expect(unified.appliedToBill).toBe(150);
      expect(unified.billRemaining).toBe(0);
      expect(unified.totalOutstanding).toBe(0);
      expect(unified.statusText).toBe('PAID');
    });

    it('accurately handles previous balance and partial payments', () => {
      const dailyBillWithPrev: DailyBillInvoiceData = {
        clientId: 'client-prev',
        clientName: 'Modern Bakery',
        region: 'Uppala',
        deliveryDate: '2026-10-24',
        billNumber: 'BILL-MB-01',
        items: [{ productName: 'Burger Bun', qty: 10, unitPrice: 20, total: 200, division: 'bakery' }],
        subtotal: 200,
        oldBalance: 300,
        paidAmount: 250,
        bakerySubtotal: 200,
        bakeryOldBalance: 300,
        bakeryAppliedToBill: 200,
        bakeryAppliedToPrevious: 50,
        bakeryBillRemaining: 0,
        bakeryPreviousRemaining: 250,
        outstandingBalance: 250,
      };

      const unified = buildUnifiedInvoiceDataFromDailyBill(dailyBillWithPrev);
      expect(unified.subtotal).toBe(200);
      expect(unified.previousBalance).toBe(300);
      expect(unified.totalPaid).toBe(250);
      expect(unified.appliedToBill).toBe(200);
      expect(unified.appliedToPrevious).toBe(50);
      expect(unified.billRemaining).toBe(0);
      expect(unified.remainingPreviousBalance).toBe(250);
      expect(unified.totalOutstanding).toBe(250);
      expect(unified.statusText).toBe('PARTIALLY PAID');
    });

    it('accurately handles nil-due scenario with zero balance', () => {
      const nilDueBill: DailyBillInvoiceData = {
        clientId: 'client-nil',
        clientName: 'Zero Dues Mart',
        region: 'Manjeswar',
        deliveryDate: '2026-10-24',
        billNumber: 'BILL-NIL-01',
        items: [{ productName: 'Fresh Kuboos', qty: 10, unitPrice: 8, total: 80, division: 'primary' }],
        subtotal: 80,
        paidAmount: 80,
        primarySubtotal: 80,
        primaryAppliedToBill: 80,
        primaryBillRemaining: 0,
        outstandingBalance: 0,
      };

      const unified = buildUnifiedInvoiceDataFromDailyBill(nilDueBill);
      expect(unified.totalOutstanding).toBe(0);
      expect(unified.statusText).toBe('PAID');

      const canvas = generateBillCanvas(unified);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBeGreaterThan(0);
    });

    it('Scenario 1: ₹1,000 payment against ₹70 Primary + ₹152 Bakery + ₹0 previous outstanding renders billRemaining 0, credit 778, outstanding 0', () => {
      const billData: DailyBillInvoiceData = {
        clientId: 'client-1000',
        clientName: 'Grand Restaurant',
        region: 'Kasargod',
        deliveryDate: '2026-10-25',
        billNumber: 'BILL-GR-01',
        items: [
          { productName: 'Kuboos', qty: 7, unitPrice: 10, total: 70, division: 'primary' },
          { productName: 'Burger Bun', qty: 15.2, unitPrice: 10, total: 152, division: 'bakery' },
        ],
        subtotal: 222,
        oldBalance: 0,
        paidAmount: 222,
        primarySubtotal: 70,
        bakerySubtotal: 152,
        primaryOldBalance: 0,
        bakeryOldBalance: 0,
        primaryPaid: 70,
        bakeryPaid: 152,
        primaryReceived: 1000,
        bakeryReceived: 0,
        primaryExcess: 778,
        bakeryExcess: 0,
        primaryAppliedToBill: 70,
        bakeryAppliedToBill: 152,
        primaryBillRemaining: 0,
        bakeryBillRemaining: 0,
        primaryPreviousRemaining: 0,
        bakeryPreviousRemaining: 0,
        primaryOutstanding: 0,
        bakeryOutstanding: 0,
        outstandingBalance: 0,
      };

      const unified = buildUnifiedInvoiceDataFromDailyBill(billData);
      expect(unified.subtotal).toBe(222);
      expect(unified.totalPaid).toBe(1000);
      expect(unified.appliedToBill).toBe(222);
      expect(unified.billRemaining).toBe(0);
      expect(unified.previousBalance).toBe(0);
      expect(unified.totalAdvanceCredit).toBe(778);
      expect(unified.totalOutstanding).toBe(0);
      expect(unified.statusText).toBe('PAID');

      const canvas = generateBillCanvas(unified);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBeGreaterThan(0);
      const ctx = canvas.getContext('2d') as any;
      expect(ctx.fillText).toHaveBeenCalledWith('Available Credit After This Bill:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹778.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('This Bill Remaining:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹0.00 (Settled)', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('ACCOUNT SETTLED / NIL DUE', expect.any(Number), expect.any(Number));
    });

    it('Scenario 2: Same bill with ₹200 previous outstanding renders credit 578, outstanding 0', () => {
      const billData: DailyBillInvoiceData = {
        clientId: 'client-1000-prev',
        clientName: 'Grand Restaurant',
        region: 'Kasargod',
        deliveryDate: '2026-10-25',
        billNumber: 'BILL-GR-02',
        items: [
          { productName: 'Kuboos', qty: 7, unitPrice: 10, total: 70, division: 'primary' },
          { productName: 'Burger Bun', qty: 15.2, unitPrice: 10, total: 152, division: 'bakery' },
        ],
        subtotal: 222,
        oldBalance: 200,
        paidAmount: 422,
        primarySubtotal: 70,
        bakerySubtotal: 152,
        primaryOldBalance: 100,
        bakeryOldBalance: 100,
        primaryPaid: 170,
        bakeryPaid: 252,
        primaryReceived: 1000,
        bakeryReceived: 0,
        primaryExcess: 578,
        bakeryExcess: 0,
        primaryAppliedToBill: 70,
        bakeryAppliedToBill: 152,
        primaryAppliedToPrevious: 100,
        bakeryAppliedToPrevious: 100,
        primaryBillRemaining: 0,
        bakeryBillRemaining: 0,
        primaryPreviousRemaining: 0,
        bakeryPreviousRemaining: 0,
        primaryOutstanding: 0,
        bakeryOutstanding: 0,
        outstandingBalance: 0,
      };

      const unified = buildUnifiedInvoiceDataFromDailyBill(billData);
      expect(unified.subtotal).toBe(222);
      expect(unified.totalPaid).toBe(1000);
      expect(unified.appliedToBill).toBe(222);
      expect(unified.appliedToPrevious).toBe(200);
      expect(unified.billRemaining).toBe(0);
      expect(unified.previousBalance).toBe(200);
      expect(unified.remainingPreviousBalance).toBe(0);
      expect(unified.totalAdvanceCredit).toBe(578);
      expect(unified.totalOutstanding).toBe(0);
      expect(unified.statusText).toBe('PAID');

      const canvas = generateBillCanvas(unified);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBeGreaterThan(0);
      const ctx = canvas.getContext('2d') as any;
      expect(ctx.fillText).toHaveBeenCalledWith('Available Credit After This Bill:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹578.00', expect.any(Number), expect.any(Number));
    });
  });

  describe('Authoritative Unified Financial Summary & Reconciliation Suite', () => {
    it('Scenario: Exact User Specification (₹1,268 subtotal, ₹500 prev outstanding, ₹300 prev credit, ₹200 credit applied, ₹100 paid)', () => {
      // Primary: 1 item ₹14.00; Bakery: 1 item ₹1,254.00
      const unifiedData: UnifiedInvoiceData = {
        billNumber: 'BILL-SPEC-20261025',
        deliveryDate: '25 Oct 2026',
        isDirectSale: false,
        client: {
          name: 'Super Hypermarket',
          region: 'Kasargode',
          phone: '9876543210',
          address: 'Main Town',
        },
        staffName: 'Rijash Route 1',
        divisionLabel: 'Primary & Bakery Foods',
        items: [
          { productName: 'Fresh Kuboos', qty: 2, unitPrice: 7, total: 14, division: 'primary' },
          { productName: 'Poratta Family Pack', qty: 114, unitPrice: 11, total: 1254, division: 'bakery' },
        ],
        subtotal: 1268,
        creditApplied: 200,
        netDue: 1068,
        previousOutstanding: 500,
        previousAvailableCredit: 300,
        paymentReceivedForBill: 100,
        totalPaid: 100,
        billRemaining: 968,
        availableCreditAfterBill: 100,
        previousBalance: 500,
        totalOutstanding: 1468,
        hasAdvanceCredit: true,
        totalAdvanceCredit: 100,
        statusText: 'PARTIALLY PAID',
        statusBadgeClass: 'badge-partial',
        divisionBreakdown: {
          primary: { subtotal: 14, creditApplied: 0, netDue: 14, paid: 0, outstanding: 14 },
          bakery: { subtotal: 1254, creditApplied: 200, netDue: 1054, paid: 100, outstanding: 954 },
        },
      };

      // 1. Financial Reconciliation Invariants
      expect(unifiedData.items.reduce((s, i) => s + i.total, 0)).toBe(unifiedData.subtotal);
      expect(unifiedData.subtotal).toBe(1268);
      expect(unifiedData.previousOutstanding).toBe(500);
      expect(unifiedData.previousAvailableCredit).toBe(300);
      expect(unifiedData.creditApplied).toBe(200);
      expect(unifiedData.paymentReceivedForBill).toBe(100);
      expect(unifiedData.billRemaining).toBe(968);
      expect(unifiedData.availableCreditAfterBill).toBe(100);
      expect(unifiedData.totalOutstanding).toBe(1468);
      // Math: 1268 (subtotal) - 200 (credit applied) = 1068 (net due)
      // 1068 (net due) - 100 (paid) = 968 (this bill remaining)
      // 300 (prev credit) - 200 (credit applied) = 100 (available credit after bill)
      // 500 (previous outstanding) + 968 (this bill remaining) = 1468 (total outstanding across all bills)
      expect(unifiedData.netDue - (unifiedData.paymentReceivedForBill || 0)).toBe(unifiedData.billRemaining);
      expect((unifiedData.previousAvailableCredit || 0) - (unifiedData.creditApplied || 0)).toBe(unifiedData.availableCreditAfterBill);
      expect((unifiedData.previousOutstanding || 0) + (unifiedData.billRemaining || 0)).toBe(unifiedData.totalOutstanding);

      // 2. Canvas Rendering Assertions
      const canvas = generateBillCanvas(unifiedData);
      expect(canvas.width).toBe(1600);
      const ctx = canvas.getContext('2d') as any;

      expect(ctx.fillText).toHaveBeenCalledWith('Items Subtotal:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹1268.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('Previous Outstanding:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹500.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('Previous Available Customer Credit:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('– ₹300.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('Credit Applied to This Bill:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('– ₹200.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('Payment Received for This Bill:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹100.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('This Bill Remaining:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹968.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('Available Credit After This Bill:', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹100.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('TOTAL OUTSTANDING — ALL BILLS', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹1468.00', expect.any(Number), expect.any(Number));

      // 3. HTML Invoice Parity Assertions
      const html = renderUnifiedInvoiceHtml(unifiedData);
      expect(html).toContain('Items Subtotal:');
      expect(html).toContain('₹1268.00');
      expect(html).toContain('Previous Outstanding:');
      expect(html).toContain('₹500.00');
      expect(html).toContain('Previous Available Customer Credit:');
      expect(html).toContain('– ₹300.00');
      expect(html).toContain('Credit Applied to This Bill:');
      expect(html).toContain('– ₹200.00');
      expect(html).toContain('Payment Received for This Bill:');
      expect(html).toContain('₹100.00');
      expect(html).toContain('This Bill Remaining:');
      expect(html).toContain('₹968.00');
      expect(html).toContain('Available Credit After This Bill:');
      expect(html).toContain('₹100.00');
      expect(html).toContain('TOTAL OUTSTANDING — ALL BILLS');
      expect(html).toContain('₹1468.00');
      expect(html).toContain('Daily Fresh Food Products');
      expect(html).toContain('Posoat, Manjeswar, Kasargode');
      expect(html).toContain('9072265888, 7907092583');
    });

    it('Scenario: Settled bill with no dues and no old debt renders nil due banner', () => {
      const settledBill: UnifiedInvoiceData = {
        billNumber: 'BILL-SETTLED-001',
        deliveryDate: '25 Oct 2026',
        isDirectSale: false,
        client: { name: 'Café Relax' },
        divisionLabel: 'Primary Foods',
        items: [{ productName: 'Kuboos 5s', qty: 20, unitPrice: 10, total: 200, division: 'primary' }],
        subtotal: 200,
        creditApplied: 0,
        netDue: 200,
        previousOutstanding: 0,
        previousAvailableCredit: 0,
        paymentReceivedForBill: 200,
        totalPaid: 200,
        billRemaining: 0,
        availableCreditAfterBill: 0,
        previousBalance: 0,
        totalOutstanding: 0,
        hasAdvanceCredit: false,
        totalAdvanceCredit: 0,
        statusText: 'PAID',
        statusBadgeClass: 'badge-paid',
      };

      const canvas = generateBillCanvas(settledBill);
      const ctx = canvas.getContext('2d') as any;

      expect(ctx.fillText).toHaveBeenCalledWith('ACCOUNT SETTLED / NIL DUE', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹0.00', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('₹0.00 (Settled)', expect.any(Number), expect.any(Number));

      const html = renderUnifiedInvoiceHtml(settledBill);
      expect(html).toContain('ACCOUNT SETTLED / NIL DUE');
      expect(html).toContain('₹0.00');
      expect(html).toContain('₹0.00 (Settled)');
    });
  });
});
