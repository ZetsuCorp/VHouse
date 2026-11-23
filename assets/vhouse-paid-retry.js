/* VHouse $0.50 continuation: use existing Phantom transaction conventions. */
(function(){
  let busy=false;
  let dismissedRaid=null;
  const el=id=>document.getElementById(id);
  function status(message,signature=""){
    const host=el("paidRetryStatus");
    host.replaceChildren(document.createTextNode(message));
    if(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)){
      const a=document.createElement("a");
      a.href="https://solscan.io/tx/"+encodeURIComponent(signature);
      a.target="_blank";a.rel="noopener noreferrer";
      a.textContent="VIEW PAYMENT ON SOLSCAN";
      host.append(document.createTextNode(" · "),a);
    }
  }
  function eligible(run){
    return raid===run && run.completed && run.defeated &&
      run.serverStatus==="RESULTS_READY" && !raidConfirmationStarted &&
      raidAuth.getUser()?.id===run.ownerId;
  }
  async function api(payload){
    const {data,error}=await raidAuth.getClient().functions.invoke(
      "vhouse-raid-retry-verify",{body:payload});
    if(error){
      let reason=error.message||"RETRY_VERIFICATION_UNAVAILABLE";
      try{const parsed=await error.context?.json?.();reason=parsed?.error||reason;}catch{}
      throw Error(reason);
    }
    return data;
  }
  async function payment(run){
    const playerId=run.ownerId;
    status("CHECKING $0.50 RETRY PAYMENT...");
    const quote=await api({action:"quote",raidId:run.id});
    if(!quote?.quoteId || !Number.isSafeInteger(Number(quote.lamports)) ||
       Number(quote.lamports)<=0)throw Error(quote?.error||"RETRY_QUOTE_INVALID");
    const quoteId=quote.quoteId;
    let signature=quote.signature||"";
    if(quote.verified===true){
      status("PAYMENT VERIFIED · CONTINUING RAID",signature);
      return quoteId;
    }
    if(!signature){
      const phantom=window.phantom?.solana||window.solana;
      if(!phantom?.isPhantom||!phantom?.signAndSendTransaction)
        throw Error("CONNECT PHANTOM TO PAY $0.50");
      const connected=await phantom.connect();
      if(!eligible(run))throw Error("RAID_RETRY_STATE_CHANGED");
      const address=connected?.publicKey?.toBase58?.()||phantom.publicKey?.toBase58?.();
      if(!address||address!==quote.walletAddress)
        throw Error("CONNECT THE PHANTOM WALLET LINKED TO VHOUSE");
      const {Connection,PublicKey,Transaction,SystemProgram,TransactionInstruction}=
        await import("https://esm.sh/@solana/web3.js@1.99.0?bundle");
      let latest=null;
      for(const endpoint of ["https://solana-rpc.publicnode.com",
        "https://api.mainnet-beta.solana.com"]){
        try{latest=await new Connection(endpoint,"confirmed").getLatestBlockhash("confirmed");if(latest)break;}
        catch(error){console.warn("Retry blockhash:",endpoint,error);}
      }
      if(!latest)throw Error("SOLANA_RPC_UNAVAILABLE");
      const owner=new PublicKey(address),tx=new Transaction();
      tx.add(SystemProgram.transfer({
        fromPubkey:owner,toPubkey:new PublicKey(quote.treasury),
        lamports:Number(quote.lamports)
      }));
      tx.add(new TransactionInstruction({
        programId:new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        keys:[],data:new TextEncoder().encode("VHOUSE:RAID:RETRY:"+quoteId)
      }));
      tx.feePayer=owner;tx.recentBlockhash=latest.blockhash;
      status("APPROVE $0.50 ("+(Number(quote.lamports)/1e9).toFixed(9)+" SOL) IN PHANTOM");
      const result=await phantom.signAndSendTransaction(tx,{
        skipPreflight:false,preflightCommitment:"confirmed"
      });
      signature=typeof result==="string"?result:result?.signature;
      if(!signature)throw Error("PHANTOM_PAYMENT_SIGNATURE_MISSING");
      if(raidAuth.getUser()?.id!==playerId)throw Error("RAID_PAYMENT_ACCOUNT_CHANGED");
      status("PAYMENT SUBMITTED · VERIFYING ON SOLANA",signature);
      try{await api({action:"submit",raidId:run.id,quoteId,signature});}
      catch(error){console.warn("Retry submitted signature:",error);}
    }
    let unavailable=0;
    while(raidAuth.getUser()?.id===playerId&&eligible(run)){
      try{
        const result=await api({action:"verify",raidId:run.id,quoteId,signature});
        if(result?.verified===true){
          status("PAYMENT VERIFIED · CONTINUING RAID",signature);
          return quoteId;
        }
        if(result?.error!=="PAYMENT_CONFIRMATION_PENDING")
          throw Error(result?.error||"RETRY_VERIFICATION_FAILED");
        unavailable=0;
        status("PAYMENT SUBMITTED · CHECKING SOLANA",signature);
      }catch(error){
        const reason=error?.message||"RETRY_VERIFICATION_UNAVAILABLE";
        if(!["RETRY_VERIFICATION_UNAVAILABLE","SOLANA_RPC_UNAVAILABLE",
          "RETRY_PAYMENT_RECORD_FAILED","RETRY_PAYMENT_LOOKUP_FAILED",
          "RETRY_SIGNATURE_SAVE_FAILED","Failed to fetch",
          "Failed to send a request to the Edge Function"].includes(reason))throw error;
        unavailable++;
        status("PAYMENT SUBMITTED · RETRYING VERIFICATION",signature);
      }
      await new Promise(resolve=>setTimeout(resolve,
        unavailable?Math.min(10000,1800+unavailable*1000):1800));
    }
    throw Error("RAID_RETRY_STATE_CHANGED");
  }
  window.maybeShowPaidRetry=function(raidId){
    const run=raid;
    if(!eligible(run)||run.id!==raidId||dismissedRaid===raidId||busy)return;
    el("paidRetryBoss").textContent="BOSS "+run.boss;
    status("");
    el("paidRetryOffer").hidden=false;
  };
  el("paidRetryDecline").addEventListener("click",()=>{
    if(busy||!raid)return;
    dismissedRaid=raid.id;
    el("paidRetryOffer").hidden=true;
    status("");
  });
  el("paidRetryContinue").addEventListener("click",async()=>{
    const run=raid;
    if(!run||busy||!eligible(run))return;
    busy=true;
    el("paidRetryContinue").disabled=true;
    el("paidRetryDecline").disabled=true;
    el("confirmButton").disabled=true;
    try{
      const quoteId=await payment(run);
      if(!eligible(run))throw Error("RAID_RETRY_STATE_CHANGED");
      const record=await raidRpc("vhouse_use_paid_raid_retry",{
        p_raid_id:run.id,p_quote_id:quoteId
      });
      if(raid!==run||record.id!==run.id||record.status!=="ACTIVE")
        throw Error("RAID_RETRY_STATE_CHANGED");
      el("paidRetryOffer").hidden=true;
      dismissedRaid=null;
      raid=null;
      startRaid(record);
    }catch(error){
      console.error("Paid Raid continuation:",error);
      if(raid===run){
        status("CONTINUATION: "+(error?.message||"UNAVAILABLE"));
        el("confirmButton").disabled=false;
      }
    }finally{
      busy=false;
      el("paidRetryContinue").disabled=false;
      el("paidRetryDecline").disabled=false;
    }
  });
})();
