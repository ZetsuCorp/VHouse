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

/* Every VCard has its own persistent Journey record. Historical records remain
   in Supabase after confirmation; only unconfirmed missions resume on load.
   The old player-wide snapshot is read only as a migration fallback. */
async function prepareJourneyStore(){
  const auth=window.VHouseAuth;
  if(!auth)return;
  await auth.ready;
  const id=auth.getUser()?.id;
  if(!id)return;
  const client=auth.getClient();
  const {data:records,error}=await client.from("vhouse_journey_records")
    .select("mission_id,card_id,status,snapshot,started_at")
    .eq("player_id",id)
    .in("status",["ON_JOURNEY","RESULTS_READY"])
    .order("started_at",{ascending:false});
  if(error)throw error;

  const missions={};
  const saved=new Map();
  for(const row of records||[]){
    const mission=row.snapshot;
    if(!mission||typeof mission!=="object"||!mission.card?.id)continue;
    if(String(mission.card.id)!==String(row.card_id))continue;
    saved.set(String(row.mission_id),JSON.stringify(mission));
    if(!missions[String(row.card_id)])missions[String(row.card_id)]=mission;
  }

  let legacy=null;
  if(!Object.keys(missions).length){
    const old=await client.from("vhouse_journey_progress")
      .select("progress").eq("player_id",id).maybeSingle();
    if(old.error)throw old.error;
    legacy=old.data?.progress&&typeof old.data.progress==="object"
      ?old.data.progress:null;
    const previous=legacy?.mission;
    if(previous?.id&&previous?.card?.id&&previous.status!=="confirmed"){
      missions[String(previous.card.id)]=previous;
    }
  }

  const snapshot={
    missions,
    balance:legacy?.balance||{},
    receipts:legacy?.receipts||[],
    events:legacy?.events||[],
    demoInventory:legacy?.demoInventory||{LUCK:0}
  };
  let queue=Promise.resolve();

  window.VHouseJourneyStore={
    playerId:id,
    load(){
      return auth.getUser()?.id===id?structuredClone(snapshot):null;
    },
    save(next){
      if(auth.getUser()?.id!==id)return Promise.reject(Error("Player changed."));
      const missionsToWrite=Object.values(next.missions||{})
        .filter(m=>m&&m.id&&m.card?.id&&m.stageId);
      const changed=missionsToWrite.map(mission=>{
        const safe=structuredClone(mission);
        const serialized=JSON.stringify(safe);
        return {mission:safe,serialized};
      }).filter(entry=>saved.get(String(entry.mission.id))!==entry.serialized);
      if(!changed.length)return queue;
      queue=queue.catch(()=>{}).then(async()=>{
        if(auth.getUser()?.id!==id)throw Error("Player changed.");
        for(const {mission,serialized} of changed){
          const status=mission.status==="running"?"ON_JOURNEY":
            mission.status==="ready"?"RESULTS_READY":"CONFIRMED";
          const iso=ms=>Number.isFinite(Number(ms))
            ?new Date(Number(ms)).toISOString():null;
          const started=iso(mission.startedAt);
          const ends=iso(mission.endsAt);
          if(!started||!ends)throw Error("Journey is missing its timer.");
          const {error:writeError}=await client.from("vhouse_journey_records")
            .upsert({
              player_id:id,
              mission_id:String(mission.id),
              card_id:String(mission.card.id),
              stage_id:Number(mission.stageId),
              status,
              started_at:started,
              ends_at:ends,
              completed_at:iso(mission.completedAt),
              confirmed_at:iso(mission.confirmedAt),
              duration_seconds:Math.max(0,Math.round((Number(mission.endsAt)-Number(mission.startedAt))/1000)),
              luck_quantity:Math.max(0,Math.floor(Number(mission.luck?.quantity)||0)),
              encounter_results:mission.results||[],
              rewards:mission.rewards||{},
              snapshot:mission,
              updated_at:new Date().toISOString()
            },{onConflict:"player_id,mission_id"});
          if(writeError)throw writeError;
          saved.set(String(mission.id),serialized);
        }
      });
      queue.catch(err=>console.error("VCard Journey record not saved:",err));
      return queue;
    }
  };
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
  padding:8px;
  min-height:0;
  gap:5px;
  overflow:hidden;
}
#setupScreen .setup-fields{
  gap:5px;
  min-height:0;
  overflow-y:auto;
  scrollbar-width:thin;
  padding-right:2px;
}
.setup-panel h2{font-size:17px;margin:0 0 3px}
.setup-panel h3{font-size:11px;margin:0 0 3px}
.setup-panel .player-line{font-size:11px;line-height:1.3}
.stage-picker{padding:6px}
.stage-summary{gap:4px}
.metric{padding:4px 3px}
.metric b{font-size:18px}
.metric small{font-size:9px}
#setupScreen .reward-list{
  display:grid;
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:4px;
}
#setupScreen .reward-chip{
  min-width:0;
  padding:6px 5px;
  font-size:10px;
  line-height:1.15;
}
#setupScreen .reward-category{font-size:9px}
#setupScreen .setup-fields > .muted{
  font-size:10px;
  line-height:1.2;
  margin:0;
}
.start-button{
  flex:0 0 auto;
  width:100%;
  padding:8px;
  margin:0;
}
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
.loot-receipt{padding:6px 5px;min-height:0;overflow:hidden}
#completeScreen .loot-values{
  min-height:0;
  overflow-y:auto;
  scrollbar-width:thin;
  gap:4px;
  margin-top:4px;
}
#completeScreen .loot-value{padding:3px 2px}
#completeScreen .loot-value strong{font-size:15px;margin-top:2px}
#completeScreen .claim-footer{flex:0 0 auto;margin-top:auto}
#completeScreen .receipt-id{
  font-size:7px;
  line-height:1.1;
  margin-top:3px;
  max-height:19px;
  overflow:hidden;
}
.loot-receipt h3{font-size:14px;margin:4px 0;padding-bottom:5px}
.loot-stage{font-size:14px;margin:5px 0}
.loot-count{padding:5px 0;font-size:10px}
.loot-count b{font-size:18px}
.loot-values{gap:5px;margin-top:6px}
.loot-value{padding:5px 3px}
.loot-value strong{font-size:18px}
.confirm{min-height:30px;font-size:13px;padding:5px}
.confirmed{padding:5px 2px;font-size:11px}
#completeScreen .result-panel{padding:9px}
.result-panel h3{font-size:12px;margin:0 0 6px}
.result-table-wrap{overflow-x:hidden;overflow-y:auto;min-height:0;flex:1;scrollbar-width:thin}
table{table-layout:fixed;font-size:10px}
th,td{padding:3px 2px;font-size:9px;line-height:1.1}
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
        const instance=window.VHouseJourneyGame?.init(shadow)||null;
        if(options.cardId)instance?.selectCard?.(options.cardId);
        return instance;
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
      return window.VHouseJourneyGame.init(root,options);
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
