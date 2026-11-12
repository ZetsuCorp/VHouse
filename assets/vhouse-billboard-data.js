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
  const chart = (root, balances, gameEvents, historyComplete) => {
    const host = root.querySelector("#growthChart");
    const svg = host?.querySelector("svg");
    if (!svg) return;
    // Two independently normalized series, labeled to avoid conflating SOL with game events.
    const paths = svg.querySelectorAll(".vhouse-growth-series");
    paths.forEach(p => p.remove());
    const ns = "http://www.w3.org/2000/svg";
    const status = host.querySelector("#chartStatus");
    const series = [];
    const datedBalances = balances.filter(e => typeof e.time === "number" &&
      typeof e.afterLamports === "number");
    if (datedBalances.length > 1) series.push({
      name: "SOL", values: datedBalances.map(e => ({ t: e.time * 1000, v: e.afterLamports / 1e9 })),
      color: "#4bea9b",
    });
    if (gameEvents.length > 1) {
      const sorted = [...gameEvents].filter(e => e.checked_at).sort((a,b) =>
        String(a.checked_at).localeCompare(String(b.checked_at)));
      if (sorted.length > 1) series.push({
        name: "VHouse events",
        values: sorted.map((e,i) => ({ t: Date.parse(e.checked_at), v: i + 1 }))
          .filter(e => Number.isFinite(e.t)),
        color: "#f5c97c",
      });
    }
    if (!series.length) {
      if (status) status.textContent = "INSUFFICIENT VERIFIED HISTORY";
      return;
    }
    const all = series.flatMap(s => s.values);
    const minT = Math.min(...all.map(e => e.t)), maxT = Math.max(...all.map(e => e.t));
    const timeRange = maxT - minT || 1;
    for (const s of series) {
      if (s.values.length < 2) continue;
      const vals = s.values.map(e => e.v);
      const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
      const d = s.values.map((p,i) =>
        (i === 0 ? "M" : "L") +
        (25 + (p.t - minT) / timeRange * 318).toFixed(2) + "," +
        (68 - (p.v - lo) / span * 54).toFixed(2)).join(" ");
      const path = document.createElementNS(ns, "path");
      path.classList.add("vhouse-growth-series");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", s.color);
      path.setAttribute("stroke-width", "2.6");
      path.setAttribute("stroke-linejoin", "round");
      svg.append(path);
    }
    if (status) {
      status.textContent = series.map(s => s.name).join(" + ") +
        (historyComplete ? " · VERIFIED DATA" : " · PARTIAL HISTORY");
      status.style.alignItems = "flex-end";
      status.style.justifyContent = "flex-end";
      status.style.padding = "0 6px 0 0";
      status.style.pointerEvents = "none";
    }
  };
  function render(root, result) {
    const card = result?.vhouse?.card;
    if (!card) return;
    const chain = result.chain || {};
    const asset = chain.asset || {};
    const loaded = chain.loaded || {};
    const metadata = asset.content?.metadata || {};
    const traits = loaded.attributes?.length ? loaded.attributes :
      metadata.attributes || asset.content?.attributes || [];
    const extensions = asset.mint_extensions || {};
    const owner = asset.ownership || {};
    const authority = Array.isArray(asset.authorities) ? asset.authorities[0] : null;
    const vchecks = result.vhouse?.verification || [];
    const game = result.vhouse?.events || [];
    const tx = chain.history || [];
    const image = cleanImage(loaded.imageUri) ||
      cleanImage(asset.content?.links?.image) ||
      cleanImage(asset.content?.files?.[0]?.uri) || cleanImage(card.image);
    const host = root.querySelector("#vcardImage");
    if (host) {
      host.replaceChildren();
      if (image) {
        const img = document.createElement("img");
        img.alt = text(metadata.name) || text(card.name) || "VCard";
        img.src = image;
        img.referrerPolicy = "no-referrer";
        host.append(img);
      }
    }
    field(root,"vcardId",card.card_id);
    field(root,"nftName",text(loaded.nftName) || text(metadata.name) || card.name);
    field(root,"nftSymbol",text(loaded.symbol) || text(metadata.symbol));
    field(root,"mintAddress",card.mint_address);
    field(root,"ownerWallet",chain.currentOwner || owner.owner || card.mint_receipt?.owner_wallet);
    field(root,"mintDate",when(chain.mintedAt) || when(card.created_at));
    field(root,"tokenStandard",loaded.tokenStandard || asset.interface);
    const noTransfer = extensions.nonTransferable || extensions.non_transferable;
    field(root,"soulbound",loaded.tokenStandard ? (loaded.soulbound ? "YES" : "NO") :
      asset.id ? (noTransfer ? "YES" : "NOT VERIFIED") : null);
    field(root,"updateAuthority",loaded.updateAuthority || authority?.address);
    const close = extensions.mintCloseAuthority || extensions.mint_close_authority;
    const closeAuthority=loaded.closeAuthority ||
      (typeof close === "string" ? close : close?.closeAuthority || close?.authority);
    field(root,"closeAuthority",closeAuthority);
    field(root,"metadataUri",loaded.metadataUri || asset.content?.json_uri ||
      card.mint_receipt?.metadata_uri);
    field(root,"ipfsImage",loaded.imageUri || asset.content?.links?.image || card.image);
    field(root,"nftDescription",text(loaded.description) || text(metadata.description) || card.description);
    field(root,"team",traitValue(traits,"Team") || card.designation);
    field(root,"level",traitValue(traits,"Level") ?? card.level);
    field(root,"atk",traitValue(traits,"ATK") ?? card.atk);
    field(root,"def",traitValue(traits,"DEF") ?? card.def);
    field(root,"effect",traitValue(traits,"Effect"));
    const mintPrice=traitValue(traits,"Mint Price (SOL)") ?? traitValue(traits,"Mint Price");
    field(root,"mintPrice",mintPrice == null ? null :
      String(mintPrice).toUpperCase().includes("SOL") ? mintPrice : mintPrice+" SOL");

    // The existing mint receipt is the anchor for initial mint-account balance.
    // Only count later deposits after the original mint, not the initial rent.
    const start=typeof chain.initialMintLamports === "number" ? chain.initialMintLamports : null;
    const current=typeof chain.balanceLamports === "number" ? chain.balanceLamports : null;
    field(root,"initialMint",fmtSol(start));
    field(root,"recoverableSol",closeAuthority ? fmtSol(current) : null);
    const balances = tx.filter(t => typeof t?.afterLamports === "number");
    const mintTimestamp=typeof chain.mintedAt === "number" ? chain.mintedAt : null;
    const deposits=start == null || !chain.historyComplete ? null :
      balances.filter(t => t.deltaLamports > 0 &&
        (mintTimestamp == null || t.time > mintTimestamp))
        .reduce((sum,t) => sum + t.deltaLamports,0);
    field(root,"depositedSol",fmtSol(deposits));
    // One chain transaction does not identify UPDATE versus CUSTOMIZE by name.
    // Do not manufacture counts; use recorded game events when those exist.
    const editEvents=[...vchecks,...game];
    const countEvents=type => editEvents.filter(e =>
      String(e.state || "").toUpperCase() === type.toUpperCase()).length;
    field(root,"updates",countEvents("UPDATE") || null);
    field(root,"customizations",countEvents("CUSTOMIZE") || null);
    field(root,"growthPercent",start && current !== null
      ? ((current-start)/start*100).toFixed(2)+"%" : null);

    const events = [
      ...vchecks.map(e => ({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE VCARD · " + (e.state || "CHECK"),
        detail:[e.source, "EX:" + e.ex, "OWN:" + e.own, "USE:" + e.use].join(" · ")})),
      ...game.map(e => ({date:when(e.checked_at),ts:Date.parse(e.checked_at),
        label:"VHOUSE · " + (e.state || "CHECK"),
        detail:[e.item,e.source, "EX:" + e.ex, "OWN:" + e.own, "USE:" + e.use].join(" · ")})),
      ...(chain.signatures || []).map(e => ({date:when(e.time),ts:(e.time || 0) * 1000,
        label:e.failed ? "SOLANA · FAILED TRANSACTION" : "SOLANA · TRANSACTION",
        detail:e.signature})),
    ];
    setActivity(root,events);
    chart(root,balances,[...vchecks,...game],Boolean(chain.historyComplete));
    const chartStatus = root.querySelector("#chartStatus");
    if (result.status === "no_mint" || result.status === "helius_unconfigured" ||
        result.status === "chain_partial") {
      if (chartStatus) chartStatus.textContent = result.status === "no_mint"
        ? "NO MINT ADDRESS LINKED TO ACTIVE VCARD"
        : result.status === "helius_unconfigured"
        ? "HELIUS NOT CONFIGURED"
        : "DAS DATA PARTIALLY UNAVAILABLE";
    }
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
    root.querySelectorAll(".vhouse-growth-series").forEach(path => path.remove());
    setActivity(root,[]);
  }
  async function mount(root) {
    if (!root) return;
    const previous = state.get(root);
    if (previous?.dispose) previous.dispose();
    let active = true, sequence = 0;
    const api = window.VHouseAuth;
    const store = window.VHouseCardStore;
    const status = root.querySelector("#chartStatus");
    if (!api || !store) {
      if (status) status.textContent = "VHOUSE PLAYER DATA UNAVAILABLE";
      return;
    }
    const load = async () => {
      const ticket = ++sequence;
      clear(root);
      try {
        await api.ready;
        await store.ready();
        if (!active || ticket !== sequence) return;
        const card = store.getActive();
        if (!card || !api.getUser()) {
          if (status) status.textContent = api.getUser()
            ? "NO ACTIVE VCARD IN PLAYER PLACEHOLDER" : "SIGN IN TO VIEW VCARD MARKET";
          return;
        }
        if (status) status.textContent = "READING VCARD MARKET DATA";
        const {data,error} = await api.getClient().functions.invoke("vcard-market-data",{
          body:{cardId:card.id},
        });
        if (!active || ticket !== sequence) return;
        if (error) throw error;
        if (data?.error) throw Error(data.error);
        if (data?.status === "no_active") {
          if (status) status.textContent = "NO ACTIVE VCARD IN PLAYER PLACEHOLDER";
          return;
        }
        render(root,data);
      } catch (error) {
        if (!active || ticket !== sequence) return;
        console.error("[VHouse Billboard]",error);
        if (status) status.textContent = "MARKET DATA UNAVAILABLE";
      }
    };
    const unsubscribeCard = store.subscribe(() => void load());
    const unsubscribeLogin = api.subscribe(() => void load());
    state.set(root,{dispose(){active=false;sequence++;unsubscribeCard();unsubscribeLogin();}});
    await load();
  }
  window.VHouseBillboardData = { mount };
})();