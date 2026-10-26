import { useMemo, useState } from 'react';
import { ArrowLeft, AlertTriangle, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState } from '../../components/ui';
import {
  buildCustomerCreditReconciliationReport,
  type CustomerCreditReconciliationFinding,
  type CustomerCreditReconciliationReport,
} from '../../lib/customerCreditReconciliation';
import { formatCurrency } from '../../lib/utils';
import { useAuthStore } from '../../stores/authStore';
import { useDataStore } from '../../stores/dataStore';

function Money({ value }: { value: number | null | undefined }) {
  return <>{value === null || value === undefined ? 'Not recorded' : formatCurrency(value)}</>;
}

function FindingsList({ findings, emptyText }: { findings: CustomerCreditReconciliationFinding[]; emptyText: string }) {
  if (findings.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      {findings.map((finding, index) => (
        <div key={`${finding.code}-${finding.recordIds.join('-')}-${index}`} className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <Badge variant={finding.severity === 'blocking' ? 'danger' : 'warning'}>{finding.severity === 'blocking' ? 'Blocking review' : 'Discrepancy'}</Badge>
            <span className="text-xs font-mono text-[var(--color-text-muted)]">{finding.code}</span>
          </div>
          <p className="text-sm font-medium text-[var(--color-text-main)]">{finding.message}</p>
          {finding.recordIds.length > 0 && (
            <p className="mt-2 text-xs text-[var(--color-text-muted)] break-all">Records: {finding.recordIds.join(', ')}</p>
          )}
          {finding.details && Object.keys(finding.details).length > 0 && (
            <dl className="mt-2 grid gap-1 text-xs text-[var(--color-text-muted)] sm:grid-cols-2">
              {Object.entries(finding.details).map(([name, value]) => (
                <div key={name} className="flex gap-1 min-w-0"><dt className="font-medium">{name}:</dt><dd className="truncate">{String(value)}</dd></div>
              ))}
            </dl>
          )}
        </div>
      ))}
    </div>
  );
}

