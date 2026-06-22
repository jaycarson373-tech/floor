"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const CA = "5bWpvvKw6Bssfa2Ti7j39pqEijWKqMCECVcwfhmrpump";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Join The Floor",
    body: "Connect and drop into the isometric trading floor. Pick your spot and start moving.",
  },
  {
    step: "02",
    title: "Trade The Tape",
    body: "Step onto an UP or DOWN pad to call the next move. Win the tape, earn rank, and chase the $FLOOR reward pool.",
  },
  {
    step: "03",
    title: "Climb The Hierarchy",
    body: "Challenge other traders in ranked duels. Build capital, rise through the floor, reach the Boss Office.",
  },
];

const STATS = [
  { value: "0", label: "$FLOOR won" },
  { value: "0", label: "$FLOOR burned" },
  { value: "LIVE", label: "season 1" },
];

const REWARD_COUNTERS = [
  {
    label: "Total $FLOOR Won",
    value: "0",
    detail: "Ranked season rewards"
  },
  {
    label: "Bought Back + Burned",
    value: "0",
    detail: "Burn counter"
  },
  {
    label: "Reward Engine",
    value: "Season 1",
    detail: "Ranked rewards counter"
  }
];

export default function LandingPage() {
  const [copied, setCopied] = useState(false);

  function copyCA() {
    navigator.clipboard.writeText(CA).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="lp-root">
      {/* ── Nav ───────────────────────────────────────────────── */}
      <header className="lp-nav">
        <span className="lp-logo">THE FLOOR</span>
        <nav className="lp-nav-links" aria-label="Primary">
          <a href="#how-it-works">How It Works</a>
          <a href="#rewards">Rewards</a>
          <a
            href="https://x.com/thefloorsolana"
            target="_blank"
            rel="noopener noreferrer"
            className="lp-nav-x"
            aria-label="Follow on X"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </nav>
        <Link href="/game" className="lp-nav-cta">Enter The Floor</Link>
      </header>

      {/* ── Hero ──────────────────────────────────────────────── */}
      <section className="lp-hero" aria-label="Hero">
        <Image
          src="/banner.png"
          alt="The Floor — isometric trading city"
          fill
          priority
          className="lp-hero-bg"
          sizes="100vw"
        />
        <div className="lp-hero-overlay" aria-hidden="true" />

        <div className="lp-hero-content">
          <p className="lp-hero-eyebrow">Solana Trading MMO</p>
          <h1 className="lp-hero-title">THE FLOOR</h1>
          <p className="lp-hero-sub">
            An isometric trading floor where every step is a position.<br />
            Pick a side. Make your move.
          </p>

          <div className="lp-hero-actions">
            <Link href="/game" className="lp-btn-primary">Enter The Floor</Link>
            <a
              href="https://x.com/thefloorsolana"
              target="_blank"
              rel="noopener noreferrer"
              className="lp-btn-ghost"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              @thefloorsolana
            </a>
          </div>

          {/* Stats row */}
          <div className="lp-stats">
            {STATS.map((s) => (
              <div key={s.label} className="lp-stat">
                <span className="lp-stat-val">{s.value}</span>
                <span className="lp-stat-lbl">{s.label}</span>
              </div>
            ))}
          </div>

          {/* CA */}
          <button className="lp-ca" onClick={copyCA} aria-label="Copy contract address">
            <span className="lp-ca-label">CA</span>
            <span className="lp-ca-addr">{CA}</span>
            <span className="lp-ca-copy" aria-live="polite">
              {copied ? "Copied!" : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </span>
          </button>
        </div>
      </section>

      {/* ── Rewards / Burn Loop ───────────────────────────────── */}
      <section id="rewards" className="lp-rewards" aria-labelledby="rewards-heading">
        <div className="lp-section-inner">
          <div className="lp-rewards-head">
            <span className="lp-rewards-kicker">$FLOOR Loop</span>
            <h2 id="rewards-heading" className="lp-section-title">Win $FLOOR. Burn $FLOOR.</h2>
            <p>
              Ranked seasons are designed around public counters for $FLOOR won by players
              and $FLOOR bought back + burned by The Floor. Counters start at launch.
            </p>
          </div>
          <div className="lp-reward-grid">
            {REWARD_COUNTERS.map((counter) => (
              <div key={counter.label} className="lp-reward-card">
                <span>{counter.label}</span>
                <strong>{counter.value}</strong>
                <small>{counter.detail}</small>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How It Works ─────────────────────────────────────── */}
      <section id="how-it-works" className="lp-how" aria-labelledby="how-heading">
        <div className="lp-section-inner">
          <h2 id="how-heading" className="lp-section-title">How It Works</h2>
          <div className="lp-steps">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="lp-step">
                <span className="lp-step-num">{item.step}</span>
                <h3 className="lp-step-title">{item.title}</h3>
                <p className="lp-step-body">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer className="lp-footer">
        <span>The Floor — built on Solana. Follow us on{" "}
          <a href="https://x.com/thefloorsolana" target="_blank" rel="noopener noreferrer">X</a>.
        </span>
      </footer>
    </div>
  );
}
