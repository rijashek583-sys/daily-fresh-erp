import { describe, it, expect } from 'vitest';
import {
  calculateDivisionReceivables,
  getOrderDivisionAmountsPaise,
  type CalculateReceivablesInput,
} from './receivablesReport';
import { type Client, type Order, type Payment, type LedgerTransaction, type Product } from '../types';

describe('Feature 1: Division-Wise Balance Receivable Report', () => {
  // Standard catalog products conforming to canonical division rules:
  // Primary: Kuboos, Roomali, Wheat Kuboos
  // Bakery: Soft Kuboos, Poratta, Burger Bun, Milk Bread, etc.
  const sampleProducts: Product[] = [
    { id: 'p1', name: 'Kuboos', status: 'active', displayOrder: 1, division: 'primary' },
    { id: 'p2', name: 'Roomali', status: 'active', displayOrder: 2, division: 'primary' },
    { id: 'p3', name: 'Wheat Kuboos', status: 'active', displayOrder: 3, division: 'primary' },
    { id: 'p4', name: 'Soft Kuboos', status: 'active', displayOrder: 4, division: 'bakery' },
    { id: 'p5', name: 'Poratta', status: 'active', displayOrder: 5, division: 'bakery' },
    { id: 'p6', name: 'Burger Bun', status: 'active', displayOrder: 6, division: 'bakery' },
  ];

  const baseClient: Client = {
    id: 'c1',
    name: 'Hotel Taj',
    phone: '9876543210',
    region: 'Kasaragod',
    status: 'active',
    totalOrders: 0,
    totalRevenue: 0,
    outstanding: 0,
  };

  it('1. Primary-only unpaid invoice allocates 100% to Primary receivable', () => {
    const orders: Order[] = [
      {
        id: 'ord_1',
        clientId: 'c1',
        clientName: 'Hotel Taj',
        deliveryDate: '2026-10-26',
        items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
        subtotal: 500,
        tax: 0,
        total: 500,
        paidAmount: 0,
        paymentStatus: 'pending',
        division: 'primary',
        createdAt: '2026-10-26T08:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      },
    ];

    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders,
      payments: [],
      ledger: [
        {
          id: 'led_1',
          type: 'invoice',
          clientId: 'c1',
          invoiceId: 'ord_1',
          amount: 500,
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(500);
    expect(report.bakeryReceivable).toBe(0);
    expect(report.allReceivable).toBe(500);
    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
    expect(report.totalDebtorClientsCount).toBe(1);
    expect(report.totalUnpaidInvoicesCount).toBe(1);
  });

  it('2. Bakery-only unpaid invoice allocates 100% to Bakery receivable', () => {
    const orders: Order[] = [
      {
        id: 'ord_2',
        clientId: 'c1',
        clientName: 'Hotel Taj',
        deliveryDate: '2026-10-26',
        items: [{ productId: 'p5', productName: 'Poratta', qty: 50, unitPrice: 8, total: 400 }],
        subtotal: 400,
        tax: 0,
        total: 400,
        paidAmount: 0,
        paymentStatus: 'pending',
        division: 'bakery',
        createdAt: '2026-10-26T08:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      },
    ];

    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders,
      payments: [],
      ledger: [
        {
          id: 'led_2',
          type: 'invoice',
          clientId: 'c1',
          invoiceId: 'ord_2',
          amount: 400,
          division: 'bakery',
          createdAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(0);
    expect(report.bakeryReceivable).toBe(400);
    expect(report.allReceivable).toBe(400);
    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
  });

  it('3. Mixed customer with separate Primary and Bakery invoices correctly reconciles', () => {
    const orders: Order[] = [
      {
        id: 'ord_p',
        clientId: 'c1',
        clientName: 'Hotel Taj',
        deliveryDate: '2026-10-25',
        items: [{ productId: 'p1', productName: 'Kuboos', qty: 120, unitPrice: 5, total: 600 }],
        subtotal: 600,
        tax: 0,
        total: 600,
        paidAmount: 0,
        paymentStatus: 'pending',
        division: 'primary',
        createdAt: '2026-10-25T08:00:00.000Z',
        updatedAt: '2026-10-25T08:00:00.000Z',
      },
      {
        id: 'ord_b',
        clientId: 'c1',
        clientName: 'Hotel Taj',
        deliveryDate: '2026-10-26',
        items: [{ productId: 'p4', productName: 'Soft Kuboos', qty: 50, unitPrice: 7, total: 350 }],
        subtotal: 350,
        tax: 0,
        total: 350,
        paidAmount: 0,
        paymentStatus: 'pending',
        division: 'bakery',
        createdAt: '2026-10-26T08:00:00.000Z',
        updatedAt: '2026-10-26T08:00:00.000Z',
      },
    ];

    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders,
      payments: [],
      ledger: [
        { id: 'l_p', type: 'invoice', clientId: 'c1', invoiceId: 'ord_p', amount: 600, division: 'primary', createdAt: '2026-10-25T08:00:00.000Z' },
        { id: 'l_b', type: 'invoice', clientId: 'c1', invoiceId: 'ord_b', amount: 350, division: 'bakery', createdAt: '2026-10-26T08:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(600);
    expect(report.bakeryReceivable).toBe(350);
    expect(report.allReceivable).toBe(950);
    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
    expect(report.clientSummaries[0].unpaidInvoices).toHaveLength(2);
  });

  it('4. Partial payment across multiple invoices correctly updates division receivables', () => {
    // Primary due 600, Bakery due 400 (Total 1000). Paid 700 (Primary 420, Bakery 280 proportionally)
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'ord_1',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 120, unitPrice: 5, total: 600 }],
          subtotal: 600,
          tax: 0,
          total: 600,
          paidAmount: 420,
          paymentStatus: 'partial',
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
        {
          id: 'ord_2',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p5', productName: 'Poratta', qty: 50, unitPrice: 8, total: 400 }],
          subtotal: 400,
          tax: 0,
          total: 400,
          paidAmount: 280,
          paymentStatus: 'partial',
          division: 'bakery',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      payments: [
        {
          id: 'pay_p',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          amount: 420,
          method: 'upi',
          division: 'primary',
          createdAt: '2026-10-26T10:00:00.000Z',
        },
        {
          id: 'pay_b',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          amount: 280,
          method: 'upi',
          division: 'bakery',
          createdAt: '2026-10-26T10:00:00.000Z',
        },
      ],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'ord_1', amount: 600, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l2', type: 'invoice', clientId: 'c1', invoiceId: 'ord_2', amount: 400, division: 'bakery', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l3', type: 'payment', clientId: 'c1', invoiceId: 'ord_1', amount: 420, division: 'primary', createdAt: '2026-10-26T10:00:00.000Z' },
        { id: 'l4', type: 'payment', clientId: 'c1', invoiceId: 'ord_2', amount: 280, division: 'bakery', createdAt: '2026-10-26T10:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(180);
    expect(report.bakeryReceivable).toBe(120);
    expect(report.allReceivable).toBe(300);
    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
  });

  it('5. Delivery Date payment allocation settles selected date first before older dues', () => {
    // Older delivery date (2026-10-20): 500
    // Selected delivery date (2026-10-26): 300
    // Payment of 300 allocated to 2026-10-26 order leaves older 500 due
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'ord_old',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-20',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 0,
          paymentStatus: 'pending',
          division: 'primary',
          createdAt: '2026-10-20T08:00:00.000Z',
          updatedAt: '2026-10-20T08:00:00.000Z',
        },
        {
          id: 'ord_today',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 60, unitPrice: 5, total: 300 }],
          subtotal: 300,
          tax: 0,
          total: 300,
          paidAmount: 300,
          paymentStatus: 'paid',
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      payments: [
        {
          id: 'pay_today',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          amount: 300,
          method: 'cash',
          division: 'primary',
          billDate: '2026-10-26',
          createdAt: '2026-10-26T09:00:00.000Z',
        },
      ],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'ord_old', amount: 500, division: 'primary', createdAt: '2026-10-20T08:00:00.000Z' },
        { id: 'l2', type: 'invoice', clientId: 'c1', invoiceId: 'ord_today', amount: 300, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l3', type: 'payment', clientId: 'c1', invoiceId: 'ord_today', amount: 300, division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(500);
    expect(report.allReceivable).toBe(500);
    expect(report.totalUnpaidInvoicesCount).toBe(1);
    expect(report.clientSummaries[0].unpaidInvoices[0].invoiceId).toBe('ord_old');
  });

  it('6. Staff and Admin payments are equally reflected in division balances', () => {
    // Total invoice 1000 (Primary 500, Bakery 500)
    // Staff records 300 (Primary), Admin records 200 (Bakery)
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'o_p',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 300,
          paymentStatus: 'partial',
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
        {
          id: 'o_b',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p5', productName: 'Poratta', qty: 50, unitPrice: 10, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 200,
          paymentStatus: 'partial',
          division: 'bakery',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      payments: [
        { id: 'p_staff', clientId: 'c1', clientName: 'Hotel Taj', amount: 300, method: 'cash', division: 'primary', recordedBy: 'staff_1', createdAt: '2026-10-26T09:00:00.000Z' },
        { id: 'p_admin', clientId: 'c1', clientName: 'Hotel Taj', amount: 200, method: 'upi', division: 'bakery', recordedBy: 'admin_1', createdAt: '2026-10-26T10:00:00.000Z' },
      ],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'o_p', amount: 500, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l2', type: 'invoice', clientId: 'c1', invoiceId: 'o_b', amount: 500, division: 'bakery', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l3', type: 'payment', clientId: 'c1', invoiceId: 'o_p', amount: 300, division: 'primary', recordedBy: 'staff_1', createdAt: '2026-10-26T09:00:00.000Z' },
        { id: 'l4', type: 'payment', clientId: 'c1', invoiceId: 'o_b', amount: 200, division: 'bakery', recordedBy: 'admin_1', createdAt: '2026-10-26T10:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(200);
    expect(report.bakeryReceivable).toBe(300);
    expect(report.allReceivable).toBe(500);
    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
  });

  it('7. Unified advance credit is distinguished and not assigned arbitrarily to divisions', () => {
    // Customer invoiced 500 (Primary), but paid 800 total (excess 300 advance).
    // Receivables must be 0, and unapplied general credit must be 300.
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'ord_adv',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 500,
          paymentStatus: 'paid',
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      payments: [
        {
          id: 'pay_adv',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          amount: 800,
          method: 'upi',
          division: 'primary',
          isAdvance: true,
          generalCredit: 300,
          createdAt: '2026-10-26T09:00:00.000Z',
        },
      ],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'ord_adv', amount: 500, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l2', type: 'payment', clientId: 'c1', invoiceId: 'ord_adv', amount: 800, division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(0);
    expect(report.bakeryReceivable).toBe(0);
    expect(report.allReceivable).toBe(0);
    expect(report.totalGeneralCredit).toBe(300);
    expect(report.clientSummaries[0].generalCredit).toBe(300);
    expect(report.clientSummaries[0].unpaidInvoices).toHaveLength(0);
  });

  it('8. Payment correction adjusts receivable accurately', () => {
    // Invoice 500. Payment was originally recorded as 500, then corrected to 300.
    // Net receivable should be 200.
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'ord_corr',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 300,
          paymentStatus: 'partial',
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      payments: [
        {
          id: 'pay_corr',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          amount: 300,
          originalAmount: 500,
          isCorrected: true,
          method: 'cash',
          division: 'primary',
          createdAt: '2026-10-26T09:00:00.000Z',
        },
      ],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'ord_corr', amount: 500, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l2', type: 'payment', clientId: 'c1', invoiceId: 'ord_corr', amount: 300, division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivable).toBe(200);
    expect(report.allReceivable).toBe(200);
    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
  });

  it('9. Fully paid invoice produces zero receivable', () => {
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'ord_paid',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-10-26',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 500,
          paymentStatus: 'paid',
          division: 'primary',
          createdAt: '2026-10-26T08:00:00.000Z',
          updatedAt: '2026-10-26T08:00:00.000Z',
        },
      ],
      payments: [
        { id: 'p_full', clientId: 'c1', clientName: 'Hotel Taj', amount: 500, method: 'upi', division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
      ],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'ord_paid', amount: 500, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l2', type: 'payment', clientId: 'c1', invoiceId: 'ord_paid', amount: 500, division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.allReceivable).toBe(0);
    expect(report.primaryReceivable).toBe(0);
    expect(report.bakeryReceivable).toBe(0);
    expect(report.totalDebtorClientsCount).toBe(0);
    expect(report.totalUnpaidInvoicesCount).toBe(0);
  });

  it('10. No invoices or ledger entries produces empty report with zero totals', () => {
    const report = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [],
      payments: [],
      ledger: [],
      products: sampleProducts,
    });

    expect(report.allReceivable).toBe(0);
    expect(report.primaryReceivable).toBe(0);
    expect(report.bakeryReceivable).toBe(0);
    expect(report.totalDebtorClientsCount).toBe(0);
    expect(report.totalUnpaidInvoicesCount).toBe(0);
    expect(report.clientSummaries).toHaveLength(0);
  });

  it('11. Invariant: Primary + Bakery strictly equals All for any arbitrary dataset', () => {
    const clients: Client[] = [
      { id: 'c1', name: 'Taj', region: 'Kasaragod', totalOrders: 1, totalRevenue: 423.5, outstanding: 323.5, status: 'active' },
      { id: 'c2', name: 'Al-Reem', region: 'Bekal', totalOrders: 1, totalRevenue: 645.25, outstanding: 445.25, status: 'active' },
      { id: 'c3', name: 'Green Valley', region: 'Kanhangad', totalOrders: 1, totalRevenue: 550, outstanding: 400, status: 'active' },
    ];

    const orders: Order[] = [
      {
        id: 'o1', clientId: 'c1', clientName: 'Taj', deliveryDate: '2026-10-26',
        items: [{ productId: 'p1', productName: 'Kuboos', qty: 77, unitPrice: 5.5, total: 423.5 }],
        subtotal: 423.5, tax: 0, total: 423.5, paidAmount: 100, paymentStatus: 'partial',
        division: 'primary', createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z',
      },
      {
        id: 'o2', clientId: 'c2', clientName: 'Al-Reem', deliveryDate: '2026-10-26',
        items: [{ productId: 'p5', productName: 'Poratta', qty: 89, unitPrice: 7.25, total: 645.25 }],
        subtotal: 645.25, tax: 0, total: 645.25, paidAmount: 200, paymentStatus: 'partial',
        division: 'bakery', createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z',
      },
      {
        id: 'o3', clientId: 'c3', clientName: 'Green Valley', deliveryDate: '2026-10-26',
        items: [
          { productId: 'p1', productName: 'Kuboos', qty: 50, unitPrice: 5, total: 250 },
          { productId: 'p6', productName: 'Burger Bun', qty: 30, unitPrice: 10, total: 300 },
        ],
        subtotal: 550, tax: 0, total: 550, paidAmount: 150, paymentStatus: 'partial',
        division: 'all', createdAt: '2026-10-26T08:00:00.000Z', updatedAt: '2026-10-26T08:00:00.000Z',
      },
    ];

    const report = calculateDivisionReceivables({
      clients,
      orders,
      payments: [],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'o1', amount: 423.5, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l2', type: 'payment', clientId: 'c1', invoiceId: 'o1', amount: 100, division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
        { id: 'l3', type: 'invoice', clientId: 'c2', invoiceId: 'o2', amount: 645.25, division: 'bakery', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l4', type: 'payment', clientId: 'c2', invoiceId: 'o2', amount: 200, division: 'bakery', createdAt: '2026-10-26T09:00:00.000Z' },
        { id: 'l5', type: 'invoice', clientId: 'c3', invoiceId: 'o3', amount: 250, division: 'primary', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l6', type: 'invoice', clientId: 'c3', invoiceId: 'o3', amount: 300, division: 'bakery', createdAt: '2026-10-26T08:00:00.000Z' },
        { id: 'l7', type: 'payment', clientId: 'c3', invoiceId: 'o3', amount: 150, division: 'primary', createdAt: '2026-10-26T09:00:00.000Z' },
      ],
      products: sampleProducts,
    });

    expect(report.primaryReceivablePaise + report.bakeryReceivablePaise).toBe(report.allReceivablePaise);
    expect(Math.round((report.primaryReceivable + report.bakeryReceivable) * 100)).toBe(Math.round(report.allReceivable * 100));
  });

  it('12. Current Outstanding is independent of period sales filters', () => {
    // Current outstanding reflects all unpaid invoices regardless of period sales
    const reportAll = calculateDivisionReceivables({
      clients: [baseClient],
      orders: [
        {
          id: 'ord_old_month',
          clientId: 'c1',
          clientName: 'Hotel Taj',
          deliveryDate: '2026-09-15',
          items: [{ productId: 'p1', productName: 'Kuboos', qty: 100, unitPrice: 5, total: 500 }],
          subtotal: 500,
          tax: 0,
          total: 500,
          paidAmount: 0,
          paymentStatus: 'pending',
          division: 'primary',
          createdAt: '2026-09-15T08:00:00.000Z',
          updatedAt: '2026-09-15T08:00:00.000Z',
        },
      ],
      payments: [],
      ledger: [
        { id: 'l1', type: 'invoice', clientId: 'c1', invoiceId: 'ord_old_month', amount: 500, division: 'primary', createdAt: '2026-09-15T08:00:00.000Z' },
      ],
      products: sampleProducts,
      divisionFilter: 'all',
    });

    expect(reportAll.accountingBasis).toBe('Current Outstanding');
    expect(reportAll.allReceivable).toBe(500);
  });
});
