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
    const cardOverlay=root.querySelector("[data-item-card]");
    const shell=root.querySelector(".shell");
    const energyByItem={"Lucky Charm":"#39ff88","Lucky Stone":"#ff446f","Swift Boots":"#ffb52e","Hunt Lantern":"#b46aff","Stage Ticket":"#ff54d5","Emergency Recall Ticket":"#ffb52e"};
    const boostStars='<i class="vhs-boost-star one"></i><i class="vhs-boost-star two"></i><i class="vhs-boost-star three"></i>';
    let openingTimer=null,activeButton=null;
    function boostBurst(target,color){
      const fx=root.querySelector(".vhs-boost-effect");
      if(!target||!fx||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
      const bounds=target.getBoundingClientRect(),parent=fx.getBoundingClientRect();
      const node=document.createElement("div");
      node.className="vhs-boost-burst";node.style.left=(bounds.left-parent.left+bounds.width/2)+"px";node.style.top=(bounds.top-parent.top+bounds.height/2)+"px";node.style.setProperty("--energy",color);
      let lines="";
      for(let i=0;i<14;i++){
        const a=i*360/14;
        lines+='<g transform="rotate('+a+' 100 100)"><path d="M100 79 L96 61 L103 65 L98 38 L101 54" fill="none" stroke="'+color+'" stroke-width=".6" vector-effect="non-scaling-stroke"/><path d="M100 73 L100 25" fill="none" stroke="white" stroke-width=".3" vector-effect="non-scaling-stroke"/><path d="M100 12 L102 20 L110 22 L102 24 L100 32 L98 24 L90 22 L98 20 Z" fill="'+(i%2===0?"white":color)+'"/></g>';
      }
      node.innerHTML='<svg viewBox="0 0 200 200" aria-hidden="true"><ellipse cx="100" cy="100" rx="63" ry="41" transform="rotate(-30 100 100)" fill="none" stroke="'+color+'" stroke-width=".6" vector-effect="non-scaling-stroke"/><ellipse cx="100" cy="100" rx="74" ry="50" transform="rotate(30 100 100)" fill="none" stroke="white" stroke-width=".3" vector-effect="non-scaling-stroke"/>'+lines+'</svg>';
      fx.appendChild(node);setTimeout(()=>node.remove(),680);
    }
    function closeItemCard(restoreFocus=true){
      if(openingTimer!==null)clearTimeout(openingTimer);
      openingTimer=null;
      activeButton?.classList.remove("vhs-boost-flash");
      cardOverlay.hidden=true;
      cardOverlay.replaceChildren();
      shell.inert=false;
      if(restoreFocus&&activeButton?.isConnected)activeButton.focus({preventScroll:true});
      activeButton=null;
    }
    function openItemCard(button,item){
      if(openingTimer!==null||!cardOverlay.hidden)return;
      activeButton=button;
      const meta=catalog[item.thing]||{};
      const color=energyByItem[item.thing]||"#f5d49b";
      button.classList.add("vhs-boost-flash");
      boostBurst(button.querySelector(".vhs-boost-dome"),color);
      const reveal=()=>{
        openingTimer=null;
        button.classList.remove("vhs-boost-flash");
        if(!button.isConnected||root.closest("[hidden]")){activeButton=null;return;}
        cardOverlay.innerHTML='<section class="vhs-boost-card vhs-boost-reveal" role="dialog" aria-modal="true"><button type="button" class="vhs-boost-close" aria-label="Close item card">×</button><div class="vhs-boost-cardlabel">◆ &nbsp; INVENTORY ITEM &nbsp; ◆</div><div class="vhs-boost-art"><div class="vhs-boost-rays"></div><div class="vhs-boost-orbit"></div>'+boostStars+'<span class="vhs-boost-symbol"></span><div class="vhs-boost-sweep"></div></div><strong class="vhs-boost-cardname"></strong><div class="vhs-boost-owned"></div><p class="vhs-boost-desc"></p></section>';
        const card=cardOverlay.firstElementChild;
        card.style.setProperty("--energy",color);
        card.setAttribute("aria-label",meta.label||item.thing);
        card.querySelector(".vhs-boost-symbol").textContent=meta.icon||"📦";
        card.querySelector(".vhs-boost-cardname").textContent=meta.label||item.thing;
        card.querySelector(".vhs-boost-owned").textContent="OWNED: "+item.quantity;
        card.querySelector(".vhs-boost-desc").textContent=meta.desc||"Stored in player inventory.";
        cardOverlay.hidden=false;
        shell.inert=true;
        const close=card.querySelector(".vhs-boost-close");
        close.addEventListener("click",()=>closeItemCard());
        boostBurst(card.querySelector(".vhs-boost-art"),color);
        close.focus({preventScroll:true});
      };
      if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)reveal();
      else openingTimer=setTimeout(reveal,300);
    }
    cardOverlay.addEventListener("click",event=>{if(event.target===cardOverlay)closeItemCard();});
    root.addEventListener("keydown",event=>{
      if(event.key==="Escape"&&(!cardOverlay.hidden||openingTimer!==null)){
        event.preventDefault();event.stopPropagation();closeItemCard();
      }
    });
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
      closeItemCard(false);
      host.replaceChildren();
      const line=document.createElement("div");
      line.className="slot";
      line.textContent=message;
      host.append(line);
      name.textContent=heading;
      description.textContent=message;
    }
    function renderInventory(items){
      closeItemCard(false);
      host.replaceChildren();
      if(!items.length){
        showMessage("Inventory","No items owned.");
        return;
      }
      const select=(button,item)=>{
        host.querySelectorAll(".vhs-boost-item").forEach(slot=>{
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
        button.className="vhs-boost-item";
        button.setAttribute("aria-pressed","false");
        button.setAttribute("aria-haspopup","dialog");
        const meta=catalog[item.thing]||{};
        button.setAttribute("aria-label","View "+(meta.label||item.thing));
        button.style.setProperty("--energy",energyByItem[item.thing]||"#f5d49b");
        button.innerHTML='<span class="vhs-boost-dome"><span class="vhs-boost-aura"></span><span class="vhs-boost-base"></span><span class="vhs-boost-ring"></span>'+boostStars+'<span class="vhs-boost-symbol"></span></span><span class="vhs-boost-plaque"><span class="vhs-boost-name"></span><span class="vhs-boost-owned"></span></span>';
        button.querySelector(".vhs-boost-symbol").textContent=meta.icon||"📦";
        button.querySelector(".vhs-boost-name").textContent=meta.label||item.thing;
        button.querySelector(".vhs-boost-owned").textContent="OWNED: "+item.quantity;
        button.addEventListener("click",()=>{select(button,item);openItemCard(button,item);});
        host.append(button);
      }
      select(host.querySelector(".vhs-boost-item"),items[0]);
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
