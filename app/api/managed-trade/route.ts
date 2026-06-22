import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";

type ManagedTradeBody = {
  assetId?: unknown;
  side?: unknown;
  qty?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;
  if (!accessToken) return NextResponse.json({ error: "Missing Supabase session." }, { status: 401 });

  const userSupabase = createSupabaseUserClient(accessToken);
  const {
    data: { user },
    error: userError
  } = await userSupabase.auth.getUser(accessToken);
  if (userError || !user) return NextResponse.json({ error: "Invalid Supabase session." }, { status: 401 });

  let body: ManagedTradeBody;
  try {
    body = (await request.json()) as ManagedTradeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.assetId !== "string" ||
    !isUuid(body.assetId) ||
    (body.side !== "buy" && body.side !== "sell") ||
    typeof body.qty !== "number" ||
    !Number.isSafeInteger(body.qty) ||
    body.qty <= 0 ||
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.length < 8 ||
    body.idempotencyKey.length > 120
  ) {
    return NextResponse.json({ error: "Invalid managed trade payload." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("execute_managed_trade", {
    p_pm_id: user.id,
    p_asset_id: body.assetId,
    p_side: body.side,
    p_qty: body.qty,
    p_idempotency_key: body.idempotencyKey
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ fill: Array.isArray(data) ? data[0] : data });
}
