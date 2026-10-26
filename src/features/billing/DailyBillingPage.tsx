import { useState, useMemo, useRef } from 'react';
import { FileText, Download, Search, Calendar, MapIcon, Users, X, Eye, Share2 } from 'lucide-react';
import { format } from 'date-fns';
import { type Region, type Division, type PaymentMethod } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Card, PageHeader, SearchInput, Button } from '../../components/ui';
import { formatCurrency, cn, getProductDivision, getTodayLocalDateString } from '../../lib/utils';
import { calculateOldBalance, recordPayment, getPaymentUpdateInfo, allocatePayment, round2 } from '../../lib/billing';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { toast } from 'sonner';
import { printDailyBillInvoice } from '../../lib/invoicePrint';
import { shareDailyBillJpg } from '../../lib/billImageGenerator';

interface DailyBillRow {
  clientId: string;
  clientName: string;
  region: string;
  deliveryDate: string;
  billNumber: string;
  items: { productName: string; qty: number; unitPrice: number; total: number; division: string }[];
  clientPhone?: string;
  // Combined
  subtotal: number;
  oldBalance: number;
  grandTotal: number;
  paidAmount: number;
  outstandingBalance: number;
  // Per-division
  primarySubtotal: number;
  bakerySubtotal: number;
  primaryOldBalance: number;
  bakeryOldBalance: number;
  primaryPaid: number;
  bakeryPaid: number;
  primaryReceived: number;
  bakeryReceived: number;
  primaryExcess: number;
  bakeryExcess: number;
  primaryCreditApplied: number;
  bakeryCreditApplied: number;
  primaryAppliedToBill: number;
  primaryAppliedToPrevious: number;
  primaryBillRemaining: number;
  primaryPreviousRemaining: number;
  bakeryAppliedToBill: number;
  bakeryAppliedToPrevious: number;
  bakeryBillRemaining: number;
  bakeryPreviousRemaining: number;
  primaryOutstanding: number;
  bakeryOutstanding: number;
  updatedInfo: string | null;
  staffName?: string;
  invoiceId: string;
  primaryInvoiceId?: string | null;
  bakeryInvoiceId?: string | null;
}

