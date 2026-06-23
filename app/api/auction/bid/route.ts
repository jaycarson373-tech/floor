import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";

type BidBody = {
  addressId?: unknown;
  amount?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

export async function POST(request: Request) {
  const { userId, error: userError } = await getUser(request);

  if (!userId) {
    return NextResponse.json({ error: userError }, { status: 401 });
  }

  let body: BidBody;
  try {
    body = (await request.json()) as BidBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.addressId !== "string" ||
    !isUuid(body.addressId) ||
    typeof body.amount !== "number" ||
    !Number.isSafeInteger(body.amount) ||
    body.amount <= 0 ||
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.trim().length < 8 ||
    body.idempotencyKey.length > 120
  ) {
    return NextResponse.json({ error: "Invalid PumpSt bid payload." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("place_property_bid", {
    p_player_id: userId,
    p_address_id: body.addressId,
    p_amount: body.amount,
    p_idempotency_key: body.idempotencyKey
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ bid: Array.isArray(data) ? data[0] : data });
}
