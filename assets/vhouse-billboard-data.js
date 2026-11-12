/* VCard Market: display only the active player's verified VHouse/chain data.
   This module works with both the VHouse Shadow DOM billboard and standalone page. */
(() => {
  "use strict";
  const state = new WeakMap();
  const field = (root, id, value) => {
    const el = root.querySelector('[id="' + id + '"]');
    if (el) el.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
  };
  const cleanImage = url => typeof url === "string" &&
    /^(https:\/\/|ipfs:\/\/)/i.test(url)
      ? (url.startsWith("ipfs://") ? "https://ipfs.io/ipfs/" + url.slice(7) : url) : null;
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
  // Render actual timestamped balances and VHouse events; never synthesize value changes.
  const plotState = new WeakMap();
  const chart = (root, balances, gameEvents, healthy) => {
    const host = root.querySelector("#growthChart");
    const svg = host?.querySelector("svg");
    if (!svg) return;
    const ns = "http://www.w3.org/2000/svg";
    const status = host.querySelector("#chartStatus");
    const series = [];
    const datedBalances = balances.map(e => ({
      t:Date.parse(e.time),v:typeof e.lamports === "number" ? e.lamports / 1e9 : NaN
    })).filter(e=>Number.isFinite(e.t)&&Number.isFinite(e.v))
      .sort((a,b)=>a.t-b.t);
    if(datedBalances.length)series.push({name:"SOL",values:datedBalances,color:"#4bea9b"});
    const events = gameEvents.filter(e => Number.isFinite(Date.parse(e.checked_at)))
      .sort((a,b)=>Date.parse(a.checked_at)-Date.parse(b.checked_at));
    if (events.length) series.push({
      name:"VHouse events",color:"#f5c97c",
      values:events.map((e,i)=>({t:Date.parse(e.checked_at),v:i+1}))
    });
    if (!series.length) {
      if(status)status.textContent=healthy?"AWAITING FIRST VERIFIED BALANCE":"BALANCE DATA UNAVAILABLE";
      return;
    }
    const all=series.flatMap(x=>x.values),minT=Math.min(...all.map(x=>x.t)),maxT=Math.max(...all.map(x=>x.t));
    const timeRange=Math.max(1,maxT-minT);
    const x=t=>25+(t-minT)/timeRange*318;
    const current = plotState.get(root);
    if(current?.frame)cancelAnimationFrame(current.frame);
    const old=current?.series||{};
    svg.querySelectorAll(".vhouse-growth-series,.vhouse-growth-point").forEach(el=>el.remove());
    const motion=[];
    for(const item of series){
      const vals=item.values.map(e=>e.v),low=Math.min(...vals),high=Math.max(...vals);
      // A constant balance is flat, not a fabricated spike.
      const y=v=>high===low?41:68-(v-low)/(high-low)*54;
      const points=item.values.map(e=>({x:x(e.t),y:y(e.v)}));
      const key=item.name;
      const previous=old[key];
      const path=document.createElementNS(ns,"path");
      path.classList.add("vhouse-growth-series");
      path.setAttribute("fill","none");
      path.setAttribute("stroke",item.color);
      path.setAttribute("stroke-width","2.6");
      path.setAttribute("stroke-linejoin","round");
      path.setAttribute("stroke-linecap","round");
      svg.append(path);
      const circles=points.length===1?[document.createElementNS(ns,"circle")]:[];
      for(const circle of circles){
        circle.classList.add("vhouse-growth-point");
        circle.setAttribute("r","3");
        circle.setAttribute("fill",item.color);
        svg.append(circle);
      }
      motion.push({points,previous,path,circles,key});
    }
    const draw=(progress)=>{
      for(const m of motion){
        let points=m.points;
        // Animate only genuinely new samples, from the previous end value.
        if(m.previous && m.points.length>m.previous.length && progress<1){
          const prevEnd=m.previous[m.previous.length-1];
          const nextEnd=m.points[m.points.length-1];
          points=m.points.map((p,i)=>i===m.points.length-1
            ? {x:prevEnd.x+(nextEnd.x-prevEnd.x)*progress,
               y:prevEnd.y+(nextEnd.y-prevEnd.y)*progress}:p);
        }
        m.path.setAttribute("d",points.map((p,i)=>
          (i?"L":"M")+p.x.toFixed(2)+","+p.y.toFixed(2)).join(" "));
        if(m.circles.length){
          m.circles[0].setAttribute("cx",points[0].x);
          m.circles[0].setAttribute("cy",points[0].y);
        }
      }
    };
    const newState={series:Object.fromEntries(motion.map(m=>[m.key,m.points])),frame:0};
    plotState.set(root,newState);
    const animate=motion.some(m=>m.previous && m.points.length>m.previous.length);
    if(animate){
      const begun=performance.now();
      const tick=now=>{
        const progress=Math.min(1,(now-begun)/850);
        draw(1-Math.pow(1-progress,3));
        if(progress<1)newState.frame=requestAnimationFrame(tick);
        else newState.frame=0;
      };
      newState.frame=requestAnimationFrame(tick);
    }else draw(1);
    const timeLabels=svg.querySelectorAll("g text");
    const displayTime=t=>new Date(t).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"});
    if(timeLabels.length>=4){
      timeLabels[1].textContent=displayTime(minT);
      timeLabels[2].textContent=displayTime(minT+timeRange/2);
      timeLabels[3].textContent=displayTime(maxT);
    }
    if(status)status.textContent=series.map(s=>s.name).join(" + ") +
      (healthy?" · VERIFIED DATA":" · LATEST READ UNAVAILABLE");
  };
  function render(root, result) {
    const card = result?.vhouse?.card;
    if (!card) return;
    const chain = result.chain || {};
    const loaded = chain.loaded || {};
    const traits = Array.isArray(loaded.attributes) ? loaded.attributes : [];
    const vchecks = result.vhouse?.verification || [];
    const game = result.vhouse?.events || [];
    const snapshots = chain.snapshots || [];
    const image = cleanImage(loaded.imageUri) || cleanImage(card.image);
    const host = root.querySelector("#vcardImage");
    if (host) {
      host.replaceChildren();
      if (image) {
        const img = document.createElement("img");
        img.alt = text(loaded.nftName) || text(card.name) || "VCard";
        img.src = image;
        img.referrerPolicy = "no-referrer";
        host.append(img);
      }
    }
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
    field(root,"metadataUri",loaded.metadataUri || card.mint_receipt?.metadata_uri);
    field(root,"ipfsImage",loaded.imageUri || card.mint_receipt?.image_uri || card.image);
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
    const editEvents=[...vchecks,...game];
    const countEvents=type=>editEvents.filter(e=>
      String(e.state || "").toUpperCase()===type).length;
    field(root,"updates",countEvents("UPDATE"));
    field(root,"customizations",countEvents("CUSTOMIZE"));
    const baseline=initial ?? (observed.length ? observed[0].lamports : null);
    const change=baseline!==null && current!==null
      ? (baseline===0 ? (current===0 ? "0.00%" : null) :
        ((current-baseline)/baseline*100).toFixed(2)+"%") : null;
    field(root,"growthPercent",change);

    const events = [
      ...vchecks.map(e => ({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE VCARD · " + (e.state || "CHECK"),
        detail:[e.source, "EX:" + e.ex, "OWN:" + e.own, "USE:" + e.use].join(" · ")})),
      ...game.map(e => ({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE · " + (e.state || "CHECK"),
        detail:[e.item,e.source, "EX:" + e.ex, "OWN:" + e.own, "USE:" + e.use].join(" · ")})),
      ...snapshots.map(e=>({date:when(e.time),ts:Date.parse(e.time),
        label:"SOLANA · VCARD BALANCE",detail:fmtSol(e.lamports)})),
    ];
    setActivity(root,events);
    chart(root,snapshots,[...vchecks,...game],current!==null);
    const chartStatus=root.querySelector("#chartStatus");
    if(result.status==="no_mint" && chartStatus)
      chartStatus.textContent="NO NFT MINT LINKED TO ACTIVE VCARD";
    if(result.status==="solscan_unconfigured" && chartStatus)
      chartStatus.textContent="SOLSCAN API KEY NOT CONFIGURED";
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
    root.querySelector("#vcardImage")?.replaceChildren();
    root.querySelectorAll(".vhouse-growth-series,.vhouse-growth-point").forEach(path=>path.remove());
    setActivity(root,[]);
  }
  async function mount(root) {
    if(!root)return;
    const previous=state.get(root);
    if(previous?.dispose)previous.dispose();
    let active=true,sequence=0,timer=null;
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
        if(!card||!api.getUser()){
          clear(root);
          if(status)status.textContent=api.getUser()
            ?"NO ACTIVE VCARD IN PLAYER PLACEHOLDER":"SIGN IN TO VIEW VCARD MARKET";
          return;
        }
        const {data,error}=await api.getClient().functions.invoke("vcard-market-data",{
          body:{cardId:card.id}
        });
        if(!active||ticket!==sequence)return;
        if(error)throw error;
        if(data?.error)throw Error(data.error);
        if(data?.status==="no_active"){
          clear(root);
          if(status)status.textContent="NO ACTIVE VCARD IN PLAYER PLACEHOLDER";
          return;
        }
        render(root,data);
      }catch(error){
        if(!active||ticket!==sequence)return;
        console.error("[VHouse Billboard]",error);
        if(status)status.textContent="MARKET DATA UNAVAILABLE";
      }
    };
    const unsubscribeCard=store.subscribe(()=>void load());
    const unsubscribeLogin=api.subscribe(()=>void load());
    const visible=()=>!document.hidden && root.isConnected &&
      (!!root.host ? !root.host.closest("#billboardOverlay")?.hidden : true);
    // Only poll during an open Billboard; close/reopen restores saved history.
    timer=setInterval(()=>{if(active&&visible())void load();},60000);
    state.set(root,{dispose(){
      active=false;sequence++;
      if(timer!==null)clearInterval(timer);
      unsubscribeCard();unsubscribeLogin();
    }});
    await load();
  }
  window.VHouseBillboardData={mount};
})();
