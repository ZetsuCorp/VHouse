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
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_ATOMIC_PER_BAG = 250000; // $0.25 USDC (6 decimals).
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
async function getMarketQuote(bags) {
  const amount = bags * USDC_ATOMIC_PER_BAG;
  if (!Number.isSafeInteger(amount) || amount < 1) throw Error("INVALID_BAG_AMOUNT");
  const url = new URL("https://api.jup.ag/swap/v1/quote");
  url.searchParams.set("inputMint", USDC_MINT);
  url.searchParams.set("outputMint", SCRAP_MINT);
  url.searchParams.set("amount", String(amount));
  url.searchParams.set("slippageBps", "50");
  const headers = {};
  const apiKey = Deno.env.get("JUPITER_API_KEY");
  if (apiKey) headers["x-api-key"] = apiKey;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw Error("MARKET_QUOTE_UNAVAILABLE");
  const quote = await res.json();
  if (quote.inputMint !== USDC_MINT || quote.outputMint !== SCRAP_MINT ||
      quote.inAmount !== String(amount) || !Array.isArray(quote.routePlan) ||
      !quote.routePlan.length) throw Error("MARKET_QUOTE_INVALID");
  const atomic = positiveAtomic(quote.outAmount);
  if (atomic <= 0n) throw Error("MARKET_QUOTE_INVALID");
  return { amount: atomic, quoteUsdc: amountDisplay(BigInt(amount), 6) };
}
async function inspectWallet(sender, recipient, required) {
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
  let available = 0n;
  for (const account of tokenAccounts.value) {
    available += positiveAtomic(account.account.data.parsed.info.tokenAmount.amount);
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
    if (bags === 0) {
      return reply({ status: "READY", missionId, bags: 0, scrapTokensRequired: "0" });
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
    const quote = await getMarketQuote(bags);
    const check = await inspectWallet(sender, account.wallet_address, quote.amount);
    return reply({ ...check, missionId, bags, quoteUsdc: quote.quoteUsdc });
  } catch (error) {
    const safe = new Set([
      "MARKET_QUOTE_UNAVAILABLE", "MARKET_QUOTE_INVALID",
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
