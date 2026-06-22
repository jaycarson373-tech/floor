import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const TICK_MS = 60_000;

function tickWindow(date = new Date()) {
  return new Date(Math.floor(date.getTime() / TICK_MS) * TICK_MS).toISOString();
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const suppliedSecret = request.headers.get("x-cron-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  if (!cronSecret || suppliedSecret !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized tick." }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  const windowStart = tickWindow();
  const { data, error } = await supabase.rpc("advance_market_tick", {
    p_tick_window: windowStart
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    cadence: "Call once per 60s window. Repeated calls in the same window are idempotent.",
    tickWindow: windowStart,
    ticks: data ?? []
  });
}
