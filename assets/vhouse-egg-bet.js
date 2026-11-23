/* Optional Egg Stake — uses the existing Egg HP panel, Phantom and verified receipts. */
(function(){
"use strict";
const el=id=>document.getElementById(id),walletId="FHCjyvDQD13tryEQsvQmuaPC5RPZWzZzKtZAPAmoHeYk";
let cents=25,busy=false,resolveOffer=null,activeAccount=null,currentRun=null;
function status(text,signature=""){
 const host=el("eggStakeStatus");
 host.replaceChildren(document.createTextNode(text));
 if(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)){
  const a=document.createElement("a");
  a.href="https://solscan.io/tx/"+encodeURIComponent(signature);
  a.target="_blank";a.rel="noopener noreferrer";
  a.textContent="VIEW PAYMENT ON SOLSCAN";
  host.append(document.createTextNode(" · "),a);
 }
}
function format(){el("eggStakeAmount").textContent="$"+(cents/100).toFixed(2);}
function close(){
 el("raidEggOverlay").classList.remove("is-stake-choice");
 el("eggStakeOffer").hidden=true;
 el("eggStakeProgress").hidden=true;
 el("raidEggOverlay").hidden=true;
 busy=false;el("eggStakeConfirm").disabled=false;el("eggStakeSkip").disabled=false;
}
function cancel(){
 if(resolveOffer){const resolve=resolveOffer;resolveOffer=null;close();resolve(null);}
}
async function api(body){
 const {data,error}=await window.VHouseAuth.getClient().functions.invoke("vhouse-egg-stake",{body});
 if(error){
  let msg=error.message||"EGG_PAYMENT_UNAVAILABLE";
  try{msg=(await error.context?.json?.())?.error||msg;}catch{}
  throw Error(msg);
 }
 return data;
}
async function pay(cardId,level){
 const account=activeAccount;
 status("CHECKING EGG STAKE...");
 const quote=await api({action:"quote",cardId,level,usdCents:cents});
 if(!quote?.quoteId||quote.treasury!==walletId)throw Error(quote?.error||"EGG_QUOTE_INVALID");
 let sig=quote.signature||"";
 if(quote.verified){status("EGG STAKE VERIFIED",sig);return quote.quoteId;}
 if(!sig){
  const phantom=window.phantom?.solana||window.solana;
  if(!phantom?.isPhantom||!phantom?.signAndSendTransaction)throw Error("CONNECT PHANTOM");
  const connected=await phantom.connect();
  const owner=connected?.publicKey?.toBase58?.()||phantom.publicKey?.toBase58?.();
  if(!owner||quote.walletAddress!==owner)throw Error("CONNECTED PHANTOM WALLET MISMATCH");
  if(window.VHouseAuth.getUser()?.id!==account)throw Error("ACCOUNT_CHANGED");
  const {Connection,PublicKey,Transaction,SystemProgram,TransactionInstruction}=
   await import("https://esm.sh/@solana/web3.js@1.99.0?bundle");
  let latest=null;
  for(const endpoint of ["https://solana-rpc.publicnode.com","https://api.mainnet-beta.solana.com"]){
   try{latest=await new Connection(endpoint,"confirmed").getLatestBlockhash("confirmed");if(latest)break;}
   catch(error){console.warn("Egg blockhash:",error);}
  }
  if(!latest)throw Error("SOLANA_RPC_UNAVAILABLE");
  const from=new PublicKey(owner),tx=new Transaction();
  tx.add(SystemProgram.transfer({fromPubkey:from,toPubkey:new PublicKey(walletId),
    lamports:Number(quote.lamports)}));
  tx.add(new TransactionInstruction({programId:new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
    keys:[],data:new TextEncoder().encode("VHOUSE:EGG:"+quote.quoteId)}));
  tx.feePayer=from;tx.recentBlockhash=latest.blockhash;
  status("APPROVE $"+(cents/100).toFixed(2)+" EGG STAKE IN PHANTOM");
  const result=await phantom.signAndSendTransaction(tx,{skipPreflight:false,preflightCommitment:"confirmed"});
  sig=typeof result==="string"?result:result?.signature;
  if(!sig)throw Error("PHANTOM_SIGNATURE_MISSING");
  status("EGG PAYMENT SUBMITTED · VERIFYING",sig);
  try{await api({action:"submit",quoteId:quote.quoteId,signature:sig});}
  catch(error){console.warn("Egg signature save:",error);}
 }
 let failures=0;
 while(window.VHouseAuth.getUser()?.id===account&&resolveOffer){
  try{
   const verified=await api({action:"verify",quoteId:quote.quoteId,signature:sig});
   if(verified?.verified===true){status("EGG STAKE VERIFIED",sig);return quote.quoteId;}
   if(verified?.error!=="PAYMENT_CONFIRMATION_PENDING")
    throw Error(verified?.error||"EGG_PAYMENT_VERIFICATION_FAILED");
   failures=0;status("EGG PAYMENT SUBMITTED · CHECKING BLOCKCHAIN",sig);
  }catch(error){
   const code=error?.message||"EGG_PAYMENT_UNAVAILABLE";
   if(!["EGG_SERVICE_UNAVAILABLE","SOLANA_RPC_UNAVAILABLE","EGG_PAYMENT_RECORD_FAILED",
     "EGG_PAYMENT_LOOKUP_FAILED","Failed to fetch",
     "Failed to send a request to the Edge Function"].includes(code))throw error;
   failures++;status("EGG PAYMENT SUBMITTED · VERIFICATION RETRYING",sig);
  }
  await new Promise(r=>setTimeout(r,failures?Math.min(10000,1800+failures*1000):1800));
 }
 throw Error("ACCOUNT_CHANGED");
}
function offer(cardId,level=1){
 if(resolveOffer)cancel();
 cents=25;format();activeAccount=window.VHouseAuth.getUser()?.id;
 el("raidEggArt").src="assets/Egg.png";el("raidEggArt").className="";
 el("raidEggDamage").textContent="";
 el("raidEggHealth").textContent="EGG STAKE";
 el("raidEggOverlay").classList.add("is-stake-choice");
 el("eggStakeOffer").hidden=false;el("eggStakeProgress").hidden=true;
 el("raidEggOverlay").hidden=false;
 status("");
 return new Promise(resolve=>{resolveOffer=resolve;currentRun={cardId,level};});
}
el("eggStakeMinus").addEventListener("click",()=>{if(!busy){cents=Math.max(25,cents-25);format();}});
el("eggStakePlus").addEventListener("click",()=>{if(!busy){cents+=25;format();}});
el("eggStakeSkip").addEventListener("click",()=>{if(!busy)cancel();});
el("eggStakeConfirm").addEventListener("click",async()=>{
 if(busy||!resolveOffer||!currentRun)return;
 busy=true;
 el("eggStakeConfirm").disabled=true;el("eggStakeSkip").disabled=true;
 try{
  const id=await pay(currentRun.cardId,currentRun.level);
  if(!resolveOffer)return;
  const resolve=resolveOffer;resolveOffer=null;close();resolve(id);
 }catch(error){
  console.error("Egg stake:",error);
  status("EGG STAKE: "+(error?.message||"UNAVAILABLE"));
 }finally{
  busy=false;el("eggStakeConfirm").disabled=false;el("eggStakeSkip").disabled=false;
 }
});
async function updateProgress(run){
 if(!run?.id)return;
 try{
  const data=await api({action:"status",raidId:run.id});
  if(run!==raid||!data?.stake)return;
  const label=el("eggStakeProgress");
  label.textContent="EGG BET · "+Number(data.wins)+" WINS · "+Number(data.multiplier).toFixed(2)+"×";
  label.hidden=false;
 }catch(error){console.warn("Egg growth:",error);}
}
let lastEggReceipt=null;
let deliveryBusy=false;
const money=(usd)=>"$"+Number(usd).toFixed(3);
const solAmount=(lamports)=>(Number(lamports)/1e9).toFixed(9)+" SOL";
function clearReceipt(){
 lastEggReceipt=null;
 el("eggRewardDetails").hidden=true;
 el("eggRewardConfirm").hidden=true;
 el("eggPayoutStatus").hidden=true;
}
function hasUnfinishedReward(run){
 if(!run||Number(run.eggHp)>0)return false;
 if(lastEggReceipt?.raidId!==run.id)return true; // Do not hide an unchecked broken Egg.
 return !!lastEggReceipt.stake&&lastEggReceipt.status!=="CONFIRMED";
}
function showPayoutStatus(data){
 const host=el("eggPayoutStatus");
 if(!data?.stake){host.hidden=true;return;}
 host.hidden=false;
 const broken=!!data.eggBroken;
 let message;
 if(!broken)message="EGG SURVIVED · NO EGG REWARD";
 else if(!data.confirmed)message="EGG BROKEN · AWAITING PLAYER CONFIRMATION";
 else if(data.status==="CONFIRMED")message="EGG SOL TRANSFER: CONFIRMED · "+solAmount(data.payoutLamports);
 else if(data.status==="NOT ENOUGH")message="EGG SOL TRANSFER: NOT ENOUGH · EGG_WALLET_NOT_ENOUGH";
 else if(data.status==="PENDING")message="EGG SOL TRANSFER: PENDING · "+solAmount(data.payoutLamports);
 else if(data.status==="EXPIRED_REVIEW")message="EGG SOL TRANSFER: EXPIRED_REVIEW · "+(data.reason||"CHECK TRANSACTION");
 else message="EGG SOL TRANSFER: "+(data.status==="READY"?"READY":(data.status||"CHECKING"))+
  (data.reason?" · "+data.reason:"");
 host.replaceChildren(document.createTextNode(message));
 if(data.payoutSignature){
  const link=document.createElement("a");
  link.href="https://solscan.io/tx/"+encodeURIComponent(data.payoutSignature);
  link.target="_blank";link.rel="noopener noreferrer";
  link.textContent="VIEW EGG TRANSFER ON SOLSCAN";
  host.append(document.createTextNode(" · "),link);
 }
}
function paintReceipt(run,data){
 if(raid!==run)return;
 const hasStake=!!data?.stake;
 const container=el("eggRewardDetails"),button=el("eggRewardConfirm");
 container.hidden=!hasStake;
 if(!hasStake){
  lastEggReceipt={raidId:run.id,stake:false,status:"NONE"};
  button.hidden=true;el("eggPayoutStatus").hidden=true;
  return;
 }
 lastEggReceipt={raidId:run.id,...data};
 const usdStake=Number(data.stakeCents)/100;
 const multiplier=Number(data.multiplier)||0;
 el("eggStakeOriginal").textContent="$"+usdStake.toFixed(2);
 el("eggStakeReceiptText").textContent=String(data.wins)+" WINS · "+multiplier.toFixed(2)+"×";
 el("eggRewardLabel").textContent=data.eggBroken?"EGG REWARD WON":"POTENTIAL EGG REWARD";
 el("eggRewardAmount").textContent=money(usdStake*multiplier);
 el("eggRewardOutcome").textContent=data.eggBroken?"EGG BROKEN":"EGG SURVIVED";
 button.hidden=!data.eggBroken||data.status==="CONFIRMED";
 if(!button.hidden){
  button.textContent=!data.confirmed?"CONFIRM EGG REWARD":"CHECK EGG DELIVERY";
  button.disabled=deliveryBusy;
 }
 showPayoutStatus(data);
}
async function updateReceipt(run){
 if(!run?.id)return;
 try{
  const data=await api({action:"status",raidId:run.id});
  paintReceipt(run,data);
 }catch(error){
  console.error("Egg receipt unavailable:",error);
  if(raid===run){
   el("eggRewardDetails").hidden=false;
   el("eggRewardConfirm").hidden=true;
   const host=el("eggPayoutStatus");host.hidden=false;
   host.textContent="EGG STATUS UNAVAILABLE · "+(error?.message||"RETRY");
  }
 }
}
async function settle(run){
 if(!run?.id||raid!==run)return false;
 let state=await api({action:"status",raidId:run.id});
 paintReceipt(run,state);
 if(!state?.stake||!state.eggBroken)return true;
 if(!state.confirmed)return false;
 while(window.VHouseAuth.getUser()?.id===run.ownerId&&raid===run){
  let payout;
  try{payout=await api({action:"payout",raidId:run.id});}
  catch(error){
   const reason=error?.message||"EGG_TRANSFER_FAILED";
   paintReceipt(run,{...state,status:"FAILED",reason});
   return false;
  }
  const nextStatus=payout?.status||"FAILED";
  state={...state,status:nextStatus,
    payoutSignature:payout.signature||state.payoutSignature,
    payoutLamports:payout.payoutLamports||state.payoutLamports,
    reason:payout.reason||payout.error||""};
  paintReceipt(run,state);
  if(nextStatus==="CONFIRMED"){await updateReceipt(run);return true;}
  if(nextStatus!=="PENDING")return false;
  await new Promise(r=>setTimeout(r,1800));
 }
 return false;
}
el("eggRewardConfirm").addEventListener("click",async()=>{
 const run=raid;
 if(!run||!run.completed||Number(run.eggHp)!==0||deliveryBusy)return;
 deliveryBusy=true;
 el("eggRewardConfirm").disabled=true;
 try{
  const state=await api({action:"status",raidId:run.id});
  if(!state?.stake||!state.eggBroken)throw Error("EGG_REWARD_NOT_READY");
  if(!state.confirmed){
   const {data,error}=await window.VHouseAuth.getClient().rpc(
     "vhouse_confirm_egg_reward",{p_raid_id:run.id});
   if(error)throw Error(error.message||"EGG_CONFIRMATION_FAILED");
   if(data?.confirmed!==true)throw Error("EGG_CONFIRMATION_FAILED");
  }
  await updateReceipt(run);
  const success=await settle(run);
  if(!success&&raid===run){
   el("eggRewardConfirm").textContent="CHECK EGG DELIVERY";
  }
 }catch(error){
  console.error("Egg confirm and delivery:",error);
  if(raid===run){
   const host=el("eggPayoutStatus");
   host.hidden=false;
   host.textContent="EGG TRANSFER FAILED: "+(error?.message||"UNKNOWN ERROR");
  }
 }finally{
  deliveryBusy=false;
  if(raid===run){
   await updateReceipt(run);
   el("eggRewardConfirm").disabled=false;
  }
 }
});
window.VHouseEggBet={offer,cancel,updateProgress,updateReceipt,settle,hasUnfinishedReward,clearReceipt};
})();