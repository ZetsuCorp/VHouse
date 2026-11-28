/* V Town: shared online NPC population. */
(() => {
  const map = document.querySelector(".map-container");
  const auth = window.VHouseAuth;
  if (!map || !auth) return;

  // Pick one of the two sidewalk paths once per page load.
  const zones = [
    { min: 12, max: 37, y: 80.5 },
    { min: 64, max: 89, y: 81 }
  ];
  const localSide = Math.floor(Math.random() * zones.length);
  const random = (min, max) => min + Math.random() * (max - min);

  const style = document.createElement("style");
  style.textContent = `
    .town-npc { position:absolute; width:0; height:0; z-index:2;
      pointer-events:none; user-select:none; }
    .town-npc-sprite { position:absolute; width:100px; height:116.05px;
      left:-60px; top:-104.45px; transform-origin:60% 90%; }
    .town-npc-face { position:absolute; inset:0; clip-path:polygon(
      70.5% 26%, 79% 29%, 84% 33%, 88% 40%, 89% 46%,
      87% 50%, 81% 54%, 73% 59%, 64% 60%, 53% 55%,
      46% 51%, 42.5% 47%, 44% 43%, 49% 37%, 57% 32%, 63% 28%
    ); }
    .town-npc-avatar { position:absolute; left:42%; top:26%;
      width:47%; height:34%; object-fit:cover; }
    .town-npc-body { position:absolute; inset:0; width:100%; height:100%; }
    .town-npc-puff { position:absolute; z-index:2; pointer-events:none;
      font-size:9px; line-height:1; user-select:none;
      animation:town-npc-puff-away .65s ease-out forwards; }
    @keyframes town-npc-puff-away {
      from { opacity:.8; transform:translate(-50%,-50%) scale(.65); }
      to { opacity:0; transform:translate(calc(-50% + var(--puff-drift)),calc(-50% - 5px)) scale(1.15); }
    }
    .town-npc-name { position:absolute; bottom:92px; left:0;
      transform:translateX(-50%); color:#ffe4a0; font:700 11px Arial,sans-serif;
      text-shadow:0 1px 3px #000, 0 0 4px #000; white-space:nowrap; }
  `;
  document.head.append(style);

  const npcs = new Map();
  let channel = null, client = null, local = null, subscribed = false;
  let frame = 0, lastTime = null;
  const joinedAt = Date.now();

  function position(npc) {
    npc.el.style.left = npc.x + "%";
    npc.el.style.top = npc.zone.y + "%";
    npc.sprite.style.transform = "scaleX(" + npc.direction + ")";
  }

  function puff(npc) {
    const el = document.createElement("span");
    el.className = "town-npc-puff";
    el.textContent = "💨";
    el.setAttribute("aria-hidden", "true");
    el.style.left = "calc(" + npc.x + "% + " + (-npc.direction * 14) + "px)";
    el.style.top = "calc(" + npc.zone.y + "% - 2px)";
    el.style.setProperty("--puff-drift", (-npc.direction * 12) + "px");
    el.addEventListener("animationend", () => el.remove(), { once:true });
    map.insertBefore(el, npc.el);
  }

  function tick(now) {
    const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, .1);
    lastTime = now;
    for (const npc of npcs.values()) {
      npc.remaining -= dt;
      if (npc.moving) {
        npc.puffTimer -= dt;
        if (npc.puffTimer <= 0 && dt > 0) {
          puff(npc);
          npc.puffTimer = .55;
        }
        npc.x += npc.direction * 1.4 * dt;
        if (npc.x >= npc.zone.max || npc.x <= npc.zone.min) {
          npc.x = Math.max(npc.zone.min, Math.min(npc.zone.max, npc.x));
          npc.direction *= -1;
          npc.moving = false;
          npc.remaining = random(1, 3);
        } else if (npc.remaining <= 0) {
          npc.moving = false;
          npc.remaining = random(.8, 3);
        }
      } else if (npc.remaining <= 0) {
        npc.moving = true;
        npc.remaining = random(2, 6);
      }
      position(npc);
    }
    frame = npcs.size ? requestAnimationFrame(tick) : 0;
    if (!frame) lastTime = null;
  }

  function removeNPC(id) {
    npcs.get(id)?.el.remove();
    npcs.delete(id);
    if (!npcs.size) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = null;
    }
  }

  function spawn(id, player) {
    const el = document.createElement("div");
    el.className = "town-npc";

    const sprite = document.createElement("div");
    sprite.className = "town-npc-sprite";
    const face = document.createElement("div");
    face.className = "town-npc-face";
    const avatar = document.createElement("img");
    avatar.className = "town-npc-avatar";
    avatar.alt = "";
    avatar.draggable = false;
    avatar.hidden = true;
    face.append(avatar);

    const body = document.createElement("img");
    body.className = "town-npc-body";
    body.src = "assets/The%20NPC.png";
    body.alt = "";
    body.draggable = false;
    sprite.append(face, body);

    const label = document.createElement("span");
    label.className = "town-npc-name";
    el.append(sprite, label);
    map.append(el);

    const zone = zones[player.side === 1 ? 1 : 0];
    const npc = { el, sprite, avatar, label, zone,
      x: random(zone.min, zone.max),
      direction: Math.random() < .5 ? -1 : 1,
      moving: true, remaining: random(2, 6), puffTimer: .15 };
    npcs.set(id, npc);
    position(npc);
    if (!frame) frame = requestAnimationFrame(tick);
    return npc;
  }

  function renderPlayer(id, player) {
    const npc = npcs.get(id) || spawn(id, player);
    const zone = zones[player.side === 1 ? 1 : 0];
    if (npc.zone !== zone) {
      npc.zone = zone;
      npc.x = random(zone.min, zone.max);
      position(npc);
    }
    const image = typeof player.avatar_url === "string" &&
      /^https:\/\//i.test(player.avatar_url) ? player.avatar_url : "";
    if (image) {
      if (npc.avatar.getAttribute("src") !== image) npc.avatar.src = image;
      npc.avatar.hidden = false;
    } else {
      npc.avatar.hidden = true;
      npc.avatar.removeAttribute("src");
    }
    npc.label.textContent = typeof player.username === "string" ? player.username : "Player";
  }

  // Reconcile the complete Presence snapshot, deduplicating multiple tabs
  // by player ID. The oldest connected tab determines that player's side.
  function reconcile(state = {}) {
    const population = new Map();
    for (const entries of Object.values(state)) {
      if (!Array.isArray(entries)) continue;
      for (const player of entries) {
        if (!player || typeof player.player_id !== "string") continue;
        const previous = population.get(player.player_id);
        const age = Number(player.joined_at) || 0;
        const previousAge = Number(previous?.joined_at) || 0;
        if (!previous || age < previousAge ||
            (age === previousAge && player.side < previous.side)) {
          population.set(player.player_id, player);
        }
      }
    }
    if (local && !population.has(local.player_id)) population.set(local.player_id, local);
    for (const id of npcs.keys()) if (!population.has(id)) removeNPC(id);
    for (const [id, player] of population) renderPlayer(id, player);
  }

  function profileFor(user) {
    const discord = user.identities?.find(identity => identity.provider === "discord");
    const profile = discord?.identity_data || {};
    const metadata = user.user_metadata || {};
    return {
      player_id: user.id,
      username: discord ? (profile.custom_claims?.global_name ||
        profile.full_name || profile.name || metadata.name || "Discord Player") : "Player",
      avatar_url: discord ? (profile.avatar_url || profile.picture ||
        metadata.avatar_url || metadata.picture || "") : "",
      side: localSide,
      joined_at: joinedAt
    };
  }

  function publish(room) {
    if (room !== channel || !subscribed || !local) return;
    room.track(local).then(result => {
      if (room === channel && result !== "ok") console.warn("[VHouse Population] track:", result);
    }).catch(error => console.warn("[VHouse Population]", error));
  }

  function disconnect() {
    const previous = channel;
    const previousClient = client;
    channel = null;
    client = null;
    subscribed = false;
    local = null;
    reconcile();
    if (previous && previousClient) {
      void previousClient.removeChannel(previous).catch(error =>
        console.warn("[VHouse Population]", error));
    }
  }

  function sync(user) {
    if (!user) { disconnect(); return; }
    const player = profileFor(user);
    if (channel && local?.player_id === player.player_id) {
      const changed = JSON.stringify(local) !== JSON.stringify(player);
      local = player;
      if (changed) publish(channel);
      return;
    }
    disconnect();
    local = player;
    reconcile();
    client = auth.getClient();
    if (!client) return;
    const room = client.channel("vhouse_population", {
      config: { presence: { key: player.player_id } }
    });
    channel = room;
    room.on("presence", { event: "sync" }, () => {
      if (room === channel) reconcile(room.presenceState());
    }).subscribe(status => {
      if (room !== channel) return;
      subscribed = status === "SUBSCRIBED";
      if (subscribed) publish(room);
      else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reconcile();
      }
    });
  }

  auth.subscribe(sync);
  auth.ready.then(() => sync(auth.getUser())).catch(error =>
    console.warn("[VHouse Population]", error));
})();
