import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";

type AllocateBody = {
  pmId?: unknown;
  amount?: unknown;
  idempotencyKey?: unknown;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function getUserId(request: Request) {
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

export async function GET(request: Request) {
  const { userId, error: userError } = await getUserId(request);
  if (!userId) return NextResponse.json({ error: userError }, { status: 401 });

  const supabase = createSupabaseAdminClient();
  const [pmDirectory, allocations, books] = await Promise.all([
    supabase.from("pm_directory").select("*").limit(30),
    supabase
      .from("allocations")
      .select("*")
      .or(`allocator_id.eq.${userId},pm_id.eq.${userId}`)
      .order("created_at", { ascending: false }),
    supabase.from("managed_books").select("*").eq("pm_id", userId).maybeSingle()
  ]);

  const firstError = [pmDirectory.error, allocations.error, books.error].find(Boolean);
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });

  const allowedBookIds = Array.from(
    new Set([
      ...((allocations.data ?? []) as Array<{ book_id: string }>).map((allocation) => allocation.book_id),
      ...(books.data?.id ? [books.data.id] : [])
    ])
  );

  const [positions, orders] = allowedBookIds.length
    ? await Promise.all([
        supabase.from("managed_positions").select("*, assets(symbol, name)").in("book_id", allowedBookIds).limit(40),
        supabase
          .from("managed_orders")
          .select("*, assets(symbol, name)")
          .in("book_id", allowedBookIds)
          .order("created_at", { ascending: false })
          .limit(12)
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  const ledgerError = [positions.error, orders.error].find(Boolean);
  if (ledgerError) return NextResponse.json({ error: ledgerError.message }, { status: 400 });

  return NextResponse.json({
    pmDirectory: pmDirectory.data ?? [],
    allocations: allocations.data ?? [],
    book: books.data ?? null,
    managedPositions: positions.data ?? [],
    managedOrders: orders.data ?? []
  });
}

export async function POST(request: Request) {
  const { userId, error: userError } = await getUserId(request);
  if (!userId) return NextResponse.json({ error: userError }, { status: 401 });

  let body: AllocateBody;
  try {
    body = (await request.json()) as AllocateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.pmId !== "string" ||
    !isUuid(body.pmId) ||
    typeof body.amount !== "number" ||
    !Number.isSafeInteger(body.amount) ||
    body.amount <= 0 ||
    typeof body.idempotencyKey !== "string" ||
    body.idempotencyKey.length < 8 ||
    body.idempotencyKey.length > 120
  ) {
    return NextResponse.json({ error: "Invalid allocation payload." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("allocate_capital", {
    p_allocator_id: userId,
    p_pm_id: body.pmId,
    p_amount: body.amount,
    p_idempotency_key: body.idempotencyKey
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ allocation: Array.isArray(data) ? data[0] : data });
}
