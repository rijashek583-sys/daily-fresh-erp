import React, { useState, useEffect, useMemo } from 'react';
import {
  UserCheck, Plus, Search, ShieldAlert,
  Edit2, CheckCircle2, XCircle, ArrowLeft,
  X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuthStore } from '../../stores/authStore';
import {
  subscribeToAdminNames,
  createAdminName,
  toggleAdminNameStatus,
  updateAdminName,
  validateAdminName,
} from '../../services/adminNameService';
import { type AdminNameDocument } from '../../types/expense.types';
import { Button, Card, Badge, PageHeader, SearchInput } from '../../components/ui';

export default function AdminNamesManagerPage() {
  const { user } = useAuthStore();
  const [adminNames, setAdminNames] = useState<AdminNameDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal states
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingTarget, setEditingTarget] = useState<AdminNameDocument | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Subscribe to /adminNames in real time
  useEffect(() => {
    const unsubscribe = subscribeToAdminNames(
      (names) => {
        setAdminNames(names);
        setLoading(false);
      },
      (error) => {
        console.error('Failed to subscribe to admin names:', error);
        toast.error('Unable to load Admin names: ' + error.message);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Filtered names
  const filteredNames = useMemo(() => {
    return adminNames.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (search.trim()) {
        const query = search.toLowerCase().trim();
        return item.name.toLowerCase().includes(query);
      }
      return true;
    });
  }, [adminNames, search, statusFilter]);

  const activeCount = useMemo(() => adminNames.filter((n) => n.status === 'active').length, [adminNames]);
  const inactiveCount = useMemo(() => adminNames.filter((n) => n.status === 'inactive').length, [adminNames]);

  // Handle Create Admin Name
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const val = validateAdminName(newName);
    if (!val.valid) {
      setCreateError(val.error || 'Invalid name');
      return;
    }

    if (!user || user.role !== 'admin') {
      setCreateError('Only Admins can register operator names.');
      return;
    }

    try {
      setCreateSubmitting(true);
      await createAdminName(val.normalized, user.uid);
      toast.success(`Admin name "${val.normalized}" registered successfully.`);
      setNewName('');
      setIsCreateModalOpen(false);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to register admin name.');
    } finally {
      setCreateSubmitting(false);
    }
  };

  // Handle Edit Admin Name
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTarget) return;
    setEditError(null);

    const val = validateAdminName(editNameValue);
    if (!val.valid) {
      setEditError(val.error || 'Invalid name');
      return;
    }

    try {
      setEditSubmitting(true);
      await updateAdminName(editingTarget.id, val.normalized);
      toast.success(`Admin name updated to "${val.normalized}".`);
      setEditingTarget(null);
      setEditNameValue('');
    } catch (err: any) {
      setEditError(err.message || 'Failed to update admin name.');
    } finally {
      setEditSubmitting(false);
    }
  };

  // Handle Toggle Status (Soft Deactivation / Reactivation)
  const handleToggleStatus = async (item: AdminNameDocument) => {
    const nextStatus = item.status === 'active' ? 'inactive' : 'active';
    const actionLabel = nextStatus === 'active' ? 'reactivated' : 'deactivated';

    try {
      await toggleAdminNameStatus(item.id, nextStatus);
      toast.success(`"${item.name}" has been ${actionLabel}.`);
    } catch (err: any) {
      toast.error(`Failed to update status: ${err.message || 'Unknown error'}`);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Top Breadcrumb / Return */}
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-400">
        <Link to="/settings" className="hover:text-[var(--color-primary)] flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" />
          Settings
        </Link>
        <span>/</span>
        <span className="text-[var(--color-text-main)]">Admin Names Registry</span>
      </div>

      {/* Header */}
      <PageHeader
        title="Admin Name Registry"
        description="Operational attribution names for expenses recorded under the shared Admin account."
        actions={
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => {
              setNewName('');
              setCreateError(null);
              setIsCreateModalOpen(true);
            }}
          >
            Register Admin Name
          </Button>
        }
      />

      {/* Attribution Semantics Warning Banner */}
      <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3.5">
        <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-xs sm:text-sm text-amber-900 dark:text-amber-200 leading-relaxed">
          <p className="font-semibold mb-1">Operational Attribution Notice</p>
          <p className="text-amber-800/90 dark:text-amber-300/80">
            Admin display names provide operational attribution for shared-login expenses. They are not cryptographic authentication credentials.
            Names can be deactivated to hide them from future expense entry, but are <strong>never deleted</strong> to preserve historical reporting.
          </p>
        </div>
      </div>

      {/* Controls & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Search */}
        <div className="w-full sm:w-80">
          <SearchInput
            placeholder="Search registered names..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
          />
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800/60 p-1 rounded-2xl self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              statusFilter === 'all'
                ? 'bg-white dark:bg-gray-900 text-[var(--color-primary)] shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            All ({adminNames.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              statusFilter === 'active'
                ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('inactive')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
              statusFilter === 'inactive'
                ? 'bg-white dark:bg-gray-900 text-amber-600 dark:text-amber-400 shadow-sm'
                : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
            }`}
          >
            Inactive ({inactiveCount})
          </button>
        </div>
      </div>

      {/* Table / List */}
      <Card className="overflow-hidden p-0 sm:p-0">
        {loading ? (
          <div className="py-16 text-center text-sm text-gray-400 animate-pulse">
            Loading Admin names...
          </div>
        ) : filteredNames.length === 0 ? (
          <div className="py-16 px-6 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto text-gray-400">
              <UserCheck className="w-6 h-6" />
            </div>
            <p className="text-base font-semibold text-[var(--color-text-main)]">No Admin names found</p>
            <p className="text-xs text-gray-400 max-w-sm mx-auto">
              {search
                ? `No registered Admin names match "${search}".`
                : 'No Admin names have been registered yet. Add operator names so expenses recorded by Admin accounts can be attributed.'}
            </p>
            {!search && (
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Plus className="w-3.5 h-3.5" />}
                  onClick={() => setIsCreateModalOpen(true)}
                >
                  Register First Name
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-black/[0.04] dark:border-white/[0.04] bg-gray-50/50 dark:bg-gray-900/30">
                  <th className="px-6 py-4 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-left">
                    Operator Display Name
                  </th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-left">
                    Status
                  </th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-left">
                    Registered On
                  </th>
                  <th className="px-6 py-4 text-[11px] font-semibold text-gray-400 uppercase tracking-widest text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.02] dark:divide-white/[0.02]">
                {filteredNames.map((item) => {
                  const isActive = item.status === 'active';
                  const formattedDate = item.createdAt
                    ? new Date(item.createdAt).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })
                    : '-';

                  return (
                    <tr key={item.id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-950/40 text-[var(--color-primary)] font-bold text-xs flex items-center justify-center shrink-0">
                            {item.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-[var(--color-text-main)]">{item.name}</p>
                            <p className="text-[11px] text-gray-400 font-mono">ID: {item.id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {isActive ? (
                          <Badge variant="success" dot>
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="warning" dot>
                            Inactive
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 font-medium">
                        {formattedDate}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 px-2.5 text-xs text-gray-600 dark:text-gray-300 hover:text-[var(--color-text-main)]"
                            onClick={() => {
                              setEditingTarget(item);
                              setEditNameValue(item.name);
                              setEditError(null);
                            }}
                          >
                            <Edit2 className="w-3.5 h-3.5 mr-1" />
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant={isActive ? 'outline' : 'secondary'}
                            className={`h-8 px-3 text-xs ${
                              isActive
                                ? 'text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800/60 hover:bg-amber-50 dark:hover:bg-amber-950/30'
                                : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30'
                            }`}
                            onClick={() => handleToggleStatus(item)}
                          >
                            {isActive ? (
                              <>
                                <XCircle className="w-3.5 h-3.5 mr-1" />
                                Deactivate
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                                Reactivate
                              </>
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Register Admin Name Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-[var(--color-card)] rounded-3xl p-6 sm:p-8 shadow-2xl border border-black/[0.04] dark:border-white/[0.04] space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-[var(--color-text-main)]">Register Admin Name</h3>
                <p className="text-xs text-gray-400 mt-0.5">Add an operator display name for shared login attribution.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Operator Display Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. Rijash, Farooq, Accounts"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    setCreateError(null);
                  }}
                  autoFocus
                  className="w-full px-4 h-11 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-200 dark:border-gray-700 outline-none focus:border-2 focus:border-[var(--color-primary)] transition-all"
                />
                <p className="text-[11px] text-gray-400">Between 2 and 50 characters. Case-insensitive uniqueness enforced.</p>
              </div>

              {createError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400 font-medium">
                  {createError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={createSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={createSubmitting}
                >
                  Register Name
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Admin Name Modal */}
      {editingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-md bg-[var(--color-card)] rounded-3xl p-6 sm:p-8 shadow-2xl border border-black/[0.04] dark:border-white/[0.04] space-y-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-[var(--color-text-main)]">Rename Admin Name</h3>
                <p className="text-xs text-gray-400 mt-0.5">Correct the display spelling for &quot;{editingTarget.name}&quot;.</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTarget(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Display Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editNameValue}
                  onChange={(e) => {
                    setEditNameValue(e.target.value);
                    setEditError(null);
                  }}
                  autoFocus
                  className="w-full px-4 h-11 text-sm rounded-xl font-medium bg-[var(--color-input-bg)] text-[var(--color-text-main)] border border-gray-200 dark:border-gray-700 outline-none focus:border-2 focus:border-[var(--color-primary)] transition-all"
                />
              </div>

              {editError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400 font-medium">
                  {editError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingTarget(null)}
                  disabled={editSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={editSubmitting}
                >
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
