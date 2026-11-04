/* VHouse card data reads: authenticated Supabase player records only.
   No browser-local card storage. Card creation and writes are separate work. */
(function () {
  "use strict";
  const subscribers=new Set();
  let cards=[], activeId=null, loadedPlayerId=null, request=0;
  const copy=c=>c?{...c}:null;
  function notify(){for(const fn of subscribers){try{fn()}catch(error){console.error(error)}}}
  function clear(){
    cards=[];activeId=null;loadedPlayerId=null;
    notify();
  }
  function currentUserId(){return window.VHouseAuth?.getUser()?.id||null;}
  async function loadForPlayer(){
    const ticket=++request;
    const auth=window.VHouseAuth;
    if(!auth){clear();return;}
    await auth.ready;
    const userId=currentUserId();
    if(!userId){if(ticket===request)clear();return;}
    const data=await auth.loadPlayerData();
    if(ticket!==request||currentUserId()!==userId)return;
    if(!data){clear();return;}
    const ids=[...new Set(data.inventory
      .filter(row=>row.type==="VCard"&&row.quantity>0)
      .map(row=>row.thing))];
    let records=[];
    if(ids.length){
      const client=auth.getClient();
      const {data:found,error}=await client.from("vcard_list")
        .select("card_id,name,image,description,designation,level,atk,def,luck,speed,mint_address")
        .in("card_id",ids);
      if(error)throw error;
      records=(found||[]).map(row=>({
        id:row.card_id,name:row.name,image:row.image||"",
        description:row.description||"",team:row.designation,
        level:row.level,atk:row.atk,def:row.def,
        luck:row.luck,speed:row.speed,mint_address:row.mint_address
      }));
    }
    if(ticket!==request||currentUserId()!==userId)return;
    loadedPlayerId=userId;
    cards=records;
    activeId=cards.some(card=>card.id===data.account?.active_vcard_id)
      ? data.account.active_vcard_id:null;
    notify();
  }
  let loadPromise=Promise.resolve();
  function refresh(){
    loadPromise=loadForPlayer().catch(error=>{
      console.error("VHouse card data load failed:",error);
      if(!currentUserId())clear();
      throw error;
    });
    loadPromise.catch(()=>{});
    return loadPromise;
  }
  const api={
    getCards:()=>cards.map(copy),
    getActive:()=>copy(cards.find(card=>card.id===activeId)),
    getActiveId:()=>activeId,
    getLoadedPlayerId:()=>loadedPlayerId,
    ready:()=>loadPromise,
    refresh,
    subscribe(callback){
      subscribers.add(callback);
      return ()=>subscribers.delete(callback);
    },
    async saveCard(){
      throw Error("VCard creation is not connected to Supabase saving yet.");
    },
    async setActive(){
      throw Error("Active VCard saving is not connected to Supabase yet.");
    }
  };
  window.VHouseCardStore=api;
  const auth=window.VHouseAuth;
  if(auth){
    let previousUserId=null;
    auth.subscribe(user=>{
      const nextId=user?.id||null;
      if(!nextId){
        previousUserId=null;
        ++request;
        clear();
        return;
      }
      if(nextId===previousUserId)return;
      previousUserId=nextId;
      void refresh();
    });
    void auth.ready.then(()=>{
      if(currentUserId()&&loadedPlayerId!==currentUserId())return refresh();
    }).catch(error=>console.error("VHouse login unavailable:",error));
  }else{
    console.error("VHouse Auth must load before the VCard data store.");
  }
})();
