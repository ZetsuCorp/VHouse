/* Mount the working Journey framework in VHouse's existing gold-frame overlay.
   JourneyMissions.html supplies the exact interface markup and styles.
   Shadow DOM isolates Journey's screen CSS from the Town map. No iframe. */
(function(){
"use strict";

let loading=null;
let inventorySnapshot={playerId:null,luck:0};

function quantity(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
}

async function refreshInventory(){
  const auth=window.VHouseAuth;
  if(!auth)return;
  await auth.ready;
  const playerId=auth.getUser()?.id;
  if(!playerId){
    inventorySnapshot={playerId:null,luck:0};
    return;
  }
  const data=await auth.loadPlayerData();
  if(!data||data.playerId!==playerId||auth.getUser()?.id!==playerId)return;
  inventorySnapshot={
    playerId,
    luck:(data.inventory||[])
      .filter(row=>String(row.thing||"").trim().toUpperCase()==="LUCK")
      .reduce((sum,row)=>sum+quantity(row.quantity),0)
  };
  // Respect a live inventory provider if the game already supplies one.
  if(!window.VHouseJourneyInventory){
    window.VHouseJourneyInventory={
      getQuantity(name){
        if(String(name).toUpperCase()!=="LUCK")return 0;
        if(window.VHouseAuth?.getUser()?.id!==inventorySnapshot.playerId)return 0;
        return inventorySnapshot.luck;
      }
    };
  }
}

const embeddedCSS=`
:host{
  --gold:#bc9357;
  --gold-light:#f4d79f;
  --cyan:#54c9ef;
  --green:#70e5b2;
  --red:#f58b8b;
  --muted:#9fb6c4;
  display:block;
  width:100%;
  height:100%;
  min-width:0;
  min-height:0;
  container-type:inline-size;
}
.game{
  width:100%;
  height:100%;
  min-height:0;
  max-width:none;
  color:#e8f4f8;
  font:13px Arial,sans-serif;
}
@container (max-width:740px){
  .setup-layout{grid-template-columns:1fr}
  .setup-world{min-height:250px}
  .setup-card{width:140px}
  .travel-bottom{grid-template-columns:1fr}
  .travel-world{height:270px}
  .travel-card{width:125px;animation-name:travelMobile}
  header{padding:13px}
  header h1{font-size:18px}
  main{padding:11px}
  th,td{padding:8px 3px;font-size:10px}
}
`;

async function load(host,options={}){
  if(!host)throw Error("Journey mount container is required.");
  if(loading)return loading;
  loading=(async()=>{
    try{
      await window.VHouseCardStore?.ready?.();
      await refreshInventory();
      const shadow=host.shadowRoot;
      if(shadow?.getElementById("game")){
        return window.VHouseJourneyGame?.init(shadow)||null;
      }
      const response=await fetch(new URL("./JourneyMissions.html",document.baseURI),{cache:"no-store"});
      if(!response.ok)throw Error("Journey source returned "+response.status);
      const source=new DOMParser().parseFromString(await response.text(),"text/html");
      const markup=source.getElementById("game");
      const css=source.querySelector("head style")?.textContent;
      if(!markup||!css)throw Error("Journey framework source is incomplete.");
      if(!window.VHouseJourneyGame?.init)throw Error("Journey framework engine is not loaded.");
      const root=shadow||host.attachShadow({mode:"open"});
      const sheet=document.createElement("style");
      sheet.textContent=css+"\n"+embeddedCSS;
      root.replaceChildren(sheet,document.importNode(markup,true));
      return window.VHouseJourneyGame.init(root);
    }catch(error){
      console.error("VHouse Journey:",error);
      if(!host.shadowRoot?.getElementById("game"))host.textContent="Journey Missions could not be loaded.";
      return null;
    }
  })();
  try{return await loading;}
  finally{loading=null;}
}

window.VHouseJourney={load};
})();
