/* One message component for VHouse pages. Accepts {header, title, info}. */
(function () {
  "use strict";
  const frameURL = new URL("Message Frame.png", document.currentScript.src).href;
  const instances = new WeakMap();

  function hostFor(target) {
    if (typeof target === "string") {
      return document.getElementById(target) || document.querySelector(target);
    }
    return target;
  }
  function fit(view) {
    const {host, copy, header, title, info} = view;
    if (!host.isConnected || !host.clientWidth || !host.clientHeight) return;
    let scale = 1;
    for (let i = 0; i < 35; i++) {
      host.style.setProperty("--vhm-scale", String(scale));
      const overflowY = copy.scrollHeight > copy.clientHeight + 1;
      const overflowX = [header, title, info].some(el => el.scrollWidth > el.clientWidth + 1);
      if (!overflowY && !overflowX) break;
      scale = Math.max(.30, scale - .02);
    }
  }
  function mount(target, data) {
    const host = hostFor(target);
    if (!host) return null;
    let view = instances.get(host);
    if (!view) {
      host.classList.add("vhouse-message");
      const image = document.createElement("img");
      image.className = "vhouse-message-frame";
      image.src = frameURL;
      image.alt = "";
      image.draggable = false;
      const copy = document.createElement("div");
      copy.className = "vhouse-message-copy";
      const header = document.createElement("div");
      header.className = "vhouse-message-header";
      const title = document.createElement("strong");
      title.className = "vhouse-message-title";
      const info = document.createElement("p");
      info.className = "vhouse-message-info";
      copy.append(header, title, info);
      host.replaceChildren(image, copy);
      view = {host, copy, header, title, info};
      instances.set(host, view);
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(() => fit(view)).observe(host);
      }
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => fit(view));
      }
    }
    if (data) {
      view.header.textContent = String(data.header ?? "");
      view.title.textContent = String(data.title ?? "");
      view.info.textContent = String(data.info ?? "");
    }
    requestAnimationFrame(() => fit(view));
    return view;
  }
  window.VHouseMessage = {mount, set: mount};

  function init() {
    document.querySelectorAll("[data-vhouse-message]").forEach(host => {
      mount(host, {
        header: host.dataset.header || "",
        title: host.dataset.title || "",
        info: host.dataset.info || ""
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once: true});
  } else {
    init();
  }
})();
