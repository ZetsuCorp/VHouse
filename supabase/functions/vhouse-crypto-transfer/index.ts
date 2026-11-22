import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from "npm:@solana/web3.js@1.98.4";
import bs58 from "npm:bs58@6.0.0";
import {
  ACCOUNT_SIZE, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
} from "npm:@solana/spl-token@0.4.14";

/* Signed-once, recorded-once SOL/AWT payouts for both Journey and Tower Raid.
   Journey still uses 10-cent bags; Raid uses its independently recorded
   $0.10–$0.25 SOL/AWT bags, never a client-supplied payout amount. */
const AWT_MINT = "ETvGFek4eDeHP7iC7yceGpduTRypHpsUT6tybwMXpump";
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
    const value = secret.trim();
    bytes = value.startsWith("[") ? Uint8Array.from(JSON.parse(value)) : bs58.decode(value);
  } catch { throw Error("VHOUSE_WALLET_KEY_INVALID"); }
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw Error("VHOUSE_WALLET_KEY_INVALID");
}
function display(value: bigint, decimals: number) {
  const digits = value.toString().padStart(decimals + 1, "0");
  return decimals ? digits.slice(0, -decimals) + "." + digits.slice(-decimals) : digits;
}
function atomic(value: unknown) {
  if (!/^[0-9]+$/.test(String(value ?? ""))) throw Error("ONCHAIN_AMOUNT_INVALID");
  return BigInt(String(value));
}
function unitsForUsdCents(usdCents: bigint, price: number, decimals: number) {
  // Exact integer unit conversion; round up by less than one token atomic unit.
  const m = String(price).match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!m) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  const digits = BigInt(m[1] + (m[2] || ""));
  const exponent = Number(m[3] || 0) - (m[2] || "").length;
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 40) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  const num = exponent > 0 ? digits * 10n ** BigInt(exponent) : digits;
  const den = exponent < 0 ? 10n ** BigInt(-exponent) : 1n;
  if (num <= 0n) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  return (usdCents * den * 10n ** BigInt(decimals) +
    100n * num - 1n) / (100n * num);
}
function unitsForBags(bags: number, price: number, decimals: number) {
  // Preserve the Journey payment calculation: exactly 10 USD cents per bag.
  return unitsForUsdCents(BigInt(bags) * 10n, price, decimals);
}
async function priceUsd(symbol: string, awtMint?: string) {
  if (symbol === "SOL") {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8500),
    });
    if (!res.ok) throw Error("CRYPTO_MARKET_UNAVAILABLE");
    const price = Number((await res.json())?.solana?.usd);
    if (!Number.isFinite(price) || price <= 0) throw Error("CRYPTO_MARKET_UNAVAILABLE");
    return price;
  }
  if (!awtMint) throw Error("AWT_MINT_NOT_CONFIGURED");
  const res = await fetch("https://api.dexscreener.com/token-pairs/v1/solana/" + awtMint, {
    headers: { accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8500),
  });
  if (!res.ok) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  const pairs = await res.json();
  if (!Array.isArray(pairs)) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  const valid = pairs.filter(p => p?.chainId === "solana" &&
    p?.baseToken?.address === awtMint &&
    Number.isFinite(Number(p?.priceUsd)) && Number(p?.priceUsd) > 0);
  valid.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  const price = Number(valid[0]?.priceUsd);
  if (!Number.isFinite(price) || price <= 0) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  return price;
}
function connection() {
  return new Connection(Deno.env.get("SOLANA_RPC_URL") ||
    "https://api.mainnet-beta.solana.com", "confirmed");
}
type Payout = {
  player_id: string; mission_id?: string; raid_id?: string;
  token_symbol: "SOL" | "AWT";
  token_mint: string | null; bags: number; usd_cents?: number;
  source_wallet: string; recipient_wallet: string;
  amount_atomic: string; token_decimals: number;
  signature: string; signed_transaction_base64: string;
  blockhash: string; last_valid_block_height: number;
  status: string;
};
function payoutTable(raidMode: boolean) {
  return raidMode ? "vhouse_raid_crypto_transfers" : "vhouse_crypto_transfers";
}
async function existingPayout(db: ReturnType<typeof createClient>,
  playerId: string, referenceId: string, symbol: string, raidMode = false) {
  const { data, error } = await db.from(payoutTable(raidMode))
    .select("*").eq("player_id", playerId)
    .eq(raidMode ? "raid_id" : "mission_id", referenceId)
    .eq("token_symbol", symbol).maybeSingle();
  if (error) throw Error("PAYOUT_RECORD_UNAVAILABLE");
  return data as Payout | null;
}
async function markRaidBagsTransferred(db: ReturnType<typeof createClient>, row: Payout) {
  if (!row.raid_id) return;
  const { error } = await db.from("vhouse_raid_crypto_bags")
    .update({payout_status:"TRANSFERRED",transfer_signature:row.signature,
      updated_at:new Date().toISOString()})
    .eq("player_id",row.player_id).eq("raid_id",row.raid_id)
    .eq("token_symbol",row.token_symbol);
  if (error) throw Error("PAYOUT_STATUS_SAVE_FAILED");
}
async function updateStatus(db: ReturnType<typeof createClient>, row: Payout, status: string) {
  const fields: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "CONFIRMED") fields.confirmed_at = new Date().toISOString();
  const raidMode=!!row.raid_id;
  const { error } = await db.from(payoutTable(raidMode))
    .update(fields).eq("player_id", row.player_id)
    .eq(raidMode?"raid_id":"mission_id", raidMode?row.raid_id:row.mission_id)
    .eq("token_symbol", row.token_symbol).eq("signature", row.signature);
  if (error) throw Error("PAYOUT_STATUS_SAVE_FAILED");
  if (raidMode && status==="CONFIRMED") await markRaidBagsTransferred(db,row);
}
async function continueSignedTransfer(db: ReturnType<typeof createClient>, rpc: Connection, row: Payout) {
  const result = () => ({
    token: row.token_symbol,
    bags: row.bags,
    ...(row.raid_id?{usdCents:row.usd_cents}:{}),
    tokenAmount: display(atomic(row.amount_atomic), row.token_decimals),
    signature: row.signature,
    recipientWallet: row.recipient_wallet,
  });
  if (row.status === "CONFIRMED") {
    if (row.raid_id) await markRaidBagsTransferred(db,row);
    return { status: "TRANSFERRED", ...result() };
  }
  if (row.status === "FAILED_REVIEW" || row.status === "EXPIRED_REVIEW") {
    return { status: row.status, ...result() };
  }
  const readChain = async () => {
    const found = await rpc.getSignatureStatuses([row.signature], { searchTransactionHistory: true });
    const info = found.value[0];
    if (info?.err) {
      await updateStatus(db, row, "FAILED_REVIEW");
      return { status: "FAILED_REVIEW", ...result() };
    }
    if (info?.confirmationStatus === "confirmed" || info?.confirmationStatus === "finalized") {
      await updateStatus(db, row, "CONFIRMED");
      return { status: "TRANSFERRED", ...result() };
    }
    return null;
  };
  const chain = await readChain();
  if (chain) return chain;
  const height = await rpc.getBlockHeight("confirmed");
  if (height > row.last_valid_block_height) {
    await updateStatus(db, row, "EXPIRED_REVIEW");
    return { status: "EXPIRED_REVIEW", ...result() };
  }
  const bytes = Uint8Array.from(atob(row.signed_transaction_base64), c => c.charCodeAt(0));
  try {
    const signature = await rpc.sendRawTransaction(bytes, {
      skipPreflight: false, maxRetries: 2,
    });
    if (signature !== row.signature) throw Error("SIGNATURE_MISMATCH");
    await rpc.confirmTransaction({
      signature: row.signature, blockhash: row.blockhash,
      lastValidBlockHeight: row.last_valid_block_height,
    }, "confirmed");
  } catch (error) {
    // Don't sign a second transaction even when broadcast confirmation is delayed.
    console.warn("[vhouse-crypto-transfer] Send pending:", String(error));
  }
  const confirmed = await readChain();
  if (confirmed) return confirmed;
  await updateStatus(db, row, "PENDING");
  return { status: "PENDING", ...result() };
}
function earnedBags(snapshot: any, symbol: string) {
  // Read the authoritative result for each won encounter, not client counts.
  const results = snapshot?.results;
  if (!Array.isArray(results)) throw Error("INVALID_JOURNEY_RESULTS");
  let bags = 0;
  for (const result of results) {
    if (result?.won !== true) continue;
    const earned = Array.isArray(result.rewards) ? result.rewards : [];
    for (const reward of earned) {
      if (reward?.item !== "CRYPTO" || reward?.token !== symbol) continue;
      const count = Number(reward.batches ?? 1);
      if (!Number.isSafeInteger(count) || count <= 0) throw Error("INVALID_CRYPTO_BAGS");
      bags += count;
      if (!Number.isSafeInteger(bags)) throw Error("INVALID_CRYPTO_BAGS");
    }
  }
  return bags;
}
async function earnedRaidBags(db: ReturnType<typeof createClient>,
  playerId: string, raidId: string, symbol: string, results: any[]) {
  // Revalidate DB-stored rewards against authoritative results. Never trust client counts.
  const {data,error}=await db.from("vhouse_raid_crypto_bags")
    .select("boss,token_symbol,usd_cents,payout_status")
    .eq("player_id",playerId).eq("raid_id",raidId)
    .eq("token_symbol",symbol);
  if(error) throw Error("PAYOUT_RECORD_UNAVAILABLE");
  const awarded=data||[];
  if(awarded.length>10) throw Error("INVALID_CRYPTO_BAGS");
  const bossResults=new Map(results.map(x=>[x.boss,x]));
  let usdCents=0;
  for(const bag of awarded) {
    const recorded=bossResults.get(bag.boss);
    const detail=recorded?.raidCryptoBag;
    if(recorded?.win!==true || detail?.token!==symbol ||
      detail?.label!=="RAID CRYPTO BAG" ||
      detail?.usdCents!==bag.usd_cents ||
      !Number.isSafeInteger(bag.usd_cents) ||
      bag.usd_cents<10 || bag.usd_cents>25 ||
      bag.payout_status!=="EARNED")
      throw Error("INVALID_RAID_CRYPTO_BAGS");
    usdCents+=bag.usd_cents;
  }
  return {bags:awarded.length,usdCents};
}
async function prepareSignedTransfer(
  db: ReturnType<typeof createClient>, rpc: Connection,
  sender: Keypair, playerId: string, referenceId: string,
  symbol: "SOL" | "AWT", bags: number, wallet: string,
  raidUsdCents?: number,
) {
  const recipient = new PublicKey(wallet);
  const isSol = symbol === "SOL";
  const mintAddress = isSol ? null : AWT_MINT;
  const tokenMint = mintAddress ? new PublicKey(mintAddress) : null;
  let decimals = 9;
  let tokenProgram = TOKEN_PROGRAM_ID;
  let sourceAta: PublicKey | null = null;
  let destinationAta: PublicKey | null = null;
  let createAccount = false;
  let rent = 0;
  let availableTokens = 0n;
  const tx = new Transaction();
  if (!isSol && tokenMint) {
    const mintInfo = await rpc.getParsedAccountInfo(tokenMint, "confirmed");
    const program = mintInfo.value?.owner;
    if (!program || (!program.equals(TOKEN_PROGRAM_ID) &&
      !program.equals(TOKEN_2022_PROGRAM_ID))) throw Error("AWT_MINT_UNAVAILABLE");
    tokenProgram = program;
    const count = mintInfo.value?.data?.parsed?.info?.decimals;
    if (!Number.isInteger(count) || count < 0 || count > 18) throw Error("AWT_DECIMALS_UNAVAILABLE");
    decimals = count;
    const sourceAccounts = await rpc.getParsedTokenAccountsByOwner(sender.publicKey, { mint: tokenMint }, "confirmed");
    sourceAta = getAssociatedTokenAddressSync(tokenMint, sender.publicKey, false, tokenProgram);
    const source = sourceAccounts.value.find(x => x.pubkey.equals(sourceAta));
    availableTokens = source ? atomic(source.account.data.parsed.info.tokenAmount.amount) : 0n;
    destinationAta = getAssociatedTokenAddressSync(tokenMint, recipient, false, tokenProgram);
    const recipientAccount = await rpc.getAccountInfo(destinationAta, "confirmed");
    createAccount = !recipientAccount;
    if (createAccount) {
      tx.add(createAssociatedTokenAccountInstruction(
        sender.publicKey, destinationAta, recipient, tokenMint, tokenProgram,
      ));
      rent = await rpc.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed");
    }
  }
  const price = await priceUsd(symbol, mintAddress || undefined);
  const amount = raidUsdCents===undefined
    ?unitsForBags(bags,price,decimals)
    :unitsForUsdCents(BigInt(raidUsdCents),price,decimals);
  if (amount <= 0n) throw Error("INVALID_CRYPTO_BAGS");
  if (isSol) {
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("INVALID_CRYPTO_BAGS");
    tx.add(SystemProgram.transfer({
      fromPubkey: sender.publicKey, toPubkey: recipient, lamports: Number(amount),
    }));
  } else if (tokenMint && sourceAta && destinationAta) {
    tx.add(createTransferCheckedInstruction(
      sourceAta, tokenMint, destinationAta, sender.publicKey,
      amount, decimals, [], tokenProgram,
    ));
  }
  const recent = await rpc.getLatestBlockhash("confirmed");
  tx.feePayer = sender.publicKey;
  tx.recentBlockhash = recent.blockhash;
  const [feeResult, solBalance] = await Promise.all([
    rpc.getFeeForMessage(tx.compileMessage(), "confirmed"),
    rpc.getBalance(sender.publicKey, "confirmed"),
  ]);
  if (feeResult.value === null) throw Error("NETWORK_FEE_UNAVAILABLE");
  const solNeeded = BigInt(feeResult.value + rent) + (isSol ? amount : 0n);
  if (BigInt(solBalance) < solNeeded || (!isSol && availableTokens < amount)) {
    return {
      status: "NOT ENOUGH",
      token: symbol, bags,
      reason: !isSol && availableTokens < amount ? "AWT_TOKENS" : "SOL_FEES",
      tokenAmountRequired: display(amount, decimals),
      tokenAmountAvailable: isSol ? display(BigInt(solBalance), 9) : display(availableTokens, decimals),
      solAvailableLamports: solBalance,
      solRequiredLamports: solNeeded.toString(),
    };
  }
  tx.sign(sender);
  if (!tx.signature) throw Error("TRANSACTION_SIGNING_FAILED");
  const signature = bs58.encode(tx.signature);
  const signed = btoa(String.fromCharCode(...tx.serialize()));
  const row = {
    player_id: playerId,
    ...(raidUsdCents===undefined ? { mission_id: referenceId } : {
      raid_id: referenceId, usd_cents: raidUsdCents
    }),token_symbol: symbol,
    token_mint: mintAddress, bags, amount_atomic: amount.toString(), token_decimals: decimals,
    source_wallet: sender.publicKey.toBase58(),
    recipient_wallet: recipient.toBase58(), signature,
    signed_transaction_base64: signed,
    blockhash: recent.blockhash, last_valid_block_height: recent.lastValidBlockHeight,
    status: "SIGNED",
  };
  // Separate unique (Raid,token) / (Journey,token) prevents duplicate transfers.
  const isRaid=raidUsdCents!==undefined;
  const { error } = await db.from(payoutTable(isRaid)).insert(row);
  if (error) {
    if (error.code === "23505") {
      const already = await existingPayout(db,playerId,referenceId,symbol,isRaid);
      if (already) return continueSignedTransfer(db,rpc,already);
    }
    throw Error("PAYOUT_RECORD_UNAVAILABLE");
  }
  return continueSignedTransfer(db,rpc,row as Payout);
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
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
    if (verified.error || !verified.data?.user?.id)
      return response({ error: "SIGN_IN_REQUIRED" }, 401);
    const body = await req.json().catch(() => null);
    const missionId = typeof body?.missionId === "string" ? body.missionId.trim() : "";
    const raidId = typeof body?.raidId === "string" ? body.raidId.trim() : "";
    const raidMode=raidId.length>0 || body?.raidId!==undefined;
    const symbol = body?.token === "SOL" || body?.token === "AWT" ? body.token : null;
    if (!symbol || (raidMode
      ? !!missionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raidId)
      : !missionId || missionId.length>200)) {
      return response({ error: "INVALID_CRYPTO_REQUEST" }, 400);
    }
    const playerId = verified.data.user.id;
    const db = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const referenceId=raidMode?raidId:missionId;
    const existing = await existingPayout(db,playerId,referenceId,symbol,raidMode);
    const rpc = connection();
    if (existing) return response(await continueSignedTransfer(db, rpc, existing));
    if(raidMode) {
      const [raid,account]=await Promise.all([
        db.from("vhouse_raid_records").select("status,boss_results")
          .eq("player_id",playerId).eq("id",raidId).maybeSingle(),
        db.from("vhouse_accounts").select("wallet_address")
          .eq("id",playerId).maybeSingle(),
      ]);
      if(raid.error||account.error) throw Error("PAYOUT_RECORD_UNAVAILABLE");
      if(raid.data?.status!=="RESULTS_READY")
        return response({error:"RESULTS_NOT_READY"},409);
      if(!Array.isArray(raid.data.boss_results))
        throw Error("INVALID_RAID_CRYPTO_BAGS");
      const award=await earnedRaidBags(db,playerId,raidId,symbol,raid.data.boss_results);
      if(!award.bags) return response({status:"NO BAGS",token:symbol,bags:0});
      if(!account.data?.wallet_address)
        return response({error:"PLAYER_WALLET_NOT_LINKED"},409);
      const sender=senderFromSecret();
      return response(await prepareSignedTransfer(db,rpc,sender,playerId,raidId,
        symbol,award.bags,account.data.wallet_address,award.usdCents));
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
    const bags = earnedBags(journey.data.snapshot, symbol);
    if (!bags) return response({ status: "NO BAGS", token: symbol, bags: 0 });
    const wallet = account.data?.wallet_address;
    if (!wallet) return response({ error: "PLAYER_WALLET_NOT_LINKED" }, 409);
    const sender = senderFromSecret();
    return response(await prepareSignedTransfer(
      db, rpc, sender, playerId, missionId, symbol, bags, wallet,
    ));
  } catch (error) {
    console.error("[vhouse-crypto-transfer]", String(error));
    const message = error instanceof Error ? error.message : "";
    const allowed = new Set([
      "PAYOUT_RECORD_UNAVAILABLE", "PAYOUT_STATUS_SAVE_FAILED",
      "VHOUSE_WALLET_NOT_CONFIGURED", "VHOUSE_WALLET_KEY_INVALID",
      "AWT_MINT_UNAVAILABLE",
      "AWT_DECIMALS_UNAVAILABLE", "CRYPTO_MARKET_UNAVAILABLE",
      "NETWORK_FEE_UNAVAILABLE", "INVALID_CRYPTO_BAGS",
      "INVALID_JOURNEY_RESULTS", "INVALID_RAID_CRYPTO_BAGS",
      "SUPABASE_NOT_CONFIGURED",
    ]);
    return response({ error: allowed.has(message) ? message : "CRYPTO_TRANSFER_UNAVAILABLE" }, 503);
  }
});