/* VHouse Placeholder: one authoritative active VCard assignment across Mint,
   Load and Closet. Per-card Journey / Raid activity is separate from the active slot.
   Player data lives in Supabase, not localStorage. */
(function(){
"use strict";
const subscribers=new Set();
let cards=[], activeId=null,activeSnapshot=null, loadedPlayerId=null;
let journeyStates=new Map();
let request=0, loadPromise=Promise.resolve(), assignmentQueue=Promise.resolve();
const copy=value=>value?{...value}:null;
const gameStats=card=>window.VHouseAmalieStats?.apply?.(
   window.VHouseScrapStats?.apply?.(card)||copy(card)
 )||copy(card);
const auth=()=>window.VHouseAuth;
const playerId=()=>auth()?.getUser()?.id||null;
const key=id=>String(id??"");
const notify=()=>{for(const fn of subscribers)try{fn()}catch(e){console.error(e)}};
function clear(){
  cards=[];activeId=null;activeSnapshot=null;loadedPlayerId=null;
  journeyStates=new Map();notify();
}
function getCards(){
  const all=cards.map(copy);
  if(activeSnapshot?.external&&!all.some(c=>c.id===activeSnapshot.id))all.push(copy(activeSnapshot));
  return all.map(gameStats);
}
function getActive(){
  return gameStats(cards.find(c=>c.id===activeId)||
    (activeSnapshot?.id===activeId?activeSnapshot:null));
}
function getStatus(cardId){
  const status=journeyStates.get(key(cardId));
  return status?copy(status):{status:"AVAILABLE",activity:null,missionId:null,stageId:null};
}
async function loadForPlayer(options={}){
  const ticket=++request,service=auth();
  if(!service){clear();return;}
  await service.ready;
  const id=playerId();
  if(!id){if(ticket===request)clear();return;}
  const data=await service.loadPlayerData(options);
  const statusResponse=data?.vcardStates?null:await service.getClient()
    .from("vhouse_vcard_journey_states")
    .select("card_id,status,mission_id,stage_id,activity").eq("player_id",id);
  if(statusResponse?.error)throw statusResponse.error;
  if(ticket!==request||playerId()!==id||!data)return;
  const owned=[...new Set((data.inventory||[])
    .filter(row=>row.type==="VCard"&&Number(row.quantity)>0)
    .map(row=>row.thing))];
  let rows=Array.isArray(data.vcardRows)?data.vcardRows:null;
  if(!rows&&owned.length){
    const response=await service.getClient().from("vcard_list")
      .select("card_id,name,image,description,designation,level,atk,def,luck,speed,mint_address")
      .in("card_id",owned);
    if(response.error)throw response.error;
    rows=response.data||[];
  }
  const found=(rows||[]).filter(row=>owned.includes(row.card_id)).map(row=>({
    id:row.card_id,name:row.name,image:row.image||"",
    description:row.description||"",team:row.designation,
    level:row.level,atk:row.atk,def:row.def,
    luck:row.luck,speed:row.speed,mint_address:row.mint_address
  }));
  if(ticket!==request||playerId()!==id)return;
  const assigned=data.account?.active_vcard_id||null;
  const snapshot=data.account?.active_vcard_snapshot||null;
  cards=found;
  activeId=assigned;
  activeSnapshot=snapshot?.id===assigned&&snapshot.external?copy(snapshot):null;
  if(!getActive())activeId=null;
  loadedPlayerId=id;
  journeyStates=new Map((data.vcardStates||statusResponse?.data||[]).map(row=>[
    key(row.card_id),{
      status:row.status,missionId:row.mission_id,stageId:row.stage_id,activity:row.activity
    }
  ]));
  notify();
}
function refresh(options={}){
  loadPromise=loadForPlayer(options).catch(e=>{
    console.error("VHouse card data load failed:",e);
    if(!playerId())clear();
    throw e;
  });
  loadPromise.catch(()=>{});
  return loadPromise;
}
function queueAssignment(work){
  const task=assignmentQueue.catch(()=>{}).then(work);
  assignmentQueue=task.catch(()=>{});
  return task;
}
async function setActive(cardId){
  const id=key(cardId);
  return queueAssignment(async()=>{
    await loadPromise.catch(()=>{});
    const account=playerId();
    if(!account)throw Error("Sign in to assign a VCard.");
    const card=cards.find(c=>key(c.id)===id)||
      (activeSnapshot?.id===id?activeSnapshot:null);
    if(!card)throw Error("This VCard is not in your Closet.");
    await refresh();
    if(getStatus(id).status!=="AVAILABLE")throw Error("This VCard is busy.");
    await auth().syncActiveVCard(card);
    if(playerId()!==account)throw Error("VHouse account changed during assignment.");
    activeId=id;
    activeSnapshot=card.external?copy(card):null;
    notify();
    return copy(card);
  });
}
/* LOAD's NFT ownership is verified by the Creator before this call.
   Do not insert external NFTs into the internal VCard inventory. */
async function assignLoaded(details){
  if(!details||!details.mint_address||!details.ownerWallet)
    throw Error("Verified NFT owner and mint address required.");
  await loadPromise.catch(()=>{});
  const existing=cards.find(c=>c.mint_address===details.mint_address);
  if(existing)return setActive(existing.id);
  const account=playerId();
  if(!account)throw Error("Sign in to assign a loaded NFT.");
  const card={
    id:"nft:"+String(details.mint_address),
    external:true,
    mint_address:String(details.mint_address),
    owner_wallet:String(details.ownerWallet),
    name:String(details.name||"Loaded NFT").slice(0,16),
    description:String(details.description||"").slice(0,100),
    image:String(details.image||""),
    team:["R","P","S"].includes(details.team)?details.team:"R",
    level:Number(details.level)||1,
    atk:Number(details.atk)||100,
    def:Number(details.def)||100
  };
  return queueAssignment(async()=>{
    if(playerId()!==account)throw Error("VHouse account changed during NFT load.");
    await auth().syncActiveVCard(card);
    if(playerId()!==account)throw Error("VHouse account changed during NFT load.");
    activeId=card.id;
    activeSnapshot=copy(card);
    notify();
    return copy(card);
  });
}
/* DB trigger already saved this status with the Journey record.
   Update local presentation, then reconcile with authoritative Supabase state. */
async function setJourneyStatus(cardId,status,missionId,stageId){
  const id=key(cardId);
  if(!id||!playerId())return;
  if(!["ON_JOURNEY","RESULTS_READY","AVAILABLE"].includes(status))
    throw Error("Unknown VCard Journey status.");
  const previous=journeyStates.get(id);
  if(status==="AVAILABLE"){
    if(previous&&missionId&&previous.missionId!==missionId)return;
    journeyStates.delete(id);
  }else{
    journeyStates.set(id,{status,missionId,stageId:stageId??null,activity:"JOURNEY"});
  }
  notify();
  await refresh();
}

const api={
  getCards,getActive,getActiveId:()=>activeId,
  getLoadedPlayerId:()=>loadedPlayerId,
  getStatus,getActiveStatus:()=>getStatus(activeId),
  isLocked:id=>getStatus(id).status!=="AVAILABLE",
  getLockedCards:()=>[...journeyStates.entries()].map(([id,entry])=>({cardId:id,...entry})),
  ready:()=>loadPromise,refresh,
  subscribe(fn){subscribers.add(fn);return()=>subscribers.delete(fn);},
  setActive,assignLoaded,setJourneyStatus,
  async saveCard(card){
    const service=auth();
    if(!service)throw Error("Sign in before creating a VCard.");
    await service.ready;
    const account=playerId();
    if(!account)throw Error("Sign in before creating a VCard.");
    const receipt=card.mintReceipt;
    const params={
      p_name:card.name,p_image:card.image,
      p_description:card.description,p_designation:card.team
    };
    // Minted VCards are registered only after the server re-checks the
    // confirmed Solana mint, signed fee, linked wallet and token ownership.
    const {data,error}=receipt
      ? await service.getClient().functions.invoke("vcard-mint-verified",{
          body:{...card}
        })
      : await service.getClient().rpc("vhouse_create_vcard",params);
    if(error)throw error;
    if(!data?.card_id)throw Error("Supabase did not return a VCard.");
    if(playerId()!==account)throw Error("Account changed during creation.");
    await refresh(); // Mint already assigns the new VCard in the database RPC.
    return {
      id:data.card_id,name:data.name,image:data.image,
      description:data.description,team:data.designation,
      level:data.level,atk:data.atk,def:data.def,
      luck:data.luck,speed:data.speed,mint_address:data.mint_address
    };
  }
};
window.VHouseCardStore=api;
window.addEventListener("vhouse:scrap-stats-updated",notify);
window.addEventListener("vhouse:amalie-stats-updated",notify);
window.addEventListener("pageshow",event=>{if(event.persisted&&playerId())void refresh();});
for(const [event,status] of [
  ["vhouse:journey-started","ON_JOURNEY"],
  ["vhouse:journey-completed","RESULTS_READY"],
  ["vhouse:journey-confirmed","AVAILABLE"]
]){
  window.addEventListener(event,e=>{
    const d=e.detail||{},id=d.cardId;
    if(!id||!d.missionId)return;
    void setJourneyStatus(id,status,d.missionId,d.stageId).catch(err=>
      console.error("VHouse VCard Journey status:",err));
  });
}
const service=auth();
if(service){
  let previousUserId=null;
  service.subscribe(user=>{
    const next=user?.id||null;
    if(!next){
      previousUserId=null;++request;clear();return;
    }
    if(next===previousUserId)return;
    previousUserId=next;
    void refresh();
  });
  void service.ready.then(()=>{
    if(playerId()&&loadedPlayerId!==playerId())return refresh();
  }).catch(e=>console.error("VHouse login unavailable:",e));
}else{
  console.error("VHouse Auth must load before VCard store.");
}
})();