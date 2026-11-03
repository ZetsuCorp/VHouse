/* VHouse accounts: shared Supabase session for Discord and email. */
(() => {
  "use strict";
  const SUPABASE_URL = "https://jqvnrdjrkdjgjbmqmbbl.supabase.co";
  const KEY = window.VHOUSE_PUBLISHABLE_KEY || "";
  const REDIRECT = new URL("./startup.html?auth_return=1",location.href).href;
  const listeners=new Set();
  let client=null, currentUser=null;
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
      currentUser=session?.user||null;
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
      const {error}=existing?
        await client.auth.linkIdentity({provider:"discord",options}):
        await client.auth.signInWithOAuth({provider:"discord",options});
      if(error)throw error;
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
      const {error}=await client.auth.signInWithOtp({
        email,options:{emailRedirectTo:REDIRECT,shouldCreateUser:true}
      });
      if(error)throw error;
      return {pending:true,message:"Check your email for the VHouse sign-in link."};
    }
    throw Error("Unsupported login provider");
  }
  async function syncActiveVCard(card){
    await ready;
    if(!currentUser)return;
    const {error}=await client.from("vhouse_accounts").update({
      active_vcard_id:card?.id||null,avatar_url:card?.image||null
    }).eq("id",currentUser.id);
    if(error)throw error;
  }
  async function signOut(){
    await ready;
    const {error}=await client.auth.signOut();
    if(error)throw error;
    currentUser=null;notify();
  }
  window.VHouseAuth={
    ready,restoreSession,signIn,signOut,syncActiveVCard,
    getUser:()=>currentUser,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)}
  };
})();