function ReportContent({ report, generatedAt, openingEntries }: {
  report: CustomerCreditReconciliationReport;
  generatedAt: string;
  openingEntries: Array<{ id: string; amount: number; division?: string; createdAt?: string; paymentDate?: string; billDate?: string }>;
}) {
  const hasFacts = report.activeOrderCreditFacts.length > 0 || openingEntries.length > 0 || report.ledgerDerivedBalance.invoiced !== 0 || report.ledgerDerivedBalance.payments !== 0;

  return (
    <div className="space-y-6">
      <Card className="border-amber-200 dark:border-amber-900/60" padding>
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div>
            <h2 className="font-bold text-[var(--color-text-main)]">Automatic credit unavailable</h2>
            <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">
              No verified transactional customer-credit balance is loaded in this read-only phase. Legacy client aggregates are shown only for comparison and cannot make credit spendable.
            </p>
          </div>
        </div>
      </Card>

      {!hasFacts && (
        <Card padding={false}>
          <EmptyState
            icon={<ShieldCheck className="w-7 h-7" />}
            title="No financial records in the synchronized review set"
            description="There are no active orders, opening balances, invoices, or payment postings for this client in the currently loaded data."
          />
        </Card>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Ledger opening balance', report.ledgerDerivedBalance.openingBalance],
          ['Ledger invoices', report.ledgerDerivedBalance.invoiced],
          ['Ledger payments', report.ledgerDerivedBalance.payments],
          ['Ledger raw balance', report.ledgerDerivedBalance.rawBalance],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4 sm:p-5" padding={false}>
            <p className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</p>
            <p className="mt-2 text-lg font-extrabold text-[var(--color-text-main)]"><Money value={Number(value)} /></p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">Persisted ledger fact</p>
          </Card>
        ))}
      </section>

      <Card>
        <h2 className="text-base font-bold text-[var(--color-text-main)]">Blocking allocation findings</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--color-text-muted)]">These records need review before any future credit balance could be approved. This screen does not change them.</p>
        <FindingsList findings={report.blockingFindings} emptyText="No blocking identifier or allocation findings in the current review set." />
      </Card>

      <Card>
        <h2 className="text-base font-bold text-[var(--color-text-main)]">Non-blocking legacy discrepancies</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--color-text-muted)]">Informational comparisons only. Client aggregate fields are not an authority for available credit.</p>
        <FindingsList findings={report.ambiguityFindings} emptyText="No legacy aggregate or opening-balance discrepancies detected." />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-base font-bold text-[var(--color-text-main)]">Persisted active-order credit</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--color-text-muted)]">Order fields are displayed as recorded, separately from ledger balance.</p>
          {report.activeOrderCreditFacts.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No active client orders in the review set.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[460px] text-sm">
                <thead className="text-left text-xs text-[var(--color-text-muted)]"><tr><th className="pb-2 pr-3">Order</th><th className="pb-2 pr-3">Order credit</th><th className="pb-2 pr-3">Primary</th><th className="pb-2">Bakery</th></tr></thead>
                <tbody>{report.activeOrderCreditFacts.map(fact => <tr key={fact.orderId} className="border-t border-black/[0.05] dark:border-white/[0.06]"><td className="py-2.5 pr-3 font-mono text-xs">{fact.orderId}</td><td className="py-2.5 pr-3"><Money value={fact.creditApplied} /></td><td className="py-2.5 pr-3"><Money value={fact.primaryCreditApplied} /></td><td className="py-2.5"><Money value={fact.bakeryCreditApplied} /></td></tr>)}</tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-base font-bold text-[var(--color-text-main)]">Opening-balance postings</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--color-text-muted)]">Persisted ledger entries included in the ledger-derived balance.</p>
          {openingEntries.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No opening-balance ledger postings in the review set.</p> : (
            <div className="space-y-2">{openingEntries.map(entry => <div key={entry.id} className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm dark:bg-gray-800/70"><div className="flex justify-between gap-3"><span className="font-mono text-xs break-all">{entry.id}</span><strong><Money value={entry.amount} /></strong></div><p className="mt-1 text-xs text-[var(--color-text-muted)]">{entry.division || 'Unspecified division'} · {entry.paymentDate || entry.billDate || entry.createdAt || 'No recorded date'}</p></div>)}</div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="text-base font-bold text-[var(--color-text-main)]">Legacy aggregate comparisons</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--color-text-muted)]">These values are not used to calculate spendable credit.</p>
        {report.legacyAggregateComparisons.length === 0 ? <p className="text-sm text-[var(--color-text-muted)]">No legacy aggregate fields were present for comparison.</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-sm"><thead className="text-left text-xs text-[var(--color-text-muted)]"><tr><th className="pb-2 pr-3">Legacy field</th><th className="pb-2 pr-3">Stored value</th><th className="pb-2 pr-3">Ledger comparison</th><th className="pb-2">Result</th></tr></thead><tbody>{report.legacyAggregateComparisons.map(comparison => <tr key={comparison.field} className="border-t border-black/[0.05] dark:border-white/[0.06]"><td className="py-2.5 pr-3 font-mono text-xs">{comparison.field}</td><td className="py-2.5 pr-3"><Money value={comparison.aggregateValue} /></td><td className="py-2.5 pr-3"><Money value={comparison.ledgerValue} /></td><td className="py-2.5"><Badge variant={comparison.matches ? 'success' : 'warning'}>{comparison.matches ? 'Matches' : 'Differs'}</Badge></td></tr>)}</tbody></table></div>
        )}
      </Card>

      <Card>
        <h2 className="text-base font-bold text-[var(--color-text-main)]">Review provenance</h2>
        <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-[var(--color-text-muted)]">Generated</dt><dd className="mt-1 font-medium text-[var(--color-text-main)]">{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(generatedAt))}</dd></div>
          <div><dt className="text-[var(--color-text-muted)]">Source fingerprint</dt><dd className="mt-1 break-all font-mono text-xs text-[var(--color-text-main)]">{report.sourceFingerprint}</dd></div>
        </dl>
      </Card>
    </div>
  );
}

/** Admin-only, read-only review of already synchronized customer financial records. */
export default function CustomerCreditReconciliationPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();
  const { user, initialized } = useAuthStore();
  const { clients, orders, payments, ledger, isLoaded, listenerError } = useDataStore();
  const [refreshVersion, setRefreshVersion] = useState(0);

  const client = clients.find(candidate => candidate.id === clientId && !candidate.deletedAt);
  const reportState = useMemo(() => {
    if (!client) return null;
    try {
      return {
        report: buildCustomerCreditReconciliationReport({ client, activeOrders: orders, payments, ledger }),
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The report could not be generated from synchronized data.' };
    }
  }, [client, orders, payments, ledger, refreshVersion]);

  if (!initialized) {
    return <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Checking access…</div>;
  }
  if (user?.role !== 'admin') {
    return <EmptyState icon={<ShieldAlert className="w-7 h-7" />} title="Access denied" description="Customer credit reconciliation is available only to administrators." action={<Button onClick={() => navigate('/dashboard')}>Back to dashboard</Button>} />;
  }
  if (!isLoaded) {
    return <div className="max-w-6xl mx-auto py-20 text-center text-sm text-[var(--color-text-muted)]">Loading synchronized customer records…</div>;
  }
  if (!client) {
    return <EmptyState icon={<AlertTriangle className="w-7 h-7" />} title="Client not found" description="The client may be unavailable in the current synchronized data." action={<Button onClick={() => navigate('/clients')}>Back to clients</Button>} />;
  }
  if (listenerError) {
    return <div className="max-w-3xl mx-auto py-16"><Card><div className="flex gap-3"><AlertTriangle className="w-5 h-5 shrink-0 text-red-600" /><div><h1 className="font-bold text-[var(--color-text-main)]">Financial data sync error</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">{listenerError}</p><p className="mt-2 text-sm text-[var(--color-text-muted)]">The reconciliation report is withheld because the synchronized record set may be incomplete.</p></div></div></Card></div>;
  }
  if ('error' in (reportState ?? {})) {
    return <div className="max-w-3xl mx-auto py-16"><Card><h1 className="font-bold text-[var(--color-text-main)]">Unable to build reconciliation report</h1><p className="mt-2 text-sm text-[var(--color-text-muted)]">{reportState?.error}</p><Button className="mt-4" variant="outline" onClick={() => setRefreshVersion(version => version + 1)} icon={<RefreshCw className="w-4 h-4" />}>Try again</Button></Card></div>;
  }
  if (!reportState) return null;

  const openingEntries = ledger
    .filter(entry => entry.clientId === client.id && entry.type === 'opening_balance')
    .map(entry => ({ id: entry.id, amount: Number(entry.amount) || 0, division: entry.division, createdAt: entry.createdAt, paymentDate: entry.paymentDate, billDate: entry.billDate }));

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <button onClick={() => navigate(`/clients/${client.id}`)} className="mb-6 flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-[var(--color-primary)]"><ArrowLeft className="w-4 h-4" />Back to {client.name}</button>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-extrabold tracking-tight text-[var(--color-text-main)]">Customer Credit Reconciliation</h1><Badge variant="info">Read only</Badge></div><p className="mt-2 text-sm text-[var(--color-text-muted)]">{client.name} · {client.region} · Client ID: <span className="font-mono">{client.id}</span></p></div>
        <Button variant="outline" size="sm" onClick={() => setRefreshVersion(version => version + 1)} icon={<RefreshCw className="w-4 h-4" />}>Refresh report</Button>
      </div>
      <ReportContent report={reportState.report} generatedAt={reportState.generatedAt} openingEntries={openingEntries} />
    </div>
  );
}
