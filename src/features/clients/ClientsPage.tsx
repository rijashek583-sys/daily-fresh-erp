import { useState, useMemo, useEffect, useRef } from 'react';
import { Plus, Map as MapIcon, ArrowLeft, Users, ChevronRight, Package, Trash2, Edit2, MoreVertical, Eye } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { type Region, type Client } from '../../types';
import { useDataStore } from '../../stores/dataStore';
import { Button, Badge, Card, DataTable, SearchInput, PageHeader, StatusSelect, type Column } from '../../components/ui';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore';
import { updateClient, moveToTrash, saveRegions } from '../../services/db';
import { useDivisionStore } from '../../stores/divisionStore';
import { getClientMetrics } from '../../lib/billing';
import { formatCurrency } from '../../lib/utils';

function RowActions({ client, onEdit, onDelete, onView }: { client: Client, onEdit: () => void, onDelete: () => void, onView: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative flex justify-end" ref={ref}>
      <button 
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <MoreVertical className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-100 dark:border-gray-800 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <button onClick={(e) => { e.stopPropagation(); setOpen(false); onView(); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-[var(--color-text-main)] hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
            <Eye className="w-4 h-4 text-gray-400" /> View Client
          </button>
          <button onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-[var(--color-text-main)] hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-gray-400" /> Edit Client
          </button>
          <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
          <button onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }} className="w-full text-left px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2">
            <Trash2 className="w-4 h-4" /> Delete Client
          </button>
        </div>
      )}
    </div>
  );
}

