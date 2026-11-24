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
    const game=gameEvents.filter(e=>Number.isFinite(Date.parse(e.checked_at)))
      .map((e,i)=>({t:Date.parse(e.checked_at),value:i+1}))
      .sort((a,b)=>a.t-b.t);
    if(!sol.length&&!game.length){
      if(status)status.textContent=healthy?"AWAITING FIRST RECORDED BALANCE":"BALANCE DATA UNAVAILABLE";
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
    const gameValues=game.map((e,i)=>({x:x(e.t),y:game.length===1?41:
      bottom-i/(game.length-1)*(bottom-top)}));
    const series=[
      {key:"SOL",points:solPoints,color:"#4bea9b"},
      {key:"VHouse",points:gameValues,color:"#f5c97c"}
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
      make("circle",{class:"vhouse-growth-point",cx:p.x,cy:p.y,r:2.1,
        fill:"#f5c97c",stroke:"#171321","stroke-width":0.7});
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
      status.textContent=series.map(s=>s.key).join(" + ")+(healthy?" · VERIFIED":" · LAST READ UNAVAILABLE");
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
  async function loadMintedVCardImage(root, card, client, isCurrent) {
    // Same full minted PNG source as the Closet VCard Record.
    if (!client || card.external || !card.id) return;
    try {
      const {data,error}=await client.from("vcard_list")
        .select("mint_receipt").eq("card_id",String(card.id)).maybeSingle();
      if(error)throw error;
      if(!isCurrent())return;
      const uri=data?.mint_receipt?.image_uri;
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
  function render(root, result) {
    const card = result?.vhouse?.card;
    if (!card) return;
    const chain = result.chain || {};
    const loaded = {...(chain.loaded || {}), ...Object.fromEntries(Object.entries(result.image || {}).filter(([,v])=>v!==null && v!==undefined))};
    const traits = Array.isArray(loaded.attributes) ? loaded.attributes : [];
    const vchecks = result.vhouse?.verification || [];
    const game = result.vhouse?.events || [];
    const snapshots = chain.snapshots || [];
    field(root,"vcardId",card.card_id);
    field(root,"nftName",text(loaded.nftName) || card.name);
    field(root,"nftSymbol",text(loaded.symbol));
    field(root,"mintAddress",card.mint_address);
    field(root,"ownerWallet",chain.currentOwner);
    // Never use the VHouse row's created_at as a substitute for NFT mint time.
    field(root,"mintDate",when(chain.mintedAt));
    field(root,"tokenStandard",loaded.tokenStandard);
    field(root,"soulbound",loaded.soulbound == null ? null : loaded.soulbound ? "YES":"NO");
    field(root,"updateAuthority",loaded.updateAuthority);
    field(root,"closeAuthority",loaded.closeAuthority);
    field(root,"metadataUri",loaded.metadataUri);
    field(root,"ipfsImage",loaded.imageUri);
    field(root,"nftDescription",text(loaded.description) || card.description);
    field(root,"team",traitValue(traits,"Team") || card.designation);
    field(root,"level",traitValue(traits,"Level") ?? card.level);
    field(root,"atk",traitValue(traits,"ATK") ?? card.atk);
    field(root,"def",traitValue(traits,"DEF") ?? card.def);
    field(root,"effect",traitValue(traits,"Effect") || "NONE");
    const price=traitValue(traits,"Mint Price (SOL)") ?? traitValue(traits,"Mint Price");
    field(root,"mintPrice",price === null ? null :
      String(price).toUpperCase().includes("SOL") ? price : price+" SOL");
    const initial=typeof chain.initialMintLamports==="number" ? chain.initialMintLamports : null;
    const current=typeof chain.balanceLamports==="number" ? chain.balanceLamports : null;
    field(root,"initialMint",fmtSol(initial));
    field(root,"recoverableSol",loaded.closeAuthority ? fmtSol(current) : null);
    const observed=snapshots.filter(e=>typeof e.lamports==="number");
    // These are actual increases between recorded observations; no guessed deposits.
    const increases=observed.length < 2 ? 0 :
      observed.slice(1).reduce((sum,e,i)=>sum+Math.max(0,e.lamports-observed[i].lamports),0);
    field(root,"depositedSol",fmtSol(increases));
    // VCard List owns paid-edit counters; verification checks are not purchases.
    field(root,"updates",Number.isInteger(card.updates) ? card.updates : 0);
    field(root,"customizations",Number.isInteger(card.customizations) ? card.customizations : 0);
    const baseline=initial ?? (observed.length ? observed[0].lamports : null);
    const change=baseline!==null && current!==null
      ? (baseline===0 ? (current===0 ? "0.00%" : null) :
        ((current-baseline)/baseline*100).toFixed(2)+"%") : null;
    field(root,"growthPercent",change === null ? null :
      Number.parseFloat(change) > 0 ? change + " - more than when minted." :
      Number.parseFloat(change) < 0 ? change + " - less than when minted." :
      change + " - same as when minted.");

    const events = [
      ...vchecks.map(e => ({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE VCARD · " + (e.state || "CHECK"),
        detail:[e.source, "EX:" + e.ex, "OWN:" + e.own, "USE:" + e.use].join(" · ")})),
      ...game.map(e => ({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE · " + (e.state || "CHECK"),
        detail:[e.item,e.source, "EX:" + e.ex, "OWN:" + e.own, "USE:" + e.use].join(" · ")})),
      ...(chain.transactions||[]).map(e=>({date:when(e.time),ts:Date.parse(e.time),label:"SOLANA · TRANSACTION",detail:e.signature})),
      ...snapshots.map(e=>({date:when(e.time),ts:Date.parse(e.time),
        label:"SOLANA · VCARD BALANCE",detail:fmtSol(e.lamports)})),
    ];
    setActivity(root,events);
    chart(root,snapshots,[...vchecks,...game],current!==null);
    const chartStatus=root.querySelector("#chartStatus");

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
    root.querySelectorAll(".vhouse-growth-series,.vhouse-growth-point").forEach(path=>path.remove());
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
  function unavailableMessage(card, activity) {
    if (!card) return "No Active VCard. Select a VCard in the Closet.";
    const name = card.name;
    const raid = activity.activity === "RAID" || activity.status === "ON_RAID";
    if (activity.status === "RESULTS_READY")
      return name + " has completed its " + (raid ? "Raid" : "Journey") +
        ". Confirm the receipt to view its information.";
    if (activity.status === "ON_RAID" || activity.status === "ON_JOURNEY")
      return name + " is currently on a " + (raid ? "Raid" : "Journey") +
        ". Please wait until it is complete.";
    return null;
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
    const load=async()=>{
      const ticket=++sequence;
      // Keep the prior graph visible between live reads, rather than resetting it.
      try{
        await api.ready;
        await store.ready();
        if(!active||ticket!==sequence)return;
        const card=store.getActive();
        const notice = !api.getUser() ? "Sign in to view the Active VCard." :
          unavailableMessage(card,store.getActiveStatus());
        if(notice){
          clear(root);
          billboardNotice(root,notice);
          return;
        }
        await prepareVCard(root);
        if(!active||ticket!==sequence)return;
        billboardNotice(root,null);
        renderActiveVCard(root,card);
        const client=api.getClient();
        void loadMintedVCardImage(root,card,client,()=>active&&ticket===sequence&&store.getActive()?.id===card.id);
        const {data,error}=await client.functions.invoke("vcard-market-data",{
          body:{cardId:card.id}
        });
        if(!active||ticket!==sequence)return;
        if(error)throw error;
        if(data?.error)throw Error(data.error);
        if(data?.status==="no_active"){
          clear(root);
          billboardNotice(root,unavailableMessage(store.getActive(),store.getActiveStatus()) ||
            "No Active VCard. Select a VCard in the Closet.");
          return;
        }
        billboardNotice(root,null);
        render(root,data);
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
