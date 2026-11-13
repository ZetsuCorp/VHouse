/* VHouse accounts: shared Supabase session for Discord and email. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://jqvnrdjrkdjgjbmqmbbl.supabase.co";
  const KEY = window.VHOUSE_PUBLISHABLE_KEY || "";
  const REDIRECT = new URL("./startup.html?auth_return=1",location.href).href;
  const listeners=new Set();
  const LOGIN_METHOD_KEY="vhouse-login-method-v1";
  const LOGIN_PENDING_KEY="vhouse-login-pending-v1";
  let client=null, currentUser=null;
  function readLoginRecord(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch { return null; }
  }
  function startLogin(provider) {
    try { localStorage.setItem(LOGIN_PENDING_KEY,JSON.stringify({provider})); }
    catch (error) { console.warn("[VHouse Auth] Login method not stored",error); }
  }
  function finishLogin(user) {
    if (!user?.id) return;
    const pending=readLoginRecord(LOGIN_PENDING_KEY);
    if (pending && ["discord","email"].includes(pending.provider)) {
      try {
        localStorage.setItem(LOGIN_METHOD_KEY,JSON.stringify({userId:user.id,provider:pending.provider}));
        localStorage.removeItem(LOGIN_PENDING_KEY);
      } catch (error) { console.warn("[VHouse Auth] Login method not saved",error); }
    }
  }
  function clearLoginRecord() {
    try {
      localStorage.removeItem(LOGIN_METHOD_KEY);
      localStorage.removeItem(LOGIN_PENDING_KEY);
    } catch (error) { console.warn("[VHouse Auth] Login method not cleared",error); }
  }
  function getLoginIdentity() {
    const user=currentUser;
    if (!user) return "";
    const stored=readLoginRecord(LOGIN_METHOD_KEY);
    const providers=(user.identities||[]).map(identity=>identity.provider);
    const provider=stored?.userId===user.id ? stored.provider :
      providers.length===1 ? providers[0] : user.app_metadata?.provider;
    if (provider==="discord") {
      const identity=user.identities?.find(item=>item.provider==="discord");
      const data=identity?.identity_data||{};
      return String(data.global_name||data.name||data.full_name||
        data.user_name||data.username||data.preferred_username||
        user.user_metadata?.global_name||user.user_metadata?.user_name||
        user.user_metadata?.name||"Discord account");
    }
    return user.email||user.identities?.find(item=>item.provider==="email")?.identity_data?.email||"";
  }
  function notify(){for(const fn of listeners){try{fn(currentUser)}catch(e){console.error(e)}}}
  function loadSdk(){
    if(window.supabase?.createClient)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const s=document.createElement("script");
      s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      s.onload=()=>window.supabase?.createClient?resolve():reject(Error("Supabase SDK missing"));
      s.onerror=()=>reject(Error("Cannot load Supabase SDK"));
      document.head.appendChild(s);
    });
  }
  function getDiscordId(user){
    const identity=user?.identities?.find(x=>x.provider==="discord");
    return identity?.identity_data?.provider_id || identity?.id || null;
  }
  async function syncProfile(user){
    if(!user)return;
    const {data:existing,error:readError}=await client.from("vhouse_accounts")
      .select("id,username,display_name,email,discord_id").eq("id",user.id).maybeSingle();
    if(readError)throw readError;
    const name=user.user_metadata?.global_name||user.user_metadata?.preferred_username||
      user.user_metadata?.user_name||user.user_metadata?.name||null;
    const updates={
      ...(user.email?{email:user.email}:{}),
      ...(getDiscordId(user)?{discord_id:getDiscordId(user)}:{}),
      ...(!existing?.username?{username:name||user.email?.split("@")[0]||"VHouse Player"}:{}),
      ...(!existing?.display_name&&name?{display_name:name}:{})
    };
    const query=existing
      ? client.from("vhouse_accounts").update(updates).eq("id",user.id)
      : client.from("vhouse_accounts").insert({id:user.id,...updates});
    const {error}=await query;
    if(error)throw error;
  }
  async function refresh(){
    const {data,error}=await client.auth.getUser();
    if(error && !/session missing/i.test(error.message||""))console.warn("[VHouse Auth]",error.message);
    currentUser=data?.user||null;
    finishLogin(currentUser);
    notify();
    if(currentUser)try{await syncProfile(currentUser)}catch(e){console.error("[VHouse Profile]",e)}
    return currentUser;
  }
  const ready=(async()=>{
    if(!KEY)throw Error("Supabase publishable key is not configured");
    await loadSdk();
    client=window.supabase.createClient(SUPABASE_URL,KEY,{auth:{
      persistSession:true,autoRefreshToken:true,detectSessionInUrl:true
    }});
    client.auth.onAuthStateChange((event,session)=>{
      if(event==="SIGNED_OUT") clearLoginRecord();
      currentUser=session?.user||null;
      finishLogin(currentUser);
      notify();
      if(currentUser&&(event==="SIGNED_IN"||event==="USER_UPDATED")){
        const u=currentUser;
        setTimeout(()=>void syncProfile(u).catch(e=>console.error("[VHouse Profile]",e)),0);
      }
    });
    await refresh();
  })();
  ready.catch(e=>console.error("[VHouse Auth]",e.message));
  async function restoreSession(){
    await ready;
    const u=await refresh();
    return u?{authenticated:true,user:u}:null;
  }
  async function signIn(provider,options={}){
    await ready;
    const existing=await refresh();
    if(provider==="discord"){
      if(existing?.identities?.some(x=>x.provider==="discord"))return {authenticated:true,user:existing};
      const options={redirectTo:REDIRECT,scopes:"identify email"};
      if(!existing)startLogin("discord");
      const {error}=existing?
        await client.auth.linkIdentity({provider:"discord",options}):
        await client.auth.signInWithOAuth({provider:"discord",options});
      if(error){
        if(!existing)try{localStorage.removeItem(LOGIN_PENDING_KEY)}catch{}
        throw error;
      }
      return {pending:true};
    }
    if(provider==="email"){
      const email=String(options.email||"").trim().toLowerCase();
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error("Enter a valid email.");
      if(existing){
        if(existing.email?.toLowerCase()===email)return {authenticated:true,user:existing};
        const {error}=await client.auth.updateUser({email},{emailRedirectTo:REDIRECT});
        if(error)throw error;
        return {pending:true,message:"Check your inbox to confirm this email on your current VHouse account."};
      }
      startLogin("email");
      const {error}=await client.auth.signInWithOtp({
        email,options:{emailRedirectTo:REDIRECT,shouldCreateUser:true}
      });
      if(error){
        try{localStorage.removeItem(LOGIN_PENDING_KEY)}catch{}
        throw error;
      }
      return {pending:true,message:"Check your email for the VHouse sign-in link."};
    }
    throw Error("Unsupported login provider");
  }
  // Load account-specific game data only after Supabase has restored the login session.
  // This is read-only: item grants, card creation and verification are separate operations.
  async function loadPlayerData(){
    await ready;
    const user=currentUser;
    if(!user) return null;
    const playerId=user.id;
    const [accountResult,inventoryResult]=await Promise.all([
      client.from("vhouse_accounts")
        .select("id,igm_balance,active_vcard_id,active_vcard_snapshot").eq("id",playerId).maybeSingle(),
      client.from("vhouse_player_inventory")
        .select("thing,type,quantity,state,updated_at").eq("player_id",playerId)
    ]);
    if(accountResult.error)throw accountResult.error;
    if(inventoryResult.error)throw inventoryResult.error;
    // A sign-out or account change during the request must never expose the prior player.
    if(currentUser?.id!==playerId)return null;
    return {
      playerId,
      account:accountResult.data||null,
      inventory:inventoryResult.data||[]
    };
  }
  async function syncActiveVCard(card){
    await ready;
    const id=currentUser?.id;
    if(!id)throw Error("Sign in before assigning a VCard.");
    if(!card?.id)throw Error("Select a VCard.");
    // An external NFT is saved as a display snapshot, not as an internal VCard.
    const snapshot=card.external?{
      id:String(card.id),external:true,
      mint_address:String(card.mint_address||""),
      owner_wallet:String(card.owner_wallet||""),
      name:String(card.name||"Loaded NFT").slice(0,16),
      description:String(card.description||"").slice(0,100),
      image:String(card.image||""),
      team:card.team,level:card.level,atk:card.atk,def:card.def
    }:null;
    const {data,error}=await client.from("vhouse_accounts").update({
      active_vcard_id:String(card.id),
      active_vcard_snapshot:snapshot,
      avatar_url:card.image||null,
      updated_at:new Date().toISOString()
    }).eq("id",id).select("active_vcard_id").maybeSingle();
    if(error)throw error;
    if(!data||data.active_vcard_id!==String(card.id))
      throw Error("The VCard assignment was not saved.");
    if(currentUser?.id!==id)throw Error("VHouse account changed during assignment.");
    return data;
  }
  async function signOut(){
    await ready;
    const {error}=await client.auth.signOut();
    if(error)throw error;
    currentUser=null;clearLoginRecord();notify();
  }
  window.VHouseAuth={
    ready,restoreSession,signIn,signOut,syncActiveVCard,
    getUser:()=>currentUser,getLoginIdentity,loadPlayerData,
    getClient:()=>client,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}
  };
})();
