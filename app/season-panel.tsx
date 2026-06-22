"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Season = {
  id: string;
  season_number: number;
  status: "open" | "closing" | "snapshotted" | "paid";
  pool_amount: number;
  started_at: string;
  ends_at: string;
};

type Standing = {
  id: string;
  wallet: string;
  rank: number;
  score: number;
};

type Payout = {
  id: string;
  wallet: string;
  amount: number;
  status: "pending" | "sent" | "failed" | "skipped";
  dry_run: boolean;
  tx_signature: string | null;
  checkpoint_id: string;
};

type FeeClaim = {
  id: string;
  claim_window: string;
  amount_claimed: number | null;
  status: "pending" | "claimed" | "failed" | "skipped";
  dry_run: boolean;
  tx_signature: string | null;
};

type SeasonState = {
  payoutEnabled: boolean;
  claimEnabled: boolean;
  maxSeasonPayout: number;
  payoutCurve: string;
  season: Season | null;
  standings: Standing[];
  payouts: Payout[];
  claims: FeeClaim[];
  error?: string;
};

function formatLamports(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return value.toLocaleString("en-US");
}

function shortAddress(value: string | null | undefined) {
  if (!value) return "--";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export default function SeasonPanel() {
  const [state, setState] = useState<SeasonState | null>(null);
  const [message, setMessage] = useState("");

  const loadSeason = useCallback(async () => {
    const response = await fetch("/api/season");
    const result = (await response.json()) as SeasonState;

    if (!response.ok) {
      setMessage(result.error ?? "Could not load season.");
      return;
    }

    setState(result);
    setMessage("");
  }, []);

  useEffect(() => {
    loadSeason();
    const timer = window.setInterval(loadSeason, 10000);
    return () => window.clearInterval(timer);
  }, [loadSeason]);

  const totalSimulated = useMemo(() => {
    return (state?.payouts ?? []).reduce((sum, payout) => sum + payout.amount, 0);
  }, [state?.payouts]);

  return (
    <aside className="season-panel" aria-label="Season payout dashboard">
      <div className="trading-header">
        <div>
          <strong>Season Desk</strong>
          <span>Rank pays from claimed creator fees only</span>
        </div>
        <span className={`season-gate ${state?.payoutEnabled ? "armed" : ""}`}>
          {state?.payoutEnabled ? "PAYOUT ARMED" : "DRY RUN"}
        </span>
      </div>

      <section className="season-card season-summary">
        <div>
          <span>Season</span>
          <strong>{state?.season ? `#${state.season.season_number}` : "--"}</strong>
        </div>
        <div>
          <span>Status</span>
          <strong>{state?.season?.status ?? "idle"}</strong>
        </div>
        <div>
          <span>Pool</span>
          <strong>{formatLamports(state?.season?.pool_amount)}</strong>
        </div>
        <div>
          <span>Cap</span>
          <strong>{formatLamports(state?.maxSeasonPayout)}</strong>
        </div>
      </section>

      <section className="season-card">
        <strong>Payout Curve</strong>
        <p className="microcopy">{state?.payoutCurve ?? "Top ranked wallets split a capped pool. Soft Credits are not redeemable."}</p>
      </section>

      <section className="season-card">
        <strong>Ranked Snapshot</strong>
        {(state?.standings ?? []).slice(0, 6).map((standing) => (
          <div className="season-row" key={standing.id}>
            <span>#{standing.rank}</span>
            <span>{shortAddress(standing.wallet)}</span>
            <strong>{formatLamports(standing.score)}</strong>
          </div>
        ))}
        {!state?.standings?.length ? <small>No sealed snapshot yet.</small> : null}
      </section>

      <section className="season-card">
        <strong>Payout Audit</strong>
        <small>{state?.payoutEnabled ? "Real sends require tx signatures." : "SIMULATED rows send nothing."}</small>
        {(state?.payouts ?? []).slice(0, 6).map((payout) => (
          <div className="season-row" key={payout.id}>
            <span>{shortAddress(payout.wallet)}</span>
            <span>{payout.dry_run ? "SIM" : payout.status}</span>
            <strong>{formatLamports(payout.amount)}</strong>
          </div>
        ))}
        <small>Total distribution: {formatLamports(totalSimulated)}</small>
      </section>

      <section className="season-card">
        <strong>Fee Claims</strong>
        <small>{state?.claimEnabled ? "Claim gate armed" : "Claim dry-run gate"}</small>
        {(state?.claims ?? []).slice(0, 4).map((claim) => (
          <div className="season-row" key={claim.id}>
            <span>{claim.claim_window}</span>
            <span>{claim.dry_run ? "SIM" : claim.status}</span>
            <strong>{formatLamports(claim.amount_claimed)}</strong>
          </div>
        ))}
      </section>

      {message ? (
        <div className="trade-message" role="status">
          {message}
        </div>
      ) : null}
    </aside>
  );
}