export default function DailyBillingPage() {
  const { orders, clients, regions, products } = useDataStore();

  const { user } = useAuthStore();
  const isStaff = user?.role === 'staff';
  const { activeDivision } = useDivisionStore();
  
  // Filters
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [filterRegion, setFilterRegion] = useState<Region | ''>('');
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [search, setSearch] = useState('');

  // Modals
  const [paymentModalRow, setPaymentModalRow] = useState<DailyBillRow | null>(null);
  const [viewBillRow, setViewBillRow] = useState<DailyBillRow | null>(null);
  const isSubmittingRef = useRef(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  const [isSharingJpg, setIsSharingJpg] = useState(false);

  // Per-division payment state — keyed by division so switching tabs never loses entered values
  interface DivisionPaymentState {
    amount: string;
    method: PaymentMethod;
    reference: string;
  }
  const [paymentDate, setPaymentDate] = useState<string>(getTodayLocalDateString());
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string>('');
  const [activePaymentDiv, setActivePaymentDiv] = useState<Division>('primary');
  const [divPaymentState, setDivPaymentState] = useState<Record<Division, DivisionPaymentState>>({
    primary: { amount: '0', method: 'cash', reference: '' },
    bakery:  { amount: '0', method: 'cash', reference: '' },
  });
  const [paymentIdempotencyKeys, setPaymentIdempotencyKeys] = useState<{ primary: string; bakery: string }>({
    primary: '',
    bakery: '',
  });

  const setDivField = (div: Division, field: keyof DivisionPaymentState, value: string) => {
    setDivPaymentState(prev => ({ ...prev, [div]: { ...prev[div], [field]: value } }));
  };

  const activeRegions = useMemo(() => regions, [regions]);
  const activeClients = useMemo(() => clients.filter(c => !c.deletedAt && (filterRegion ? c.region === filterRegion : true)), [filterRegion, clients]);

  // Compute Bills Dynamically
  const billingRows = useMemo(() => {
    let dayOrders = orders.filter(o => o.deliveryDate === filterDate);
    
    if (filterRegion) {
      const regionClientIds = new Set(clients.filter(c => c.region === filterRegion).map(c => c.id));
      dayOrders = dayOrders.filter(o => {
        if (o.orderType === 'direct' || o.clientId === 'direct') {
          return filterRegion === 'Direct Sale';
        }
        return regionClientIds.has(o.clientId);
      });
    }
    if (filterClientId) {
      dayOrders = dayOrders.filter(o => o.clientId === filterClientId);
    }
    if (search) {
      const s = search.toLowerCase();
      dayOrders = dayOrders.filter(o => {
        const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
        return (isDirect && 'direct sale'.includes(s)) || o.clientName.toLowerCase().includes(s);
      });
    }

    const grouped = new Map<string, typeof dayOrders>();
    dayOrders.forEach(o => {
      const isDirect = o.orderType === 'direct' || o.clientId === 'direct';
      const key = isDirect ? `direct_${o.id}` : o.clientId;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(o);
    });

    const rows: DailyBillRow[] = [];
    grouped.forEach((clientOrders, groupKey) => {
      const isDirect = groupKey.startsWith('direct_') || clientOrders[0].orderType === 'direct' || clientOrders[0].clientId === 'direct';
      const clientId = isDirect ? 'direct' : clientOrders[0].clientId;
      const clientName = isDirect ? 'Direct Sale' : clientOrders[0].clientName;
      const region = isDirect ? 'Direct Sale / —' : (clients.find(c => c.id === clientId)?.region || '-');
      
      const itemsMap = new Map<string, { qty: number, unitPrice: number, total: number, division: string }>();
      clientOrders.forEach(o => {
        o.items.forEach(i => {
          const prod = products.find(p => p.id === i.productId);
          const div = getProductDivision(prod || { name: i.productName });
          const itemPrice = typeof i.unitPrice === 'number' ? i.unitPrice : 0;
          const itemTotal = typeof i.total === 'number' ? i.total : itemPrice * i.qty;
          const key = `${i.productName}-${div}`;
          if (!itemsMap.has(key)) {
            itemsMap.set(key, { qty: 0, unitPrice: itemPrice, total: 0, division: div });
          }
          const existing = itemsMap.get(key)!;
          existing.qty += i.qty;
          existing.total += itemTotal;
        });
      });
      const items = Array.from(itemsMap.entries()).map(([_, data]) => ({ ...data, productName: _.split('-')[0] }));
      
      const currentInvoiceIds = clientOrders.map(o => o.id);

      // Per-division calculations (filtered by activeDivision)
      const primaryItems = activeDivision === 'bakery' ? [] : items.filter(i => i.division === 'primary');
      const bakeryItems  = activeDivision === 'primary' ? [] : items.filter(i => i.division === 'bakery');
      
      const primarySubtotal = primaryItems.reduce((s, i) => s + i.total, 0);
      const bakerySubtotal  = bakeryItems.reduce((s, i) => s + i.total, 0);

      let primaryOldBalance = 0;
      let bakeryOldBalance = 0;
      let primaryPaid = 0;
      let bakeryPaid = 0;
      let primaryReceived = 0;
      let bakeryReceived = 0;
      let primaryExcess = 0;
      let bakeryExcess = 0;
      let primaryCreditApplied = 0;
      let bakeryCreditApplied = 0;
      let primaryAppliedToBill = 0;
      let primaryAppliedToPrevious = 0;
      let primaryBillRemaining = 0;
      let primaryPreviousRemaining = 0;
      let bakeryAppliedToBill = 0;
      let bakeryAppliedToPrevious = 0;
      let bakeryBillRemaining = 0;
      let bakeryPreviousRemaining = 0;
      let primaryOutstanding = 0;
      let bakeryOutstanding = 0;
      let clientDayPayments: any[] = [];

      if (!isDirect) {
        primaryOldBalance = calculateOldBalance(clientId, filterDate, 'primary', currentInvoiceIds);
        bakeryOldBalance  = calculateOldBalance(clientId, filterDate, 'bakery',  currentInvoiceIds);
        
        const { payments } = useDataStore.getState();
        clientDayPayments = payments.filter(p => 
          p.clientId === clientId && 
          !p.deletedAt && 
          (p.billDate === filterDate || (p.paymentDate || p.createdAt).substring(0, 10) === filterDate)
        );

        const primaryDayPayments = clientDayPayments.filter(p => p.division === 'primary');
        const bakeryDayPayments = clientDayPayments.filter(p => p.division === 'bakery');

        primaryReceived = primaryDayPayments.reduce((s, p) => s + (p.amount || 0), 0);
        bakeryReceived = bakeryDayPayments.reduce((s, p) => s + (p.amount || 0), 0);

        primaryCreditApplied = clientOrders.reduce((s, o) => s + (o.primaryCreditApplied || (o.division === 'primary' ? (o.creditApplied || 0) : 0) || 0), 0);
        bakeryCreditApplied = clientOrders.reduce((s, o) => s + (o.bakeryCreditApplied || (o.division === 'bakery' ? (o.creditApplied || 0) : 0) || 0), 0);

        const primaryNetDue = Math.max(0, primarySubtotal - primaryCreditApplied);
        const bakeryNetDue = Math.max(0, bakerySubtotal - bakeryCreditApplied);

        const primaryOldBalanceVal = round2(primaryOldBalance);
        const bakeryOldBalanceVal  = round2(bakeryOldBalance);

        // Identify prior credit (when old balance is negative)
        let priorCreditP = Math.max(0, -primaryOldBalanceVal);
        let priorCreditB = Math.max(0, -bakeryOldBalanceVal);

        // Apply prior credit to reduce today's net due before allocating cash payments
        let effPrimaryNetDue = primaryNetDue;
        let effBakeryNetDue = bakeryNetDue;

        if (priorCreditP > 0 || priorCreditB > 0) {
          const appliedPriorP = Math.min(priorCreditP, effPrimaryNetDue);
          effPrimaryNetDue = round2(effPrimaryNetDue - appliedPriorP);
          priorCreditP = round2(priorCreditP - appliedPriorP);

          const appliedPriorB = Math.min(priorCreditB, effBakeryNetDue);
          effBakeryNetDue = round2(effBakeryNetDue - appliedPriorB);
          priorCreditB = round2(priorCreditB - appliedPriorB);

          // Cross-division prior credit offset if surplus remains
          if (priorCreditP > 0 && effBakeryNetDue > 0) {
            const crossP = Math.min(priorCreditP, effBakeryNetDue);
            effBakeryNetDue = round2(effBakeryNetDue - crossP);
            priorCreditP = round2(priorCreditP - crossP);
          }
          if (priorCreditB > 0 && effPrimaryNetDue > 0) {
            const crossB = Math.min(priorCreditB, effPrimaryNetDue);
            effPrimaryNetDue = round2(effPrimaryNetDue - crossB);
            priorCreditB = round2(priorCreditB - crossB);
          }
        }

        const primaryPriorDebt = Math.max(0, primaryOldBalanceVal);
        const bakeryPriorDebt  = Math.max(0, bakeryOldBalanceVal);
        const totalClientDebt = round2(effPrimaryNetDue + primaryPriorDebt + effBakeryNetDue + bakeryPriorDebt);

        // Allocate Primary payment
        const primaryAlloc = allocatePayment({
          paymentAmount: primaryReceived,
          orderRemaining: effPrimaryNetDue,
          otherOrderRemaining: effBakeryNetDue,
          billDivisionPrior: primaryPriorDebt,
          otherDivisionPrior: bakeryPriorDebt,
          clientTotalOutstanding: totalClientDebt,
          isDirectSale: false,
          division: 'primary',
        });

        // Allocate Bakery payment against whatever remains after Primary allocation
        const remainingBakeryNetDue = primaryAlloc.remainingOtherBill;
        const remainingPrimaryNetDue = primaryAlloc.remainingBill;
        const remainingBakeryOldBalance = primaryAlloc.remainingOtherDivision;
        const remainingPrimaryOldBalance = primaryAlloc.remainingSameDivisionPrevious;
        const remainingDebtAfterPrimary = round2(remainingBakeryNetDue + remainingPrimaryNetDue + remainingBakeryOldBalance + remainingPrimaryOldBalance);

        const bakeryAlloc = allocatePayment({
          paymentAmount: bakeryReceived,
          orderRemaining: remainingBakeryNetDue,
          otherOrderRemaining: remainingPrimaryNetDue,
          billDivisionPrior: remainingBakeryOldBalance,
          otherDivisionPrior: remainingPrimaryOldBalance,
          clientTotalOutstanding: remainingDebtAfterPrimary,
          isDirectSale: false,
          division: 'bakery',
        });

        primaryAppliedToBill = round2(primaryAlloc.appliedToBill + bakeryAlloc.appliedToOtherBill);
        primaryBillRemaining = bakeryAlloc.remainingOtherBill;
        primaryAppliedToPrevious = round2(primaryAlloc.appliedToSameDivisionPrevious + bakeryAlloc.appliedToOtherDivisionPrevious);
        primaryPreviousRemaining = bakeryAlloc.remainingOtherDivision;
        primaryPaid = round2(primaryAppliedToBill + primaryAppliedToPrevious);

        bakeryAppliedToBill = round2(bakeryAlloc.appliedToBill + primaryAlloc.appliedToOtherBill);
        bakeryBillRemaining = bakeryAlloc.remainingBill;
        bakeryAppliedToPrevious = round2(bakeryAlloc.appliedToSameDivisionPrevious + primaryAlloc.appliedToOtherDivisionPrevious);
        bakeryPreviousRemaining = bakeryAlloc.remainingSameDivisionPrevious;
        bakeryPaid = round2(bakeryAppliedToBill + bakeryAppliedToPrevious);

        primaryOutstanding = round2(primaryBillRemaining + primaryPreviousRemaining);
        bakeryOutstanding = round2(bakeryBillRemaining + bakeryPreviousRemaining);
        primaryExcess = round2(primaryAlloc.excessCredit + priorCreditP);
        bakeryExcess = round2(bakeryAlloc.excessCredit + priorCreditB);
      } else {
        // Direct sales have no old balance. Payments are read from order invoiceId.
        const { payments } = useDataStore.getState();
        const orderPayments = payments.filter(p => !p.deletedAt && p.invoiceId === clientOrders[0].id);
        const pPayments = orderPayments.filter(p => p.division === 'primary');
        const bPayments = orderPayments.filter(p => p.division === 'bakery');
        
        primaryReceived = pPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const pAlloc = allocatePayment({
          paymentAmount: primaryReceived,
          orderRemaining: primarySubtotal,
          otherOrderRemaining: bakerySubtotal,
          clientTotalOutstanding: primarySubtotal + bakerySubtotal,
          isDirectSale: true,
          division: 'primary',
        });

        bakeryReceived = bPayments.reduce((s, p) => s + (p.amount || 0), 0);
        const bAlloc = allocatePayment({
          paymentAmount: bakeryReceived,
          orderRemaining: pAlloc.remainingOtherBill,
          otherOrderRemaining: pAlloc.remainingBill,
          clientTotalOutstanding: pAlloc.remainingBill + pAlloc.remainingOtherBill,
          isDirectSale: true,
          division: 'bakery',
        });

        primaryAppliedToBill = round2(pAlloc.appliedToBill + bAlloc.appliedToOtherBill);
        primaryPaid = primaryAppliedToBill;
        primaryBillRemaining = bAlloc.remainingOtherBill;
        primaryOutstanding = primaryBillRemaining;

        bakeryAppliedToBill = round2(bAlloc.appliedToBill + pAlloc.appliedToOtherBill);
        bakeryPaid = bakeryAppliedToBill;
        bakeryBillRemaining = bAlloc.remainingBill;
        bakeryOutstanding = bakeryBillRemaining;
      }

      // Combined (for card display)
      const subtotal = primarySubtotal + bakerySubtotal;
      const oldBalance = primaryOldBalance + bakeryOldBalance;
      const grandTotal = subtotal + oldBalance;
      const paidAmount = primaryPaid + bakeryPaid;
      const outstandingBalance = grandTotal <= 0 ? 0 : Math.max(0, round2(primaryOutstanding + bakeryOutstanding));

      const finalItems = [...primaryItems, ...bakeryItems];

      // Skip rendering clients who have zero relevant items and zero outstanding balance in this division
      if (finalItems.length === 0 && Math.abs(outstandingBalance) < 0.01 && paidAmount === 0) {
        return;
      }

      const billNumber = isDirect
        ? `BILL-DIRECT-${clientOrders[0].id.substring(0,6).toUpperCase()}-${filterDate.replace(/-/g, '')}`
        : `BILL-${clientId.substring(0,6).toUpperCase()}-${filterDate.replace(/-/g, '')}`;
      const updatedInfo = isDirect ? null : getPaymentUpdateInfo(clientId, filterDate, 'all');
      const orderStaff = clientOrders.find(o => o.staffName)?.staffName;
      const paymentStaff = !isDirect ? clientDayPayments.find(p => p.staffName)?.staffName : undefined;
      const staffName = orderStaff || paymentStaff || undefined;

      const primaryOrder = clientOrders.find(o => o.division === 'primary');
      const bakeryOrder = clientOrders.find(o => o.division === 'bakery');
      const primaryInvoiceId = primaryOrder?.id || (clientOrders[0]?.items?.some(i => getProductDivision({ name: i.productName }) === 'primary') ? clientOrders[0].id : null);
      const bakeryInvoiceId = bakeryOrder?.id || (clientOrders[0]?.items?.some(i => getProductDivision({ name: i.productName }) === 'bakery') ? clientOrders[0].id : null);

      rows.push({
        clientId, clientName, region, deliveryDate: filterDate, billNumber,
        clientPhone: isDirect ? '' : (clients.find(c => c.id === clientId)?.phone || ''),
        items, subtotal, oldBalance, grandTotal, paidAmount, outstandingBalance,
        primarySubtotal, bakerySubtotal, primaryOldBalance, bakeryOldBalance,
        primaryPaid, bakeryPaid, primaryReceived, bakeryReceived, primaryExcess, bakeryExcess,
        primaryCreditApplied, bakeryCreditApplied,
        primaryAppliedToBill, primaryAppliedToPrevious,
        primaryBillRemaining, primaryPreviousRemaining,
        bakeryAppliedToBill, bakeryAppliedToPrevious,
        bakeryBillRemaining, bakeryPreviousRemaining,
        primaryOutstanding, bakeryOutstanding,
        updatedInfo, staffName, invoiceId: clientOrders[0].id,
        primaryInvoiceId, bakeryInvoiceId,
      });
    });

    return rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [orders, clients, products, filterDate, filterRegion, filterClientId, search, activeDivision]);

  // Removed unused aggregated stats

  const handleOpenPaymentModal = (row: DailyBillRow) => {
    setPaymentModalRow(row);
    const defaultDiv: Division = activeDivision !== 'all'
      ? (activeDivision as Division)
      : (row.bakeryOutstanding > 0 && row.primaryOutstanding <= 0 ? 'bakery' : 'primary');
    setActivePaymentDiv(defaultDiv);
    // Always reset to 0 — do NOT auto-fill outstanding (UX requirement)
    setDivPaymentState({
      primary: { amount: '0', method: 'cash', reference: '' },
      bakery:  { amount: '0', method: 'cash', reference: '' },
    });
    setPaymentDate(getTodayLocalDateString());
    setPaymentNotes('');
    setPaymentInvoiceId(row.invoiceId);

    // Task 4: Generate durable operation-specific idempotency keys once per payment intent
    const genKey = (prefix: string) => {
      const rand = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : Math.random().toString(36).substring(2, 10);
      return `pay_db_${prefix}_${Date.now()}_${rand}`;
    };
    setPaymentIdempotencyKeys({
      primary: genKey('p'),
      bakery: genKey('b'),
    });
  };

  const handleSavePartialPayment = async () => {
    if (!paymentModalRow || isSubmittingRef.current || isSavingPayment) return;

    const primaryAmt = parseFloat(divPaymentState.primary.amount);
    const bakeryAmt  = parseFloat(divPaymentState.bakery.amount);
    const primaryValid = !isNaN(primaryAmt) && primaryAmt > 0;
    const bakeryValid  = !isNaN(bakeryAmt)  && bakeryAmt  > 0;

    if (!primaryValid && !bakeryValid) {
      toast.error('Please enter a payment amount for at least one division.');
      return;
    }
    const isDirect = paymentModalRow.clientId === 'direct';
    if (isDirect) {
      if (primaryValid && primaryAmt > paymentModalRow.primaryOutstanding + 0.01) {
        toast.error(`Primary payment exceeds outstanding (${formatCurrency(paymentModalRow.primaryOutstanding)}).`);
        return;
      }
      if (bakeryValid && bakeryAmt > paymentModalRow.bakeryOutstanding + 0.01) {
        toast.error(`Bakery payment exceeds outstanding (${formatCurrency(paymentModalRow.bakeryOutstanding)}).`);
        return;
      }
    }

    const effectivePaymentDate = isStaff ? getTodayLocalDateString() : (paymentDate || getTodayLocalDateString());

    const base = {
      orderType:  paymentModalRow.clientId === 'direct' ? 'direct' : 'client',
      clientId:   paymentModalRow.clientId,
      clientName: paymentModalRow.clientName,
      region:     paymentModalRow.region,
      updatedBy:  isStaff ? 'Staff' : 'Admin',
      paymentDate: effectivePaymentDate,
      billDate:   paymentModalRow.deliveryDate,
      notes:      paymentNotes,
    };

    isSubmittingRef.current = true;
    setIsSavingPayment(true);

    try {
      if (primaryValid) {
        const primaryOrderRemaining = paymentModalRow.primaryBillRemaining ?? paymentModalRow.primarySubtotal ?? 0;
        const effectivePrimaryInvoiceId = (isDirect || primaryOrderRemaining > 0.005) ? (paymentModalRow.primaryInvoiceId || paymentInvoiceId || null) : null;
        await recordPayment({
          ...base,
          invoiceId: effectivePrimaryInvoiceId,
          otherInvoiceId: paymentModalRow.bakeryInvoiceId || null,
          otherOrderRemaining: paymentModalRow.bakeryBillRemaining ?? paymentModalRow.bakerySubtotal ?? 0,
          billDivisionPrior: paymentModalRow.primaryPreviousRemaining ?? paymentModalRow.primaryOldBalance ?? 0,
          otherDivisionPrior: paymentModalRow.bakeryPreviousRemaining ?? paymentModalRow.bakeryOldBalance ?? 0,
          amount: primaryAmt,
          method: divPaymentState.primary.method,
          reference: divPaymentState.primary.reference,
          division: 'primary',
          idempotencyKey: paymentIdempotencyKeys.primary,
        });
      }
      if (bakeryValid) {
        const bakeryOrderRemaining = paymentModalRow.bakeryBillRemaining ?? paymentModalRow.bakerySubtotal ?? 0;
        const effectiveBakeryInvoiceId = (isDirect || bakeryOrderRemaining > 0.005) ? (paymentModalRow.bakeryInvoiceId || paymentInvoiceId || null) : null;
        await recordPayment({
          ...base,
          invoiceId: effectiveBakeryInvoiceId,
          otherInvoiceId: paymentModalRow.primaryInvoiceId || null,
          otherOrderRemaining: paymentModalRow.primaryBillRemaining ?? paymentModalRow.primarySubtotal ?? 0,
          billDivisionPrior: paymentModalRow.bakeryPreviousRemaining ?? paymentModalRow.bakeryOldBalance ?? 0,
          otherDivisionPrior: paymentModalRow.primaryPreviousRemaining ?? paymentModalRow.primaryOldBalance ?? 0,
          amount: bakeryAmt,
          method: divPaymentState.bakery.method,
          reference: divPaymentState.bakery.reference,
          division: 'bakery',
          idempotencyKey: paymentIdempotencyKeys.bakery,
        });
      }
      setPaymentModalRow(null);
      toast.success('Payment recorded successfully.');
    } catch (err: any) {
      console.error('Failed to record daily billing payment:', err);
      toast.error(err?.message || 'Failed to record payment on trusted server.');
    } finally {
      isSubmittingRef.current = false;
      setIsSavingPayment(false);
    }
  };

  const generatePDF = (row: DailyBillRow) => {
    printDailyBillInvoice(row);
  };

  const handleShareJpg = async (row: DailyBillRow) => {
    setIsSharingJpg(true);
    try {
      const res = await shareDailyBillJpg(row);
      if (res.success) {
        if (res.method === 'web_share') {
          toast.success('Bill image shared successfully!');
        } else {
          const phone = row.clientPhone ? row.clientPhone.replace(/[^0-9]/g, '') : '';
          const waUrl = phone ? `https://wa.me/${phone}` : 'https://wa.me/';
          toast.success(`Downloaded ${res.fileName}`, {
            description: 'Attach this JPG in WhatsApp.',
            action: {
              label: 'Open WhatsApp',
              onClick: () => window.open(waUrl, '_blank'),
            },
            duration: 8000,
          });
        }
      } else if (res.error && res.error !== 'Share cancelled') {
        toast.error(`Could not share image: ${res.error}`);
      }
    } catch (err: any) {
      toast.error(`Image generation failed: ${err?.message || err}`);
    } finally {
      setIsSharingJpg(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Daily Bill"
        description="Manage billing, invoices, and payment tracking seamlessly."
      />

      {/* Filters */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5" /> Delivery Date
            </label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <MapIcon className="w-3.5 h-3.5" /> Region
            </label>
            <select
              value={filterRegion}
              onChange={(e) => {
                setFilterRegion(e.target.value as Region);
                setFilterClientId('');
              }}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="">All Regions</option>
              {activeRegions.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Users className="w-3.5 h-3.5" /> Client
            </label>
            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer disabled:opacity-50"
              disabled={!filterRegion}
            >
              <option value="">All Clients</option>
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 col-span-1 md:col-span-1 lg:col-span-4">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Search className="w-3.5 h-3.5" /> Search
            </label>
            <SearchInput
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search bills..."
              className="w-full"
            />
          </div>
        </div>
      </Card>

      {/* Premium ERP Bill Cards */}
      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {billingRows.length === 0 ? (
          <Card className="py-24 text-center flex flex-col items-center border-dashed">
            <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-4">
              <FileText className="w-8 h-8" />
            </div>
            <h3 className="text-base font-bold text-[var(--color-text-main)] mb-1">No billing records</h3>
            <p className="text-sm font-medium text-[var(--color-text-muted)]">Adjust filters or delivery date to view bills.</p>
          </Card>
        ) : (
          billingRows.map(row => (
            <Card key={row.clientId} padding={false} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 px-4 sm:px-6 py-4 hover:border-[var(--color-primary)]/30 hover:shadow-lg transition-all duration-300 sm:h-[110px] overflow-hidden">
              
              {/* LEFT: Identity */}
              <div className="flex flex-col justify-center min-w-0 flex-1 sm:min-w-[200px] sm:flex-none">
                <h3 className="text-base sm:text-lg font-black text-[var(--color-text-main)] uppercase tracking-wide leading-tight truncate">{row.clientName}</h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs font-bold text-[var(--color-text-muted)] truncate">{row.billNumber}</span>
                  <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700"></span>
                  <span className="text-xs font-bold text-[var(--color-text-muted)] truncate">{row.region}</span>
                </div>
              </div>

              {/* CENTER: Financials */}
              <div className="sm:flex-1 flex sm:justify-end items-center sm:px-6 sm:h-full sm:border-r border-gray-100 dark:border-white/[0.05]">
                <div className="text-left sm:text-right">
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest block mb-0.5">Grand Total</span>
                  <span className="text-xl sm:text-2xl font-black text-[var(--color-text-main)] leading-none">{formatCurrency(row.grandTotal)}</span>
                </div>
              </div>

              {/* RIGHT: Actions */}
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 shrink-0 sm:h-full sm:pl-2">
                <Button
                  onClick={() => handleOpenPaymentModal(row)}
                  variant="primary"
                  className="rounded-full px-4 sm:px-6 text-xs sm:text-sm"
                >
                  Record Payment
                </Button>

                <button
                  onClick={() => setViewBillRow(row)}
                  className="flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 text-[var(--color-text-main)] rounded-full font-bold text-xs sm:text-sm transition-colors border-2 border-gray-200 dark:border-gray-700 shadow-sm whitespace-nowrap"
                >
                  <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> View
                </button>
                <button
                  onClick={() => handleShareJpg(row)}
                  className="flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-xs sm:text-sm transition-colors shadow-sm border-2 border-transparent whitespace-nowrap"
                  title="Share as Image (JPG)"
                >
                  <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> Share JPG
                </button>
                <button
                  onClick={() => generatePDF(row)}
                  className="flex items-center justify-center gap-1.5 px-3 sm:px-4 py-2 sm:py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white rounded-full font-bold text-xs sm:text-sm transition-colors shadow-sm border-2 border-transparent whitespace-nowrap"
                >
                  <Download className="w-4 h-4" /> Download PDF
                </button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* View Bill Modal */}
      {viewBillRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-bg)] rounded-3xl w-full max-w-4xl max-h-[95vh] shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-gray-900/50">
              <h2 className="text-xl font-black text-[var(--color-text-main)] uppercase tracking-wide">Invoice Preview</h2>
              <button onClick={() => setViewBillRow(null)} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
              {/* Header */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-6 border-b border-gray-200 dark:border-gray-800 pb-8 mb-8">
                <div className="flex items-start gap-3">
                  <img src="/logo.png" alt="Daily Fresh" className="w-12 h-12 object-contain rounded-xl border border-gray-100 dark:border-gray-800" onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }} />
                  <div>
                    <h1 className="text-2xl font-black text-red-600 dark:text-red-500 mb-0.5 tracking-tight">Daily Fresh Food Products</h1>
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">Posoat, Manjeswar, Kasargode – 671323</p>
                    <p className="text-xs font-bold text-red-600 dark:text-red-400 mt-0.5">Phone: 9072265888, 7907092583</p>
                  </div>
                </div>
                <div className="text-right">
                  <h2 className="text-2xl font-black text-[var(--color-text-main)] mb-1 tracking-tight">INVOICE</h2>
                  <p className="text-sm font-bold text-[var(--color-text-muted)] mb-1">{viewBillRow.billNumber}</p>
                  <p className="text-sm font-medium text-[var(--color-text-muted)] mb-4">Date: {format(new Date(viewBillRow.deliveryDate), 'dd MMM yyyy')}</p>
                  <span className={cn(
                    "px-4 py-2 rounded-full text-xs font-black uppercase tracking-widest",
                    viewBillRow.outstandingBalance === 0 ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" :
                    "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                  )}>
                    {viewBillRow.outstandingBalance === 0 ? 'Paid' : 'Unpaid'}
                  </span>
                </div>
              </div>

              {/* Client Info */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6 mb-8">
                <h3 className="text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest mb-2">Billed To</h3>
                <p className="text-2xl font-black text-[var(--color-text-main)] uppercase tracking-wide mb-1">{viewBillRow.clientName}</p>
                <p className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Region: {viewBillRow.region}</p>
              </div>

              {/* Items Sections */}
              {(() => {
                const primary = viewBillRow.items.filter(i => i.division === 'primary');
                const bakery = viewBillRow.items.filter(i => i.division === 'bakery');
                
                const renderSection = (title: string, items: typeof viewBillRow.items) => {
                  if (items.length === 0) return null;
                  const sub = items.reduce((sum, i) => sum + i.total, 0);
                  return (
                    <div className="mb-8">
                      <h4 className="text-lg font-black text-[var(--color-text-main)] border-b border-gray-200 dark:border-gray-800 pb-2 mb-4">{title}</h4>
                      <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-gray-50 dark:bg-gray-800/50">
                              <th className="py-4 px-6 text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest border-b border-gray-200 dark:border-gray-800">Product</th>
                              <th className="py-4 px-6 text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest border-b border-gray-200 dark:border-gray-800 text-right">Qty</th>
                              <th className="py-4 px-6 text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest border-b border-gray-200 dark:border-gray-800 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, idx) => (
                              <tr key={idx} className="border-b border-gray-100 dark:border-white/[0.05] last:border-0">
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)]">{item.productName}</td>
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)] text-right">{item.qty}</td>
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)] text-right">{formatCurrency(item.total)}</td>
                              </tr>
                            ))}
                            <tr className="bg-gray-50 dark:bg-gray-800/20">
                              <td colSpan={2} className="py-4 px-6 text-sm font-black text-[var(--color-text-main)] text-right">{title} Subtotal</td>
                              <td className="py-4 px-6 text-sm font-black text-[var(--color-text-main)] text-right">{formatCurrency(sub)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                };
                
                return (
                  <>
                    {renderSection('Primary Foods', primary)}
                    {renderSection('Bakery Foods', bakery)}
                  </>
                );
              })()}

              {/* Per-division summary */}
              <div className="flex justify-end">
                <div className="w-full max-w-sm space-y-3">

                  {/* Primary Foods section */}
                  {viewBillRow.items.some(i => i.division === 'primary') && (
                    <div className="bg-blue-50 dark:bg-blue-950/20 rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-blue-100 dark:border-blue-900/30">
                        <span className="text-xs font-black text-blue-700 dark:text-blue-400 uppercase tracking-widest">Primary Foods</span>
                      </div>
                      <div className="p-4 flex flex-col gap-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-[var(--color-text-muted)]">Bill Subtotal</span>
                          <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.primarySubtotal)}</span>
                        </div>
                        {viewBillRow.primaryCreditApplied > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-green-600 dark:text-green-400">Previous Credit Applied</span>
                              <span className="font-bold text-green-600 dark:text-green-400">-{formatCurrency(viewBillRow.primaryCreditApplied)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="font-bold text-[var(--color-text-main)]">Net Payable</span>
                              <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(Math.max(0, viewBillRow.primarySubtotal - viewBillRow.primaryCreditApplied))}</span>
                            </div>
                          </>
                        )}
                        {viewBillRow.primaryOldBalance > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-[var(--color-text-muted)]">Previous Balance</span>
                            <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.primaryOldBalance)}</span>
                          </div>
                        )}
                        {viewBillRow.primaryReceived > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-[var(--color-text-muted)]">Payment Received</span>
                              <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.primaryReceived)}</span>
                            </div>
                            <div className="flex justify-between text-sm pl-2">
                              <span className="font-semibold text-green-600 dark:text-green-400">↳ Applied to Today&apos;s Bill</span>
                              <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(viewBillRow.primaryAppliedToBill)}</span>
                            </div>
                            {viewBillRow.primaryAppliedToPrevious > 0 && (
                              <div className="flex justify-between text-sm pl-2">
                                <span className="font-semibold text-emerald-600 dark:text-emerald-400">↳ Applied to Previous Balance</span>
                                <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(viewBillRow.primaryAppliedToPrevious)}</span>
                              </div>
                            )}
                            {viewBillRow.primaryExcess > 0 && (
                              <div className="flex justify-between text-sm pl-2">
                                <span className="font-bold text-blue-600 dark:text-blue-400">↳ Advance Credit Created</span>
                                <span className="font-bold text-blue-600 dark:text-blue-400">+{formatCurrency(viewBillRow.primaryExcess)}</span>
                              </div>
                            )}
                          </>
                        )}
                        {viewBillRow.primaryOldBalance > 0 && viewBillRow.primaryAppliedToPrevious > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-[var(--color-text-muted)]">Remaining Previous Balance</span>
                            <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.primaryPreviousRemaining)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm pt-1 border-t border-blue-100 dark:border-blue-900/30">
                          <span className="font-black text-blue-700 dark:text-blue-400 uppercase text-xs tracking-wider">Outstanding</span>
                          <span className="font-black text-blue-700 dark:text-blue-400">{formatCurrency(Math.max(0, viewBillRow.primaryOutstanding))}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Bakery Foods section */}
                  {viewBillRow.items.some(i => i.division === 'bakery') && (
                    <div className="bg-amber-50 dark:bg-amber-950/20 rounded-2xl overflow-hidden">
                      <div className="px-5 py-3 border-b border-amber-100 dark:border-amber-900/30">
                        <span className="text-xs font-black text-amber-700 dark:text-amber-400 uppercase tracking-widest">Bakery Foods</span>
                      </div>
                      <div className="p-4 flex flex-col gap-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-[var(--color-text-muted)]">Bill Subtotal</span>
                          <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.bakerySubtotal)}</span>
                        </div>
                        {viewBillRow.bakeryCreditApplied > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-green-600 dark:text-green-400">Previous Credit Applied</span>
                              <span className="font-bold text-green-600 dark:text-green-400">-{formatCurrency(viewBillRow.bakeryCreditApplied)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="font-bold text-[var(--color-text-main)]">Net Payable</span>
                              <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(Math.max(0, viewBillRow.bakerySubtotal - viewBillRow.bakeryCreditApplied))}</span>
                            </div>
                          </>
                        )}
                        {viewBillRow.bakeryOldBalance > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-[var(--color-text-muted)]">Previous Balance</span>
                            <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.bakeryOldBalance)}</span>
                          </div>
                        )}
                        {viewBillRow.bakeryReceived > 0 && (
                          <>
                            <div className="flex justify-between text-sm">
                              <span className="font-semibold text-[var(--color-text-muted)]">Payment Received</span>
                              <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.bakeryReceived)}</span>
                            </div>
                            <div className="flex justify-between text-sm pl-2">
                              <span className="font-semibold text-green-600 dark:text-green-400">↳ Applied to Today&apos;s Bill</span>
                              <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(viewBillRow.bakeryAppliedToBill)}</span>
                            </div>
                            {viewBillRow.bakeryAppliedToPrevious > 0 && (
                              <div className="flex justify-between text-sm pl-2">
                                <span className="font-semibold text-amber-600 dark:text-amber-400">↳ Applied to Previous Balance</span>
                                <span className="font-bold text-amber-600 dark:text-amber-400">{formatCurrency(viewBillRow.bakeryAppliedToPrevious)}</span>
                              </div>
                            )}
                            {viewBillRow.bakeryExcess > 0 && (
                              <div className="flex justify-between text-sm pl-2">
                                <span className="font-bold text-amber-600 dark:text-amber-400">↳ Advance Credit Created</span>
                                <span className="font-bold text-amber-600 dark:text-amber-400">+{formatCurrency(viewBillRow.bakeryExcess)}</span>
                              </div>
                            )}
                          </>
                        )}
                        {viewBillRow.bakeryOldBalance > 0 && viewBillRow.bakeryAppliedToPrevious > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-[var(--color-text-muted)]">Remaining Previous Balance</span>
                            <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.bakeryPreviousRemaining)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm pt-1 border-t border-amber-100 dark:border-amber-900/30">
                          <span className="font-black text-amber-700 dark:text-amber-400 uppercase text-xs tracking-wider">Outstanding</span>
                          <span className="font-black text-amber-700 dark:text-amber-400">{formatCurrency(Math.max(0, viewBillRow.bakeryOutstanding))}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Grand Total */}
                  <div className="bg-red-50 dark:bg-red-900/10 rounded-2xl p-5 flex justify-between items-center">
                    <span className="text-sm font-black text-red-600 dark:text-red-400 uppercase tracking-widest">Grand Outstanding</span>
                    <span className="text-2xl font-black text-red-600 dark:text-red-400">{formatCurrency(Math.max(0, viewBillRow.outstandingBalance))}</span>
                  </div>

                </div>
              </div>
            </div>
            
            <div className="p-6 border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-gray-900/50 flex flex-wrap justify-end gap-3">
              <Button variant="outline" onClick={() => setViewBillRow(null)}>Close</Button>
              <Button
                variant="secondary"
                icon={<Share2 className="w-4 h-4" />}
                onClick={() => handleShareJpg(viewBillRow)}
                loading={isSharingJpg}
              >
                Share as Image (JPG)
              </Button>
              <Button icon={<Download className="w-4 h-4" />} onClick={() => generatePDF(viewBillRow)}>Download PDF</Button>
            </div>
          </div>
        </div>
      )}

      {paymentModalRow && (() => {
        const inputClass = 'w-full px-3 py-2 text-sm font-bold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all';

        // Derive which divisions are visible based on global tab
        const showPrimary = activeDivision !== 'bakery';
        const showBakery  = activeDivision !== 'primary';
        const showTabs    = showPrimary && showBakery; // both present → show tab switcher

        // Live computed values
        const primaryEnteredAmt = parseFloat(divPaymentState.primary.amount) || 0;
        const bakeryEnteredAmt  = parseFloat(divPaymentState.bakery.amount)  || 0;
        const primaryRemaining  = Math.max(0, paymentModalRow.primaryOutstanding - primaryEnteredAmt);
        const bakeryRemaining   = Math.max(0, paymentModalRow.bakeryOutstanding  - bakeryEnteredAmt);
        const totalPayment      = primaryEnteredAmt + bakeryEnteredAmt;

        const divConfig = {
          primary: {
            label:       'Primary Foods',
            outstanding: paymentModalRow.primaryOutstanding,
            remaining:   primaryRemaining,
            enteredAmt:  primaryEnteredAmt,
            activeBorder:'border-blue-500',
            activeBg:    'bg-blue-50 dark:bg-blue-950/30',
            activeText:  'text-blue-700 dark:text-blue-400',
            accentBg:    'bg-blue-50 dark:bg-blue-950/20',
            accentText:  'text-blue-700 dark:text-blue-400',
          },
          bakery: {
            label:       'Bakery Foods',
            outstanding: paymentModalRow.bakeryOutstanding,
            remaining:   bakeryRemaining,
            enteredAmt:  bakeryEnteredAmt,
            activeBorder:'border-amber-500',
            activeBg:    'bg-amber-50 dark:bg-amber-950/30',
            activeText:  'text-amber-700 dark:text-amber-400',
            accentBg:    'bg-amber-50 dark:bg-amber-950/20',
            accentText:  'text-amber-700 dark:text-amber-400',
          },
        } as const;

        const renderDivisionForm = (div: Division) => {
          const cfg = divConfig[div];
          const ds  = divPaymentState[div];
          const entered = parseFloat(ds.amount) || 0;
          const isDirect = paymentModalRow.clientId === 'direct';
          const orderRemaining = div === 'primary'
            ? (paymentModalRow.primaryBillRemaining !== undefined ? paymentModalRow.primaryBillRemaining : paymentModalRow.primarySubtotal)
            : (paymentModalRow.bakeryBillRemaining !== undefined ? paymentModalRow.bakeryBillRemaining : paymentModalRow.bakerySubtotal);

          const otherDiv = div === 'primary' ? 'bakery' : 'primary';
          const otherOrderRemaining = div === 'primary'
            ? (paymentModalRow.bakeryBillRemaining !== undefined ? paymentModalRow.bakeryBillRemaining : paymentModalRow.bakerySubtotal)
            : (paymentModalRow.primaryBillRemaining !== undefined ? paymentModalRow.primaryBillRemaining : paymentModalRow.primarySubtotal);
          const otherDivOutstanding = div === 'primary' ? paymentModalRow.bakeryOutstanding : paymentModalRow.primaryOutstanding;
          const billDivisionPrior = div === 'primary' ? paymentModalRow.primaryPreviousRemaining : paymentModalRow.bakeryPreviousRemaining;
          const otherDivisionPrior = div === 'primary' ? paymentModalRow.bakeryPreviousRemaining : paymentModalRow.primaryPreviousRemaining;

          const alloc = allocatePayment({
            paymentAmount: entered,
            orderRemaining,
            otherOrderRemaining,
            billDivisionPrior,
            otherDivisionPrior,
            billDivisionOutstanding: cfg.outstanding,
            otherDivisionOutstanding: otherDivOutstanding,
            clientTotalOutstanding: cfg.outstanding + otherDivOutstanding,
            isDirectSale: isDirect,
            division: div,
          });

          const remaining = alloc.remainingTotalOutstanding;
          const overLimit = isDirect && entered > cfg.outstanding + 0.01;

          return (
            <div className="space-y-3">
              {/* Outstanding / Entered / Remaining info strip */}
              <div className={`${cfg.accentBg} rounded-xl px-4 py-2.5 grid grid-cols-3 gap-2 text-center`}>
                <div>
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Outstanding</p>
                  <p className={`text-sm font-black ${cfg.accentText}`}>{formatCurrency(Math.max(0, cfg.outstanding))}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Entered</p>
                  <p className="text-sm font-black text-[var(--color-text-main)]">{formatCurrency(entered)}</p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Remaining</p>
                  <p className={`text-sm font-black ${remaining > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-success)]'}`}>{formatCurrency(remaining)}</p>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-main)] mb-1">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={ds.amount}
                  onChange={e => setDivField(div, 'amount', e.target.value)}
                  className={`${inputClass} ${overLimit ? 'border-red-400 focus:border-red-400' : ''}`}
                  autoFocus={div === activePaymentDiv}
                />
                {overLimit && <p className="text-[11px] font-semibold text-red-500 mt-1">Exceeds direct sale total of {formatCurrency(cfg.outstanding)}</p>}
                {entered > 0 && !overLimit && !isDirect && (
                  <div className="mt-2 p-2.5 rounded-xl bg-gray-50 dark:bg-gray-800/40 border border-gray-100 dark:border-gray-800 text-[11px] space-y-1">
                    <div className="flex justify-between text-gray-600 dark:text-gray-300">
                      <span>Applied to {div === 'primary' ? 'Primary' : 'Bakery'} Bill:</span>
                      <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(alloc.appliedToBill)}</span>
                    </div>
                    {alloc.appliedToOtherBill > 0 && (
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                        <span>Applied to {otherDiv === 'primary' ? 'Primary' : 'Bakery'} Bill:</span>
                        <span className="font-bold">{formatCurrency(alloc.appliedToOtherBill)}</span>
                      </div>
                    )}
                    {alloc.appliedToSameDivisionPrevious > 0 && (
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                        <span>Applied to {div === 'primary' ? 'Primary' : 'Bakery'} Balance:</span>
                        <span className="font-bold">{formatCurrency(alloc.appliedToSameDivisionPrevious)}</span>
                      </div>
                    )}
                    {alloc.appliedToOtherDivisionPrevious > 0 && (
                      <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                        <span>Applied to {otherDiv === 'primary' ? 'Primary Foods' : 'Bakery Foods'} Balance:</span>
                        <span className="font-bold">{formatCurrency(alloc.appliedToOtherDivisionPrevious)}</span>
                      </div>
                    )}
                    {alloc.excessCredit > 0 && (
                      <div className="flex justify-between text-blue-600 dark:text-blue-400 font-bold">
                        <span>Advance Credit Created:</span>
                        <span>+{formatCurrency(alloc.excessCredit)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Method */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-main)] mb-1">Method</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {(['cash', 'upi', 'bank_transfer', 'card'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setDivField(div, 'method', m)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold capitalize transition-all border-2 ${ds.method === m ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-card)]'}`}
                    >
                      {m.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-main)] mb-1">Reference (Optional)</label>
                <input
                  type="text"
                  value={ds.reference}
                  onChange={e => setDivField(div, 'reference', e.target.value)}
                  className={inputClass}
                  placeholder="e.g. UTR12345"
                />
              </div>
            </div>
          );
        };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-[var(--color-bg)] rounded-3xl w-full max-w-sm shadow-2xl flex flex-col max-h-[90vh]">

              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-white/[0.05] shrink-0">
                <div>
                  <h2 className="text-base font-bold text-[var(--color-text-main)]">Record Payment</h2>
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">{paymentModalRow.clientName}</p>
                </div>
                <button onClick={() => setPaymentModalRow(null)} className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable body */}
              <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">

                {/* Date (shared across divisions) - Admin only */}
                {!isStaff && (
                  <div>
                    <label className="block text-xs font-semibold text-[var(--color-text-main)] mb-1">Payment Date</label>
                    <input
                      type="date"
                      value={paymentDate}
                      onChange={e => setPaymentDate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}

                {/* Division tabs (only when both are visible) */}
                {showTabs && (
                  <div className="grid grid-cols-2 gap-2">
                    {(['primary', 'bakery'] as Division[]).map(div => {
                      const cfg = divConfig[div];
                      const isActive = activePaymentDiv === div;
                      const entered = parseFloat(divPaymentState[div].amount) || 0;
                      const hasValue = entered > 0;
                      return (
                        <button
                          key={div}
                          onClick={() => setActivePaymentDiv(div)}
                          className={cn(
                            'py-2 px-3 rounded-xl text-xs font-bold transition-all border-2 flex flex-col items-center gap-0.5',
                            isActive
                              ? `${cfg.activeBorder} ${cfg.activeBg} ${cfg.activeText}`
                              : 'border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-card)]'
                          )}
                        >
                          <span className="text-[11px]">{cfg.label}</span>
                          <span className="font-black text-sm leading-tight">
                            {hasValue ? formatCurrency(entered) : formatCurrency(Math.max(0, cfg.outstanding))}
                          </span>
                          {hasValue && <span className="text-[9px] opacity-70">entered</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Active division form */}
                {showPrimary && (!showTabs || activePaymentDiv === 'primary') && renderDivisionForm('primary')}
                {showBakery  && (!showTabs || activePaymentDiv === 'bakery')  && renderDivisionForm('bakery')}

                {/* Payment Summary */}
                {showTabs && (
                  <div className="bg-gray-50 dark:bg-gray-800/40 rounded-xl overflow-hidden border border-gray-100 dark:border-white/[0.05]">
                    <div className="px-4 py-2 border-b border-gray-100 dark:border-white/[0.05]">
                      <p className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest">Payment Summary</p>
                    </div>
                    <div className="px-4 py-2 space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-[var(--color-text-muted)]">Primary Payment</span>
                        <span className={`font-bold ${primaryEnteredAmt > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>{formatCurrency(primaryEnteredAmt)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-[var(--color-text-muted)]">Bakery Payment</span>
                        <span className={`font-bold ${bakeryEnteredAmt > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}`}>{formatCurrency(bakeryEnteredAmt)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm pt-1.5 border-t border-gray-200 dark:border-white/[0.08]">
                        <span className="font-black text-[var(--color-text-main)] text-xs uppercase tracking-wide">Total Payment</span>
                        <span className={`text-base font-black ${totalPayment > 0 ? 'text-[var(--color-success)]' : 'text-gray-400'}`}>{formatCurrency(totalPayment)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-gray-900/50 shrink-0">
                <Button
                  size="md"
                  className="w-full h-10 text-sm shadow-lg"
                  onClick={handleSavePartialPayment}
                  disabled={isSavingPayment}
                  loading={isSavingPayment}
                >
                  Confirm Payment{totalPayment > 0 ? ` — ${formatCurrency(totalPayment)}` : ''}
                </Button>
              </div>

            </div>
          </div>
        );
      })()}

    </div>
  );
}
