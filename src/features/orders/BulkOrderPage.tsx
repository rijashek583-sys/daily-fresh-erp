import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Save, Search, Calendar, RefreshCw,
  CheckCircle2, XCircle, MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { useDataStore } from "../../stores/dataStore";
import { addOrder } from "../../services/db";
import { Button, Card } from "../../components/ui";
import { useDivisionStore } from "../../stores/divisionStore";
import { DivisionTabsDesktop, DivisionDropdownMobile } from "../../components/ui/DivisionTabs";
import { formatCurrency, cn, getProductDivision } from "../../lib/utils";
import { resolveProductPrice } from "../../lib/pricing";
import { type Client } from "../../types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ShopSaveResult {
  clientId: string;
  clientName: string;
  status: "success" | "failed";
}

type SavePhase = "idle" | "saving" | "done";

// ── Component ─────────────────────────────────────────────────────────────────
export default function BulkOrderPage() {
  const { clients, products, regions, clientPricing } = useDataStore();
  const navigate = useNavigate();
  const { activeDivision, setDivision } = useDivisionStore();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [deliveryDate, setDeliveryDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [filterRegion, setFilterRegion] = useState("");

  // ── Grid quantities: quantities[clientId][productId] = number ─────────────
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});

  // ── Save/retry state ──────────────────────────────────────────────────────
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [results, setResults] = useState<ShopSaveResult[]>([]);
  // Set of clientIds already persisted — guards against duplicate orders on retry
  const [savedClientIds, setSavedClientIds] = useState<Set<string>>(new Set());

  // ── Derived: client list (all active, no region gate) ─────────────────────
  const visibleClients = useMemo(() =>
    clients
      .filter(c => c.status === "active" && !c.deletedAt)
      .filter(c => filterRegion ? c.region === filterRegion : true)
      .filter(c => search ? c.name.toLowerCase().includes(search.toLowerCase()) : true)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [clients, filterRegion, search],
  );

  // ── Derived: product columns ──────────────────────────────────────────────
  // Show ALL active products in the current division as columns.
  // We do NOT filter by price here — all active products are orderable.
  const visibleProducts = useMemo(() =>
    products
      .filter(p =>
        p.status === "active" &&
        !p.deletedAt &&
        (activeDivision === "all" || getProductDivision(p) === activeDivision),
      )
      .sort((a, b) => (a.displayOrder ?? 99) - (b.displayOrder ?? 99)),
    [products, activeDivision],
  );

  // ── Quantity helpers ──────────────────────────────────────────────────────
  const getQty = (clientId: string, productId: string): number =>
    quantities[clientId]?.[productId] ?? 0;

  const setQty = useCallback((clientId: string, productId: string, raw: string) => {
    const val = parseInt(raw, 10);
    setQuantities(prev => ({
      ...prev,
      [clientId]: {
        ...(prev[clientId] ?? {}),
        [productId]: isNaN(val) ? 0 : Math.max(0, val),
      },
    }));
  }, []);

  // ── Price resolution: uses the SAME resolveProductPrice as CreateOrderPage ─
  // For each (client, product) pair, this returns:
  //   1. Client's custom price from clientPricing[clientId][productId]  (if set > 0)
  //   2. Product default price from (product as any).price              (fallback)
  //   3. 0 if neither exists → used for billing/totals, NEVER controls input rendering
  const getEffectivePrice = useCallback((clientId: string, productId: string): number =>
    resolveProductPrice(clientId, productId),
    [clientPricing],
  );

  // ── Row/grand totals ──────────────────────────────────────────────────────
  const getRowTotal = useCallback((client: Client): number =>
    visibleProducts.reduce((sum, p) => {
      const qty = getQty(client.id, p.id);
      if (qty <= 0) return sum;
      const price = getEffectivePrice(client.id, p.id);
      return sum + qty * price;
    }, 0),
    [quantities, visibleProducts, getEffectivePrice],
  );

  const grandTotal = useMemo(() =>
    visibleClients.reduce((sum, c) => sum + getRowTotal(c), 0),
    [visibleClients, getRowTotal],
  );

  const totalItemCount = useMemo(() =>
    Object.values(quantities).reduce((sum, qMap) =>
      sum + Object.values(qMap).reduce((s, v) => s + (v || 0), 0), 0),
    [quantities],
  );

  // Shops with at least one qty > 0 that are not yet saved
  const pendingShops = useMemo(() =>
    visibleClients.filter(c =>
      !savedClientIds.has(c.id) &&
      visibleProducts.some(p => getQty(c.id, p.id) > 0),
    ),
    [visibleClients, savedClientIds, quantities, visibleProducts],
  );

  // ── Core save routine ─────────────────────────────────────────────────────
  // Uses the SAME addOrder() function as CreateOrderPage.
  // addOrder() atomically writes the order + ledger entries + syncs client totals.
  // This ensures Bulk Orders appear everywhere: Orders list, Daily Bill, Client Ledger, Dashboard, Reports.
  const persistShops = async (shopList: Client[]): Promise<ShopSaveResult[]> => {
    const now = new Date().toISOString();
    const batchResults: ShopSaveResult[] = [];

    for (const client of shopList) {
      // Guard: never re-save an already-successful shop (prevents duplicates on retry)
      if (savedClientIds.has(client.id)) continue;

      const items = visibleProducts
        .filter(p => getQty(client.id, p.id) > 0)
        .map(p => {
          const qty = quantities[client.id]![p.id]!;
          const unitPrice = getEffectivePrice(client.id, p.id);
          return {
            productId: p.id,
            productName: p.name,
            qty,
            unitPrice,
            total: qty * unitPrice,
          };
        });

      if (items.length === 0) continue;

      const total = items.reduce((s, i) => s + i.total, 0);

      try {
        // addOrder() mirrors CreateOrderPage exactly:
        // - Writes to COLLECTIONS.ORDERS
        // - Creates ledger entries split by division
        // - Calls verifyAndSyncClientTotals(clientId)
        await addOrder({
          clientId: client.id,
          clientName: client.name,
          items,
          subtotal: total,
          tax: 0,
          total,
          deliveryDate,
          division: activeDivision,
          createdAt: now,
          updatedAt: now,
          updatedBy: "admin",
        });
        batchResults.push({ clientId: client.id, clientName: client.name, status: "success" });
      } catch (err) {
        console.error("[BulkOrder] Failed for " + client.name + ":", err);
        batchResults.push({ clientId: client.id, clientName: client.name, status: "failed" });
      }
    }

    return batchResults;
  };

  // ── Save all ──────────────────────────────────────────────────────────────
  const handleSaveAll = async () => {
    if (pendingShops.length === 0) {
      toast.error("No quantities entered. Fill in at least one shop.");
      return;
    }
    setSavePhase("saving");
    const batchResults = await persistShops(pendingShops);

    setSavedClientIds(prev => {
      const next = new Set(prev);
      batchResults.filter(r => r.status === "success").forEach(r => next.add(r.clientId));
      return next;
    });
    setResults(batchResults);
    setSavePhase("done");

    const failed = batchResults.filter(r => r.status === "failed");
    const succeeded = batchResults.filter(r => r.status === "success");

    if (failed.length === 0) {
      toast.success(succeeded.length + " order(s) saved successfully.");
      navigate("/orders");
    } else {
      toast.warning(succeeded.length + " saved — " + failed.length + " failed. Use Retry Failed.");
    }
  };

  // ── Retry failed ──────────────────────────────────────────────────────────
  const handleRetryFailed = async () => {
    const failedIds = new Set(results.filter(r => r.status === "failed").map(r => r.clientId));
    const toRetry = visibleClients.filter(c => failedIds.has(c.id));
    if (toRetry.length === 0) return;

    setSavePhase("saving");
    const retryResults = await persistShops(toRetry);

    // Merge: replace only retried entries, keep previous results intact
    setResults(prev => {
      const map = new Map(prev.map(r => [r.clientId, r]));
      retryResults.forEach(r => map.set(r.clientId, r));
      return Array.from(map.values());
    });
    setSavedClientIds(prev => {
      const next = new Set(prev);
      retryResults.filter(r => r.status === "success").forEach(r => next.add(r.clientId));
      return next;
    });
    setSavePhase("done");

    const stillFailed = retryResults.filter(r => r.status === "failed");
    const newSucceeded = retryResults.filter(r => r.status === "success");

    if (stillFailed.length === 0) {
      toast.success("All orders saved successfully.");
      navigate("/orders");
    } else {
      toast.warning(newSucceeded.length + " saved — " + stillFailed.length + " still failing.");
    }
  };

  const successResults = results.filter(r => r.status === "success");
  const failedResults  = results.filter(r => r.status === "failed");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-full pb-24">

      {/* ── Title + Division tabs ── */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-main)] mb-1">New Order</h1>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">
            Enter quantities for one or more shops. Each shop creates one order.
          </p>
        </div>
        <div className="hidden sm:block">
          <DivisionTabsDesktop activeTab={activeDivision} onChange={setDivision} />
        </div>
      </div>

      {/* ── Filters card ── */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Delivery date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Calendar className="w-3.5 h-3.5" /> Delivery Date
            </label>
            <input
              type="date"
              value={deliveryDate}
              onChange={e => setDeliveryDate(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {/* Shop search */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <Search className="w-3.5 h-3.5" /> Search Shop
            </label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by shop name..."
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {/* Region (optional) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-[var(--color-text-muted)] flex items-center gap-1.5 uppercase tracking-wider">
              <MapPin className="w-3.5 h-3.5" /> Region
              <span className="normal-case font-normal text-gray-400 tracking-normal ml-1">(optional)</span>
            </label>
            <select
              value={filterRegion}
              onChange={e => setFilterRegion(e.target.value)}
              className="w-full px-4 py-2.5 text-sm font-medium rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
            >
              <option value="">All Regions</option>
              {regions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Division dropdown (mobile) */}
          <div className="sm:hidden">
            <DivisionDropdownMobile activeTab={activeDivision} onChange={setDivision} />
          </div>

          {/* Summary (desktop 4th column) */}
          <div className="hidden lg:flex flex-col gap-1 justify-center">
            <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Showing</p>
            <p className="text-sm font-bold text-[var(--color-text-main)]">
              {visibleClients.length} shop{visibleClients.length !== 1 ? "s" : ""}&nbsp;&middot;&nbsp;
              {visibleProducts.length} product{visibleProducts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </Card>

      {/* ── Save results banner ── */}
      {results.length > 0 && (
        <div className="mb-6 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-in fade-in duration-200">
          {successResults.length > 0 && (
            <div className="px-5 py-3.5 bg-green-50 dark:bg-green-900/20 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                {successResults.length} order(s) saved:&nbsp;
                <span className="font-normal">{successResults.map(r => r.clientName).join(", ")}</span>
              </p>
            </div>
          )}
          {failedResults.length > 0 && (
            <div className="px-5 py-4 bg-red-50 dark:bg-red-900/20">
              <div className="flex items-center justify-between gap-4 mb-2.5">
                <div className="flex items-center gap-2.5">
                  <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-sm font-bold text-red-800 dark:text-red-300">
                    {failedResults.length} shop(s) failed to save:
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<RefreshCw className={cn("w-3.5 h-3.5", savePhase === "saving" && "animate-spin")} />}
                  onClick={handleRetryFailed}
                  disabled={savePhase === "saving"}
                >
                  Retry Failed
                </Button>
              </div>
              <ul className="space-y-1 pl-6">
                {failedResults.map(r => (
                  <li key={r.clientId} className="text-xs font-medium text-red-700 dark:text-red-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                    {r.clientName}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Grid / empty states ── */}
      {visibleClients.length === 0 ? (
        <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
          <p className="text-sm font-medium text-gray-500">No active shops match your filters.</p>
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="text-center py-20 bg-[var(--color-card)] rounded-3xl border border-dashed border-gray-200 dark:border-gray-800">
          <p className="text-sm font-medium text-gray-500">No active products in this division.</p>
        </div>
      ) : (
        <Card padding={false} className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* Scrollable table */}
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              style={{ minWidth: (220 + visibleProducts.length * 115) + "px" }}
            >
              {/* ── Header ── */}
              <thead>
                <tr className="bg-gray-50/80 dark:bg-gray-900/60">
                  {/* Sticky shop column header */}
                  <th className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-900 border-b border-r border-gray-100 dark:border-gray-800 px-4 py-3.5 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider min-w-[180px] max-w-[220px]">
                    Shop
                  </th>
                  {/* Product column headers */}
                  {visibleProducts.map(p => (
                    <th
                      key={p.id}
                      className="border-b border-gray-100 dark:border-gray-800 px-3 py-3.5 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider min-w-[110px] whitespace-nowrap"
                    >
                      {p.name}
                      {p.unit && (
                        <span className="block text-[10px] text-gray-400 font-normal normal-case tracking-normal mt-0.5">
                          /{p.unit}
                        </span>
                      )}
                    </th>
                  ))}
                  {/* Row total header */}
                  <th className="border-b border-l border-gray-100 dark:border-gray-800 px-4 py-3.5 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider min-w-[110px]">
                    Row Total
                  </th>
                </tr>
              </thead>

              {/* ── Body ── */}
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                {visibleClients.map((client, idx) => {
                  const rowTotal      = getRowTotal(client);
                  const isSaved       = savedClientIds.has(client.id);
                  const hasFailed     = failedResults.some(r => r.clientId === client.id);
                  const hasEnteredQty = visibleProducts.some(p => getQty(client.id, p.id) > 0);

                  const rowBg = isSaved
                    ? "bg-green-50/60 dark:bg-green-900/10"
                    : hasFailed
                    ? "bg-red-50/60 dark:bg-red-900/10"
                    : hasEnteredQty
                    ? "bg-[var(--color-primary)]/[0.025] dark:bg-[var(--color-primary)]/[0.04]"
                    : idx % 2 === 0
                    ? "bg-[var(--color-card)]"
                    : "bg-gray-50/40 dark:bg-gray-800/10";

                  const stickyBg = isSaved
                    ? "bg-green-50 dark:bg-green-900/20"
                    : hasFailed
                    ? "bg-red-50 dark:bg-red-900/20"
                    : hasEnteredQty
                    ? "bg-white dark:bg-gray-900"
                    : idx % 2 === 0
                    ? "bg-[var(--color-card)]"
                    : "bg-gray-50/80 dark:bg-gray-800/20";

                  return (
                    <tr key={client.id} className={cn("group transition-colors", rowBg)}>

                      {/* ── Sticky shop cell ── */}
                      <td className={cn("sticky left-0 z-10", stickyBg, "border-r border-gray-100 dark:border-gray-800 px-4 py-2.5")}>
                        <div className="flex items-center gap-2 min-w-0">
                          {isSaved && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />}
                          {hasFailed && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          <span className="font-semibold text-xs text-[var(--color-text-main)] truncate leading-tight">
                            {client.name}
                          </span>
                        </div>
                        {client.region && (
                          <span className={cn("block text-[10px] font-medium text-gray-400 mt-0.5 truncate", (isSaved || hasFailed) ? "pl-[22px]" : "")}>
                            {client.region}
                          </span>
                        )}
                      </td>

                      {/* ── Product quantity cells ── */}
                      {visibleProducts.map(p => {
                        // Resolve price for totals (custom price → default price → 0)
                        // Input is ALWAYS rendered and editable for EVERY shop and EVERY product.
                        const price = getEffectivePrice(client.id, p.id);
                        const qty   = getQty(client.id, p.id);

                        return (
                          <td key={p.id} className="px-2 py-2 text-center align-middle">
                            <input
                              type="number"
                              min="0"
                              inputMode="numeric"
                              placeholder="0"
                              value={qty > 0 ? qty : ""}
                              onChange={e => setQty(client.id, p.id, e.target.value)}
                              disabled={isSaved}
                              title={`${client.name} - ${p.name}${price > 0 ? ` (${formatCurrency(price)})` : ""}`}
                              aria-label={`${client.name} - ${p.name}${price > 0 ? ` (${formatCurrency(price)})` : ""}`}
                              className={cn(
                                "w-[80px] px-2 py-1.5 text-center text-sm font-bold rounded-lg outline-none transition-all",
                                "bg-[var(--color-input-bg)] border-2 border-transparent",
                                "focus:border-[var(--color-primary)] focus:bg-[var(--color-card)]",
                                "disabled:opacity-40 disabled:cursor-not-allowed",
                                qty > 0 ? "text-[var(--color-primary)]" : "text-[var(--color-text-muted)]",
                              )}
                            />
                          </td>
                        );
                      })}

                      {/* ── Row total ── */}
                      <td className="border-l border-gray-100 dark:border-gray-800 px-4 py-2 text-right align-middle">
                        <span className={cn(
                          "text-sm font-bold tabular-nums",
                          rowTotal > 0
                            ? "text-[var(--color-primary)]"
                            : hasEnteredQty
                            ? "text-[var(--color-text-main)]"
                            : "text-gray-300 dark:text-gray-700"
                        )}>
                          {hasEnteredQty ? formatCurrency(rowTotal) : "—"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Save / footer bar ── */}
          <div className="sticky bottom-0 px-6 py-4 border-t border-gray-100 dark:border-gray-800 bg-[var(--color-card)] flex flex-col sm:flex-row items-center justify-between gap-4 z-30">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                {pendingShops.length} shop(s) ready&nbsp;&middot;&nbsp;{totalItemCount} item(s)
              </p>
              <p className="text-2xl font-bold text-[var(--color-text-main)] tabular-nums">
                {formatCurrency(grandTotal)}
              </p>
            </div>
            <Button
              size="lg"
              icon={savePhase === "saving" ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
              onClick={handleSaveAll}
              disabled={savePhase === "saving" || pendingShops.length === 0}
              className="w-full sm:w-auto shadow-lg shadow-red-500/20"
            >
              {savePhase === "saving"
                ? "Saving..."
                : "Save " + pendingShops.length + " Order" + (pendingShops.length !== 1 ? "s" : "")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
