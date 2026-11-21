/* VHouse internal VCard strength from confirmed Scrap token balance snapshots.
   NFT metadata and vcard_list base stats stay unchanged. */
(function(){
"use strict";
let snapshot=null,loadedPlayer=null,inflight=null;
const listeners=new Set();
const auth=()=>window.VHouseAuth;
const userId=()=>auth()?.getUser?.()?.id||null;
function notify(){
  for(const listener of listeners){try{listener(snapshot)}catch(e){console.error(e)}}
  window.dispatchEvent(new Event("vhouse:scrap-stats-updated"));
}
function getSnapshot(){
  return userId()&&userId()===loadedPlayer&&snapshot?{...snapshot}:null;
}
function apply(card){
  if(!card)return card;
  const stats=getSnapshot();
  if(!stats)return {...card};
  const atk=Number(stats.atk),def=Number(stats.def);
  if(!Number.isFinite(atk)||!Number.isFinite(def))return {...card};
  return {...card,atk:atk.toFixed(1),def:def.toFixed(1)};
}
async function refresh(){
  const service=auth();
  if(!service)return null;
  await service.ready;
  const id=userId();
  if(!id){
    if(snapshot||loadedPlayer){snapshot=null;loadedPlayer=null;notify()}
    return null;
  }
  if(inflight?.id===id)return inflight.promise;
  const promise=(async()=>{
    const {data,error}=await service.getClient().functions.invoke("vhouse-scrap-stats",{
      body:{}
    });
    if(error){
      let message=error.message||"SCRAP_STATS_UNAVAILABLE";
      try{const body=await error.context?.json?.();message=body?.error||message}catch{}
      throw Error(message);
    }
    if(!data?.snapshot||!Number.isFinite(Number(data.snapshot.atk))||
      !Number.isFinite(Number(data.snapshot.def)))
      throw Error(data?.error||"SCRAP_SNAPSHOT_UNAVAILABLE");
    if(userId()!==id)return null;
    snapshot=data.snapshot;
    loadedPlayer=id;
    notify();
    return getSnapshot();
  })();
  inflight={id,promise};
  try{return await promise}finally{if(inflight?.promise===promise)inflight=null}
}
window.VHouseScrapStats={
  refresh,getSnapshot,apply,
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}
};
function onLogin(user){
  const id=user?.id||null;
  if(id!==loadedPlayer){
    snapshot=null;
    loadedPlayer=null;
    notify();
  }
  if(!id)return;
  void refresh().catch(error=>console.warn("VHouse Scrap strength:",error));
}
if(auth()){
  auth().subscribe(onLogin);
  void auth().ready.then(()=>onLogin(auth().getUser?.()))
    .catch(error=>console.warn("VHouse Scrap strength unavailable:",error));
}
window.addEventListener("vhouse:scrap-transfer-confirmed",()=>{
  void refresh().catch(error=>console.warn("Scrap strength update:",error));
});
})();