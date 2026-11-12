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
    async saveCard(card){
      const auth=window.VHouseAuth;
      if(!auth)throw Error("Sign in before creating a VCard.");
      await auth.ready;
      const playerId=currentUserId();
      if(!playerId)throw Error("Sign in before creating a VCard.");
      const {data,error}=await auth.getClient().rpc("vhouse_create_vcard",{
        p_name:card.name,p_image:card.image,
        p_description:card.description,p_designation:card.team
      });
      if(error)throw error;
      if(!data?.card_id)throw Error("Supabase did not return a VCard.");
      if(currentUserId()!==playerId)throw Error("Account changed during creation.");
      await refresh();
      return {id:data.card_id,name:data.name,image:data.image,
        description:data.description,team:data.designation,
        level:data.level,atk:data.atk,def:data.def,
        luck:data.luck,speed:data.speed,mint_address:data.mint_address};
    },
    async saveMintReceipt(cardId,receipt){
      const auth=window.VHouseAuth;
      if(!auth)throw Error("Sign in before saving the mint receipt.");
      await auth.ready;
      const playerId=currentUserId();
      if(!playerId)throw Error("Sign in before saving the mint receipt.");
      const {data,error}=await auth.getClient().functions.invoke("vcard-mint-receipt",{
        body:{
          cardId,
          mintAddress:receipt.mintAddress,
          transactionSignature:receipt.transactionSignature,
          metadataUri:receipt.metadataUri,
          imageUri:receipt.imageUri
        }
      });
      if(currentUserId()!==playerId)throw Error("Account changed during receipt save.");
      if(error){
        let detail=error.message;
        if(error.context?.json){
          try{detail=(await error.context.json()).error||detail;}catch{}
        }
        throw Error(detail||"Receipt verification failed.");
      }
      if(!data?.ok||data?.mintAddress!==receipt.mintAddress)
        throw Error(data?.error||"Mint receipt was not saved.");
      await refresh();
      return data.receipt;
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
