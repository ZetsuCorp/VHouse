import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, Keypair, PublicKey, Transaction } from "npm:@solana/web3.js@1.98.4";
import bs58 from "npm:bs58@6.0.0";
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "npm:@solana/spl-token@0.4.14";

// Read-only wallet readiness check. No token transfers or Journey writes.
const SCRAP_MINT = "BGf97TZtX7SezpJs21B3DchsonwHvw8DiekDALXLpump";
const CORS = {
  "Access-Control-Allow-Origin": "https://zetsucorp.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
function signerFromSecret() {
  const secret = Deno.env.get("VHOUSE_WALLET_PRIVATE_KEY");
  if (!secret) throw Error("VHOUSE_WALLET_NOT_CONFIGURED");
  let bytes;
  try {
    const trimmed = secret.trim();
    const data = trimmed.startsWith("[") ? JSON.parse(trimmed) : null;
    bytes = Array.isArray(data) ? Uint8Array.from(data) : bs58.decode(trimmed);
  } catch {
    throw Error("VHOUSE_WALLET_KEY_INVALID");
  }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw Error("VHOUSE_WALLET_KEY_INVALID");
}
function positiveAtomic(value) {
  const raw = String(value ?? "");
  if (!/^[0-9]+$/.test(raw)) throw Error("INVALID_ONCHAIN_AMOUNT");
  return BigInt(raw);
}
function amountDisplay(raw, decimals) {
  const str = raw.toString().padStart(decimals + 1, "0");
  return decimals ? str.slice(0, -decimals) + "." + str.slice(-decimals) : str;
}
// Read the one Scrap token price from the existing Solscan provider.
async function getMarketQuote() {
  const key = Deno.env.get("SOLSCAN_API_KEY");
  if (!key) throw Error("SOLSCAN_NOT_CONFIGURED");
  const url = new URL("https://pro-api.solscan.io/v2.0/token/meta");
  url.searchParams.set("address", SCRAP_MINT);
  const res = await fetch(url, {
    headers: { accept: "application/json", token: key },
    signal: AbortSignal.timeout(8500),
  });
  if (!res.ok) throw Error("SOLSCAN_HTTP_" + res.status);
  const payload = await res.json();
  if (payload.success !== true || payload.data?.address !== SCRAP_MINT) {
    throw Error("SOLSCAN_TOKEN_DATA_UNAVAILABLE");
  }
  const priceUsd = Number(payload.data.price);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    throw Error("SOLSCAN_SCRAP_PRICE_UNAVAILABLE");
  }
  return { priceUsd };
}
// Convert USD cents to integer SPL token units without floating-point rounding.
function scrapAtomicForBags(bags, priceUsd, decimals) {
  const match = String(priceUsd).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) throw Error("MARKET_QUOTE_INVALID");
  const digits = match[1] + (match[2] || "");
  const exponent = Number(match[3] || 0) - (match[2] || "").length;
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 40) {
    throw Error("MARKET_QUOTE_INVALID");
  }
  const priceN = BigInt(digits) * (exponent > 0 ? 10n ** BigInt(exponent) : 1n);
  const priceD = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
  if (priceN <= 0n) throw Error("MARKET_QUOTE_INVALID");
  const numerator = BigInt(bags) * 25n * priceD * 10n ** BigInt(decimals);
  const denominator = 100n * priceN;
  return (numerator + denominator - 1n) / denominator;
}
async function inspectWallet(sender, recipient, bags, priceUsd, quoteError = null) {
  const rpc = Deno.env.get("SOLANA_RPC_URL") ||
    "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const mint = new PublicKey(SCRAP_MINT);
  const owner = new PublicKey(recipient);
  const [mintInfo, tokenAccounts, solBalance] = await Promise.all([
    connection.getParsedAccountInfo(mint, "confirmed"),
    connection.getParsedTokenAccountsByOwner(sender.publicKey, { mint }, "confirmed"),
    connection.getBalance(sender.publicKey, "confirmed"),
  ]);
  const tokenProgram = mintInfo.value?.owner;
  if (!tokenProgram ||
      (!tokenProgram.equals(TOKEN_PROGRAM_ID) &&
       !tokenProgram.equals(TOKEN_2022_PROGRAM_ID))) {
    throw Error("SCRAP_MINT_UNAVAILABLE");
  }
  const decimals = mintInfo.value?.data?.parsed?.info?.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw Error("SCRAP_DECIMALS_UNAVAILABLE");
  }
  const required = bags > 0 && priceUsd !== null
    ? scrapAtomicForBags(bags, priceUsd, decimals) : null;
  let available = 0n;
  for (const account of tokenAccounts.value) {
    available += positiveAtomic(account.account.data.parsed.info.tokenAmount.amount);
  }
  // Balance tests still show real holdings with zero bags or unavailable pricing.
  if (required === null || bags === 0) {
    return {
      status: bags === 0 ? "NO BAGS" : "CHECK FAILED",
      reason: bags === 0 ? "NO_SCRAP_BAGS" : (quoteError || "MARKET_QUOTE_UNAVAILABLE"),
      senderWallet: sender.publicKey.toBase58(),
      recipientWallet: owner.toBase58(),
      scrapTokensRequired: bags === 0 ? "0" : "—",
      scrapTokensAvailable: amountDisplay(available, decimals),
      solRequiredLamports: null,
      solAvailableLamports: solBalance,
    };
  }
  const senderAta = getAssociatedTokenAddressSync(
    mint, sender.publicKey, false, tokenProgram,
  );
  const recipientAta = getAssociatedTokenAddressSync(
    mint, owner, false, tokenProgram,
  );
  const recipientAccount = await connection.getAccountInfo(recipientAta, "confirmed");
  const tx = new Transaction();
  let rent = 0;
  if (!recipientAccount) {
    tx.add(createAssociatedTokenAccountInstruction(
      sender.publicKey, recipientAta, owner, mint, tokenProgram,
    ));
    rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed");
  }
  tx.add(createTransferCheckedInstruction(
    senderAta, mint, recipientAta, sender.publicKey,
    required, decimals, [], tokenProgram,
  ));
  const blockhash = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = sender.publicKey;
  tx.recentBlockhash = blockhash.blockhash;
  const feeResult = await connection.getFeeForMessage(tx.compileMessage(), "confirmed");
  if (feeResult.value === null) throw Error("NETWORK_FEE_UNAVAILABLE");
  const requiredSol = rent + feeResult.value;
  const enoughTokens = available >= required;
  const enoughSol = solBalance >= requiredSol;
  return {
    status: enoughTokens && enoughSol ? "READY" : "NOT ENOUGH",
    reason: !enoughTokens ? "SCRAP_TOKENS" : !enoughSol ? "SOL_FEES" : null,
    senderWallet: sender.publicKey.toBase58(),
    recipientWallet: owner.toBase58(),
    scrapTokensRequired: amountDisplay(required, decimals),
    scrapTokensAvailable: amountDisplay(available, decimals),
    solRequiredLamports: requiredSol,
    solAvailableLamports: solBalance,
    recipientTokenAccountNeedsCreation: !recipientAccount,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "SIGN_IN_REQUIRED" }, 401);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw Error("SUPABASE_NOT_CONFIGURED");
    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await authClient.auth.getUser(token);
    if (authError || !auth.user?.id) return reply({ error: "SIGN_IN_REQUIRED" }, 401);
    const body = await req.json();
    const missionId = body && typeof body.missionId === "string"
      ? body.missionId.trim() : "";
    if (!missionId || missionId.length > 200) {
      return reply({ error: "MISSION_ID_REQUIRED" }, 400);
    }
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: record, error: recordError } = await db
      .from("vhouse_journey_records")
      .select("status,snapshot")
      .eq("player_id", auth.user.id)
      .eq("mission_id", missionId)
      .maybeSingle();
    if (recordError) throw Error("JOURNEY_LOOKUP_FAILED");
    if (!record || record.status !== "RESULTS_READY") {
      return reply({ error: "RESULTS_NOT_READY" }, 409);
    }
    const bags = Number(record.snapshot?.rewardBatches?.SCRAP ?? 0);
    if (!Number.isSafeInteger(bags) || bags < 0) {
      return reply({ error: "INVALID_SCRAP_BAGS" }, 422);
    }
    const { data: account, error: accountError } = await db
      .from("vhouse_accounts")
      .select("wallet_address")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (accountError) throw Error("WALLET_LOOKUP_FAILED");
    if (!account?.wallet_address) {
      return reply({ error: "PLAYER_WALLET_NOT_LINKED" }, 409);
    }
    const sender = signerFromSecret();
    let quote = null;
    let quoteError = null;
    if (bags > 0) {
      try { quote = await getMarketQuote(); }
      catch (error) {
        quoteError = error?.message || "MARKET_QUOTE_UNAVAILABLE";
        console.warn("[scrap-wallet-check] Price lookup:", quoteError);
      }
    }
    const check = await inspectWallet(
      sender, account.wallet_address, bags, quote?.priceUsd ?? null, quoteError,
    );
    return reply({ ...check, missionId, bags, usdValue: (bags * 0.25).toFixed(2) });
  } catch (error) {
    const safe = new Set([
      "MARKET_QUOTE_UNAVAILABLE", "MARKET_QUOTE_INVALID", "SOLSCAN_NOT_CONFIGURED",
      "INVALID_ONCHAIN_AMOUNT", "SCRAP_MINT_UNAVAILABLE",
      "SCRAP_DECIMALS_UNAVAILABLE", "NETWORK_FEE_UNAVAILABLE",
      "VHOUSE_WALLET_NOT_CONFIGURED", "VHOUSE_WALLET_KEY_INVALID",
      "INVALID_BAG_AMOUNT", "SUPABASE_NOT_CONFIGURED",
      "JOURNEY_LOOKUP_FAILED", "WALLET_LOOKUP_FAILED",
    ]);
    const code = safe.has(error?.message) ? error.message : "WALLET_CHECK_UNAVAILABLE";
    console.error("[scrap-wallet-check]", code);
    return reply({ error: code }, 503);
  }
});
