/* Shared Journey framework: standalone page and embedded VHouse container.
   The HTML/CSS remain in JourneyMissions.html. No iframe or localStorage. */
(function(){
"use strict";
function init(root=document){
  if(root.__vhouseJourneyInstance)return root.__vhouseJourneyInstance;
"use strict";

const $=id=>root.getElementById(id);

/*
  STANDALONE JOURNEY DESIGN FRAMEWORK

  Optional VHouse integration:
    VHouseJourneyData
    VHouseCardStore
    VHouseJourneyInventory
    VHouseJourneyStore
    VHouseJourneyRewardForEncounter

  No localStorage.
*/

/* Defined encounter letters; only the coin flips determine random outcomes. */
const DEFAULT_STAGE_DATA=[
  {
    description:"Scout the nearby paths and gather your first supplies.",
    encounters:[["HUNT","R"],["HUNT","P"]]
  },
  {
    description:"Search farther out, then defend the supplies you collect.",
    encounters:[["HUNT","R"],["HUNT","P"],["FIGHT","S"]]
  },
  {
    description:"Explore new ground and face the first extended patrol.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["FIGHT","R"]]
  },
  {
    description:"Collect supplies while pushing through two hostile encounters.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["FIGHT","R"],["FIGHT","P"]]
  },
  {
    description:"Cross the contested route and survive three fights.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["FIGHT","R"],["FIGHT","P"],["FIGHT","S"]]
  },
  {
    description:"Take the longer route to recover supplies through guarded territory.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["HUNT","R"],["FIGHT","P"],["FIGHT","S"],["FIGHT","R"]]
  },
  {
    description:"Press deeper into the region and hold your ground.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["HUNT","R"],["FIGHT","P"],["FIGHT","S"],["FIGHT","R"],["FIGHT","P"]]
  },
  {
    description:"Prepare for the final approach through repeated hunts and fights.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["HUNT","R"],["HUNT","P"],["FIGHT","S"],["FIGHT","R"],["FIGHT","P"],["FIGHT","S"]]
  },
  {
    description:"Complete the final approach and clear the route ahead.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["HUNT","R"],["HUNT","P"],["FIGHT","S"],["FIGHT","R"],["FIGHT","P"],["FIGHT","S"],["FIGHT","R"]]
  },
  {
    description:"Complete ten encounters, then face the TOTEM BOSS in encounter eleven.",
    encounters:[["HUNT","R"],["HUNT","P"],["HUNT","S"],["HUNT","R"],["HUNT","P"],["FIGHT","S"],["FIGHT","R"],["FIGHT","P"],["FIGHT","S"],["FIGHT","R"],["TOTEM BOSS","S"]]
  }
];

const DEFAULT_CONFIG={
  stageCount:10,
  sceneImage:"assets/VCrad Town.png",
  demoInventory:{LUCK:1},
  stages:DEFAULT_STAGE_DATA.map((definition,index)=>{
    const encounters=definition.encounters.map(([type,letter])=>({
      type,
      letter,
      reward:type==="HUNT"
        ?{item:"IG",quantity:1}
        :type==="FIGHT"
          ?{item:"SCRAPS",quantity:1}
          :null
    }));
    return {
      id:index+1,
      description:definition.description,
      durationSeconds:(index+1)*30,
      hunts:encounters.filter(entry=>entry.type==="HUNT").length,
      fights:encounters.filter(entry=>entry.type==="FIGHT").length,
      bosses:encounters.filter(entry=>entry.type==="TOTEM BOSS").length,
      rewardTypes:[...new Set(encounters.map(entry=>entry.reward?.item).filter(Boolean))],
      encounters
    };
  })
};
const config=window.VHouseJourneyData||DEFAULT_CONFIG;

const stages=[...(config.stages||[])]
  .filter(stage=>stage.enabled!==false)
  .sort((a,b)=>a.id-b.id);

const stageById=id=>
  stages.find(stage=>stage.id===Number(id));

const LETTERS=["R","P","S"];

/* DEMO VCARD */

const DEMO_CARD={
  id:"demo-vcard",
  name:"DEMO VCARD",
  team:"R",
  level:1,
  atk:100,
  def:100,
  speed:1,
  image:"",
  description:"Journey Adventurer"
};

function activeCard(){
  const stored=window.VHouseCardStore?.getActive?.();
  if(!stored)return DEMO_CARD;
  const team=String(stored.team||"").toUpperCase();
  return {
    ...stored,
    team:({STONE:"R",WIND:"P",BLADE:"S"}[team]||team)
  };
}

/* QUANTITY CALCULATION */

function wholeQuantity(value){
  const number=Number(value);

  return Number.isFinite(number)
    ?Math.max(0,Math.floor(number))
    :0;
}

/* STATE */

function initialState(){
  return {
    mission:null,
    balance:{},
    receipts:[],
    events:[],
    demoInventory:{
      ...(config.demoInventory||{LUCK:0})
    }
  };
}

const restored=window.VHouseJourneyStore?.load?.();

const state=restored&&typeof restored==="object"
  ?{...initialState(),...restored}
  :initialState();

state.balance||={};
state.receipts||=[];
state.events||=[];
state.demoInventory||={
  ...(config.demoInventory||{LUCK:0})
};

let selectedStage=stages[0]?.id??null;
let currentScreen="setup";

function save(){
  // Persist Journey progress through the signed-in player's VHouse store.
  // Standalone framework mode has no persistent remote store.
  return window.VHouseJourneyStore?.save?.(structuredClone(state));
}

function emit(name,detail){
  window.dispatchEvent(
    new CustomEvent("vhouse:"+name,{detail})
  );
}

/*
  INVENTORY -> LUCK STAT

  LUCK is one item type.

  Quantity held produces the LUCK stat.
  Each point supplies one additional coin flip
  after a lost first round or failed retry.
*/

function luckStat(){
  const inventory=window.VHouseJourneyInventory;

  let quantity;

  if(typeof inventory?.getQuantity==="function"){

    quantity=inventory.getQuantity("LUCK");

  }else if(Array.isArray(inventory?.items)){

    quantity=inventory.items
      .filter(item=>
        String(item.item||item.name)
          .toUpperCase()==="LUCK"
      )
      .reduce(
        (sum,item)=>
          sum+wholeQuantity(item.quantity),
        0
      );

  }else if(
    inventory?.items&&
    typeof inventory.items==="object"
  ){

    quantity=
      inventory.items.LUCK?.quantity??
      inventory.items.LUCK;

  }else if(
    inventory&&
    Object.hasOwn(inventory,"LUCK")
  ){

    quantity=inventory.LUCK;

  }else{

    quantity=state.demoInventory.LUCK;

  }

  return wholeQuantity(quantity);
}

/*
  STAGE ENCOUNTER DATA

  Every encounter must have its own defined
  R, P, or S letter.

  No random letter assignment.
*/

function encounterPlan(stage){
  return Array.isArray(stage?.encounters)
    ?stage.encounters
    :[];
}

function validStage(stage){

  if(!stage||
     !(Number(stage.durationSeconds)>0)){
    return false;
  }

  const encounters=encounterPlan(stage);

  if(!encounters.length)return false;

  if(encounters.some(entry=>
    !["HUNT","FIGHT","TOTEM BOSS"].includes(entry.type)||
    !LETTERS.includes(entry.letter)
  )){
    return false;
  }

  const hunts=encounters
    .filter(entry=>entry.type==="HUNT")
    .length;

  const fights=encounters
    .filter(entry=>entry.type==="FIGHT")
    .length;

  const bosses=encounters
    .filter(entry=>entry.type==="TOTEM BOSS")
    .length;

  return (
    hunts===Number(stage.hunts||0)&&
    fights===Number(stage.fights||0)&&
    bosses===Number(stage.bosses||0)
  );
}

/* SCREEN CONTROL */

function setScreen(screen){

  currentScreen=screen;

  for(const name of [
    "setup","travel","complete","away"
  ]){
    $(name+"Screen").hidden=name!==screen;
  }

  $("gameContent").scrollTop=0;
}

/* BACKGROUND */

function background(){

  const url=config.sceneImage;

  if(typeof url!=="string"||
     !/^(assets\/|https?:\/\/)/i.test(url)){
    return;
  }

  const safe=url.replace(/["\\]/g,"");

  for(const id of [
    "setupWorld",
    "travelWorld"
  ]){
    $(id).style.setProperty(
      "--scene-image",
      'url("'+safe+'")'
    );
  }
}

/* VCARD DISPLAY */

function renderCard(host,card){

  if(window.VHouseVCard?.render){
    window.VHouseVCard.render(host,card);
    return;
  }

  host.classList.add("vhouse-vcard-host");

  if(!host.querySelector(".vcard")){

    host.innerHTML=`
      <div class="vcard">
        <div class="vcard-inner">

          <header class="card-header">
            <h2 class="card-name"></h2>
          </header>

          <div class="card-art">
            <img alt="VCard artwork">
          </div>

          <div class="card-info"></div>
          <div class="card-description"></div>

          <div class="card-stats">

            <div class="stat">
              <span class="stat-label">ATK</span>
              <span class="stat-value"
                    data-stat="atk"></span>
            </div>

            <div class="stat">
              <span class="stat-label">DEF</span>
              <span class="stat-value"
                    data-stat="def"></span>
            </div>

          </div>

          <div class="meta-bottom">
            <div class="meta-footer-text"></div>
            <div class="rarity"></div>
          </div>

        </div>
      </div>`;
  }

  const root=host.querySelector(".vcard");

  const colors={
    R:"#2d7bdc",
    P:"#1abf96",
    S:"#b16df4"
  };

  root.style.setProperty(
    "--accent",
    colors[card.team]||colors.R
  );

  root.querySelector(".card-name").textContent=
    card.name||"VCARD";

  root.querySelector(".card-info").textContent=
    "LEVEL "+(card.level??1);

  root.querySelector(".card-description").textContent=
    card.description||"";

  root.querySelector('[data-stat="atk"]').textContent=
    card.atk??100;

  root.querySelector('[data-stat="def"]').textContent=
    card.def??100;

  root.querySelector(".meta-footer-text").textContent=
    "VHOUSE";

  root.querySelector(".rarity").textContent=
    card.team||"R";

  const img=root.querySelector(".card-art img");

  if(
    typeof card.image==="string"&&
    /^(https?:\/\/|data:image\/|blob:)/i.test(card.image)
  ){

    img.src=card.image;

  }else{

    img.removeAttribute("src");

  }
}

/* STAGE SELECTION */

function renderSetup(){

  setScreen("setup");

  const card=activeCard();

  renderCard($("setupVCard"),card);

  $("playerInfo").textContent=
    (card.name||"VCARD")+
    " · LEVEL "+(card.level??1)+
    " · "+(
      {
        R:"STONE",
        P:"WIND",
        S:"BLADE"
      }[card.team]||card.team
    );

  const select=$("stageSelect");

  select.replaceChildren();

  for(
    let id=1;
    id<=(config.stageCount||10);
    id++
  ){

    const stage=stageById(id);

    const option=document.createElement("option");

    option.value=id;

    option.textContent=
      "STAGE "+id+
      (validStage(stage)
        ?""
        :" — NOT CONFIGURED");

    option.disabled=!validStage(stage);

    select.append(option);
  }

  if(!validStage(stageById(selectedStage))){

    selectedStage=
      stages.find(validStage)?.id??null;

  }

  if(selectedStage!==null){
    select.value=selectedStage;
  }

  renderStageInfo();
}

function renderStageInfo(){

  const stage=stageById(selectedStage);

  $("setupHunts").textContent=
    stage?.hunts??"—";

  $("setupFights").textContent=
    stage?.fights??"—";

  $("setupTime").textContent=
    stage?.durationSeconds??"—";

  const host=$("possibleRewards");

  host.replaceChildren();

  for(const reward of stage?.rewardTypes||[]){

    const chip=document.createElement("span");

    chip.className="reward-chip";

    chip.textContent=
      reward==="AWT"?"$AWT":reward;

    host.append(chip);
  }

  $("setupDescription").textContent=
    validStage(stage)?String(stage.description||""):"";

  const store=window.VHouseCardStore;
  const assigned=store?.getActive?.();
  const locked=assigned&&store?.isLocked?.(assigned.id);
  $("setupStatus").textContent=locked
    ?"This VCard is on a Journey. Assign another VCard in the Closet."
    :(!assigned&&store)
      ?"Assign a VCard before starting."
      :"";
  $("startButton").disabled=!validStage(stage)||!!locked||
    (!!store&&!assigned);
}

$("stageSelect").addEventListener("change",()=>{

  selectedStage=Number(
    $("stageSelect").value
  );

  renderStageInfo();
});

/*
  COIN FLIP

  This is the only random win/loss mechanic.
*/

function coinFlip(){
  return Math.random()<0.5;
}

/*
  ENCOUNTER RESOLUTION

  1. Compare VCard and encounter letters.
  2. MATCH: Stage wins first round.
     Initial coin flip is canceled.
  3. NO MATCH: initial coin flip.
  4. If VCard loses, use available LUCK retries.
  5. Stop on VCard win or exhausted retries.
  6. Record the final result.

  The Stage's automatic win does not cancel LUCK.
*/

function resolveEncounter(
  card,
  encounter,
  index,
  luck
){

  const matched=
    card.team===encounter.letter;

  let won=false;
  let firstRound;
  let flips=0;
  let retriesUsed=0;

  if(matched){

    // Stage wins first round automatically.
    // No initial coin flip.
    firstRound="STAGE WIN";

  }else{

    // Letters do not match.
    // First round uses a coin flip.
    flips++;

    won=coinFlip();

    firstRound=won
      ?"COIN WIN"
      :"COIN LOSS";
  }

  /*
    The number of LUCK held produces
    the number of retries available.
  */

  while(
    !won&&
    retriesUsed<wholeQuantity(luck)
  ){

    retriesUsed++;
    flips++;

    won=coinFlip();
  }

  const method=
    firstRound+
    (retriesUsed
      ?" · LUCK "+retriesUsed
      :"")+
    " → "+
    (won?"WIN":"LOSS");

  return {
    number:index+1,
    type:encounter.type,
    letter:encounter.letter,
    matched,
    firstRound,
    flips,
    retriesUsed,
    won,
    method,
    reward:null
  };
}

/*
  REWARD CALCULATION

  Rewards are provided by encounter/Stage data,
  not assigned by alternating reward types.

  The optional VHouse reward function can replace
  the framework's configured reward amounts.
*/

function rewardForEncounter(
  stage,
  encounter,
  result,
  index
){

  const hook=
    window.VHouseJourneyRewardForEncounter;

  const raw=
    typeof hook==="function"
      ?hook(stage,encounter,result,index)
      :(
        encounter.reward??
        stage.rewardsByType?.[encounter.type]??
        null
      );

  if(!raw)return null;

  if(typeof raw==="string"){

    return {
      item:raw,
      quantity:1
    };
  }

  const item=
    raw.item||
    raw.asset||
    raw.type;

  const quantity=wholeQuantity(
    raw.quantity??
    raw.amount??
    1
  );

  if(
    typeof item!=="string"||
    !item||
    quantity<=0
  ){
    return null;
  }

  return {
    item,
    quantity
  };
}

/* START JOURNEY */

async function startJourney(){

  const stage=stageById(selectedStage);
  const store=window.VHouseCardStore;
  const assigned=store?.getActive?.();
  if(store&&!assigned){
    $("setupStatus").textContent="Assign a VCard before starting a Journey.";
    return;
  }
  if(assigned&&store?.isLocked?.(assigned.id)){
    $("setupStatus").textContent="VCard locked on Journey. Choose another VCard in the Closet.";
    return;
  }

  if(!validStage(stage))return;

  if(
    state.mission&&
    state.mission.status!=="confirmed"
  ){
    return;
  }

  const now=Date.now();

  const card={
    ...activeCard()
  };

  /*
    Generate the VCard's LUCK stat
    from the inventory item.
  */

  const luck=luckStat();

  card.luck=luck;

  state.mission={
    id:"JR-"+now.toString(36).toUpperCase(),
    stageId:stage.id,
    stage:structuredClone(stage),
    card,

    luck:{
      item:"LUCK",
      quantity:luck
    },

    startedAt:now,
    endsAt:now+stage.durationSeconds*1000,

    status:"running",
    results:[],
    rewards:null,
    totals:null
  };

  try{
    await save();
  }catch(error){
    state.mission=null;
    $("setupStatus").textContent="Journey could not start: "+(error.message||"save failed");
    return;
  }

  emit("journey-started",{
    missionId:state.mission.id,
    cardId:card.id,
    stageId:stage.id,
    luck
  });

  renderTravel();
}

/* JOURNEY RUNNING */

function renderTravel(){

  const mission=state.mission;

  if(!mission)return;

  setScreen("travel");

  renderCard(
    $("travelVCard"),
    mission.card
  );

  $("travelTitle").textContent=
    "STAGE "+mission.stageId+
    " · IN PROGRESS";

  $("travelDescription").textContent=
    (mission.stage.hunts||0)+" HUNTS · "+
    (mission.stage.fights||0)+" FIGHTS"+
    (mission.stage.bosses?" · "+mission.stage.bosses+" TOTEM BOSS":"");

  const travelCard=$("travelVCard").parentElement;
  const missionSeconds=(mission.endsAt-mission.startedAt)/1000;
  const elapsedRatio=Math.min(1,Math.max(0,(Date.now()-mission.startedAt)/(mission.endsAt-mission.startedAt)));
  travelCard.style.animationDuration=missionSeconds+"s";
  travelCard.style.animationIterationCount="1";
  travelCard.style.animationDirection="normal";
  travelCard.style.animationFillMode="forwards";
  travelCard.style.animationDelay="-"+elapsedRatio*missionSeconds+"s";

  $("loadingEncounters").replaceChildren();

  for(
    const [index,encounter] of
    encounterPlan(mission.stage).entries()
  ){

    const item=document.createElement("div");

    item.className="loading-item";

    const title=document.createElement("span");

    title.textContent=encounter.type;

    const pending=document.createElement("strong");

    pending.textContent="•••";
    item.dataset.encounterIndex=String(index);
    item.append(title,pending);

    $("loadingEncounters").append(item);
  }

  updateTimer();
  renderEncounterProgress();
}

function renderEncounterProgress(){
  const results=state.mission?.results||[];
  for(const item of $("loadingEncounters").children){
    const result=results[Number(item.dataset.encounterIndex)];
    const value=item.querySelector("strong");
    if(!result){
      value.textContent="•••";
      item.classList.remove("encounter-win","encounter-loss");
      continue;
    }
    value.textContent=result.won?"WIN":"LOSS";
    item.classList.toggle("encounter-win",!!result.won);
    item.classList.toggle("encounter-loss",!result.won);
  }
}

/* Persist one encounter at a time, never reroll a completed encounter. */
function advanceEncounters(){
  const mission=state.mission;
  if(!mission||mission.status!=="running")return;
  const plan=encounterPlan(mission.stage);
  const total=mission.endsAt-mission.startedAt;
  const elapsed=Math.max(0,Math.min(total,Date.now()-mission.startedAt));
  const due=Math.min(plan.length,Math.floor(elapsed/total*plan.length));
  mission.results||=[];
  let changed=false;
  while(mission.results.length<due){
    const index=mission.results.length;
    const encounter=plan[index];
    const result=resolveEncounter(mission.card,encounter,index,mission.luck.quantity);
    if(result.won)result.reward=rewardForEncounter(mission.stage,encounter,result,index);
    mission.results.push(result);
    changed=true;
  }
  if(changed){
    save();
    if(currentScreen==="travel")renderEncounterProgress();
  }
}

function updateTimer(){

  const mission=state.mission;

  if(
    !mission||
    mission.status!=="running"
  ){
    return;
  }

  const remaining=Math.max(
    0,
    mission.endsAt-Date.now()
  );

  const seconds=Math.ceil(
    remaining/1000
  );

  $("timer").textContent=
    String(
      Math.floor(seconds/60)
    ).padStart(2,"0")+
    ":"+
    String(seconds%60).padStart(2,"0");

  const total=
    mission.endsAt-mission.startedAt;

  const elapsed=
    Date.now()-mission.startedAt;

  $("progress").style.width=
    Math.min(
      100,
      Math.max(
        0,
        elapsed/total*100
      )
    )+"%";
}

/*
  JOURNEY RESULTS

  Encounters resolve throughout the countdown. Finalization uses only
  already-recorded outcomes and catches up any due encounters.
*/
function settleJourney(){

  const mission=state.mission;

  if(
    !mission||
    mission.status!=="running"||
    Date.now()<mission.endsAt
  ){
    return false;
  }

  advanceEncounters();
  const stage=mission.stage;
  const plan=encounterPlan(stage);
  const results=mission.results||[];

  /*
    Apply configured rewards.
  */

  const rewards={};

  results.forEach(result=>{
    if(!result.won||!result.reward)return;
    rewards[result.reward.item]=
      (rewards[result.reward.item]||0)+result.reward.quantity;
  });

  /*
    Record Stage totals.
  */

  const wins=results.filter(
    result=>result.won
  ).length;

  const losses=results.length-wins;

  const luckUsed=results.reduce(
    (sum,result)=>
      sum+result.retriesUsed,
    0
  );

  mission.results=results;

  mission.rewards=rewards;

  mission.totals={
    encounters:results.length,
    wins,
    losses,
    luckAvailable:mission.luck.quantity,
    luckUsed
  };

  mission.completedAt=Date.now();

  mission.status="ready";

  /*
    Internal framework balance.

    This records the rewards once.
    CONFIRM does not reward again.
  */

  for(
    const [asset,quantity] of
    Object.entries(rewards)
  ){

    state.balance[asset]=
      (state.balance[asset]||0)+
      quantity;
  }

  const event={
    type:"journey.completed",
    missionId:mission.id,
    cardId:mission.card.id,
    stageId:mission.stageId,
    results,
    totals:mission.totals,
    rewards,
    at:mission.completedAt
  };

  state.events.push(event);

  save();

  emit("journey-completed",event);

  return true;
}

function rewardTotal(mission){

  return Object.values(
    mission.rewards||{}
  ).reduce(
    (sum,amount)=>sum+amount,
    0
  );
}

/* COMPLETED JOURNEY */

function renderComplete(){

  const mission=state.mission;

  if(
    !mission||
    !["ready","confirmed"].includes(
      mission.status
    )
  ){
    return;
  }

  setScreen("complete");

  const confirmed=
    mission.status==="confirmed";

  renderCard(
    $("completeVCard"),
    mission.card
  );

  $("receiptStage").textContent=
    "STAGE "+mission.stageId;

  $("receiptEncounters").textContent=
    (mission.stage.hunts||0)+" HUNTS · "+
    (mission.stage.fights||0)+" FIGHTS";

  $("receiptWins").textContent=
    mission.totals.wins;

  $("receiptId").textContent=
    mission.id;

  /* REWARDS ON CARD BACK */

  const rewardHost=$("receiptRewards");

  rewardHost.replaceChildren();

  for(
    const asset of
    mission.stage.rewardTypes||[]
  ){

    const tile=document.createElement("div");

    tile.className="loot-value";

    const label=document.createElement("span");

    label.textContent=
      asset==="AWT"?"$AWT":asset;

    const amount=document.createElement("strong");

    amount.textContent=
      "+"+(mission.rewards[asset]||0);

    tile.append(label,amount);

    rewardHost.append(tile);
  }

  /*
    RESULTS CHART

    Existing layout is preserved.

    Each row shows:
    - Encounter
    - VCard/Stage letter comparison
    - First-round result
    - LUCK retries
    - Final result
    - Acquired reward
  */

  const rows=$("resultRows");

  rows.replaceChildren();

  for(const result of mission.results){

    const row=document.createElement("tr");

    const number=document.createElement("td");

    number.textContent=result.number;

    const type=document.createElement("td");

    type.textContent=result.type;

    const letters=document.createElement("td");

    letters.textContent=
      mission.card.team+
      " / "+
      result.letter;

    const outcome=document.createElement("td");

    outcome.textContent=result.method;

    outcome.className=
      result.won?"win":"loss";

    const acquired=document.createElement("td");

    acquired.textContent=
      result.reward
        ?"+"+result.reward.quantity+
         " "+result.reward.item
        :"—";

    if(result.reward){
      acquired.className="earned";
    }

    row.append(
      number,
      type,
      letters,
      outcome,
      acquired
    );

    rows.append(row);
  }

  $("resultSummary").textContent=
    mission.totals.wins+
    " OF "+
    mission.totals.encounters+
    " ENCOUNTERS WON · "+
    rewardTotal(mission)+
    " REWARDS";

  $("resultState").textContent=
    confirmed
      ?"RECEIPT CONFIRMED · VCARD AVAILABLE"
      :"REWARDS ACQUIRED · CONFIRMATION REQUIRED";

  $("confirmButton").hidden=confirmed;

  $("confirmedStamp").hidden=!confirmed;

  $("newJourneyButton").hidden=!confirmed;

  /* ORIGINAL AUTOMATIC VCARD FLIP */

  $("cardFlip").classList.remove("flipped");

  requestAnimationFrame(()=>{

    requestAnimationFrame(()=>{

      $("cardFlip").classList.add("flipped");

    });

  });
}

/* RECEIPT CONFIRMATION */

function confirmReceipt(){

  const mission=state.mission;

  if(
    !mission||
    mission.status!=="ready"
  ){
    return;
  }

  mission.status="confirmed";

  mission.confirmedAt=Date.now();

  state.receipts.push(
    structuredClone(mission)
  );

  const event={
    type:"journey.receipt.confirmed",
    missionId:mission.id,
    cardId:mission.card.id,
    stageId:mission.stageId,
    rewards:mission.rewards,
    at:mission.confirmedAt
  };

  state.events.push(event);

  save();

  emit("journey-confirmed",event);

  /*
    Confirmation only acknowledges
    the results and unlocks the VCard.
  */

  $("confirmButton").hidden=true;

  $("confirmedStamp").hidden=false;

  $("newJourneyButton").hidden=false;

  $("resultState").textContent=
    "RECEIPT CONFIRMED · VCARD AVAILABLE";

}

/* NEW JOURNEY */

function newJourney(){

  if(
    state.mission?.status!=="confirmed"
  ){
    return;
  }

  state.mission=null;

  save();

  renderSetup();
}

/* LEAVE / RETURN */

function leaveJourney(){

  if(
    state.mission?.status!=="running"
  ){
    return;
  }

  setScreen("away");

  $("message").textContent=
    "Your Journey continues while you're away.";
}

function returnJourney(){

  const mission=state.mission;

  if(!mission){

    renderSetup();

    return;
  }

  settleJourney();

  if(mission.status==="running"){

    renderTravel();

  }else{

    renderComplete();

  }
}

/* BUTTON EVENTS */

$("startButton").onclick=startJourney;

$("leaveButton").onclick=leaveJourney;

$("returnButton").onclick=returnJourney;

$("confirmButton").onclick=confirmReceipt;

$("newJourneyButton").onclick=newJourney;

/* PERSISTENT IN-PAGE TIMER */

setInterval(()=>{

  const mission=state.mission;

  if(
    !mission||
    mission.status!=="running"
  ){
    return;
  }

  advanceEncounters();

  if(Date.now()>=mission.endsAt){

    settleJourney();

    if(currentScreen==="travel"){

      renderComplete();

    }else if(currentScreen==="away"){

      $("message").textContent=
        "Journey complete. Return to view the receipt.";

    }

    return;
  }

  if(currentScreen==="travel"){

    updateTimer();

  }

},200);

/* INITIALIZATION */

background();

if(state.mission){

  settleJourney();

  if(state.mission.status==="running"){

    renderTravel();

  }else{

    renderComplete();

  }

}else{

  renderSetup();

}

/*
  FRAMEWORK ACCESS

  Allows the existing VHouse game to retrieve
  results, totals, and LUCK calculations.

  setDemoLuck is for framework testing only.
*/

const controller={

  getState:()=>
    structuredClone(state),

  getMission:()=>
    state.mission
      ?structuredClone(state.mission)
      :null,

  getLuckStat:luckStat,

  setDemoLuck:quantity=>{

    if(window.VHouseJourneyInventory){
      return false;
    }

    state.demoInventory.LUCK=
      wholeQuantity(quantity);

    save();

    return true;
  }

};
root.__vhouseJourneyInstance=controller;
window.VHouseReceiptGame=controller;
return controller;
}
window.VHouseJourneyGame={init};
if(document.getElementById("game"))init(document);
})();
