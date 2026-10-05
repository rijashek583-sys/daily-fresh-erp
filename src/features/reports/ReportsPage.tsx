import React, { useState } from 'react';
import { Download, Calendar } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { monthlyRevenueData } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { isToday, isThisMonth } from 'date-fns';
import { useDivisionStore } from '../../stores/divisionStore';
import { PageHeader, Card, StatCard, Badge, Button } from '../../components/ui';
import { formatCurrency } from '../../lib/utils';
import { toast } from 'sonner';


const CHART_COLORS = ['#B91C1C', '#DC2626', '#EF4444', '#F87171', '#FCA5A5'];
const PIE_COLORS = ['#B91C1C', '#8B5CF6', '#10B981', '#F59E0B'];

const productSales = [
  { name: 'Whole Wheat', value: 45000 },
  { name: 'Burger Buns', value: 30000 },
  { name: 'Milk Bread', value: 25000 },
  { name: 'Pizza Base', value: 15000 },
];

export default function ReportsPage() {
  const { orders, clients, payments } = useDataStore();
  const { activeDivision } = useDivisionStore();
  const [dateRange, setDateRange] = useState('This Month');


  const { totalRevenue, computedTopClients, outstandingPayments, dailyCollection, monthlyCollection, monthlyRev, productSalesData, totalProductSales } = React.useMemo(() => {
    const { ledger } = useDataStore.getState();
    const validPayments = payments.filter(p => {
      if (activeDivision === 'all') return true;
      return p.division === activeDivision;
    });

    let rev = 0;
    let totalCollected = 0;
    let totalOpeningBalance = 0;
    const map = new Map<string, { name: string, orders: number, revenue: number, thisMonthRev: number, lastMonthRev: number, trend: number }>();

    const thisMonth = new Date().getMonth();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthlyRev = Array.from({length: 12}, (_, i) => {
      const m = (thisMonth - 11 + i + 12) % 12;
      return { month: monthNames[m], revenue: 0, monthIndex: m };
    });

    const prodSalesMap = new Map<string, number>();

    ledger.forEach(l => {
      if (activeDivision !== 'all') {
        const d = l.division;
        if (d && d !== 'all' && d !== activeDivision) return;
      }
      
      if (l.type === 'invoice') {
        const amt = l.amount || 0;
        rev += amt;
        
        const lDate = new Date(l.billDate || l.createdAt);
        const lMonth = lDate.getMonth();
        
        // Add to monthly chart if in last 12 months
        const targetMonth = monthlyRev.find(m => m.monthIndex === lMonth);
        if (targetMonth && lDate.getFullYear() >= new Date().getFullYear() - 1) {
          targetMonth.revenue += amt;
        }

        // Product sales aggregation
        if (l.invoiceId) {
          const order = orders.find(o => o.id === l.invoiceId);
          if (order) {
            order.items.forEach(item => {
              const p = prodSalesMap.get(item.productName) || 0;
              prodSalesMap.set(item.productName, p + item.total);
            });
          }
        }
        
        const client = clients.find(c => c.id === l.clientId);
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
      } else if (l.type === 'payment') {
        totalCollected += (l.amount || 0);
      } else if (l.type === 'opening_balance') {
        totalOpeningBalance += (l.amount || 0);
      }
    });

    const outstanding = totalOpeningBalance + rev - totalCollected;
    
    const dailyColl = validPayments
      .filter(p => isToday(new Date(p.billDate || p.createdAt)))
      .reduce((s, p) => s + p.amount, 0);
      
    const monthlyColl = validPayments
      .filter(p => isThisMonth(new Date(p.billDate || p.createdAt)))
      .reduce((s, p) => s + p.amount, 0);

    const top = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    
    const productSalesData = Array.from(prodSalesMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, value]) => ({ name, value }));
    const totalProductSales = productSalesData.reduce((s, p) => s + p.value, 0);

    return { 
      totalRevenue: rev, computedTopClients: top,
      outstandingPayments: outstanding, dailyCollection: dailyColl, monthlyCollection: monthlyColl,
      monthlyRev, productSalesData, totalProductSales
    };
  }, [orders, clients, payments, activeDivision]);

  const CustomTooltip = ({ active, payload, label, prefix = '₹' }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-[var(--color-card)] border border-gray-100 dark:border-white/[0.05] rounded-2xl shadow-[var(--shadow-hover)] p-4">
        <p className="text-gray-500 font-medium text-xs mb-3 uppercase tracking-wider">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center justify-between gap-6 mb-1 last:mb-0">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{entry.name}:</span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-text-main)]">
              {prefix === '₹' ? formatCurrency(entry.value) : `${entry.value}`}
            </span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <PageHeader
          title="Business Reports"
          description="Comprehensive insights into revenue, clients, and product performance."
          actions={
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-full pl-4 pr-2 py-1 shadow-sm">
                <Calendar className="w-4 h-4 text-gray-400" />
                <select
                  value={dateRange}
                  onChange={e => setDateRange(e.target.value)}
                  className="bg-transparent text-sm font-semibold text-[var(--color-text-main)] outline-none cursor-pointer appearance-none pr-6"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right center', backgroundSize: '1rem' }}
                >
                  <option>This Month</option>
                  <option>Last Month</option>
                  <option>Last 3 Months</option>
                  <option>This Year</option>
                </select>
              </div>
              <Button size="md" icon={<Download className="w-4 h-4" />} onClick={() => toast.success('Report downloaded')}>Export PDF</Button>
            </div>
          }
        />
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-4 gap-6 mb-8">
        <StatCard label="Total Revenue" value={formatCurrency(totalRevenue)} icon={<span className="font-serif italic text-xl">₹</span>} />
        <StatCard label="Outstanding Payments" value={formatCurrency(outstandingPayments)} icon={<span className="font-semibold text-xl">Out</span>} iconBg="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" />
        <StatCard label="Daily Collection" value={formatCurrency(dailyCollection)} icon={<span className="font-semibold text-xl">Day</span>} iconBg="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400" />
        <StatCard label="Monthly Collection" value={formatCurrency(monthlyCollection)} icon={<span className="font-semibold text-xl">Mon</span>} iconBg="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
      </div>

      <div className="grid grid-cols-2 gap-8 mb-8 items-stretch">
        {/* Revenue Trend */}
        <Card padding={false} className="flex flex-col h-full">
          <div className="px-8 py-6 border-b border-gray-100 dark:border-white/[0.05]">
            <h3 className="text-base font-semibold text-[var(--color-text-main)]">Revenue Trend</h3>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Monthly gross revenue over the year.</p>
          </div>
          <div className="p-6 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyRev} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-primary)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--color-primary)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text-muted)' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text-muted)' }} tickFormatter={v => `₹${v/1000}k`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--color-primary)" strokeWidth={3} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Client Performance */}
        <Card padding={false} className="flex flex-col h-full">
          <div className="px-8 py-6 border-b border-gray-100 dark:border-white/[0.05]">
            <h3 className="text-base font-semibold text-[var(--color-text-main)]">Top Client Revenue</h3>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Highest contributing clients.</p>
          </div>
          <div className="p-6 h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={computedTopClients} layout="vertical" margin={{ top: 10, right: 30, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="4 4" horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--color-text-muted)' }} tickFormatter={v => `₹${v/1000}k`} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 11, fontWeight: 700, fill: 'var(--color-text-main)' }} dx={-10} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-primary)', opacity: 0.05 }} />
                <Bar dataKey="revenue" name="Revenue" radius={[0, 4, 4, 0]} maxBarSize={32}>
                  {computedTopClients.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Product Sales Breakdown */}
        <Card padding={false} className="flex flex-col h-full">
          <div className="px-8 py-6 border-b border-gray-100 dark:border-white/[0.05]">
            <h3 className="text-base font-semibold text-[var(--color-text-main)]">Sales by Product Category</h3>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Revenue distribution.</p>
          </div>
          <div className="p-6 h-[300px] flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={productSalesData}
                  cx="50%"
                  cy="50%"
                  innerRadius={80}
                  outerRadius={110}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {productSalesData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px', fontWeight: 600, paddingTop: '20px' }} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center Text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-6">
              <span className="text-[10px] font-medium text-gray-400 uppercase tracking-widest mb-1">Total</span>
              <span className="text-xl font-semibold text-[var(--color-text-main)]">{formatCurrency(totalProductSales)}</span>
            </div>
          </div>
        </Card>

        {/* Recent Client Trends */}
        <Card padding={false} className="flex flex-col h-full">
          <div className="px-8 py-6 border-b border-gray-100 dark:border-white/[0.05]">
            <h3 className="text-base font-semibold text-[var(--color-text-main)]">Client Growth Momentum</h3>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">MoM growth percentage per client.</p>
          </div>
          <div className="flex-1 overflow-y-auto p-8 space-y-6">
            {computedTopClients.map((client) => (
              <div key={client.name} className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-medium ${client.trend > 0 ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]' : 'bg-red-100 dark:bg-red-900/30 text-red-600'}`}>
                  {client.trend > 0 ? '↑' : '↓'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text-main)] truncate">{client.name}</p>
                  <div className="w-full bg-gray-100 dark:bg-gray-800 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${client.trend > 0 ? 'bg-[var(--color-success)]' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(Math.abs(client.trend) * 2, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <Badge variant={client.trend > 0 ? 'success' : 'danger'}>
                    {client.trend > 0 ? '+' : ''}{client.trend}%
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
