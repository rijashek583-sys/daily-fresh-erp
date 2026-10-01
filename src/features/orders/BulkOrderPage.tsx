import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import {
  Save, Search, Calendar, RefreshCw,
  CheckCircle2, XCircle, MapPin, ArrowLeft,
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
type StatusFilter = "all" | "pending" | "ordered";

// ── Component ─────────────────────────────────────────────────────────────────
export default function BulkOrderPage() {
  const { clients, products, regions, clientPricing, orders } = useDataStore();
  const navigate = useNavigate();
  const { activeDivision, setDivision } = useDivisionStore();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [deliveryDate, setDeliveryDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [search, setSearch] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // ── Grid quantities: quantities[clientId][productId] = number ─────────────
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});

  // ── Save/retry state ──────────────────────────────────────────────────────
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const [results, setResults] = useState<ShopSaveResult[]>([]);
  // Set of clientIds persisted in current session
  const [savedClientIds, setSavedClientIds] = useState<Set<string>>(new Set());

  // ── Base active clients for the current context (region filtered if set) ─
  const contextClients = useMemo(() =>
    clients
      .filter(c => c.status === "active" && !c.deletedAt)
      .filter(c => (filterRegion ? c.region === filterRegion : true)),
    [clients, filterRegion],
  );

  // ── Client IDs that have a saved order in Firestore for current context ───
  const persistedOrderedClientIds = useMemo(() => {
    const set = new Set<string>();
    if (!orders || orders.length === 0) return set;

    for (const o of orders) {
      if ((o as any).deletedAt) continue;
      if (o.deliveryDate !== deliveryDate) continue;
      if (!o.items || !Array.isArray(o.items) || o.items.length === 0) continue;
      if (activeDivision === "all") {
        const hasQty = o.items.some(i => (i.qty || 0) > 0);
        if (hasQty) {
          set.add(o.clientId);
        }
      } else {
        const hasDivisionQty = o.items.some(i => {
          if ((i.qty || 0) <= 0) return false;
          const prod = products.find(p => p.id === i.productId);
          const div = getProductDivision(prod || { name: i.productName });
          return div === activeDivision;
        });
        const orderMatchesDivision = o.division === activeDivision && o.items.some(i => (i.qty || 0) > 0);

        if (hasDivisionQty || orderMatchesDivision) {
          set.add(o.clientId);
        }
      }
    }
    return set;
  }, [orders, deliveryDate, activeDivision, products]);

  // Set of client IDs that explicitly failed in latest save batch
  const failedClientIds = useMemo(
    () => new Set(results.filter(r => r.status === "failed").map(r => r.clientId)),
    [results],
  );

  // ── Combined Ordered Client IDs (persisted orders + in-session successful saves) ──
  const orderedClientIds = useMemo(() => {
    const set = new Set<string>(persistedOrderedClientIds);
    savedClientIds.forEach(id => {
      if (!failedClientIds.has(id)) {
        set.add(id);
      }
    });
    return set;
  }, [persistedOrderedClientIds, savedClientIds, failedClientIds]);

  // ── Order Progress Counts ─────────────────────────────────────────────────
  const totalShopsCount = contextClients.length;
  const completedShopsCount = useMemo(
    () => contextClients.filter(c => orderedClientIds.has(c.id)).length,
    [contextClients, orderedClientIds],
  );
  const pendingShopsCount = Math.max(0, totalShopsCount - completedShopsCount);
  const completionPercentage = totalShopsCount > 0
    ? Math.min(100, Math.round((completedShopsCount / totalShopsCount) * 100))
    : 0;

  // ── Sync quantities from saved orders on load/date change ─────────────────
  useEffect(() => {
    if (!orders || orders.length === 0) return;

    setQuantities(prev => {
      let hasChanges = false;
      const next = { ...prev };

      orders.forEach(o => {
        if ((o as any).deletedAt) return;
        if (o.deliveryDate !== deliveryDate) return;
        if (!o.items || !Array.isArray(o.items) || o.items.length === 0) return;

        const clientId = o.clientId;
        const existing = next[clientId];

        const orderQuantities: Record<string, number> = {};
        let hasPositiveQty = false;
        o.items.forEach(i => {
          if ((i.qty || 0) > 0) {
            orderQuantities[i.productId] = i.qty;
            hasPositiveQty = true;
          }
        });

        if (!hasPositiveQty) return;

        if (!existing || Object.keys(existing).length === 0) {
          next[clientId] = orderQuantities;
          hasChanges = true;
        } else {
          // If not newly entered in this session, ensure saved order quantities are reflected
          let differs = false;
          for (const [pId, qty] of Object.entries(orderQuantities)) {
            if (existing[pId] !== qty) {
              differs = true;
              break;
            }
          }
          if (differs && !savedClientIds.has(clientId)) {
            next[clientId] = { ...existing, ...orderQuantities };
            hasChanges = true;
          }
        }
      });

      return hasChanges ? next : prev;
    });
  }, [orders, deliveryDate, savedClientIds]);

  // Reset session state when delivery date changes
  const handleDeliveryDateChange = (newDate: string) => {
    setDeliveryDate(newDate);
    setQuantities({});
    setSavedClientIds(new Set());
    setResults([]);
  };

  // ── Derived: visible clients (with Status filter + text search) ───────────
  const visibleClients = useMemo(() =>
    contextClients
      .filter(c => {
        if (statusFilter === "pending") return !orderedClientIds.has(c.id);
        if (statusFilter === "ordered") return orderedClientIds.has(c.id);
        return true;
      })
      .filter(c => (search ? c.name.toLowerCase().includes(search.toLowerCase()) : true))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [contextClients, statusFilter, orderedClientIds, search],
  );

  // ── Derived: product columns ──────────────────────────────────────────────
  // Show ALL active products in the current division as columns.
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

  // ── Price resolution ──────────────────────────────────────────────────────
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

  // Shops with at least one qty > 0 that are NOT yet ordered
  const pendingShops = useMemo(() =>
    contextClients.filter(c =>
      !orderedClientIds.has(c.id) &&
      visibleProducts.some(p => getQty(c.id, p.id) > 0),
    ),
    [contextClients, orderedClientIds, quantities, visibleProducts],
  );

  // ── Core save routine ─────────────────────────────────────────────────────
  const persistShops = async (shopList: Client[]): Promise<ShopSaveResult[]> => {
    const now = new Date().toISOString();
    const batchResults: ShopSaveResult[] = [];

    for (const client of shopList) {
      // Guard: never re-save an already-successful shop
      if (orderedClientIds.has(client.id)) continue;

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

  // ── Save all ready shops ──────────────────────────────────────────────────
  const handleSaveAll = async () => {
    if (pendingShops.length === 0) {
      toast.error("No quantities entered for pending shops. Fill in at least one shop.");
      return;
    }
    setSavePhase("saving");
    const batchResults = await persistShops(pendingShops);

    const successfulIds = batchResults.filter(r => r.status === "success").map(r => r.clientId);
    setSavedClientIds(prev => {
      const next = new Set(prev);
      successfulIds.forEach(id => next.add(id));
      return next;
    });
    setResults(batchResults);
    setSavePhase("done");

    const failed = batchResults.filter(r => r.status === "failed");
    const succeeded = batchResults.filter(r => r.status === "success");

    if (failed.length === 0) {
      toast.success(`${succeeded.length} order(s) saved successfully.`);
    } else {
      toast.warning(`${succeeded.length} saved — ${failed.length} failed. Use Retry Failed.`);
    }
  };

  // ── Retry failed ──────────────────────────────────────────────────────────
  const handleRetryFailed = async () => {
    const failedIds = new Set(results.filter(r => r.status === "failed").map(r => r.clientId));
    const toRetry = contextClients.filter(c => failedIds.has(c.id));
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
      toast.success("All retried orders saved successfully.");
    } else {
      toast.warning(`${newSucceeded.length} saved — ${stillFailed.length} still failing.`);
    }
  };

  const successResults = results.filter(r => r.status === "success");
  const failedResults  = results.filter(r => r.status === "failed");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-full pb-24">

      {/* ── Title + Navigation + Division tabs ── */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/orders")}
            className="h-8 px-2 text-xs flex items-center gap-1.5 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Orders
          </Button>
          <div className="h-4 w-px bg-gray-200 dark:bg-gray-800" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[var(--color-text-main)] leading-none">
              Bulk Order Entry
            </h1>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Enter quantities for active shops. Each shop creates an individual order.
            </p>
          </div>
        </div>
        <div className="hidden sm:block">
          <DivisionTabsDesktop activeTab={activeDivision} onChange={setDivision} />
        </div>
      </div>

      {/* ── Compact Filters & Progress Card ── */}
      <Card className="mb-4 p-3.5 sm:p-4">
        {/* Top Row: Progress Indicator + Status Filter Pills */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">

          {/* Left: Clear progress count & mini progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                Orders:
              </span>
              <span className="text-sm font-bold text-[var(--color-text-main)]">
                <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">{completedShopsCount}</span>
                <span className="text-[var(--color-text-muted)]"> / </span>
                <span>{totalShopsCount}</span>
                <span className="font-semibold text-[var(--color-text-muted)] text-xs ml-1">shops completed</span>
              </span>
              <span className="text-xs font-semibold text-gray-400">
                ({completionPercentage}%)
              </span>
            </div>

            {/* Mini visual progress bar */}
            <div className="hidden md:block w-24 h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${completionPercentage}%` }}
              />
            </div>
          </div>

          {/* Right: Status Filter Pills (All Shops / Pending — Not Ordered / Ordered) */}
          <div className="flex items-center gap-1 p-1 bg-gray-100/90 dark:bg-gray-800/80 rounded-xl text-xs font-medium self-start sm:self-auto overflow-x-auto max-w-full">
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap text-xs",
                statusFilter === "all"
                  ? "bg-white dark:bg-gray-900 text-[var(--color-text-main)] shadow-xs font-bold"
                  : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-300",
              )}
            >
              <span>All Shops</span>
              <span className={cn(
                "text-[10px] px-1.5 py-0.2 rounded-full font-bold",
                statusFilter === "all" ? "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300" : "bg-gray-200/60 dark:bg-gray-700/60 text-gray-500",
              )}>
                {totalShopsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter("pending")}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap text-xs",
                statusFilter === "pending"
                  ? "bg-white dark:bg-gray-900 text-amber-600 dark:text-amber-400 shadow-xs font-bold"
                  : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-300",
              )}
            >
              <span>Pending — Not Ordered</span>
              <span className={cn(
                "text-[10px] px-1.5 py-0.2 rounded-full font-bold",
                statusFilter === "pending" ? "bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400" : "bg-gray-200/60 dark:bg-gray-700/60 text-gray-500",
              )}>
                {pendingShopsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter("ordered")}
              className={cn(
                "px-2.5 py-1 rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap text-xs",
                statusFilter === "ordered"
                  ? "bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-xs font-bold"
                  : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-300",
              )}
            >
              <span>Ordered</span>
              <span className={cn(
                "text-[10px] px-1.5 py-0.2 rounded-full font-bold",
                statusFilter === "ordered" ? "bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400" : "bg-gray-200/60 dark:bg-gray-700/60 text-gray-500",
              )}>
                {completedShopsCount}
              </span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Delivery Date, Search, Region, Division (Mobile) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3">

          {/* Delivery date */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-[var(--color-text-muted)] flex items-center gap-1 uppercase tracking-wider">
              <Calendar className="w-3 h-3" /> Delivery Date
            </label>
            <input
              type="date"
              value={deliveryDate}
              onChange={e => handleDeliveryDateChange(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {/* Shop search */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-[var(--color-text-muted)] flex items-center gap-1 uppercase tracking-wider">
              <Search className="w-3 h-3" /> Search Shop
            </label>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by shop name..."
              className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all"
            />
          </div>

          {/* Region (optional) */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-[var(--color-text-muted)] flex items-center gap-1 uppercase tracking-wider">
              <MapPin className="w-3 h-3" /> Region <span className="normal-case font-normal text-gray-400 tracking-normal ml-0.5">(opt)</span>
            </label>
            <select
              value={filterRegion}
              onChange={e => setFilterRegion(e.target.value)}
              className="w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-800 bg-[var(--color-input-bg)] text-[var(--color-text-main)] outline-none focus:border-[var(--color-primary)] transition-all appearance-none cursor-pointer"
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
          <div className="hidden lg:flex flex-col gap-0.5 justify-center pl-2">
            <p className="text-[11px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Showing</p>
            <p className="text-xs font-bold text-[var(--color-text-main)]">
              {visibleClients.length} shop{visibleClients.length !== 1 ? "s" : ""}&nbsp;&middot;&nbsp;
              {visibleProducts.length} product{visibleProducts.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </Card>

      {/* ── Save results banner ── */}
      {results.length > 0 && (
        <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden animate-in fade-in duration-200">
          {successResults.length > 0 && (
            <div className="px-4 py-2.5 bg-green-50 dark:bg-green-900/20 flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-green-800 dark:text-green-300">
                {successResults.length} order(s) saved:&nbsp;
                <span className="font-normal">{successResults.map(r => r.clientName).join(", ")}</span>
              </p>
            </div>
          )}
          {failedResults.length > 0 && (
            <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20">
              <div className="flex items-center justify-between gap-4 mb-2">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                  <p className="text-xs font-bold text-red-800 dark:text-red-300">
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
              <ul className="space-y-0.5 pl-6">
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
        <div className="text-center py-16 bg-[var(--color-card)] rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
          <p className="text-sm font-medium text-gray-500">
            {statusFilter === "ordered" && completedShopsCount === 0
              ? "No shops have ordered yet for this delivery date."
              : statusFilter === "pending" && pendingShopsCount === 0
              ? "All shops have placed their orders! No pending shops."
              : "No active shops match your filters."}
          </p>
        </div>
      ) : visibleProducts.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-card)] rounded-2xl border border-dashed border-gray-200 dark:border-gray-800">
          <p className="text-sm font-medium text-gray-500">No active products in this division.</p>
        </div>
      ) : (
        <Card padding={false} className="overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">

          {/* Scrollable table with sticky shop column */}
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-sm"
              style={{ minWidth: (220 + visibleProducts.length * 115) + "px" }}
            >
              {/* ── Header ── */}
              <thead>
                <tr className="bg-gray-50/80 dark:bg-gray-900/60">
                  {/* Sticky shop column header */}
                  <th className="sticky left-0 z-20 bg-gray-50 dark:bg-gray-900 border-b border-r border-gray-100 dark:border-gray-800 px-4 py-3 text-left text-[11px] font-bold text-gray-500 uppercase tracking-wider min-w-[180px] max-w-[220px]">
                    Shop
                  </th>
                  {/* Product column headers */}
                  {visibleProducts.map(p => (
                    <th
                      key={p.id}
                      className="border-b border-gray-100 dark:border-gray-800 px-3 py-3 text-center text-[11px] font-bold text-gray-500 uppercase tracking-wider min-w-[110px] whitespace-nowrap"
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
                  <th className="border-b border-l border-gray-100 dark:border-gray-800 px-4 py-3 text-right text-[11px] font-bold text-gray-500 uppercase tracking-wider min-w-[110px]">
                    Row Total
                  </th>
                </tr>
              </thead>

              {/* ── Body ── */}
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800/40">
                {visibleClients.map((client, idx) => {
                  const rowTotal      = getRowTotal(client);
                  const isSaved       = orderedClientIds.has(client.id);
                  const hasFailed     = failedResults.some(r => r.clientId === client.id);
                  const hasEnteredQty = visibleProducts.some(p => getQty(client.id, p.id) > 0);

                  const rowBg = isSaved
                    ? "bg-green-50/50 dark:bg-green-900/10"
                    : hasFailed
                    ? "bg-red-50/50 dark:bg-red-900/10"
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isSaved && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                          {hasFailed && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
                          <span className="font-semibold text-xs text-[var(--color-text-main)] truncate leading-tight">
                            {client.name}
                          </span>
                          {isSaved && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 shrink-0">
                              Ordered
                            </span>
                          )}
                          {!isSaved && hasEnteredQty && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 shrink-0">
                              Draft
                            </span>
                          )}
                        </div>
                        {client.region && (
                          <span className={cn("block text-[10px] font-medium text-gray-400 mt-0.5 truncate", (isSaved || hasFailed) ? "pl-[20px]" : "")}>
                            {client.region}
                          </span>
                        )}
                      </td>

                      {/* ── Product quantity cells ── */}
                      {visibleProducts.map(p => {
                        const price = getEffectivePrice(client.id, p.id);
                        const qty   = getQty(client.id, p.id);

                        return (
                          <td key={p.id} className="px-2 py-2 text-center align-middle">
                            <div className="flex flex-col items-center">
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
                              <span className="block text-[10px] text-gray-400 dark:text-gray-500 font-medium mt-0.5 select-none h-3.5 leading-none">
                                {price > 0 ? formatCurrency(price) : ""}
                              </span>
                            </div>
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
                            : "text-gray-300 dark:text-gray-700",
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
          <div className="sticky bottom-0 px-6 py-3.5 border-t border-gray-100 dark:border-gray-800 bg-[var(--color-card)] flex flex-col sm:flex-row items-center justify-between gap-4 z-30">
            <div>
              <p className="text-xs font-semibold text-[var(--color-text-muted)]">
                {pendingShops.length} shop(s) ready to save&nbsp;&middot;&nbsp;{totalItemCount} item(s)
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
                : `Save ${pendingShops.length} Order${pendingShops.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
