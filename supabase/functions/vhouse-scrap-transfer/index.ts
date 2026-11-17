import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, Keypair, PublicKey, Transaction } from "npm:@solana/web3.js@1.98.4";
import bs58 from "npm:bs58@6.0.0";
import {
  ACCOUNT_SIZE, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "npm:@solana/spl-token@0.4.14";

/* Independent Scrap transfer endpoint. Nothing in Journey calls this yet.
   Disabled until VHOUSE_SCRAP_TRANSFERS_ENABLED=true is explicitly configured.
   Only a server-verified RESULTS_READY receipt can request a transfer.
   A unique signed transaction is stored BEFORE sending, preventing duplicate payouts. */
const SCRAP_MINT = "BGf97TZtX7SezpJs21B3DchsonwHvw8DiekDALXLpump";
const CORS = {
  "Access-Control-Allow-Origin": "https://zetsucorp.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function response(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function senderFromSecret() {
  const secret = Deno.env.get("VHOUSE_WALLET_PRIVATE_KEY");
  if (!secret) throw Error("VHOUSE_WALLET_NOT_CONFIGURED");
  let bytes: Uint8Array;
  try {
    const text = secret.trim();
    bytes = text.startsWith("[")
      ? Uint8Array.from(JSON.parse(text))
      : bs58.decode(text);
  } catch { throw Error("VHOUSE_WALLET_KEY_INVALID"); }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw Error("VHOUSE_WALLET_KEY_INVALID");
}
function atomic(value: unknown) {
  if (!/^[0-9]+$/.test(String(value ?? ""))) throw Error("ONCHAIN_AMOUNT_INVALID");
  return BigInt(String(value));
}
function display(value: bigint, decimals: number) {
  const digits = value.toString().padStart(decimals + 1, "0");
  return decimals
    ? digits.slice(0, -decimals) + "." + digits.slice(-decimals)
    : digits;
}
async function scrapPriceUsd() {
  const key = Deno.env.get("SOLSCAN_API_KEY");
  if (!key) throw Error("SOLSCAN_NOT_CONFIGURED");
  const url = new URL("https://pro-api.solscan.io/v2.0/token/meta");
  url.searchParams.set("address", SCRAP_MINT);
  const result = await fetch(url, {
    headers: { accept: "application/json", token: key },
    signal: AbortSignal.timeout(8500),
  });
  if (!result.ok) throw Error("SOLSCAN_HTTP_" + result.status);
  const payload = await result.json();
  if (payload.success !== true || payload.data?.address !== SCRAP_MINT) {
    throw Error("SCRAP_MARKET_UNAVAILABLE");
  }
  const price = Number(payload.data.price);
  if (!Number.isFinite(price) || price <= 0) throw Error("SCRAP_MARKET_UNAVAILABLE");
  return price;
}
function tokensForBags(bags: number, price: number, decimals: number) {
  // Integer rounding up means the quoted amount never falls below $0.25/bag.
  const m = String(price).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!m) throw Error("SCRAP_MARKET_UNAVAILABLE");
  const fraction = m[2] || "";
  const exponent = Number(m[3] || 0) - fraction.length;
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 40) {
    throw Error("SCRAP_MARKET_UNAVAILABLE");
  }
  const digit = BigInt(m[1] + fraction);
  const num = exponent > 0 ? digit * 10n ** BigInt(exponent) : digit;
  const den = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
  if (num <= 0n) throw Error("SCRAP_MARKET_UNAVAILABLE");
  const numerator = BigInt(bags) * 25n * den * 10n ** BigInt(decimals);
  const divisor = 100n * num;
  return (numerator + divisor - 1n) / divisor;
}
function connection() {
  return new Connection(
    Deno.env.get("SOLANA_RPC_URL") || "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
}
type Payout = {
  player_id: string; mission_id: string;
  bags: number; recipient_wallet: string; source_wallet: string;
  amount_atomic: string; token_decimals: number;
  signature: string; signed_transaction_base64: string;
  blockhash: string; last_valid_block_height: number;
  status: string;
};
async function existingPayout(db: ReturnType<typeof createClient>, playerId: string, missionId: string) {
  const { data, error } = await db.from("vhouse_scrap_transfers")
    .select("*").eq("player_id", playerId)
    .eq("mission_id", missionId).maybeSingle();
  if (error) throw Error("PAYOUT_RECORD_UNAVAILABLE");
  return data as Payout | null;
}
async function updateStatus(
  db: ReturnType<typeof createClient>, row: Payout, status: string,
) {
  const fields: Record<string, unknown> = {
    status, updated_at: new Date().toISOString(),
  };
  if (status === "CONFIRMED") fields.confirmed_at = new Date().toISOString();
  const { error } = await db.from("vhouse_scrap_transfers")
    .update(fields).eq("player_id", row.player_id)
    .eq("mission_id", row.mission_id).eq("signature", row.signature);
  if (error) throw Error("PAYOUT_STATUS_SAVE_FAILED");
}
async function continueSignedTransfer(
  db: ReturnType<typeof createClient>, rpc: Connection, row: Payout,
) {
  const result = () => ({
    bags: row.bags, recipientWallet: row.recipient_wallet,
    scrapTokens: display(atomic(row.amount_atomic), row.token_decimals),
    signature: row.signature,
  });
  if (row.status === "CONFIRMED") return { status: "TRANSFERRED", ...result() };
  if (row.status === "FAILED_REVIEW" || row.status === "EXPIRED_REVIEW") {
    return { status: row.status, ...result() };
  }
  const readChain = async () => {
    const found = await rpc.getSignatureStatuses(
      [row.signature], { searchTransactionHistory: true },
    );
    const info = found.value[0];
    if (info?.err) {
      await updateStatus(db, row, "FAILED_REVIEW");
      return { status: "FAILED_REVIEW", ...result() };
    }
    if (info?.confirmationStatus === "confirmed" ||
        info?.confirmationStatus === "finalized") {
      await updateStatus(db, row, "CONFIRMED");
      return { status: "TRANSFERRED", ...result() };
    }
    return null;
  };
  const chain = await readChain();
  if (chain) return chain;
  const height = await rpc.getBlockHeight("confirmed");
  if (height > row.last_valid_block_height) {
    // Never automatically sign another transaction for the same Journey.
    await updateStatus(db, row, "EXPIRED_REVIEW");
    return { status: "EXPIRED_REVIEW", ...result() };
  }
  const bytes = Uint8Array.from(
    atob(row.signed_transaction_base64), (char) => char.charCodeAt(0),
  );
  try {
    const signature = await rpc.sendRawTransaction(bytes, {
      skipPreflight: false, maxRetries: 2,
    });
    if (signature !== row.signature) throw Error("SIGNATURE_MISMATCH");
    await rpc.confirmTransaction({
      signature: row.signature,
      blockhash: row.blockhash,
      lastValidBlockHeight: row.last_valid_block_height,
    }, "confirmed");
  } catch (error) {
    // A broadcast error may occur AFTER the chain has received the transaction.
    // Do not sign again: inspect the same signature next time.
    console.warn("[vhouse-scrap-transfer] Send pending:", String(error));
  }
  const latest = await readChain();
  if (latest) return latest;
  await updateStatus(db, row, "PENDING");
  return { status: "PENDING", ...result() };
}
async function prepareSignedTransfer(
  db: ReturnType<typeof createClient>, rpc: Connection,
  sender: Keypair, playerId: string, missionId: string,
  bags: number, wallet: string,
) {
  const mint = new PublicKey(SCRAP_MINT);
  const recipient = new PublicKey(wallet);
  const [mintData, tokenAccounts, solBalance] = await Promise.all([
    rpc.getParsedAccountInfo(mint, "confirmed"),
    rpc.getParsedTokenAccountsByOwner(sender.publicKey, { mint }, "confirmed"),
    rpc.getBalance(sender.publicKey, "confirmed"),
  ]);
  const program = mintData.value?.owner;
  if (!program ||
    (!program.equals(TOKEN_PROGRAM_ID) && !program.equals(TOKEN_2022_PROGRAM_ID))) {
    throw Error("SCRAP_MINT_UNAVAILABLE");
  }
  const decimals = mintData.value?.data?.parsed?.info?.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw Error("SCRAP_DECIMALS_UNAVAILABLE");
  }
  const price = await scrapPriceUsd();
  const needed = tokensForBags(bags, price, decimals);
  const sourceAta = getAssociatedTokenAddressSync(
    mint, sender.publicKey, false, program,
  );
  const source = tokenAccounts.value.find(
    (entry) => entry.pubkey.equals(sourceAta),
  );
  const available = source
    ? atomic(source.account.data.parsed.info.tokenAmount.amount)
    : 0n;
  const recipientAta = getAssociatedTokenAddressSync(
    mint, recipient, false, program,
  );
  const recipientTokenAccount = await rpc.getAccountInfo(recipientAta, "confirmed");
  const tx = new Transaction();
  let accountRent = 0;
  if (!recipientTokenAccount) {
    tx.add(createAssociatedTokenAccountInstruction(
      sender.publicKey, recipientAta, recipient, mint, program,
    ));
    accountRent = await rpc.getMinimumBalanceForRentExemption(
      ACCOUNT_SIZE, "confirmed",
    );
  }
  tx.add(createTransferCheckedInstruction(
    sourceAta, mint, recipientAta, sender.publicKey, needed, decimals, [], program,
  ));
  const recent = await rpc.getLatestBlockhash("confirmed");
  tx.feePayer = sender.publicKey;
  tx.recentBlockhash = recent.blockhash;
  const fee = await rpc.getFeeForMessage(tx.compileMessage(), "confirmed");
  if (fee.value === null) throw Error("NETWORK_FEE_UNAVAILABLE");
  const solNeeded = accountRent + fee.value;
  if (available < needed || solBalance < solNeeded) {
    return {
      status: "NOT ENOUGH",
      reason: available < needed ? "SCRAP_TOKENS" : "SOL_FEES",
      bags, scrapTokensRequired: display(needed, decimals),
      scrapTokensAvailable: display(available, decimals),
      solAvailableLamports: solBalance, solRequiredLamports: solNeeded,
    };
  }
  tx.sign(sender);
  if (!tx.signature) throw Error("TRANSACTION_SIGNING_FAILED");
  const signature = bs58.encode(tx.signature);
  const bytes = tx.serialize();
  const signed = btoa(String.fromCharCode(...bytes));
  const row = {
    player_id: playerId, mission_id: missionId,
    source_wallet: sender.publicKey.toBase58(),
    recipient_wallet: recipient.toBase58(),
    token_mint: SCRAP_MINT,
    bags, amount_atomic: needed.toString(), token_decimals: decimals,
    signature, signed_transaction_base64: signed,
    blockhash: recent.blockhash,
    last_valid_block_height: recent.lastValidBlockHeight,
    status: "SIGNED",
  };
  // UNIQUE(player_id,mission_id) ensures only the first signed transaction
  // can be broadcast, even when the user presses CONFIRM twice at once.
  const { error } = await db.from("vhouse_scrap_transfers").insert(row);
  if (error) {
    if (error.code === "23505") {
      const already = await existingPayout(db, playerId, missionId);
      if (already) return continueSignedTransfer(db, rpc, already);
    }
    throw Error("PAYOUT_RECORD_UNAVAILABLE");
  }
  return continueSignedTransfer(db, rpc, row);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== "POST") return response({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return response({ error: "SIGN_IN_REQUIRED" }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw Error("SUPABASE_NOT_CONFIGURED");
    const auth = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await auth.auth.getUser(token);
    if (verified.error || !verified.data?.user?.id) {
      return response({ error: "SIGN_IN_REQUIRED" }, 401);
    }
    const body = await req.json().catch(() => null);
    const missionId = typeof body?.missionId === "string"
      ? body.missionId.trim() : "";
    if (!missionId || missionId.length > 200) {
      return response({ error: "MISSION_ID_REQUIRED" }, 400);
    }
    const playerId = verified.data.user.id;
    const db = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const existing = await existingPayout(db, playerId, missionId);
    const rpc = connection();
    // A signed transfer can be checked or retried by signature, never paid twice.
    if (existing) {
      return response(await continueSignedTransfer(db, rpc, existing));
    }
    const [journey, account] = await Promise.all([
      db.from("vhouse_journey_records").select("status,snapshot")
        .eq("player_id", playerId).eq("mission_id", missionId).maybeSingle(),
      db.from("vhouse_accounts").select("wallet_address")
        .eq("id", playerId).maybeSingle(),
    ]);
    if (journey.error || account.error) throw Error("PAYOUT_RECORD_UNAVAILABLE");
    if (journey.data?.status !== "RESULTS_READY") {
      return response({ error: "RESULTS_NOT_READY" }, 409);
    }
    const bags = Number(journey.data.snapshot?.rewardBatches?.SCRAP ?? 0);
    if (!Number.isSafeInteger(bags) || bags < 0) {
      return response({ error: "SCRAP_BAG_COUNT_INVALID" }, 422);
    }
    if (bags === 0) return response({ status: "NO BAGS", bags: 0 });
    const wallet = account.data?.wallet_address;
    if (!wallet) return response({ error: "PLAYER_WALLET_NOT_LINKED" }, 409);
    const sender = senderFromSecret();
    const payout = await prepareSignedTransfer(
      db, rpc, sender, playerId, missionId, bags, wallet,
    );
    return response(payout);
  } catch (error) {
    // Don't expose wallet secrets, signed bytes, or internal exception details.
    console.error("[vhouse-scrap-transfer]", String(error));
    const allow = new Set([
      "SCRAP_MINT_UNAVAILABLE", "SCRAP_DECIMALS_UNAVAILABLE",
      "SOLSCAN_NOT_CONFIGURED", "SCRAP_MARKET_UNAVAILABLE",
      "NETWORK_FEE_UNAVAILABLE", "PAYOUT_RECORD_UNAVAILABLE",
      "PAYOUT_STATUS_SAVE_FAILED", "VHOUSE_WALLET_NOT_CONFIGURED",
      "VHOUSE_WALLET_KEY_INVALID", "SUPABASE_NOT_CONFIGURED",
    ]);
    const message = error instanceof Error ? error.message : "";
    return response({ error: allow.has(message) ? message : "SCRAP_TRANSFER_UNAVAILABLE" }, 503);
  }
});
