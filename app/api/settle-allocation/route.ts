import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";

type SettlementBody = {
  allocationId?: unknown;
  withdraw?: unknown;
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

  let body: SettlementBody;
  try {
    body = (await request.json()) as SettlementBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.allocationId !== "string" ||
    !isUuid(body.allocationId) ||
    typeof body.withdraw !== "boolean" ||
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.length < 8 ||
    body.idempotencyKey.length > 120
  ) {
    return NextResponse.json({ error: "Invalid settlement payload." }, { status: 400 });
  }

  const feeBps = Number(process.env.PM_FEE_BPS ?? "2000");
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("settle_allocation", {
    p_actor_id: user.id,
    p_allocation_id: body.allocationId,
    p_withdraw: body.withdraw,
    p_pm_fee_bps: Number.isSafeInteger(feeBps) ? feeBps : 2000,
    p_idempotency_key: body.idempotencyKey
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ settlement: Array.isArray(data) ? data[0] : data });
}
