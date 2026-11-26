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
const gameStats=card=>{
  const base=window.VHouseScrapStats?.apply?.(card)||copy(card);
  return window.VHouseAmalieStats?.apply?.(base)||base;
};
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
    await refresh();
    const card=cards.find(c=>key(c.id)===id)||
      (activeSnapshot?.id===id?activeSnapshot:null);
    if(!card)throw Error("This VCard is not in your Closet.");
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
async function syncLoadedLevel(card,level){
  if(card.external)return copy(card);
  const expected=Number(level);
  if(!Number.isSafeInteger(expected)||expected<1)throw Error("NFT level unavailable.");
  if(Number(card.level)===expected)return copy(card);
  const {data,error}=await auth().getClient().functions.invoke("vcard-market-data",{
    body:{action:"sync_level",cardId:card.id}
  });
  if(error||data?.status!=="ok")throw Error(data?.error||error?.message||"VCard level was not saved.");
  await refresh();
  const updated=cards.find(c=>c.id===card.id);
  if(Number(updated?.level)!==Number(data.level))throw Error("VCard level was not refreshed.");
  return copy(updated);
}
async function assignLoaded(details){
  if(!details||!details.mint_address||!details.ownerWallet)
    throw Error("Verified NFT owner and mint address required.");
  await loadPromise.catch(()=>{});
  const existing=cards.find(c=>c.mint_address===details.mint_address);
  if(existing){
    await syncLoadedLevel(existing,details.level);
    return setActive(existing.id);
  }
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
  setActive,assignLoaded,syncLoadedLevel,setJourneyStatus,
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

/* Read-only NFT display data. Same confirmed mint and IPFS sources as Upgrade.
   Never change VHouse card records, stats, game snapshots or transactions. */
(function(){
"use strict";
function portrait(p,index) {
  const helmets = [
    '<path d="M210 245 Q175 85 320 91 Q465 85 430 245 L405 190 Q320 120 235 190Z" fill="#101e2a" stroke="ARMOR" stroke-width="10"/>',
    '<path d="M205 250 L205 130 L265 73 L375 73 L435 130 L435 250 L400 205 L390 135 L250 135 L240 205 L430 245 L405 190 Q320 120 235 190Z" fill="#101e2a" stroke="ARMOR" stroke-width="10"/>',
    '<path d="M205 245 L185 170 L240 175 L230 108 L285 145 L330 88 L350 142 L425 115 L405 196 L445 235Z" fill="#211c29" stroke="LIGHT" stroke-width="7"/>'
  ];

  let svg = `
  <svg xmlns="http://www.w3.org/2000/svg"
       width="640" height="480" viewBox="0 0 640 480">
    <defs>
      <radialGradient id="sky">
        <stop stop-color="LIGHT" stop-opacity=".5"/>
        <stop offset="1" stop-color="BG"/>
      </radialGradient>
    </defs>

    <rect width="640" height="480" fill="url(#sky)"/>
    <circle cx="320" cy="205" r="158"
            fill="none" stroke="LIGHT"
            stroke-width="5" opacity=".5"/>

    <path d="M0 345 L110 250 L180 305
             L260 230 L350 315 L440 255
             L530 315 L640 260 V480 H0Z"
          fill="#0b1524"/>

    <path d="M115 480 L145 380 Q165 320
             260 305 H380 Q475 320 495 380
             L525 480Z"
          fill="ARMOR" stroke="#0a111b"
          stroke-width="12"/>

    <path d="M285 280 H355 L360 353
             L320 389 L280 353Z"
          fill="FACE"/>

    <ellipse cx="320" cy="225"
             rx="89" ry="120"
             fill="FACE"
             stroke="#16202b"
             stroke-width="9"/>

    ${helmets[index]}

    <path d="M258 232 H300 M340 232 H382"
          stroke="#17202a"
          stroke-width="15"
          stroke-linecap="round"/>

    <path d="M265 232 H295 M345 232 H375"
          stroke="LIGHT" stroke-width="5"/>

    <path d="M290 295 Q320 313 350 295"
          fill="none" stroke="#50343b"
          stroke-width="6"/>

    <path d="M320 400 L340 430
             L320 462 L300 430Z"
          fill="LIGHT"/>
  </svg>`;

  svg = svg.replace(
    /\b(BG|LIGHT|ARMOR|FACE)\b/g,
    key => ({
      BG:p.bg,
      LIGHT:p.light,
      ARMOR:p.armor,
      FACE:p.face
    })[key]
  );

  return "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(svg);
}

const arts = [
  portrait({
    bg:"#152b40",
    light:"#2c9bd7",
    armor:"#347b99",
    face:"#d6a47c"
  },0),

  portrait({
    bg:"#30263c",
    light:"#aa67dd",
    armor:"#8276ac",
    face:"#b98979"
  },1),

  portrait({
    bg:"#42282d",
    light:"#ff815f",
    armor:"#bb6056",
    face:"#bc8667"
  },2)
];


const RPC_URLS=["https://solana-rpc.publicnode.com","https://rpc.solanatracker.io/public","https://api.mainnet-beta.solana.com"];
const TOKEN_2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const cache=new Map(),bindings=new WeakMap(),queue=[];
let running=0;
function pump(){while(running<4&&queue.length){running++;void queue.shift()();}}
function schedule(work){
  return new Promise((resolve,reject)=>{
    queue.push(()=>Promise.resolve().then(work).then(resolve,reject).finally(()=>{running--;pump()}));pump();
  });
}
function mintFor(card){
  if(!card)return null;
  const mint=card.mint_address||window.VHouseCardStore?.getCards()?.find(c=>String(c.id)===String(card.id))?.mint_address;
  return typeof mint==="string"&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)?mint:null;
}
function mediaURLs(uri){
  if(typeof uri!=="string"||!uri)return [];
  const ipfs=uri.match(/^ipfs:\/\/(.+)$/i)||uri.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/i);
  if(ipfs){
    const suffix=ipfs[1].replace(/^ipfs\//i,"");
    return ["https://gateway.pinata.cloud/ipfs/"+suffix,"https://ipfs.io/ipfs/"+suffix,"https://dweb.link/ipfs/"+suffix];
  }
  if(/^ar:\/\//i.test(uri))return ["https://arweave.net/"+uri.slice(5)];
  return /^https:\/\//i.test(uri)?[uri]:[];
}
async function mintMetadata(mint){
  let last;
  for(const url of RPC_URLS){
    try{
      const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getAccountInfo",params:[mint,{encoding:"jsonParsed",commitment:"confirmed"}]}),signal:AbortSignal.timeout(5500)});
      if(!res.ok)throw Error("RPC HTTP "+res.status);
      const body=await res.json(),account=body.result?.value;
      const meta=account?.data?.parsed?.info?.extensions?.find(e=>String(e.extension).toLowerCase()==="tokenmetadata")?.state;
      if(account?.owner!==TOKEN_2022||!meta?.uri)throw Error("Token-2022 metadata unavailable");
      return meta;
    }catch(error){last=error;}
  }
  throw last||Error("NFT mint unavailable");
}
async function readJSON(uri){
  let last;
  for(const url of mediaURLs(uri)){
    try{
      const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error("NFT JSON HTTP "+response.status);
      const json=await response.json();
      if(!json||typeof json!=="object")throw Error("Invalid NFT JSON");
      return json;
    }catch(error){last=error;}
  }
  throw last||Error("NFT metadata unavailable");
}
function extract(meta,json){
  const v=json.properties?.vhouse||{};
  const fields=new Map(Array.isArray(meta.additionalMetadata)?meta.additionalMetadata:[]);
  const attrs=Array.isArray(json.attributes)?json.attributes:[];
  const trait=key=>fields.get(key)??attrs.find(a=>String(a?.trait_type).toLowerCase()===key.toLowerCase())?.value??v[key.toLowerCase()];
  const visual={};
  const name=String(meta.name||json.name||"").replace(/^Vcard\s+/i,"");
  if(name)visual.name=name;
  if(typeof json.description==="string")visual.description=json.description;
  const team=({STONE:"R",WIND:"P",BLADE:"S",R:"R",P:"P",S:"S"})[String(trait("Team")||"").toUpperCase()];
  if(team)visual.team=team;
  const rawLevel=trait("Level"),level=Number(rawLevel);
  if(rawLevel!=null&&Number.isFinite(level)&&level>=1)visual.level=level;
  visual.effect=String(trait("Effect")||"none").toLowerCase();
  if(v.imageMode==="preset"&&Number.isInteger(v.artIndex)&&arts[v.artIndex])visual.image=arts[v.artIndex];
  else if(v.sourceImage)visual.image=mediaURLs(v.sourceImage)[0];
  else if(!json.properties?.vhouse)visual.image=mediaURLs(json.image)[0];
  if(!visual.image)delete visual.image;
  return visual;
}
function request(mint){
  const prior=cache.get(mint);
  if(prior?.pending||prior&&Date.now()<prior.expires)return prior;
  const entry={visual:prior?.visual||null,pending:true,expires:Infinity};
  cache.set(mint,entry);
  entry.promise=schedule(async()=>{
    const meta=await mintMetadata(mint);
    return extract(meta,await readJSON(meta.uri));
  }).then(visual=>{entry.visual=visual;entry.expires=Date.now()+60000;return visual;},error=>{
    console.warn("[VHouse NFT visuals]",mint,error);
    entry.expires=Date.now()+15000;return entry.visual;
  }).finally(()=>{entry.pending=false});
  return entry;
}
function bind(host,card,paint){
  if(!host)return;
  const mint=mintFor(card),previous=bindings.get(host);
  if(!mint){bindings.delete(host);paint(card);return;}
  const entry=request(mint),binding=previous?.entry===entry?previous:{entry};
  binding.card=card;binding.paint=paint;
  bindings.set(host,binding);
  paint({...card,...entry.visual});
  if(binding.waiting||!entry.pending)return;
  binding.waiting=true;
  void entry.promise.then(visual=>{
    binding.waiting=false;
    if(bindings.get(host)!==binding||!host.isConnected||!visual)return;
    binding.paint({...binding.card,...visual});
  });
}
window.addEventListener("vhouse:vcard-updated",event=>{
  const mint=event.detail?.mintAddress;
  if(mint)cache.delete(mint);
});
window.addEventListener("pageshow",event=>{if(event.persisted)cache.clear();});
window.VHouseNFTVisuals={bind};
})();
