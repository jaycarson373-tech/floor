"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

type AssetRow = {
  id: string;
  symbol: string;
  name: string;
};

type PmRow = {
  pm_id: string;
  name: string;
  wallet_address: string | null;
  ranked: boolean;
  ranked_pnl: number;
  ranked_duels: number;
  ranked_wins: number;
  tier: string;
  pm_eligible: boolean;
  managed_cash: number;
  aum: number;
};

type AllocationRow = {
  id: string;
  allocator_id: string;
  pm_id: string;
  book_id: string;
  principal: number;
  principal_remaining: number;
  realized_pnl: number;
  fee_paid: number;
  status: "active" | "withdrawing" | "closed";
  ranked: boolean;
  created_at: string;
};

type ManagedBook = {
  id: string;
  pm_id: string;
  cash_credits: number;
  ranked: boolean;
};

type ManagedPosition = {
  id: string;
  book_id: string;
  asset_id: string;
  qty: number;
  avg_cost: number;
  assets?: { symbol?: string; name?: string };
};

type ManagedOrder = {
  id: string;
  asset_id: string;
  side: "buy" | "sell";
  qty: number;
  fill_price: number;
  created_at: string;
  assets?: { symbol?: string; name?: string };
};

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-US");
}

function makeIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function CapitalPanel({
  localPlayerId,
  supabase
}: {
  localPlayerId: string;
  supabase: SupabaseBrowserClient;
}) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [pmDirectory, setPmDirectory] = useState<PmRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [book, setBook] = useState<ManagedBook | null>(null);
  const [positions, setPositions] = useState<ManagedPosition[]>([]);
  const [orders, setOrders] = useState<ManagedOrder[]>([]);
  const [selectedPmId, setSelectedPmId] = useState("");
  const [amount, setAmount] = useState("1000");
  const [assetId, setAssetId] = useState("");
  const [qty, setQty] = useState("1");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const eligiblePms = useMemo(() => pmDirectory.filter((pm) => pm.pm_eligible), [pmDirectory]);
  const myAllocations = allocations.filter((allocation) => allocation.allocator_id === localPlayerId);
  const managedAllocations = allocations.filter((allocation) => allocation.pm_id === localPlayerId);

  const authHeaders = useCallback(async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    return {
      "content-type": "application/json",
      ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
    };
  }, [supabase]);

  const loadCapital = useCallback(async () => {
    const [{ data: assetRows }, response] = await Promise.all([
      supabase.from("assets").select("id, symbol, name").order("symbol"),
      (async () => {
        const headers = await authHeaders();
        return fetch("/api/allocate", { headers });
      })()
    ]);

    setAssets((assetRows ?? []) as AssetRow[]);
    setAssetId((current) => current || ((assetRows ?? []) as AssetRow[])[0]?.id || "");

    const result = (await response.json()) as {
      pmDirectory?: PmRow[];
      allocations?: AllocationRow[];
      book?: ManagedBook | null;
      managedPositions?: ManagedPosition[];
      managedOrders?: ManagedOrder[];
      error?: string;
    };

    if (response.ok) {
      setPmDirectory(result.pmDirectory ?? []);
      setAllocations(result.allocations ?? []);
      setBook(result.book ?? null);
      setPositions(result.managedPositions ?? []);
      setOrders(result.managedOrders ?? []);
      setSelectedPmId((current) => current || result.pmDirectory?.find((pm) => pm.pm_eligible)?.pm_id || "");
    } else {
      setMessage(result.error ?? "Could not load allocation data.");
    }
  }, [authHeaders, supabase]);

  useEffect(() => {
    loadCapital();
    const timer = window.setInterval(loadCapital, 8000);
    return () => window.clearInterval(timer);
  }, [loadCapital]);

  async function postJson(url: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const headers = await authHeaders();
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Request rejected.");
      await loadCapital();
      setMessage("Capital book updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function allocate() {
    const parsedAmount = Number(amount);
    if (!selectedPmId || !Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      setMessage("Choose a PM and whole Credit amount.");
      return;
    }

    postJson("/api/allocate", {
      pmId: selectedPmId,
      amount: parsedAmount,
      idempotencyKey: makeIdempotencyKey()
    });
  }

  function managedTrade() {
    const parsedQty = Number(qty);
    if (!assetId || !Number.isSafeInteger(parsedQty) || parsedQty <= 0) {
      setMessage("Choose an asset and whole quantity.");
      return;
    }

    postJson("/api/managed-trade", {
      assetId,
      side,
      qty: parsedQty,
      idempotencyKey: makeIdempotencyKey()
    });
  }

  function settle(allocationId: string, withdraw: boolean) {
    postJson("/api/settle-allocation", {
      allocationId,
      withdraw,
      idempotencyKey: makeIdempotencyKey()
    });
  }

  return (
    <aside className="capital-panel" aria-label="Capital allocation panel">
      <div className="trading-header">
        <div>
          <strong>Capital Allocation</strong>
          <span>Soft test Credits only, not redeemable</span>
        </div>
      </div>

      <section className="capital-card">
        <strong>Allocate to PM</strong>
        <label>
          <span>PM Desk</span>
          <select value={selectedPmId} onChange={(event) => setSelectedPmId(event.target.value)}>
            <option value="">Select PM</option>
            {eligiblePms.map((pm) => (
              <option key={pm.pm_id} value={pm.pm_id}>
                {pm.name} | {pm.tier} | AUM {formatCredits(pm.aum)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Credits</span>
          <input inputMode="numeric" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <button disabled={busy || !selectedPmId} type="button" onClick={allocate}>
          Allocate
        </button>
      </section>

      <section className="capital-card">
        <strong>My Allocations</strong>
        {myAllocations.map((allocation) => (
          <div className="allocation-row" key={allocation.id}>
            <span>{allocation.status}</span>
            <span>{formatCredits(allocation.principal_remaining)}</span>
            <span>{allocation.ranked ? "ranked" : "sandbox"}</span>
            <button disabled={busy || allocation.status === "closed"} type="button" onClick={() => settle(allocation.id, false)}>
              Settle
            </button>
            <button disabled={busy || allocation.status === "closed"} type="button" onClick={() => settle(allocation.id, true)}>
              Withdraw
            </button>
          </div>
        ))}
      </section>

      <section className="capital-card">
        <strong>PM Managed Book</strong>
        <div className="rank-card">
          <div>
            <span>Cash</span>
            <strong>{formatCredits(book?.cash_credits ?? 0)}</strong>
          </div>
          <div>
            <span>Allocators</span>
            <strong>{managedAllocations.length}</strong>
          </div>
        </div>
        <label>
          <span>Managed Asset</span>
          <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Qty</span>
          <input inputMode="numeric" min="1" step="1" value={qty} onChange={(event) => setQty(event.target.value)} />
        </label>
        <div className="side-toggle">
          <button className={side === "buy" ? "active" : ""} type="button" onClick={() => setSide("buy")}>
            Buy
          </button>
          <button className={side === "sell" ? "active" : ""} type="button" onClick={() => setSide("sell")}>
            Sell
          </button>
        </div>
        <button disabled={busy || !book} type="button" onClick={managedTrade}>
          Trade Managed Book
        </button>
      </section>

      <section className="capital-card">
        <strong>Managed Positions</strong>
        {positions.map((position) => (
          <div className="position-row" key={position.id}>
            <span>{position.assets?.symbol ?? "--"}</span>
            <span>{formatCredits(position.qty)}</span>
            <span>{formatCredits(position.avg_cost)}</span>
            <span>managed</span>
          </div>
        ))}
      </section>

      <section className="capital-card">
        <strong>Recent Managed Orders</strong>
        {orders.map((order) => (
          <div className="order-row" key={order.id}>
            <span>{order.side.toUpperCase()}</span>
            <span>{order.assets?.symbol ?? "--"}</span>
            <span>{order.qty}</span>
            <span>{formatCredits(order.fill_price)}</span>
          </div>
        ))}
      </section>

      <section className="capital-card">
        <strong>Hierarchy</strong>
        {pmDirectory.slice(0, 6).map((pm) => (
          <div className="leader-row" key={pm.pm_id}>
            <span>{pm.name}</span>
            <span>{pm.tier}</span>
            <span>{formatCredits(pm.aum)}</span>
          </div>
        ))}
        <small>Managed Credits remain soft-only; real rank payouts live in the Season Desk.</small>
      </section>

      <div className="trade-message" role="status">
        {message}
      </div>
    </aside>
  );
}
