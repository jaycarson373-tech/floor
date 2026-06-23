# PumpSt

Next.js + Supabase implementation of PumpSt: an isometric multiplayer trading game with soft Credits, ranked wallet gating, PvP duels, capital allocation, The Tape rounds, and dry-run-gated season payouts.

## Deploy To Vercel

Recommended flow:

1. Push this repo to GitHub.
2. In Vercel, choose **Add New Project** and import the GitHub repo.
3. Add the environment variables from `.env.example`.
4. Deploy.

Build command:

```bash
npm run build
```

Install command:

```bash
npm install
```

## Required Environment

Core:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

Ranked wallet gate:

```bash
HELIUS_RPC_URL=
GATE_THRESHOLD=
PUMP_GATE_MINT=
NEXT_PUBLIC_PUMP_GATE_MINT=
PUMPST_GATE_MINT=
NEXT_PUBLIC_PUMPST_GATE_MINT=
# Legacy fallback names are still supported during the rebrand.
GATE_MINT=
NEXT_PUBLIC_GATE_MINT=
```

Capital allocation:

```bash
PM_FEE_BPS=2000
```

Season payouts:

```bash
PAYOUT_ENABLED=false
CLAIM_ENABLED=false
MAX_SEASON_PAYOUT=
SEASON_LENGTH=604800
TREASURY_SECRET_KEY=
```

`PAYOUT_ENABLED` and `CLAIM_ENABLED` must remain `false` until dry-run verification is complete. There is no public RPC fallback; `HELIUS_RPC_URL` is required for server-side chain reads/sends.

## Supabase

Apply migrations in order from `supabase/migrations`.

The app expects:

- Players and server-authoritative movement.
- Soft Credits and server-generated price ticks.
- Ranked wallet verification.
- Duels, capital allocation, Tape rounds, and season payout audit tables.

Client writes are restricted by RLS; privileged mutations go through server routes with `SUPABASE_SERVICE_ROLE_KEY`.

## Cron Routes

All cron routes require `CRON_SECRET` through either `x-cron-secret` or `Authorization: Bearer ...`.

- `POST /api/tick`
- `POST /api/tape`
- `POST /api/deal`
- `POST /api/auction`
- `POST /api/season`

Keep payout routes in dry-run mode until the simulated distribution and ranked-only eligibility are verified.

## PumpSt Backend Remap

The PumpSt remap is additive: it creates city/property tables beside the existing game tables so existing data survives. The new backend model uses Operators, 100 Addresses, property Bids, commit-reveal Deals, Holdings, rent ledger entries, dry-run fee payout audits, heat/reputation state, and Helius scan watermarks.

`PAYOUT_ENABLED` must stay `false` for this phase. PumpSt fee payouts are audit-only dry runs in this PR; live send execution is deliberately not implemented here.
