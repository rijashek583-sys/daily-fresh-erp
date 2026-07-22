import React from 'react';
import { IndianRupee, AlertCircle, Package, FileText } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { monthlyRevenueData } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { format } from 'date-fns';
import { PageHeader, StatCard, Card, DataTable, type Column } from '../../components/ui';
import { formatCurrency, cn } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';


export default function DashboardPage() {
  const { orders, clients, payments } = useDataStore();
  const { user } = useAuthStore();

  const { 
    computedTopClients, activeOrders,
    todaysRevenue, todaysOrders, totalClients, outstandingAmount
  } = React.useMemo(() => {
    const validOrders = orders;
    const activeClientsList = clients.filter(c => !c.deletedAt && c.status === 'active');
    
    // Today's stats
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todaysValidOrders = validOrders.filter(o => o.deliveryDate === todayStr);
    
    const todaysRevenue = todaysValidOrders.reduce((sum, o) => sum + o.total, 0);
    const todaysOrders = todaysValidOrders.length;
    const totalClients = activeClientsList.length;
    
    // Outstanding amount across all clients
    const outstandingAmount = activeClientsList.reduce((sum, c) => sum + (c.outstanding || 0), 0);


    const map = new Map<string, { name: string, orders: number, revenue: number, trend: number }>();
    validOrders.forEach(o => {
      const current = map.get(o.clientId) || { name: o.clientName, orders: 0, revenue: 0, trend: Math.floor(Math.random() * 20) - 5 };
      current.orders += 1;
      current.revenue += o.total;
      map.set(o.clientId, current);
    });
    const top = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    
    return { 
      computedTopClients: top, activeOrders: validOrders,
      todaysRevenue, todaysOrders, totalClients, outstandingAmount
    };
  }, [orders, clients, payments]);

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
      key: 'status', label: 'Payment Status', align: 'center',
      render: r => {
        const paymentStatus = r.paymentStatus || 'unpaid';
        return (
          <span className={cn(
            "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest",
            paymentStatus === 'paid' ? "bg-[var(--color-success-bg)] text-[var(--color-success)]" :
            paymentStatus === 'partial' ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400" :
            "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
          )}>
            {paymentStatus === 'paid' ? 'Paid' : paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
          </span>
        );
      },
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
          title={`Welcome back, ${user?.displayName} 👋`}
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
      <PageHeader
        title={`Welcome back, ${user?.displayName} 👋`}
        description="Here's what's happening with your business today."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          label="Outstanding Amount"
          value={formatCurrency(outstandingAmount)}
          icon={<AlertCircle className="w-5 h-5" />}
          iconBg="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
        />
      </div>

      <div className="grid grid-cols-3 gap-8 items-stretch">
        {/* Chart */}
        <Card className="col-span-2 flex flex-col h-full" padding={false}>
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
              <AreaChart data={monthlyRevenueData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
    </div>
  );
}
