import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection } from "npm:@solana/web3.js@1.98.4";

const TREASURY = "CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK";
const LAMPORTS = 1_000_000;
const RAID_TREASURY = TREASURY;
const RAID_USD_CENTS = 75;
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

async function raidSolPrice() {
  const providers=[
    {url:"https://api.coinbase.com/v2/prices/SOL-USD/spot",read:(o:any)=>o?.data?.amount},
    {url:"https://api.kraken.com/0/public/Ticker?pair=SOLUSD",
      read:(o:any)=>(Object.values(o?.result||{})[0] as any)?.c?.[0]},
    {url:"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      read:(o:any)=>o?.solana?.usd},
  ];
  for(const provider of providers) {
    try{
      const r=await fetch(provider.url,{headers:{accept:"application/json"},
        cache:"no-store",signal:AbortSignal.timeout(6000)});
      if(!r.ok)continue;
      const p=Number(provider.read(await r.json()));
      if(Number.isFinite(p)&&p>0)return p;
    }catch(error){console.warn("[raid-entry] SOL quote provider:",String(error));}
  }
  throw Error("RAID_ENTRY_PRICE_UNAVAILABLE");
}
async function raidEntry(reqBody:any, db:ReturnType<typeof createClient>, playerId:string) {
  const action=reqBody?.action;
  const cardId=typeof reqBody?.cardId==="string"?reqBody.cardId.trim():"";
  const level=Number(reqBody?.level||1);
  const quoteId=typeof reqBody?.quoteId==="string"?reqBody.quoteId.trim():"";
  const signature=typeof reqBody?.signature==="string"?reqBody.signature.trim():"";
  const {data:account,error:accountError}=await db.from("vhouse_accounts")
    .select("wallet_address").eq("id",playerId).maybeSingle();
  if(accountError)throw Error("PLAYER_WALLET_LOOKUP_FAILED");
  const wallet=account?.wallet_address;
  if(!wallet)return reply({error:"PLAYER_WALLET_NOT_LINKED"},409);

  if(action==="quote") {
    if(!cardId || cardId.length>200 || !Number.isInteger(level) || level<1 || level>3)
      return reply({error:"INVALID_RAID_ENTRY"},400);
    // One unused verified entry remains spendable, preventing an accidental second payment.
    const {data:paid,error:paidError}=await db.from("vhouse_raid_entry_payments")
      .select("id,card_id,raid_level,amount_lamports,signature,verified_at,consumed_at,expires_at")
      .eq("player_id",playerId).eq("card_id",cardId).eq("raid_level",level)
      .eq("wallet_address",wallet).not("verified_at","is",null)
      .is("consumed_at",null).order("created_at",{ascending:false}).limit(1);
    if(paidError)throw Error("RAID_ENTRY_LOOKUP_FAILED");
    if(paid?.length) {
      const q=paid[0];
      return reply({quoteId:q.id,lamports:q.amount_lamports,
        walletAddress:wallet,treasury:RAID_TREASURY,
        verified:true,signature:q.signature,usdCents:RAID_USD_CENTS});
    }
    const {data:pending,error:pendingError}=await db.from("vhouse_raid_entry_payments")
      .select("*").eq("player_id",playerId).eq("card_id",cardId).eq("raid_level",level)
      .eq("wallet_address",wallet).is("consumed_at",null)
      .is("verified_at",null).gt("expires_at",new Date().toISOString())
      .order("created_at",{ascending:false}).limit(1);
    if(pendingError)throw Error("RAID_ENTRY_LOOKUP_FAILED");
    let q=pending?.[0];
    if(!q){
      const price=await raidSolPrice();
      // Round up to lamports; $0.75 minimum at the quoted SOL/USD rate.
      const lamports=Math.ceil((RAID_USD_CENTS/100)*1e9/price);
      if(!Number.isSafeInteger(lamports)||lamports<=0)throw Error("RAID_ENTRY_PRICE_UNAVAILABLE");
      const {data, error}=await db.from("vhouse_raid_entry_payments")
        .insert({player_id:playerId,card_id:cardId,raid_level:level,
          usd_cents:RAID_USD_CENTS,sol_usd:price,amount_lamports:lamports,
          wallet_address:wallet,destination_wallet:RAID_TREASURY,
          expires_at:new Date(Date.now()+15*60_000).toISOString()})
        .select("*").single();
      if(error)throw Error("RAID_ENTRY_QUOTE_FAILED");
      q=data;
    }
    return reply({quoteId:q.id,lamports:q.amount_lamports,usdCents:RAID_USD_CENTS,
      treasury:RAID_TREASURY,walletAddress:wallet,verified:false,
      expiresAt:q.expires_at,signature:q.signature||""});
  }
  if(action!=="verify")return reply({error:"INVALID_RAID_ENTRY"},400);
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(quoteId)||
     !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature))
    return reply({error:"INVALID_PAYMENT_RECEIPT"},400);
  const {data:q,error:qError}=await db.from("vhouse_raid_entry_payments")
    .select("*").eq("id",quoteId).eq("player_id",playerId).maybeSingle();
  if(qError)throw Error("RAID_ENTRY_LOOKUP_FAILED");
  if(!q||q.wallet_address!==wallet||q.usd_cents!==RAID_USD_CENTS||
      q.destination_wallet!==RAID_TREASURY)
    return reply({error:"RAID_ENTRY_QUOTE_MISMATCH"},409);
  if(q.signature&&q.signature!==signature)
    return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
  if(q.verified_at)return reply({verified:true,signature,quoteId:q.id,consumed:!!q.consumed_at});
  const {data:existing,error:existingError}=await db.from("vhouse_raid_entry_payments")
    .select("id").eq("signature",signature).maybeSingle();
  if(existingError)throw Error("RAID_ENTRY_LOOKUP_FAILED");
  if(existing&&existing.id!==quoteId)return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
  const tx=await readConfirmedTransaction(signature);
  if(!tx)return reply({verified:false,error:"PAYMENT_CONFIRMATION_PENDING"},202);
  if(!tx.meta||tx.meta.err!==null)return reply({error:"PAYMENT_FAILED_ONCHAIN"},409);
  const keys=tx.transaction.message.accountKeys;
  const ownerSigned=keys.some(k=>k.signer&&k.pubkey.toBase58()===wallet);
  const payment=tx.transaction.message.instructions.some(ix=>
    "parsed" in ix && ix.program==="system" && ix.parsed?.type==="transfer" &&
    ix.parsed?.info?.source===wallet &&
    ix.parsed?.info?.destination===RAID_TREASURY &&
    Number(ix.parsed?.info?.lamports)===Number(q.amount_lamports));
  const expectedMemo="VHOUSE:RAID:"+q.id;
  const memo=tx.transaction.message.instructions.some(ix=>
    ix.programId.toBase58()===MEMO_PROGRAM && "parsed" in ix &&
    (ix.parsed===expectedMemo||ix.parsed?.info?.memo===expectedMemo));
  const paidAt=(tx.blockTime||0)*1000;
  const timeValid=paidAt>=new Date(q.created_at).getTime()-60000 &&
    paidAt<=new Date(q.expires_at).getTime();
  if(!ownerSigned||!payment||!memo||!timeValid)
    return reply({error:"PAYMENT_RECEIPT_MISMATCH"},409);
  const {data:confirmed,error:updateError}=await db.from("vhouse_raid_entry_payments")
    .update({signature,verified_at:new Date().toISOString()})
    .eq("id",q.id).is("verified_at",null).is("consumed_at",null)
    .select("id").maybeSingle();
  if(updateError) {
    if(updateError.code==="23505")return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
    throw Error("PAYMENT_RECORD_FAILED");
  }
  if(!confirmed) {
    const {data:again}=await db.from("vhouse_raid_entry_payments")
      .select("signature,verified_at").eq("id",q.id).maybeSingle();
    if(again?.signature===signature&&again?.verified_at)
      return reply({verified:true,signature,quoteId:q.id});
    return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
  }
  return reply({verified:true,signature,quoteId:q.id});
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
    if(body?.kind==="RAID_ENTRY"){
      const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
      return await raidEntry(body,db,auth.user.id);
    }
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
      "RAID_ENTRY_LOOKUP_FAILED", "RAID_ENTRY_QUOTE_FAILED",
      "RAID_ENTRY_PRICE_UNAVAILABLE",
    ]);
    return reply({ error: allowed.has(code) ? code : "PAYMENT_VERIFICATION_UNAVAILABLE" }, 503);
  }
});