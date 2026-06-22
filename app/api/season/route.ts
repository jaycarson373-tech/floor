import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const DEFAULT_SEASON_LENGTH_SECONDS = 7 * 24 * 60 * 60;
const PAYOUT_WEIGHTS = [40, 25, 15, 8, 5, 3, 2, 1, 1] as const;

type SeasonBody = {
  action?: unknown;
  seasonId?: unknown;
  claimWindow?: unknown;
  amountClaimed?: unknown;
  txSignature?: unknown;
  checkpointId?: unknown;
  batchSize?: unknown;
};

type SeasonRow = {
  id: string;
  season_number: number;
  status: "open" | "closing" | "snapshotted" | "paid";
  pool_amount: number;
};

type StandingRow = {
  wallet: string;
  rank: number;
  score: number;
};

type PayoutRow = {
  id: string;
  wallet: string;
  amount: number;
  status: "pending" | "sent" | "failed" | "skipped";
  dry_run: boolean;
  tx_signature: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function envFlag(name: string) {
  return process.env[name] === "true";
}

function seasonLengthSeconds() {
  const parsed = Number(process.env.SEASON_LENGTH ?? DEFAULT_SEASON_LENGTH_SECONDS);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SEASON_LENGTH_SECONDS;
}

function currentSeasonNumber(date = new Date()) {
  return Math.floor(date.getTime() / (seasonLengthSeconds() * 1000));
}

function maxSeasonPayout() {
  const parsed = Number(process.env.MAX_SEASON_PAYOUT ?? "0");
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseTreasury() {
  const secret = process.env.TREASURY_SECRET_KEY;
  if (!secret) throw new Error("Missing TREASURY_SECRET_KEY.");

  try {
    const parsed = JSON.parse(secret) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  } catch {
    return Keypair.fromSecretKey(bs58.decode(secret));
  }
}

function heliusConnection() {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) throw new Error("Missing HELIUS_RPC_URL.");
  return new Connection(rpcUrl, "confirmed");
}

function payoutCurve(poolAmount: number, standings: StandingRow[]) {
  const eligible = standings
    .filter((standing) => standing.wallet && standing.rank <= PAYOUT_WEIGHTS.length)
    .sort((a, b) => a.rank - b.rank);
  const weightSum = PAYOUT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;

  return eligible.map((standing, index) => {
    const isLast = index === eligible.length - 1;
    const amount = isLast ? Math.max(0, poolAmount - allocated) : Math.floor((poolAmount * PAYOUT_WEIGHTS[index]) / weightSum);
    allocated += amount;
    return {
      wallet: standing.wallet,
      amount,
      rank: standing.rank,
      score: standing.score
    };
  });
}

async function latestSeason() {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.from("seasons").select("*").order("season_number", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data as SeasonRow | null;
}

async function getSeasonState() {
  const supabase = createSupabaseAdminClient();
  const season = await latestSeason();

  const [{ data: standings }, { data: payouts }, { data: claims }] = await Promise.all([
    season
      ? supabase.from("season_standings").select("*").eq("season_id", season.id).order("rank", { ascending: true })
      : { data: [] },
    season
      ? supabase.from("season_payouts").select("*").eq("season_id", season.id).order("created_at", { ascending: false })
      : { data: [] },
    supabase.from("fee_claims").select("*").order("created_at", { ascending: false }).limit(20)
  ]);

  return {
    payoutEnabled: envFlag("PAYOUT_ENABLED"),
    claimEnabled: envFlag("CLAIM_ENABLED"),
    maxSeasonPayout: maxSeasonPayout(),
    payoutCurve: "Top 9 ranked wallets split the capped pool by weights 40/25/15/8/5/3/2/1/1.",
    season,
    standings: standings ?? [],
    payouts: payouts ?? [],
    claims: claims ?? []
  };
}

async function openSeason() {
  const supabase = createSupabaseAdminClient();
  const lengthMs = seasonLengthSeconds() * 1000;
  const seasonNumber = currentSeasonNumber();
  const startedAt = new Date(seasonNumber * lengthMs).toISOString();
  const endsAt = new Date((seasonNumber + 1) * lengthMs).toISOString();
  const { data, error } = await supabase.rpc("open_season", {
    p_season_number: seasonNumber,
    p_started_at: startedAt,
    p_ends_at: endsAt
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function resolveSeasonId(seasonId: unknown) {
  if (typeof seasonId === "string" && isUuid(seasonId)) return seasonId;
  const season = await latestSeason();
  if (!season) throw new Error("No season exists.");
  return season.id;
}

async function snapshotSeason(seasonId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("snapshot_season", {
    p_season_id: seasonId
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function recordClaim(body: SeasonBody) {
  const claimEnabled = envFlag("CLAIM_ENABLED");
  const seasonId = await resolveSeasonId(body.seasonId);
  const claimWindow =
    typeof body.claimWindow === "string" && body.claimWindow.trim().length >= 4
      ? body.claimWindow.trim()
      : `season-${seasonId}-${new Date().toISOString().slice(0, 10)}`;
  const amountClaimed =
    typeof body.amountClaimed === "number" && Number.isSafeInteger(body.amountClaimed) && body.amountClaimed > 0 ? body.amountClaimed : 0;
  const txSignature = typeof body.txSignature === "string" && body.txSignature.length >= 32 ? body.txSignature : null;

  if (claimEnabled && (!amountClaimed || !txSignature)) {
    throw new Error("Armed claims require amountClaimed and txSignature proof from the creator-fee claim transaction.");
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("record_fee_claim", {
    p_claim_window: claimWindow,
    p_season_id: seasonId,
    p_amount_claimed: amountClaimed,
    p_status: claimEnabled ? "claimed" : "skipped",
    p_tx_signature: txSignature,
    p_dry_run: !claimEnabled
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function ensurePayoutRows(season: SeasonRow, checkpointId: string, dryRun: boolean) {
  const supabase = createSupabaseAdminClient();
  const { data: standings, error: standingError } = await supabase
    .from("season_standings")
    .select("wallet, rank, score")
    .eq("season_id", season.id)
    .order("rank", { ascending: true });

  if (standingError) throw new Error(standingError.message);

  const cap = maxSeasonPayout();
  if (cap <= 0) throw new Error("MAX_SEASON_PAYOUT must be set before payout computation.");

  const payoutPool = Math.min(season.pool_amount, cap);
  const distribution = payoutCurve(payoutPool, (standings ?? []) as StandingRow[]);
  const total = distribution.reduce((sum, payout) => sum + payout.amount, 0);

  if (total > season.pool_amount || total > cap) {
    throw new Error("Payout cap or pool coverage guard rejected distribution.");
  }

  if (!distribution.length) return { distribution, total };

  const { data: existingRows, error: existingError } = await supabase
    .from("season_payouts")
    .select("id, wallet, status, tx_signature")
    .eq("season_id", season.id);

  if (existingError) throw new Error(existingError.message);

  const existingByWallet = new Map((existingRows ?? []).map((row) => [row.wallet, row]));

  for (const payout of distribution) {
    const existing = existingByWallet.get(payout.wallet);

    if (existing?.status === "sent" || existing?.tx_signature) {
      continue;
    }

    const row = {
      season_id: season.id,
      wallet: payout.wallet,
      amount: payout.amount,
      status: dryRun ? "skipped" : "pending",
      dry_run: dryRun,
      checkpoint_id: checkpointId
    };

    const { error } = existing
      ? await supabase.from("season_payouts").update(row).eq("id", existing.id)
      : await supabase.from("season_payouts").insert(row);

    if (error) throw new Error(error.message);
  }

  return { distribution, total };
}

async function markPayout(id: string, patch: Partial<PayoutRow> & { error?: string; sent_at?: string }) {
  const supabase = createSupabaseAdminClient();
  const { error } = await supabase.from("season_payouts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

async function sendPayouts(seasonId: string, batchSize: number) {
  const supabase = createSupabaseAdminClient();
  const { data: rows, error } = await supabase
    .from("season_payouts")
    .select("id, wallet, amount, status, dry_run, tx_signature")
    .eq("season_id", seasonId)
    .eq("status", "pending")
    .eq("dry_run", false)
    .is("tx_signature", null)
    .gt("amount", 0)
    .limit(batchSize);

  if (error) throw new Error(error.message);

  const pending = (rows ?? []) as PayoutRow[];
  if (!pending.length) return [];

  const connection = heliusConnection();
  const treasury = parseTreasury();
  const balance = await connection.getBalance(treasury.publicKey, "confirmed");
  const needed = pending.reduce((sum, row) => sum + row.amount, 0);

  if (needed > balance) {
    throw new Error("Treasury balance is below this payout checkpoint.");
  }

  const sent = [];
  for (const payout of pending) {
    try {
      const destination = new PublicKey(payout.wallet);
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: treasury.publicKey,
          toPubkey: destination,
          lamports: payout.amount
        })
      );
      const signature = await sendAndConfirmTransaction(connection, transaction, [treasury], {
        commitment: "confirmed",
        maxRetries: 3
      });
      await markPayout(payout.id, {
        status: "sent",
        tx_signature: signature,
        sent_at: new Date().toISOString()
      });
      sent.push({ wallet: payout.wallet, amount: payout.amount, signature });
    } catch (error) {
      await markPayout(payout.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Payout send failed."
      });
    }
  }

  return sent;
}

async function payoutSeason(body: SeasonBody) {
  const payoutEnabled = envFlag("PAYOUT_ENABLED");
  const batchSize = typeof body.batchSize === "number" && Number.isSafeInteger(body.batchSize) ? Math.max(1, Math.min(10, body.batchSize)) : 5;
  const checkpointId =
    typeof body.checkpointId === "string" && body.checkpointId.trim().length >= 4
      ? body.checkpointId.trim()
      : `checkpoint-${new Date().toISOString()}`;
  const seasonId = await resolveSeasonId(body.seasonId);
  const supabase = createSupabaseAdminClient();
  const { data: season, error } = await supabase.from("seasons").select("*").eq("id", seasonId).maybeSingle();

  if (error) throw new Error(error.message);
  if (!season) throw new Error("Season not found.");
  if (season.status === "open" || season.status === "closing") {
    await snapshotSeason(seasonId);
  }

  const { data: refreshed, error: refreshError } = await supabase.from("seasons").select("*").eq("id", seasonId).maybeSingle();
  if (refreshError) throw new Error(refreshError.message);
  const seasonForPayout = (refreshed ?? season) as SeasonRow;
  const prepared = await ensurePayoutRows(seasonForPayout, checkpointId, !payoutEnabled);

  if (!payoutEnabled) {
    return {
      dryRun: true,
      checkpointId,
      total: prepared.total,
      distribution: prepared.distribution,
      sent: []
    };
  }

  const sent = await sendPayouts(seasonId, batchSize);
  const { count } = await supabase
    .from("season_payouts")
    .select("id", { count: "exact", head: true })
    .eq("season_id", seasonId)
    .eq("status", "pending");

  if (!count) {
    await supabase.from("seasons").update({ status: "paid" }).eq("id", seasonId);
  }

  return {
    dryRun: false,
    checkpointId,
    total: prepared.total,
    distribution: prepared.distribution,
    sent
  };
}

export async function GET() {
  try {
    return NextResponse.json(await getSeasonState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load season state." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret || suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized season request." }, { status: 401 });
  }

  let body: SeasonBody;
  try {
    body = (await request.json()) as SeasonBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (body.action === "open") return NextResponse.json({ season: await openSeason() });
    if (body.action === "snapshot") return NextResponse.json({ snapshot: await snapshotSeason(await resolveSeasonId(body.seasonId)) });
    if (body.action === "claim") return NextResponse.json({ claim: await recordClaim(body) });
    if (body.action === "payout") return NextResponse.json({ payout: await payoutSeason(body) });
    return NextResponse.json({ error: "Unknown season action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Season action failed." }, { status: 400 });
  }
}
