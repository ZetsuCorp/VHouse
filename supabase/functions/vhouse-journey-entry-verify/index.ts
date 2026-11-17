import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection } from "npm:@solana/web3.js@1.98.4";

const TREASURY = "CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK";
const LAMPORTS = 1_000_000;
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const CORS = {
  "Access-Control-Allow-Origin": "https://zetsucorp.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
async function readConfirmedTransaction(signature: string) {
  // Reuse VHouse's existing Solana RPC strategy; no Solscan dependency.
  const urls = [...new Set([
    Deno.env.get("SOLANA_RPC_URL"),
    "https://api.mainnet-beta.solana.com",
    "https://api.mainnet.solana.com",
    "https://solana-rpc.publicnode.com",
  ].filter(Boolean))] as string[];
  let reachable = false;
  for (const url of urls) {
    try {
      const rpc = new Connection(url, "confirmed");
      const tx = await rpc.getParsedTransaction(signature, {
        commitment: "confirmed", maxSupportedTransactionVersion: 0,
      });
      reachable = true;
      if (tx) return tx;
    } catch (error) {
      console.warn("[journey-payment] RPC receipt lookup:", String(error));
    }
  }
  if (!reachable) throw Error("SOLANA_RPC_UNAVAILABLE");
  return null;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "SIGN_IN_REQUIRED" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw Error("SUPABASE_NOT_CONFIGURED");
    const authClient = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await authClient.auth.getUser(token);
    if (authError || !auth.user?.id) return reply({ error: "SIGN_IN_REQUIRED" }, 401);
    const body = await req.json().catch(() => null);
    const missionId = typeof body?.missionId === "string" ? body.missionId.trim() : "";
    const signature = typeof body?.signature === "string" ? body.signature.trim() : "";
    if (!/^JR-[A-Z0-9-]{5,90}$/.test(missionId) ||
        !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) {
      return reply({ error: "INVALID_PAYMENT_RECEIPT" }, 400);
    }
    const db = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: account, error: accountError } = await db
      .from("vhouse_accounts").select("wallet_address")
      .eq("id", auth.user.id).maybeSingle();
    if (accountError) throw Error("PLAYER_WALLET_LOOKUP_FAILED");
    const owner = account?.wallet_address;
    if (!owner) return reply({ error: "PLAYER_WALLET_NOT_LINKED" }, 409);

    const { data: saved, error: savedError } = await db
      .from("vhouse_journey_entry_payments").select("player_id,mission_id,consumed_at")
      .eq("signature", signature).maybeSingle();
    if (savedError) throw Error("PAYMENT_LOOKUP_FAILED");
    if (saved) {
      if (saved.player_id !== auth.user.id || saved.mission_id !== missionId) {
        return reply({ error: "PAYMENT_ALREADY_ASSIGNED" }, 409);
      }
      return reply({ verified: true, signature, consumed: !!saved.consumed_at });
    }

    const tx = await readConfirmedTransaction(signature);
    if (!tx) return reply({ verified: false, error: "PAYMENT_CONFIRMATION_PENDING" }, 202);
    if (!tx.meta || tx.meta.err !== null) return reply({ error: "PAYMENT_FAILED_ONCHAIN" }, 409);
    const keys = tx.transaction.message.accountKeys;
    const ownerSigned = keys.some(k => k.signer && k.pubkey.toBase58() === owner);
    const instructions = tx.transaction.message.instructions;
    const payment = instructions.some(ix =>
      "parsed" in ix && ix.program === "system" &&
      ix.parsed?.type === "transfer" &&
      ix.parsed?.info?.source === owner &&
      ix.parsed?.info?.destination === TREASURY &&
      Number(ix.parsed?.info?.lamports) === LAMPORTS
    );
    const memo = instructions.some(ix =>
      ix.programId.toBase58() === MEMO_PROGRAM &&
      "parsed" in ix &&
      (ix.parsed === "VHOUSE:JOURNEY:" + missionId ||
       ix.parsed?.info?.memo === "VHOUSE:JOURNEY:" + missionId)
    );
    const now = Math.floor(Date.now() / 1000);
    const timeValid = typeof tx.blockTime === "number" &&
      tx.blockTime >= now - 1800 && tx.blockTime <= now + 60;
    if (!ownerSigned || !payment || !memo || !timeValid) {
      return reply({ error: "PAYMENT_RECEIPT_MISMATCH" }, 409);
    }
    const { error: insertError } = await db
      .from("vhouse_journey_entry_payments")
      .insert({
        signature, player_id: auth.user.id, mission_id: missionId,
        source_wallet: owner, destination_wallet: TREASURY,
        amount_lamports: LAMPORTS,
      });
    if (insertError) {
      if (insertError.code === "23505") return reply({ error: "PAYMENT_ALREADY_ASSIGNED" }, 409);
      throw Error("PAYMENT_RECORD_FAILED");
    }
    return reply({ verified: true, signature, consumed: false });
  } catch (error) {
    console.error("[journey-payment]", String(error));
    const code = error instanceof Error ? error.message : "";
    const allowed = new Set([
      "SOLANA_RPC_UNAVAILABLE", "PAYMENT_LOOKUP_FAILED", "PAYMENT_RECORD_FAILED",
      "PLAYER_WALLET_LOOKUP_FAILED", "SUPABASE_NOT_CONFIGURED",
    ]);
    return reply({ error: allowed.has(code) ? code : "PAYMENT_VERIFICATION_UNAVAILABLE" }, 503);
  }
});