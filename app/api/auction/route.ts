import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type AuctionBody = {
  action?: unknown;
  addressId?: unknown;
  auctionDate?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function envFlag(name: string) {
  return ["1", "true", "yes", "on"].includes((process.env[name] ?? "").toLowerCase());
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("addresses")
      .select("id, address_number, label, district, base_rent, heat, owner_operator_id, auction_date, auction_status")
      .order("address_number", { ascending: true });

    if (error) throw new Error(error.message);
    return NextResponse.json({ addresses: data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load PumpSt addresses." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret || suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized PumpSt auction lifecycle request." }, { status: 401 });
  }

  if (envFlag("PAYOUT_ENABLED")) {
    return NextResponse.json({
      error: "Live PumpSt payout execution is intentionally not implemented in this dry-run PR.",
      dryRunOnly: true
    }, { status: 501 });
  }

  let body: AuctionBody = {};
  try {
    body = (await request.json()) as AuctionBody;
  } catch {
    body = {};
  }

  const action = body.action === "close" ? "close" : "open";

  try {
    const supabase = createSupabaseAdminClient();

    if (action === "open") {
      const auctionDate = typeof body.auctionDate === "string" ? body.auctionDate : today();
      const { error } = await supabase
        .from("addresses")
        .update({ auction_status: "open", auction_date: auctionDate })
        .neq("auction_status", "open");

      if (error) throw new Error(error.message);
      return NextResponse.json({ status: "open", auctionDate });
    }

    if (typeof body.addressId !== "string" || !isUuid(body.addressId)) {
      return NextResponse.json({ error: "Invalid address id." }, { status: 400 });
    }

    if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 8) {
      return NextResponse.json({ error: "Invalid auction idempotency key." }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("close_address_auction", {
      p_address_id: body.addressId,
      p_auction_date: typeof body.auctionDate === "string" ? body.auctionDate : today(),
      p_idempotency_key: body.idempotencyKey,
      p_dry_run: true
    });

    if (error) throw new Error(error.message);
    return NextResponse.json({ auction: Array.isArray(data) ? data[0] : data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "PumpSt auction lifecycle failed." }, { status: 400 });
  }
}
