"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Database } from "@/lib/database.types";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Player = Database["public"]["Tables"]["players"]["Row"];
type Asset = Database["public"]["Tables"]["assets"]["Row"];
type RankedRow = Database["public"]["Views"]["ranked_leaderboard"]["Row"];
type SandboxRow = Database["public"]["Views"]["sandbox_leaderboard"]["Row"];
type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

type DuelSide = "long" | "short";
type DuelRow = {
  id: string;
  asset_id: string;
  stake: number;
  player_a: string;
  player_b: string | null;
  player_a_side: DuelSide;
  player_b_side: DuelSide | null;
  status: "open" | "locked" | "revealing" | "settled" | "cancelled";
  ranked: boolean;
  commit_hash: string;
  seed: string | null;
  winner: string | null;
  player_a_pnl: number | null;
  player_b_pnl: number | null;
  start_price: number;
  end_price: number | null;
  asset: { id: string; symbol: string; name: string } | null;
  playerA: { id: string; name: string; ranked: boolean; wallet_address: string | null } | null;
  playerB: { id: string; name: string; ranked: boolean; wallet_address: string | null } | null;
};

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, encoding: "utf8"): Promise<{ signature: Uint8Array }>;
};

declare global {
  interface Window {
    solana?: PhantomProvider;
  }
}

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-US");
}

