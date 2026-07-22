import { useState, useMemo } from 'react';
import { FileText, Download, Search, Calendar, MapIcon, Users, CheckCircle2, X, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { type Region, type PaymentMethod } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Card, PageHeader, SearchInput, Button } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import { calculateOldBalance, calculatePaymentsOnDate, recordPayment, getPaymentUpdateInfo } from '../../lib/billing';

import { useAuthStore } from '../../stores/authStore';
import { toast } from 'sonner';

interface DailyBillRow {
  clientId: string;
  clientName: string;
  region: string;
  deliveryDate: string;
  billNumber: string;
  items: { productName: string; qty: number; unitPrice: number; total: number }[];
  subtotal: number;
  oldBalance: number;
  grandTotal: number;
  paidAmount: number;
  outstandingBalance: number;
  status: 'paid' | 'partial' | 'unpaid';
  updatedInfo: string | null;
  invoiceId: string;
}

export default function DailyBillingPage() {
  const { orders, clients, regions } = useDataStore();

  const { user } = useAuthStore();
  const isStaff = user?.role === 'staff';
  
  // Filters
  const [filterDate, setFilterDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [filterRegion, setFilterRegion] = useState<Region | ''>('');
  const [filterClientId, setFilterClientId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');

  // Modals
  const [paymentModalRow, setPaymentModalRow] = useState<DailyBillRow | null>(null);
  const [viewBillRow, setViewBillRow] = useState<DailyBillRow | null>(null);

  // Partial Payment State
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');

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
      
      const itemsMap = new Map<string, { qty: number, unitPrice: number, total: number }>();
      clientOrders.forEach(o => {
        o.items.forEach(i => {
          if (!itemsMap.has(i.productName)) {
            itemsMap.set(i.productName, { qty: 0, unitPrice: i.unitPrice, total: 0 });
          }
          const existing = itemsMap.get(i.productName)!;
          existing.qty += i.qty;
          existing.total += i.total;
        });
      });
      const items = Array.from(itemsMap.entries()).map(([name, data]) => ({ productName: name, ...data }));
      
      const subtotal = clientOrders.reduce((sum, o) => sum + o.total, 0);
      const oldBalance = calculateOldBalance(clientId, filterDate);
      const grandTotal = subtotal + oldBalance;
      const paidAmount = calculatePaymentsOnDate(clientId, filterDate);
      const outstandingBalance = grandTotal - paidAmount;
      
      let status: DailyBillRow['status'] = 'unpaid';
      if (paidAmount >= grandTotal && grandTotal > 0) status = 'paid';
      else if (paidAmount > 0) status = 'partial';
      if (grandTotal <= 0 && paidAmount === 0) status = 'paid'; 

      const billNumber = `BILL-${clientId.substring(0,6).toUpperCase()}-${filterDate.replace(/-/g, '')}`;
      const updatedInfo = getPaymentUpdateInfo(clientId, filterDate);

      // Apply status filter
      if (filterStatus !== 'all' && status !== filterStatus) return;

      rows.push({
        clientId, clientName, region, deliveryDate: filterDate, billNumber,
        items, subtotal, oldBalance, grandTotal, paidAmount, outstandingBalance, status, updatedInfo,
        invoiceId: clientOrders[0].id
      });
    });

    return rows.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }, [orders, clients, filterDate, filterRegion, filterClientId, filterStatus, search]);

  // Removed unused aggregated stats

  const handleStatusChange = async (row: DailyBillRow, newStatus: string) => {
    if (newStatus === 'paid') {
      await recordPayment({
        clientId: row.clientId,
        clientName: row.clientName,
        invoiceId: row.invoiceId,
        amount: row.grandTotal,
        method: 'cash',
        updatedBy: isStaff ? 'Staff' : 'Admin',
        billDate: row.deliveryDate
      });
      toast.success('Marked as Paid successfully.');
    } else if (newStatus === 'unpaid') {
      await recordPayment({
        clientId: row.clientId,
        clientName: row.clientName,
        invoiceId: row.invoiceId,
        amount: 0,
        method: 'cash',
        updatedBy: isStaff ? 'Staff' : 'Admin',
        billDate: row.deliveryDate
      });
      toast.success('Marked as Unpaid successfully.');
    } else if (newStatus === 'partial') {
      setPaymentModalRow(row);
      setPaymentAmount(row.paidAmount > 0 ? row.paidAmount.toString() : '');
      setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    }
  };

  const handleSavePartialPayment = async () => {
    if (!paymentModalRow) return;
    
    let amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error('Please enter a valid positive amount.');
      return;
    }
    
    await recordPayment({
      clientId: paymentModalRow.clientId,
      clientName: paymentModalRow.clientName,
      invoiceId: paymentModalRow.invoiceId,
      amount,
      method: paymentMethod,
      updatedBy: isStaff ? 'Staff' : 'Admin',
      paymentDate,
      billDate: paymentModalRow.deliveryDate
    });
    
    toast.success('Partial payment recorded successfully.');
    setPaymentModalRow(null);
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
            table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
            th { text-align: left; padding: 14px; border-bottom: 2px solid #e5e7eb; color: #6b7280; font-size: 13px; text-transform: uppercase; font-weight: 700; }
            td { padding: 14px; border-bottom: 1px solid #f3f4f6; font-size: 15px; font-weight: 500; color: #111; }
            .text-right { text-align: right; }
            .summary-table { width: 340px; margin-left: auto; border-collapse: collapse; background: #f9fafb; border-radius: 12px; overflow: hidden; }
            .summary-table td { padding: 12px 16px; font-size: 15px; border: none; font-weight: 500; }
            .summary-table tr.total td { font-weight: 900; font-size: 20px; background: #fee2e2; color: #991b1b; }
            .status-badge { display: inline-block; padding: 8px 16px; border-radius: 999px; font-weight: 800; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
            .status-paid { background: #dcfce7; color: #166534; }
            .status-partial { background: #fef08a; color: #854d0e; }
            .status-unpaid { background: #fee2e2; color: #991b1b; }
            .footer { margin-top: 60px; text-align: center; font-size: 13px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 24px; font-weight: 500; }
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
              <div style="margin-top: 16px;">
                <span class="status-badge status-${row.status}">
                  ${row.status === 'paid' ? '🟢 PAID' : row.status === 'partial' ? '🟡 PARTIALLY PAID' : '🔴 UNPAID'}
                </span>
              </div>
            </div>
          </div>
          
          <div class="client-section">
            <h3>Billed To</h3>
            <p>${row.clientName}</p>
            <p class="region">Region: ${row.region}</p>
          </div>

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
              ${row.items.map(item => `
                <tr>
                  <td>${item.productName}</td>
                  <td class="text-right">${item.qty}</td>
                  <td class="text-right">₹${item.unitPrice.toFixed(2)}</td>
                  <td class="text-right">₹${item.total.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <table class="summary-table">
            <tr>
              <td>Subtotal:</td>
              <td class="text-right">₹${row.subtotal.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Previous Balance:</td>
              <td class="text-right">₹${row.oldBalance.toFixed(2)}</td>
            </tr>
            <tr class="total">
              <td>Grand Total:</td>
              <td class="text-right">₹${row.grandTotal.toFixed(2)}</td>
            </tr>
            ${row.paidAmount > 0 ? `
            <tr>
              <td style="color: #166534; font-weight: 800;">Paid Amount:</td>
              <td class="text-right" style="color: #166534; font-weight: 800;">₹${row.paidAmount.toFixed(2)}</td>
            </tr>
            ` : ''}
            ${row.outstandingBalance > 0 ? `
            <tr>
              <td style="color: #991b1b; font-weight: 800;">Outstanding:</td>
              <td class="text-right" style="color: #991b1b; font-weight: 800;">₹${row.outstandingBalance.toFixed(2)}</td>
            </tr>
            ` : ''}
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

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <CheckCircle2 className="w-3.5 h-3.5" /> Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="all">All</option>
              <option value="paid">Paid</option>
              <option value="partial">Partially Paid</option>
              <option value="unpaid">Unpaid</option>
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
            <Card key={row.clientId} padding={false} className="flex flex-row items-center justify-between gap-4 px-6 py-4 hover:border-[var(--color-primary)]/30 hover:shadow-lg transition-all duration-300 h-[110px] overflow-hidden">
              
              {/* LEFT: Identity */}
              <div className="flex flex-col justify-center min-w-[200px] h-full">
                <h3 className="text-lg font-black text-[var(--color-text-main)] uppercase tracking-wide leading-tight truncate">{row.clientName}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs font-bold text-[var(--color-text-muted)] truncate">{row.billNumber}</span>
                  <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700"></span>
                  <span className="text-xs font-bold text-[var(--color-text-muted)] truncate">{row.region}</span>
                </div>
              </div>

              {/* CENTER: Financials */}
              <div className="flex-1 flex justify-end items-center px-6 h-full border-r border-gray-100 dark:border-white/[0.05]">
                <div className="text-right">
                  <span className="text-[10px] font-bold text-[var(--color-text-muted)] uppercase tracking-widest block mb-0.5">Grand Total</span>
                  <span className="text-2xl font-black text-[var(--color-text-main)] leading-none">{formatCurrency(row.grandTotal)}</span>
                </div>
              </div>

              {/* RIGHT: Actions */}
              <div className="flex items-center gap-3 shrink-0 h-full pl-2">
                <div className="relative w-[160px]">
                  <select
                    value={row.status}
                    onChange={(e) => handleStatusChange(row, e.target.value)}
                    className={cn(
                      "appearance-none outline-none font-bold text-sm px-4 py-2.5 rounded-full border-2 transition-all cursor-pointer shadow-sm w-full text-left",
                      row.status === 'paid' ? "bg-[var(--color-success-bg)] text-[var(--color-success)] border-[var(--color-success)]/20" :
                      row.status === 'partial' ? "bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 border-amber-500/20" :
                      "bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-500/20"
                    )}
                  >
                    <option value="paid">🟢 Paid</option>
                    <option value="partial">🟡 Partial</option>
                    <option value="unpaid">🔴 Unpaid</option>
                  </select>
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 text-[10px]">▼</div>
                </div>
                
                <button 
                  onClick={() => setViewBillRow(row)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 text-[var(--color-text-main)] rounded-full font-bold text-sm transition-colors border-2 border-gray-200 dark:border-gray-700 shadow-sm whitespace-nowrap"
                >
                  <Eye className="w-4 h-4" /> View Bill
                </button>
                <button 
                  onClick={() => generatePDF(row)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--color-primary)] hover:bg-[var(--color-primary)]/90 text-white rounded-full font-bold text-sm transition-colors shadow-sm border-2 border-transparent whitespace-nowrap"
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
                    viewBillRow.status === 'paid' ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" :
                    viewBillRow.status === 'partial' ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
                    "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                  )}>
                    {viewBillRow.status === 'paid' ? 'Paid' : viewBillRow.status === 'partial' ? 'Partially Paid' : 'Unpaid'}
                  </span>
                </div>
              </div>

              {/* Client Info */}
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-6 mb-8">
                <h3 className="text-xs font-black text-[var(--color-text-muted)] uppercase tracking-widest mb-2">Billed To</h3>
                <p className="text-2xl font-black text-[var(--color-text-main)] uppercase tracking-wide mb-1">{viewBillRow.clientName}</p>
                <p className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-wide">Region: {viewBillRow.region}</p>
              </div>

              {/* Items Table */}
              <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden mb-8">
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
                    {viewBillRow.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-100 dark:border-white/[0.05] last:border-0">
                        <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)]">{item.productName}</td>
                        <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)] text-right">{item.qty}</td>
                        <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-muted)] text-right">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-4 px-6 text-sm font-bold text-[var(--color-text-main)] text-right">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Summary */}
              <div className="flex justify-end">
                <div className="w-full max-w-sm bg-gray-50 dark:bg-gray-800/50 rounded-2xl overflow-hidden">
                  <div className="p-6 flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Subtotal</span>
                      <span className="text-sm font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.subtotal)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-wider">Previous Balance</span>
                      <span className="text-sm font-bold text-[var(--color-text-main)]">{formatCurrency(viewBillRow.oldBalance)}</span>
                    </div>
                  </div>
                  <div className="p-6 bg-red-50 dark:bg-red-900/10 border-t border-red-100 dark:border-red-900/20 flex justify-between items-center">
                    <span className="text-sm font-black text-red-600 dark:text-red-400 uppercase tracking-widest">Grand Total</span>
                    <span className="text-2xl font-black text-red-600 dark:text-red-400">{formatCurrency(viewBillRow.grandTotal)}</span>
                  </div>
                  
                  {(viewBillRow.paidAmount > 0 || viewBillRow.outstandingBalance > 0) && (
                    <div className="p-6 flex flex-col gap-4 border-t border-gray-200 dark:border-gray-800">
                      {viewBillRow.paidAmount > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-bold text-[var(--color-success)] uppercase tracking-wider">Paid Amount</span>
                          <span className="text-sm font-bold text-[var(--color-success)]">{formatCurrency(viewBillRow.paidAmount)}</span>
                        </div>
                      )}
                      {viewBillRow.outstandingBalance > 0 && (
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">Outstanding</span>
                          <span className="text-sm font-black text-red-600 dark:text-red-400">{formatCurrency(viewBillRow.outstandingBalance)}</span>
                        </div>
                      )}
                    </div>
                  )}
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

      {/* Partial Payment Modal */}
      {paymentModalRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-bg)] rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.05]">
              <h2 className="text-lg font-bold text-[var(--color-text-main)]">Partial Payment</h2>
              <button onClick={() => setPaymentModalRow(null)} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl p-4 text-center">
                <p className="text-sm font-medium text-[var(--color-text-muted)] mb-1">Grand Total</p>
                <p className="text-2xl font-black text-[var(--color-text-main)]">{formatCurrency(paymentModalRow.grandTotal)}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Payment Date</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-4 py-3 text-sm font-bold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all mb-1"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Paid Amount (₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder="Enter amount..."
                  className="w-full px-4 py-3 text-lg font-bold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-amber-500 focus:bg-[var(--color-card)] transition-all mb-2"
                  autoFocus
                />
                <div className="flex justify-between items-center px-4 py-3 bg-red-50 dark:bg-red-900/10 rounded-xl mt-3">
                  <span className="text-sm font-semibold text-red-600 dark:text-red-400">Remaining:</span>
                  <span className="text-lg font-black text-red-600 dark:text-red-400">
                    {formatCurrency(paymentModalRow.grandTotal - (parseFloat(paymentAmount) || 0))}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'upi', 'bank_transfer', 'card'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold capitalize transition-all border-2 ${paymentMethod === m ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-card)]'}`}
                    >
                      {m.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              
              <Button size="lg" className="w-full h-12 text-base shadow-lg mt-2" onClick={handleSavePartialPayment}>
                Confirm Amount
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
