import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, FileText, CheckCircle2, TrendingUp, TrendingDown, 
  Package, Calendar, UserPlus, CreditCard, Check, Clock, Edit3, X,
  Banknote, Smartphone, Building, ShoppingCart, Tags, Search, Save,
  Download, BookOpen
} from 'lucide-react';
import { type PaymentMethod } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Button, Badge, Card, StatusSelect } from '../../components/ui';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { saveClientPricing, updatePayment } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { getClientOutstanding, getClientMetrics } from '../../lib/billing';
type Tab = 'general' | 'pricing' | 'orders' | 'ledger' | 'payments';

const methodIcon: Record<PaymentMethod, React.ElementType> = {
  upi: Smartphone, cash: Banknote, bank_transfer: Building, card: CreditCard,
};
const methodLabel: Record<PaymentMethod, string> = {
  upi: 'UPI', cash: 'Cash', bank_transfer: 'Bank Transfer', card: 'Card',
};

const TABS: { id: Tab; label: string; icon: React.ElementType; adminOnly?: boolean }[] = [
  { id: 'general', label: 'General', icon: FileText },
  { id: 'pricing', label: 'Product Pricing', icon: Tags, adminOnly: true },
  { id: 'orders', label: 'Order History', icon: ShoppingCart },
  { id: 'ledger', label: 'Ledger', icon: BookOpen, adminOnly: true },
  { id: 'payments', label: 'Payments', icon: CreditCard, adminOnly: true },
];

