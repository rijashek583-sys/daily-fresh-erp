import { useNavigate } from 'react-router-dom';
import { Layers, Factory, Package, AlertTriangle } from 'lucide-react';
import { useStockStore } from '../../stores/stockStore';
import { useDataStore } from '../../stores/dataStore';
import { getRawMaterialBalance, getFinishedStockBalance } from '../../services/stockDb';
import { PageHeader, Card, StatCard } from '../../components/ui';

const navCards = [
  {
    label: 'Raw Material Stock',
    desc: 'Add materials, update usage, view balance',
    href: '/stock/raw-materials',
    icon: Layers,
    color: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  },
  {
    label: 'Daily Production',
    desc: 'Enter how many units were produced today',
    href: '/stock/production',
    icon: Factory,
    color: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  },
  {
    label: 'Finished Product Stock',
    desc: 'Current stock balance for all finished products',
    href: '/stock/finished',
    icon: Package,
    color: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  },
];

export default function StockIndexPage() {
  const navigate = useNavigate();
  const { rawMaterials, rawMaterialTransactions, finishedStockTransactions } = useStockStore();
  const { products } = useDataStore();

  const activeProducts = products.filter(p => p.status === 'active' && !p.deletedAt);
  const activeMaterials = rawMaterials.filter(m => m.status === 'active');

  const lowStockMaterials = activeMaterials.filter(m => {
    const bal = getRawMaterialBalance(m.id, rawMaterialTransactions);
    return bal <= 0;
  });

  const negativeFinishedStock = activeProducts.filter(p => {
    const bal = getFinishedStockBalance(p.id, finishedStockTransactions);
    return bal < 0;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <PageHeader
        title="Stock"
        description="Track raw material inventory and finished product stock."
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard
          label="Raw Materials"
          value={activeMaterials.length.toString()}
          icon={<Layers className="w-5 h-5" />}
          iconBg="bg-green-100 dark:bg-green-900/30 text-green-600"
        />
        <StatCard
          label="Products Tracked"
          value={activeProducts.length.toString()}
          icon={<Package className="w-5 h-5" />}
          iconBg="bg-purple-100 dark:bg-purple-900/30 text-purple-600"
        />
        <StatCard
          label="Low / Zero Stock"
          value={lowStockMaterials.length.toString()}
          icon={<AlertTriangle className="w-5 h-5" />}
          iconBg={lowStockMaterials.length > 0
            ? 'bg-red-100 dark:bg-red-900/30 text-red-600'
            : 'bg-green-100 dark:bg-green-900/30 text-green-600'}
        />
      </div>

      {/* Navigation cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {navCards.map(card => {
          const Icon = card.icon;
          return (
            <div
              key={card.href}
              onClick={() => navigate(card.href)}
              className="group bg-[var(--color-card)] rounded-2xl border border-gray-100 dark:border-white/[0.05] p-6 cursor-pointer hover:border-[var(--color-primary)]/40 hover:shadow-lg transition-all duration-200 flex items-start gap-4"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${card.color}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors">
                  {card.label}
                </h3>
                <p className="text-sm font-medium text-[var(--color-text-muted)] mt-1">{card.desc}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Low raw material stock alert */}
      {lowStockMaterials.length > 0 && (
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h2 className="text-base font-bold text-[var(--color-text-main)]">Low / Zero Raw Material Stock</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {lowStockMaterials.map(m => {
              const bal = getRawMaterialBalance(m.id, rawMaterialTransactions);
              return (
                <div
                  key={m.id}
                  onClick={() => navigate(`/stock/raw-materials/${m.id}/history`)}
                  className="flex items-center justify-between p-3 rounded-xl bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/20 transition-colors"
                >
                  <span className="text-sm font-semibold text-red-700 dark:text-red-400">{m.name}</span>
                  <span className="text-sm font-bold text-red-600 dark:text-red-300">
                    {bal.toLocaleString()} {m.unit}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

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
                <div
                  key={p.id}
                  onClick={() => navigate('/stock/finished')}
                  className="flex items-center justify-between p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/30 cursor-pointer hover:bg-amber-100 transition-colors"
                >
                  <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">{p.name}</span>
                  <span className="text-sm font-bold text-amber-600 dark:text-amber-300">
                    {bal.toLocaleString()} {(p as any).unit || 'PCS'}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
