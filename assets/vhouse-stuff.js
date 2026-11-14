/* Shared Stuff Room inventory: actual account records, never demo ownership. */
(function(){
  "use strict";
  const catalog={
    "Lucky Charm":{icon:"🍀",desc:"1 Lucky Retry and +1% player stats per charm. Maximum 5. Consumed on retry."},
    "Swift Boots":{icon:"🥾",desc:"+1 SPEED per pair held. Using one removes 15 seconds from a Journey, once per Stage."},
    "Hunt Lantern":{icon:"🏮",desc:"Nullifies one Stage RPS advantage for one encounter. Consumed on use."},
    "Stage Ticket":{icon:"🎟️",desc:"Enter a Stage without paying its entry fee. Consumed on entry."},
    "Emergency Recall Ticket":{icon:"🚨",desc:"Recall one or all VCards from Journeys. Earned rewards remain; unresolved encounters are forfeited."}
  };
  function init(root){
    if(!root||root.dataset.stuffReady==="yes")return root;
    root.dataset.stuffReady="yes";
    const host=root.querySelector("[data-inventory]");
    const name=root.querySelector("[data-name]");
    const description=root.querySelector("[data-description]");
    const cash=root.querySelector("[data-igm]");
    const scraps=root.querySelector("[data-scraps]");
    let request=0;
    function updateVCard(){
      const store=window.VHouseCardStore;
      const active=store?.getActive?.();
      root.querySelector("[data-vcard-name]").textContent=active?.name||"—";
      root.querySelector("[data-cards-owned]").textContent=String(store?.getCards?.().length||0);
    }
    function showMessage(heading,message){
      host.replaceChildren();
      const line=document.createElement("div");
      line.className="slot";
      line.textContent=message;
      host.append(line);
      name.textContent=heading;
      description.textContent=message;
    }
    function renderInventory(items){
      host.replaceChildren();
      if(!items.length){
        showMessage("Inventory","No items owned.");
        return;
      }
      const select=(button,item)=>{
        host.querySelectorAll(".slot").forEach(slot=>{
          const selected=slot===button;
          slot.classList.toggle("selected",selected);
          slot.setAttribute("aria-pressed",String(selected));
        });
        name.textContent=item.thing;
        description.textContent=catalog[item.thing]?.desc||"Stored in player inventory.";
      };
      for(const item of items){
        const button=document.createElement("button");
        button.type="button";
        button.className="slot";
        button.setAttribute("aria-pressed","false");
        const meta=catalog[item.thing]||{};
        for(const [cls,value] of [
          ["itemicon",meta.icon||"📦"],
          ["itemname",item.thing],
          ["qty","× "+item.quantity]
        ]){
          const node=document.createElement("span");
          node.className=cls;
          node.textContent=value;
          button.append(node);
        }
        button.addEventListener("click",()=>select(button,item));
        host.append(button);
      }
      select(host.querySelector(".slot"),items[0]);
    }
    async function refresh(){
      const id=++request;
      const auth=window.VHouseAuth;
      cash.textContent="—";
      scraps.textContent="—";
      showMessage("Inventory","Loading inventory…");
      try{
        await auth.ready;
        const player=await auth.loadPlayerData();
        if(id!==request)return;
        if(!player){
          showMessage("Inventory","Sign in to view inventory.");
          return;
        }
        const balance=Number(player.account?.igm_balance);
        cash.textContent=Number.isFinite(balance)?balance.toLocaleString():"—";
        // SCRAPS is not part of the Shop inventory. No unverified demo balance.
        scraps.textContent="—";
        const owned=player.inventory.filter(item=>item.type==="Item"&&Number(item.quantity)>0)
          .sort((a,b)=>a.thing.localeCompare(b.thing));
        renderInventory(owned);
      }catch(error){
        if(id!==request)return;
        console.error("VHouse Stuff inventory:",error);
        showMessage("Inventory","Unable to load inventory.");
      }
    }
    window.VHouseCardStore?.subscribe(updateVCard);
    window.VHouseAuth?.subscribe(()=>{void refresh();});
    window.addEventListener("vhouse:inventory-updated",()=>{void refresh();});
    updateVCard();
    void refresh();
    return root;
  }
  window.VHouseStuff={init};
})();
