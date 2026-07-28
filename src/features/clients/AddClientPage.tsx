import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, ArrowLeft, Plus, Search, X, MapPin } from 'lucide-react';
import { Button, Card, Input, Select, PageHeader } from '../../components/ui';
import { useDataStore } from '../../stores/dataStore';
import { toast } from 'sonner';
import { addClient, saveClientPricing, saveRegions } from '../../services/db';
import { getProductDivision } from '../../lib/utils';

// ─── Add Region Modal ──────────────────────────────────────────────────────────
function AddRegionModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (region: string) => void;
}) {
  const { regions } = useDataStore();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = async () => {
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) { setError('Region name is required.'); return; }
    if (regions.includes(trimmed)) { setError('This region already exists.'); return; }
    try {
      await saveRegions([...regions, trimmed]);
      toast.success('Region created', { description: `"${trimmed}" is now available everywhere.` });
      onCreated(trimmed);
      onClose();
    } catch {
      setError('Failed to create region. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[var(--color-card)] rounded-3xl shadow-2xl border border-gray-100 dark:border-white/[0.06] w-full max-w-sm p-6 animate-in zoom-in-95 slide-in-from-bottom-4 duration-200">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text-main)]">New Region</h2>
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-0.5">Will be available across the entire app instantly.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">Region Name *</label>
            <input
              ref={inputRef}
              type="text"
              placeholder="e.g. Kanhangad"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              className={`w-full px-4 py-3 text-sm rounded-2xl border-2 bg-[var(--color-input-bg)] text-[var(--color-text-main)] placeholder-gray-400 outline-none transition-all duration-200 ${error ? 'border-red-400' : 'border-transparent focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]'}`}
            />
            {error && <p className="text-xs font-medium text-red-500 mt-1.5">{error}</p>}
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" size="md" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button size="md" className="flex-1" onClick={handleCreate}>Create Region</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Searchable Region Selector ───────────────────────────────────────────────
function RegionSelector({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const { regions } = useDataStore();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (open) { setSearch(''); setTimeout(() => searchRef.current?.focus(), 50); }
  }, [open]);

  const filtered = useMemo(
    () => regions.filter(r => r.toLowerCase().includes(search.toLowerCase())),
    [search]
  );

  return (
    <div ref={ref} className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium border-2 transition-all duration-200 bg-[var(--color-input-bg)] outline-none ${error ? 'border-red-400' : open ? 'border-[var(--color-primary)] bg-[var(--color-card)]' : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700'}`}
      >
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
          <span className={value ? 'text-[var(--color-text-main)]' : 'text-gray-400'}>{value || 'Choose a region…'}</span>
        </div>
        <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[var(--color-card)] rounded-2xl shadow-xl border border-gray-100 dark:border-white/[0.06] overflow-hidden z-20 animate-in slide-in-from-top-2 fade-in duration-150">
          <div className="p-2 border-b border-gray-100 dark:border-white/[0.05]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Search regions…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-gray-50 dark:bg-gray-800/60 border border-transparent focus:border-[var(--color-primary)] text-[var(--color-text-main)] placeholder-gray-400 outline-none transition-all"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.length > 0 ? filtered.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => { onChange(r); setOpen(false); }}
                className={`w-full text-left px-4 py-2.5 text-sm font-medium transition-colors ${r === value ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'text-[var(--color-text-main)] hover:bg-gray-50 dark:hover:bg-gray-800/50'}`}
              >
                {r}
              </button>
            )) : (
              <p className="px-4 py-3 text-xs text-gray-400 text-center">No regions match "{search}"</p>
            )}
          </div>
        </div>
      )}
      {error && <p className="text-xs font-medium text-red-500 mt-1.5">{error}</p>}
    </div>
  );
}

