"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

type TapeRound = {
  id: string;
  round_number: number;
  status: "open" | "locked" | "revealing" | "settled";
  commit_hash: string;
  server_seed: string | null;
  public_entropy: string;
  outcome: "up" | "down" | null;
  pot: number;
  opened_at: string;
  locked_at: string | null;
  settled_at: string | null;
};

type TapeStake = {
  id: string;
  round_id: string;
  player_id: string;
  side: "up" | "down";
  stake: number;
  ranked: boolean;
  paid_out: number;
  pnl: number;
  player?: {
    id: string;
    name: string;
    ranked: boolean;
    gx: number;
    gy: number;
  } | null;
};

type TapeState = {
  cadence?: string;
  round: TapeRound | null;
  stakes: TapeStake[];
  error?: string;
};

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-US");
}

function makeIdempotencyKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function secondsLeft(round: TapeRound | null) {
  if (!round || round.status !== "open") return 0;
  const opened = new Date(round.opened_at).getTime();
  return Math.max(0, Math.ceil((opened + 60_000 - Date.now()) / 1000));
}

export default function TapePanel({
  localPlayerId,
  supabase
}: {
  localPlayerId: string;
  supabase: SupabaseBrowserClient;
}) {
  const [round, setRound] = useState<TapeRound | null>(null);
  const [stakes, setStakes] = useState<TapeStake[]>([]);
  const [stakeAmount, setStakeAmount] = useState("100");
  const [timeLeft, setTimeLeft] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const myStake = stakes.find((stake) => stake.player_id === localPlayerId) ?? null;

  const totals = useMemo(() => {
    return stakes.reduce(
      (next, stake) => {
        next[stake.side].credits += stake.stake;
        next[stake.side].count += 1;
        return next;
      },
      {
        up: { credits: 0, count: 0 },
        down: { credits: 0, count: 0 }
      }
    );
  }, [stakes]);

  const authHeaders = useCallback(async () => {
    const {
      data: { session }
    } = await supabase.auth.getSession();

    return {
      "content-type": "application/json",
      ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {})
    };
  }, [supabase]);

  const loadTape = useCallback(async () => {
    const response = await fetch("/api/tape");
    const result = (await response.json()) as TapeState;

    if (!response.ok) {
      setMessage(result.error ?? "Could not load Tape round.");
      return;
    }

    setRound(result.round);
    setStakes(result.stakes ?? []);
  }, []);

  useEffect(() => {
    loadTape();
    const poll = window.setInterval(loadTape, 5000);
    const tick = window.setInterval(() => setTimeLeft(secondsLeft(round)), 1000);

    const channel = supabase
      .channel("the-tape")
      .on("postgres_changes", { event: "*", schema: "public", table: "tape_rounds" }, loadTape)
      .on("postgres_changes", { event: "*", schema: "public", table: "tape_stakes" }, loadTape)
      .subscribe();

    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
      supabase.removeChannel(channel);
    };
  }, [loadTape, round, supabase]);

  useEffect(() => {
    setTimeLeft(secondsLeft(round));
  }, [round]);

  async function joinTape() {
    if (!round || round.status !== "open") {
      setMessage("No open Tape round yet.");
      return;
    }

    const parsedStake = Number(stakeAmount);
    if (!Number.isSafeInteger(parsedStake) || parsedStake <= 0) {
      setMessage("Stake a whole Credit amount.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const headers = await authHeaders();
      const response = await fetch("/api/tape/join", {
        method: "POST",
        headers,
        body: JSON.stringify({
          roundId: round.id,
          stake: parsedStake,
          idempotencyKey: makeIdempotencyKey()
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Tape stake rejected.");
      await loadTape();
      setMessage("Stake locked from your pad.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tape stake failed.");
    } finally {
      setBusy(false);
    }
  }

  const resultText = round?.status === "settled" && round.outcome ? `${round.outcome.toUpperCase()} won` : "Awaiting reveal";

  return (
    <aside className="tape-panel" aria-label="The Tape panel">
      <div className="trading-header">
        <div>
          <strong>The Tape</strong>
          <span>Live PumpSt-wide PvP, soft Credits only</span>
        </div>
        <span className={`tape-status ${round?.status ?? "idle"}`}>{round?.status ?? "idle"}</span>
      </div>

      <section className="tape-card tape-round-card">
        <div>
          <span className="label">Round</span>
          <strong>{round ? `#${round.round_number}` : "--"}</strong>
        </div>
        <div>
          <span className="label">Lock</span>
          <strong>{round?.status === "open" ? `${timeLeft}s` : "closed"}</strong>
        </div>
        <div>
          <span className="label">Pot</span>
          <strong>{formatCredits(round?.pot)}</strong>
        </div>
      </section>

      <section className="tape-sides">
        <div className={`tape-side up ${round?.outcome === "up" ? "winner" : ""}`}>
          <span>UP</span>
          <strong>{formatCredits(totals.up.credits)}</strong>
          <small>{totals.up.count} players</small>
        </div>
        <div className={`tape-side down ${round?.outcome === "down" ? "winner" : ""}`}>
          <span>DOWN</span>
          <strong>{formatCredits(totals.down.credits)}</strong>
          <small>{totals.down.count} players</small>
        </div>
      </section>

      <section className="tape-card">
        <div className="trade-form">
          <input
            min={1}
            step={1}
            type="number"
            value={stakeAmount}
            onChange={(event) => setStakeAmount(event.target.value)}
          />
          <button disabled={busy || !round || round.status !== "open" || Boolean(myStake)} onClick={joinTape}>
            {myStake ? `${myStake.side.toUpperCase()} ${formatCredits(myStake.stake)}` : "Stake From Pad"}
          </button>
        </div>
        <p className="microcopy">Stand on the green UP pad or red DOWN pad, then stake. Once locked, walking away does not pull the stake.</p>
      </section>

      <section className="tape-card">
        <div className="tape-proof-row">
          <span>Commit</span>
          <code>{round?.commit_hash ? `${round.commit_hash.slice(0, 12)}...` : "--"}</code>
        </div>
        <div className="tape-proof-row">
          <span>Entropy</span>
          <code>{round?.public_entropy ? `${round.public_entropy.slice(0, 12)}...` : "--"}</code>
        </div>
        <div className="tape-proof-row">
          <span>Seed</span>
          <code>{round?.server_seed ? `${round.server_seed.slice(0, 12)}...` : "hidden"}</code>
        </div>
        <div className="tape-result">{resultText}</div>
      </section>

      {message ? (
        <div className="trade-message" role="status">
          {message}
        </div>
      ) : null}

      <section className="tape-roster">
        {stakes.slice(0, 8).map((stake) => (
          <div key={stake.id}>
            <span>{stake.player?.name ?? "Player"}</span>
            <strong>{stake.side.toUpperCase()}</strong>
            <small>{formatCredits(stake.stake)}</small>
          </div>
        ))}
      </section>
    </aside>
  );
}
