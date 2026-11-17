import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, PublicKey } from "npm:@solana/web3.js@1.98.4";

const SCRAP_MINT = "BGf97TZtX7SezpJs21B3DchsonwHvw8DiekDALXLpump";
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
    new PublicKey(wallet), { mint: new PublicKey(SCRAP_MINT) }, "confirmed",
  );
  if (!accounts?.value) throw Error("SCRAP_BALANCE_UNAVAILABLE");
  let atomic = 0n;
  let decimals: number | null = null;
  for (const item of accounts.value) {
    const amount = item.account?.data?.parsed?.info?.tokenAmount;
    if (!amount || !/^[0-9]+$/.test(String(amount.amount))) {
      throw Error("SCRAP_BALANCE_UNAVAILABLE");
    }
    if (!Number.isInteger(amount.decimals) || amount.decimals < 0 || amount.decimals > 18 ||
      (decimals !== null && amount.decimals !== decimals)) {
      throw Error("SCRAP_DECIMALS_INVALID");
    }
    decimals = amount.decimals;
    atomic += BigInt(amount.amount);
  }
  if (decimals === null) {
    const mint = await rpc.getParsedAccountInfo(new PublicKey(SCRAP_MINT), "confirmed");
    const count = mint.value?.data?.parsed?.info?.decimals;
    if (!Number.isInteger(count) || count < 0 || count > 18) {
      throw Error("SCRAP_DECIMALS_INVALID");
    }
    decimals = count;
  }
  const unit = 10n ** BigInt(decimals);
  // ATK = DEF = Scraps / 2; round the displayed stats to one decimal.
  // All intermediate calculations use exact token atomic units.
  const tenths = (atomic * 5n + unit / 2n) / unit;
  return {
    scrap_balance_atomic: atomic.toString(),
    scrap_decimals: decimals,
    scrap_balance: decimal(atomic, decimals),
    atk: decimal(tenths, 1),
    def: decimal(tenths, 1),
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
    const [account, saved, latestTransfer] = await Promise.all([
      db.from("vhouse_accounts").select("wallet_address")
        .eq("id", user.id).maybeSingle(),
      db.from("vhouse_scrap_stat_snapshots").select("*")
        .eq("player_id", user.id).maybeSingle(),
      db.from("vhouse_scrap_transfers").select("signature,confirmed_at")
        .eq("player_id", user.id).eq("status", "CONFIRMED")
        .order("confirmed_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (account.error || saved.error || latestTransfer.error) throw Error("SCRAP_SNAPSHOT_LOOKUP_FAILED");
    const wallet = account.data?.wallet_address;
    if (!wallet) return respond({ error: "PLAYER_WALLET_NOT_LINKED" }, 409);
    const transfer = latestTransfer.data;
    const snapshot = saved.data;
    const upToDate = snapshot &&
      snapshot.wallet_address === wallet &&
      snapshot.token_mint === SCRAP_MINT &&
      (!transfer || (snapshot.last_earned_at &&
        new Date(snapshot.last_earned_at).getTime() >=
        new Date(transfer.confirmed_at).getTime()));
    if (upToDate) return respond({ snapshot, updated: false });

    const stats = await onchainBalance(wallet);
    const now = new Date().toISOString();
    const next = {
      player_id: user.id,
      wallet_address: wallet,
      token_mint: SCRAP_MINT,
      ...stats,
      source_signature: transfer?.signature || null,
      last_earned_at: transfer?.confirmed_at || null,
      checked_at: now,
    };
    const { data, error } = await db.from("vhouse_scrap_stat_snapshots")
      .upsert(next, { onConflict: "player_id" }).select("*").single();
    if (error || !data) throw Error("SCRAP_SNAPSHOT_SAVE_FAILED");
    return respond({ snapshot: data, updated: true });
  } catch (error) {
    console.error("[vhouse-scrap-stats]", String(error));
    const code = error instanceof Error ? error.message : "";
    const errors = new Set([
      "SCRAP_SNAPSHOT_LOOKUP_FAILED", "SCRAP_BALANCE_UNAVAILABLE",
      "SCRAP_DECIMALS_INVALID", "SCRAP_SNAPSHOT_SAVE_FAILED", "SUPABASE_NOT_CONFIGURED",
    ]);
    return respond({ error: errors.has(code) ? code : "SCRAP_STATS_UNAVAILABLE" }, 503);
  }
});