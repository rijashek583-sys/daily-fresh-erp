import { useState } from 'react';
import { Save, User, Bell, Moon, Sun, Shield, Building2, ChevronRight, Check, Trash2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button, Card, Input, Select, PageHeader, Avatar } from '../../components/ui';
import { useAuthStore } from '../../stores/authStore';
import { useUIStore } from '../../stores/uiStore';
import { toast } from 'sonner';
import { useDataStore } from '../../stores/dataStore';
import { getTestDataSummary, cleanupTestData, type TestDataSummary } from '../../services/db';

type SettingsTab = 'profile' | 'company' | 'notifications' | 'appearance' | 'security' | 'advanced';

export default function SettingsPage() {
  const { user } = useAuthStore();
  const { theme, setTheme } = useUIStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');
  const [loading, setLoading] = useState(false);

  const isAdmin = user?.role === 'admin';

  const tabs: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
    { id: 'profile', label: 'Profile Settings', icon: User },
    { id: 'company', label: 'Company Info', icon: Building2 },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'appearance', label: 'Appearance', icon: Moon },
    { id: 'security', label: 'Security', icon: Shield },
    ...(isAdmin ? [{ id: 'advanced' as SettingsTab, label: 'Advanced', icon: Shield }] : []),
  ];

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);
    toast.success('Settings saved', { description: 'Your preferences have been updated.' });
  };

  const [migrating, setMigrating] = useState(false);
  const handleMigrateProducts = async () => {
    if (!confirm('Are you sure you want to assign the Primary division to all products that currently lack a division?')) return;
    
    setMigrating(true);
    try {
      const { products } = useDataStore.getState();
      const productsToUpdate = products.filter(p => !p.division);
      
      const { updateProduct } = await import('../../services/db');
      for (const product of productsToUpdate) {
        await updateProduct(product.id, { division: 'primary' });
      }
      
      toast.success('Migration Complete', { description: `Updated ${productsToUpdate.length} products.` });
    } catch (error) {
      console.error(error);
      toast.error('Migration failed');
    } finally {
      setMigrating(false);
    }
  };

  // Test Data Cleanup State
  const [cleanupSummary, setCleanupSummary] = useState<TestDataSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [cleaningData, setCleaningData] = useState(false);
  const [preserveStandalone, setPreserveStandalone] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  const handleInspectTestData = async () => {
    setLoadingSummary(true);
    try {
      const summary = await getTestDataSummary();
      setCleanupSummary(summary);
      toast.success('Test data inspection completed');
    } catch (err: any) {
      console.error(err);
      toast.error('Failed to inspect test data: ' + err.message);
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleExecuteCleanup = async () => {
    if (confirmInput.trim().toUpperCase() !== 'DELETE') {
      toast.error('Please type DELETE to confirm deletion');
      return;
    }

    setCleaningData(true);
    try {
      const result = await cleanupTestData({
        preserveStandalonePayments: preserveStandalone,
        purgeTrash: true,
        purgeStockTransactions: true,
      });
      setShowConfirmModal(false);
      setConfirmInput('');
      toast.success('Cleanup complete!', {
        description: `Deleted ${result.deletedOrdersCount} orders, ${result.deletedPaymentsCount} payments, ${result.deletedLedgerEntriesCount} ledger entries. Recalculated ${result.recalculatedClientsCount} client balances.`
      });
      await handleInspectTestData();
    } catch (err: any) {
      console.error(err);
      toast.error('Cleanup failed: ' + err.message);
    } finally {
      setCleaningData(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto pb-10">
      <PageHeader
        title="Settings"
        description="Manage your account settings and preferences."
        actions={
          <Button type="submit" form="settings-form" size="md" loading={loading} icon={<Save className="w-4 h-4" />}>
            Save Changes
          </Button>
        }
      />

      <div className="flex flex-row gap-8">
        {/* Sidebar Nav */}
        <div className="w-64 shrink-0">
          <nav className="space-y-1 sticky top-28">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`w-full flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm font-medium transition-all duration-200 ${activeTab === t.id ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-[var(--shadow-soft)]' : 'text-gray-500 hover:bg-gray-200/50 dark:hover:bg-gray-800/50 hover:text-gray-900 dark:hover:text-white'}`}
              >
                <div className="flex items-center gap-3">
                  <t.icon className={`w-4 h-4 ${activeTab === t.id ? 'text-[var(--color-primary)]' : 'text-gray-400'}`} />
                  {t.label}
                </div>
                {activeTab === t.id && <ChevronRight className="w-4 h-4 opacity-50" />}
              </button>
            ))}
          </nav>
        </div>

        {/* Content area */}
        <div className="flex-1">
          <Card padding={false} className="overflow-hidden min-h-[500px]">
            <form id="settings-form" onSubmit={handleSave} className="p-10">
              
              {activeTab === 'profile' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  <div className="flex items-center gap-6 pb-8 border-b border-gray-100 dark:border-white/[0.05]">
                    <div className="relative">
                      <Avatar name={user?.displayName || 'User'} size="xl" className="shadow-lg border-2 border-white dark:border-gray-800" />
                      <button type="button" className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-white dark:bg-gray-800 shadow-md border border-gray-100 dark:border-gray-700 flex items-center justify-center text-gray-500 hover:text-[var(--color-primary)] transition-colors">
                        <User className="w-4 h-4" />
                      </button>
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold text-[var(--color-text-main)] tracking-tight">{user?.displayName}</h3>
                      <p className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wider mt-1">{user?.role?.replace('_', ' ')}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input id="fname" label="Full Name" defaultValue={user?.displayName} required />
                    <Input id="email" label="Email Address" type="email" defaultValue={user?.email} required />
                    <Input id="phone" label="Phone Number" placeholder="+91 98765 43210" />
                    <Select
                      id="timezone"
                      label="Timezone"
                      options={[
                        { value: 'IST', label: 'India Standard Time (IST)' },
                        { value: 'UTC', label: 'Coordinated Universal Time (UTC)' },
                      ]}
                    />
                  </div>
                </div>
              )}

              {activeTab === 'company' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--color-text-main)] mb-1">Company Information</h3>
                    <p className="text-sm font-medium text-[var(--color-text-muted)]">Update your business details and branding.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input id="biz-name" label="Business Name" defaultValue="Daily Fresh Bakery" required />
                    <Input id="biz-email" label="Contact Email" type="email" defaultValue="contact@dailyfresh.com" required />
                    <div className="md:col-span-2">
                      <Input id="biz-address" label="Business Address" defaultValue="45 Bakery Lane, Industrial Area" />
                    </div>
                    <Input id="biz-gst" label="GSTIN Number" defaultValue="29ABCDE1234F1Z5" />
                    <Input id="biz-fssai" label="FSSAI License" defaultValue="11223344556677" />
                  </div>
                </div>
              )}

              {activeTab === 'appearance' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--color-text-main)] mb-1">Appearance</h3>
                    <p className="text-sm font-medium text-[var(--color-text-muted)]">Customize how the application looks on your device.</p>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-medium text-[var(--color-text-main)]">Theme Preference</label>
                    <div className="grid grid-cols-3 gap-6">
                      {[
                        { id: 'light', icon: Sun, label: 'Light', desc: 'Pristine white UI' },
                        { id: 'dark', icon: Moon, label: 'Dark', desc: 'Sleek dark tones' },
                        { id: 'system', icon: Shield, label: 'System', desc: 'Follows OS' },
                      ].map(t => (
                        <div
                          key={t.id}
                          onClick={() => setTheme(t.id as any)}
                          className={`relative rounded-3xl border-2 p-5 cursor-pointer transition-all duration-300 ${theme === t.id ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 dark:bg-[var(--color-primary)]/10 shadow-md shadow-red-900/10' : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hover:border-gray-300 dark:hover:border-gray-700'}`}
                        >
                          {theme === t.id && (
                            <div className="absolute top-4 right-4 w-5 h-5 bg-[var(--color-primary)] rounded-full flex items-center justify-center text-white">
                              <Check className="w-3 h-3" />
                            </div>
                          )}
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-4 ${theme === t.id ? 'bg-[var(--color-primary)] text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500'}`}>
                            <t.icon className="w-5 h-5" />
                          </div>
                          <p className="text-sm font-semibold text-[var(--color-text-main)]">{t.label}</p>
                          <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">{t.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Other tabs omitted for brevity but they follow same styling */}
              {(activeTab === 'notifications' || activeTab === 'security') && (
                <div className="py-20 text-center animate-in fade-in duration-300">
                  <Shield className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-[var(--color-text-main)] mb-1">Coming Soon</h3>
                  <p className="text-sm font-medium text-[var(--color-text-muted)]">These settings are not yet available in the demo.</p>
                </div>
              )}

              {activeTab === 'advanced' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--color-text-main)] mb-1">Advanced Operations</h3>
                    <p className="text-sm font-medium text-[var(--color-text-muted)]">Perform administrative maintenance and cleanup tasks.</p>
                  </div>
                  
                  {/* Test Data Cleanup Card */}
                  <div className="p-6 border border-red-200 dark:border-red-900/40 rounded-2xl bg-red-50/40 dark:bg-red-950/10">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0 text-red-600 dark:text-red-400">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-semibold text-red-700 dark:text-red-400">Test Data Cleanup</h4>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 font-semibold uppercase tracking-wider">Admin Only</span>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 mb-4 leading-relaxed">
                          Permanently delete all existing client & direct orders, associated payments, and invoice ledger entries created for testing. 
                          Client balances will be recalculated. Clients, products, staff accounts, prices, and opening balances are 100% preserved.
                        </p>

                        <div className="flex flex-wrap gap-3 mb-4">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            loading={loadingSummary}
                            onClick={handleInspectTestData}
                            icon={<RefreshCw className="w-4 h-4" />}
                          >
                            Inspect Database
                          </Button>

                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setConfirmInput('');
                              setShowConfirmModal(true);
                            }}
                            icon={<Trash2 className="w-4 h-4" />}
                          >
                            Purge Test Data
                          </Button>
                        </div>

                        {cleanupSummary && (
                          <div className="mt-4 p-4 rounded-xl border border-red-200 dark:border-red-900/30 bg-white dark:bg-gray-900 space-y-3">
                            <h5 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Scope of Affected Records</h5>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                              <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                                <p className="text-xs text-gray-500">Orders to Delete</p>
                                <p className="text-base font-bold text-red-600">{cleanupSummary.ordersCount} <span className="text-xs font-normal text-gray-500">({cleanupSummary.clientOrdersCount} client, {cleanupSummary.directOrdersCount} direct)</span></p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                                <p className="text-xs text-gray-500">Order Payments</p>
                                <p className="text-base font-bold text-red-600">{cleanupSummary.paymentsLinkedToOrdersCount}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                                <p className="text-xs text-gray-500">Ledger Debits/Credits</p>
                                <p className="text-base font-bold text-red-600">{cleanupSummary.ledgerInvoicesCount + cleanupSummary.ledgerPaymentsCount}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-gray-50 dark:bg-gray-800">
                                <p className="text-xs text-gray-500">Clients to Recalculate</p>
                                <p className="text-base font-bold text-blue-600">{cleanupSummary.affectedClientsCount}</p>
                              </div>
                            </div>

                            <div className="pt-2 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 dark:border-gray-800">
                              <span>Standalone Payments: <strong className="text-emerald-600 font-semibold">{cleanupSummary.standalonePaymentsCount} (Preserved)</strong></span>
                              <span>Opening Balances: <strong className="text-emerald-600 font-semibold">{cleanupSummary.ledgerOpeningBalancesCount} (Preserved)</strong></span>
                              <span>Stock Deductions: <strong>{cleanupSummary.orderStockTransactionsCount} to clear</strong></span>
                              <span>Trash Records: <strong>{cleanupSummary.trashCount} to purge</strong></span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Confirmation Modal */}
                  {showConfirmModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
                      <div className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-900/50 rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
                        <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
                          <AlertTriangle className="w-6 h-6" />
                          <h4 className="text-lg font-bold">Confirm Test Data Cleanup</h4>
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          This action is <strong>irreversible</strong>. All existing orders and their linked payments will be permanently deleted from Firestore.
                        </p>
                        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-xl space-y-2 text-xs text-gray-600 dark:text-gray-300">
                          <label className="flex items-center gap-2 cursor-pointer font-medium">
                            <input
                              type="checkbox"
                              checked={preserveStandalone}
                              onChange={(e) => setPreserveStandalone(e.target.checked)}
                              className="rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                            />
                            Preserve Standalone Payments (e.g. unlinked on-account cash receipts)
                          </label>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold uppercase text-gray-500 mb-1">
                            Type <span className="text-red-600">DELETE</span> to confirm:
                          </label>
                          <Input
                            id="confirm-delete-input"
                            value={confirmInput}
                            onChange={(e) => setConfirmInput(e.target.value)}
                            placeholder="Type DELETE"
                            autoFocus
                          />
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => setShowConfirmModal(false)}
                            disabled={cleaningData}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            disabled={confirmInput.trim().toUpperCase() !== 'DELETE'}
                            loading={cleaningData}
                            onClick={handleExecuteCleanup}
                            icon={<Trash2 className="w-4 h-4" />}
                          >
                            Permanently Delete
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="p-6 border border-gray-200 dark:border-gray-800 rounded-2xl bg-gray-50 dark:bg-gray-800/20">
                    <h4 className="text-base font-semibold text-[var(--color-text-main)] mb-2">Data Migration: Products Division</h4>
                    <p className="text-sm text-[var(--color-text-muted)] mb-4">
                      This one-time action assigns the "Primary" division to all existing products that currently do not have a division set. Use this to migrate old data to the new multi-division structure.
                    </p>
                    <Button type="button" onClick={handleMigrateProducts} loading={migrating} variant="primary">
                      Run Migration
                    </Button>
                  </div>
                </div>
              )}

            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