export default function ClientsPage() {
  const { clients, orders, regions } = useDataStore();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const { activeDivision } = useDivisionStore();
  
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [updateTrigger, setUpdateTrigger] = useState(0);

  const handleStatusChange = async (clientId: string, newStatus: 'active' | 'inactive') => {
    if (!isAdmin) return;
    try {
      await updateClient(clientId, { status: newStatus });
      toast.success(`Client marked as ${newStatus}`);
    } catch (e) {
      // error handled in db.ts
    }
  };

  const [confirmDeleteClient, setConfirmDeleteClient] = useState<string | null>(null);

  // Build region stats from live data
  const regionStats = useMemo(() => {
    return regions.map(name => {
      const regionClients = clients.filter(c => c.region === name && !c.deletedAt);
      const ordersCount = regionClients.reduce((sum, c) => sum + orders.filter(o => o.clientId === c.id).length, 0);
      return { name, clientsCount: regionClients.length, ordersCount };
    });
  }, [regions, clients, orders]);

  const filtered = useMemo(() => {
    if (!selectedRegion) return [];
    return clients.filter(c => {
      if (c.deletedAt) return false;
      if (c.region !== selectedRegion) return false;
      const clientName = c.name || '';
      const clientEmail = c.email || '';
      const matchesSearch = clientName.toLowerCase().includes(search.toLowerCase()) || clientEmail.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [selectedRegion, search, statusFilter, clients]);

  const columns: Column<Client>[] = [
    {
      key: 'name', label: 'Client Details',
      render: r => (
        <div className="flex items-center gap-4 py-1">
          <div>
            <p className="text-sm font-semibold text-[var(--color-text-main)] mb-0.5">{r.name}</p>
          </div>
        </div>
      ),
    },
    { key: 'totalOrders', label: 'Total Orders', render: r => <Badge variant="gray">{orders.filter(o => o.clientId === r.id).length} Orders</Badge> },
    { 
      key: 'outstanding', label: 'Outstanding', 
      render: r => {
        const metrics = getClientMetrics(r.id, activeDivision);
        return <span className={`text-sm font-bold ${metrics.outstanding > 0 ? 'text-amber-600' : 'text-green-600'}`}>{formatCurrency(Math.abs(metrics.outstanding))}</span>;
      }
    },
    { key: 'city', label: 'Location', render: r => <span className="text-sm font-medium text-[var(--color-text-muted)]">{r.city || r.region || '—'}</span> },
    {
      key: 'status', label: 'Status', align: 'center',
      render: r => (
        <StatusSelect
          value={r.status}
          onChange={(val) => handleStatusChange(r.id, val as 'active' | 'inactive')}
          readonly={!isAdmin}
          options={[
            {
              value: 'active',
              label: 'Active',
              dotClass: 'bg-green-500 dark:bg-green-400',
              bgClass: 'bg-green-100 dark:bg-green-950/40 border border-transparent',
              textClass: 'text-green-700 dark:text-green-400'
            },
            {
              value: 'inactive',
              label: 'Inactive',
              dotClass: 'bg-red-500 dark:bg-red-400',
              bgClass: 'bg-red-100 dark:bg-red-950/40 border border-transparent',
              textClass: 'text-red-700 dark:text-red-400'
            }
          ]}
        />
      ),
    },
  ];

  if (isAdmin) {
    columns.push({
      key: 'actions', label: 'Actions', align: 'right',
      render: (r) => (
        <RowActions
          client={r}
          onView={() => navigate(`/clients/${r.id}`)}
          onEdit={() => navigate(`/clients/${r.id}/edit`)}
          onDelete={() => setConfirmDeleteClient(r.id)}
        />
      ),
    });
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title={selectedRegion ? `Clients: ${selectedRegion}` : "Regions"}
        description={selectedRegion ? `Manage ${filtered.length} clients in ${selectedRegion}.` : `Select a region to view clients.`}
        actions={
          <>
            {selectedRegion && (
              <Button variant="outline" size="md" onClick={() => { setSelectedRegion(null); setSearch(''); }} icon={<ArrowLeft className="w-4 h-4" />}>
                Back to Regions
              </Button>
            )}
            {isAdmin && (
              <Link to="/clients/new">
                <Button size="md" icon={<Plus className="w-4 h-4" />}>Add Client</Button>
              </Link>
            )}
          </>
        }
      />

      {!selectedRegion ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {regionStats.map((region) => (
            <Card key={region.name} className="group hover:border-[var(--color-primary)] transition-all duration-300 hover:shadow-lg hover:-translate-y-1 h-full w-full relative">
              <div 
                className="flex items-start justify-between cursor-pointer"
                onClick={() => setSelectedRegion(region.name)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-red-50 dark:bg-red-500/10 text-[var(--color-primary)] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <MapIcon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-text-main)] group-hover:text-[var(--color-primary)] transition-colors">{region.name}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <p className="text-sm font-medium text-[var(--color-text-muted)] flex items-center gap-1">
                        <Users className="w-3 h-3" /> {region.clientsCount} Clients
                      </p>
                      <p className="text-sm font-medium text-[var(--color-text-muted)] flex items-center gap-1 border-l border-gray-200 dark:border-gray-700 pl-3">
                        <Package className="w-3 h-3" /> {region.ordersCount} Orders
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400">
                    <ChevronRight className="w-4 h-4" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card padding={false} className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex flex-col sm:flex-row gap-4 px-8 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 items-center justify-between">
            <SearchInput
              className="w-full sm:max-w-md"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClear={() => setSearch('')}
              placeholder={`Search in ${selectedRegion}…`}
            />
            <div className="flex gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0 hide-scrollbar">
              {(['all', 'active', 'inactive'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all duration-200 capitalize ${statusFilter === s ? 'bg-[var(--color-primary)] text-white shadow-md shadow-red-500/20' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <DataTable columns={columns} data={filtered} keyExtractor={r => r.id} onRowClick={r => navigate(`/clients/${r.id}`)} />
        </Card>
      )}



      {/* Confirm Delete Client Modal */}
      {confirmDeleteClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/[0.06] w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-[var(--color-text-main)] mb-1">Move Client to Trash?</h2>
            <p className="text-sm font-medium text-[var(--color-text-muted)] mb-6">
              This client will be moved to the Trash and removed from active workflows. Historical orders and bills will remain intact.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setConfirmDeleteClient(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1" onClick={async () => {
                if (confirmDeleteClient) {
                  const client = clients.find(c => c.id === confirmDeleteClient);
                  if (client) {
                    await moveToTrash('clients', confirmDeleteClient, client, user?.displayName || 'Admin');
                  }
                }
                setConfirmDeleteClient(null);
              }}>Move to Trash</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
