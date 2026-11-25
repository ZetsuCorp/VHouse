/* The single VCard visual renderer for every VHouse page. */
(function () {
  "use strict";
  const defaultFooter = "Play directly inside the Zetsu Wall feed. No downloads. No account needed. Uploaded Nov 2025";
  const colors = {R: "#2d7bdc", P: "#1abf96", S: "#b16df4"};
  const template = [
    '<div class="vcard"><div class="vcard-inner">',
    '<header class="card-header"><h2 class="card-name"></h2></header>',
    '<div class="card-art"><img alt="VCard artwork"></div>',
    '<div class="card-info"></div>',
    '<div class="card-description"></div>',
    '<div class="card-stats">',
    '<div class="stat"><span class="stat-label">ATK</span><span class="stat-value" data-stat="atk"></span><span class="stat-bonus" data-bonus="atk"></span></div>',
    '<div class="stat"><span class="stat-label">DEF</span><span class="stat-value" data-stat="def"></span><span class="stat-bonus" data-bonus="def"></span></div>',
    '</div>',
    '<div class="meta-bottom"><div class="meta-footer-text"></div><div class="rarity"></div></div>',
    '</div></div>'
  ].join("");
  function render(host, card) {
    if (typeof host === "string") host = document.getElementById(host);
    if (!host) return;
    host.classList.add("vhouse-vcard-host");
    if (!card) { host.replaceChildren(); return; }
    if (!host.querySelector(":scope > .vcard")) host.innerHTML = template;
    const root = host.querySelector(".vcard");
    const team = colors[card.team] ? card.team : "R";
    root.style.setProperty("--accent", colors[team]);
    root.style.setProperty("--accent-glow", colors[team] + "55");
    const name = String(card.name || "VCARD").slice(0, 16);
    root.querySelector(".card-name").textContent = name;
    const image = root.querySelector(".card-art img");
    const src = card.image;
    if (typeof src === "string" && /^(https?:\/\/|blob:|data:image\/(?:svg\+xml|jpeg|png|webp|gif))/i.test(src)) {
      if (image.getAttribute("src") !== src) image.src = src;
    } else image.removeAttribute("src");
    root.querySelector(".card-info").textContent = "LEVEL " + (card.level ?? 1);
    root.querySelector(".card-description").textContent = String(card.description ?? "").slice(0, 100);
    // Fit the entire number inside each ATK/DEF half, even for large
    // Scrap balances. cqw keeps the size proportional when the card scales.
    for (const field of ["atk", "def"]) {
      const value = root.querySelector('[data-stat="' + field + '"]');
      const fieldName=field==="atk"?"Atk":"Def";
      const isRaid=card["raidAmalieBonus"+fieldName]!==undefined;
      const raidBonus=Number(card["raidAmalieBonus"+fieldName]);
      const liveBonus=Number(card["amalieBonus"+fieldName]);
      const bonus=isRaid?(Number.isFinite(raidBonus)?Math.max(0,raidBonus):0):
        (Number.isFinite(liveBonus)?Math.max(0,liveBonus):0);
      const total=Number(card[field]);
      const base=isRaid&&Number.isFinite(total)?Math.max(0,total-bonus):card[field];
      const text=String(base??100);
      value.textContent=text;
      value.style.fontSize=Math.min(7.1,60/Math.max(1,text.length))+"cqw";
      const bonusNode=root.querySelector('[data-bonus="'+field+'"]');
      const bonusText=bonus>0?"+"+bonus.toLocaleString(undefined,{maximumFractionDigits:1})+" AMALIE":"";
      bonusNode.textContent=bonusText;
      bonusNode.style.fontSize=bonusText?Math.min(3,72/bonusText.length)+"cqw":"";
      value.style.display = "inline-block";
      value.style.whiteSpace = "nowrap";
      value.style.maxWidth = "100%";
      value.parentElement.style.minWidth = "0";
    }
    root.querySelector(".meta-footer-text").textContent = String(card.footer ?? defaultFooter);
    root.querySelector(".rarity").textContent = team;
    return root;
  }
  // Shared animation for every completed UPGRADE, CUSTOMIZE and RAID.
  const activeLevelAnimations=new WeakMap();
  function levelUp(host,previous,next){
    const info=host?.querySelector(".card-info");
    if(!info||!Number.isFinite(Number(previous))||Number(next)<=Number(previous))return Promise.resolve();
    activeLevelAnimations.get(info)?.();
    const original=info.getAttribute("style");
    info.textContent="LEVEL "+previous+" → "+next+" · LEVEL UP!";
    info.style.setProperty("color","#ffdc72","important");
    info.style.setProperty("background","#482b08","important");
    info.style.textAlign="center";
    info.style.fontSize="3.3cqw";
    const animation=info.animate?.([
      {boxShadow:"inset 0 0 0px #ffd76e",filter:"brightness(1)"},
      {boxShadow:"inset 0 0 12px #ffd76e,0 0 12px #ffd76e",filter:"brightness(1.55)"},
      {boxShadow:"inset 0 0 0px #ffd76e",filter:"brightness(1)"}
    ],{duration:600,iterations:5,easing:"ease-in-out"});
    return new Promise(resolve=>{
      let timer;
      const finish=()=>{
        clearTimeout(timer);
        animation?.cancel();
        if(original===null)info.removeAttribute("style");else info.setAttribute("style",original);
        info.textContent="LEVEL "+next;
        activeLevelAnimations.delete(info);
        resolve();
      };
      activeLevelAnimations.set(info,finish);
      timer=setTimeout(finish,3000);
    });
  }
  window.VHouseVCard = {render, levelUp, defaultFooter};
})();
