import { useState, useMemo, useEffect } from 'react';
import { Save, Search, MapPin } from 'lucide-react';
import { useDataStore } from '../../stores/dataStore';
import { Button, Card, PageHeader, StatusSelect, Badge } from '../../components/ui';
import { toast } from 'sonner';
import { saveClientPricing } from '../../services/db';
import { DIVISION_LABELS } from '../../types';
import { useDivisionStore } from '../../stores/divisionStore';
import { getProductDivision } from '../../lib/utils';
import { resolveProductPrice } from '../../lib/pricing';

const REGIONS = [
  'Commission',
  'Mangaluru',
  'Hosangadi - Thalapady',
  'Uppala',
  'Kasaragod'
];

export default function ClientPricingPage() {
  const { clients, products, clientPricing } = useDataStore();
  const { activeDivision: activeTab } = useDivisionStore();
  const activeClients = clients.filter(c => c.status === 'active');
  
  const [selectedRegion, setSelectedRegion] = useState(() => localStorage.getItem('pricing_selectedRegion') || '');
  const [selectedClient, setSelectedClient] = useState(() => localStorage.getItem('pricing_selectedClient') || '');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [pricing, setPricing] = useState<Record<string, string>>({});

  const regionClients = useMemo(() => {
    return selectedRegion ? activeClients.filter(c => c.region === selectedRegion) : [];
  }, [activeClients, selectedRegion]);

  const client = useMemo(() => {
    return regionClients.find(c => c.id === selectedClient) || null;
  }, [regionClients, selectedClient]);

  // Load initial values from global store
  useEffect(() => {
    if (client) {
      const allPrices = clientPricing[client.id] || {};
      setPricing(Object.fromEntries(Object.entries(allPrices).map(([k, v]) => [k, String(v)])));
    } else {
      setPricing({});
    }
  }, [client, clientPricing]);

  const handleRegionChange = (region: string) => {
    setSelectedRegion(region);
    localStorage.setItem('pricing_selectedRegion', region);
    
    // Automatically select the first client in the new region, or clear if none
    const clientsInRegion = activeClients.filter(c => c.region === region);
    if (clientsInRegion.length > 0) {
      const firstClientId = clientsInRegion[0].id;
      setSelectedClient(firstClientId);
      localStorage.setItem('pricing_selectedClient', firstClientId);
    } else {
      setSelectedClient('');
      localStorage.removeItem('pricing_selectedClient');
    }
    setSearchTerm('');
  };

  const handleClientChange = (cid: string) => {
    setSelectedClient(cid);
    if (cid) {
      localStorage.setItem('pricing_selectedClient', cid);
    } else {
      localStorage.removeItem('pricing_selectedClient');
    }
    setSearchTerm('');
  };

  const handleSave = async () => {
    if (!client) return;
    
    if (activeTab === 'all') {
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
      
      try {
        await saveClientPricing(client.id, 'primary', primaryPricing);
        await saveClientPricing(client.id, 'bakery', bakeryPricing);
        toast.success('Pricing saved!', { description: `Custom prices updated for ${client.name} (All Divisions)` });
      } catch (error) {
        // Error handled in db.ts
      }
    } else {
      const newPricing: Record<string, number> = {};
      Object.entries(pricing).forEach(([pid, val]) => {
        const num = Number(val);
        if (!isNaN(num) && num > 0) {
          const product = products.find(p => p.id === pid);
          if (product && getProductDivision(product) === activeTab) {
            newPricing[pid] = num;
          }
        }
      });
      
      try {
        await saveClientPricing(client.id, activeTab, newPricing);
        toast.success('Pricing saved!', { description: `Custom prices updated for ${client.name} (${DIVISION_LABELS[activeTab]})` });
      } catch (error) {
        // Error handled in db.ts
      }
    }
  };

  const filteredProducts = useMemo(() => {
    if (!client) return [];
    let result = products.filter(p => p.status === 'active' && !p.deletedAt);
    if (activeTab !== 'all') {
      result = result.filter(p => getProductDivision(p) === activeTab);
    }
    if (searchTerm) {
      result = result.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    return result.sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99));
  }, [client, searchTerm, activeTab, products]);

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <PageHeader
        title="Client Pricing"
        description="Set custom independent product prices per client."
        actions={
          <Button size="md" icon={<Save className="w-4 h-4" />} onClick={handleSave} disabled={!client}>
            Save Changes
          </Button>
        }
      />

      {/* Selectors */}
      <Card className="mb-6" padding={false}>
        <div className="p-6 flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
          <div className="flex-1 flex flex-col sm:flex-row gap-4 w-full">
            {/* Region Selector */}
            <div className="w-full sm:max-w-[200px]">
              <label htmlFor="region-select" className="block text-sm font-semibold text-[var(--color-text-main)] ml-1 mb-2">Select Region</label>
              <div className="relative">
                <select
                  id="region-select"
                  value={selectedRegion}
                  onChange={e => handleRegionChange(e.target.value)}
                  className="w-full pl-10 pr-8 py-3 text-sm rounded-2xl transition-all duration-200 outline-none font-medium appearance-none bg-no-repeat bg-[var(--color-input-bg)] text-[var(--color-text-main)] border-2 border-transparent focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] shadow-sm"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem 1.25rem' }}
                >
                  <option value="" disabled>Choose Region</option>
                  {REGIONS.map(r => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <MapPin className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Client Selector */}
            <div className="w-full sm:max-w-sm">
              <label htmlFor="client-select" className="block text-sm font-semibold text-[var(--color-text-main)] ml-1 mb-2">Select Client</label>
              <select
                id="client-select"
                value={selectedClient}
                onChange={e => handleClientChange(e.target.value)}
                disabled={!selectedRegion}
                className={`w-full px-4 py-3 text-sm rounded-2xl transition-all duration-200 outline-none font-medium appearance-none bg-no-repeat border-2 border-transparent shadow-sm ${!selectedRegion ? 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed' : 'bg-[var(--color-input-bg)] text-[var(--color-text-main)] focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]'}`}
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem 1.25rem' }}
              >
                {!selectedRegion ? (
                  <option value="">Please select a region first</option>
                ) : (
                  <>
                    <option value="" disabled>Choose Client</option>
                    {regionClients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>

          {client && (
            <div className="flex items-center gap-4 shrink-0">
              <div className="text-right">
                <p className="text-lg font-semibold text-[var(--color-text-main)]">{client.name}</p>
                <div className="flex items-center justify-end gap-2 mt-0.5">
                  <p className="text-sm font-medium text-[var(--color-text-muted)]">{client.email}</p>
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
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Pricing Table */}
      {client ? (
        <Card padding={false} className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div>
              <div className="flex items-center gap-4">
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">Product Pricing</h2>
              </div>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">Set the specific price for this client.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm rounded-full bg-[var(--color-input-bg)] border border-transparent focus:border-[var(--color-primary)] text-[var(--color-text-main)] outline-none transition-all placeholder-gray-400 focus:bg-white dark:focus:bg-gray-900 shadow-sm"
              />
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
                  const hasCustom = pricing[p.id] !== undefined && pricing[p.id] !== '';

                  return (
                    <tr key={p.id} className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 ${hasCustom ? 'bg-[var(--color-primary)]/[0.02] dark:bg-[var(--color-primary)]/[0.05]' : ''}`}>
                      <td className="px-6 py-4">
                        <div>
                          <p className="font-semibold text-[var(--color-text-main)]">{p.name}</p>
                          <p className="text-xs font-medium text-[var(--color-text-muted)] line-clamp-1 mt-0.5">{p.description}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-sm font-medium text-gray-400">₹</span>
                          <input
                            type="number"
                            placeholder={client ? String(resolveProductPrice(client.id, p.id)) : "0"}
                            value={pricing[p.id] ?? ''}
                            onChange={e => setPricing(prev => ({ ...prev, [p.id]: e.target.value }))}
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
                    <td colSpan={2} className="px-6 py-12 text-center text-gray-500">
                      No products found matching "{searchTerm}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col items-center justify-center min-h-[300px] bg-[var(--color-card)] rounded-3xl border border-gray-100 dark:border-white/[0.05] p-8 text-center animate-in fade-in zoom-in-95 duration-300">
          <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800/50 flex items-center justify-center text-gray-400 mb-4">
            <MapPin className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-[var(--color-text-main)]">Select a Client</h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-1 max-w-sm">
            Please choose a region and select a client above to view and edit their custom product pricing.
          </p>
        </div>
      )}
    </div>
  );
}