function shortAddress(value: string | null | undefined) {
  if (!value) return "sandbox";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function makeIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toBase58(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const digits = [0];
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      const value = digits[j] * 256 + carry;
      digits[j] = value % 58;
      carry = Math.floor(value / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  return "1".repeat(zeros) + digits.reverse().map((digit) => alphabet[digit]).join("");
}

export default function DuelPanel({
  localPlayer,
  supabase,
  onRankedUpdate
}: {
  localPlayer: Player;
  supabase: SupabaseBrowserClient;
  onRankedUpdate: (patch: Pick<Player, "wallet_address" | "ranked" | "gate_balance" | "ranked_checked_at">) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [duels, setDuels] = useState<DuelRow[]>([]);
  const [rankedRows, setRankedRows] = useState<RankedRow[]>([]);
  const [sandboxRows, setSandboxRows] = useState<SandboxRow[]>([]);
  const [assetId, setAssetId] = useState("");
  const [stake, setStake] = useState("500");
  const [side, setSide] = useState<DuelSide>("long");
  const [acceptSide, setAcceptSide] = useState<DuelSide>("short");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const gateMint = process.env.NEXT_PUBLIC_PUMP_GATE_MINT ?? process.env.NEXT_PUBLIC_PUMPST_GATE_MINT ?? process.env.NEXT_PUBLIC_GATE_MINT ?? "";
  const openDuels = useMemo(() => duels.filter((duel) => duel.status === "open"), [duels]);

  const loadAll = useCallback(async () => {
    const [{ data: assetRows }, { data: ranked }, { data: sandbox }] = await Promise.all([
      supabase.from("assets").select("*").order("symbol"),
      supabase.from("ranked_leaderboard").select("*").limit(8),
      supabase.from("sandbox_leaderboard").select("*").limit(8)
    ]);

    setAssets((assetRows ?? []) as Asset[]);
    setAssetId((current) => current || ((assetRows ?? []) as Asset[])[0]?.id || "");
    setRankedRows((ranked ?? []) as RankedRow[]);
    setSandboxRows((sandbox ?? []) as SandboxRow[]);

    const response = await fetch("/api/duels");
    const result = (await response.json()) as { duels?: DuelRow[]; error?: string };
    if (response.ok) setDuels(result.duels ?? []);
  }, [supabase]);

  useEffect(() => {
    loadAll();
    const timer = window.setInterval(loadAll, 5000);
    return () => window.clearInterval(timer);
  }, [loadAll]);

  async function authHeaders() {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    return {
      "content-type": "application/json",
      ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
    };
  }

  async function verifyWallet() {
    setBusy(true);
    setMessage("");

    try {
      const provider = window.solana;
      if (!provider?.isPhantom) throw new Error("Phantom is not available.");
      if (!gateMint) throw new Error("Gate mint display config is missing.");

      const connection = await provider.connect();
      const walletAddress = connection.publicKey.toString();
      const messageText = `PumpSt ranked verification\nPlayer: ${localPlayer.id}\nWallet: ${walletAddress}\nGate mint: ${gateMint}`;
      const signed = await provider.signMessage(new TextEncoder().encode(messageText), "utf8");
      const headers = await authHeaders();
      const response = await fetch("/api/wallet/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({
          walletAddress,
          message: messageText,
          signature: toBase58(signed.signature)
        })
      });
      const result = (await response.json()) as {
        player?: Pick<Player, "wallet_address" | "ranked" | "gate_balance" | "ranked_checked_at">;
        gateBalance?: string;
        threshold?: string;
        ranked?: boolean;
        error?: string;
      };

      if (!response.ok || !result.player) throw new Error(result.error ?? "Wallet verification rejected.");
      onRankedUpdate(result.player);
      setMessage(result.ranked ? "Wallet verified. Ranked enabled." : "Wallet verified, but below gate threshold.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet verification failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendDuel(action: "create" | "accept" | "settle", duel?: DuelRow) {
    const parsedStake = Number(stake);
    setBusy(true);
    setMessage("");

    try {
      const headers = await authHeaders();
      const response = await fetch("/api/duels", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action,
          assetId,
          stake: parsedStake,
          side: action === "accept" ? acceptSide : side,
          duelId: duel?.id,
          idempotencyKey: makeIdempotencyKey()
        })
      });
      const result = (await response.json()) as { duel?: unknown; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Duel action failed.");
      setMessage(action === "settle" ? "Duel settled. Seed revealed." : "Duel updated.");
      await loadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Duel action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="duel-panel" aria-label="Duel and ranked panel">
      <div className="trading-header">
        <div>
          <strong>Fund Ladder</strong>
          <span>{localPlayer.ranked ? "Ranked wallet verified" : "Sandbox only, not reward-eligible"}</span>
        </div>
        <button disabled={busy} className={localPlayer.ranked ? "rank-button ranked" : "rank-button"} type="button" onClick={verifyWallet}>
          {localPlayer.ranked ? "Recheck" : "Verify"}
        </button>
      </div>

      <div className="rank-card">
        <div>
          <span>Wallet</span>
          <strong>{shortAddress(localPlayer.wallet_address)}</strong>
        </div>
        <div>
          <span>Gate Balance</span>
          <strong>{formatCredits(localPlayer.gate_balance)}</strong>
        </div>
      </div>

      <div className="duel-card">
        <strong>Open Duel</strong>
        <label>
          <span>Asset</span>
          <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.symbol}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Stake</span>
          <input inputMode="numeric" min="1" step="1" value={stake} onChange={(event) => setStake(event.target.value)} />
        </label>
        <div className="side-toggle">
          <button className={side === "long" ? "active" : ""} type="button" onClick={() => setSide("long")}>
            Long
          </button>
          <button className={side === "short" ? "active" : ""} type="button" onClick={() => setSide("short")}>
            Short
          </button>
        </div>
        <button disabled={busy || !assetId || Number(stake) <= 0} type="button" onClick={() => sendDuel("create")}>
          Create Duel
        </button>
      </div>

      <div className="duel-card">
        <strong>Open Challenges</strong>
        <div className="side-toggle">
          <button className={acceptSide === "long" ? "active" : ""} type="button" onClick={() => setAcceptSide("long")}>
            Long
          </button>
          <button className={acceptSide === "short" ? "active" : ""} type="button" onClick={() => setAcceptSide("short")}>
            Short
          </button>
        </div>
        {openDuels.slice(0, 4).map((duel) => (
          <div className="duel-row" key={duel.id}>
            <span>{duel.asset?.symbol ?? "--"}</span>
            <span>{formatCredits(duel.stake)}</span>
            <span>{duel.playerA?.name ?? "anon"}</span>
            <button disabled={busy || duel.player_a === localPlayer.id} type="button" onClick={() => sendDuel("accept", duel)}>
              Accept
            </button>
          </div>
        ))}
      </div>

      <div className="duel-card">
        <strong>Recent Duels</strong>
        {duels.slice(0, 5).map((duel) => (
          <div className="duel-result" key={duel.id}>
            <span>{duel.asset?.symbol ?? "--"} {duel.ranked ? "Ranked" : "Sandbox"}</span>
            <small>{duel.status} | commit {duel.commit_hash.slice(0, 8)}</small>
            {duel.status === "locked" ? (
              <button disabled={busy} type="button" onClick={() => sendDuel("settle", duel)}>
                Reveal
              </button>
            ) : null}
            {duel.status === "settled" ? (
              <small>
                seed {duel.seed?.slice(0, 8)} | winner {duel.winner === localPlayer.id ? "you" : shortAddress(duel.winner)}
              </small>
            ) : null}
          </div>
        ))}
      </div>

      <div className="leaderboards">
        <div className="leaderboard">
          <strong>Ranked Board</strong>
          <small>Payout eligibility snapshots in the Season Desk.</small>
          {rankedRows.map((row) => (
            <div className="leader-row" key={row.player_id}>
              <span>{row.name}</span>
              <span>{row.tier}</span>
              <span>{formatCredits(row.ranked_pnl)}</span>
            </div>
          ))}
        </div>
        <div className="leaderboard">
          <strong>Sandbox Board</strong>
          <small>Cosmetic, not eligible for rewards.</small>
          {sandboxRows.map((row) => (
            <div className="leader-row" key={row.player_id}>
              <span>{row.name}</span>
              <span>{row.ranked ? "ranked" : "sandbox"}</span>
              <span>{formatCredits(row.sandbox_pnl)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="trade-message" role="status">
        {message}
      </div>
    </aside>
  );
}
