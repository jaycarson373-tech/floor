"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Database } from "@/lib/database.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Asset = Database["public"]["Tables"]["assets"]["Row"];
type PriceTick = Database["public"]["Tables"]["price_ticks"]["Row"];
type Position = Database["public"]["Tables"]["positions"]["Row"];
type Order = Database["public"]["Tables"]["orders"]["Row"];
type CreditRow = Database["public"]["Tables"]["player_credits"]["Row"];
type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

type TradeFill = {
  order_id: string;
  credits: number;
  position_qty: number;
  avg_cost: number;
  fill_price: number;
  side: "buy" | "sell";
  qty: number;
  asset_id: string;
};

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-US");
}

function priceFor(assetId: string, latestTicks: Map<string, PriceTick>) {
  return latestTicks.get(assetId)?.price ?? null;
}

function makeLinePoints(ticks: PriceTick[]) {
  if (ticks.length === 0) return "";
  const ordered = [...ticks].reverse();
  const prices = ordered.map((tick) => tick.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = Math.max(1, max - min);

  return ordered
    .map((tick, index) => {
      const x = ordered.length === 1 ? 160 : (index / (ordered.length - 1)) * 320;
      const y = 112 - ((tick.price - min) / span) * 88;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function makeIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function TradingPanel({
  localPlayerId,
  supabase
}: {
  localPlayerId: string;
  supabase: SupabaseBrowserClient;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>("");
  const [latestTicks, setLatestTicks] = useState<Map<string, PriceTick>>(new Map());
  const [chartTicks, setChartTicks] = useState<PriceTick[]>([]);
  const [positions, setPositions] = useState<Map<string, Position>>(new Map());
  const [orders, setOrders] = useState<Order[]>([]);
  const [credits, setCredits] = useState<number | null>(null);
  const [qty, setQty] = useState("1");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId]
  );

  const selectedPosition = selectedAsset ? positions.get(selectedAsset.id) : undefined;
  const selectedPrice = selectedAsset ? priceFor(selectedAsset.id, latestTicks) : null;
  const chartPoints = useMemo(() => makeLinePoints(chartTicks), [chartTicks]);

  const loadTradingBook = useCallback(async () => {
    const [{ data: assetRows }, { data: creditRows }, { data: positionRows }, { data: orderRows }, { data: tickRows }] =
      await Promise.all([
        supabase.from("assets").select("*").order("symbol"),
        supabase.from("player_credits").select("*").eq("player_id", localPlayerId).maybeSingle(),
        supabase.from("positions").select("*").eq("player_id", localPlayerId),
        supabase.from("orders").select("*").eq("player_id", localPlayerId).order("created_at", { ascending: false }).limit(8),
        supabase.from("price_ticks").select("*").order("created_at", { ascending: false }).limit(160)
      ]);

    const nextAssets = (assetRows ?? []) as Asset[];
    const nextCredits = creditRows as CreditRow | null;
    const nextPositions = (positionRows ?? []) as Position[];
    const nextOrders = (orderRows ?? []) as Order[];
    const nextTicks = (tickRows ?? []) as PriceTick[];

    setAssets(nextAssets);
    setSelectedAssetId((current) => current || nextAssets[0]?.id || "");
    setCredits(nextCredits?.credits ?? null);
    setPositions(new Map(nextPositions.map((position) => [position.asset_id, position])));
    setOrders(nextOrders);

    setLatestTicks(() => {
      const reduced = new Map<string, PriceTick>();
      for (const tick of nextTicks) {
        if (!reduced.has(tick.asset_id)) reduced.set(tick.asset_id, tick);
      }
      return reduced;
    });
  }, [localPlayerId, supabase]);

  useEffect(() => {
    loadTradingBook();
  }, [loadTradingBook]);

  useEffect(() => {
    if (!selectedAsset) {
      setChartTicks([]);
      return;
    }

    let active = true;

    async function loadChart() {
      const { data } = await supabase
        .from("price_ticks")
        .select("*")
        .eq("asset_id", selectedAsset.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (active) setChartTicks((data ?? []) as PriceTick[]);
    }

    loadChart();
    return () => {
      active = false;
    };
  }, [selectedAsset, supabase]);

  useEffect(() => {
    const channel = supabase
      .channel("trading-price-ticks")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "price_ticks"
        },
        (payload) => {
          const tick = payload.new as PriceTick;
          setLatestTicks((previous) => {
            const updated = new Map(previous);
            updated.set(tick.asset_id, tick);
            return updated;
          });
          setChartTicks((previous) => {
            if (tick.asset_id !== selectedAssetId) return previous;
            return [tick, ...previous.filter((item) => item.id !== tick.id)].slice(0, 40);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedAssetId, supabase]);

  async function submitTrade(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAsset) return;

    const parsedQty = Number(qty);
    if (!Number.isSafeInteger(parsedQty) || parsedQty <= 0) {
      setMessage("Enter a whole quantity above zero.");
      return;
    }

    setBusy(true);
    setMessage("");

    const {
      data: { session }
    } = await supabase.auth.getSession();

    const response = await fetch("/api/trade", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
      },
      body: JSON.stringify({
        assetId: selectedAsset.id,
        side,
        qty: parsedQty,
        idempotencyKey: makeIdempotencyKey()
      })
    });

    const result = (await response.json()) as { fill?: TradeFill; error?: string };
    setBusy(false);

    if (!response.ok || !result.fill) {
      setMessage(result.error ?? "Trade rejected.");
      return;
    }

    const fill = result.fill;
    setCredits(fill.credits);
    setPositions((previous) => {
      const updated = new Map(previous);
      const current = previous.get(fill.asset_id);
      updated.set(fill.asset_id, {
        id: current?.id ?? fill.asset_id,
        player_id: localPlayerId,
        asset_id: fill.asset_id,
        qty: fill.position_qty,
        avg_cost: fill.avg_cost,
        created_at: current?.created_at ?? new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      return updated;
    });
    setOrders((previous) => [
      {
        id: fill.order_id,
        player_id: localPlayerId,
        asset_id: fill.asset_id,
        side: fill.side,
        qty: fill.qty,
        fill_price: fill.fill_price,
        idempotency_key: "",
        created_at: new Date().toISOString()
      },
      ...previous
    ].slice(0, 8));
    setMessage(`${fill.side.toUpperCase()} ${fill.qty} filled at ${formatCredits(fill.fill_price)} Credits.`);
  }

  return (
    <aside className="trading-panel" aria-label="Trading panel">
      <div className="trading-header">
        <div>
          <strong>Trading Desk</strong>
          <span>Simulated Credits only</span>
        </div>
        <div className="credit-balance">
          <span>{formatCredits(credits)}</span>
          <small>Credits</small>
        </div>
      </div>

      <div className="asset-list">
        {assets.map((asset) => {
          const currentPrice = priceFor(asset.id, latestTicks);
          const active = selectedAsset?.id === asset.id;
          return (
            <button
              className={active ? "asset-row active" : "asset-row"}
              key={asset.id}
              type="button"
              onClick={() => setSelectedAssetId(asset.id)}
            >
              <span>{asset.symbol}</span>
              <small>{formatCredits(currentPrice)}</small>
            </button>
          );
        })}
      </div>

      <div className="chart-card">
        <div className="chart-title">
          <strong>{selectedAsset?.symbol ?? "--"}</strong>
          <span>{selectedAsset?.name ?? "No asset selected"}</span>
        </div>
        <svg className="price-chart" viewBox="0 0 320 128" role="img" aria-label="Server price ticks">
          <path d="M0 112 H320 M0 80 H320 M0 48 H320 M0 16 H320" />
          {chartPoints ? <polyline points={chartPoints} /> : null}
        </svg>
      </div>

      <form className="trade-form" onSubmit={submitTrade}>
        <div className="side-toggle" role="group" aria-label="Order side">
          <button className={side === "buy" ? "active" : ""} type="button" onClick={() => setSide("buy")}>
            Buy
          </button>
          <button className={side === "sell" ? "active" : ""} type="button" onClick={() => setSide("sell")}>
            Sell
          </button>
        </div>
        <label>
          <span>Qty</span>
          <input inputMode="numeric" min="1" step="1" value={qty} onChange={(event) => setQty(event.target.value)} />
        </label>
        <button disabled={busy || !selectedAsset} type="submit">
          {busy ? "Submitting" : "Send Order"}
        </button>
        <div className="trade-message" role="status">
          {message}
        </div>
      </form>

      <div className="positions-card">
        <strong>Positions</strong>
        <div className="positions-table">
          {assets.map((asset) => {
            const position = positions.get(asset.id);
            const currentPrice = priceFor(asset.id, latestTicks);
            const pnl =
              position && currentPrice !== null ? (currentPrice - position.avg_cost) * position.qty : null;
            return (
              <div className="position-row" key={asset.id}>
                <span>{asset.symbol}</span>
                <span>{formatCredits(position?.qty ?? 0)}</span>
                <span>{formatCredits(position?.avg_cost ?? 0)}</span>
                <span className={pnl !== null && pnl < 0 ? "negative" : "positive"}>{formatCredits(pnl ?? 0)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="orders-card">
        <strong>Recent Fills</strong>
        {orders.map((order) => {
          const asset = assets.find((item) => item.id === order.asset_id);
          return (
            <div className="order-row" key={order.id}>
              <span>{order.side.toUpperCase()}</span>
              <span>{asset?.symbol ?? "--"}</span>
              <span>{order.qty}</span>
              <span>{formatCredits(order.fill_price)}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
