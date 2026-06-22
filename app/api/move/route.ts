import { NextResponse } from "next/server";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";
import { type Facing, isWalkable } from "@/shared/floor-map";

const FACINGS = new Set<Facing>(["north", "south", "east", "west"]);

type MoveBody = {
  playerId?: unknown;
  gx?: unknown;
  gy?: unknown;
  facing?: unknown;
};

function currentPosition(player: { gx: number; gy: number; facing: Facing }) {
  return {
    gx: player.gx,
    gy: player.gy,
    facing: player.facing
  };
}

function facingForStep(from: { gx: number; gy: number }, to: { gx: number; gy: number }): Facing {
  if (to.gx > from.gx) return "east";
  if (to.gx < from.gx) return "west";
  if (to.gy < from.gy) return "north";
  return "south";
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!accessToken) {
    return NextResponse.json({ error: "Missing Supabase session." }, { status: 401 });
  }

  const userSupabase = createSupabaseUserClient(accessToken);
  const {
    data: { user },
    error: userError
  } = await userSupabase.auth.getUser(accessToken);

  if (userError || !user) {
    return NextResponse.json({ error: "Invalid Supabase session." }, { status: 401 });
  }

  let body: MoveBody;
  try {
    body = (await request.json()) as MoveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (
    typeof body.playerId !== "string" ||
    typeof body.gx !== "number" ||
    typeof body.gy !== "number" ||
    typeof body.facing !== "string" ||
    !Number.isInteger(body.gx) ||
    !Number.isInteger(body.gy) ||
    !FACINGS.has(body.facing as Facing)
  ) {
    return NextResponse.json({ error: "Invalid move payload." }, { status: 400 });
  }

  if (body.playerId !== user.id) {
    return NextResponse.json({ error: "Cannot move another player." }, { status: 403 });
  }

  const supabase = createSupabaseAdminClient();
  const { data: player, error: fetchError } = await supabase
    .from("players")
    .select("gx, gy, facing")
    .eq("id", body.playerId)
    .single();

  if (fetchError || !player) {
    return NextResponse.json({ error: "Player not found." }, { status: 404 });
  }

  const authoritative = currentPosition(player);
  const dx = Math.abs(body.gx - player.gx);
  const dy = Math.abs(body.gy - player.gy);
  const isSameTile = dx === 0 && dy === 0;
  const isSingleOrthogonalStep = dx + dy === 1;

  const facingMatchesStep = isSameTile || body.facing === facingForStep(player, { gx: body.gx, gy: body.gy });

  if (!isWalkable(body.gx, body.gy) || (!isSameTile && !isSingleOrthogonalStep) || !facingMatchesStep) {
    return NextResponse.json(
      {
        error: "Invalid move.",
        player: authoritative
      },
      { status: 400 }
    );
  }

  if (isSameTile && body.facing === player.facing) {
    return NextResponse.json({ player: authoritative });
  }

  const { data: moved, error: updateError } = await supabase
    .from("players")
    .update({
      gx: body.gx,
      gy: body.gy,
      facing: body.facing as Facing,
      last_seen: new Date().toISOString()
    })
    .eq("id", body.playerId)
    .select("gx, gy, facing")
    .single();

  if (updateError || !moved) {
    return NextResponse.json(
      {
        error: "Move rejected.",
        player: authoritative
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ player: currentPosition(moved) });
}
