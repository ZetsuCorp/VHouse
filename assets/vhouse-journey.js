/* JourneyMissions.html is the single source of interface markup. No iframe. */
(function () {
  function init(root) {
    if (!root || root.dataset.journeyReady === "yes") return root;
    root.dataset.journeyReady = "yes";
    const cardSelection =
      root.querySelector("cardSelection");
    
    const missionCard =
      root.querySelector("missionCard");
    
    const missionTitle =
      root.querySelector("missionTitle");
    
    const stageGrid =
      root.querySelector("stageGrid");
    
    const missionDetail =
      root.querySelector("missionDetail");
    
    const detailTitle =
      root.querySelector("detailTitle");
    
    const detailCopy =
      root.querySelector("detailCopy");
    
    const startButton =
      root.querySelector("startButton");
    
    const backButton =
      root.querySelector("backButton");
    
    const status =
      root.querySelector("status");
    
    const subtitle =
      root.querySelector("subtitle");
    
    let selectedLetter = null;
    let selectedStage = null;
    
    const missions = [
      {
        time: "30 seconds",
        encounters: "3 hunts",
        reward: "300 IG"
      },
      {
        time: "60 seconds",
        encounters: "4 hunts + 2 fights",
        reward: "500 IG"
      }
    ];
    
    /* SELECT R, P OR S */
    
    root.querySelectorAll(".rps-card")
      .forEach(card => {
    
        card.addEventListener("click", () => {
    
          selectedLetter = card.dataset.letter;
          selectedStage = null;
    
          cardSelection.style.display = "none";
          missionCard.style.display = "flex";
          missionDetail.style.display = "none";
    
          missionTitle.textContent =
            selectedLetter + " · SELECT MISSION STAGE";
    
          subtitle.textContent =
            "Select one of the 10 mission stages";
    
          status.textContent =
            selectedLetter + " VCARD · 10 STAGES";
    
          backButton.textContent = "← CHANGE VCARD";
    
          createStages();
    
        });
    
      });
    
    /* GENERATE TEN STAGES */
    
    function createStages() {
    
      stageGrid.innerHTML = "";
    
      for (let i = 1; i <= 10; i++) {
    
        const button = document.createElement("button");
    
        button.className = "stage";
    
        button.innerHTML = `
          <span>STAGE</span>
          <strong>${i}</strong>
        `;
    
        button.addEventListener("click", () => {
          selectStage(i);
        });
    
        stageGrid.appendChild(button);
    
      }
    
    }
    
    /* SELECT STAGE */
    
    function selectStage(number) {
    
      selectedStage = number;
    
      root.querySelectorAll(".stage")
        .forEach((button, index) => {
    
          button.classList.toggle(
            "selected",
            index + 1 === number
          );
    
        });
    
      detailTitle.textContent =
        "STAGE " + number + " · " + selectedLetter;
    
      const mission = missions[number - 1];
    
      if (mission) {
    
        detailCopy.textContent =
          mission.time + " · " +
          mission.encounters + " · Reward: " +
          mission.reward;
    
        startButton.disabled = false;
    
      } else {
    
        detailCopy.textContent =
          "Mission parameters to be configured.";
    
        startButton.disabled = true;
    
      }
    
      status.textContent =
        selectedLetter + " VCARD · STAGE " + number;
    
      missionDetail.style.display = "block";
    
    }
    
    /* DEMO START */
    
    startButton.addEventListener("click", () => {
    
      if (!selectedStage || selectedStage > 2) return;
    
      detailCopy.textContent =
        "Stage " + selectedStage +
        " selected. Mission execution will be connected next.";
    
    });
    
    /* BACK BUTTON */
    
    backButton.addEventListener("click", () => {
    
      selectedLetter = null;
      selectedStage = null;
    
      cardSelection.style.display = "flex";
      missionCard.style.display = "none";
      missionDetail.style.display = "none";
    
      subtitle.textContent =
        "Choose your VCard to begin a Journey";
    
      status.textContent =
        "VCARD SELECTION · 0 / 10 STAGES";
    
      backButton.textContent = "← BACK";
    
    });
    
    
    return root;
  }

  async function load(host, options = {}) {
    if (!host) throw new Error("Journey mount container is required.");
    try {
      const response = await fetch(new URL("./JourneyMissions.html", document.baseURI), {cache:"no-store"});
      if (!response.ok) throw new Error("Journey source returned " + response.status);
      const source = new DOMParser().parseFromString(await response.text(), "text/html");
      const template = source.querySelector("[data-vhouse-journey-root]");
      if (!template) throw new Error("Journey interface root not found.");
      const root = document.importNode(template, true);
      root.classList.toggle("embedded", !!options.embedded);
      host.replaceChildren(root);
      return init(root);
    } catch (error) {
      host.textContent = "Journey Missions could not be loaded.";
      console.error("VHouse Journey:", error);
      return null;
    }
  }

  window.VHouseJourney = { init, load };
})();
