import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, PublicKey, TransactionInstruction, TransactionMessage } from "npm:@solana/web3.js@1.98.4";
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,createTransferInstruction,unpackMint } from "npm:@solana/spl-token@0.4.14";
const MINT=new PublicKey("ETvGFek4eDeHP7iC7yceGpduTRypHpsUT6tybwMXpump");
const TREASURY=new PublicKey("CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK");
const PRICES:Record<string,number>={"Lucky Stone":300,"Stage Ticket":300,"Emergency Recall Ticket":500};
const CORS={"Access-Control-Allow-Origin":"https://zetsucorp.github.io","Access-Control-Allow-Headers":"authorization, apikey, x-client-info, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...CORS,"Content-Type":"application/json"}});
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
async function priceUsd(awtMint: string) {
  const response = await fetch("https://frontend-api-v3.pump.fun/coins-v2/" + awtMint, {
    headers: { Accept: "application/json" }, signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  const coin = await response.json();
  if (coin.mint !== awtMint) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  const number = (v: unknown) => v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const rawSupply = number(coin.total_supply);
  const decimals = number(coin.decimals) ?? 6;
  const supply = rawSupply !== null && rawSupply > 0 && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? rawSupply / 10 ** decimals : null;
  const cap = number(coin.usd_market_cap ?? coin.market_cap_usd);
  const price = number(coin.price_usd ?? coin.usd_price) ?? (cap !== null && supply !== null && supply > 0 ? cap / supply : null);
  if (price === null || !Number.isFinite(price) || price <= 0) throw Error("CRYPTO_MARKET_UNAVAILABLE");
  return price;
}

// Follow the established VHouse RPC fallback order; exclude PublicNode from
// indexed receipt/recovery requests, even if it is the configured endpoint.
const rpcUrls=[...new Set([Deno.env.get("SOLANA_RPC_URL"),"https://api.mainnet-beta.solana.com","https://api.mainnet.solana.com","https://solana-rpc.publicnode.com"].filter(Boolean))] as string[];
async function rpcRead<T>(read:(chain:Connection)=>Promise<T>):Promise<T>{
 let failure:unknown;
 for(const url of rpcUrls){
  try{return await read(new Connection(url,"confirmed"));}
  catch(error){failure=error;console.warn("[shop-awt] RPC read failed:",error instanceof Error?error.name:"RPC error");}
 }
 throw Error("SOLANA_RPC_UNAVAILABLE");
}
async function readReceipt(signature:string){
 let reachable=false;
 for(const url of rpcUrls){
  if(url.toLowerCase().includes("publicnode"))continue;
  try{
   const tx=await new Connection(url,"confirmed").getTransaction(signature,{commitment:"finalized",maxSupportedTransactionVersion:0});
   reachable=true;
   if(tx)return tx;
  }catch(error){console.warn("[shop-awt] receipt lookup unavailable");}
 }
 if(!reachable)throw Error("SHOP_RECEIPT_RPC_UNAVAILABLE");
 return null;
}
async function settle(db:any,q:any,signature:string){
 if(q.status==="PAID"){
  if(q.signature!==signature)throw Error("SHOP_PAYMENT_ALREADY_ASSIGNED");
 }else{
  const tx=await readReceipt(signature);
  if(!tx)return null;
  if(!tx.meta||tx.meta.err!==null)throw Error("SHOP_PAYMENT_FAILED_ONCHAIN");
  const message=TransactionMessage.decompile(tx.transaction.message,{
   accountKeysFromLookups:tx.meta.loadedAddresses
  });
  const owner=new PublicKey(q.wallet_address);
  const mintInfo=await rpcRead(c=>c.getAccountInfo(MINT,"confirmed"));
  const program=mintInfo?.owner;
  if(!program||(!program.equals(TOKEN_PROGRAM_ID)&&!program.equals(TOKEN_2022_PROGRAM_ID)))throw Error("AWT_MINT_UNAVAILABLE");
  const source=getAssociatedTokenAddressSync(MINT,owner,false,program);
  const destination=getAssociatedTokenAddressSync(MINT,TREASURY,false,program);
  const expected=createTransferInstruction(source,destination,owner,BigInt(q.amount_atomic),[],program);
  const matches=(ix:TransactionInstruction)=>ix.programId.equals(expected.programId)&&
   ix.keys.length===expected.keys.length&&ix.keys.every((key,i)=>key.pubkey.equals(expected.keys[i].pubkey))&&
   ix.data.length===expected.data.length&&expected.data.every((byte,i)=>byte===ix.data[i]);
  const payments=message.instructions.filter(matches);
  const keys=tx.transaction.message.getAccountKeys({accountKeysFromLookups:tx.meta.loadedAddresses});
  const destinationIndex=Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i)?.equals(destination));
  const before=tx.meta.preTokenBalances?.find(b=>b.accountIndex===destinationIndex&&b.mint===MINT.toBase58());
  const after=tx.meta.postTokenBalances?.find(b=>b.accountIndex===destinationIndex&&b.mint===MINT.toBase58());
  if(!message.payerKey.equals(owner)||tx.transaction.message.header.numRequiredSignatures!==1||
    payments.length!==1||!after||after.owner!==TREASURY.toBase58()||
    typeof tx.blockTime!=="number"||tx.blockTime<Math.floor(Date.parse(q.created_at)/1000)||
    BigInt(after.uiTokenAmount.amount)-BigInt(before?.uiTokenAmount.amount||"0")<BigInt(q.amount_atomic))
   throw Error("SHOP_PAYMENT_RECEIPT_MISMATCH");
 }
 const {data,error}=await db.rpc("vhouse_shop_awt_grant",{p_id:q.id,p_player:q.player_id,p_signature:signature});
 if(error)throw Error(error.message);
 return {...data,verified:true};
}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
 if(req.method!=="POST")return reply({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:authError}=await auth.auth.getUser(token);
  if(authError||!user.user)return reply({error:"SIGN_IN_REQUIRED"},401);
  const player=user.user.id,db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json();
  const thing=String(body?.thing||"");
  if(!Object.hasOwn(PRICES,thing))return reply({error:"ITEM_NOT_FOR_SALE"},400);
  if(body.action==="verify"){
   const sig=String(body.signature||"");
   if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sig))return reply({error:"SHOP_INVALID_SIGNATURE"},400);
   const {data:q,error}=await db.from("vhouse_shop_awt_payments").select("*").eq("id",body.quoteId).eq("player_id",player).eq("thing",thing).maybeSingle();
   if(error||!q)return reply({error:"SHOP_QUOTE_NOT_FOUND"},404);
   const result=await settle(db,q,sig);
   return reply(result||{verified:false,status:"PENDING"});
  }
  if(body.action!=="quote")return reply({error:"INVALID_ACTION"},400);
  const {data:account,error:ae}=await db.from("vhouse_accounts").select("wallet_address").eq("id",player).single();
  if(ae||!account?.wallet_address)throw Error("PLAYER_WALLET_NOT_LINKED");
  if(body.walletAddress!==account.wallet_address)throw Error("SHOP_WALLET_MISMATCH");
  const owner=new PublicKey(account.wallet_address);
  const mintInfo=await rpcRead(c=>c.getAccountInfo(MINT,"confirmed"));
  const program=mintInfo?.owner;
  if(!program||(!program.equals(TOKEN_PROGRAM_ID)&&!program.equals(TOKEN_2022_PROGRAM_ID)))throw Error("AWT_MINT_UNAVAILABLE");
  const decimals=unpackMint(MINT,mintInfo,program).decimals;
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error("AWT_DECIMALS_UNAVAILABLE");
  const amount=unitsForUsdCents(BigInt(PRICES[thing]),await priceUsd(MINT.toBase58()),decimals);
  if(amount<=0n||amount>18446744073709551615n)throw Error("SHOP_AMOUNT_INVALID");
  const id=crypto.randomUUID();
  const {data:q,error}=await db.rpc("vhouse_shop_awt_reserve",{p_id:id,p_player:player,p_thing:thing,p_wallet:owner.toBase58(),p_cents:PRICES[thing],p_amount:amount.toString(),p_decimals:decimals,p_tx:null,p_height:null});
  if(error)throw Error(error.message);
  return reply({quoteId:q.id,thing:q.thing,usdCents:q.usd_cents,amountAtomic:q.amount_atomic,
   decimals:q.token_decimals,mint:MINT.toBase58(),treasury:TREASURY.toBase58(),
   tokenProgram:program.toBase58(),walletAddress:q.wallet_address});
 }catch(error){console.error("[shop-awt]",String(error));return reply({error:error instanceof Error?error.message:"SHOP_PAYMENT_UNAVAILABLE"},409);}
});
