import { useState, useMemo } from 'react';
import { FileText, Download, Search, Calendar, MapIcon, Users, CheckCircle2, X, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { type Region, type Division, type PaymentMethod } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Card, PageHeader, SearchInput, Button } from '../../components/ui';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { resolveProductPrice } from '../../lib/pricing';
import { calculateOldBalance, calculatePaymentsOnDate, recordPayment, getPaymentUpdateInfo } from '../../lib/billing';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { toast } from 'sonner';

interface DailyBillRow {
  clientId: string;
  clientName: string;
  region: string;
  deliveryDate: string;
  billNumber: string;
  items: { productName: string; qty: number; unitPrice: number; total: number; division: string }[];
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
  primaryOutstanding: number;
  bakeryOutstanding: number;
  updatedInfo: string | null;
  invoiceId: string;
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

  // Per-division payment state — keyed by division so switching tabs never loses entered values
  interface DivisionPaymentState {
    amount: string;
    method: PaymentMethod;
    reference: string;
  }
  const [paymentDate, setPaymentDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string>('');
  const [activePaymentDiv, setActivePaymentDiv] = useState<Division>('primary');
  const [divPaymentState, setDivPaymentState] = useState<Record<Division, DivisionPaymentState>>({
    primary: { amount: '0', method: 'cash', reference: '' },
    bakery:  { amount: '0', method: 'cash', reference: '' },
  });

  // Helpers to read/write the active division's state
  const curDiv = divPaymentState[activePaymentDiv];
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
      dayOrders = dayOrders.filter(o => regionClientIds.has(o.clientId));
    }
    if (filterClientId) {
      dayOrders = dayOrders.filter(o => o.clientId === filterClientId);
    }
    if (search) {
      const s = search.toLowerCase();
      dayOrders = dayOrders.filter(o => o.clientName.toLowerCase().includes(s));
    }

    const grouped = new Map<string, typeof dayOrders>();
    dayOrders.forEach(o => {
      if (!grouped.has(o.clientId)) grouped.set(o.clientId, []);
      grouped.get(o.clientId)!.push(o);
    });

    const rows: DailyBillRow[] = [];
    grouped.forEach((clientOrders, clientId) => {
      const clientName = clientOrders[0].clientName;
      const region = clients.find(c => c.id === clientId)?.region || '-';
      
      const itemsMap = new Map<string, { qty: number, unitPrice: number, total: number, division: string }>();
      clientOrders.forEach(o => {
        o.items.forEach(i => {
          const prod = products.find(p => p.id === i.productId);
          const div = getProductDivision(prod || { name: i.productName });
          const dynamicPrice = prod ? resolveProductPrice(o.clientId, prod.id) : i.unitPrice;
          const dynamicTotal = dynamicPrice * i.qty;
          const key = `${i.productName}-${div}`;
          if (!itemsMap.has(key)) {
            itemsMap.set(key, { qty: 0, unitPrice: dynamicPrice, total: 0, division: div });
          }
          const existing = itemsMap.get(key)!;
          existing.qty += i.qty;
          existing.total += dynamicTotal;
        });
      });
      const items = Array.from(itemsMap.entries()).map(([_, data]) => ({ ...data, productName: _.split('-')[0] }));
      
      const currentInvoiceIds = clientOrders.map(o => o.id);

      // Per-division calculations (filtered by activeDivision)
      const primaryItems = activeDivision === 'bakery' ? [] : items.filter(i => i.division === 'primary');
      const bakeryItems  = activeDivision === 'primary' ? [] : items.filter(i => i.division === 'bakery');
      
      const primarySubtotal = primaryItems.reduce((s, i) => s + i.total, 0);
      const bakerySubtotal  = bakeryItems.reduce((s, i) => s + i.total, 0);

      const primaryOldBalance = activeDivision === 'bakery' ? 0 : calculateOldBalance(clientId, filterDate, 'primary', currentInvoiceIds);
      const bakeryOldBalance  = activeDivision === 'primary' ? 0 : calculateOldBalance(clientId, filterDate, 'bakery',  currentInvoiceIds);
      const primaryPaid = activeDivision === 'bakery' ? 0 : calculatePaymentsOnDate(clientId, filterDate, 'primary');
      const bakeryPaid  = activeDivision === 'primary' ? 0 : calculatePaymentsOnDate(clientId, filterDate, 'bakery');

      const primaryOutstanding = (primarySubtotal + primaryOldBalance) - primaryPaid;
      const bakeryOutstanding  = (bakerySubtotal  + bakeryOldBalance)  - bakeryPaid;

      // Combined (for card display)
      const subtotal = primarySubtotal + bakerySubtotal;
      const oldBalance = primaryOldBalance + bakeryOldBalance;
      const grandTotal = subtotal + oldBalance;
      const paidAmount = primaryPaid + bakeryPaid;
      const outstandingBalance = (subtotal + oldBalance) - paidAmount;

      const finalItems = [...primaryItems, ...bakeryItems];

      // Skip rendering clients who have zero relevant items and zero outstanding balance in this division
      if (finalItems.length === 0 && Math.abs(outstandingBalance) < 0.01 && paidAmount === 0) {
        return;
      }

      const billNumber = `BILL-${clientId.substring(0,6).toUpperCase()}-${filterDate.replace(/-/g, '')}`;
      const updatedInfo = getPaymentUpdateInfo(clientId, filterDate, 'all');

      rows.push({
        clientId, clientName, region, deliveryDate: filterDate, billNumber,
        items, subtotal, oldBalance, grandTotal, paidAmount, outstandingBalance,
        primarySubtotal, bakerySubtotal, primaryOldBalance, bakeryOldBalance,
        primaryPaid, bakeryPaid, primaryOutstanding, bakeryOutstanding,
        updatedInfo, invoiceId: clientOrders[0].id
      });
    });

