/* VHouse Placeholder Mini-Game.
   Same portrait footprint and artwork; click to inspect active and locked VCards. */
(function(){
"use strict";
const holderArt=new URL("PlayerHolder-removebg-preview.png",document.currentScript.src).href;
function mount(host){
  if(!host||host.dataset.placeholderReady==="yes")return;
  host.dataset.placeholderReady="yes";
  host.classList.add("vhouse-player");

  const holder=document.createElement("img");
  holder.className="vhouse-player-holder";
  holder.src=holderArt;holder.alt="";holder.draggable=false;
  const art=document.createElement("img");
  art.className="vhouse-player-portrait";art.alt="";art.draggable=false;
  const loginLabel=document.createElement("span");
  loginLabel.className="vhouse-player-login";loginLabel.hidden=true;
  // Player-wide VCard Cash is shown only beside the Index Player Placeholder.
  const showCash=!!host.closest(".town-player-hud");
  const cashBox=document.createElement("div");
  cashBox.className="vhouse-player-cash";
  const cashTitle=document.createElement("strong");
  cashTitle.textContent="VCARD CASH";
  const cashAmount=document.createElement("span");
  cashAmount.textContent="— IGM";
  cashBox.append(cashTitle,cashAmount);
  const accountHud=document.createElement("div");
  accountHud.className="vhouse-player-account";accountHud.hidden=true;
  const accountBox=document.createElement("div");
  accountBox.className="vhouse-player-account-box";
  accountBox.append(loginLabel,cashBox);
  const rewardsBox=document.createElement("div");
  rewardsBox.className="vhouse-player-rewards-box";
  const rewardsTitle=document.createElement("strong");
  rewardsTitle.textContent="TOTAL REWARDS";
  const rewardsAmount=document.createElement("span");
  rewardsAmount.textContent="—";
  rewardsBox.append(rewardsTitle,rewardsAmount);
  accountHud.append(accountBox,rewardsBox);
  const status=document.createElement("span");
  status.className="vhouse-placeholder-status";status.hidden=true;
  const trigger=document.createElement("button");
  trigger.type="button";
  trigger.className="vhouse-placeholder-trigger";
  trigger.setAttribute("aria-label","Open VCard Placeholder");
  trigger.setAttribute("aria-expanded","false");
  const panel=document.createElement("section");
  panel.className="vhouse-placeholder-panel";panel.hidden=true;
  panel.setAttribute("role","dialog");
  panel.setAttribute("aria-label","VCard Placeholder");
  const header=document.createElement("div");
  header.className="vhouse-placeholder-title";header.textContent="VCARD PLACEHOLDER";
  const selected=document.createElement("div");
  selected.className="vhouse-placeholder-selection";
  const details=document.createElement("div");
  details.className="vhouse-placeholder-details";
  const journey=document.createElement("div");
  journey.className="vhouse-placeholder-journeys";
  const actions=document.createElement("div");
  actions.className="vhouse-placeholder-actions";
  const closet=document.createElement("button");
  closet.type="button";closet.textContent="CLOSET";
  closet.onclick=()=>{location.href="./VCloset.html";};
  const creator=document.createElement("button");
  creator.type="button";creator.textContent="MINT / LOAD";
  creator.onclick=()=>{location.href="./VCardCreator.html";};
  const goJourney=document.createElement("button");
  goJourney.type="button";goJourney.textContent="JOURNEY";
  goJourney.onclick=()=>{location.href="./index.html?journey=1";};
  const close=document.createElement("button");
  close.type="button";close.textContent="✕";close.setAttribute("aria-label","Close Placeholder");
  close.onclick=()=>{panel.hidden=true;trigger.setAttribute("aria-expanded","false");};
  header.append(close);
  actions.append(closet,creator,goJourney);
  panel.append(header,selected,details,journey,actions);
  host.replaceChildren(holder,art,...(showCash?[accountHud]:[loginLabel]),status,trigger,panel);
  const store=window.VHouseCardStore;
  let cashRequest=0;
  let balancePlayerId=null;
  let lastCash=null;
  let lastRewards=null;
  const numberText=value=>value.toLocaleString(undefined,{maximumFractionDigits:2});

  // Each confirmed reward bag counts once, regardless of the number of IGM
  // or other assets inside it. Records are already tied to the signed-in player.
  async function totalRewardBags(client,playerId){
    const pageSize=500;
    let total=0;
    for(let start=0;;start+=pageSize){
      const {data,error}=await client.from("vhouse_journey_records")
        .select("snapshot")
        .eq("player_id",playerId)
        .in("status",["RESULTS_READY","CONFIRMED"])
        .order("id",{ascending:true})
        .range(start,start+pageSize-1);
      if(error)throw error;
      for(const record of data||[]){
        const batches=record.snapshot?.rewardBatches;
        if(!batches||typeof batches!=="object"||Array.isArray(batches))continue;
        for(const amount of Object.values(batches)){
          const count=Number(amount);
          if(Number.isFinite(count)&&count>0)total+=Math.floor(count);
        }
      }
      if(!data||data.length<pageSize)break;
    }
    return total;
  }
  function showGain(box,value,unit){
    if(value<=0)return;
    const pop=document.createElement("span");
    pop.className="vhouse-player-gain";
    pop.textContent="+"+numberText(value)+(unit?" "+unit:"");
    box.querySelectorAll(".vhouse-player-gain").forEach(node=>node.remove());
    box.append(pop);
    pop.addEventListener("animationend",()=>pop.remove(),{once:true});
    box.classList.remove("vhouse-gaining");
    void box.offsetWidth;
    box.classList.add("vhouse-gaining");
  }
  async function refreshCash(){
    if(!showCash)return;
    const auth=window.VHouseAuth;
    const user=auth?.getUser?.();
    const ticket=++cashRequest;
    accountHud.hidden=!user;
    if(!user){
      balancePlayerId=null;lastCash=null;lastRewards=null;
      cashAmount.textContent="— IGM";rewardsAmount.textContent="—";
      return;
    }
    if(balancePlayerId!==user.id){
      balancePlayerId=user.id;lastCash=null;lastRewards=null;
      cashAmount.textContent="— IGM";rewardsAmount.textContent="—";
    }
    try{
      const client=auth.getClient();
      const [account,earned]=await Promise.all([
        client.from("vhouse_accounts").select("igm_balance")
          .eq("id",user.id).maybeSingle(),
        totalRewardBags(client,user.id)
      ]);
      if(account.error)throw account.error;
      if(ticket!==cashRequest||auth.getUser()?.id!==user.id)return;
      const cash=Number(account.data?.igm_balance??0);
      if(!Number.isFinite(cash))throw Error("Invalid VCard Cash balance.");
      cashAmount.textContent=numberText(cash)+" IGM";
      rewardsAmount.textContent=numberText(earned);
      if(lastCash!==null&&cash>lastCash)showGain(accountBox,cash-lastCash,"IGM");
      if(lastRewards!==null&&earned>lastRewards)showGain(rewardsBox,earned-lastRewards,"");
      lastCash=cash;lastRewards=earned;
    }catch(error){
      if(ticket!==cashRequest||auth?.getUser?.()?.id!==user.id)return;
      console.error("VHouse player rewards:",error);
    }
  }
  function updateLogin(){
    const identity=window.VHouseAuth?.getLoginIdentity?.()||"";
    loginLabel.textContent=identity?'Logged in as "'+identity+'"':"";
    loginLabel.hidden=!identity;
    void refreshCash();
  }
  function update(){
    const card=store?.getActive?.()||null;
    const state=store?.getActiveStatus?.()||{status:"AVAILABLE"};
    const locked=state.status!=="AVAILABLE";
    const ready=state.status==="RESULTS_READY";
    if(card&&typeof card.image==="string"&&
      /^(https?:\/\/|blob:|data:image\/(?:svg\+xml|jpeg|png|webp|gif))/i.test(card.image)){
      art.src=card.image;
      host.classList.add("has-vcard");
    }else{
      art.removeAttribute("src");host.classList.remove("has-vcard");
    }
    host.classList.toggle("is-locked",locked);
    host.classList.toggle("results-ready",ready);
    status.hidden=!locked;
    status.textContent=ready?"RESULTS":"LOCKED";
    host.setAttribute("aria-label",card?
      "Active VCard: "+card.name+(locked?", "+(ready?"results ready":"on Journey"):""):
      "Player VCard placeholder");
    selected.textContent=card?String(card.name||"VCard"):"NO VCARD ASSIGNED";
    details.textContent=!card?"Assign a VCard from Mint, Load, or Closet."
      :state.status==="ON_JOURNEY"?"ON JOURNEY · STAGE "+(state.stageId??"—")
      :ready?"RESULTS READY · CONFIRM RECEIPT"
      :"AVAILABLE";
    if(card?.external)details.textContent+=" · LOADED NFT";
    const lockedCards=store?.getLockedCards?.()||[];
    journey.replaceChildren();
    if(lockedCards.length){
      const heading=document.createElement("strong");
      heading.textContent="JOURNEY LOCKS";journey.append(heading);
      for(const entry of lockedCards){
        const row=document.createElement("div");
        const known=store?.getCards?.().find(c=>c.id===entry.cardId);
        row.textContent=(known?.name||entry.cardId)+" · "+
          (entry.status==="RESULTS_READY"?"RESULTS READY":"ON JOURNEY");
        journey.append(row);
      }
    }
    goJourney.textContent=ready?"VIEW RECEIPT":"JOURNEY";
  }
  trigger.addEventListener("click",()=>{
    panel.hidden=!panel.hidden;
    trigger.setAttribute("aria-expanded",String(!panel.hidden));
    if(!panel.hidden)update();
  });
  document.addEventListener("pointerdown",event=>{
    if(!host.contains(event.target)){panel.hidden=true;trigger.setAttribute("aria-expanded","false");}
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape"){panel.hidden=true;trigger.setAttribute("aria-expanded","false");}
  });
  store?.subscribe(update);
  window.VHouseAuth?.subscribe(updateLogin);
  if(showCash){
    window.addEventListener("vhouse:cash-updated",()=>{void refreshCash();});
    window.addEventListener("pageshow",()=>{void refreshCash();});
  }
  window.VHouseAuth?.ready.then(updateLogin).catch(e=>console.warn("Placeholder login unavailable:",e));
  updateLogin();update();
}
function init(){
  document.querySelectorAll("[data-vhouse-player]").forEach(mount);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
else init();
window.VHousePlayer={mount};
})();