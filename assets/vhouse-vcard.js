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
    '<div class="stat"><span class="stat-label">ATK</span><span class="stat-value" data-stat="atk"></span></div>',
    '<div class="stat"><span class="stat-label">DEF</span><span class="stat-value" data-stat="def"></span></div>',
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
    root.querySelector('[data-stat="atk"]').textContent = String(card.atk ?? 100);
    root.querySelector('[data-stat="def"]').textContent = String(card.def ?? 100);
    root.querySelector(".meta-footer-text").textContent = String(card.footer ?? defaultFooter);
    root.querySelector(".rarity").textContent = team;
    return root;
  }
  window.VHouseVCard = {render, defaultFooter};
})();
