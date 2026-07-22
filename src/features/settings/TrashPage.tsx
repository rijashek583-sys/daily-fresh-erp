import { useState, useMemo } from 'react';
import { useDataStore } from '../../stores/dataStore';
import { PageHeader, Card, DataTable, type Column, SearchInput } from '../../components/ui';
import { Trash2, RotateCcw, AlertCircle, FileText, Search, Calendar, User, Package, MapIcon, Receipt, Users } from 'lucide-react';
import { format } from 'date-fns';
import { restoreFromTrash, permanentlyDeleteFromTrash } from '../../services/db';

type TrashModule = 'all' | 'orders' | 'clients' | 'regions' | 'products' | 'payments';

interface TrashRecord {
  id: string; // The ID of the actual record in the trash collection
  module: string; // the original collection
  name: string;
  deletedAt: string;
  deletedBy: string;
  originalRecord: any;
}

export default function TrashPage() {
  const { trash } = useDataStore();
  const [activeTab, setActiveTab] = useState<TrashModule>('all');
  
  // Filters
  const [search, setSearch] = useState('');
  const [filterDate, setFilterDate] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');

  const trashRecords = useMemo(() => {
    if (!trash) return [];
    return trash.map((t: any) => {
      // Determine a good display name based on the collection
      let displayName = t.originalData?.name || 'Unknown Record';
      if (t.originalCollection === 'orders') displayName = `Order ${t.id} - ${t.originalData?.clientName || ''}`;
      if (t.originalCollection === 'payments') displayName = `Payment ${t.id} - ${t.originalData?.clientName || ''}`;

      return {
        id: t.id,
        module: t.originalCollection,
        name: displayName,
        deletedAt: t.deletedAt,
        deletedBy: t.deletedBy || 'System',
        originalRecord: t.originalData
      } as TrashRecord;
    }).sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
  }, [trash]);

  const displayRecords = useMemo(() => {
    return trashRecords.filter(r => {
      let matches = true;
      if (activeTab !== 'all') {
        matches = matches && r.module.toLowerCase() === activeTab;
      }
      if (search) {
        matches = matches && r.name.toLowerCase().includes(search.toLowerCase());
      }
      if (filterDate) {
        matches = matches && r.deletedAt.startsWith(filterDate);
      }
      if (filterUser) {
        matches = matches && r.deletedBy.toLowerCase().includes(filterUser.toLowerCase());
      }
      return matches;
    });
  }, [trashRecords, activeTab, search, filterDate, filterUser]);

  const handleRestore = async (record: TrashRecord) => {
    await restoreFromTrash(record.id, { originalCollection: record.module, originalData: record.originalRecord });
  };

  const handlePermanentDelete = async (record: TrashRecord) => {
    if (window.confirm(`Are you absolutely sure? This action cannot be undone and will permanently delete "${record.name}" from the database.`)) {
      await permanentlyDeleteFromTrash(record.id);
    }
  };

  const getModuleIcon = (module: string) => {
    switch (module) {
      case 'orders': return <FileText className="w-4 h-4 text-blue-500" />;
      case 'clients': return <Users className="w-4 h-4 text-purple-500" />;
      case 'regions': return <MapIcon className="w-4 h-4 text-emerald-500" />;
      case 'products': return <Package className="w-4 h-4 text-amber-500" />;
      case 'payments': return <Receipt className="w-4 h-4 text-rose-500" />;
      default: return <FileText className="w-4 h-4" />;
    }
  };

  const columns: Column<TrashRecord>[] = [
    {
      key: 'module', label: 'Module',
      render: r => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center">
            {getModuleIcon(r.module)}
          </div>
          <span className="text-sm font-bold text-[var(--color-text-main)] uppercase tracking-wider">{r.module}</span>
        </div>
      )
    },
    {
      key: 'name', label: 'Record Name',
      render: r => <span className="text-sm font-bold text-[var(--color-text-main)]">{r.name}</span>
    },
    {
      key: 'deletedBy', label: 'Deleted By',
      render: r => (
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <User className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">{r.deletedBy}</span>
        </div>
      )
    },
    {
      key: 'deletedAt', label: 'Deleted Date & Time',
      render: r => (
        <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
          <Calendar className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">{format(new Date(r.deletedAt), 'MMM d, yyyy h:mm a')}</span>
        </div>
      )
    },
    {
      key: 'actions', label: '', align: 'right',
      render: r => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => handleRestore(r)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restore
          </button>
          <button
            onClick={() => handlePermanentDelete(r)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Permanently
          </button>
        </div>
      )
    }
  ];

  const uniqueDeleters = Array.from(new Set(trashRecords.map(r => r.deletedBy)));

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Global Trash"
        description="Manage softly deleted records. Restore them or permanently delete them from the database."
      />

      <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/20 rounded-2xl p-4 flex gap-3 mb-8">
        <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <h3 className="text-sm font-bold text-red-800 dark:text-red-400">Important</h3>
          <p className="text-sm font-medium text-red-700/80 dark:text-red-400/80 mt-1">
            Restoring a record automatically restores all associated workflows (Dashboard, Ledger, Billing). 
            Permanent deletion cannot be undone and will permanently erase the data.
          </p>
        </div>
      </div>

      <Card className="mb-6">
        {/* Top Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Search className="w-3.5 h-3.5" /> Search
            </label>
            <SearchInput
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder="Search deleted records..."
              className="w-full"
            />
          </div>
          
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5" /> Deleted Date
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
              <User className="w-3.5 h-3.5" /> Deleted By
            </label>
            <select
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="">Anyone</option>
              {uniqueDeleters.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      <Card padding={false} className="overflow-hidden">
        {/* Module Tabs */}
        <div className="flex overflow-x-auto border-b border-gray-100 dark:border-white/[0.05] p-2">
          {(['all', 'orders', 'clients', 'regions', 'products', 'payments'] as TrashModule[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 text-sm font-bold capitalize rounded-xl transition-all whitespace-nowrap ${
                activeTab === tab 
                  ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400' 
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <DataTable
          columns={columns}
          data={displayRecords}
          keyExtractor={r => `${r.module}-${r.id}`}
          emptyState={
            <div className="py-24 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-4">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-base font-bold text-[var(--color-text-main)] mb-1">Trash is empty</h3>
              <p className="text-sm font-medium text-[var(--color-text-muted)]">No deleted records found matching your filters.</p>
            </div>
          }
        />
      </Card>
    </div>
  );
}
