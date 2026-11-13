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

/* Restore and persist the full Journey receipt state for the signed-in player.
   The public browser never holds another player's progress. */
async function prepareJourneyStore(){
  const auth=window.VHouseAuth;
  if(!auth)return;
  await auth.ready;
  const id=auth.getUser()?.id;
  if(!id)return;
  const client=auth.getClient();
  const {data,error}=await client.from("vhouse_journey_progress")
    .select("progress").eq("player_id",id).maybeSingle();
  if(error)throw error;
  const snapshot=data?.progress&&typeof data.progress==="object"
    ?data.progress:null;
  let queue=Promise.resolve();
  if(!window.VHouseJourneyStore){
    window.VHouseJourneyStore={
      load(){
        return auth.getUser()?.id===id?snapshot:null;
      },
      save(next){
        if(auth.getUser()?.id!==id)return Promise.reject(Error("Player changed."));
        const safe=structuredClone(next);
        queue=queue.catch(()=>{}).then(async()=>{
          if(auth.getUser()?.id!==id)throw Error("Player changed.");
          const {error:writeError}=await client.from("vhouse_journey_progress")
            .upsert({player_id:id,progress:safe,updated_at:new Date().toISOString()},
                    {onConflict:"player_id"});
          if(writeError)throw writeError;
        });
        queue.catch(err=>console.error("Journey progress not saved:",err));
        return queue;
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
  position:relative;
  width:100%;
  height:100%;
  min-width:0;
  min-height:0;
  overflow:hidden;
}
/* An entire Journey screen sits INSIDE the existing Vcontainer opening.
   Its 860x390 design surface is uniformly fitted to the available space. */
.game{
  position:absolute;
  left:50%;
  top:50%;
  width:860px;
  height:390px;
  max-width:none;
  min-width:860px;
  min-height:390px;
  margin:0;
  transform:translate(-50%,-50%) scale(var(--journey-scale,1));
  transform-origin:center center;
  color:#e8f4f8;
  font:13px Arial,sans-serif;
  overflow:hidden;
}
main{
  flex:1 1 0;
  min-height:0;
  height:100%;
  padding:8px;
  overflow:hidden;
}
#setupScreen,
#travelScreen,
#completeScreen,
#awayScreen{
  width:100%;
  height:100%;
  min-height:0;
  overflow:hidden;
}
#setupScreen .setup-layout{
  height:100%;
  min-height:0;
  grid-template-columns:.94fr 1.06fr;
  gap:9px;
}
.setup-world{height:100%;min-height:0}
.setup-card{width:175px;max-width:90%}
.setup-panel{
  padding:10px;
  min-height:0;
  gap:7px;
}
.setup-panel h2{font-size:18px;margin:0 0 5px}
.setup-panel h3{font-size:12px;margin:0 0 5px}
.setup-panel .player-line{font-size:11px;line-height:1.3}
.stage-picker{padding:8px}
.stage-summary{gap:5px}
.metric{padding:6px 3px}
.metric b{font-size:20px}
.metric small{font-size:9px}
.reward-list{gap:5px}
.reward-chip{padding:6px 9px;font-size:11px}
.setup-panel > .muted{font-size:11px;line-height:1.35;margin:0}
.start-button{padding:10px;margin-top:auto}
.travel-world{height:187px}
.travel-card{width:112px}
.travel-bottom{margin-top:8px;gap:9px;grid-template-columns:1fr 1fr}
.travel-bottom .panel{padding:8px;min-width:0}
.travel-bottom h2{font-size:15px;margin:0 0 4px}
.travel-bottom h3{font-size:12px;margin:0 0 5px}
.travel-bottom .muted{font-size:10px;line-height:1.25}
.travel-bottom p{margin:6px 0 0}
.clock{font-size:25px;margin:4px 0}
.loading-list{gap:4px}
.loading-item{padding:4px;font-size:9px}
.loading-item strong{margin-top:2px}
#travelScreen > .actions{margin-top:7px}
#travelScreen > .actions button{padding:7px 12px}
#completeScreen{
  grid-template-columns:220px minmax(0,1fr);
  grid-template-rows:29px minmax(0,1fr) 30px;
  gap:6px 9px;
}
#completeScreen .complete-top{justify-content:space-between;gap:12px}
.complete-top h2{font-size:16px;margin:0}
.complete-top .muted{font-size:10px}
#completeScreen .loot-card-wrap{padding:0}
.flip{width:205px}
.loot-receipt{padding:6px 5px}
.loot-receipt h3{font-size:14px;margin:4px 0;padding-bottom:5px}
.loot-stage{font-size:14px;margin:5px 0}
.loot-count{padding:5px 0;font-size:10px}
.loot-count b{font-size:18px}
.loot-values{gap:5px;margin-top:6px}
.loot-value{padding:5px 3px}
.loot-value strong{font-size:18px}
.confirm{min-height:32px;font-size:13px}
.confirmed{padding:5px 2px;font-size:11px}
#completeScreen .result-panel{padding:9px}
.result-panel h3{font-size:12px;margin:0 0 6px}
.result-table-wrap{overflow:hidden;min-height:0;flex:1}
table{table-layout:fixed;font-size:10px}
th,td{padding:5px 3px;font-size:10px;line-height:1.15}
th:nth-child(1),td:nth-child(1){width:6%}
th:nth-child(2),td:nth-child(2){width:18%}
th:nth-child(3),td:nth-child(3){width:15%}
th:nth-child(4),td:nth-child(4){width:39%}
th:nth-child(5),td:nth-child(5){width:22%}
.result-footer{gap:5px;margin-top:5px;font-size:10px}
#completeScreen > .actions button{padding:6px 14px}
#awayScreen.away{padding:12px}
.message{display:none}
`;

/* Fit the entire inner game container to its surrounding VHouse container.
   Layout never grows vertically and no scrolling is needed. */
function fitJourney(host){
  if(!host.__journeyFit){
    const resize=()=>{
      const bounds=host.getBoundingClientRect();
      if(bounds.width<=0||bounds.height<=0)return;
      const scale=Math.min(bounds.width/860,bounds.height/390);
      host.style.setProperty("--journey-scale",String(scale));
    };
    const observer=new ResizeObserver(resize);
    observer.observe(host);
    host.__journeyFit={resize,observer};
  }
  host.__journeyFit.resize();
}

async function load(host,options={}){
  if(!host)throw Error("Journey mount container is required.");
  if(loading)return loading;
  loading=(async()=>{
    try{
      await window.VHouseCardStore?.ready?.();
      await refreshInventory();
      await prepareJourneyStore();
      const shadow=host.shadowRoot;
      if(shadow?.getElementById("game")){
        fitJourney(host);
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
      fitJourney(host);
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
