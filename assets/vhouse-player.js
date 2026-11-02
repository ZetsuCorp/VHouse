/* Reusable player badge; takes the selected card from VHouseCardStore. */
(function () {
  "use strict";
  const playerImage = new URL("PlayerHolder-removebg-preview.png", document.currentScript.src).href;
  function mount(host) {
    if (!host) return;
    host.classList.add("vhouse-player");
    const holder = document.createElement("img");
    holder.className = "vhouse-player-holder";
    holder.src = playerImage;
    holder.alt = "";
    holder.draggable = false;
    const art = document.createElement("img");
    art.className = "vhouse-player-portrait";
    art.alt = "";
    art.draggable = false;
    host.replaceChildren(holder, art);
    const update = () => {
      const card = window.VHouseCardStore?.getActive();
      if (card && typeof card.image === "string" &&
          /^(https?:\/\/|data:image\/(?:svg\+xml|jpeg|png|webp|gif))/i.test(card.image)) {
        art.src = card.image;
        host.classList.add("has-vcard");
        host.setAttribute("aria-label", "Active VCard: " + String(card.name || "VCard"));
      } else {
        art.removeAttribute("src");
        host.classList.remove("has-vcard");
        host.setAttribute("aria-label", "Player VCard placeholder");
      }
    };
    window.VHouseCardStore?.subscribe(update);
    update();
  }
  function init() {
    document.querySelectorAll("[data-vhouse-player]").forEach(mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, {once: true});
  else init();
  window.VHousePlayer = {mount};
})();
