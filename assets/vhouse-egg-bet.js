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
async function updateReceipt(run){
 if(!run?.id)return;
 try{
  const data=await api({action:"status",raidId:run.id});
  if(run!==raid)return;
  const line=el("eggStakeReceipt"),proof=el("eggPayoutStatus");
  line.hidden=!data?.stake;proof.hidden=!data?.stake;
  if(!data?.stake)return;
  el("eggStakeReceiptText").textContent="$"+(data.stakeCents/100).toFixed(2)+
   " · "+Number(data.multiplier).toFixed(2)+"×";
  showPayoutStatus(data);
 }catch(error){console.warn("Egg receipt:",error);}
}
function showPayoutStatus(data){
 const host=el("eggPayoutStatus");
 if(!data?.stake){host.hidden=true;return;}
 host.hidden=false;host.replaceChildren(document.createTextNode(
  data.eggBroken?"EGG BROKEN · "+data.status:"EGG SURVIVED · STAKE RETAINED BY EGG"));
 if(data.payoutSignature){
  const a=document.createElement("a");a.href="https://solscan.io/tx/"+
   encodeURIComponent(data.payoutSignature);a.target="_blank";a.rel="noopener noreferrer";
  a.textContent="EGG PAYOUT ON SOLSCAN";
  host.append(document.createTextNode(" · "),a);
 }
}
async function settle(run){
 if(!run?.id)return true;
 const state=await api({action:"status",raidId:run.id});
 if(!state?.stake)return true;
 showPayoutStatus(state);
 if(!state.eggBroken)return true;
 while(window.VHouseAuth.getUser()?.id===run.ownerId&&raid===run){
  const payout=await api({action:"payout",raidId:run.id});
  showPayoutStatus({...state,status:payout?.status,payoutSignature:payout?.signature||""});
  if(payout?.status==="TRANSFERRED"){
   await updateReceipt(run);
   return true;
  }
  if(payout?.status!=="PENDING")return false;
  await new Promise(r=>setTimeout(r,1800));
 }
 return false;
}
window.VHouseEggBet={offer,cancel,updateProgress,updateReceipt,settle};
})();