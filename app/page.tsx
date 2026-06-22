"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const CA = "Aej6H5m5dmkJFmvDMGexVp6nkb5dBuvFVpFEimgopump";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Join The Floor",
    body: "Connect and drop into the isometric trading floor. Pick your spot and start moving.",
  },
  {
    step: "02",
    title: "Trade The Tape",
    body: "Step onto an UP or DOWN pad to call the next move. Win the tape, earn your rank.",
  },
  {
    step: "03",
    title: "Climb The Hierarchy",
    body: "Challenge other traders in ranked duels. Build capital, rise through the floor, reach the Boss Office.",
  },
];

const STATS = [
  { value: "—", label: "traders online" },
  { value: "SOL", label: "chain" },
  { value: "LIVE", label: "season 1" },
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
          <a href="#contract">CA</a>
          <a href="#docs">Docs</a>
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

      {/* ── CA Section ───────────────────────────────────────── */}
      <section id="contract" className="lp-ca-section" aria-labelledby="ca-heading">
        <div className="lp-section-inner lp-ca-section-inner">
          <h2 id="ca-heading" className="lp-section-title">Contract Address</h2>
          <p className="lp-ca-section-sub">
            The Floor token is live on Solana. Copy the contract address below.
          </p>
          <button className="lp-ca-block" onClick={copyCA} aria-label="Copy contract address">
            <span className="lp-ca-block-label">CA</span>
            <span className="lp-ca-block-addr">{CA}</span>
            <span className="lp-ca-block-copy" aria-live="polite">
              {copied ? (
                <span className="lp-ca-copied">Copied!</span>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </span>
          </button>
          <p className="lp-ca-note">
            Always verify the CA via{" "}
            <a href="https://x.com/thefloorsolana" target="_blank" rel="noopener noreferrer">@thefloorsolana</a>{" "}
            before buying.
          </p>
        </div>
      </section>

      {/* ── Docs Section ─────────────────────────────────────── */}
      <section id="docs" className="lp-docs" aria-labelledby="docs-heading">
        <div className="lp-section-inner">
          <h2 id="docs-heading" className="lp-section-title">Documentation</h2>
          <p className="lp-docs-sub">
            Everything you need to understand The Floor — mechanics, token, seasons, and the path to the Boss Office.
          </p>
          <div className="lp-docs-grid">
            {[
              { title: "Getting Started",   desc: "How to join the floor, move your trader, and make your first tape call." },
              { title: "The Tape",          desc: "How UP and DOWN pads work, payout mechanics, and streak bonuses." },
              { title: "Ranked Duels",      desc: "Challenge other traders, stake capital, and climb the hierarchy." },
              { title: "Seasons",           desc: "Season structure, resets, leaderboard rewards, and Boss Office access." },
              { title: "Tokenomics",        desc: "Supply, fee distribution, creator fee claims, and treasury mechanics." },
              { title: "Roadmap",           desc: "Upcoming floors, features, and the long-term vision for the ecosystem." },
            ].map((doc) => (
              <div key={doc.title} className="lp-doc-card">
                <div className="lp-doc-card-inner">
                  <h3 className="lp-doc-title">{doc.title}</h3>
                  <p className="lp-doc-desc">{doc.desc}</p>
                  <span className="lp-doc-coming">Coming Soon</span>
                </div>
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