    return rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [orders, clients, products, filterDate, filterRegion, filterClientId, search]);

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
    setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    setPaymentNotes('');
    setPaymentInvoiceId(row.invoiceId);
  };

  const handleSavePartialPayment = async () => {
    if (!paymentModalRow) return;

    const primaryAmt = parseFloat(divPaymentState.primary.amount);
    const bakeryAmt  = parseFloat(divPaymentState.bakery.amount);
    const primaryValid = !isNaN(primaryAmt) && primaryAmt > 0;
    const bakeryValid  = !isNaN(bakeryAmt)  && bakeryAmt  > 0;

    if (!primaryValid && !bakeryValid) {
      toast.error('Please enter a payment amount for at least one division.');
      return;
    }
    if (primaryValid && primaryAmt > paymentModalRow.primaryOutstanding + 0.01) {
      toast.error(`Primary payment exceeds outstanding (${formatCurrency(paymentModalRow.primaryOutstanding)}).`);
      return;
    }
    if (bakeryValid && bakeryAmt > paymentModalRow.bakeryOutstanding + 0.01) {
      toast.error(`Bakery payment exceeds outstanding (${formatCurrency(paymentModalRow.bakeryOutstanding)}).`);
      return;
    }

    const base = {
      clientId:   paymentModalRow.clientId,
      clientName: paymentModalRow.clientName,
      invoiceId:  paymentInvoiceId || null,
      updatedBy:  isStaff ? 'Staff' : 'Admin',
      paymentDate,
      billDate:   paymentModalRow.deliveryDate,
      notes:      paymentNotes,
    };

    try {
      if (primaryValid) {
        await recordPayment({ ...base, amount: primaryAmt, method: divPaymentState.primary.method, reference: divPaymentState.primary.reference, division: 'primary' });
      }
      if (bakeryValid) {
        await recordPayment({ ...base, amount: bakeryAmt, method: divPaymentState.bakery.method, reference: divPaymentState.bakery.reference, division: 'bakery' });
      }
      setPaymentModalRow(null);
    } catch (_) {
      // error toasted inside recordPayment
    }
  };

  const generatePDF = (row: DailyBillRow) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Please allow popups to generate PDF');
      return;
    }
    
    const html = `
      <html>
        <head>
          <title>${row.billNumber}</title>
          <style>
            body { font-family: 'Inter', -apple-system, sans-serif; padding: 40px; color: #111; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e5e7eb; padding-bottom: 24px; margin-bottom: 32px; }
            .company-details h1 { margin: 0; color: #dc2626; font-size: 32px; font-weight: 900; letter-spacing: -0.5px; }
            .company-details p { margin: 4px 0; color: #4b5563; font-size: 15px; }
            .bill-details { text-align: right; }
            .bill-details h2 { margin: 0 0 8px 0; color: #111; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; }
            .bill-details p { margin: 4px 0; color: #4b5563; font-size: 15px; font-weight: 600; }
            .client-section { margin-bottom: 32px; background: #f9fafb; padding: 24px; border-radius: 12px; }
            .client-section h3 { margin: 0 0 12px 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
            .client-section p { margin: 0; font-size: 20px; font-weight: 800; color: #111; }
            .client-section .region { margin-top: 4px; font-size: 14px; font-weight: 500; color: #4b5563; }
            .section-title { font-size: 16px; font-weight: 800; color: #111; margin: 0 0 12px 0; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
            th { text-align: left; padding: 10px 14px; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-size: 13px; text-transform: uppercase; font-weight: 700; }
            td { padding: 10px 14px; border-bottom: 1px solid #f3f4f6; font-size: 15px; font-weight: 500; color: #111; }
            .text-right { text-align: right; }
            .subtotal-row td { background: #f9fafb; font-weight: 700; border-bottom: 0; }
            .section-container { margin-bottom: 32px; }
            .summary-table { width: 340px; margin-left: auto; border-collapse: collapse; background: #f9fafb; border-radius: 12px; overflow: hidden; }
            .summary-table td { padding: 12px 16px; font-size: 15px; border: none; font-weight: 500; }
            .summary-table tr.total td { font-weight: 900; font-size: 20px; background: #fee2e2; color: #991b1b; }
            .status-badge { display: inline-block; padding: 8px 16px; border-radius: 999px; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
            .status-paid { background: #dcfce7; color: #166534; }
            .status-partial { background: #fef08a; color: #854d0e; }
            .status-unpaid { background: #fee2e2; color: #991b1b; }
            .footer { margin-top: 60px; text-align: center; font-size: 13px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 24px; font-weight: 500; }
            .div-summary { width: 340px; margin-left: auto; margin-bottom: 12px; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; }
            .div-summary-header { padding: 10px 16px; font-size: 12px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
            .primary-summary .div-summary-header { background: #eff6ff; color: #1d4ed8; border-bottom: 1px solid #bfdbfe; }
            .bakery-summary .div-summary-header { background: #fffbeb; color: #b45309; border-bottom: 1px solid #fde68a; }
            .primary-summary tr.div-outstanding td { font-weight: 900; color: #1d4ed8; background: #eff6ff; border-top: 1px solid #bfdbfe; }
            .bakery-summary tr.div-outstanding td { font-weight: 900; color: #b45309; background: #fffbeb; border-top: 1px solid #fde68a; }
            .grand-total-table { margin-top: 8px; }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-details">
              <h1>Daily Fresh</h1>
              <p>123 Bakery Street, Mangaluru</p>
              <p>Phone: +91 9876543210</p>
            </div>
            <div class="bill-details">
              <h2>INVOICE</h2>
              <p>${row.billNumber}</p>
              <p>Date: ${format(new Date(row.deliveryDate), 'dd MMM yyyy')}</p>
              </div>
            </div>
          </div>
          
          <div class="client-section">
            <h3>Billed To</h3>
            <p>${row.clientName}</p>
            <p class="region">Region: ${row.region}</p>
          </div>

          ${(() => {
            const primary = row.items.filter(i => i.division === 'primary');
            const bakery = row.items.filter(i => i.division === 'bakery');
            let tables = '';
            
            const renderSection = (title: string, items: typeof row.items) => {
              if (items.length === 0) return '';
              const sub = items.reduce((sum, i) => sum + i.total, 0);
              return `
                <div class="section-container">
                  <h4 class="section-title">${title}</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th class="text-right">Qty</th>
                        <th class="text-right">Price</th>
                        <th class="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${items.map(item => `
                        <tr>
                          <td>${item.productName}</td>
                          <td class="text-right">${item.qty}</td>
                          <td class="text-right">₹${item.unitPrice.toFixed(2)}</td>
                          <td class="text-right">₹${item.total.toFixed(2)}</td>
                        </tr>
                      `).join('')}
                      <tr class="subtotal-row">
                        <td colspan="3" class="text-right">${title} Subtotal</td>
                        <td class="text-right">₹${sub.toFixed(2)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              `;
            };
            
            tables += renderSection('Primary Foods', primary);
            tables += renderSection('Bakery Foods', bakery);
            return tables;
          })()}

          ${(() => {
            const sections: string[] = [];

            if (row.items.some(i => i.division === 'primary')) {
              sections.push(`
                <div class="div-summary primary-summary">
                  <div class="div-summary-header">Primary Foods</div>
                  <table class="summary-table">
                    <tr><td>Subtotal</td><td class="text-right">₹${row.primarySubtotal.toFixed(2)}</td></tr>
                    <tr><td>Previous Balance</td><td class="text-right">₹${row.primaryOldBalance.toFixed(2)}</td></tr>
                    ${row.primaryPaid > 0 ? `<tr style="color:#166534"><td>Paid Today</td><td class="text-right">₹${row.primaryPaid.toFixed(2)}</td></tr>` : ''}
                    <tr class="div-outstanding"><td>Outstanding</td><td class="text-right">₹${Math.max(0, row.primaryOutstanding).toFixed(2)}</td></tr>
                  </table>
                </div>
              `);
            }

            if (row.items.some(i => i.division === 'bakery')) {
              sections.push(`
                <div class="div-summary bakery-summary">
                  <div class="div-summary-header">Bakery Foods</div>
                  <table class="summary-table">
                    <tr><td>Subtotal</td><td class="text-right">₹${row.bakerySubtotal.toFixed(2)}</td></tr>
                    <tr><td>Previous Balance</td><td class="text-right">₹${row.bakeryOldBalance.toFixed(2)}</td></tr>
                    ${row.bakeryPaid > 0 ? `<tr style="color:#166534"><td>Paid Today</td><td class="text-right">₹${row.bakeryPaid.toFixed(2)}</td></tr>` : ''}
                    <tr class="div-outstanding"><td>Outstanding</td><td class="text-right">₹${Math.max(0, row.bakeryOutstanding).toFixed(2)}</td></tr>
                  </table>
                </div>
              `);
            }

            return sections.join('');
          })()}

          <table class="summary-table grand-total-table">
            <tr class="total">
              <td>${activeDivision !== 'all' ? (activeDivision === 'primary' ? 'Primary' : 'Bakery') : 'Grand'} Outstanding</td>
              <td class="text-right">₹${Math.max(0, row.outstandingBalance).toFixed(2)}</td>
            </tr>
          </table>

          <div class="footer">
            <p>Thank you for your business!</p>
            <p>This is a computer generated invoice.</p>
          </div>
          
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
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
                <div>
                  <h1 className="text-3xl font-black text-red-600 dark:text-red-500 mb-1 tracking-tight">Daily Fresh</h1>
                  <p className="text-sm font-medium text-[var(--color-text-muted)]">123 Bakery Street, Mangaluru</p>
                  <p className="text-sm font-medium text-[var(--color-text-muted)]">Phone: +91 9876543210</p>
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
                              <th className="py-4 px-6 text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest border-b border-gray-200 dark:border-gray-800 text-right">Unit Price</th>
                              <th className="py-4 px-6 text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest border-b border-gray-200 dark:border-gray-800 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item, idx) => (
                              <tr key={idx} className="border-b border-gray-100 dark:border-white/[0.05] last:border-0">
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)]">{item.productName}</td>
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)] text-right">{item.qty}</td>
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-muted)] text-right">{formatCurrency(item.unitPrice)}</td>
                                <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)] text-right">{formatCurrency(item.total)}</td>
                              </tr>
                            ))}
                            <tr className="bg-gray-50 dark:bg-gray-800/20">
                              <td colSpan={3} className="py-4 px-6 text-sm font-black text-[var(--color-text-main)] text-right">{title} Subtotal</td>
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
                          <span className="font-semibold text-[var(--color-text-muted)]">Subtotal</span>
                          <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.primarySubtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-[var(--color-text-muted)]">Previous Balance</span>
                          <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.primaryOldBalance)}</span>
                        </div>
                        {viewBillRow.primaryPaid > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-green-600 dark:text-green-400">Paid Today</span>
                            <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(viewBillRow.primaryPaid)}</span>
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
                          <span className="font-semibold text-[var(--color-text-muted)]">Subtotal</span>
                          <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.bakerySubtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="font-semibold text-[var(--color-text-muted)]">Previous Balance</span>
                          <span className="font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.bakeryOldBalance)}</span>
                        </div>
                        {viewBillRow.bakeryPaid > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold text-green-600 dark:text-green-400">Paid Today</span>
                            <span className="font-bold text-green-600 dark:text-green-400">{formatCurrency(viewBillRow.bakeryPaid)}</span>
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
            
            <div className="p-6 border-t border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-gray-900/50 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setViewBillRow(null)}>Close</Button>
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
          const remaining = Math.max(0, cfg.outstanding - entered);
          const overLimit = entered > cfg.outstanding + 0.01;

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
                {overLimit && <p className="text-[11px] font-semibold text-red-500 mt-1">Exceeds outstanding of {formatCurrency(cfg.outstanding)}</p>}
              </div>

              {/* Method */}
              <div>
                <label className="block text-xs font-semibold text-[var(--color-text-main)] mb-1">Method</label>
                <div className="grid grid-cols-4 gap-1.5">
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

                {/* Date (shared across divisions) */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--color-text-main)] mb-1">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    className={inputClass}
                  />
                </div>

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
                <Button size="md" className="w-full h-10 text-sm shadow-lg" onClick={handleSavePartialPayment}>
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
