import { useState, useMemo } from 'react';
import { BookOpen, TrendingUp, TrendingDown, Download, MapIcon, Users } from 'lucide-react';
import { useDataStore } from '../../stores/dataStore';
import { useDivisionStore } from '../../stores/divisionStore';
import { Button, Badge, Card, PageHeader } from '../../components/ui';
import { formatCurrency } from '../../lib/utils';
import { format } from 'date-fns';
import { type Region, type FilterDivision } from '../../types';

interface LedgerEntry {
  id: string;
  date: string;
  displayDate: string;
  type: 'invoice' | 'payment' | 'opening_balance';
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

const STORAGE_KEY_REGION = 'ledger_selected_region';
const STORAGE_KEY_CLIENT = 'ledger_selected_client';

export default function ClientLedgerPage() {
  const { clients, regions, ledger } = useDataStore();
  const { activeDivision } = useDivisionStore();

  const activeClients = useMemo(() => clients.filter(c => c.status === 'active' && !c.deletedAt), [clients]);

  // ── Region state — persisted in sessionStorage so refresh restores it ──
  const [selectedRegion, setSelectedRegion] = useState<Region | ''>(() => {
    return sessionStorage.getItem(STORAGE_KEY_REGION) || '';
  });

  // ── Clients belonging to the selected region ──
  const regionClients = useMemo(
    () => selectedRegion ? activeClients.filter(c => c.region === selectedRegion) : [],
    [selectedRegion, activeClients]
  );

  // ── Client state — persisted, but validated against current region's clients ──
  const [clientId, setClientId] = useState<string>(() => {
    const savedRegion = sessionStorage.getItem(STORAGE_KEY_REGION) || '';
    const savedClient = sessionStorage.getItem(STORAGE_KEY_CLIENT) || '';
    if (!savedRegion || !savedClient) return '';
    const clientStillInRegion = clients.find(c => c.id === savedClient && c.region === savedRegion && !c.deletedAt);
    return clientStillInRegion ? savedClient : '';
  });

  const handleRegionChange = (region: Region | '') => {
    setSelectedRegion(region);
    setClientId('');
    sessionStorage.setItem(STORAGE_KEY_REGION, region);
    sessionStorage.removeItem(STORAGE_KEY_CLIENT);
  };

  const handleClientChange = (id: string) => {
    setClientId(id);
    sessionStorage.setItem(STORAGE_KEY_CLIENT, id);
  };

  const client = useMemo(() => clients.find(c => c.id === clientId), [clientId, clients]);

  const { ledgerEntries, totalDebit, totalCredit, currentBalance } = useMemo(() => {
    if (!clientId) return { ledgerEntries: [], totalDebit: 0, totalCredit: 0, currentBalance: 0 };

    const clientLedger = ledger.filter(l => {
      if (l.clientId !== clientId) return false;
      if (activeDivision !== 'all') {
        // Legacy entries tagged 'all' or with no division are included in both views
        const d = l.division;
        if (d && d !== 'all' && d !== activeDivision) return false;
      }
      return true;
    });

    const entries: Omit<LedgerEntry, 'balance'>[] = clientLedger.map(l => {
      const rawDate = l.paymentDate || l.billDate || l.createdAt;
      const parsedDate = new Date(rawDate.length === 10 ? `${rawDate}T12:00:00` : rawDate);
      
      const isInvoice = l.type === 'invoice';
      const isOpening = l.type === 'opening_balance';
      const isPayment = l.type === 'payment';

      return {
        id: l.id,
        date: rawDate,
        displayDate: format(parsedDate, (isInvoice || isOpening) ? 'MMM d, yyyy' : 'MMM d, yyyy h:mm a'),
        type: l.type,
        description: l.description || (isOpening ? 'Opening Balance' : isPayment ? `Payment received (${l.paymentMethod?.replace('_', ' ')})` : 'Daily Bill'),
        debit: (isInvoice || isOpening) ? (l.amount || 0) : 0,
        credit: isPayment ? (l.amount || 0) : 0,
      };
    });

    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let runningBalance = 0;
    let tDebit = 0;
    let tCredit = 0;
    const finalEntries: LedgerEntry[] = entries.map(e => {
      tDebit += e.debit;
      tCredit += e.credit;
      runningBalance += (e.debit - e.credit);
      return { ...e, balance: runningBalance };
    });

    return {
      ledgerEntries: finalEntries.reverse(),
      totalDebit: tDebit,
      totalCredit: tCredit,
      currentBalance: runningBalance
    };
  }, [clientId, ledger, activeDivision]);

  const selectClass = "w-full px-4 py-3.5 text-sm rounded-2xl transition-all duration-200 outline-none font-medium appearance-none bg-no-repeat bg-[var(--color-input-bg)] text-[var(--color-text-main)] border-2 border-transparent focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const chevronBg = { backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem 1.25rem' };

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Client Ledger"
        description="View detailed account statements and outstanding balances."
        actions={
          <Button variant="outline" size="md" icon={<Download className="w-4 h-4" />}>Export PDF</Button>
        }
      />

      {/* Region + Client Selection */}
      <Card className="mb-8" padding={false}>
        <div className="p-6 md:p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="ledger-region" className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-main)] mb-2">
                <MapIcon className="w-4 h-4 text-gray-400" /> Select Region
              </label>
              <select
                id="ledger-region"
                value={selectedRegion}
                onChange={e => handleRegionChange(e.target.value as Region | '')}
                className={selectClass}
                style={chevronBg}
              >
                <option value="">Select Region</option>
                {regions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="ledger-client" className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-main)] mb-2">
                <Users className="w-4 h-4 text-gray-400" /> Select Client
              </label>
              <select
                id="ledger-client"
                value={clientId}
                onChange={e => handleClientChange(e.target.value)}
                disabled={!selectedRegion}
                className={selectClass}
                style={chevronBg}
              >
                {!selectedRegion ? (
                  <option value="">Select a region first</option>
                ) : regionClients.length === 0 ? (
                  <option value="">No clients found in this region</option>
                ) : (
                  <>
                    <option value="">Select Client</option>
                    {regionClients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>

          {client && (
            <div className="mt-5 pt-5 border-t border-gray-100 dark:border-white/[0.05] flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="w-10 h-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-black text-[var(--color-primary)]">{client.name.charAt(0)}</span>
              </div>
              <div>
                <p className="text-base font-semibold text-[var(--color-text-main)] leading-tight">{client.name}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <p className="text-sm font-medium text-[var(--color-text-muted)]">{client.city || client.region}</p>
                  {client.phone && <p className="text-sm font-medium text-[var(--color-text-muted)]">{client.phone}</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {client ? (
        <>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 items-stretch">
            <Card className="flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-[var(--color-primary)]" />
                </div>
                <p className="text-sm font-bold text-[var(--color-text-muted)]">Total Invoiced</p>
              </div>
              <p className="text-2xl font-semibold text-[var(--color-text-main)] tracking-tight">{formatCurrency(totalDebit)}</p>
            </Card>
            <Card className="flex flex-col justify-between">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-[var(--color-success-bg)] flex items-center justify-center">
                  <TrendingDown className="w-4 h-4 text-[var(--color-success)]" />
                </div>
                <p className="text-sm font-bold text-[var(--color-text-muted)]">Total Paid</p>
              </div>
              <p className="text-2xl font-semibold text-[var(--color-success)] tracking-tight">{formatCurrency(totalCredit)}</p>
            </Card>
            <Card className="flex flex-col justify-between relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[var(--color-primary)]/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/3" />
              <div className="flex items-center gap-2 mb-4 relative">
                <p className="text-sm font-bold text-[var(--color-text-muted)]">Outstanding Balance</p>
              </div>
              <div className="relative">
                <p className={`text-3xl font-semibold tracking-tight ${currentBalance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-success)]'}`}>{formatCurrency(Math.abs(currentBalance))}</p>
                <Badge variant={currentBalance > 0 ? 'warning' : 'success'} className="mt-2 relative z-10">
                  {currentBalance > 0 ? 'Receivable' : 'Settled'}
                </Badge>
              </div>
            </Card>
          </div>

          <Card padding={false} className="overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-white/[0.05] bg-gray-50/50 dark:bg-black/10">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text-main)]">Account Statement</h2>
                <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">
                  {client.name} — {activeDivision === 'all' ? 'All Divisions' : activeDivision === 'primary' ? 'Primary Foods' : 'Bakery Foods'}
                </p>
              </div>
              <BookOpen className="w-5 h-5 text-gray-400" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">Date</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">Type</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">Description</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">Debit</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-400 uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">Credit</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-[var(--color-primary)] uppercase tracking-widest border-b border-gray-100 dark:border-gray-800/60">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                  {ledgerEntries.length > 0 ? ledgerEntries.map(entry => (
                    <tr key={entry.id} className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 ${entry.type === 'invoice' ? '' : entry.type === 'opening_balance' ? 'bg-purple-50/20 dark:bg-purple-950/10' : 'bg-[var(--color-success-bg)]/[0.3] dark:bg-[var(--color-success)]/[0.05]'}`}>
                      <td className="px-6 py-4 text-xs font-medium text-gray-500 whitespace-nowrap">{entry.displayDate}</td>
                      <td className="px-6 py-4">
                        <Badge variant={entry.type === 'invoice' ? 'info' : entry.type === 'opening_balance' ? 'purple' : 'success'}>
                          {entry.type === 'invoice' ? 'Invoice' : entry.type === 'opening_balance' ? 'Opening Balance' : 'Payment'}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium text-[var(--color-text-main)] max-w-[300px] truncate">{entry.description}</p>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {entry.debit > 0 ? (
                          <span className="text-sm font-semibold text-[var(--color-text-main)]">{formatCurrency(entry.debit)}</span>
                        ) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {entry.credit > 0 ? (
                          <span className="text-sm font-semibold text-[var(--color-success)]">{formatCurrency(entry.credit)}</span>
                        ) : <span className="text-gray-300 dark:text-gray-700">—</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`text-sm font-semibold ${entry.balance > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-[var(--color-success)]'}`}>
                          {formatCurrency(entry.balance)}
                        </span>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-sm font-medium text-gray-500">No transactions recorded for this division.</td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--color-primary)]/5 dark:bg-[var(--color-primary)]/10 border-t border-gray-200 dark:border-gray-800">
                    <td colSpan={3} className="px-6 py-5 text-sm font-semibold text-[var(--color-primary)] uppercase tracking-wider">Current Balance</td>
                    <td className="px-6 py-5 text-right text-base font-semibold text-[var(--color-text-main)]">{formatCurrency(totalDebit)}</td>
                    <td className="px-6 py-5 text-right text-base font-semibold text-[var(--color-success)]">{formatCurrency(totalCredit)}</td>
                    <td className="px-6 py-5 text-right text-lg font-semibold text-amber-600">{formatCurrency(currentBalance)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card className="py-24 text-center flex flex-col items-center border-dashed">
          <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center text-gray-400 mb-4">
            <BookOpen className="w-8 h-8" />
          </div>
          <h3 className="text-base font-bold text-[var(--color-text-main)] mb-1">No client selected</h3>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            {!selectedRegion
              ? 'Select a region, then choose a client to view the account statement.'
              : 'Choose a client from the dropdown above to view their ledger.'}
          </p>
        </Card>
      )}
    </div>
  );
}
