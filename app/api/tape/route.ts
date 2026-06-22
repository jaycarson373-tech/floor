import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const ROUND_MS = 60_000;

type TapeAction = "open" | "reveal" | "settle" | "advance";

type TapeBody = {
  action?: unknown;
  roundId?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function currentRoundNumber(date = new Date()) {
  return Math.floor(date.getTime() / ROUND_MS);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function publicEntropy(roundNumber: number) {
  const windowStart = new Date(roundNumber * ROUND_MS).toISOString();
  return hash(`the-floor:tape:${roundNumber}:${windowStart}`);
}

function sanitizeRound(round: Record<string, unknown> | null) {
  if (!round) return null;
  const status = round.status;

  return {
    ...round,
    server_seed: status === "revealing" || status === "settled" ? round.server_seed : null
  };
}

async function getTapeState() {
  const supabase = createSupabaseAdminClient();
  const { data: round, error: roundError } = await supabase
    .from("tape_rounds")
    .select("id, round_number, status, commit_hash, server_seed, public_entropy, outcome, pot, opened_at, locked_at, settled_at")
    .order("round_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (roundError) throw new Error(roundError.message);

  const roundId = round?.id;
  const { data: stakes, error: stakesError } = roundId
    ? await supabase
        .from("tape_stakes")
        .select("id, round_id, player_id, side, stake, ranked, paid_out, pnl, created_at")
        .eq("round_id", roundId)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (stakesError) throw new Error(stakesError.message);

  const playerIds = Array.from(new Set((stakes ?? []).map((stake) => stake.player_id)));
  const { data: players, error: playerError } = playerIds.length
    ? await supabase.from("players").select("id, name, ranked, gx, gy").in("id", playerIds)
    : { data: [], error: null };

  if (playerError) throw new Error(playerError.message);

  const playerMap = new Map((players ?? []).map((player) => [player.id, player]));
  const enrichedStakes = (stakes ?? []).map((stake) => ({
    ...stake,
    player: playerMap.get(stake.player_id) ?? null
  }));

  return {
    cadence: "Tape rounds use a 60s window. Cron should call POST /api/tape with action=advance at least once per minute.",
    round: sanitizeRound(round),
    stakes: enrichedStakes
  };
}

async function openRound(roundNumber = currentRoundNumber()) {
  const supabase = createSupabaseAdminClient();
  const seed = randomBytes(32).toString("hex");
  const { data, error } = await supabase.rpc("open_tape_round", {
    p_round_number: roundNumber,
    p_server_seed: seed,
    p_commit_hash: hash(seed),
    p_public_entropy: publicEntropy(roundNumber)
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function settleRound(roundId: string, idempotencyKey: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("settle_tape_round", {
    p_round_id: roundId,
    p_idempotency_key: idempotencyKey
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function revealRound(roundId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("reveal_tape_round", {
    p_round_id: roundId
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function advanceTape() {
  const supabase = createSupabaseAdminClient();
  const roundNumber = currentRoundNumber();
  const { data: openRounds, error } = await supabase
    .from("tape_rounds")
    .select("id, round_number, status")
    .lt("round_number", roundNumber)
    .neq("status", "settled")
    .order("round_number", { ascending: true });

  if (error) throw new Error(error.message);

  const settled = [];
  for (const round of openRounds ?? []) {
    settled.push(await settleRound(round.id, `tape-settle-${round.id}`));
  }

  const opened = await openRound(roundNumber);
  return { opened, settled };
}

export async function GET() {
  try {
    return NextResponse.json(await getTapeState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load Tape." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret || suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized Tape lifecycle request." }, { status: 401 });
  }

  let body: TapeBody = {};
  try {
    body = (await request.json()) as TapeBody;
  } catch {
    body = {};
  }

  const action: TapeAction = body.action === "open" || body.action === "reveal" || body.action === "settle" ? body.action : "advance";

  try {
    if (action === "open") {
      const round = await openRound();
      return NextResponse.json({ round });
    }

    if (action === "reveal") {
      if (typeof body.roundId !== "string" || !isUuid(body.roundId)) {
        return NextResponse.json({ error: "Invalid Tape round id." }, { status: 400 });
      }

      return NextResponse.json({ round: await revealRound(body.roundId) });
    }

    if (action === "settle") {
      if (
        typeof body.roundId !== "string" ||
        !isUuid(body.roundId) ||
        typeof body.idempotencyKey !== "string" ||
        body.idempotencyKey.trim().length < 8
      ) {
        return NextResponse.json({ error: "Invalid Tape settle payload." }, { status: 400 });
      }

      return NextResponse.json({ round: await settleRound(body.roundId, body.idempotencyKey) });
    }

    return NextResponse.json({
      cadence: "Call once per 60s window. Repeated calls safely no-op for already opened or settled windows.",
      ...(await advanceTape())
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Tape lifecycle failed." }, { status: 400 });
  }
}
