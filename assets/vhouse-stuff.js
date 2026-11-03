/* Same Stuff interface behavior, used standalone and directly inside VHouse. */
(function () {
  function init(root) {
    if (!root || root.dataset.stuffReady === "yes") return root;
    root.dataset.stuffReady = "yes";
    function updateVCard(){
      const store=window.VHouseCardStore;
      const active=store?.getActive();
      root.querySelector("[data-vcard-name]").textContent=active?.name||"—";
      root.querySelector("[data-cards-owned]").textContent=String(store?.getCards().length||0);
    }
    window.VHouseCardStore?.subscribe(updateVCard);
    updateVCard();
    // First-draft inventory sample; live player inventory will replace this data source.
    const items=[
    ["Scrap Metal","⚙️",12,"Collected material from Journey Missions."],
    ["Copper Parts","🔩",5,"Components stored in your inventory."],
    ["Old Relic","🏺",2,"An old relic recovered during a Journey."],
    ["Lucky Charm","🍀",1,"A boost item for Journey encounters."],
    ["Swift Boots","🥾",1,"A Journey speed boost item."],
    ["Hunt Lantern","🏮",1,"A boost item for hunting encounters."],
    ["Crystal","💎",3,"A crystal recovered during a Journey."],
    ["Journey Token","🪙",2,"A token stored in your inventory."],
    ["Repair Kit","🧰",1,"Equipment for your Journey."],
    ["Travel Pack","🎒",1,"Supplies for travel."],
    ["Ancient Coin","🪙",4,"An old collectible coin."],
    ["Totem Scrap","📜",2,"A fragment of a Totem Page."]
    ];
    const host=root.querySelector("[data-inventory]");
    items.forEach((item,i)=>{
      const button=document.createElement("button");
      button.type="button";
      button.className="slot"+(i===0?" selected":"");
      button.setAttribute("aria-pressed",String(i===0));
      for(const [cls,value] of [["itemicon",item[1]],["itemname",item[0]],["qty","× "+item[2]]]){
        const el=document.createElement("span");
        el.className=cls;
        el.textContent=value;
        button.appendChild(el);
      }
      button.addEventListener("click",()=>{
        host.querySelectorAll(".slot").forEach((slot,j)=>{
          slot.classList.toggle("selected",j===i);
          slot.setAttribute("aria-pressed",String(j===i));
        });
        root.querySelector("[data-name]").textContent=item[0];
        root.querySelector("[data-description]").textContent=item[3];
      });
      host.appendChild(button);
    });
    
    return root;
  }
  window.VHouseStuff = { init };
})();
