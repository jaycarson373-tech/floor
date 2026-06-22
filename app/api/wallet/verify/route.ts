import { NextResponse } from "next/server";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createSupabaseAdminClient, createSupabaseUserClient } from "@/lib/supabase/server";

type VerifyBody = {
  walletAddress?: unknown;
  signature?: unknown;
  message?: unknown;
};

function verificationMessage(playerId: string, walletAddress: string, gateMint: string) {
  return `The Floor ranked verification\nPlayer: ${playerId}\nWallet: ${walletAddress}\nGate mint: ${gateMint}`;
}

async function readGateBalance(walletAddress: string, mint: string) {
  const heliusRpcUrl = process.env.HELIUS_RPC_URL;

  if (!heliusRpcUrl) {
    throw new Error("Missing HELIUS_RPC_URL.");
  }

  const response = await fetch(heliusRpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "the-floor-gate",
      method: "getTokenAccountsByOwner",
      params: [
        walletAddress,
        { mint },
        {
          encoding: "jsonParsed"
        }
      ]
    })
  });

  const result = (await response.json()) as {
    error?: { message?: string };
    result?: {
      value?: Array<{
        account?: {
          data?: {
            parsed?: {
              info?: {
                tokenAmount?: {
                  amount?: string;
                };
              };
            };
          };
        };
      }>;
    };
  };

  if (!response.ok || result.error) {
    throw new Error(result.error?.message ?? "Could not read gate token balance.");
  }

  return (result.result?.value ?? []).reduce((sum, account) => {
    const rawAmount = account.account?.data?.parsed?.info?.tokenAmount?.amount;
    return sum + BigInt(rawAmount ?? "0");
  }, BigInt(0));
}

export async function POST(request: Request) {
  const gateMint = process.env.GATE_MINT;
  const threshold = BigInt(process.env.GATE_THRESHOLD ?? "0");
  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : null;

  if (!gateMint || threshold <= BigInt(0)) {
    return NextResponse.json({ error: "Gate config is missing." }, { status: 500 });
  }

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

  let body: VerifyBody;
  try {
    body = (await request.json()) as VerifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.walletAddress !== "string" || typeof body.signature !== "string" || typeof body.message !== "string") {
    return NextResponse.json({ error: "Invalid wallet verification payload." }, { status: 400 });
  }

  const expectedMessage = verificationMessage(user.id, body.walletAddress, gateMint);

  if (body.message !== expectedMessage) {
    return NextResponse.json({ error: "Unexpected verification message." }, { status: 400 });
  }

  let verified = false;
  try {
    verified = nacl.sign.detached.verify(
      new TextEncoder().encode(body.message),
      bs58.decode(body.signature),
      bs58.decode(body.walletAddress)
    );
  } catch {
    verified = false;
  }

  if (!verified) {
    return NextResponse.json({ error: "Wallet signature rejected." }, { status: 401 });
  }

  const gateBalance = await readGateBalance(body.walletAddress, gateMint);
  const ranked = gateBalance >= threshold;
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("set_player_wallet_ranked", {
    p_player_id: user.id,
    p_wallet_address: body.walletAddress,
    p_ranked: ranked,
    p_gate_balance: gateBalance.toString()
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const player = Array.isArray(data) ? data[0] : data;

  return NextResponse.json({
    player,
    gateMint,
    threshold: threshold.toString(),
    gateBalance: gateBalance.toString(),
    ranked
  });
}
