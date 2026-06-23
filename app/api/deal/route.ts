import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const DEAL_MS = 60_000;

type DealAction = "open" | "reveal" | "settle" | "advance";

type DealBody = {
  action?: unknown;
  dealId?: unknown;
  addressId?: unknown;
  serverSeed?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function envFlag(name: string) {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").toLowerCase());
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function currentDealWindow(date = new Date()) {
  return Math.floor(date.getTime() / DEAL_MS);
}

function publicEntropy(windowNumber: number) {
  const windowStart = new Date(windowNumber * DEAL_MS).toISOString();
  return hash(`pumpst:deal:${windowNumber}:${windowStart}`);
}

async function getDealState() {
  const supabase = createSupabaseAdminClient();
  const { data: deal, error: dealError } = await supabase
    .from("deals")
    .select("id, address_id, status, commit_hash, server_seed, public_entropy, outcome_entry_id, pot, opened_at, revealed_at, settled_at")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dealError) throw new Error(dealError.message);

  const { data: entries, error: entriesError } = deal?.id
    ? await supabase
        .from("deal_entries")
        .select("id, deal_id, operator_id, amount, paid_out, pnl, created_at")
        .eq("deal_id", deal.id)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (entriesError) throw new Error(entriesError.message);

  return {
    cadence: "PumpSt Deals use a 60s commit-reveal window. Cron should call POST /api/deal action=advance at least once per minute.",
    deal: deal ? { ...deal, server_seed: deal.status === "open" ? null : deal.server_seed } : null,
    entries: entries ?? []
  };
}

async function openDeal(addressId?: string | null, idempotencyKey?: string) {
  const supabase = createSupabaseAdminClient();
  const windowNumber = currentDealWindow();
  const seed = randomBytes(32).toString("hex");
  const key = idempotencyKey ?? `deal-open-${windowNumber}`;
  const { data, error } = await supabase.rpc("open_deal", {
    p_address_id: addressId ?? null,
    p_server_seed: seed,
    p_public_entropy: publicEntropy(windowNumber),
    p_idempotency_key: key
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function revealDeal(dealId: string, serverSeed?: string) {
  const supabase = createSupabaseAdminClient();
  const seed = serverSeed ?? await readServerSeed(dealId);
  const { data, error } = await supabase.rpc("reveal_deal", {
    p_deal_id: dealId,
    p_server_seed: seed
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function readServerSeed(dealId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("deals")
    .select("server_seed")
    .eq("id", dealId)
    .single();

  if (error) throw new Error(error.message);
  if (!data?.server_seed) throw new Error("Deal seed unavailable.");
  return data.server_seed as string;
}

async function settleDeal(dealId: string, idempotencyKey: string) {
  if (envFlag("PAYOUT_ENABLED")) {
    return {
      error: "Live PumpSt payout execution is intentionally not implemented in this dry-run PR.",
      dryRunOnly: true
    };
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("settle_deal", {
    p_deal_id: dealId,
    p_idempotency_key: idempotencyKey,
    p_dry_run: true
  });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

async function advanceDeal() {
  const supabase = createSupabaseAdminClient();
  const { data: openDeals, error } = await supabase
    .from("deals")
    .select("id, status")
    .neq("status", "settled")
    .order("opened_at", { ascending: true });

  if (error) throw new Error(error.message);

  const settled = [];
  for (const deal of openDeals ?? []) {
    settled.push(await settleDeal(deal.id, `deal-settle-${deal.id}`));
  }

  return {
    opened: await openDeal(),
    settled
  };
}

export async function GET() {
  try {
    return NextResponse.json(await getDealState());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load PumpSt Deal." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret || suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized PumpSt Deal lifecycle request." }, { status: 401 });
  }

  let body: DealBody = {};
  try {
    body = (await request.json()) as DealBody;
  } catch {
    body = {};
  }

  const action: DealAction = body.action === "open" || body.action === "reveal" || body.action === "settle" ? body.action : "advance";

  try {
    if (action === "open") {
      const addressId = typeof body.addressId === "string" && isUuid(body.addressId) ? body.addressId : null;
      const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim().length >= 8 ? body.idempotencyKey : undefined;
      return NextResponse.json({ deal: await openDeal(addressId, idempotencyKey) });
    }

    if (typeof body.dealId !== "string" || !isUuid(body.dealId)) {
      return NextResponse.json({ error: "Invalid Deal id." }, { status: 400 });
    }

    if (action === "reveal") {
      const serverSeed = typeof body.serverSeed === "string" ? body.serverSeed : undefined;
      return NextResponse.json({ deal: await revealDeal(body.dealId, serverSeed) });
    }

    if (action === "settle") {
      if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 8) {
        return NextResponse.json({ error: "Invalid Deal settle idempotency key." }, { status: 400 });
      }

      return NextResponse.json({ deal: await settleDeal(body.dealId, body.idempotencyKey) });
    }

    return NextResponse.json({
      cadence: "Call once per 60s window. Repeated calls safely no-op for already opened or settled windows.",
      ...(await advanceDeal())
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PumpSt Deal lifecycle failed." }, { status: 400 });
  }
}
