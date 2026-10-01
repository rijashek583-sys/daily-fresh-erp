import React from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, AlertCircle, Package, FileText, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { monthlyRevenueData, DIVISION_LABELS } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { format } from 'date-fns';
import { PageHeader, StatCard, Card, DataTable, Badge, type Column } from '../../components/ui';
import { formatCurrency, cn, getProductDivision } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { useStockStore } from '../../stores/stockStore';
import { getFinishedStockBalance } from '../../services/stockDb';
import { getClientOutstanding, getClientMetrics, getPendingCollections, type PendingCollectionRow } from '../../lib/billing';


export default function DashboardPage() {
  const { orders, clients, payments, products, ledger } = useDataStore();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { activeDivision: activeTab } = useDivisionStore();
  
  const [pendingDate, setPendingDate] = React.useState<string>('');

  const { finishedStockTransactions } = useStockStore();
  
  const lowStockCount = React.useMemo(() => {
    let count = 0;
    products.forEach(p => {
      if (p.status === 'active' && !p.deletedAt) {
        const bal = getFinishedStockBalance(p.id, finishedStockTransactions);
        if (bal <= 0) count++;
      }
    });
    return count;
  }, [products, finishedStockTransactions]);

  const { 
    computedTopClients, activeOrders,
    todaysRevenue, todaysOrders, totalClients, outstandingAmount,
    monthlyRev
  } = React.useMemo(() => {
    // Filter orders if a division is selected
    const validOrders = orders.map(o => {
      if (activeTab === 'all') return o;
      const filteredItems = o.items.filter(item => {
        const product = products.find(p => p.id === item.productId);
        const div = getProductDivision(product);
        return div === activeTab;
      });
      return {
        ...o,
        items: filteredItems,
        total: filteredItems.reduce((sum, item) => sum + item.total, 0)
      };
    }).filter(o => activeTab === 'all' || o.items.length > 0);

    const activeClientsList = clients.filter(c => !c.deletedAt && c.status === 'active');
    
    // Today's stats
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todaysValidOrders = validOrders.filter(o => o.deliveryDate === todayStr);
    
    const todaysRevenue = todaysValidOrders.reduce((sum, o) => sum + o.total, 0);
    const todaysOrders = todaysValidOrders.length;
    const totalClients = activeClientsList.length;
    
    // Outstanding amount across all clients — computed live from ledger store
    const outstandingAmount = activeClientsList.reduce((sum, c) => sum + getClientOutstanding(c.id, activeTab), 0);

    const map = new Map<string, { name: string, orders: number, revenue: number, thisMonthRev: number, lastMonthRev: number, trend: number }>();
    const { ledger } = useDataStore.getState();
    
    const thisMonth = new Date().getMonth();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyRev = Array.from({length: 6}, (_, i) => {
      const m = (thisMonth - 5 + i + 12) % 12;
      return { month: monthNames[m], revenue: 0, monthIndex: m };
    });
    
    ledger.forEach(l => {
      if (l.type === 'invoice' && (activeTab === 'all' || l.division === 'all' || !l.division || l.division === activeTab)) {
        const amt = l.amount || 0;
        const lDate = new Date(l.billDate || l.createdAt);
        const lMonth = lDate.getMonth();
        
        // Add to monthly chart if in last 6 months
        const targetMonth = monthlyRev.find(m => m.monthIndex === lMonth);
        if (targetMonth && lDate.getFullYear() === new Date().getFullYear()) {
          targetMonth.revenue += amt;
        }

        const client = activeClientsList.find(c => c.id === l.clientId);
        if (client) {
          const current = map.get(l.clientId) || { name: client.name, orders: 0, revenue: 0, thisMonthRev: 0, lastMonthRev: 0, trend: 0 };
          current.orders += 1;
          current.revenue += amt;
          
          if (lMonth === thisMonth) current.thisMonthRev += amt;
          else if (lMonth === lastMonth) current.lastMonthRev += amt;
          
          current.trend = current.lastMonthRev > 0 
            ? Math.round(((current.thisMonthRev - current.lastMonthRev) / current.lastMonthRev) * 100) 
            : (current.thisMonthRev > 0 ? 100 : 0);
            
          map.set(l.clientId, current);
        }
      }
    });
    const top = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    
    return { 
      computedTopClients: top, activeOrders: validOrders,
      todaysRevenue, todaysOrders, totalClients, outstandingAmount,
      monthlyRev
    };
  }, [orders, clients, payments, products, activeTab, ledger]);

  // All clients with pending outstanding balance, sorted highest to lowest
  const overallPending = React.useMemo(() => {
    const activeClientsList = clients.filter(c => !c.deletedAt && c.status === 'active');
    
    // If a date is selected, get per-client pending for that date
    const datePendingMap = new Map<string, number>();
    if (pendingDate) {
      const dateResult = getPendingCollections(activeTab, pendingDate, activeClientsList);
      dateResult.rows.forEach(r => {
        datePendingMap.set(r.clientId, r.pendingAmount);
      });
    }

    const rows = activeClientsList.map(c => {
      const metrics = getClientMetrics(c.id, activeTab);
      const datePending = pendingDate ? (datePendingMap.get(c.id) || 0) : 0;
      return {
        clientId: c.id,
        clientName: c.name,
        region: c.region || c.city || '-',
        totalOrders: metrics.totalOrders,
        totalInvoiced: metrics.totalInvoiced,
        totalPaid: metrics.totalPaid,
        outstanding: metrics.outstanding,
        datePending,
      };
    }).filter(r => r.outstanding > 0 || (pendingDate && r.datePending > 0));

    // Sort from HIGHEST outstanding to LOWEST
    rows.sort((a, b) => b.outstanding - a.outstanding);

    const totalOutstanding = rows.reduce((s, r) => s + r.outstanding, 0);
    const totalInvoiced = rows.reduce((s, r) => s + r.totalInvoiced, 0);
    const totalPaid = rows.reduce((s, r) => s + r.totalPaid, 0);
    const totalDatePending = rows.reduce((s, r) => s + (r.datePending || 0), 0);

    return { rows, totalOutstanding, totalInvoiced, totalPaid, totalDatePending };
  }, [clients, ledger, orders, payments, activeTab, pendingDate]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[var(--color-card)] border border-gray-100 dark:border-white/[0.05] rounded-2xl shadow-[var(--shadow-hover)] p-4 text-sm">
        <p className="text-gray-500 font-medium text-xs mb-3 uppercase tracking-wider">{label}</p>
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--color-primary)] shadow-sm shadow-red-500/50" />
          <span className="text-xs font-bold text-gray-500">Revenue:</span>
          <span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(payload[0].value)}</span>
        </div>
      </div>
    );
  };

  const orderColumns: Column<typeof orders[0]>[] = [
    {
      key: 'id', label: 'Order',
      render: r => <span className="font-mono text-xs font-bold text-gray-900 dark:text-white">{r.id}</span>,
    },
    {
      key: 'clientName', label: 'Client',
      render: r => (
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-[var(--color-text-main)]">{r.clientName}</span>
        </div>
      ),
    },

    {
      key: 'total', label: 'Amount', align: 'right',
      render: r => <span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(r.total)}</span>,
    },
  ];

  if (user?.role === 'delivery_staff') {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <PageHeader
          title={`Welcome back, ${user?.displayName || user?.name} 👋`}
          description="Here's a summary of the business operations."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Today's Orders"
            value={todaysOrders.toString()}
            icon={<Package className="w-5 h-5" />}
          />
          <StatCard
            label="Total Clients"
            value={totalClients.toString()}
            icon={<FileText className="w-5 h-5" />}
          />
          <StatCard
            label="Today's Revenue"
            value={formatCurrency(todaysRevenue)}
            icon={<IndianRupee className="w-5 h-5" />}
            iconBg="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
          />
          <StatCard
            label="Outstanding Amount"
            value={formatCurrency(outstandingAmount)}
            icon={<AlertCircle className="w-5 h-5" />}
            iconBg="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
          />
        </div>
        <Card padding={false}>
          <div className="px-6 pt-6 pb-4 sm:px-8 sm:pt-8 border-b border-gray-100 dark:border-white/[0.05]">
            <h2 className="text-lg font-semibold text-[var(--color-text-main)] tracking-tight">Recent Orders</h2>
          </div>
          <DataTable
            columns={orderColumns}
            data={activeOrders.slice(0, 10)}
            keyExtractor={r => r.id}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 sm:space-y-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title={`Welcome back, ${user?.displayName || user?.name} 👋`}
          description="Here's what's happening with your business today."
        />
      </div>

      {user?.role === 'admin' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Today's Revenue"
          value={formatCurrency(todaysRevenue)}
          icon={<IndianRupee className="w-5 h-5" />}
          iconBg="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
        />
        <StatCard
          label="Today's Orders"
          value={todaysOrders.toString()}
          icon={<Package className="w-5 h-5" />}
        />
        <StatCard
          label="Total Clients"
          value={totalClients.toString()}
          icon={<FileText className="w-5 h-5" />}
        />
        <StatCard
          label="Outstanding"
          value={formatCurrency(outstandingAmount)}
          icon={<AlertCircle className="w-5 h-5" />}
          iconBg="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        />
        <StatCard
          label="Low Stock Alerts"
          value={lowStockCount.toString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          iconBg={lowStockCount > 0 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400" : "bg-gray-100 dark:bg-gray-800 text-gray-500"}
        />
        </div>
      )}

      {/* ─── PENDING COLLECTIONS ─── */}
      <Card padding={false} className="mb-8">
        <div className="px-4 sm:px-8 pt-6 sm:pt-8 pb-4 flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between border-b border-gray-100 dark:border-white/[0.04]">
          <div>
            <h2 className="text-base sm:text-lg font-semibold text-[var(--color-text-main)] tracking-tight">Pending Collections</h2>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mt-0.5">
              {pendingDate
                ? `Showing full outstanding balances with date-specific due amounts for ${format(new Date(pendingDate.length === 10 ? `${pendingDate}T12:00:00` : pendingDate), 'MMM d, yyyy')}`
                : 'All clients with outstanding balances (sorted highest to lowest)'}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text-muted)] whitespace-nowrap">Filter by date:</span>
            <input
              type="date"
              value={pendingDate}
              onChange={(e) => setPendingDate(e.target.value)}
              className="px-3 sm:px-4 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] cursor-pointer"
            />
            {pendingDate && (
              <button
                type="button"
                onClick={() => setPendingDate('')}
                className="px-2.5 py-1.5 text-xs font-bold rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                title="Clear date filter to show all dates"
              >
                All Dates
              </button>
            )}
          </div>
        </div>

        {overallPending.rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-green-50 dark:bg-green-500/10 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-bold text-[var(--color-text-main)] mb-1">All Caught Up!</h3>
            <p className="text-sm font-semibold text-[var(--color-text-muted)]">No pending or outstanding balances found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-0">
            <table className="w-full text-sm border-collapse min-w-[650px]">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/[0.04]">
                  <th className="px-5 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-left">Client Details</th>
                  <th className="px-5 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-left">Location</th>
                  <th className="px-5 py-3 text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-widest text-right">Total Outstanding</th>
                  {pendingDate && (
                    <th className="px-5 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">
                      Due on {format(new Date(pendingDate.length === 10 ? `${pendingDate}T12:00:00` : pendingDate), 'MMM d')}
                    </th>
                  )}
                  <th className="px-5 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Invoiced</th>
                  <th className="px-5 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-right">Total Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                {overallPending.rows.map((row) => (
                  <tr
                    key={row.clientId}
                    onClick={() => navigate(pendingDate ? `/billing?client=${row.clientId}&date=${pendingDate}` : `/billing?client=${row.clientId}`)}
                    className="hover:bg-gray-50/60 dark:hover:bg-gray-800/20 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-semibold text-[var(--color-text-main)] hover:text-[var(--color-primary)] transition-colors">{row.clientName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">{row.totalOrders} order{row.totalOrders !== 1 ? 's' : ''}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      <Badge variant="gray">{row.region}</Badge>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-base font-bold text-amber-600 dark:text-amber-400">{formatCurrency(row.outstanding)}</span>
                    </td>
                    {pendingDate && (
                      <td className="px-5 py-3.5 text-right">
                        {row.datePending > 0 ? (
                          <span className="text-sm font-bold text-[var(--color-primary)]">{formatCurrency(row.datePending)}</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-700">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-medium text-[var(--color-text-main)]">{formatCurrency(row.totalInvoiced)}</span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <span className="text-sm font-medium text-[var(--color-success)]">{formatCurrency(row.totalPaid)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-100 dark:border-white/[0.06]">
                <tr className="bg-gray-50/50 dark:bg-black/10">
                  <td colSpan={2} className="px-5 py-3 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">
                    Total ({overallPending.rows.length} client{overallPending.rows.length !== 1 ? 's' : ''})
                  </td>
                  <td className="px-5 py-3 text-right text-base font-bold text-amber-600 dark:text-amber-400">{formatCurrency(overallPending.totalOutstanding)}</td>
                  {pendingDate && (
                    <td className="px-5 py-3 text-right text-sm font-bold text-[var(--color-primary)]">{formatCurrency(overallPending.totalDatePending)}</td>
                  )}
                  <td className="px-5 py-3 text-right text-sm font-bold text-[var(--color-text-main)]">{formatCurrency(overallPending.totalInvoiced)}</td>
                  <td className="px-5 py-3 text-right text-sm font-bold text-[var(--color-success)]">{formatCurrency(overallPending.totalPaid)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {user?.role === 'admin' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-stretch">
        {/* Chart */}
        <Card className="col-span-1 lg:col-span-2 flex flex-col h-full" padding={false}>
          <div className="px-8 pt-8 pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-main)] tracking-tight">Revenue Overview</h2>
              <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">Last 30 days performance</p>
            </div>
            <select className="bg-gray-50 dark:bg-gray-800 border-none text-sm font-semibold text-gray-700 dark:text-gray-300 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-[var(--color-primary)] appearance-none cursor-pointer">
              <option>This Month</option>
              <option>Last Month</option>
              <option>This Year</option>
            </select>
          </div>
          <div className="flex-1 min-h-[350px] px-4 pb-6 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyRev} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" strokeOpacity={0.5} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text-muted)' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text-muted)' }} tickFormatter={v => `₹${v/1000}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={3} fill="url(#colorRevenue)" activeDot={{ r: 6, fill: 'var(--color-primary)', stroke: '#fff', strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top Clients */}
        <Card padding={false} className="flex flex-col h-full">
          <div className="px-8 pt-8 pb-4 border-b border-black/[0.04] dark:border-white/[0.05]">
            <h2 className="text-lg font-semibold text-[var(--color-text-main)] tracking-tight">Top Clients</h2>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">By revenue contribution</p>
          </div>
          <div className="flex-1 overflow-y-auto px-8 py-4 space-y-6">
            {computedTopClients.map((client, i) => (
              <div key={client.name} className="flex items-center gap-4 group">
                <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-[var(--color-text-main)] truncate group-hover:text-[var(--color-primary)] transition-colors">{client.name}</p>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] truncate">{client.orders} Orders</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(client.revenue)}</p>
                  <span className={`text-[10px] font-bold ${client.trend > 0 ? 'text-[var(--color-success)]' : 'text-red-500'}`}>
                    {client.trend > 0 ? '↗' : '↘'} {Math.abs(client.trend)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card padding={false}>
        <div className="px-8 pt-8 pb-4 border-b border-black/[0.04] dark:border-white/[0.05]">
          <h2 className="text-lg font-semibold text-[var(--color-text-main)] tracking-tight">Recent Orders</h2>
          <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">Latest transactions across all clients</p>
        </div>
        <DataTable
          columns={orderColumns}
          data={activeOrders.slice(0, 5)}
          keyExtractor={r => r.id}
        />
          </Card>
        </>
      )}
    </div>
  );
}
