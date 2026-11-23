import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection,Keypair,PublicKey,Transaction,SystemProgram,TransactionInstruction } from "npm:@solana/web3.js@1.98.4";
import bs58 from "npm:bs58@6.0.0";

const EGG="FHCjyvDQD13tryEQsvQmuaPC5RPZWzZzKtZAPAmoHeYk";
const MEMO="MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const CORS={"Access-Control-Allow-Origin":"https://zetsucorp.github.io",
 "Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type",
 "Access-Control-Allow-Methods":"POST,OPTIONS"};
const response=(data:Record<string,unknown>,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{...CORS,"Content-Type":"application/json"}});
const validId=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const validSig=(sig:string)=>/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sig);
function walletKey(){
 const secret=Deno.env.get("VHOUSE_EGG_WALLET_PRIVATE_KEY");
 if(!secret)throw Error("EGG_WALLET_PAYOUT_NOT_CONFIGURED");
 let bytes:Uint8Array;
 try{const value=secret.trim();bytes=value.startsWith("[")?Uint8Array.from(JSON.parse(value)):bs58.decode(value);}
 catch{throw Error("EGG_WALLET_PAYOUT_NOT_CONFIGURED");}
 const signer=bytes.length===64?Keypair.fromSecretKey(bytes):
   bytes.length===32?Keypair.fromSeed(bytes):null;
 if(!signer||signer.publicKey.toBase58()!==EGG)
  throw Error("EGG_WALLET_PAYOUT_NOT_CONFIGURED");
 return signer;
}
function rpc(){return new Connection(Deno.env.get("SOLANA_RPC_URL")||"https://api.mainnet-beta.solana.com","confirmed");}
async function solPrice(){
 const providers=[
  {url:"https://api.coinbase.com/v2/prices/SOL-USD/spot",read:(d:any)=>d?.data?.amount},
  {url:"https://api.kraken.com/0/public/Ticker?pair=SOLUSD",read:(d:any)=>(Object.values(d?.result||{})[0] as any)?.c?.[0]},
  {url:"https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",read:(d:any)=>d?.solana?.usd},
 ];
 for(const p of providers){
  try{const r=await fetch(p.url,{headers:{accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(6000)});
   if(!r.ok)continue;const val=Number(p.read(await r.json()));if(Number.isFinite(val)&&val>0)return val;
  }catch(e){console.warn("[egg-stake] price:",String(e));}
 }
 throw Error("EGG_PRICE_UNAVAILABLE");
}
async function confirmedTx(signature:string){
 let reachable=false;
 for(const url of [...new Set([Deno.env.get("SOLANA_RPC_URL"),
   "https://api.mainnet-beta.solana.com","https://solana-rpc.publicnode.com"].filter(Boolean))] as string[]){
  try{const tx=await new Connection(url,"confirmed").getParsedTransaction(signature,{
   commitment:"confirmed",maxSupportedTransactionVersion:0});
   reachable=true;if(tx)return tx;
  }catch(e){console.warn("[egg-stake] receipt:",String(e));}
 }
 if(!reachable)throw Error("SOLANA_RPC_UNAVAILABLE");
 return null;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return response({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!jwt)return response({error:"SIGN_IN_REQUIRED"},401);
  const url=Deno.env.get("SUPABASE_URL")||"",anon=Deno.env.get("SUPABASE_ANON_KEY")||"",
   secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  if(!url||!anon||!secret)throw Error("SUPABASE_NOT_CONFIGURED");
  const caller=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await caller.auth.getUser(jwt);
  if(authError||!auth.user?.id)return response({error:"SIGN_IN_REQUIRED"},401);
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const player=auth.user.id;
  const body=await req.json().catch(()=>null),action=String(body?.action||"");
  if(!["quote","submit","verify","payout","status"].includes(action))
    return response({error:"INVALID_EGG_ACTION"},400);
  const {data:account,error:accountError}=await db.from("vhouse_accounts")
    .select("wallet_address").eq("id",player).maybeSingle();
  if(accountError)throw Error("EGG_ACCOUNT_LOOKUP_FAILED");
  const wallet=account?.wallet_address;
  if(!wallet)return response({error:"PLAYER_WALLET_NOT_LINKED"},409);
  const store=db.from("vhouse_egg_stakes");

  if(action==="quote"){
   // Do not accept players' funds until signing authority for Egg payouts is present.
   walletKey();
   const cardId=typeof body?.cardId==="string"?body.cardId.trim():"";
   const level=Number(body?.level||1),cents=Number(body?.usdCents);
   if(cardId.length<1||cardId.length>200||!Number.isInteger(level)||level<1||level>3||
      !Number.isSafeInteger(cents)||cents<25||cents%25!==0)
     return response({error:"INVALID_EGG_STAKE"},400);
   const [active,entry,own]=await Promise.all([
    db.from("vhouse_raid_records").select("id").eq("player_id",player)
     .in("status",["ACTIVE","RESULTS_READY"]).limit(1),
    db.from("vhouse_raid_entry_payments").select("id")
     .eq("player_id",player).eq("card_id",cardId).eq("raid_level",level)
     .not("verified_at","is",null).is("consumed_at",null).limit(1),
    db.from("vhouse_accounts").select("active_vcard_id").eq("id",player).maybeSingle(),
   ]);
   if(active.error||entry.error||own.error)throw Error("EGG_STAKE_ELIGIBILITY_UNAVAILABLE");
   if(active.data?.length)return response({error:"RAID_ALREADY_ACTIVE"},409);
   if(!entry.data?.length)return response({error:"RAID_ENTRY_PAYMENT_REQUIRED"},409);
   // Reuse verified but unconsumed quote; never ask for a second payment after submission.
   const {data:existing,error:eError}=await store.select("*").eq("player_id",player)
    .eq("card_id",cardId).eq("raid_level",level).eq("usd_cents",cents)
    .eq("wallet_address",wallet).is("consumed_at",null)
    .order("created_at",{ascending:false}).limit(20);
   if(eError)throw Error("EGG_PAYMENT_LOOKUP_FAILED");
   const now=Date.now();
   const chosen=(existing||[]).find(q=>q.verified_at)||
    (existing||[]).find(q=>q.signature)||
    (existing||[]).find(q=>new Date(q.expires_at).getTime()>now);
   if(chosen)return response({quoteId:chosen.id,lamports:chosen.amount_lamports,
     treasury:EGG,walletAddress:wallet,usdCents:cents,verified:!!chosen.verified_at,
     signature:chosen.signature||""});
   const price=await solPrice();
   const lamports=Math.ceil(cents*1e7/price);
   if(!Number.isSafeInteger(lamports)||lamports<=0)throw Error("EGG_PRICE_UNAVAILABLE");
   const {data:q,error:insertError}=await store.insert({
     player_id:player,card_id:cardId,raid_level:level,usd_cents:cents,
     sol_usd:price,amount_lamports:lamports,wallet_address:wallet,destination_wallet:EGG,
     expires_at:new Date(Date.now()+15*60000).toISOString(),
   }).select("*").single();
   if(insertError)throw Error("EGG_QUOTE_FAILED");
   return response({quoteId:q.id,lamports:q.amount_lamports,
     treasury:EGG,walletAddress:wallet,usdCents:cents,verified:false,signature:""});
  }

  if(action==="submit"||action==="verify"){
   const quoteId=typeof body?.quoteId==="string"?body.quoteId:"",
    signature=typeof body?.signature==="string"?body.signature:"";
   if(!validId(quoteId)||!validSig(signature))
     return response({error:"INVALID_PAYMENT_RECEIPT"},400);
   const {data:q,error:qError}=await store.select("*").eq("id",quoteId)
    .eq("player_id",player).maybeSingle();
   if(qError)throw Error("EGG_PAYMENT_LOOKUP_FAILED");
   if(!q||q.destination_wallet!==EGG||q.wallet_address!==wallet||q.consumed_at)
     return response({error:"EGG_QUOTE_MISMATCH"},409);
   if(q.signature&&q.signature!==signature)
     return response({error:"PAYMENT_ALREADY_ASSIGNED"},409);
   if(q.verified_at)return response({verified:true,quoteId,signature});
   if(action==="submit"){
    const {error:writeError}=await store.update({signature}).eq("id",quoteId)
      .is("signature",null).is("consumed_at",null);
    if(writeError)throw Error("EGG_SIGNATURE_SAVE_FAILED");
    return response({submitted:true,quoteId,signature});
   }
   // Actual chain receipt is authoritative; never trust UI's own payment state.
   const tx=await confirmedTx(signature);
   if(!tx)return response({verified:false,error:"PAYMENT_CONFIRMATION_PENDING"},202);
   if(!tx.meta||tx.meta.err!==null)return response({error:"PAYMENT_FAILED_ONCHAIN"},409);
   const keys=tx.transaction.message.accountKeys;
   const ownerSigned=keys.some(k=>k.signer&&k.pubkey.toBase58()===wallet);
   const instructions=tx.transaction.message.instructions;
   const transferred=instructions.some(ix=>"parsed" in ix&&ix.program==="system"&&
    ix.parsed?.type==="transfer"&&ix.parsed?.info?.source===wallet&&
    ix.parsed?.info?.destination===EGG&&
    Number(ix.parsed?.info?.lamports)===Number(q.amount_lamports));
   const expectedMemo="VHOUSE:EGG:"+q.id;
   const memo=instructions.some(ix=>ix.programId.toBase58()===MEMO&&
    "parsed" in ix&&(ix.parsed===expectedMemo||ix.parsed?.info?.memo===expectedMemo));
   const paidAt=(tx.blockTime||0)*1000;
   if(!ownerSigned||!transferred||!memo||
      paidAt<new Date(q.created_at).getTime()-60000||
      paidAt>new Date(q.expires_at).getTime())
     return response({error:"PAYMENT_RECEIPT_MISMATCH"},409);
   const [entry,retry]=await Promise.all([
    db.from("vhouse_raid_entry_payments").select("id").eq("signature",signature).limit(1),
    db.from("vhouse_raid_retry_payments").select("id").eq("signature",signature).limit(1)
   ]);
   if(entry.error||retry.error)throw Error("EGG_PAYMENT_LOOKUP_FAILED");
   if(entry.data?.length||retry.data?.length)return response({error:"PAYMENT_ALREADY_ASSIGNED"},409);
   const {data:updated,error:saveError}=await store.update({signature,
     verified_at:new Date().toISOString()}).eq("id",q.id)
     .is("verified_at",null).is("consumed_at",null).select("id").maybeSingle();
   if(saveError){
    if(saveError.code==="23505")return response({error:"PAYMENT_ALREADY_ASSIGNED"},409);
    throw Error("EGG_PAYMENT_RECORD_FAILED");
   }
   if(!updated){
    const {data:again}=await store.select("signature,verified_at").eq("id",q.id).maybeSingle();
    if(again?.signature===signature&&again?.verified_at)
     return response({verified:true,quoteId,signature});
    return response({error:"PAYMENT_ALREADY_ASSIGNED"},409);
   }
   return response({verified:true,quoteId,signature});
  }

  const raidId=typeof body?.raidId==="string"?body.raidId:"";
  if(!validId(raidId))return response({error:"INVALID_RAID"},400);
  const {data:q,error:qError}=await store.select("*").eq("raid_id",raidId)
    .eq("player_id",player).maybeSingle();
  if(qError)throw Error("EGG_PAYMENT_LOOKUP_FAILED");
  if(!q)return response({stake:false});
  if(action==="status")return response({stake:true,stakeCents:q.usd_cents,
    stakeLamports:q.amount_lamports,
    wins:q.successful_encounters,multiplier:q.multiplier_quarters/4,
    eggBroken:q.egg_broken,confirmed:!!q.reward_confirmed_at,
    confirmedAt:q.reward_confirmed_at||null,
    payoutLamports:q.payout_lamports||null,
    status:q.payout_status==="TRANSFERRED"?"CONFIRMED":
      q.delivery_last_status==="NOT ENOUGH"?"NOT ENOUGH":
      ["SIGNED","PENDING"].includes(q.payout_status)?"PENDING":q.payout_status,
    reason:q.delivery_last_error||"",
    payoutSignature:q.payout_signature||""});

  if(!q.reward_confirmed_at)return response({error:"EGG_REWARD_CONFIRMATION_REQUIRED"},409);
  if(!q.egg_broken||!["READY","SIGNED","PENDING","TRANSFERRED","EXPIRED_REVIEW"].includes(q.payout_status))
    return response({error:"EGG_NOT_BROKEN"},409);
  if(q.payout_status==="TRANSFERRED")return response({status:"CONFIRMED",
    signature:q.payout_signature,payoutLamports:q.payout_lamports,
    amountSol:Number(q.payout_lamports)/1e9});
  if(q.payout_status==="EXPIRED_REVIEW")return response({status:"EXPIRED_REVIEW",
    signature:q.payout_signature});
  const {data:raid,error:raidError}=await db.from("vhouse_raid_records")
    .select("status,egg_hp,player_id").eq("id",raidId).eq("player_id",player).maybeSingle();
  if(raidError)throw Error("EGG_RAID_LOOKUP_FAILED");
  if(!raid||raid.status!=="RESULTS_READY"||Number(raid.egg_hp)!==0)
    return response({error:"EGG_RAID_NOT_PAYABLE"},409);
  const signer=walletKey();
  const connection=rpc();
  const amount=Number(q.payout_lamports);
  if(!Number.isSafeInteger(amount)||amount<=0)
    return response({error:"EGG_PAYOUT_AMOUNT_INVALID"},409);
  let saved=q;
  if(q.payout_status==="READY"&&!q.payout_signature){
   const latest=await connection.getLatestBlockhash("confirmed");
   const tx=new Transaction().add(SystemProgram.transfer({
     fromPubkey:signer.publicKey,toPubkey:new PublicKey(wallet),lamports:amount
   }));
   tx.feePayer=signer.publicKey;tx.recentBlockhash=latest.blockhash;
   const [fee,balance]=await Promise.all([
     connection.getFeeForMessage(tx.compileMessage(),"confirmed"),
     connection.getBalance(signer.publicKey,"confirmed")
   ]);
   if(balance<amount+(fee.value||5000)){
     await store.update({delivery_checked_at:new Date().toISOString(),
       delivery_last_status:"NOT ENOUGH",delivery_last_error:"EGG_WALLET_NOT_ENOUGH"})
       .eq("id",q.id).eq("payout_status","READY");
     return response({status:"NOT ENOUGH",reason:"EGG_WALLET_NOT_ENOUGH",
       payoutLamports:amount,amountSol:amount/1e9});
   }
   tx.sign(signer);
   const payoutSignature=bs58.encode(tx.signature!);
   const signed=btoa(String.fromCharCode(...tx.serialize()));
   // Commit exact signed bytes before broadcasting. Duplicate calls cannot issue
   // a new signed transaction after the first one is persisted.
   const {data:claimed,error:claimError}=await store.update({
     payout_status:"SIGNED",payout_signature:payoutSignature,
     payout_signed_transaction_base64:signed,
     payout_blockhash:latest.blockhash,
     payout_last_valid_block_height:latest.lastValidBlockHeight,
     delivery_checked_at:new Date().toISOString(),
     delivery_last_status:"PENDING",delivery_last_error:null
   }).eq("id",q.id).eq("payout_status","READY").is("payout_signature",null)
    .select("*").maybeSingle();
   if(claimError)throw Error("EGG_PAYOUT_RECORD_FAILED");
   if(!claimed){
    const {data:already}=await store.select("*").eq("id",q.id).maybeSingle();
    if(!already?.payout_signature)return response({status:"PENDING"},202);
    saved=already;
   }else saved=claimed;
  }
  const payoutSig=saved.payout_signature;
  if(!payoutSig||!saved.payout_signed_transaction_base64)
   return response({status:"PENDING"},202);
  const confirmed=await confirmedTx(payoutSig);
  if(confirmed?.meta?.err===null){
   const {error:recordError}=await store.update({
       payout_status:"TRANSFERRED",payout_at:new Date().toISOString(),
       delivery_checked_at:new Date().toISOString(),
       delivery_last_status:"CONFIRMED",delivery_last_error:null
     }).eq("id",q.id).eq("payout_signature",payoutSig)
     .in("payout_status",["SIGNED","PENDING"]);
   if(recordError)throw Error("EGG_PAYOUT_RECORD_FAILED");
   return response({status:"CONFIRMED",signature:payoutSig,
     payoutLamports:amount,amountSol:amount/1e9});
  }
  if(confirmed?.meta?.err){
    await store.update({payout_status:"EXPIRED_REVIEW",
      delivery_checked_at:new Date().toISOString(),
      delivery_last_status:"EXPIRED_REVIEW",delivery_last_error:"EGG_PAYOUT_CHAIN_FAILURE"})
      .eq("id",q.id).eq("payout_signature",payoutSig);
    return response({status:"EXPIRED_REVIEW",signature:payoutSig,
      reason:"EGG_PAYOUT_CHAIN_FAILURE",payoutLamports:amount});
  }
  if(await connection.getBlockHeight("confirmed")>Number(saved.payout_last_valid_block_height)){
   await store.update({payout_status:"EXPIRED_REVIEW",
      delivery_checked_at:new Date().toISOString(),
      delivery_last_status:"EXPIRED_REVIEW",delivery_last_error:"EGG_PAYOUT_EXPIRED"})
      .eq("id",q.id).in("payout_status",["SIGNED","PENDING"]);
   return response({status:"EXPIRED_REVIEW",signature:payoutSig});
  }
  try{
   const raw=Uint8Array.from(atob(saved.payout_signed_transaction_base64),
     c=>c.charCodeAt(0));
   const sent=await connection.sendRawTransaction(raw,{skipPreflight:false,maxRetries:3});
   if(sent!==payoutSig)throw Error("EGG_SIGNATURE_MISMATCH");
  }catch(e){console.warn("[egg-stake] broadcast:",String(e));}
  await store.update({payout_status:"PENDING",
    delivery_checked_at:new Date().toISOString(),delivery_last_status:"PENDING",
    delivery_last_error:null}).eq("id",q.id).eq("payout_status","SIGNED");
  return response({status:"PENDING",signature:payoutSig,
    payoutLamports:amount,amountSol:amount/1e9});
 }catch(e){
  const code=e instanceof Error?e.message:"UNKNOWN";
  console.error("[egg-stake]",code);
  const allow=new Set(["EGG_WALLET_PAYOUT_NOT_CONFIGURED","EGG_PRICE_UNAVAILABLE",
   "EGG_STAKE_ELIGIBILITY_UNAVAILABLE","EGG_PAYMENT_LOOKUP_FAILED",
   "EGG_QUOTE_FAILED","SOLANA_RPC_UNAVAILABLE","EGG_PAYMENT_RECORD_FAILED",
   "EGG_SIGNATURE_SAVE_FAILED","EGG_ACCOUNT_LOOKUP_FAILED","EGG_RAID_LOOKUP_FAILED",
   "EGG_PAYOUT_RECORD_FAILED","SUPABASE_NOT_CONFIGURED"]);
  return response({error:allow.has(code)?code:"EGG_SERVICE_UNAVAILABLE"},503);
 }
});