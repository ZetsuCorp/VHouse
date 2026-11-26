/* Shared VHouse market token catalog and live market data. */
(() => {
"use strict";
const assets=[
 {name:"Solana",symbol:"SOL",mint:"So11111111111111111111111111111111111111112",category:"Network",accent:"#64d5b5",glow:"#206b64",mark:"≋",native:true},
 {name:"AWT",symbol:"AWT",mint:"ETvGFek4eDeHP7iC7yceGpduTRypHpsUT6tybwMXpump",category:"Ecosystem",accent:"#bc92ea",glow:"#65429d",mark:"A"},
 {name:"Scraps",symbol:"SCRAPS",mint:"BGf97TZtX7SezpJs21B3DchsonwHvw8DiekDALXLpump",category:"Rewards",accent:"#d9b36a",glow:"#815330",mark:"⚙"},
 {name:"Amalie",symbol:"AMALIE",mint:"rdWAk8U5Zx3L5TjLtL7sb3XhEPmXhqcMLxVBDi3pump",category:"Bonus points",accent:"#e89bbf",glow:"#933f76",mark:"✦"}
];
const num=v=>v===null||v===undefined||v===""||!Number.isFinite(Number(v))?null:Number(v);
const money=v=>v===null||v===undefined?"—":"$"+(v>0&&v<.000001?v.toExponential(3):v.toFixed(v>=1?2:6));
const percent=v=>v===null||v===undefined?"—":(v>=0?"+":"")+v.toFixed(2)+"%";
function selectPair(pairs,asset){
 return pairs.filter(p=>p?.chainId==="solana"&&p.baseToken?.address===asset.mint&&num(p.priceUsd)>0&&p.pairAddress)
 .sort((a,b)=>(num(b.liquidity?.usd)??0)-(num(a.liquidity?.usd)??0))[0]||null;
}

const SESSION_CACHE="vhouse-index-market-preload-v1";
function create({sessionCache=false}={}){
 const markets=new Map(),pumpCoins=new Map();
 let pumpUnavailable=false;
 if(sessionCache){
  try{
   const cached=JSON.parse(sessionStorage.getItem(SESSION_CACHE)||"null");
   if(cached&&Array.isArray(cached.markets)&&Array.isArray(cached.pumpCoins)){
    for(const a of assets){
     const pair=cached.markets.find(entry=>Array.isArray(entry)&&entry[0]===a.mint);
     const coin=cached.pumpCoins.find(entry=>Array.isArray(entry)&&entry[0]===a.mint);
     if(pair)markets.set(a.mint,pair[1]);
     if(coin)pumpCoins.set(a.mint,coin[1]);
    }
    pumpUnavailable=Boolean(cached.pumpUnavailable);
   }
  }catch{}
 }
 function saveSessionMarket(){
  if(!sessionCache)return;
  try{sessionStorage.setItem(SESSION_CACHE,JSON.stringify({
   markets:[...markets],pumpCoins:[...pumpCoins],pumpUnavailable
  }));}catch{}
 }
 function pairFor(a){return markets.get(a.mint)||null}
 function displayPrice(a){return num(pumpCoins.get(a.mint)?.priceUsd)??num(pairFor(a)?.priceUsd)}
 function displayCap(a){return num(pumpCoins.get(a.mint)?.marketCap)??num(pairFor(a)?.marketCap)}
 function changeFor(a){return num(pairFor(a)?.priceChange?.h24)}
 async function loadPump(){
  await window.VHouseAuth.ready;
  const client=window.VHouseAuth.getClient();
  const {data,error}=await client.functions.invoke("vhouse-pump-market",{body:{}});
  if(error||!Array.isArray(data?.coins))throw Error("Pump market unavailable");
  for(const coin of data.coins)if(coin.ok&&assets.some(a=>!a.native&&a.mint===coin.mint))pumpCoins.set(coin.mint,coin);
  pumpUnavailable=assets.some(a=>!a.native&&!data.coins.some(c=>c.mint===a.mint&&c.ok&&num(c.priceUsd)>0));
 }
 async function refresh(){
  const results=await Promise.allSettled([loadPump(),...assets.map(async a=>{
   const response=await fetch("https://api.dexscreener.com/token-pairs/v1/solana/"+a.mint,{signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error("HTTP "+response.status);
   const pairs=await response.json();
   if(!Array.isArray(pairs))throw Error("Invalid market response");
   markets.set(a.mint,selectPair(pairs,a));
  })]);
  if(results[0].status==="rejected")pumpUnavailable=true;
  if(results.every(x=>x.status==="rejected"))throw Error("Market unavailable");
  saveSessionMarket();
  return {pumpUnavailable};
 }
 return {markets,pumpCoins,pairFor,displayPrice,displayCap,changeFor,refresh};
}
async function preload(){
 const market=create({sessionCache:true});
 let timeout;
 try{
  await Promise.race([
   market.refresh(),
   new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error("Market preload timed out")),12000);})
  ]);
 }finally{clearTimeout(timeout);}
}
window.VHouseMarketData={assets,num,money,percent,create,preload,refreshMs:60000};
})();
