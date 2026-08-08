import { useState, useMemo } from 'react';
import { Download, Calendar } from 'lucide-react';
import { format, eachDayOfInterval, parseISO } from 'date-fns';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { getRawMaterialBalance } from '../../services/stockDb';
import { PageHeader, Card, Badge } from '../../components/ui';

type ReportTab = 'raw-material' | 'production' | 'finished-stock' | 'daily-summary';

const TABS: { key: ReportTab; label: string }[] = [
  { key: 'raw-material', label: 'Raw Material' },
  { key: 'production', label: 'Production' },
  { key: 'finished-stock', label: 'Finished Stock' },
  { key: 'daily-summary', label: 'Daily Summary' },
];

function getDefaultDates() {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29); // last 30 days
  return {
    from: format(from, 'yyyy-MM-dd'),
    to: format(to, 'yyyy-MM-dd'),
  };
}

export default function StockReportsPage() {
  const defaults = getDefaultDates();
  const [tab, setTab] = useState<ReportTab>('raw-material');
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [productFilter, setProductFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');

  const { rawMaterials, rawMaterialTransactions, productions, finishedStockTransactions } = useStockStore();
  const { products } = useDataStore();

  const activeProducts = useMemo(() => products.filter(p => p.status === 'active' && !p.deletedAt), [products]);
  const activeMaterials = useMemo(() => rawMaterials.filter(m => m.status === 'active'), [rawMaterials]);

  // ── Raw Material Report ────────────────────────────────────────────────────
  const rawMaterialReport = useMemo(() => {
    return activeMaterials.map(m => {
      const txs = rawMaterialTransactions.filter(t => t.rawMaterialId === m.id);
      const openingBalance = txs.filter(t => t.date < dateFrom).reduce((s, t) => s + t.signedQty, 0);
      const inRange = txs.filter(t => t.date >= dateFrom && t.date <= dateTo);
      const purchases = inRange.filter(t => t.type === 'purchase').reduce((s, t) => s + t.qty, 0);
      const used = inRange.filter(t => t.type === 'production_usage').reduce((s, t) => s + t.qty, 0);
      const adjustments = inRange.filter(t => t.type === 'adjustment').reduce((s, t) => s + t.signedQty, 0);
      const closing = openingBalance + purchases - used + adjustments;
      return { id: m.id, name: m.name, unit: m.unit, openingBalance, purchases, used, adjustments, closing };
    }).filter(r => !materialFilter || r.id === materialFilter);
  }, [activeMaterials, rawMaterialTransactions, dateFrom, dateTo, materialFilter]);

  // ── Production Report ──────────────────────────────────────────────────────
  const productionReport = useMemo(() => {
    return productions
      .filter(p => p.status === 'active' && p.date >= dateFrom && p.date <= dateTo && (!productFilter || p.productId === productFilter))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [productions, dateFrom, dateTo, productFilter]);

  const productionByProduct = useMemo(() => {
    const map = new Map<string, { productName: string; qty: number; unit: string; batches: number }>();
    for (const p of productionReport) {
      const existing = map.get(p.productId);
      if (existing) { existing.qty += p.producedQty; existing.batches += 1; }
      else { map.set(p.productId, { productName: p.productName, qty: p.producedQty, unit: p.producedUnit, batches: 1 }); }
    }
    return map;
  }, [productionReport]);

  // ── Finished Stock Report ──────────────────────────────────────────────────
  const finishedStockReport = useMemo(() => {
    return activeProducts.map(p => {
      const txs = finishedStockTransactions.filter(t => t.productId === p.id);
      const opening = txs.filter(t => t.date < dateFrom).reduce((s, t) => s + t.signedQty, 0);
      const inRange = txs.filter(t => t.date >= dateFrom && t.date <= dateTo);
      const produced = inRange.filter(t => t.type === 'production').reduce((s, t) => s + t.qty, 0);
      const orders = inRange.filter(t => t.type === 'order_deduction').reduce((s, t) => s + t.qty, 0);
      const adjustments = inRange.filter(t => t.type === 'adjustment').reduce((s, t) => s + t.signedQty, 0);
      const reversals = inRange.filter(t => t.type === 'production_reversal' || t.type === 'order_reversal').reduce((s, t) => s + t.signedQty, 0);
      const closing = opening + produced - orders + adjustments + reversals;
      return { id: p.id, name: p.name, unit: (p as any).unit || 'PCS', opening, produced, orders, adjustments, closing };
    }).filter(r => !productFilter || r.id === productFilter);
  }, [activeProducts, finishedStockTransactions, dateFrom, dateTo, productFilter]);

  // ── Daily Summary ──────────────────────────────────────────────────────────
  const dailySummary = useMemo(() => {
    const map = new Map<string, { date: string; products: Map<string, { produced: number; ordered: number; unit: string }> }>();
    for (const p of productions.filter(p => p.status === 'active' && p.date >= dateFrom && p.date <= dateTo)) {
      if (!map.has(p.date)) map.set(p.date, { date: p.date, products: new Map() });
      const dayMap = map.get(p.date)!.products;
      const ex = dayMap.get(p.productId);
      if (ex) ex.produced += p.producedQty;
      else dayMap.set(p.productId, { produced: p.producedQty, ordered: 0, unit: p.producedUnit });
    }
    for (const t of finishedStockTransactions.filter(t => t.type === 'order_deduction' && t.date >= dateFrom && t.date <= dateTo)) {
      if (!map.has(t.date)) map.set(t.date, { date: t.date, products: new Map() });
      const dayMap = map.get(t.date)!.products;
      const ex = dayMap.get(t.productId);
      if (ex) ex.ordered += t.qty;
      else dayMap.set(t.productId, { produced: 0, ordered: t.qty, unit: 'PCS' });
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [productions, finishedStockTransactions, dateFrom, dateTo]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <PageHeader title="Stock Reports" description="Production, raw material, and finished stock reports with date filters." />

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === t.key ? 'bg-[var(--color-card)] text-[var(--color-text-main)] shadow-sm' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-main)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Date filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" />
          <span className="text-sm text-[var(--color-text-muted)]">to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none" />
        </div>
        {(tab === 'production' || tab === 'finished-stock') && (
          <select value={productFilter} onChange={e => setProductFilter(e.target.value)} className="h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none">
            <option value="">All Products</option>
            {activeProducts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {tab === 'raw-material' && (
          <select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)} className="h-9 px-3 rounded-xl border border-gray-200 dark:border-white/10 bg-[var(--color-card)] text-[var(--color-text-main)] text-sm focus:outline-none">
            <option value="">All Materials</option>
            {activeMaterials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
          </select>
        )}
      </div>

      {/* ── Raw Material Report ── */}
      {tab === 'raw-material' && (
        <Card>
          <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-4">Raw Material Stock Report</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/5">
                  {['Material', 'Unit', 'Opening', 'Purchases', 'Production Used', 'Adjustments', 'Closing'].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawMaterialReport.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-[var(--color-text-muted)] text-sm">No data for selected period.</td></tr>}
                {rawMaterialReport.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{r.name}</td>
                    <td className="py-3 px-4 text-[var(--color-text-muted)]">{r.unit}</td>
                    <td className="py-3 px-4 tabular-nums text-[var(--color-text-muted)]">{r.openingBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-3 px-4 tabular-nums text-green-600 dark:text-green-400">+{r.purchases.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="py-3 px-4 tabular-nums text-red-600 dark:text-red-400">-{r.used.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className={`py-3 px-4 tabular-nums ${r.adjustments >= 0 ? 'text-[var(--color-text-muted)]' : 'text-red-600 dark:text-red-400'}`}>{r.adjustments >= 0 ? '+' : ''}{r.adjustments.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className={`py-3 px-4 tabular-nums font-bold ${r.closing < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--color-text-main)]'}`}>{r.closing.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Production Report ── */}
      {tab === 'production' && (
        <div className="space-y-4">
          {/* Product totals summary */}
          {productionByProduct.size > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from(productionByProduct.entries()).map(([pid, { productName, qty, unit, batches }]) => (
                <div key={pid} className="bg-[var(--color-card)] rounded-2xl p-4 border border-gray-100 dark:border-white/[0.05]">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] truncate">{productName}</p>
                  <p className="text-2xl font-black text-[var(--color-text-main)] tabular-nums">{qty.toLocaleString()}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{unit} · {batches} batch{batches > 1 ? 'es' : ''}</p>
                </div>
              ))}
            </div>
          )}
          <Card>
            <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-4">Production Entries — {productionReport.length} records</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-white/5">
                    {['Date', 'Product', 'Division', 'Produced', 'Notes'].map(h => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {productionReport.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-[var(--color-text-muted)] text-sm">No production entries for this period.</td></tr>}
                  {productionReport.map(p => (
                    <tr key={p.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                      <td className="py-3 px-4 text-[var(--color-text-muted)]">{format(new Date(p.date), 'dd MMM yyyy')}</td>
                      <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{p.productName}</td>
                      <td className="py-3 px-4"><Badge variant={p.division === 'bakery' ? 'purple' : 'info'}>{p.division}</Badge></td>
                      <td className="py-3 px-4 font-bold text-green-600 dark:text-green-400 tabular-nums">+{p.producedQty.toLocaleString()} {p.producedUnit}</td>
                      <td className="py-3 px-4 text-[var(--color-text-muted)] text-xs">{p.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ── Finished Stock Report ── */}
      {tab === 'finished-stock' && (
        <Card>
          <h2 className="text-sm font-bold text-[var(--color-text-main)] mb-4">Finished Product Stock Report</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/5">
                  {['Product', 'Unit', 'Opening', 'Production', 'Orders', 'Adjustments', 'Closing'].map(h => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-bold text-[var(--color-text-muted)] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {finishedStockReport.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-[var(--color-text-muted)] text-sm">No data for selected period.</td></tr>}
                {finishedStockReport.map(r => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50/50 dark:hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-semibold text-[var(--color-text-main)]">{r.name}</td>
                    <td className="py-3 px-4 text-[var(--color-text-muted)]">{r.unit}</td>
                    <td className="py-3 px-4 tabular-nums text-[var(--color-text-muted)]">{r.opening.toLocaleString()}</td>
                    <td className="py-3 px-4 tabular-nums text-green-600 dark:text-green-400">+{r.produced.toLocaleString()}</td>
                    <td className="py-3 px-4 tabular-nums text-red-600 dark:text-red-400">-{r.orders.toLocaleString()}</td>
                    <td className={`py-3 px-4 tabular-nums ${r.adjustments >= 0 ? 'text-[var(--color-text-muted)]' : 'text-red-600 dark:text-red-400'}`}>{r.adjustments >= 0 ? '+' : ''}{r.adjustments.toLocaleString()}</td>
                    <td className={`py-3 px-4 tabular-nums font-bold ${r.closing < 0 ? 'text-red-600 dark:text-red-400' : 'text-[var(--color-text-main)]'}`}>{r.closing.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Daily Summary ── */}
      {tab === 'daily-summary' && (
        <div className="space-y-4">
          {dailySummary.length === 0 && (
            <Card><p className="text-center py-10 text-[var(--color-text-muted)] text-sm">No production or order data for selected period.</p></Card>
          )}
          {dailySummary.map(day => (
            <Card key={day.date}>
              <h3 className="text-sm font-bold text-[var(--color-text-main)] mb-3">{format(new Date(day.date), 'EEEE, dd MMM yyyy')}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/5">
                      <th className="text-left py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Product</th>
                      <th className="text-right py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Produced</th>
                      <th className="text-right py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Ordered</th>
                      <th className="text-right py-2 px-3 text-xs font-bold text-[var(--color-text-muted)]">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(day.products.entries()).map(([pid, { produced, ordered, unit }]) => {
                      const productName = activeProducts.find(p => p.id === pid)?.name || pid;
                      const net = produced - ordered;
                      return (
                        <tr key={pid} className="border-b border-gray-50 dark:border-white/5">
                          <td className="py-2 px-3 font-semibold text-[var(--color-text-main)]">{productName}</td>
                          <td className="py-2 px-3 text-right text-green-600 dark:text-green-400 tabular-nums font-semibold">{produced.toLocaleString()} {unit}</td>
                          <td className="py-2 px-3 text-right text-red-600 dark:text-red-400 tabular-nums font-semibold">{ordered.toLocaleString()} {unit}</td>
                          <td className={`py-2 px-3 text-right tabular-nums font-bold ${net >= 0 ? 'text-[var(--color-text-main)]' : 'text-amber-600 dark:text-amber-400'}`}>{net >= 0 ? '+' : ''}{net.toLocaleString()} {unit}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
