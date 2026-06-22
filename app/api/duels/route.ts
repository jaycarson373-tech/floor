import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";

type DuelPostBody = {
  action?: unknown;
  assetId?: unknown;
  stake?: unknown;
  side?: unknown;
  duelId?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function makeCommit(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

async function getUser(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!accessToken) return { userId: null, error: "Missing Supabase session." };

  const userSupabase = createSupabaseUserClient(accessToken);
  const {
    data: { user },
    error
  } = await userSupabase.auth.getUser(accessToken);

  if (error || !user) return { userId: null, error: "Invalid Supabase session." };
  return { userId: user.id, error: null };
}

async function listDuels() {
  const supabase = createSupabaseAdminClient();
  const { data: duels, error } = await supabase
    .from("duels")
    .select("id, asset_id, stake, player_a, player_b, player_a_side, player_b_side, status, ranked, commit_hash, winner, player_a_pnl, player_b_pnl, start_price, end_price, seed, started_at, settled_at, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw new Error(error.message);

  const playerIds = Array.from(new Set((duels ?? []).flatMap((duel) => [duel.player_a, duel.player_b]).filter(Boolean)));
  const assetIds = Array.from(new Set((duels ?? []).map((duel) => duel.asset_id)));
  const [{ data: players }, { data: assets }] = await Promise.all([
    playerIds.length ? supabase.from("players").select("id, name, ranked, wallet_address").in("id", playerIds) : { data: [] },
    assetIds.length ? supabase.from("assets").select("id, symbol, name").in("id", assetIds) : { data: [] }
  ]);

  const playerMap = new Map((players ?? []).map((player) => [player.id, player]));
  const assetMap = new Map((assets ?? []).map((asset) => [asset.id, asset]));

  return (duels ?? []).map((duel) => ({
    ...duel,
    seed: duel.status === "settled" ? duel.seed : null,
    playerA: playerMap.get(duel.player_a) ?? null,
    playerB: duel.player_b ? (playerMap.get(duel.player_b) ?? null) : null,
    asset: assetMap.get(duel.asset_id) ?? null
  }));
}

export async function GET() {
  try {
    const duels = await listDuels();
    return NextResponse.json({ duels });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load duels." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const { userId, error: userError } = await getUser(request);

  if (!userId) {
    return NextResponse.json({ error: userError }, { status: 401 });
  }

  let body: DuelPostBody;
  try {
    body = (await request.json()) as DuelPostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 120) {
    return NextResponse.json({ error: "Invalid idempotency key." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  if (body.action === "create") {
    if (
      typeof body.assetId !== "string" ||
      !isUuid(body.assetId) ||
      typeof body.stake !== "number" ||
      !Number.isSafeInteger(body.stake) ||
      body.stake <= 0 ||
      (body.side !== "long" && body.side !== "short")
    ) {
      return NextResponse.json({ error: "Invalid create duel payload." }, { status: 400 });
    }

    const seed = randomBytes(32).toString("hex");
    const commitHash = makeCommit(seed);
    const { data, error } = await supabase.rpc("create_duel", {
      p_player_id: userId,
      p_asset_id: body.assetId,
      p_stake: body.stake,
      p_side: body.side,
      p_seed: seed,
      p_commit_hash: commitHash,
      p_idempotency_key: body.idempotencyKey
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ duel: Array.isArray(data) ? data[0] : data });
  }

  if (body.action === "accept") {
    if (typeof body.duelId !== "string" || !isUuid(body.duelId) || (body.side !== "long" && body.side !== "short")) {
      return NextResponse.json({ error: "Invalid accept duel payload." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("accept_duel", {
      p_player_id: userId,
      p_duel_id: body.duelId,
      p_side: body.side,
      p_idempotency_key: body.idempotencyKey
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ duel: Array.isArray(data) ? data[0] : data });
  }

  if (body.action === "settle") {
    if (typeof body.duelId !== "string" || !isUuid(body.duelId)) {
      return NextResponse.json({ error: "Invalid settle duel payload." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("settle_duel", {
      p_duel_id: body.duelId,
      p_idempotency_key: body.idempotencyKey
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ duel: Array.isArray(data) ? data[0] : data });
  }

  return NextResponse.json({ error: "Unknown duel action." }, { status: 400 });
}