export default function ClientDetailPage() {
  const { clients, orders, products, clientPricing, payments, ledger } = useDataStore();
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

  const client = clients.find(c => c.id === clientId);

  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [pricingState, setPricingState] = useState<Record<string, string>>({});
  const [pricingSearch, setPricingSearch] = useState('');
  const [orderSearch, setOrderSearch] = useState('');

  const { activeDivision } = useDivisionStore();

  // Payment Edit Modal State
  const [editingPayment, setEditingPayment] = useState<any>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editMethod, setEditMethod] = useState<PaymentMethod>('cash');
  const [editReference, setEditReference] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const isStaff = user?.role === 'staff';
  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  // Load pricing when client is available
  useEffect(() => {
    if (client) {
      const base = clientPricing[client.id] ?? {};
      setPricingState(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])));
    }
  }, [client, clientPricing]);

  // --- Order History Tab ---
  const clientOrders = useMemo(() => {
    if (!client) return [];
    let list = orders.filter(o => o.clientId === client.id);
    if (activeDivision !== 'all') {
       list = list.filter(o => o.division === 'all' || o.division === activeDivision);
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [client, orders, activeDivision]);

  // --- Ledger Tab ---
  const ledgerEntries = useMemo(() => {
    if (!client) return [];
    const clientLedger = ledger.filter(l => {
      if (l.clientId !== client.id) return false;
      if (activeDivision !== 'all') {
        const d = l.division;
        if (d && d !== 'all' && d !== activeDivision) return false;
      }
      return true;
    });
    const entries: any[] = clientLedger.map(l => {
      const rawDate = l.paymentDate || l.billDate || l.createdAt;
      const parsedDate = new Date(rawDate.length === 10 ? `${rawDate}T12:00:00` : rawDate);
      return {
        id: l.id,
        date: rawDate,
        displayDate: format(parsedDate, l.type === 'invoice' ? 'MMM d, yyyy' : 'MMM d, yyyy h:mm a'),
        type: l.type,
        description: l.description || (l.type === 'payment' ? `Payment received (${l.paymentMethod?.replace('_', ' ')})` : 'Daily Bill'),
        debit: l.type === 'invoice' ? l.amount : 0,
        credit: l.type === 'payment' ? l.amount : 0,
      };
    });

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    const finalEntries: any[] = entries.map(e => {
      runningBalance += (e.debit - e.credit);
      return { ...e, balance: runningBalance };
    });

    return finalEntries.reverse();
  }, [client, ledger, activeDivision]);

  if (!client) {
    return (
      <div className="max-w-5xl mx-auto pb-12 text-center py-24">
        <p className="text-lg font-semibold text-[var(--color-text-muted)]">Client not found.</p>
        <Button className="mt-4" onClick={() => navigate('/clients')}>Back to Clients</Button>
      </div>
    );
  }

  // --- Pricing Tab ---
  const handlePricingSave = async () => {
    const primaryPricing: Record<string, number> = {};
    const bakeryPricing: Record<string, number> = {};
    Object.entries(pricingState).forEach(([pid, val]) => {
      const num = Number(val);
      if (!isNaN(num) && num > 0) {
        const prod = products.find(p => p.id === pid);
        if (prod && getProductDivision(prod) === 'bakery') {
          bakeryPricing[pid] = num;
        } else {
          primaryPricing[pid] = num;
        }
      }
    });
    try {
      if (client) {
        if (Object.keys(primaryPricing).length > 0) {
          await saveClientPricing(client.id, 'primary', primaryPricing);
        }
        if (Object.keys(bakeryPricing).length > 0) {
          await saveClientPricing(client.id, 'bakery', bakeryPricing);
        }
      }
      toast.success('Pricing saved!', { description: `Custom prices updated for ${client.name}` });
    } catch (e) {
      // error handled in db.ts
    }
  };

  const filteredProducts = products.filter(
    p => p.status === 'active' && p.name.toLowerCase().includes(pricingSearch.toLowerCase())
  );



  const filteredOrders = clientOrders.filter(o =>
    o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
    o.createdAt.includes(orderSearch)
  );

  const metrics = getClientMetrics(client.id, activeDivision);
  const totalDebit = metrics.totalInvoiced;
  const totalCredit = metrics.totalPaid;
  const balance = metrics.outstanding;

  // --- Payments Tab ---
  const clientPayments = payments.filter(p => {
    if (p.clientId !== client.id) return false;
    if (activeDivision !== 'all' && p.division !== activeDivision) return false;
    return true;
  });
  const totalCollected = totalCredit;
  const totalPending = balance;

  const handleSavePaymentEdit = async () => {
    if (!editingPayment) return;
    try {
      const amount = parseFloat(editAmount);
      if (isNaN(amount) || amount < 0) {
        toast.error("Please enter a valid amount");
        return;
      }
      await updatePayment(editingPayment.id, {
        amount,
        method: editMethod,
        reference: editReference,
        notes: editNotes,
        updatedBy: isStaff ? 'Staff' : 'Admin'
      });
      toast.success("Payment updated successfully");
      setEditingPayment(null);
    } catch (e) {
      // error handled in db.ts
    }
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* Back button */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/clients')}
          className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[var(--color-primary)] transition-colors group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
          Back to Clients
        </button>
      </div>

      {/* Client Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[var(--color-primary)]/10 flex items-center justify-center text-[var(--color-primary)] text-xl font-extrabold shrink-0">
            {client.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--color-text-main)] tracking-tight">{client.name}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {client.phone && (
                <>
                  <span className="text-sm font-medium text-[var(--color-text-muted)]">{client.phone}</span>
                  <span className="text-gray-300 dark:text-gray-700">•</span>
                </>
              )}
              <span className="text-xs font-semibold text-[var(--color-text-muted)] bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">{client.region}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <StatusSelect
            value={client.status}
            onChange={() => {}}
            readonly={true}
            options={[
              { value: 'active', label: 'Active', dotClass: 'bg-green-500', bgClass: 'bg-green-100 dark:bg-green-950/40 border border-transparent', textClass: 'text-green-700 dark:text-green-400' },
              { value: 'inactive', label: 'Inactive', dotClass: 'bg-red-500', bgClass: 'bg-red-100 dark:bg-red-950/40 border border-transparent', textClass: 'text-red-700 dark:text-red-400' }
            ]}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800/60 p-1 rounded-2xl overflow-x-auto">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap flex-1 justify-center ${
                isActive
                  ? 'bg-white dark:bg-gray-900 text-[var(--color-text-main)] shadow-sm'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-[var(--color-primary)]' : ''}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ─── TAB: GENERAL ─── */}
      {activeTab === 'general' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
          <Card>
            <h2 className="text-base font-bold text-[var(--color-text-main)] mb-5">Business Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Business Name', value: client.name },
                { label: 'Region', value: client.region },
                ...(client.phone ? [{ label: 'Phone', value: client.phone }] : []),
                ...(client.email ? [{ label: 'Email', value: client.email }] : []),
                { label: 'Status', value: client.status === 'active' ? 'Active' : 'Inactive' },
                { label: 'Total Orders', value: String(clientOrders.length) },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-widest mb-1">{label}</p>
                  <p className="text-sm font-semibold text-[var(--color-text-main)]">{value || '—'}</p>
                </div>
              ))}
            </div>
          </Card>
          <div className="grid grid-cols-3 gap-4">
            <Card className="text-center">
              <p className="text-3xl font-extrabold text-[var(--color-text-main)]">{clientOrders.length}</p>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] mt-1 uppercase tracking-widest">Total Orders</p>
            </Card>
            <Card className="text-center">
              <p className="text-3xl font-extrabold text-[var(--color-success)]">{formatCurrency(totalCollected)}</p>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] mt-1 uppercase tracking-widest">Total Paid</p>
            </Card>
            <Card className="text-center">
              <p className="text-3xl font-extrabold text-amber-600">{formatCurrency(totalPending)}</p>
              <p className="text-xs font-semibold text-[var(--color-text-muted)] mt-1 uppercase tracking-widest">Outstanding</p>
            </Card>
          </div>
        </div>
      )}

      {/* ─── TAB: PRODUCT PRICING ─── */}
      {activeTab === 'pricing' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Card padding={false} className="overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">Product Pricing</h2>
                <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Custom prices for {client.name}.</p>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    value={pricingSearch}
                    onChange={e => setPricingSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 text-sm rounded-full bg-[var(--color-input-bg)] border border-transparent focus:border-[var(--color-primary)] text-[var(--color-text-main)] outline-none transition-all placeholder-gray-400 shadow-sm"
                  />
                </div>
                <Button size="sm" icon={<Save className="w-4 h-4" />} onClick={handlePricingSave}>
                  Save
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60 w-1/2">Product</th>
                    <th className="text-right px-6 py-4 text-xs font-semibold text-[var(--color-primary)] uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60 w-1/2">Custom Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                  {filteredProducts.map(p => {
                    const hasCustom = pricingState[p.id] !== undefined && pricingState[p.id] !== '';
                    return (
                      <tr key={p.id} className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 ${hasCustom ? 'bg-[var(--color-primary)]/[0.02] dark:bg-[var(--color-primary)]/[0.05]' : ''}`}>
                        <td className="px-6 py-4">
                          <p className="font-semibold text-[var(--color-text-main)]">{p.name}</p>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{p.description}</p>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-sm font-medium text-gray-400">₹</span>
                            <input
                              type="number"
                              placeholder="0"
                              value={pricingState[p.id] ?? ''}
                              onChange={e => setPricingState(prev => ({ ...prev, [p.id]: e.target.value }))}
                              min={0}
                              className="w-32 px-4 py-2.5 text-sm font-semibold text-right rounded-full border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] placeholder-gray-400 focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] shadow-sm outline-none transition-all duration-200"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-6 py-12 text-center text-gray-400">No products found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ─── TAB: ORDER HISTORY ─── */}
      {activeTab === 'orders' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Card padding={false} className="overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">Order History</h2>
                <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">{clientOrders.length} total orders</p>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search orders..."
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm rounded-full bg-[var(--color-input-bg)] border border-transparent focus:border-[var(--color-primary)] text-[var(--color-text-main)] outline-none transition-all placeholder-gray-400 shadow-sm"
                />
              </div>
            </div>
            {filteredOrders.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {['Order ID', 'Date', 'Items', 'Total'].map(h => (
                        <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {filteredOrders.map(o => (
                      <tr
                        key={o.id}
                        onClick={() => navigate(isAdmin ? `/orders/${o.clientId}?date=${o.createdAt}` : `/billing?client=${o.clientId}&date=${o.deliveryDate}`)}
                        className="transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 cursor-pointer"
                      >
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs font-semibold text-[var(--color-text-main)]">{o.id}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-medium text-[var(--color-text-muted)]">{format(new Date(o.createdAt), 'MMM d, yyyy')}</span>
                        </td>
                        <td className="px-6 py-4">
                          <Badge variant="gray">{o.items.reduce((s, i) => s + i.qty, 0)} items</Badge>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(o.total)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-3">
                  <Package className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-[var(--color-text-muted)]">No orders found.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── TAB: LEDGER ─── */}
      {activeTab === 'ledger' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Card className="flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-[var(--color-primary)]" />
                </div>
                <p className="text-sm font-bold text-[var(--color-text-muted)]">Total Invoiced</p>
              </div>
              <p className="text-2xl font-semibold text-[var(--color-text-main)] tracking-tight">{formatCurrency(totalDebit)}</p>
            </Card>
            <Card className="flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[var(--color-success-bg)] flex items-center justify-center">
                  <TrendingDown className="w-4 h-4 text-[var(--color-success)]" />
                </div>
                <p className="text-sm font-bold text-[var(--color-text-muted)]">Total Paid</p>
              </div>
              <p className="text-2xl font-semibold text-[var(--color-success)] tracking-tight">{formatCurrency(totalCredit)}</p>
            </Card>
            <Card className="flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-primary)]/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/3" />
              <div className="flex items-center gap-2 mb-4 relative">
                <p className="text-sm font-bold text-[var(--color-text-muted)]">Outstanding Balance</p>
              </div>
              <div className="relative">
                <p className={`text-3xl font-semibold tracking-tight ${balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-success)]'}`}>
                  {formatCurrency(Math.abs(balance))}
                </p>
                <Badge variant={balance > 0 ? 'warning' : 'success'} className="mt-2 relative z-10">
                  {balance > 0 ? 'Receivable' : 'Settled'}
                </Badge>
              </div>
            </Card>
          </div>
          <Card padding={false} className="overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">Account Statement</h2>
                <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">{client.name} — All transactions</p>
              </div>
              <Button variant="outline" size="sm" icon={<Download className="w-4 h-4" />}>Export PDF</Button>
            </div>
            {ledgerEntries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {['Date', 'Type', 'Description', 'Debit', 'Credit', 'Balance'].map((h, i) => (
                        <th key={h} className={`px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60 ${i >= 3 ? 'text-right' : 'text-left'} ${h === 'Balance' ? 'text-[var(--color-primary)]' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {ledgerEntries.map(entry => (
                      <tr key={entry.id} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30">
                        <td className="px-6 py-4 text-xs font-medium text-gray-500 whitespace-nowrap">{entry.displayDate}</td>
                        <td className="px-6 py-4"><Badge variant={entry.type === 'invoice' ? 'info' : 'success'}>{entry.type === 'invoice' ? 'Invoice' : 'Payment'}</Badge></td>
                        <td className="px-6 py-4"><p className="text-sm font-medium text-[var(--color-text-main)] max-w-[200px] truncate">{entry.description}</p></td>
                        <td className="px-6 py-4 text-right">{entry.debit > 0 ? <span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(entry.debit)}</span> : <span className="text-gray-300 dark:text-gray-700">—</span>}</td>
                        <td className="px-6 py-4 text-right">{entry.credit > 0 ? <span className="text-sm font-semibold text-[var(--color-success)]">{formatCurrency(entry.credit)}</span> : <span className="text-gray-300 dark:text-gray-700">—</span>}</td>
                        <td className="px-6 py-4 text-right"><span className={`text-sm font-semibold ${entry.balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-success)]'}`}>{formatCurrency(entry.balance)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <BookOpen className="w-10 h-10 text-gray-300 mb-3" />
                <p className="text-sm font-semibold text-[var(--color-text-muted)]">No ledger entries for this client yet.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─── TAB: PAYMENTS ─── */}
      {activeTab === 'payments' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <Card className="flex flex-col justify-between">
              <div className="w-10 h-10 rounded-full bg-[var(--color-success-bg)] flex items-center justify-center mb-4">
                <CheckCircle2 className="w-5 h-5 text-[var(--color-success)]" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-[var(--color-success)] tracking-tight mb-1">{formatCurrency(totalCollected)}</p>
                <p className="text-sm font-medium text-[var(--color-text-muted)]">Total Collected</p>
              </div>
            </Card>
            <Card className="flex flex-col justify-between">
              <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-amber-600 dark:text-amber-400 tracking-tight mb-1">{formatCurrency(totalPending)}</p>
                <p className="text-sm font-medium text-[var(--color-text-muted)]">Pending</p>
              </div>
            </Card>
            <Card className="flex flex-col justify-between">
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center mb-4">
                <CreditCard className="w-5 h-5 text-[var(--color-primary)]" />
              </div>
              <div>
                <p className="text-2xl font-semibold text-[var(--color-text-main)] tracking-tight mb-1">{clientPayments.length}</p>
                <p className="text-sm font-medium text-[var(--color-text-muted)]">Transactions</p>
              </div>
            </Card>
          </div>
          <Card padding={false} className="overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 flex gap-4 items-center">
              <h2 className="text-base font-semibold text-[var(--color-text-main)] flex-1">Payment History</h2>
            </div>
            {clientPayments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {['Payment ID', 'Method', 'Reference', 'Amount', 'Date', 'Actions'].map(h => (
                        <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {clientPayments.map(p => {
                      const Icon = methodIcon[p.method];
                      return (
                        <tr key={p.id} className="transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30">
                          <td className="px-6 py-4"><span className="font-mono text-xs font-semibold text-[var(--color-text-main)]">{p.id}</span></td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                <Icon className="w-3.5 h-3.5 text-gray-500" />
                              </div>
                              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{methodLabel[p.method]}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">{p.reference ? <span className="font-mono text-[10px] font-medium text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-md">{p.reference}</span> : <span className="text-gray-300 dark:text-gray-700">—</span>}</td>
                          <td className="px-6 py-4"><span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(p.amount)}</span></td>
                          <td className="px-6 py-4"><span className="text-xs font-medium text-gray-500">{format(new Date(p.createdAt), 'MMM d, yyyy h:mm a')}</span></td>
                          <td className="px-6 py-4">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setEditingPayment(p);
                                setEditAmount(p.amount.toString());
                                setEditMethod(p.method);
                                setEditReference(p.reference || '');
                                setEditNotes(p.notes || '');
                              }}
                            >
                              Edit
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CreditCard className="w-10 h-10 text-gray-300 mb-3" />
                <p className="text-sm font-semibold text-[var(--color-text-muted)]">No payments for this client yet.</p>
              </div>
            )}
          </Card>
        </div>
      )}
      
      {/* Edit Payment Modal */}
      {editingPayment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-[var(--color-bg)] rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-white/[0.05]">
              <h2 className="text-lg font-bold text-[var(--color-text-main)]">Edit Payment</h2>
              <button onClick={() => setEditingPayment(null)} className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-1.5">Amount</label>
                <input
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="w-full px-4 py-3 text-sm font-bold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-1.5">Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['cash', 'upi', 'bank_transfer', 'card'] as PaymentMethod[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setEditMethod(m)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold capitalize transition-all border-2 ${editMethod === m ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-muted)] hover:bg-[var(--color-card)]'}`}
                    >
                      {m.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-1.5">Reference No</label>
                <input
                  type="text"
                  value={editReference}
                  onChange={(e) => setEditReference(e.target.value)}
                  className="w-full px-4 py-2 text-sm font-bold rounded-xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] transition-all"
                />
              </div>

              <Button size="lg" className="w-full h-12 text-base shadow-lg mt-4" onClick={handleSavePaymentEdit}>
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
