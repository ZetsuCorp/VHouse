/* VHouse Draft 2 startup scaffold. No provider or ownership claims without adapters. */
(function () {
  "use strict";
  const BUILD_VERSION = "0.2.0-draft2";
  const SESSION_KEY = "vhouse_startup_ready_v1";
  const TUTORIAL_KEY = "vhouse_tutorial_seen";
  const CONFIG_URL = "./assets/startup-config.json";
  const FALLBACK_ASSETS = ["assets/VStart.png","assets/VCrad Town.png","assets/Vhome1.png"];
  const $ = id => document.getElementById(id);
  let config = null, configError = null, imageErrors = [];
  let authAdapter = null, authMode = null;
  let legalRequired = false;
  let policyScrollReached = false;
  let legalConfigValid = false;
  let policyScrollCleanup = null;
  const root = $("startupRoot");
  if (!root) return;

  function setStage(name) {
    root.querySelectorAll("[data-stage]").forEach(s => { s.hidden = s.dataset.stage !== name; });
    root.dataset.stage = name;
    $("startupAnnouncer").textContent = name + " screen";
  }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  function compareVersions(a, b) {
    const split = value => String(value || "").match(/^\d+(?:\.\d+){0,2}/)?.[0].split(".").map(Number) || [];
    const av = split(a), bv = split(b);
    for (let i = 0; i < 3; i++) { if ((av[i] || 0) !== (bv[i] || 0)) return (av[i] || 0) > (bv[i] || 0) ? 1 : -1; }
    return 0;
  }
  async function readConfig() {
    const response = await fetch(CONFIG_URL, {cache:"no-store"});
    if (!response.ok) throw Error("Published startup configuration returned " + response.status);
    const loaded = await response.json();
    if (!loaded || loaded.appId !== "vhouse" || !loaded.buildVersion) throw Error("Invalid published startup configuration");
    return loaded;
  }
  function preloadImage(path) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(path);
      img.onerror = () => reject(Error("Could not load " + path));
      img.src = new URL(path, document.baseURI).href;
    });
  }
  async function beginLoading() {
    setStage("loading");
    configError = null;
    imageErrors = [];
    try { config = await readConfig(); } catch (e) { config = null; configError = e; }
    const assets = [...new Set((config?.preload?.length ? config.preload : FALLBACK_ASSETS))];
    const bar = $("assetProgress"), status = $("assetStatus");
    bar.max = assets.length; bar.value = 0;
    status.textContent = "Loading game resources: 0 / " + assets.length;
    await Promise.all(assets.map(async path => {
      try { await preloadImage(path); } catch (error) { imageErrors.push(error.message); }
      bar.value += 1;
      status.textContent = "Resources checked: " + bar.value + " / " + assets.length;
    }));
    showVersion();
  }
  async function showVersion() {
    setStage("version");
    const retry = $("versionRetry"), status = $("versionStatus");
    retry.hidden = true;
    if (imageErrors.length) {
      status.textContent = imageErrors.length + " game image(s) failed to load. Retry when your connection is ready.";
      retry.hidden = false;
      return;
    }
    if (configError) {
      status.textContent = "Published version could not be verified. Reload to retry.";
      retry.hidden = false;
      return;
    }
    if (config.maintenance) {
      status.textContent = "VHouse is marked as unavailable for maintenance in the published configuration.";
      retry.hidden = false;
      return;
    }
    if (compareVersions(BUILD_VERSION, config.minimumSupportedVersion) < 0) {
      status.textContent = "This build is below the published minimum version. Reload to update.";
      retry.hidden = false;
      return;
    }
    status.textContent = compareVersions(BUILD_VERSION, config.latestVersion) < 0
      ? "A newer compatible build is published."
      : "Build " + BUILD_VERSION + " matches the published startup configuration.";
    // Version verification is automatic; players do not need to approve a successful check.
    await sleep(350);
    if (root.dataset.stage === "version") await showAuth();
  }
  async function showAuth() {
    setStage("auth");
    const status = $("authStatus");
    $("sessionContinue").hidden = true;
    $("guestLogin").hidden = false;
    for (const [provider,id] of [["discord","discordLogin"],["email","emailLogin"]]) {
      const button = $(id);
      button.disabled = !authAdapter?.signIn;
      button.textContent = provider.toUpperCase() + (button.disabled ? " LOGIN — NOT CONNECTED" : " LOGIN");
    }
    status.textContent = "Checking for an existing player session…";
    if (authAdapter?.restoreSession) {
      try {
        const session = await authAdapter.restoreSession();
        if (session?.authenticated === true) {
          authMode = "authenticated";
          status.textContent = "A verified session was restored.";
          $("guestLogin").hidden = true;
          $("sessionContinue").hidden = false;
          return;
        }
      } catch (error) { console.warn("VHouse session restoration failed:",error); }
    }
    status.textContent = "Login providers are not connected in this draft. Guest preview uses browser-local VCards and does not verify ownership.";
  }
  async function signIn(provider) {
    if (!authAdapter?.signIn) return;
    $("authStatus").textContent = "Opening " + provider + " sign-in…";
    try {
      const session = await authAdapter.signIn(provider);
      if (session?.authenticated === true) {
        authMode = "authenticated";
        showLegal();
      } else {
        $("authStatus").textContent = "Sign-in was not completed. Try again or continue as guest.";
      }
    } catch (error) {
      console.error("VHouse sign-in failed:",error);
      $("authStatus").textContent = "Sign-in failed. Try again or continue as guest.";
    }
  }
  function updateLegalContinue() {
    $("legalContinue").disabled = !policyScrollReached || !legalConfigValid ||
      (legalRequired && !$("legalConsent").checked);
  }
  function bindPolicyScroll() {
    if (policyScrollCleanup) {
      policyScrollCleanup();
      policyScrollCleanup = null;
    }
    policyScrollReached = false;
    updateLegalContinue();
    const frame = $("policyFrame");
    if (root.dataset.stage !== "legal" || frame.hidden) return;
    try {
      const doc = frame.contentDocument;
      const scrolling = doc?.scrollingElement || doc?.documentElement;
      if (!doc || !scrolling || doc.readyState === "loading") return;
      const checkBottom = () => {
        if (root.dataset.stage !== "legal") return;
        const scrollDistance = scrolling.scrollHeight - scrolling.clientHeight;
        if (scrollDistance > 8 && scrolling.scrollTop >= scrollDistance - 8) {
          policyScrollReached = true;
          $("legalStatus").textContent = "End of policy reached. You can continue.";
          updateLegalContinue();
        }
      };
      doc.addEventListener("scroll", checkBottom, {passive: true, capture: true});
      policyScrollCleanup = () => doc.removeEventListener("scroll", checkBottom, true);
      checkBottom();
    } catch (error) {
      $("legalStatus").textContent = "The embedded policy cannot be checked. Continue remains locked.";
      console.warn("VHouse policy scroll check unavailable:", error);
    }
  }
  function showLegal() {
    setStage("legal");
    policyScrollReached = false;
    const legal = config?.legal || {};
    const status = $("legalStatus");
    const terms = $("startupTerms"), privacy = $("startupPrivacy"), row = $("consentRow");
    const frame = $("policyFrame");
    const validLink = url => typeof url === "string" && (/^https:\/\//i.test(url) || /^\.\/[a-z0-9_./-]+\.html$/i.test(url));
    const hasTerms = validLink(legal.termsUrl), hasPrivacy = validLink(legal.privacyUrl);
    terms.hidden = !hasTerms; privacy.hidden = !hasPrivacy;
    if (hasTerms) terms.href = legal.termsUrl;
    legalRequired = legal.required === true;
    legalConfigValid = hasPrivacy && (!legalRequired || hasTerms);
    row.hidden = !legalRequired;
    $("legalConsent").checked = false;
    updateLegalContinue();
    if (hasPrivacy) {
      privacy.href = legal.privacyUrl;
      frame.hidden = false;
      const nextUrl = new URL(legal.privacyUrl, document.baseURI);
      if (nextUrl.origin !== location.origin) {
        status.textContent = "A scroll-verified privacy page must be hosted on this site's origin.";
        frame.hidden = true;
        return;
      }
      status.textContent = "Scroll to the bottom of the VHouse privacy page to unlock CONTINUE. Official policy text is still being prepared.";
      if (frame.getAttribute("src") !== legal.privacyUrl) frame.src = legal.privacyUrl;
      else bindPolicyScroll();
    } else {
      frame.hidden = true;
      frame.removeAttribute("src");
      status.textContent = "The game privacy policy is not configured yet.";
    }
    if (legalRequired && !hasTerms) {
      status.textContent = "Required Terms are not configured. Entry remains blocked.";
    }
  }
  function showTitle() { setStage("title"); }
  function play() {
    try { sessionStorage.setItem(SESSION_KEY, "yes"); } catch (error) { /* URL bypass still works. */ }
    let seen = false;
    try { seen = localStorage.getItem(TUTORIAL_KEY) === "yes"; } catch (error) { /* Open tutorial. */ }
    window.location.assign(seen ? "./index.html?started=1" : "./tutorial.html");
  }

  $("versionRetry").addEventListener("click", () => window.location.reload());
  $("discordLogin").addEventListener("click", () => signIn("discord"));
  $("emailLogin").addEventListener("click", () => signIn("email"));
  $("guestLogin").addEventListener("click", () => { authMode = "guest-preview"; showLegal(); });
  $("sessionContinue").addEventListener("click", showLegal);
  $("policyFrame").addEventListener("load", bindPolicyScroll);
  $("legalConsent").addEventListener("change", updateLegalContinue);
  $("legalContinue").addEventListener("click", () => {
    if (!policyScrollReached || !legalConfigValid) return;
    if (legalRequired && !$("legalConsent").checked) return;
    if (!authMode) return;
    showTitle();
  });
  $("playButton").addEventListener("click", play);

  // Integration contract for Draft 2: adapter must return {authenticated:true}
  // only after a real provider has verified the session.
  window.VHouseStartup = {
    registerAuthAdapter(adapter) {
      if (!adapter || typeof adapter.restoreSession !== "function" || typeof adapter.signIn !== "function") {
        throw Error("Auth adapter needs restoreSession() and signIn(provider).");
      }
      authAdapter = adapter;
    },
    buildVersion: BUILD_VERSION
  };
  setStage("splash");
  sleep(900).then(beginLoading).catch(error => {
    console.error("VHouse startup failed:",error);
    setStage("version");
    $("versionStatus").textContent = "Startup failed. Reload to retry.";
    $("versionRetry").hidden = false;
  });
})();
