import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { Connection, PublicKey, Transaction, TransactionInstruction } from "npm:@solana/web3.js@1.98.4";
import { TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction,createTransferCheckedInstruction } from "npm:@solana/spl-token@0.4.14";
const MINT=new PublicKey("ETvGFek4eDeHP7iC7yceGpduTRypHpsUT6tybwMXpump");
const TREASURY=new PublicKey("CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK");
const MEMO=new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
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

const encode=(b:Uint8Array)=>btoa(String.fromCharCode(...b));
const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const rpc=()=>new Connection(Deno.env.get("SOLANA_RPC_URL")||"https://solana-rpc.publicnode.com","confirmed");
async function settle(db:any,chain:Connection,q:any,signature:string){
 if(q.status==="PAID"){
  if(q.signature!==signature)throw Error("SHOP_PAYMENT_ALREADY_ASSIGNED");
 }else{
  const tx=await chain.getTransaction(signature,{commitment:"finalized",maxSupportedTransactionVersion:0});
  if(!tx)return null;
  if(!tx.meta||tx.meta.err!==null)throw Error("SHOP_PAYMENT_FAILED_ONCHAIN");
  const expected=Transaction.from(decode(q.transaction_base64)).serializeMessage();
  const actual=tx.transaction.message.serialize();
  if(actual.length!==expected.length||!expected.every((b,i)=>b===actual[i]))throw Error("SHOP_PAYMENT_RECEIPT_MISMATCH");
 }
 const {data,error}=await db.rpc("vhouse_shop_awt_grant",{p_id:q.id,p_player:q.player_id,p_signature:signature});
 if(error)throw Error(error.message);
 return {...data,verified:true};
}
async function recover(db:any,chain:Connection,q:any){
 const wallet=new PublicKey(q.wallet_address);
 const history=await chain.getSignaturesForAddress(wallet,{limit:100},"finalized");
 for(const row of history){
  if(row.err)continue;
  if(row.blockTime && row.blockTime*1000 < Date.parse(q.created_at)-120000)break;
  if(!row.memo?.includes("VHOUSE:SHOP:"+q.id))continue;
  const result=await settle(db,chain,q,row.signature);
  if(result)return result;
 }
 return null;
}
function quoteResponse(q:any){
 return {quoteId:q.id,thing:q.thing,usdCents:q.usd_cents,amountAtomic:q.amount_atomic,decimals:q.token_decimals,transaction:q.transaction_base64,lastValidBlockHeight:q.last_valid_block_height,walletAddress:q.wallet_address};
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
  const chain=rpc();
  if(body.action==="verify"){
   const sig=String(body.signature||"");
   if(!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(sig))return reply({error:"SHOP_INVALID_SIGNATURE"},400);
   const {data:q,error}=await db.from("vhouse_shop_awt_payments").select("*").eq("id",body.quoteId).eq("player_id",player).eq("thing",thing).maybeSingle();
   if(error||!q)return reply({error:"SHOP_QUOTE_NOT_FOUND"},404);
   const result=await settle(db,chain,q,sig);
   return reply(result||{verified:false,status:"PENDING"});
  }
  if(body.action!=="quote")return reply({error:"INVALID_ACTION"},400);
  const {data:account,error:ae}=await db.from("vhouse_accounts").select("wallet_address").eq("id",player).single();
  if(ae||!account?.wallet_address)throw Error("PLAYER_WALLET_NOT_LINKED");
  if(body.walletAddress!==account.wallet_address)throw Error("SHOP_WALLET_MISMATCH");
  const {data:existing,error:ee}=await db.from("vhouse_shop_awt_payments").select("*").eq("player_id",player).eq("thing",thing).eq("status","QUOTED").maybeSingle();
  if(ee)throw Error("SHOP_QUOTE_LOOKUP_FAILED");
  if(existing){
   const recovered=await recover(db,chain,existing);
   if(recovered)return reply(recovered);
   if(await chain.getBlockHeight("finalized")<=Number(existing.last_valid_block_height))return reply(quoteResponse(existing));
   const {error:expired}=await db.from("vhouse_shop_awt_payments").update({status:"EXPIRED"}).eq("id",existing.id).eq("status","QUOTED");
   if(expired)throw Error("SHOP_QUOTE_EXPIRY_FAILED");
  }
  const owner=new PublicKey(account.wallet_address);
  const mintInfo=await chain.getParsedAccountInfo(MINT,"confirmed");
  const program=mintInfo.value?.owner;
  const parsed=(mintInfo.value?.data as any)?.parsed?.info;
  if(!program||(!program.equals(TOKEN_PROGRAM_ID)&&!program.equals(TOKEN_2022_PROGRAM_ID)))throw Error("AWT_MINT_UNAVAILABLE");
  const decimals=parsed?.decimals;
  if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error("AWT_DECIMALS_UNAVAILABLE");
  const amount=unitsForUsdCents(BigInt(PRICES[thing]),await priceUsd("AWT",MINT.toBase58()),decimals);
  if(amount<=0n||amount>18446744073709551615n)throw Error("SHOP_AMOUNT_INVALID");
  const source=getAssociatedTokenAddressSync(MINT,owner,false,program);
  const destination=getAssociatedTokenAddressSync(MINT,TREASURY,false,program);
  const balance=await chain.getTokenAccountBalance(source,"confirmed");
  if(BigInt(balance.value.amount)<amount)throw Error("INSUFFICIENT_AWT");
  const latest=await chain.getLatestBlockhash("finalized"),id=crypto.randomUUID();
  const tx=new Transaction({feePayer:owner,recentBlockhash:latest.blockhash});
  if(!await chain.getAccountInfo(destination,"confirmed"))tx.add(createAssociatedTokenAccountIdempotentInstruction(owner,destination,TREASURY,MINT,program));
  tx.add(createTransferCheckedInstruction(source,MINT,destination,owner,amount,decimals,[],program));
  tx.add(new TransactionInstruction({programId:MEMO,keys:[],data:new TextEncoder().encode("VHOUSE:SHOP:"+id)}));
  const {data:q,error}=await db.rpc("vhouse_shop_awt_reserve",{p_id:id,p_player:player,p_thing:thing,p_wallet:owner.toBase58(),p_cents:PRICES[thing],p_amount:amount.toString(),p_decimals:decimals,p_tx:encode(tx.serialize({requireAllSignatures:false,verifySignatures:false})),p_height:latest.lastValidBlockHeight});
  if(error)throw Error(error.message);
  return reply(quoteResponse(q));
 }catch(error){console.error("[shop-awt]",String(error));return reply({error:error instanceof Error?error.message:"SHOP_PAYMENT_UNAVAILABLE"},409);}
});
