import { useState, useMemo } from 'react';
import { BookOpen, TrendingUp, TrendingDown, Download } from 'lucide-react';
import { useDataStore } from '../../stores/dataStore';
import { Button, Badge, Card, PageHeader } from '../../components/ui';
import { formatCurrency } from '../../lib/utils';

import { format } from 'date-fns';

interface LedgerEntry {
  id: string;
  date: string; // The relevant date for sorting (deliveryDate or billDate)
  displayDate: string; // Formatting
  type: 'invoice' | 'payment';
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

export default function ClientLedgerPage() {
  const { clients, ledger } = useDataStore();
  const activeClients = useMemo(() => clients.filter(c => c.status === 'active' && !c.deletedAt), [clients]);
  const [clientId, setClientId] = useState(activeClients[0]?.id || clients[0]?.id || '');
  
  const client = useMemo(() => clients.find(c => c.id === clientId), [clientId, clients]);

  const { ledgerEntries, totalDebit, totalCredit, currentBalance } = useMemo(() => {
    if (!clientId) return { ledgerEntries: [], totalDebit: 0, totalCredit: 0, currentBalance: 0 };

    const clientLedger = ledger.filter(l => l.clientId === clientId);
    
    const entries: Omit<LedgerEntry, 'balance'>[] = clientLedger.map(l => ({
      id: l.id,
      date: l.paymentDate || l.createdAt,
      displayDate: format(new Date(l.paymentDate || l.createdAt), 'MMM d, yyyy h:mm a'),
      type: l.type,
      description: l.description || (l.type === 'payment' ? `Payment received (${l.paymentMethod?.replace('_', ' ')})` : 'Daily Bill'),
      debit: l.type === 'invoice' ? l.amount : 0,
      credit: l.type === 'payment' ? l.amount : 0,
    }));

    // 3. Sort chronologically by date
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // 4. Calculate running balance
    let runningBalance = 0;
    let tDebit = 0;
    let tCredit = 0;
    const finalEntries: LedgerEntry[] = entries.map(e => {
      tDebit += e.debit;
      tCredit += e.credit;
      runningBalance += (e.debit - e.credit);
      return { ...e, balance: runningBalance };
    });

    // In reverse chronological order for display
    return {
      ledgerEntries: finalEntries.reverse(),
      totalDebit: tDebit,
      totalCredit: tCredit,
      currentBalance: runningBalance
    };
  }, [clientId, ledger]);

  if (!client) {
    return (
      <div className="max-w-7xl mx-auto p-8 text-center">
        <p>No clients available.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      <PageHeader
        title="Client Ledger"
        description="View detailed account statements and outstanding balances."
        actions={
          <Button variant="outline" size="md" icon={<Download className="w-4 h-4" />}>Export PDF</Button>
        }
      />

      <Card className="mb-8" padding={false}>
        <div className="p-8 flex flex-col md:flex-row gap-6 items-center">
          <div className="flex-1 max-w-xs w-full">
            <label htmlFor="ledger-client" className="block text-sm font-semibold text-[var(--color-text-main)] ml-1 mb-2">Select Client</label>
            <select
              id="ledger-client"
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full px-4 py-3.5 text-sm rounded-2xl transition-all duration-200 outline-none font-medium appearance-none bg-no-repeat bg-[var(--color-input-bg)] text-[var(--color-text-main)] border-2 border-transparent focus:border-[var(--color-primary)] focus:bg-[var(--color-card)] shadow-sm cursor-pointer"
              style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%239CA3AF'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem 1.25rem' }}
            >
              {activeClients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4 pt-0 md:pt-7">
            <div>
              <p className="text-xl font-semibold text-[var(--color-text-main)]">{client.name}</p>
              <div className="flex items-center gap-3 mt-1">
                <p className="text-sm font-medium text-[var(--color-text-muted)]">{client.city || client.region}</p>
                <p className="text-sm font-medium text-[var(--color-text-muted)]">{client.phone}</p>
              </div>
            </div>
          </div>
        </div>
      </Card>

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
            <p className="text-xs font-medium text-[var(--color-text-muted)] mt-1">{client.name} — Chronological order</p>
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
                <tr key={entry.id} className={`transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/30 ${entry.type === 'invoice' ? '' : 'bg-[var(--color-success-bg)]/[0.3] dark:bg-[var(--color-success)]/[0.05]'}`}>
                  <td className="px-6 py-4 text-xs font-medium text-gray-500 whitespace-nowrap">{entry.displayDate}</td>
                  <td className="px-6 py-4">
                    <Badge variant={entry.type === 'invoice' ? 'info' : 'success'}>
                      {entry.type === 'invoice' ? 'Invoice' : 'Payment'}
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
                  <td colSpan={6} className="px-6 py-12 text-center text-sm font-medium text-gray-500">No transactions recorded for this client.</td>
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
    </div>
  );
}
