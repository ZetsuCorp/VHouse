/* VHouse Billboard: existing VCard receipt + Load/Burn Solana RPC + Solscan balance.
   Only server reads SOLSCAN_API_KEY. Real balance snapshots are stored for graph history. */
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const cors = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS",
};
const send=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}
});
type O=Record<string,unknown>;
const obj=(v:unknown):O=>v && typeof v==="object" && !Array.isArray(v)?v as O:{};
const str=(v:unknown)=>typeof v==="string" && v.trim()?v.trim():null;
const num=(v:unknown)=>v!==null && v!==undefined && v!=="" && Number.isSafeInteger(Number(v)) && Number(v)>=0?Number(v):null;
const address=(v:unknown)=>typeof v==="string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const signature=(v:unknown)=>typeof v==="string" && /^[1-9A-HJ-NP-Za-km-z]{60,90}$/.test(v);
const TOKEN_2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const RPC_URLS=[
 "https://solana-rpc.publicnode.com",
 "https://rpc.solanatracker.io/public",
 "https://api.mainnet-beta.solana.com",
]; // Exactly the existing VCard Load/Burn endpoint order.
const RECENT=100;

async function rpc(method:string,params:unknown){
 let last="";
 for(const url of RPC_URLS){
  try{
   const response=await fetch(url,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),
    signal:AbortSignal.timeout(5500)
   });
   if(!response.ok)throw Error("HTTP "+response.status);
   const result=await response.json();
   if(result.error)throw Error(str(result.error.message)||"Solana RPC error");
   return result.result;
  }catch(e){last=e instanceof Error?e.message:String(e);}
 }
 throw Error("Solana RPC unavailable: "+last);
}
function nftURL(uri:unknown){
 const value=str(uri);
 if(!value)return null;
 if(/^ipfs:\/\/[a-zA-Z0-9/._-]+$/.test(value))
  return "https://gateway.pinata.cloud/ipfs/"+value.slice(7);
 try{
  const u=new URL(value);
  if(u.protocol==="https:" && ["gateway.pinata.cloud","ipfs.io","dweb.link"].includes(u.hostname) && u.pathname.startsWith("/ipfs/"))
   return value;
 }catch{ /* invalid URL */ }
 return null;
}
async function mintDetails(mint:string,receipt:O){
 const value=obj(obj(await rpc("getAccountInfo",[mint,{encoding:"jsonParsed",commitment:"confirmed"}])).value);
 if(!Object.keys(value).length)throw Error("NFT mint not found");
 const info=obj(obj(obj(value.data).parsed).info);
 const extensions=(Array.isArray(info.extensions)?info.extensions:[]).map(obj);
 const find=(name:string)=>extensions.find(e=>String(e.extension||"").toLowerCase()===name.toLowerCase());
 // Account extensions use parsed info.state. Load/Burn obtains the same fields via getMint/getTokenMetadata.
 const tokenMeta=obj(find("tokenMetadata")?.state);
 const close=obj(find("mintCloseAuthority")?.state);
 const uri=str(tokenMeta.uri)||str(receipt.metadata_uri);
 let metadata:O={};
 const url=nftURL(uri);
 if(url){
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(6500)});
   if(response.ok)metadata=obj(await response.json());
  }catch(e){console.warn("[VHouse Billboard] NFT JSON",e instanceof Error?e.message:String(e));}
 }
 const raw=Array.isArray(tokenMeta.additionalMetadata)?tokenMeta.additionalMetadata:[];
 const onchainTraits=raw.filter((x:unknown)=>Array.isArray(x)&&x.length===2).map((x:unknown)=>({
  trait_type:(x as string[])[0],value:(x as string[])[1]
 }));
 return {
  tokenStandard:value.owner===TOKEN_2022?"Token-2022":null,
  nftName:str(tokenMeta.name)||str(metadata.name),
  symbol:str(tokenMeta.symbol)||str(metadata.symbol),
  metadataUri:uri,
  updateAuthority:str(tokenMeta.updateAuthority),
  closeAuthority:str(close.closeAuthority)||str(close.authority),
  soulbound:value.owner===TOKEN_2022 ? Boolean(find("nonTransferable")):null,
  imageUri:str(metadata.image)||str(receipt.image_uri),
  description:str(metadata.description),
  attributes:Array.isArray(metadata.attributes)?metadata.attributes:onchainTraits,
  supply:str(info.supply), decimals:num(info.decimals),
  mintAccountLamports:num(value.lamports),
 };
}
async function solscan(path:string,params:Record<string,string>,key:string){
 const url=new URL("https://pro-api.solscan.io/v2.0/"+path);
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const response=await fetch(url,{headers:{accept:"application/json",token:key},signal:AbortSignal.timeout(8500)});
 if(!response.ok)throw Error("Solscan HTTP "+response.status);
 const payload=obj(await response.json());
 if(payload.success!==true)throw Error("Solscan request rejected");
 return payload.data;
}
async function mintOrigin(mint:string,receipt:O){
 if(!signature(receipt.transaction_signature))return {mintedAt:null,initialMintLamports:null};
 try{
  const tx=obj(await rpc("getTransaction",[receipt.transaction_signature,{
   encoding:"jsonParsed",maxSupportedTransactionVersion:0,commitment:"confirmed"
  }]));
  const message=obj(obj(tx.transaction).message);
  const keys=Array.isArray(message.accountKeys)?message.accountKeys:[];
  const index=keys.findIndex((x:unknown)=>typeof x==="string"?x===mint:obj(x).pubkey===mint);
  const post=obj(tx.meta).postBalances;
  const initial=Array.isArray(post)&&index>=0?num(post[index]):null;
  return {mintedAt:typeof tx.blockTime==="number"?tx.blockTime:null,
   initialMintLamports:initial};
 }catch{return {mintedAt:null,initialMintLamports:null};}
}
// The existing VCard's paid edits are recorded only after chain confirmation.
const VHOUSE_TREASURY="CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK";
async function recordEdit(client:ReturnType<typeof createClient>,admin:ReturnType<typeof createClient>,
 playerId:string,payload:O){
 const mint=str(payload.mintAddress),sign=str(payload.signature);
 const mode=str(payload.mode)?.toLowerCase(),owner=str(payload.ownerWallet);
 if(!address(mint)||!signature(sign)||!address(owner)||
    (mode!=="update"&&mode!=="customize"))return send({error:"Invalid VCard edit receipt"},400);
 const [cardResult,accountResult,inventoryResult]=await Promise.all([
  client.from("vcard_list").select("card_id,mint_address,mint_receipt")
    .eq("mint_address",mint).maybeSingle(),
  client.from("vhouse_accounts").select("wallet_address").eq("id",playerId).maybeSingle(),
  client.from("vhouse_player_inventory").select("thing")
    .eq("player_id",playerId).eq("type","VCard").gt("quantity",0)
 ]);
 for(const result of [cardResult,accountResult,inventoryResult])if(result.error)throw result.error;
 const card=cardResult.data,storedOwner=str(obj(card?.mint_receipt).owner_wallet);
 if(!card||storedOwner!==owner||accountResult.data?.wallet_address!==owner||
    !(inventoryResult.data||[]).some((row:O)=>row.thing===card.card_id))
   return send({error:"VCard is not owned by this VHouse player"},403);
 const tx=obj(await rpc("getTransaction",[sign,{
   encoding:"jsonParsed",maxSupportedTransactionVersion:0,commitment:"confirmed"
 }]));
 const meta=obj(tx.meta),message=obj(obj(tx.transaction).message);
 if(!Object.keys(tx).length||!Object.keys(meta).length||meta.err!==null||
    typeof tx.blockTime!=="number")
   return send({error:"VCard edit not confirmed"},409);
 const keys=Array.isArray(message.accountKeys)?message.accountKeys:[];
 if(!keys.some((k:unknown)=>obj(k).pubkey===owner&&obj(k).signer===true))
   return send({error:"Wallet did not sign this transaction"},403);
 const instructions=Array.isArray(message.instructions)?message.instructions.map(obj):[];
 const transfers=instructions.filter(i=>i.program==="system"&&obj(i.parsed).type==="transfer")
   .map(i=>obj(obj(i.parsed).info));
 const housePayments=transfers.filter(t=>t.source===owner&&t.destination===VHOUSE_TREASURY)
   .map(t=>num(t.lamports)??0);
 const mintPayments=transfers.filter(t=>t.source===owner&&t.destination===mint)
   .map(t=>num(t.lamports)??0);
 const paid=housePayments.some(h=>h>=100000&&mintPayments.some(m=>
   m>=50000&&Math.abs(h-2*m)<=3));
 const hasEdit=instructions.some(i=>i.programId===TOKEN_2022&&
   obj(obj(i.parsed).info).metadata===mint&&
   obj(i.parsed).type==="updateTokenMetadataField");
 if(!hasEdit||!paid)return send({error:"Paid VCard edit not found in transaction"},403);
 const {data,error}=await admin.rpc("vhouse_record_verified_vcard_edit",{
  p_card_id:card.card_id,p_mint_address:mint,p_mode:mode,
  p_signature:sign,p_confirmed_at:new Date(tx.blockTime*1000).toISOString()
 });
 if(error)throw error;
 return send({status:"ok",...obj(data)});
}
Deno.serve(async(request:Request)=>{
 if(request.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(request.method!=="POST")return send({error:"Method not allowed"},405);
 try{
  const token=request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return send({error:"VHouse sign-in required"},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY");
  if(!url||!anon)throw Error("Account service unavailable");
  const client=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},
   auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await client.auth.getUser(token);
  if(authError||!auth.user?.id)return send({error:"VHouse sign-in expired"},401);
  const playerId=auth.user.id;
  const payload=obj(await request.json().catch(()=>({})));
  if(payload.action==="record_edit"){
   const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   if(!serviceKey)throw Error("VHouse storage unavailable");
   const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
   return await recordEdit(client,admin,playerId,payload);
  }
  const cardId=payload.cardId;
  if(typeof cardId!=="string"||!cardId||cardId.length>150)return send({error:"Active VCard required"},400);
  const [accountResult,invResult,cardResult,checksResult,chainResult]=await Promise.all([
   client.from("vhouse_accounts").select("active_vcard_id").eq("id",playerId).maybeSingle(),
   client.from("vhouse_player_inventory").select("thing").eq("player_id",playerId)
    .eq("thing",cardId).eq("type","VCard").gt("quantity",0).maybeSingle(),
   client.from("vcard_list").select("card_id,name,image,description,designation,level,atk,def,luck,speed,mint_address,mint_receipt,updates,customizations")
    .eq("card_id",cardId).maybeSingle(),
   client.from("vcard_verification_chain").select("event_id,card_id,state,ex,own,use,quantity,source,checked_at")
    .eq("player_id",playerId).eq("card_id",cardId).order("checked_at",{ascending:true}).limit(200),
   client.from("vhouse_chain").select("event_id,item,state,ex,own,use,quantity,source,checked_at")
    .eq("player_id",playerId).in("item",[cardId]).order("checked_at",{ascending:true}).limit(200),
  ]);
  for(const result of [accountResult,invResult,cardResult,checksResult,chainResult])
   if(result.error)throw result.error;
  if(!accountResult.data?.active_vcard_id)return send({status:"no_active"});
  if(accountResult.data.active_vcard_id!==cardId)return send({error:"Active VCard changed"},409);
  if(!invResult.data||!cardResult.data)return send({error:"VCard is not in player's inventory"},403);
  const card=cardResult.data,mint=card.mint_address,receipt=obj(card.mint_receipt);
  const vhouse={card,verification:checksResult.data||[],events:chainResult.data||[]};
  if(!address(mint))return send({status:"no_mint",vhouse});
  // Existing RLS read is used for VHouse data; balance history is server-only.
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!serviceKey)throw Error("Balance history storage unavailable");
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:stored,error:historyError}=await admin.from("vcard_balance_history")
   .select("lamports,checked_at,sample_minute").eq("player_id",playerId).eq("card_id",cardId)
   .eq("mint_address",mint).order("checked_at",{ascending:false}).limit(RECENT);
  if(historyError)throw historyError;
  const history=(stored||[]).reverse().map(x=>({
   time:x.checked_at,lamports:Number(x.lamports)
  }));
  const warnings:string[]=[];
  // The account already read by Load/Burn contains its actual SOL balance.
  // An unavailable Solscan subscription must not erase verified on-chain value.
  const [infoResult,originResult]=await Promise.allSettled([
    mintDetails(mint,receipt),mintOrigin(mint,receipt)
  ]);
  const loaded=infoResult.status==="fulfilled"?infoResult.value:null;
  if(infoResult.status==="rejected"){
    warnings.push("Solana NFT metadata: "+String(infoResult.reason));
    console.warn("[vcard-market-data] Solana RPC mint:",String(infoResult.reason));
  }
  const origin=originResult.status==="fulfilled"?originResult.value:
    {mintedAt:null,initialMintLamports:null};
  const newest=history[history.length-1];
  const key=Deno.env.get("SOLSCAN_API_KEY");
  let balanceLamports:number|null=null;
  let source="Solana RPC",sampled=false;
  if(newest && Date.now()-Date.parse(newest.time)<60000){
    balanceLamports=newest.lamports;
    source="Recorded balance";
  }else{
    let fromSolscan:number|null=null;
    if(key){
      try{
        const detail=obj(await solscan("account/detail",{address:mint},key));
        const amount=num(detail.lamports);
        if(amount===null||detail.account!==mint)throw Error("Invalid account balance data");
        fromSolscan=amount;
        source="Solscan";
      }catch(e){
        const reason=e instanceof Error?e.message:String(e);
        warnings.push("Solscan account detail: "+reason);
        console.warn("[vcard-market-data] Solscan account detail:",reason);
      }
    }
    const amount=fromSolscan??loaded?.mintAccountLamports??null;
    if(amount!==null){
      balanceLamports=amount;
      const now=new Date(),minute=new Date(Math.floor(now.getTime()/60000)*60000).toISOString();
      const {error:writeError}=await admin.from("vcard_balance_history").upsert({
        player_id:playerId,card_id:cardId,mint_address:mint,lamports:amount,
        sample_minute:minute,checked_at:now.toISOString()
      },{onConflict:"player_id,card_id,sample_minute"});
      if(writeError)throw writeError;
      sampled=true;
      if(history.length && history[history.length-1].time.slice(0,16)===now.toISOString().slice(0,16))
        history[history.length-1]={time:now.toISOString(),lamports:amount};
      else history.push({time:now.toISOString(),lamports:amount});
      if(history.length>RECENT)history.shift();
    }
  }
  let currentOwner:null|string=null;
  if(address(receipt.owner_wallet) && loaded?.supply==="1"){
   try{
    const accounts=obj(await rpc("getTokenAccountsByOwner",[
     receipt.owner_wallet,{mint},{encoding:"jsonParsed",commitment:"confirmed"}
    ]));
    const values=Array.isArray(accounts.value)?accounts.value:[];
    if(values.some((row:unknown)=>{
     const info=obj(obj(obj(obj(row).account).data).parsed).info;
     const t=obj(info);
     return t.owner===receipt.owner_wallet && t.mint===mint && obj(t.tokenAmount).amount==="1";
    }))currentOwner=String(receipt.owner_wallet);
   }catch{ /* Ownership is unknown, not assumed. */ }
  }
  const latest=history[history.length-1];
  const start=origin.initialMintLamports??(history.length?history[0].lamports:null);
  const current=balanceLamports;
  const deposits=start!==null && current!==null ? Math.max(0,current-start) : null;
  return send({
   status:balanceLamports===null?"partial":"ok",
   vhouse,
   chain:{
    loaded,currentOwner,initialMintLamports:origin.initialMintLamports,
    mintedAt:origin.mintedAt,balanceLamports:current,
    initialObservedLamports:history.length?history[0].lamports:null,
    history:history.map(x=>({time:x.time,afterLamports:x.lamports})),
    historyComplete:true,
    snapshots:history,source,sampled,depositedLamports:deposits
   },
   warnings,
  });
 }catch(error){
  console.error("[vcard-market-data]",error instanceof Error?error.message:error);
  return send({error:"Unable to retrieve VCard market data"},500);
 }
});
