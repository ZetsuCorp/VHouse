/* V Town: one NPC for the signed-in player. */
(() => {
  const map = document.querySelector(".map-container");
  const auth = window.VHouseAuth;
  if (!map || !auth) return;

  // Pick one of the two sidewalk paths once per page load.
  const zones = [
    { min: 12, max: 37, y: 80.5 },
    { min: 64, max: 89, y: 81 }
  ];
  const zone = zones[Math.floor(Math.random() * zones.length)];
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
    .town-npc-name { position:absolute; bottom:92px; left:0;
      transform:translateX(-50%); color:#ffe4a0; font:700 11px Arial,sans-serif;
      text-shadow:0 1px 3px #000, 0 0 4px #000; white-space:nowrap; }
  `;
  document.head.append(style);

  let npc = null;
  let frame = 0;
  let activeId = null;
  let sprite, avatar, label;
  let x, direction, moving, remaining, lastTime;

  function position() {
    npc.style.left = x + "%";
    npc.style.top = zone.y + "%";
    sprite.style.transform = "scaleX(" + direction + ")";
  }

  function tick(now) {
    if (!npc) return;
    const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, .1);
    lastTime = now;
    remaining -= dt;

    if (moving) {
      x += direction * 1.4 * dt;
      if (x >= zone.max || x <= zone.min) {
        x = Math.max(zone.min, Math.min(zone.max, x));
        direction *= -1;
        moving = false;
        remaining = random(1, 3);
      } else if (remaining <= 0) {
        moving = false;
        remaining = random(.8, 3);
      }
    } else if (remaining <= 0) {
      moving = true;
      remaining = random(2, 6);
    }

    position();
    frame = requestAnimationFrame(tick);
  }

  function removeNPC() {
    cancelAnimationFrame(frame);
    npc?.remove();
    npc = null;
    activeId = null;
  }

  function spawn(user) {
    npc = document.createElement("div");
    npc.className = "town-npc";

    sprite = document.createElement("div");
    sprite.className = "town-npc-sprite";
    const face = document.createElement("div");
    face.className = "town-npc-face";
    avatar = document.createElement("img");
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

    label = document.createElement("span");
    label.className = "town-npc-name";
    npc.append(sprite, label);
    map.append(npc);

    activeId = user.id;
    x = random(zone.min, zone.max);
    direction = Math.random() < .5 ? -1 : 1;
    moving = true;
    remaining = random(2, 6);
    lastTime = null;
    position();
    frame = requestAnimationFrame(tick);
  }

  function sync(user) {
    if (!user) { removeNPC(); return; }
    if (activeId !== user.id) { removeNPC(); spawn(user); }

    const discord = user.identities?.find(identity => identity.provider === "discord");
    const profile = discord?.identity_data || {};
    const metadata = user.user_metadata || {};
    const image = discord && (profile.avatar_url || profile.picture ||
      metadata.avatar_url || metadata.picture);
    if (image) {
      if (avatar.getAttribute("src") !== image) avatar.src = image;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
      avatar.removeAttribute("src");
    }
    label.textContent = discord ? (profile.custom_claims?.global_name ||
      profile.full_name || profile.name || metadata.name || "Discord Player") : "Player";
  }

  auth.subscribe(sync);
  auth.ready.then(() => sync(auth.getUser())).catch(error =>
    console.warn("[VHouse NPC]", error));
})();
