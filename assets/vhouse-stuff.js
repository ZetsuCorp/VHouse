/* Shared Stuff Room inventory: actual account records, never demo ownership. */
(function(){
  "use strict";
  const catalog={
    "Lucky Charm":{"icon":"🍀","desc":"Journey only. Each charm grants 1 Lucky Retry and +1% to player stats. Maximum 5. Consumed when a retry is used."},
    "Lucky Stone":{"icon":"☄️","label":"Raid Stones","desc":"Raid only. Each stone grants 1 Lucky Retry and +1% to Raid stats. Maximum 5. Consumed when a Raid retry is used."},
    "Swift Boots":{"icon":"🥾","desc":"Each pair in inventory grants +1 SPEED. Use a pair to reduce Journey time by 15 seconds, once per Stage. Used boots are consumed, reducing SPEED by 1."},
    "Hunt Lantern":{"icon":"🔮","desc":"Nullifies the Stage's RPS advantage for one encounter, once. The lantern is consumed after use."},
    "Stage Ticket":{"icon":"🎟️","desc":"Enter one Stage without paying its entry fee. One ticket is consumed per entry."},
    "Emergency Recall Ticket":{"icon":"🚨","desc":"Bring 1 VCard or ALL VCards home early from active Journeys. Keep rewards already earned; forfeit rewards from unresolved encounters."}
  };
  function init(root){
    if(!root||root.dataset.stuffReady==="yes")return root;
    root.dataset.stuffReady="yes";
    const host=root.querySelector("[data-inventory]");
    const name=root.querySelector("[data-name]");
    const description=root.querySelector("[data-description]");
    let request=0;
    function updateVCard(){
      const list=root.querySelector("[data-vcard-list]");
      const cards=window.VHouseCardStore?.getCards?.()||[];
      list.replaceChildren();
      for(const card of cards){
        const entry=document.createElement("div");
        entry.className="vcard-name";
        const heading=document.createElement("small");
        heading.textContent="VCARD NAME";
        const value=document.createElement("strong");
        value.textContent=card.name||"VCard";
        entry.append(heading,value);
        list.append(entry);
      }
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
        name.textContent=catalog[item.thing]?.label||item.thing;
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
          ["itemname",meta.label||item.thing],
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
      showMessage("Inventory","Loading inventory…");
      try{
        await auth.ready;
        const player=await auth.loadPlayerData();
        if(id!==request)return;
        if(!player){
          showMessage("Inventory","Sign in to view inventory.");
          return;
        }
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
