import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Save, Search, BookOpen, TrendingUp, TrendingDown,
  Download, CreditCard, Banknote, Smartphone, Building,
  CheckCircle2, Clock, Package, ShoppingCart, Tags, FileText
} from 'lucide-react';
import { type PaymentMethod, type PaymentStatus } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Button, Badge, Card, StatusSelect } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { saveClientPricing } from '../../services/db';
import { useAuthStore } from '../../stores/authStore';

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
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentStatus>('all');

  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  // Load pricing when client is available
  useEffect(() => {
    if (client) {
      const base = clientPricing[client.id] ?? {};
      setPricingState(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, String(v)])));
    }
  }, [clientId]);

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
    const newPricing: Record<string, number> = {};
    Object.entries(pricingState).forEach(([pid, val]) => {
      const num = Number(val);
      if (!isNaN(num) && num > 0) newPricing[pid] = num;
    });
    try {
      await saveClientPricing(client.id, newPricing);
      toast.success('Pricing saved!', { description: `Custom prices updated for ${client.name}` });
    } catch (e) {
      // error handled in db.ts
    }
  };

  const filteredProducts = products.filter(
    p => p.status === 'active' && p.name.toLowerCase().includes(pricingSearch.toLowerCase())
  );

  // --- Order History Tab ---
  const clientOrders = useMemo(() =>
    [...orders.filter(o => o.clientId === client.id)].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    ), [client.id]);

  const filteredOrders = clientOrders.filter(o =>
    o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
    o.createdAt.includes(orderSearch)
  );

  // --- Ledger Tab ---
  const clientPayments = payments.filter(p => p.clientId === client.id);
  const totalDebit = client.totalRevenue || 0;
  const totalCredit = client.totalPaid || 0;
  const balance = client.outstanding || 0;

  const ledgerEntries = useMemo(() => {
    if (!client) return [];
    const clientLedger = ledger.filter(l => l.clientId === client.id);
    const entries: any[] = clientLedger.map(l => ({
      id: l.id,
      date: l.paymentDate || l.createdAt,
      type: l.type,
      description: l.description || (l.type === 'payment' ? `Payment received (${l.paymentMethod?.replace('_', ' ')})` : 'Daily Bill'),
      debit: l.type === 'invoice' ? l.amount : 0,
      credit: l.type === 'payment' ? l.amount : 0
    }));
    
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let bal = 0;
    entries.forEach(e => {
      bal += e.debit - e.credit;
      e.balance = bal;
    });
    return entries;
  }, [client, ledger]);

  // --- Payments Tab ---
  const filteredPayments = clientPayments.filter(p => {
    const matchStatus = paymentFilter === 'all' || p.status === paymentFilter;
    return matchStatus;
  });
  const totalCollected = clientPayments.filter(p => p.status === 'completed').reduce((s, p) => s + p.amount, 0);
  const totalPending = clientPayments.filter(p => p.status === 'pending').reduce((s, p) => s + p.amount, 0);

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
                      {['Order ID', 'Date', 'Items', 'Total', 'Payment Status'].map(h => (
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
                        <td className="px-6 py-4">
                          {(() => {
                            const paymentStatus = o.paymentStatus || 'unpaid';
                            return (
                              <span className={cn(
                                "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest inline-block",
                                paymentStatus === 'paid' ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" :
                                paymentStatus === 'partial' ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
                                "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                              )}>
                                {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                              </span>
                            );
                          })()}
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
                        <td className="px-6 py-4 text-xs font-medium text-gray-500 whitespace-nowrap">{entry.date}</td>
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
              <div className="flex gap-2">
                {(['all', 'completed', 'pending', 'failed'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setPaymentFilter(s)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 capitalize ${paymentFilter === s ? 'bg-[var(--color-primary)] text-white shadow-md shadow-red-500/20' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'}`}
                  >
                    {s === 'completed' ? 'Paid' : s}
                  </button>
                ))}
              </div>
            </div>
            {filteredPayments.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {['Payment ID', 'Method', 'Reference', 'Amount', 'Status', 'Date'].map(h => (
                        <th key={h} className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                    {filteredPayments.map(p => {
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
                          <td className="px-6 py-4">
                            <StatusSelect
                              value={p.status}
                              onChange={() => {}}
                              readonly={true}
                              options={[
                                { value: 'completed', label: 'Paid', dotClass: 'bg-green-500', bgClass: 'bg-green-100 dark:bg-green-950/40 border border-transparent', textClass: 'text-green-700 dark:text-green-400' },
                                { value: 'pending', label: 'Pending', dotClass: 'bg-amber-500', bgClass: 'bg-amber-100 dark:bg-amber-950/40 border border-transparent', textClass: 'text-amber-700 dark:text-amber-400' },
                                { value: 'failed', label: 'Failed', dotClass: 'bg-red-500', bgClass: 'bg-red-100 dark:bg-red-950/40 border border-transparent', textClass: 'text-red-700 dark:text-red-400' }
                              ]}
                            />
                          </td>
                          <td className="px-6 py-4"><span className="text-xs font-medium text-gray-500">{p.paidAt ?? p.createdAt}</span></td>
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
    </div>
  );
}
