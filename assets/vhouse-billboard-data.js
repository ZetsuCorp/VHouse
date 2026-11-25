/* VCard Market: display only the active player's verified VHouse/chain data.
   This module works with both the VHouse Shadow DOM billboard and standalone page. */
(() => {
  "use strict";
  const state = new WeakMap();
  const field = (root, id, value) => {
    const el = root.querySelector('[id="' + id + '"]');
    if (el) el.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  };
  const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
  const fmtSol = lamports => typeof lamports === "number" && Number.isFinite(lamports)
    ? (lamports / 1e9).toLocaleString("en-US", { maximumFractionDigits: 9 }) + " SOL" : null;
  const when = timestamp => {
    if (timestamp === null || timestamp === undefined) return null;
    const n = typeof timestamp === "number" ? timestamp * 1000 : Date.parse(timestamp);
    return Number.isFinite(n) ? new Date(n).toLocaleString() : null;
  };
  const traitValue = (traits, key) => {
    const a = Array.isArray(traits) ? traits : [];
    return a.find(v => String(v?.trait_type || v?.name || "").toLowerCase() === key.toLowerCase())?.value ?? null;
  };
  const dataNumber = x => x === null || x === "" || x === undefined ? null :
    Number.isFinite(Number(x)) ? Number(x) : null;
  const setActivity = (root, entries) => {
    const tbody = root.querySelector("#activityHistory");
    if (!tbody) return;
    tbody.replaceChildren();
    if (!entries.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 3; td.textContent = "NO RECORDED ACTIVITY FOR THIS VCARD";
      tr.append(td); tbody.append(tr); return;
    }
    entries.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    for (const event of entries.slice(0, 40)) {
      const tr = document.createElement("tr");
      const cells = [event.date || "—", event.label, event.detail || "—"];
      for (const value of cells) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      tbody.append(tr);
    }
  };
  // Monetary chart: actual SOL account balances, timestamped changes, no simulated prices.
  const plotState = new WeakMap();
  const chart = (root, balances, gameEvents, healthy) => {
    const host=root.querySelector("#growthChart"),svg=host?.querySelector("svg");
    if(!svg)return;
    const status=host.querySelector("#chartStatus"),ns="http://www.w3.org/2000/svg";
    const prior=plotState.get(root);
    if(prior?.frame)cancelAnimationFrame(prior.frame);
    svg.replaceChildren();
    const sol=balances.map(b=>({t:Date.parse(b.time),lamports:b.lamports}))
      .filter(b=>Number.isFinite(b.t)&&Number.isSafeInteger(b.lamports)&&b.lamports>=0)
      .sort((a,b)=>a.t-b.t);
    const game=gameEvents.map(e=>({t:Date.parse(e.time),value:e.value,label:e.label||null,level:e.level??null}))
      .filter(e=>Number.isFinite(e.t)&&Number.isInteger(e.value)&&e.value>=0)
      .sort((a,b)=>a.t-b.t);
    if(!sol.length&&!game.length){
      if(status)status.textContent=healthy==="LOADING"?"LOADING SOL DATA":"NO RECORDED GROWTH DATA";
      return;
    }
    const allTimes=[...sol.map(b=>b.t),...game.map(e=>e.t)];
    const minT=Math.min(...allTimes),maxT=Math.max(...allTimes);
    const left=65,right=343,top=17,bottom=65;
    const x=t=>maxT===minT?(left+right)/2:left+(t-minT)/(maxT-minT)*(right-left);
    const make=(tag,attrs={},value=null,parent=svg)=>{
      const el=document.createElementNS(ns,tag);
      for(const [key,v] of Object.entries(attrs))el.setAttribute(key,String(v));
      if(value!==null)el.textContent=value;
      parent.append(el);
      return el;
    };
    const amount=lamports=>(lamports/1e9).toLocaleString("en-US",{maximumFractionDigits:9});
    const time=t=>new Date(t).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
    const low=sol.length?Math.min(...sol.map(b=>b.lamports)):0;
    const high=sol.length?Math.max(...sol.map(b=>b.lamports)):0;
    const ySol=v=>high===low?(top+bottom)/2:bottom-(v-low)/(high-low)*(bottom-top);
    const label=(xPos,yPos,value,color,anchor="middle")=>
      make("text",{x:xPos,y:yPos,fill:color,"font-size":7.5,
        "font-family":"monospace","text-anchor":anchor,"paint-order":"stroke",
        stroke:"#171321","stroke-width":2.3,"stroke-linejoin":"round"},value);
    make("text",{x:2,y:9,fill:"#e5c38a","font-size":8,"font-family":"monospace"},"SOL");
    const gridValues=sol.length
      ? high===low?[[ySol(low),low]]:[[top,high],[(top+bottom)/2,(high+low)/2],[bottom,low]]
      : [[top,0],[(top+bottom)/2,0],[bottom,0]];
    for(const [y,value] of gridValues){
      make("line",{x1:left,y1:y,x2:right,y2:y,stroke:"#39414a","stroke-width":0.8});
      if(sol.length)label(left-5,y+2.5,amount(value),"#d1d7db","end");
    }
    const times=maxT===minT?[[x(minT),minT,"middle"]]:
      [[left,minT,"start"],[(left+right)/2,(minT+maxT)/2,"middle"],[right,maxT,"end"]];
    for(const [pos,t,anchor] of times)label(pos,84,time(t),"#a9b9c4",anchor);
    const solPoints=sol.map(b=>({x:x(b.t),y:ySol(b.lamports)}));
    const maxEdits=Math.max(1,...game.map(e=>e.value));
    const gameValues=game.map(e=>({x:x(e.t),y:bottom-e.value/maxEdits*(bottom-top),value:e.value,t:e.t,label:e.label,level:e.level}));
    const series=[
      {key:"SOL",points:solPoints,color:"#4bea9b"},
      {key:"VHouse edits",points:gameValues,color:"#f5c97c"}
    ].filter(s=>s.points.length);
    const paths=series.map(s=>({
      ...s,path:make("path",{fill:"none",stroke:s.color,"stroke-width":2.2,
        "stroke-linecap":"round","stroke-linejoin":"round"}),
      previous:prior?.series?.[s.key]
    }));
    const draw=progress=>{
      for(const s of paths){
        const points=s.points.map(p=>({...p}));
        if(s.previous && points.length>s.previous.length&&progress<1){
          const oldEnd=s.previous[s.previous.length-1],end=points[points.length-1];
          points[points.length-1]={
            x:oldEnd.x+(end.x-oldEnd.x)*progress,
            y:oldEnd.y+(end.y-oldEnd.y)*progress
          };
        }
        s.path.setAttribute("d",points.map((p,i)=>
          (i?"L":"M")+p.x.toFixed(2)+","+p.y.toFixed(2)).join(" "));
      }
    };
    // Mark the beginning, every actual balance change, and the latest reading.
    const changes=sol.map((b,i)=>i?b.lamports-sol[i-1].lamports:0);
    const marked=sol.map((b,i)=>i).filter(i=>i===0||i===sol.length-1||changes[i]!==0);
    for(const i of marked){
      const b=sol[i],point=solPoints[i],delta=changes[i];
      const color=delta>0?"#4bea9b":delta<0?"#ff7575":"#e5c38a";
      const circle=make("circle",{class:"vhouse-growth-point",
        cx:point.x,cy:point.y,r:i===sol.length-1?3.3:2.6,
        fill:color,stroke:"#101921","stroke-width":1.1});
      make("title",{},amount(b.lamports)+" SOL"+
        (i?" | "+(delta>0?"+":"")+amount(delta)+" SOL":" | START")+
        " | "+new Date(b.t).toLocaleString(),circle);
    }
    // Keep the newest value visible; annotate recent changes only when labels fit.
    const last=sol.length-1;
    if(last>=0){
      const p=solPoints[last],b=sol[last];
      const anchor=p.x>right-77?"end":p.x<left+77?"start":"middle";
      const labelX=anchor==="end"?p.x-5:anchor==="start"?p.x+5:p.x;
      label(labelX,p.y<32?p.y+12:p.y-9,amount(b.lamports)+" SOL","#e8fff1",anchor);
      const used=[p.x];
      const changesToLabel=marked.filter(i=>i>0&&changes[i]!==0).reverse();
      for(const i of changesToLabel){
        const at=solPoints[i],delta=changes[i];
        if(i!==last && (used.some(xx=>Math.abs(xx-at.x)<72)||used.length>=4))continue;
        used.push(at.x);
        const y=at.y>48?at.y-9:at.y+13;
        const deltaText=(delta>0?"+":"−")+amount(Math.abs(delta))+" SOL";
        const place=at.x>right-72?"end":at.x<left+72?"start":"middle";
        label(place==="end"?at.x-5:place==="start"?at.x+5:at.x,
          y,deltaText,delta>0?"#4bea9b":"#ff7575",place);
      }
    }
    for(const p of gameValues){
      const point=make("circle",{class:"vhouse-growth-point",cx:p.x,cy:p.y,r:2.1,
        fill:"#f5c97c",stroke:"#171321","stroke-width":0.7});
      make("title",{},(p.label||"VHOUSE ACTIVITY")+(p.level!==null?" · LEVEL "+p.level:"")+" | "+new Date(p.t).toLocaleString(),point);
    }
    if(gameValues.length){
      const p=gameValues[gameValues.length-1];
      label(p.x>right-85?p.x-4:p.x+4,p.y<30?p.y+11:p.y-7,(p.label||"")+" "+(p.level!==null?"LV "+p.level:""),"#f5c97c",p.x>right-85?"end":"start");
    }
    const next={series:Object.fromEntries(series.map(s=>[s.key,s.points])),frame:0};
    plotState.set(root,next);
    if(paths.some(s=>s.previous&&s.points.length>s.previous.length)){
      const begun=performance.now();
      const tick=now=>{
        const t=Math.min(1,(now-begun)/550);
        draw(1-(1-t)**3);
        if(t<1)next.frame=requestAnimationFrame(tick);
        else next.frame=0;
      };
      next.frame=requestAnimationFrame(tick);
    }else draw(1);
    if(status){
      status.textContent=series.map(s=>s.key).join(" + ")+(healthy==="VERIFIED"?"":healthy==="LOADING"?" · SOL LOADING":" · SOL UNAVAILABLE");
      status.style.inset="0px 4px auto auto";
      status.style.display="block";
      status.style.pointerEvents="none";
    }
  };
  const vcardAssets = new URL(".", document.currentScript.src);
  let vcardRenderer;
  function prepareVCard(root) {
    const styles = root.head || root;
    if (!styles.querySelector("link[data-billboard-vcard-style]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = new URL("vhouse-vcard.css", vcardAssets).href;
      link.setAttribute("data-billboard-vcard-style", "");
      styles.append(link);
    }
    if (window.VHouseVCard) return Promise.resolve();
    if (!vcardRenderer) vcardRenderer = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL("vhouse-vcard.js", vcardAssets).href;
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    return vcardRenderer;
  }
  function renderActiveVCard(root, card) {
    const host = root.querySelector("#vcardImage");
    if (!host) return;
    host.dataset.cardId = String(card.id);
    let preview = host.querySelector(":scope > .vhouse-vcard-host");
    if (!preview) {
      preview = document.createElement("div");
      host.style.display = "grid";
      host.style.placeItems = "center";
      preview.style.width = "78%";
      host.replaceChildren(preview);
    }
    window.VHouseVCard.render(preview, card);
  }
  async function loadMintedVCardImage(root, card, client, isCurrent, result) {
    // Same full minted PNG source as the Closet VCard Record.
    if (!client || card.external || !card.id) return;
    try {
      const {data,error}=await client.from("vcard_list")
        .select("mint_receipt").eq("card_id",String(card.id)).maybeSingle();
      if(error)throw error;
      if(!isCurrent())return;
      const jsonLevel=dataNumber(traitValue(result?.image?.attributes,"Level"));
      const displayedLevel=billboardLevel(card,null,result);
      // Do not replace a current-level preview with a PNG from an older mint receipt.
      const uri=result?.chain?.loaded?.metadataUri
        ? (jsonLevel===displayedLevel ? result?.image?.imageUri : null)
        : data?.mint_receipt?.image_uri;
      if(typeof uri!=="string")return;
      const url=uri.startsWith("ipfs://")
        ?"https://gateway.pinata.cloud/ipfs/"+uri.slice(7).replace(/^ipfs\//,""):uri;
      if(!/^https?:\/\//i.test(url))return;
      const nftImage=new Image();
      nftImage.alt=(card.name||"VCard")+" full NFT";
      nftImage.referrerPolicy="no-referrer";
      nftImage.className="minted-vcard-image";
      nftImage.onload=()=>{
        if(!isCurrent())return;
        const host=root.querySelector("#vcardImage");
        if(host?.dataset.cardId===String(card.id))host.replaceChildren(nftImage);
      };
      nftImage.onerror=()=>console.warn("Minted VCard PNG unavailable; showing VCard preview.");
      nftImage.src=url;
    }catch(error){
      console.warn("Could not load minted VCard PNG; showing VCard preview.",error);
    }
  }
  const safeUri=value=>typeof value==="string"&&/^(https?:\/\/|ipfs:\/\/)/i.test(value)?value:null;
  function showStat(root,id,value,bonus){
    field(root,id,value);
    const el=root.querySelector('[id="'+id+'"]'),amount=Number(bonus);
    if(el&&Number.isFinite(amount)&&amount>0){
      const extra=document.createElement("span");
      extra.style.color="#f3c66f";extra.style.fontSize="0.8em";
      extra.textContent=" +"+amount.toLocaleString(undefined,{maximumFractionDigits:1});
      extra.title="Amalie bonus";el.append(extra);
    }
  }
  function billboardLevel(card,row,result){
    const mintLevel=dataNumber(traitValue(result?.chain?.loaded?.attributes,"Level"));
    const jsonLevel=dataNumber(traitValue(result?.image?.attributes,"Level"));
    return mintLevel??jsonLevel??row?.level??card.level;
  }
  function renderVHouse(root,card,row,result){
    field(root,"vcardId",card.id);
    field(root,"mintAddress",card.mint_address??row?.mint_address??row?.mint_receipt?.mint_address);
    field(root,"nftDescription",row?.description??card.description);
    field(root,"team",row?.designation??card.team);
    field(root,"level",billboardLevel(card,row,result));
    const current=window.VHouseCardStore?.getActive?.()||card;
    showStat(root,"atk",current.atk,current.amalieBonusAtk);
    showStat(root,"def",current.def,current.amalieBonusDef);
    const receipt=row?.mint_receipt||{};
    if(safeUri(receipt.image_uri))field(root,"ipfsImage",receipt.image_uri);
  }
  function renderBlockchain(root,result){
    const chain=result?.chain||{};
    const loaded={...(chain.loaded||{}),...Object.fromEntries(Object.entries(result?.image||{}).filter(([,v])=>v!==null&&v!==undefined))};
    // Populate NFT details from the existing market service response.
    const mint=text(result?.vhouse?.card?.mint_address)||text(result?.vhouse?.card?.mint_receipt?.mint_address);
    if(mint)field(root,"mintAddress",mint);
    field(root,"nftName",text(chain.loaded?.nftName)||text(loaded.nftName));
    field(root,"nftSymbol",text(chain.loaded?.symbol)||text(loaded.symbol));
    field(root,"ownerWallet",chain.currentOwner);
    field(root,"mintDate",when(chain.mintedAt));
    field(root,"tokenStandard",chain.loaded?.tokenStandard);
    field(root,"soulbound",typeof chain.loaded?.soulbound==="boolean"?(chain.loaded.soulbound?"YES":"NO"):null);
    field(root,"updateAuthority",chain.loaded?.updateAuthority);
    field(root,"closeAuthority",chain.loaded?.closeAuthority);
    field(root,"metadataUri",text(chain.loaded?.metadataUri)||text(loaded.metadataUri));
    const traits=Array.isArray(loaded.attributes)?loaded.attributes:[];
    if(safeUri(loaded.imageUri))field(root,"ipfsImage",loaded.imageUri);
    field(root,"effect",traitValue(traits,"Effect"));
    const price=traitValue(traits,"Mint Price (SOL)")??traitValue(traits,"Mint Price");
    field(root,"mintPrice",price===null?null:String(price).toUpperCase().includes("SOL")?price:price+" SOL");
    const initial=dataNumber(chain.initialMintLamports),current=dataNumber(chain.balanceLamports);
    field(root,"initialMint",fmtSol(initial));
    field(root,"recoverableSol",loaded.closeAuthority?fmtSol(current):null);
    const observed=(chain.snapshots||[]).filter(e=>Number.isSafeInteger(e.lamports)&&Number.isFinite(Date.parse(e.time)))
      .sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const increases=observed.length<2?null:observed.slice(1).reduce((sum,e,i)=>sum+Math.max(0,e.lamports-observed[i].lamports),0);
    field(root,"depositedSol",fmtSol(increases));
    const change=initial!==null&&initial>0&&current!==null?((current-initial)/initial*100).toFixed(2)+"%":null;
    field(root,"growthPercent",change===null?null:change+(parseFloat(change)>0?" - more than when minted.":parseFloat(change)<0?" - less than when minted.":" - same as when minted."));
  }
  function paidEdits(row){
    const records=Array.isArray(row?.mint_receipt?.verified_edits)?row.mint_receipt.verified_edits:[];
    const seen=new Set();
    return records.filter(e=>{
      if(!e?.signature||seen.has(e.signature)||!["update","customize"].includes(e.mode)||!Number.isFinite(Date.parse(e.confirmed_at)))return false;
      seen.add(e.signature);return true;
    }).sort((a,b)=>Date.parse(a.confirmed_at)-Date.parse(b.confirmed_at));
  }
  function levelActivity(row,transactions){
    const records=new Map();
    for(const e of paidEdits(row))records.set(e.signature,{...e,level:null});
    for(const e of Array.isArray(row?.mint_receipt?.verified_levels)?row.mint_receipt.verified_levels:[]){
      if(!e?.signature||!Number.isFinite(Date.parse(e.confirmed_at)))continue;
      records.set(e.signature,{...records.get(e.signature),...e});
    }
    for(const tx of transactions){
      if(!tx.signature||!Number.isFinite(Date.parse(tx.time)))continue;
      if(tx.level==null&&!tx.mode&&!tx.paidEdit)continue;
      const prior=records.get(tx.signature);
      records.set(tx.signature,{
        ...prior,signature:tx.signature,confirmed_at:prior?.confirmed_at||tx.time,
        mode:prior?.mode||tx.mode||null,level:tx.level??prior?.level??null
      });
    }
    return [...records.values()].sort((a,b)=>Date.parse(a.confirmed_at)-Date.parse(b.confirmed_at));
  }
  function activityLabel(e){
    return e.mode==="update"?"UPGRADE":e.mode==="customize"?"CUSTOMIZE":e.mode==="raid"?"RAID":e.level!=null?"LEVEL UP":"PAID EDIT";
  }
  function renderHistory(root,view){
    const chain=view.chain?.chain||{},snapshots=chain.snapshots||[];
    const edits=levelActivity(view.row,chain.transactions||[]);
    // Count the same signature-deduplicated operations displayed on the chart.
    // Preserve older recorded totals if the available history is incomplete.
    for(const [id,mode] of [["updates","update"],["customizations","customize"]]){
      const recorded=dataNumber(view.row?.[id]);
      const count=edits.filter(e=>e.mode===mode).length;
      field(root,id,recorded===null&&!count&&!view.chain?null:Math.max(recorded??0,count));
    }
    const points=edits.map((e,i)=>({time:e.confirmed_at,value:i+1,label:activityLabel(e),level:e.level??null}));
    // Recorded paid edits, not invented monetary valuations.
    const updates=dataNumber(view.row?.updates),custom=dataNumber(view.row?.customizations);
    if(!edits.length&&updates!==null&&custom!==null&&updates+custom===0&&Number.isFinite(Date.parse(view.row?.created_at)))
      points.push({time:view.row.created_at,value:0});
    const events=[
      ...(view.checks||[]).map(e=>({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE VCARD · "+(e.state||"CHECK"),detail:[e.source,"EX:"+e.ex,"OWN:"+e.own,"USE:"+e.use].join(" · ")})),
      ...(view.events||[]).map(e=>({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE · "+(e.state||"CHECK"),detail:[e.item,e.source,"EX:"+e.ex,"OWN:"+e.own,"USE:"+e.use].join(" · ")})),
      ...edits.map(e=>({date:when(e.confirmed_at),ts:Date.parse(e.confirmed_at),label:"VHOUSE · "+activityLabel(e)+(e.level!=null?" · LEVEL "+e.level:""),detail:e.signature})),
      ...(chain.transactions||[]).map(e=>({date:when(e.time),ts:Date.parse(e.time),label:"SOLANA · TRANSACTION",detail:e.signature})),
      ...snapshots.map(e=>({date:when(e.time),ts:Date.parse(e.time),label:"SOLANA · VCARD BALANCE",detail:fmtSol(e.lamports)}))
    ];
    setActivity(root,events);
    if(!events.length&&view.activityError){
      const cell=root.querySelector("#activityHistory td");if(cell)cell.textContent="VHOUSE ACTIVITY UNAVAILABLE";
    }
    chart(root,snapshots,points,view.chainState);
  }
  function clear(root) {
    const names = [
      "vcardId","nftName","nftSymbol","mintAddress","ownerWallet","mintDate",
      "tokenStandard","soulbound","updateAuthority","closeAuthority","metadataUri",
      "initialMint","depositedSol","recoverableSol","updates","customizations",
      "growthPercent","team","level","atk","def","effect","mintPrice",
      "ipfsImage","nftDescription",
    ];
    names.forEach(id => field(root,id,null));
    const imageHost=root.querySelector("#vcardImage");
    if(imageHost){delete imageHost.dataset.cardId;imageHost.replaceChildren();}
    root.querySelector("#growthChart svg")?.replaceChildren();
    setActivity(root,[]);
  }
  function billboardNotice(root, message) {
    const menu = root.querySelector("#billboard");
    if (!menu) return;
    let notice = menu.querySelector("#billboardNotice");
    if (!notice) {
      const style = document.createElement("style");
      style.textContent = `
        #billboard .billboard-notice {
          padding:16px; color:#ffe2ac; text-align:center;
          border:1px solid #805535; background:#21172a;
          font:inherit; line-height:1.5; z-index:3;
        }
        #billboard .billboard-notice[hidden],
        #billboard[data-vcard-unavailable] #overview,
        #billboard[data-vcard-unavailable] #activity {display:none!important}
        #billboard .billboard-notice p {margin:8px 0 0;color:#e8d0e7}
      `;
      (root.head || root).append(style);
      notice = document.createElement("section");
      notice.id = "billboardNotice";
      notice.className = "billboard-notice";
      notice.setAttribute("role","status");
      const title = document.createElement("strong");
      title.textContent = "BILLBOARD — VCARD MARKET";
      const description = document.createElement("p");
      description.textContent = "The Billboard displays the Active VCard’s NFT information, blockchain activity and VHouse records.";
      const current = document.createElement("p");
      current.id = "billboardNoticeStatus";
      notice.append(title,description,current);
      menu.querySelector(".nav").after(notice);
    }
    notice.hidden = !message;
    menu.toggleAttribute("data-vcard-unavailable", Boolean(message));
    notice.querySelector("#billboardNoticeStatus").textContent = message || "";
  }
  function unavailableMessage(card) {
    return card?null:"No Active VCard. Select a VCard in the Closet.";
  }
  async function mount(root) {
    if(!root)return;
    const previous=state.get(root);
    if(previous?.dispose)previous.dispose();
    let active=true,sequence=0;
    const api=window.VHouseAuth,store=window.VHouseCardStore;
    const status=root.querySelector("#chartStatus");
    if(!api||!store){
      if(status)status.textContent="VHOUSE PLAYER DATA UNAVAILABLE";
      return;
    }
    let displayedCard=null,displayedView=null;
    const load=async()=>{
      const ticket=++sequence;
      try{
        await api.ready;
        await store.ready();
        if(!active||ticket!==sequence)return;
        const card=store.getActive(),user=api.getUser();
        const notice=!user?"Sign in to view the Active VCard.":unavailableMessage(card);
        if(notice){
          displayedCard=null;displayedView=null;
          clear(root);billboardNotice(root,notice);return;
        }
        const isCurrent=()=>active&&ticket===sequence&&store.getActive()?.id===card.id&&api.getUser()?.id===user.id;
        const client=api.getClient();
        billboardNotice(root,null);
        const key=user.id+":"+card.id;
        const sameCard=displayedCard===key;
        if(!sameCard){
          for(const id of ["vcardId","nftName","nftSymbol","mintAddress","ownerWallet","mintDate","tokenStandard","soulbound","updateAuthority","closeAuthority","metadataUri","initialMint","depositedSol","recoverableSol","updates","customizations","growthPercent","team","level","atk","def","effect","mintPrice","ipfsImage","nftDescription"])field(root,id,null);
          displayedCard=key;
        }
        const view=sameCard&&displayedView?{...displayedView,chainState:"LOADING"}:
          {row:null,checks:[],events:[],chain:null,chainState:"LOADING"};
        displayedView=view;
        renderVHouse(root,card,view.row,view.chain);
        renderHistory(root,view);
        const rowRead=(async()=>{
          if(card.external)return;
          try{
            const {data,error}=await client.from("vcard_list")
              .select("card_id,name,description,designation,level,atk,def,mint_address,created_at,updates,customizations,mint_receipt")
              .eq("card_id",String(card.id)).maybeSingle();
            if(error)throw error;
            if(!isCurrent())return;
            view.row=data;renderVHouse(root,card,data,view.chain);renderHistory(root,view);
          }catch(error){if(isCurrent())console.error("[VHouse Billboard] VCard List",error);}
        })();
        const activityRead=async(table,column,key)=>{
          try{
            const {data,error}=await client.from(table)
              .select("event_id,state,ex,own,use,source,checked_at,"+column)
              .eq("player_id",user.id).eq(column,String(card.id)).order("checked_at",{ascending:false}).limit(40);
            if(error)throw error;
            if(!isCurrent())return;
            view[key]=data||[];renderHistory(root,view);
          }catch(error){
            if(!isCurrent())return;
            view.activityError=true;renderHistory(root,view);
            console.error("[VHouse Billboard] "+table,error);
          }
        };
        void activityRead("vcard_verification_chain","card_id","checks");
        void activityRead("vhouse_chain","item","events");
        const marketRead=(async()=>{
          try{
            const {data,error}=await client.functions.invoke("vcard-market-data",{body:{cardId:card.id}});
            if(!isCurrent())return;
            if(error)throw error;
            if(data?.error)throw Error(data.error);
            if(!data?.chain)throw Error("Blockchain data unavailable");
            view.chain=data;
            view.chainState=dataNumber(data.chain.balanceLamports)!==null?"VERIFIED":"UNAVAILABLE";
            renderBlockchain(root,data);field(root,"level",billboardLevel(card,view.row,data));renderHistory(root,view);
          }catch(error){
            if(!isCurrent())return;
            view.chainState="UNAVAILABLE";renderHistory(root,view);
            console.error("[VHouse Billboard] Blockchain",error);
          }
        })();
        try{
          await prepareVCard(root);
          if(!isCurrent())return;
          await Promise.all([rowRead,marketRead]);
          if(!isCurrent())return;
          renderActiveVCard(root,{...card,level:billboardLevel(card,view.row,view.chain)});
          void loadMintedVCardImage(root,card,client,isCurrent,view.chain);
        }catch(error){console.error("[VHouse Billboard] VCard image",error);}
        await Promise.all([rowRead,marketRead]);
      }catch(error){
        if(!active||ticket!==sequence)return;
        console.error("[VHouse Billboard]",error);
        if(status)status.textContent="MARKET DATA UNAVAILABLE";
      }
    };
    const visible=()=>!document.hidden && root.isConnected &&
      (!!root.host ? !root.host.closest("#billboardOverlay")?.hidden : true);
    // Refresh for an actual VCard selection or property change, not a clock tick.
    const cardSignature=()=>{
      const card=store.getActive();
      const activity=store.getActiveStatus();
      return JSON.stringify(card?[
        card.id,card.mint_address,card.name,card.description,card.image,
        card.team,card.level,card.atk,card.def,card.speed,
        card.amalieBonusAtk,card.amalieBonusDef,
        activity.status,activity.activity
      ]:null);
    };
    let knownCard=cardSignature();
    let knownUser=api.getUser()?.id||null;
    const onCardChange=()=>{
      const next=cardSignature();
      if(next===knownCard)return;
      knownCard=next;
      if(visible())void load();
    };
    const onLoginChange=user=>{
      const next=user?.id||null;
      if(next===knownUser)return;
      knownUser=next;
      knownCard=cardSignature();
      if(visible())void load();
    };
    // Emitted only after a mint, paid edit or burn is verified on-chain.
    const onVerifiedChange=event=>{
      const card=store.getActive();
      if(!card||!visible())return;
      const id=event?.detail?.cardId, mint=event?.detail?.mintAddress;
      if((id&&String(id)===String(card.id))||
         (mint&&String(mint)===String(card.mint_address)))void load();
    };
    const unsubscribeCard=store.subscribe(onCardChange);
    const unsubscribeLogin=api.subscribe(onLoginChange);
    window.addEventListener("vhouse:vcard-updated",onVerifiedChange);
    state.set(root,{dispose(){
      active=false;sequence++;
      unsubscribeCard();unsubscribeLogin();
      window.removeEventListener("vhouse:vcard-updated",onVerifiedChange);
    }});
    // The first view or an explicit reopen reads current blockchain data.
    await load();
  }
  window.VHouseBillboardData={mount};
})();
