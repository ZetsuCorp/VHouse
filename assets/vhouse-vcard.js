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
  function paintNFT(root,card) {
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

    const nextEffect=String(card.effect||"none").toLowerCase();
    if(root.dataset.effect!==nextEffect){
      root.dataset.effect=nextEffect;
      const art=root.querySelector(".card-art");
      art.querySelector(".card-effect-overlay")?.remove();
      if(["sparkle","gleam","frost","prism"].includes(nextEffect)){
        const overlay=document.createElement("div");
        overlay.className="card-effect-overlay";overlay.setAttribute("aria-hidden","true");
        if(nextEffect==="sparkle"){
          for(const [x,y,size] of [[18,22,11],[84,33,9],[72,80,10],[31,68,5],[58,14,5],[90,65,4],[8,49,4],[49,88,4]]){
            const star=document.createElement("span");star.className="effect-star";star.textContent="✦";
            star.style.left=x+"%";star.style.top=y+"%";star.style.fontSize=size+"cqw";overlay.append(star);
          }
        }
        art.append(overlay);
      }
    }
    root.querySelector(".rarity").textContent=team;
  }
  function render(host, card) {
    if (typeof host === "string") host = document.getElementById(host);
    if (!host) return;
    host.classList.add("vhouse-vcard-host");
    if (!card) { window.VHouseNFTVisuals?.bind(host,null,()=>{});host.replaceChildren(); return; }
    if (!host.querySelector(":scope > .vcard")) host.innerHTML = template;
    const root = host.querySelector(".vcard");
    if(window.VHouseNFTVisuals)window.VHouseNFTVisuals.bind(host,card,visual=>{if(host.querySelector(".vcard")===root)paintNFT(root,visual);});
    else paintNFT(root,card);
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
    return root;
  }
  window.VHouseVCard = {render, defaultFooter};
})();
