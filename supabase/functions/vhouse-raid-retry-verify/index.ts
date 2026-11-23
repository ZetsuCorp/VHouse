import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection } from "npm:@solana/web3.js@1.98.4";

// Paid continuation is separate from the existing $0.75 Raid entry.
const TREASURY="CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK";
const CENTS=50;
const MEMO_PROGRAM="MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const CORS={
  "Access-Control-Allow-Origin":"https://zetsucorp.github.io",
  "Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
};
const reply=(data:Record<string,unknown>,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{...CORS,"Content-Type":"application/json"},
});
const validSignature=(value:string)=>/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value);
const validUuid=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function solUsdPrice():Promise<number>{
  const sources=[
    {url:"https://api.coinbase.com/v2/prices/SOL-USD/spot",read:(o:any)=>o?.data?.amount},
    {url:"https://api.kraken.com/0/public/Ticker?pair=SOLUSD",read:(o:any)=>(Object.values(o?.result||{})[0] as any)?.c?.[0]},
    {url:"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",read:(o:any)=>o?.solana?.usd},
  ];
  for(const source of sources){
    try{
      const response=await fetch(source.url,{headers:{accept:"application/json"},
        cache:"no-store",signal:AbortSignal.timeout(6000)});
      if(!response.ok)continue;
      const price=Number(source.read(await response.json()));
      if(Number.isFinite(price)&&price>0)return price;
    }catch(error){console.warn("[paid-raid-retry] SOL price:",String(error));}
  }
  throw Error("RETRY_PRICE_UNAVAILABLE");
}
async function readConfirmedTransaction(signature:string){
  const endpoints=[...new Set([Deno.env.get("SOLANA_RPC_URL"),
    "https://api.mainnet-beta.solana.com","https://api.mainnet.solana.com",
    "https://solana-rpc.publicnode.com"].filter(Boolean))] as string[];
  let reachable=false;
  for(const endpoint of endpoints){
    try{
      const rpc=new Connection(endpoint,"confirmed");
      const tx=await rpc.getParsedTransaction(signature,{
        commitment:"confirmed",maxSupportedTransactionVersion:0});
      reachable=true;
      if(tx)return tx;
    }catch(error){console.warn("[paid-raid-retry] receipt:",String(error));}
  }
  if(!reachable)throw Error("SOLANA_RPC_UNAVAILABLE");
  return null;
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
  if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
  try{
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
    if(!token)return reply({error:"SIGN_IN_REQUIRED"},401);
    const url=Deno.env.get("SUPABASE_URL");
    const anon=Deno.env.get("SUPABASE_ANON_KEY");
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!anon||!service)throw Error("SUPABASE_NOT_CONFIGURED");
    const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:auth,error:authError}=await authClient.auth.getUser(token);
    if(authError||!auth.user?.id)return reply({error:"SIGN_IN_REQUIRED"},401);
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const body=await req.json().catch(()=>null);
    const action=body?.action;
    const raidId=typeof body?.raidId==="string"?body.raidId:"";
    const quoteId=typeof body?.quoteId==="string"?body.quoteId:"";
    const signature=typeof body?.signature==="string"?body.signature:"";
    const playerId=auth.user.id;
    if(!validUuid(raidId))return reply({error:"INVALID_RAID"},400);
    if(!["quote","submit","verify"].includes(action))
      return reply({error:"INVALID_RETRY_ACTION"},400);

    const {data:account,error:accountError}=await db.from("vhouse_accounts")
      .select("wallet_address,tower_raid_free_retry_used").eq("id",playerId).maybeSingle();
    if(accountError)throw Error("RETRY_ACCOUNT_LOOKUP_FAILED");
    if(!account?.wallet_address)return reply({error:"PLAYER_WALLET_NOT_LINKED"},409);
    if(account.tower_raid_free_retry_used!==true)
      return reply({error:"FREE_RETRY_STILL_AVAILABLE"},409);
    const wallet=account.wallet_address;

    // All quote/verify actions are restricted to the player's unresolved, defeated Raid.
    const {data:raid,error:raidError}=await db.from("vhouse_raid_records")
      .select("id,player_id,status,confirmed_at,current_boss,boss_hits,boss_results")
      .eq("id",raidId).eq("player_id",playerId).maybeSingle();
    if(raidError)throw Error("RETRY_RAID_LOOKUP_FAILED");
    const last=raid?.boss_results?.at(-1);
    if(!raid||raid.status!=="RESULTS_READY"||raid.confirmed_at||
       last?.win!==false||Number(last?.boss)!==Number(raid.current_boss)||
       Number(raid.boss_hits)!==3)
      return reply({error:"RAID_NOT_ELIGIBLE_FOR_RETRY"},409);

    const [transfers,bags]=await Promise.all([
      db.from("vhouse_raid_crypto_transfers").select("id").eq("raid_id",raidId).limit(1),
      db.from("vhouse_raid_crypto_bags").select("id").eq("raid_id",raidId)
        .neq("payout_status","EARNED").limit(1),
    ]);
    if(transfers.error||bags.error)throw Error("RETRY_SETTLEMENT_LOOKUP_FAILED");
    if(transfers.data?.length||bags.data?.length)
      return reply({error:"RAID_PAYOUT_ALREADY_STARTED"},409);

    const boss=Number(raid.current_boss);
    const base=db.from("vhouse_raid_retry_payments");
    if(action==="quote"){
      // Verified quotes stay spendable until consumed, even after the quote expires.
      const {data:unspent,error:unspentError}=await base.select("*")
        .eq("player_id",playerId).eq("raid_id",raidId).eq("boss",boss)
        .eq("wallet_address",wallet).is("consumed_at",null)
        .order("created_at",{ascending:false}).limit(20);
      if(unspentError)throw Error("RETRY_PAYMENT_LOOKUP_FAILED");
      const now=Date.now();
      const saved=(unspent||[]).find(q=>q.verified_at&&q.signature)
        ||(unspent||[]).find(q=>q.signature)
        ||(unspent||[]).find(q=>new Date(q.expires_at).getTime()>now);
      if(saved)return reply({
        quoteId:saved.id,lamports:saved.amount_lamports,
        walletAddress:wallet,treasury:TREASURY,
        usdCents:CENTS,verified:!!saved.verified_at,
        signature:saved.signature||"",expiresAt:saved.expires_at,
      });
      const price=await solUsdPrice();
      const lamports=Math.ceil((CENTS/100)*1e9/price);
      if(!Number.isSafeInteger(lamports)||lamports<=0)throw Error("RETRY_PRICE_UNAVAILABLE");
      const {data:created,error:insertError}=await base.insert({
        player_id:playerId,raid_id:raidId,boss,usd_cents:CENTS,
        sol_usd:price,amount_lamports:lamports,wallet_address:wallet,
        destination_wallet:TREASURY,
        expires_at:new Date(Date.now()+15*60_000).toISOString(),
      }).select("*").single();
      if(insertError)throw Error("RETRY_QUOTE_FAILED");
      return reply({quoteId:created.id,lamports:created.amount_lamports,
        walletAddress:wallet,treasury:TREASURY,usdCents:CENTS,
        verified:false,signature:"",expiresAt:created.expires_at});
    }

    if(!validUuid(quoteId)||!validSignature(signature))
      return reply({error:"INVALID_PAYMENT_RECEIPT"},400);
    const {data:q,error:qError}=await base.select("*")
      .eq("id",quoteId).eq("player_id",playerId).eq("raid_id",raidId).maybeSingle();
    if(qError)throw Error("RETRY_PAYMENT_LOOKUP_FAILED");
    if(!q||q.wallet_address!==wallet||q.destination_wallet!==TREASURY||
       Number(q.boss)!==boss||Number(q.usd_cents)!==CENTS||q.consumed_at)
      return reply({error:"RETRY_QUOTE_MISMATCH"},409);
    if(q.signature&&q.signature!==signature)
      return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
    if(q.verified_at)
      return reply({verified:true,signature,quoteId:q.id,consumed:!!q.consumed_at});

    // Save Phantom's submitted signature so refresh/retry does not ask to pay twice.
    if(action==="submit"){
      const {data:assigned,error:assignError}=await base.update({signature})
        .eq("id",q.id).is("signature",null).is("consumed_at",null)
        .select("id").maybeSingle();
      if(assignError){
        if(assignError.code==="23505")return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
        throw Error("RETRY_SIGNATURE_SAVE_FAILED");
      }
      if(!assigned){
        const {data:again}=await base.select("signature").eq("id",q.id).maybeSingle();
        if(again?.signature!==signature)return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
      }
      return reply({submitted:true,quoteId:q.id,signature});
    }

    // Verify signed transfer, exact quoted lamports, quote-bound memo, and wallet.
    const tx=await readConfirmedTransaction(signature);
    if(!tx)return reply({verified:false,error:"PAYMENT_CONFIRMATION_PENDING"},202);
    if(!tx.meta||tx.meta.err!==null)return reply({error:"PAYMENT_FAILED_ONCHAIN"},409);
    const keys=tx.transaction.message.accountKeys;
    const ownerSigned=keys.some(k=>k.signer&&k.pubkey.toBase58()===wallet);
    const instructions=tx.transaction.message.instructions;
    const payment=instructions.some(ix=>
      "parsed" in ix && ix.program==="system"&&ix.parsed?.type==="transfer"&&
      ix.parsed?.info?.source===wallet&&
      ix.parsed?.info?.destination===TREASURY&&
      Number(ix.parsed?.info?.lamports)===Number(q.amount_lamports));
    const expectedMemo="VHOUSE:RAID:RETRY:"+q.id;
    const memo=instructions.some(ix=>ix.programId.toBase58()===MEMO_PROGRAM&&
      "parsed" in ix &&(ix.parsed===expectedMemo||ix.parsed?.info?.memo===expectedMemo));
    const paidAt=typeof tx.blockTime==="number"?tx.blockTime*1000:0;
    const timeValid=paidAt>=new Date(q.created_at).getTime()-60000&&
      paidAt<=new Date(q.expires_at).getTime();
    if(!ownerSigned||!payment||!memo||!timeValid)
      return reply({error:"PAYMENT_RECEIPT_MISMATCH"},409);

    const [entry,journey]=await Promise.all([
      db.from("vhouse_raid_entry_payments").select("id").eq("signature",signature).limit(1),
      db.from("vhouse_journey_entry_payments").select("signature").eq("signature",signature).limit(1),
    ]);
    if(entry.error||journey.error)throw Error("RETRY_PAYMENT_LOOKUP_FAILED");
    if(entry.data?.length||journey.data?.length)
      return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);

    const {data:verified,error:verifyError}=await base.update({
      signature,verified_at:new Date().toISOString(),
    }).eq("id",q.id).is("verified_at",null).is("consumed_at",null)
      .select("id").maybeSingle();
    if(verifyError){
      if(verifyError.code==="23505")return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
      throw Error("RETRY_PAYMENT_RECORD_FAILED");
    }
    if(!verified){
      const {data:again}=await base.select("signature,verified_at")
        .eq("id",q.id).maybeSingle();
      if(again?.signature===signature&&again?.verified_at)
        return reply({verified:true,signature,quoteId:q.id});
      return reply({error:"PAYMENT_ALREADY_ASSIGNED"},409);
    }
    return reply({verified:true,signature,quoteId:q.id});
  }catch(error){
    console.error("[paid-raid-retry]",String(error));
    const reason=error instanceof Error?error.message:"";
    const known=new Set([
      "SOLANA_RPC_UNAVAILABLE","SUPABASE_NOT_CONFIGURED",
      "RETRY_ACCOUNT_LOOKUP_FAILED","RETRY_RAID_LOOKUP_FAILED",
      "RETRY_SETTLEMENT_LOOKUP_FAILED","RETRY_PAYMENT_LOOKUP_FAILED",
      "RETRY_PRICE_UNAVAILABLE","RETRY_QUOTE_FAILED",
      "RETRY_SIGNATURE_SAVE_FAILED","RETRY_PAYMENT_RECORD_FAILED",
    ]);
    return reply({error:known.has(reason)?reason:"RETRY_VERIFICATION_UNAVAILABLE"},503);
  }
});