import { createClient } from "npm:@supabase/supabase-js@2.49.8";
const RPCS=["https://solana-rpc.publicnode.com","https://rpc.solanatracker.io/public","https://api.mainnet-beta.solana.com"];
const TOKEN2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TREASURY="CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK";
const addr=x=>typeof x==="string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
const sig=x=>typeof x==="string" && /^[1-9A-HJ-NP-Za-km-z]{60,90}$/.test(x);
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x)?x:{};
const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info"}});
async function rpc(method,params){
 let last="RPC unavailable";
 for(const url of RPCS)try{
  const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),signal:AbortSignal.timeout(6500)});
  if(!r.ok)throw Error("RPC HTTP "+r.status);
  const v=obj(await r.json());
  if(v.error)throw Error(String(obj(v.error).message||"RPC failed"));
  return v.result;
 }catch(e){last=String(e);}
 throw Error(last);
}
async function verify(mint,owner,signature,uri){
 const tx=obj(await rpc("getTransaction",[signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]));
 if(!tx.meta||obj(tx.meta).err!==null||!tx.blockTime)throw Error("Mint transaction not confirmed");
 const message=obj(obj(tx.transaction).message), keys=Array.isArray(message.accountKeys)?message.accountKeys:[];
 const has=(value,signer=false)=>keys.some(k=>typeof k==="string"?(!signer&&k===value):(obj(k).pubkey===value&&(!signer||obj(k).signer===true)));
 if(!has(owner,true)||!has(mint))throw Error("Mint does not belong to signed transaction");
 const instructions=Array.isArray(message.instructions)?message.instructions:[];
 if(!instructions.some(i=>{
  const p=obj(obj(i).parsed),v=obj(p.info);
  return i.program==="system"&&p.type==="transfer"&&v.source===owner&&v.destination===TREASURY&&Number(v.lamports)===1000000;
 }))throw Error("VHouse mint fee was not paid in signed transaction");
 const account=obj(obj(await rpc("getAccountInfo",[mint,{encoding:"jsonParsed",commitment:"confirmed"}])).value);
 if(account.owner!==TOKEN2022)throw Error("Mint is not a Token-2022 account");
 const info=obj(obj(obj(account.data).parsed).info);
 if(String(info.supply)!=="1"||Number(info.decimals)!==0||info.mintAuthority!==null)throw Error("Invalid NFT supply or authority");
 const ext=Array.isArray(info.extensions)?info.extensions.map(obj):[];
 const getExt=name=>ext.find(e=>String(e.extension||"").toLowerCase()===name.toLowerCase());
 if(!getExt("nonTransferable"))throw Error("Soulbound extension missing");
 const ptr=getExt("metadataPointer");
 if(ptr&&obj(ptr.state).metadataAddress!==mint)throw Error("Metadata pointer mismatch");
 const meta=getExt("tokenMetadata");
 if(meta&&String(obj(meta.state).uri||"")!==uri)throw Error("On-chain metadata mismatch");
 const close=getExt("mintCloseAuthority");
 if(!close||String(obj(close.state).closeAuthority||obj(close.state).authority)!==owner)throw Error("Mint close authority mismatch");
 const balances=obj(await rpc("getTokenAccountsByOwner",[owner,{mint},{encoding:"jsonParsed",commitment:"confirmed"}]));
 if(!Array.isArray(balances.value)||!balances.value.some(v=>{
  const i=obj(obj(obj(obj(v).account).data).parsed).info;
  return i.owner===owner&&i.mint===mint&&String(obj(i.tokenAmount).amount)==="1";
 }))throw Error("Wallet does not own NFT");
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return out({});
 if(req.method!=="POST")return out({error:"POST required"},405);
 try{
  const token=req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if(!token)return out({error:"Sign in required"},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!key)throw Error("Mint registration unavailable");
  const client=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error:authError}=await client.auth.getUser(token);
  if(authError||!data.user)return out({error:"Sign-in expired"},401);
  const body=obj(await req.json().catch(()=>({}))),receipt=obj(body.mintReceipt);
  const mint=receipt.mintAddress,owner=receipt.ownerWallet,signature=receipt.transactionSignature,uri=receipt.metadataUri;
  if(!addr(mint)||!addr(owner)||!sig(signature)||typeof uri!=="string"||!uri.startsWith("https://gateway.pinata.cloud/ipfs/"))
   return out({error:"Invalid mint receipt"},400);
  const {data:account,error:accountError}=await client.from("vhouse_accounts").select("wallet_address").eq("id",data.user.id).maybeSingle();
  if(accountError)throw accountError;
  if(account?.wallet_address!==owner)return out({error:"Link NFT owner wallet to VHouse account"},403);
  await verify(mint,owner,signature,uri);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:card,error}=await admin.rpc("vhouse_register_verified_mint",{
    p_player_id:data.user.id,p_name:body.name,p_image:body.image,p_description:body.description,p_designation:body.team,
    p_mint_address:mint,p_mint_receipt:{mint_address:mint,owner_wallet:owner,transaction_signature:signature,metadata_uri:uri,image_uri:receipt.imageUri}
  });
  if(error){if(error.code==="23505")return out({error:"Mint already registered"},409);throw error;}
  return out(card);
 }catch(e){console.error("[vcard-mint-verified]",String(e));return out({error:String(e instanceof Error?e.message:e).slice(0,200)},400);}
});