// ─── Main AddClientPage ────────────────────────────────────────────────────────
export default function AddClientPage() {
  const { clients, products, clientPricing, regions } = useDataStore();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [region, setRegion] = useState('');
  const [pricing, setPricing] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showAddRegion, setShowAddRegion] = useState(false);

  const activeProducts = products.filter(p => p.status === 'active');

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    const trimmedName = name.trim().toUpperCase();

    if (!trimmedName) newErrors.name = 'Client name is required.';
    if (!region) newErrors.region = 'Please select a region.';

    // Duplicate check: same name in the same region (ignore soft-deleted)
    if (trimmedName && region) {
      const duplicate = clients.find(
        c => c.name.toUpperCase() === trimmedName && c.region === region && !c.deletedAt
      );
      if (duplicate) newErrors.name = `"${name.trim()}" already exists in ${region}.`;
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));

    try {
      const newClient: Record<string, any> = {
        name: name.trim().toUpperCase(),
        region,
        regionName: region,
        status: 'active' as const,
        totalOrders: 0,
        totalRevenue: 0,
        outstanding: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Only include phone if provided
      if (phone.trim()) newClient.phone = phone.trim();

      const newId = await addClient(newClient);

      // Save custom pricing
      const primaryPricing: Record<string, number> = {};
      const bakeryPricing: Record<string, number> = {};
      
      Object.entries(pricing).forEach(([pid, val]) => {
        const num = Number(val);
        if (!isNaN(num) && num > 0) {
          const product = products.find(p => p.id === pid);
          if (product) {
            if (getProductDivision(product) === 'bakery') bakeryPricing[pid] = num;
            else primaryPricing[pid] = num;
          }
        }
      });
      
      if (Object.keys(primaryPricing).length > 0) {
        await saveClientPricing(newId, 'primary', primaryPricing);
      }
      if (Object.keys(bakeryPricing).length > 0) {
        await saveClientPricing(newId, 'bakery', bakeryPricing);
      }

      toast.success('Client added!', { description: `${newClient.name} has been saved under ${region}.` });
      navigate('/clients');
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="max-w-2xl mx-auto pb-12">
        {/* Back */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/clients')}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[var(--color-primary)] transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" />
            Back to Clients
          </button>
        </div>

        <PageHeader
          title="Add Client"
          description="Create a new client with optional custom product pricing."
          actions={
            <Button
              size="md"
              icon={<Save className="w-4 h-4" />}
              loading={loading}
              onClick={handleSave}
            >
              Save Client
            </Button>
          }
        />

        <div className="space-y-6">
          {/* ── Basic Info ── */}
          <Card>
            <h2 className="text-sm font-bold text-[var(--color-text-muted)] uppercase tracking-widest mb-5">Client Information</h2>
            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">
                  Client Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. SMOKEY PARK"
                  value={name}
                  onChange={e => { setName(e.target.value); setErrors(p => ({ ...p, name: '' })); }}
                  className={`w-full px-4 py-3 text-sm rounded-2xl border-2 bg-[var(--color-input-bg)] text-[var(--color-text-main)] placeholder-gray-400 outline-none transition-all duration-200 font-medium ${errors.name ? 'border-red-400' : 'border-transparent focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]'}`}
                />
                {errors.name && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.name}</p>}
              </div>

              {/* Phone – Optional */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">
                  Contact Number <span className="text-xs font-normal text-[var(--color-text-muted)]">(optional)</span>
                </label>
                <input
                  type="tel"
                  placeholder="e.g. +91 98765 43210"
                  value={phone}
                  onChange={e => { setPhone(e.target.value); setErrors(p => ({ ...p, phone: '' })); }}
                  className="w-full px-4 py-3 text-sm rounded-2xl border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] placeholder-gray-400 outline-none transition-all duration-200 font-medium focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]"
                />
              </div>

              {/* Region */}
              <div>
                <label className="block text-sm font-semibold text-[var(--color-text-main)] mb-2">
                  Region <span className="text-red-500">*</span>
                </label>
                <div className="flex items-start gap-2">
                  <RegionSelector
                    value={region}
                    onChange={v => { setRegion(v); setErrors(p => ({ ...p, region: '' })); }}
                    error={errors.region}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddRegion(true)}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-3 rounded-2xl text-xs font-semibold text-[var(--color-primary)] bg-[var(--color-primary)]/10 hover:bg-[var(--color-primary)]/20 transition-colors whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Region
                  </button>
                </div>
              </div>
            </div>
          </Card>

          {/* ── Product Pricing ── */}
          <Card padding={false} className="overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10">
              <h2 className="text-sm font-bold text-[var(--color-text-main)] uppercase tracking-widest">Product Pricing</h2>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Optional — leave blank to use default prices.</p>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  <th className="text-left px-6 py-4 text-xs font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60 w-1/2">Product</th>
                  <th className="text-right px-6 py-4 text-xs font-semibold text-[var(--color-primary)] uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60 w-1/2">Custom Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                {activeProducts.map(p => {
                  const hasCustom = pricing[p.id] !== undefined && pricing[p.id] !== '';
                  return (
                    <tr
                      key={p.id}
                      className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 ${hasCustom ? 'bg-[var(--color-primary)]/[0.02] dark:bg-[var(--color-primary)]/[0.05]' : ''}`}
                    >
                      <td className="px-6 py-4">
                        <p className="font-semibold text-[var(--color-text-main)]">{p.name}</p>
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Custom Price / {p.unit}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-sm font-medium text-gray-400">₹</span>
                          <input
                            type="number"
                            placeholder="0.00"
                            value={pricing[p.id] ?? ''}
                            onChange={e => setPricing(prev => ({ ...prev, [p.id]: e.target.value }))}
                            min={0}
                            className="w-32 px-4 py-2.5 text-sm font-semibold text-right rounded-full border-2 border-transparent bg-[var(--color-input-bg)] text-[var(--color-text-main)] placeholder-gray-300 focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] shadow-sm outline-none transition-all duration-200"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          {/* Save */}
          <div className="flex justify-end">
            <Button
              size="lg"
              icon={<Save className="w-4 h-4" />}
              loading={loading}
              onClick={handleSave}
              className="px-10 shadow-lg shadow-red-500/20"
            >
              Save Client
            </Button>
          </div>
        </div>
      </div>

      {showAddRegion && (
        <AddRegionModal
          onClose={() => setShowAddRegion(false)}
          onCreated={newRegion => setRegion(newRegion)}
        />
      )}
    </>
  );
}
