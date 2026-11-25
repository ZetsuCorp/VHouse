// Official Pump SDKs, loaded only when trading is opened.
let modules;
async function sdk(){
 if(!modules)modules=Promise.all([
  import("https://esm.sh/@solana/web3.js@1.98.4?bundle"),
  import("https://esm.sh/bn.js@5.2.2?bundle"),
  import("https://esm.sh/@solana/spl-token@0.4.14?bundle&deps=@solana/web3.js@1.98.4"),
  import("https://esm.sh/@pump-fun/pump-sdk@4.1.0?bundle&deps=@solana/web3.js@1.98.4,@solana/spl-token@0.4.14,bn.js@5.2.2"),
  import("https://esm.sh/@pump-fun/pump-swap-sdk@2.1.0?bundle&deps=@solana/web3.js@1.98.4,@solana/spl-token@0.4.14,bn.js@5.2.2")
 ]).catch(e=>{modules=null;throw e});
 return modules;
}
const SOL="So11111111111111111111111111111111111111112";
const PUMP="6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const AMM="pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const allowed=new Set(["ETvGFek4eDeHP7iC7yceGpduTRypHpsUT6tybwMXpump","BGf97TZtX7SezpJs21B3DchsonwHvw8DiekDALXLpump","rdWAk8U5Zx3L5TjLtL7sb3XhEPmXhqcMLxVBDi3pump"]);
async function withConnection(web3,fn){
 let last;
 for(const url of ["https://solana-rpc.publicnode.com","https://api.mainnet-beta.solana.com"]){
  try{return await fn(new web3.Connection(url,{commitment:"confirmed",disableRetryOnRateLimit:true}))}
  catch(e){last=e;if(!/fetch|network|429|403|502|503|504|timeout|failed to get/i.test(String(e?.message)))throw e}
 }
 throw last||Error("Solana RPC unavailable");
}
async function mintState(connection,web3,spl,mintAddress,wallet){
 if(!allowed.has(mintAddress))throw Error("Unsupported Pump.fun asset.");
 const mint=new web3.PublicKey(mintAddress),user=new web3.PublicKey(wallet);
 const account=await connection.getAccountInfo(mint);
 if(!account||![spl.TOKEN_PROGRAM_ID.toBase58(),spl.TOKEN_2022_PROGRAM_ID.toBase58()].includes(account.owner.toBase58()))throw Error("Token mint unavailable.");
 const tokenProgram=account.owner;
 if(spl.unpackMint(mint,account,tokenProgram).decimals!==6)throw Error("Unexpected token precision.");
 const ata=spl.getAssociatedTokenAddressSync(mint,user,false,tokenProgram);
 const [sol,ataInfo]=await Promise.all([connection.getBalance(user),connection.getAccountInfo(ata)]);
 return {mint,user,tokenProgram,ataInfo,sol:String(sol),token:ataInfo?spl.unpackAccount(ata,ataInfo,tokenProgram).amount.toString():"0"};
}
export async function balances(mint,wallet){
 const [web3,,spl]=await sdk();
 return withConnection(web3,async connection=>{
  const {sol,token}=await mintState(connection,web3,spl,mint,wallet);
  return {sol,token};
 });
}
export async function buildFromState({web3,BN,pump,amm,connection,state,rawAmount,side}){
 const {mint,user,tokenProgram,ataInfo,sol,token}=state;
 if(!["BUY","SELL"].includes(side)||!/^\d+$/.test(rawAmount)||BigInt(rawAmount)<=0n||BigInt(rawAmount)>18446744073709551615n)throw Error("Invalid trade amount.");
 const buying=side==="BUY",amount=new BN(rawAmount,10),slippage=1;
 if(amount.gt(new BN(buying?sol:token,10)))throw Error("Insufficient balance.");
 const curveInfo=await connection.getAccountInfo(pump.bondingCurvePda(mint));
 if(!curveInfo||curveInfo.owner.toBase58()!==PUMP)throw Error("Pump.fun bonding curve unavailable.");
 const curve=pump.PUMP_SDK.decodeBondingCurve(curveInfo);
 if(curve.quoteMint&&!["11111111111111111111111111111111",SOL].includes(curve.quoteMint.toBase58()))throw Error("This asset is not SOL-paired.");
 let route,expected,ixs,tradeFee=null;
 if(!curve.complete){
  route="Pump.fun";
  const online=new pump.OnlinePumpSdk(connection);
  const [global,feeConfig]=await Promise.all([online.fetchGlobal(),online.fetchFeeConfig()]);
  const args={global,feeConfig,mintSupply:curve.tokenTotalSupply,bondingCurve:curve};
  const common={global,bondingCurveAccountInfo:curveInfo,bondingCurve:curve,associatedUserAccountInfo:ataInfo,mint,user,tokenProgram,slippage};
  if(buying){
   expected=pump.getBuyTokenAmountFromSolAmount({...args,amount});
   if(expected.lten(0))throw Error("Amount too small.");
   const cost=pump.getBuySolAmountFromTokenAmount({...args,amount:expected});
   ixs=await pump.PUMP_SDK.buyInstructions({...common,amount:expected,solAmount:cost});
  }else{
   expected=pump.getSellSolAmountFromTokenAmount({...args,amount});
   ixs=await pump.PUMP_SDK.sellInstructions({...common,amount,solAmount:expected,mayhemMode:curve.isMayhemMode??false,cashback:curve.isCashbackCoin??false});
  }
 }else{
  route="PumpSwap";
  const poolKey=amm.canonicalPumpPoolPda(mint);
  const account=await connection.getAccountInfo(poolKey);
  if(!account||account.owner.toBase58()!==AMM)throw Error("Coin is migrating or has no canonical PumpSwap pool.");
  const swap=await new amm.OnlinePumpAmmSdk(connection).swapSolanaState(poolKey,user);
  const {pool,poolBaseAmount,poolQuoteAmount,globalConfig,feeConfig,baseMint,baseMintAccount}=swap;
  if(pool.quoteMint.toBase58()!==SOL||baseMint.toBase58()!==mint.toBase58())throw Error("Pool mint mismatch.");
  const args={baseReserve:poolBaseAmount,quoteReserve:poolQuoteAmount,virtualQuoteReserves:pool.virtualQuoteReserves,feeBucketsTotal:pool.protocolFees?.add(pool.creatorFees),globalConfig,feeConfig,baseMint,baseMintAccount,coinCreator:pool.coinCreator,creator:pool.creator,quoteMint:pool.quoteMint,isMayhemMode:pool.isMayhemMode,creatorFeeBps:pool.creatorFeeBps,slippage};
  if(buying){
   const q=amm.buyQuoteInput({...args,quote:amount});
   expected=q.base;
   ixs=await amm.PUMP_AMM_SDK.buyQuoteInput(swap,amount,slippage);
   const detail=amm.buyBaseInput({...args,base:expected});
   tradeFee=detail.uiQuote.sub(detail.internalQuoteAmount).toString();
  }else{
   const q=amm.sellBaseInput({...args,base:amount});
   expected=q.uiQuote;tradeFee=q.internalQuoteAmountOut.sub(expected).toString();
   ixs=await amm.PUMP_AMM_SDK.sellBaseInput(swap,amount,slippage);
  }
 }
 if(!expected||expected.lten(0)||!ixs?.length)throw Error("No valid trade at this amount.");
 const program=route==="PumpSwap"?AMM:PUMP;
 const tradeIx=ixs.find(ix=>ix.programId.toBase58()===program);
 if(!tradeIx||tradeIx.data.length<24)throw Error("Missing or invalid Pump trade instruction.");
 // Legacy buy/sell builders encode token amount followed by the SOL limit.
 // Decode the actual signed instruction's bound instead of estimating it independently.
 const bytes=new DataView(tradeIx.data.buffer,tradeIx.data.byteOffset,tradeIx.data.byteLength);
 const limit=bytes.getBigUint64(16,true);
 if(limit<=0n)throw Error("Invalid slippage limit.");
 if(buying&&limit>BigInt(sol))throw Error("Insufficient SOL for maximum trade cost.");
 const {blockhash,lastValidBlockHeight}=await connection.getLatestBlockhash("confirmed");
 const message=new web3.TransactionMessage({payerKey:user,recentBlockhash:blockhash,instructions:[web3.ComputeBudgetProgram.setComputeUnitLimit({units:route==="PumpSwap"?400000:300000}),...ixs]}).compileToV0Message();
 if(message.header.numRequiredSignatures!==1||!message.staticAccountKeys[0].equals(user))throw Error("Unexpected transaction signer.");
 const tx=new web3.VersionedTransaction(message);
 const fee=await connection.getFeeForMessage(message,"confirmed");
 if(fee.value===null)throw Error("Network fee unavailable.");
 if(BigInt(sol)<BigInt(fee.value)+(buying?limit:0n))throw Error("Insufficient SOL for network fee.");
 return {tx,connection,lastValidBlockHeight,route,expected:expected.toString(),limit:limit.toString(),networkFee:String(fee.value),tradeFee,sol,token};
}
export async function quote(mint,wallet,rawAmount,side){
 const [web3,bn,spl,pump,amm]=await sdk();
 return withConnection(web3,async connection=>buildFromState({web3,BN:bn.default,pump,amm,connection,state:await mintState(connection,web3,spl,mint,wallet),rawAmount,side}));
}
export async function simulate(result){
 const response=await result.connection.simulateTransaction(result.tx,{sigVerify:false,replaceRecentBlockhash:true,commitment:"confirmed"});
 if(response.value.err)throw Error("Trade simulation failed: "+JSON.stringify(response.value.err));
}
