/* Reusable information box. It renders supplied content, not hardcoded rows. */
(function () {
  "use strict";
  const instances = new WeakMap();
  function resolve(target) {
    return typeof target === "string" ? document.querySelector(target) : target;
  }
  function mount(target) {
    const host = resolve(target);
    if (!host) return null;
    let instance = instances.get(host);
    if (!instance) {
      host.classList.add("vhouse-info");
      const heading = document.createElement("div");
      heading.className = "vhouse-info-heading";
      const content = document.createElement("div");
      content.className = "vhouse-info-content";
      host.replaceChildren(heading, content);
      instance = {heading, content};
      instances.set(host, instance);
    }
    return instance;
  }
  function set(target, data = {}) {
    const instance = mount(target);
    if (!instance) return;
    const {heading, content} = instance;
    heading.textContent = String(data.heading ?? "");
    const information = data.content;
    if (information instanceof Node) {
      content.replaceChildren(information);
    } else {
      content.textContent = information == null ? "" : String(information);
    }
    content.scrollTop = 0;
  }
  function bindPlayer(target) {
    const host = resolve(target);
    if (!host) return;
    const update = () => {
      const card = window.VHouseCardStore?.getActive();
      set(host, {
        heading: card?.name || "PLAYER INFO",
        content: card?.description || ""
      });
    };
    window.VHouseCardStore?.subscribe(update);
    update();
  }
  function init() {
    document.querySelectorAll("[data-vhouse-info]").forEach(bindPlayer);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else init();
  window.VHouseInfo = {mount, set};
})();
