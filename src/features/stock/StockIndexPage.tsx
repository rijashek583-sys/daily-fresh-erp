import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Factory, Package, Link2, BarChart3, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { getRawMaterialBalance, getFinishedStockBalance } from '../../services/stockDb';
import { PageHeader, Card, StatCard } from '../../components/ui';
import { format } from 'date-fns';

const navCards = [
  { label: 'Raw Material Stock', desc: 'Manage materials, add stock, view history', href: '/stock/raw-materials', icon: Layers, color: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' },
  { label: 'Production', desc: 'Record daily production batches', href: '/stock/production', icon: Factory, color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' },
  { label: 'Finished Product Stock', desc: 'View finished stock balances and history', href: '/stock/finished', icon: Package, color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' },
  { label: 'Product Materials', desc: 'Map raw materials to finished products', href: '/stock/product-materials', icon: Link2, color: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' },
  { label: 'Stock Reports', desc: 'Raw material, production & finished stock reports', href: '/stock/reports', icon: BarChart3, color: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400' },
];

export default function StockIndexPage() {
  const navigate = useNavigate();
  const { initialize, isInitialized, rawMaterials, rawMaterialTransactions, productions, finishedStockTransactions, stockSyncStatus } = useStockStore();
  const { products } = useDataStore();

  useEffect(() => {
    const unsub = initialize();
    return () => { if (!isInitialized) unsub(); };
  }, []);

  const today = format(new Date(), 'yyyy-MM-dd');
  const activeProducts = products.filter(p => p.status === 'active' && !p.deletedAt);
  const activeMaterials = rawMaterials.filter(m => m.status === 'active');

  const lowStockMaterials = activeMaterials.filter(m => {
    const bal = getRawMaterialBalance(m.id, rawMaterialTransactions);
    return bal <= 0;
  });

  const todayProductions = productions.filter(p => p.date === today && p.status === 'active');
  const todayProducedTotal = todayProductions.reduce((sum, p) => sum + p.producedQty, 0);

  const unsyncedOrders = stockSyncStatus.filter(s => !s.synced);

  const negativeFinishedStock = activeProducts.filter(p => {
    const bal = getFinishedStockBalance(p.id, finishedStockTransactions);
    return bal < 0;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <PageHeader
        title="Stock & Production"
        description="Manage raw materials, production entries and finished product inventory."
      />

      {/* Alerts */}
      {unsyncedOrders.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800 dark:text-amber-300">{unsyncedOrders.length} order{unsyncedOrders.length > 1 ? 's' : ''} with incomplete stock sync</p>
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mt-0.5">These orders exist but their finished stock deductions may be missing. Use the sync tool in Finished Stock.</p>
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Raw Materials" value={activeMaterials.length.toString()} icon={<Layers className="w-5 h-5" />} iconBg="bg-green-100 dark:bg-green-900/30 text-green-600" />
        <StatCard label="Today's Production" value={todayProducedTotal.toLocaleString()} icon={<Factory className="w-5 h-5" />} iconBg="bg-blue-100 dark:bg-blue-900/30 text-blue-600" />
        <StatCard
          label="Low / Zero Stock"
          value={lowStockMaterials.length.toString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          iconBg={lowStockMaterials.length > 0 ? "bg-red-100 dark:bg-red-900/30 text-red-600" : "bg-green-100 dark:bg-green-900/30 text-green-600"}
        />
        <StatCard
          label="Products Tracked"
          value={activeProducts.length.toString()}
          icon={<Package className="w-5 h-5" />}
          iconBg="bg-purple-100 dark:bg-purple-900/30 text-purple-600"
        />
      </div>

      {/* Low stock alert */}
      {lowStockMaterials.length > 0 && (
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="text-base font-bold text-[var(--color-text-main)]">Raw Material Alerts</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStockMaterials.map(m => {
              const bal = getRawMaterialBalance(m.id, rawMaterialTransactions);
              return (
                <div key={m.id} onClick={() => navigate(`/stock/raw-materials/${m.id}/history`)}
                  className="flex items-center justify-between p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors">
                  <span className="text-sm font-semibold text-red-700 dark:text-red-400">{m.name}</span>
                  <span className="text-sm font-bold text-red-600 dark:text-red-300">{bal.toLocaleString()} {m.unit}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Navigation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {navCards.map(card => {
          const Icon = card.icon;
          return (
            <div key={card.href} onClick={() => navigate(card.href)}
              className="group bg-[var(--color-card)] rounded-2xl border border-gray-100 dark:border-white/[0.05] p-6 cursor-pointer hover:border-[var(--color-primary)]/40 hover:shadow-lg transition-all duration-200 flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${card.color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors">{card.label}</h3>
                <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">{card.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Negative finished stock warning */}
      {negativeFinishedStock.length > 0 && (
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <h2 className="text-base font-bold text-[var(--color-text-main)]">Negative Finished Stock</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {negativeFinishedStock.map(p => {
              const bal = getFinishedStockBalance(p.id, finishedStockTransactions);
              return (
                <div key={p.id} onClick={() => navigate('/stock/finished')}
                  className="flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 cursor-pointer hover:bg-amber-100 transition-colors">
                  <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">{p.name}</span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-300">{bal.toLocaleString()} {p.unit || 'PCS'}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
