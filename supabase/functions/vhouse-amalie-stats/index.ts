import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, PublicKey } from "npm:@solana/web3.js@1.98.4";

const AMALIE_MINT = "rdWAk8U5Zx3L5TjLtL7sb3XhEPmXhqcMLxVBDi3pump";
const CORS = {
  "Access-Control-Allow-Origin": "https://zetsucorp.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function decimal(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, "0");
  return places
    ? digits.slice(0, -places) + "." + digits.slice(-places)
    : digits;
}
async function onchainBalance(wallet: string) {
  const rpc = new Connection(
    Deno.env.get("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const accounts = await rpc.getParsedTokenAccountsByOwner(
    new PublicKey(wallet), { mint: new PublicKey(AMALIE_MINT) }, "confirmed",
  );
  if (!accounts?.value) throw Error("AMALIE_BALANCE_UNAVAILABLE");
  let atomic = 0n;
  let decimals: number | null = null;
  for (const item of accounts.value) {
    const amount = item.account?.data?.parsed?.info?.tokenAmount;
    if (!amount || !/^[0-9]+$/.test(String(amount.amount))) {
      throw Error("AMALIE_BALANCE_UNAVAILABLE");
    }
    if (!Number.isInteger(amount.decimals) || amount.decimals < 0 || amount.decimals > 18 ||
      (decimals !== null && amount.decimals !== decimals)) {
      throw Error("AMALIE_DECIMALS_INVALID");
    }
    decimals = amount.decimals;
    atomic += BigInt(amount.amount);
  }
  if (decimals === null) {
    const mint = await rpc.getParsedAccountInfo(new PublicKey(AMALIE_MINT), "confirmed");
    const count = mint.value?.data?.parsed?.info?.decimals;
    if (!Number.isInteger(count) || count < 0 || count > 18) {
      throw Error("AMALIE_DECIMALS_INVALID");
    }
    decimals = count;
  }
  const unit = 10n ** BigInt(decimals);
  // ATK = DEF = Amalies / 2; round the displayed stats to one decimal.
  // All intermediate calculations use exact token atomic units.
  const tenths = (atomic * 5n + unit / 2n) / unit;
  return {
    amalie_balance_atomic: atomic.toString(),
    amalie_decimals: decimals,
    amalie_balance: decimal(atomic, decimals),
    bonus_atk: decimal(tenths, 1),
    bonus_def: decimal(tenths, 1),
  };
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_ANON_KEY");
    const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key || !secret) throw Error("SUPABASE_NOT_CONFIGURED");
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer) return respond({ error: "SIGN_IN_REQUIRED" }, 401);
    const authClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: authError } = await authClient.auth.getUser(bearer);
    const user = identity?.user;
    if (authError || !user?.id) return respond({ error: "SIGN_IN_REQUIRED" }, 401);
    const db = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: account, error: accountError } = await db.from("vhouse_accounts")
      .select("wallet_address").eq("id", user.id).maybeSingle();
    if (accountError) throw Error("AMALIE_SNAPSHOT_LOOKUP_FAILED");
    const wallet = account?.wallet_address;
    if (!wallet) return respond({ error: "PLAYER_WALLET_NOT_LINKED" }, 409);
    // Unlike earned Scraps, Amalie can move independently; verify on-chain every time.

    const stats = await onchainBalance(wallet);
    const now = new Date().toISOString();
    const next = {
      player_id: user.id,
      wallet_address: wallet,
      token_mint: AMALIE_MINT,
      ...stats,
      checked_at: now,
    };
    const { data, error } = await db.from("vhouse_amalie_stat_snapshots")
      .upsert(next, { onConflict: "player_id" }).select("*").single();
    if (error || !data) throw Error("AMALIE_SNAPSHOT_SAVE_FAILED");
    return respond({ snapshot: data, updated: true });
  } catch (error) {
    console.error("[vhouse-amalie-stats]", String(error));
    const code = error instanceof Error ? error.message : "";
    const errors = new Set([
      "AMALIE_SNAPSHOT_LOOKUP_FAILED", "AMALIE_BALANCE_UNAVAILABLE",
      "AMALIE_DECIMALS_INVALID", "AMALIE_SNAPSHOT_SAVE_FAILED", "SUPABASE_NOT_CONFIGURED",
    ]);
    return respond({ error: errors.has(code) ? code : "AMALIE_STATS_UNAVAILABLE" }, 503);
  }
});