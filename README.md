# VHouse

**VHouse** is a data-driven DeFi journey game. Players send Virtual Cards (**VCards**) on missions to find rewards and ultimately collect **five Totem Pages** to create a **Book**—a glorified NFT binder.

The game is intentionally simple. Its House, Journey, and Shop are variations of one underlying system:

**Data + House Rules → Game functionality**

> **Project status:** This README describes the intended game design and logic. It is not a claim that every described feature is already implemented.

## The VHouse Rules

**Every game interaction is governed by the same three rules:**

1. **Existence — Does the data exist?**
   VHouse checks the relevant source to confirm that the object or record actually exists.
2. **Ownership — Who owns the data?**
   VHouse checks whether the data belongs to the appropriate player/account or whether the relevant NFT or crypto asset is owned by the player's linked wallet.
3. **Usage — Is the data available and authorized for use?**
   VHouse checks whether the player can use the data *right now*. For example, a VCard already on a Journey cannot be deployed again until it returns.

**Existence, Ownership, and Usage** are the actual VHouse Rules. They apply to VCards, items, inventory, mission rewards, Totem Pages, Books, and future game objects.

VHouse asks the correct source for each check:

- **Supabase:** Discord account links, wallet records, VCard/game data, stats, inventory, missions, shop activity, and player logs.
- **Solana:** On-chain NFT/crypto existence, ownership, and transfers.
- **Linked player wallet:** The player's address and assets, checked against the relevant chain records.

The source changes, **not the rules**. A typical action follows the same pattern:

**Check existence → Verify ownership → Check usage → Perform action → Update data → Log result**

Updates are **event-driven**: VHouse updates the relevant data when something happens. It does not revolve around updating a card alone.

## Player entry and identity

1. The player completes the tutorial.
2. The player enters VHouse.
3. The player logs in with **Discord**, with the account handled through **Supabase**.
4. The player links a crypto wallet, which VHouse records and associates with their Discord identity.
5. The player can create or select a VCard.

### VHouse functions

VHouse is the primary place for checking, managing, displaying, and storing player data. It:

- Lets the player **Create Card** or **Change Card** (change means **select another existing VCard**, not edit the current one).
- Facilitates minting, then observes the destination wallet and verifies the resulting NFT before creating playable VCard data.
- Automatically creates, checks, logs, and updates relevant Supabase data when game events occur.
- Formats and displays VCards and their stats.
- Provides **VCard Closet**, **Go on Journey**, **Go to Shop**, and **Check Stats** options.

## VCards: NFT-backed virtual characters

A **VCard (Virtual Card)** is a playable in-game card containing the image of a real NFT, along with character data controlled through the game interface.

- Players can have **as many VCards as they want**.
- When creating one, the player chooses an image.
- **VHouse facilitates an external NFT minting process; VHouse does not have to perform the mint itself.**
- After minting, VHouse checks whether the NFT exists in and is owned by the player's linked wallet.
- Once the House Rules are satisfied, VHouse creates the associated VCard record in Supabase.
- The NFT is the external asset; the playable character's changing stats and state are **game data**.

### VCard stats and levels

| Property | Rule |
| --- | --- |
| Level | **1–10** |
| ATK | **Level × 100** (Level 1 = 100, Level 2 = 200, etc.) |
| DEF | **Level × 100** (Level 1 = 100, Level 2 = 200, etc.) |
| Card designation | **R**, **P**, or **S**, assigned during VCard creation |
| Luck | Affects available retries on encounter outcomes |
| Speed | Reduces the time required for a Journey / return to usable state |

**ATK and DEF appear on the card**; Luck and Speed are character stats. ATK and DEF are currently **display/progression values**, not numerical combat calculations. VCards can visually evolve as their stats improve (for example, adding shine).

A leaderboard may show game statistics later; its exact ranking rules are not yet defined.

## Journey: missions and stages

Journey is where players send a **working, usable VCard** on missions. Its menu shows the current VCard's stats, current mission, and mission statistics.

Each mission has **10 stages**. A stage consists of encounters (hunts and, at higher stages, fights) that resolve through simple coin-flip outcomes. Stage time limits, encounter counts, difficulty, and reward possibilities increase as the player progresses.

| Stage | Example time | Encounters | Possible reward example |
| --- | --- | --- | --- |
| 1 | 30 seconds | 3 hunts | 1–3 scrap; 300 in-game money |
| 2 | 60 seconds | 4 hunts, 2 fights | 3–5 scrap; 500 in-game money |
| 3–10 | To be defined | Increasing encounters and difficulty | Progress toward higher-value rewards, including crypto, NFTs, and ultimately Totem Pages |

These are **possible rewards**, not guaranteed rewards.

### Encounter logic: R / P / S

Journey missions have **R, P, or S variations**, and **each individual encounter** (each hunt or fight) can have its **own R/P/S designation**. This variation changes outcomes and simulates difficulty without a complicated combat system.

- A **hunt** uses a heads/tails result to determine whether an item is found.
- A **fight** uses a heads/tails result to determine win or loss.
- **Luck** provides retries on applicable outcomes.
- A favorable Rock–Paper–Scissors matchup can provide a retry. For example, **R vs S = +1 Luck/retry**.
- An unfavorable matchup such as **R vs P = 0 retries** from that matchup.
- The precise encounter distribution, neutral matchups, retry application, and advanced-stage probabilities will be defined in the Journey algorithm.
- **Speed** shortens mission completion time; it is not an attack stat.

Example: **Johnny J**, a Level 1 VCard with **100 ATK, 100 DEF, R**, enters Stage 2. The game processes **four hunts and two fights**, each with its own RPS matchup and coin-flip resolution, using available retries where applicable. Results depend on the encounters and wins, not on a numerical ATK-versus-DEF battle simulation.

### Journey state and reward flow

1. VHouse checks the VCard's **Existence, Ownership, and Usage**.
2. On deployment, VHouse marks the VCard **unavailable for use** during its Journey.
3. The mission algorithm resolves encounters, finds, wins/losses, retries, and earned rewards.
4. Speed affects when the mission is completed and the VCard can be used again.
5. VHouse logs mission results and **in-game** rewards in the appropriate player's **Supabase** records.
6. Any **crypto or NFT rewards** are sent to the player's corresponding wallet, with those results logged.
7. The VCard returns to **usable** status; the player's Journey data is updated.

## Shop: the economy

The Shop lets players:

- Spend **in-game money**.
- Purchase available items.
- Resell collected **scrap**.

Scrap has special potential: **some scrap may be returned as cryptocurrency**, under rules to be detailed later.

A possible future addition is a **pet or item** that secretly grants an extra retry. This is only an idea, **not an established rule or implemented mechanic**.

The Shop still uses the same **Existence → Ownership → Usage** checks, followed by data changes and transaction logging.

## Overall objective: make a Book

Progress through Journeys, obtain **five Totem Pages**, and assemble them into a **Book**. The Book functions as an **NFT binder**.

The game loop is intentionally straightforward:

**Search → Encounter opposition → Gain rewards / level up → Repeat**

## Architecture in one sentence

**VHouse, Journey, and Shop are three ways to use the same data-and-rules engine; what varies is the action and whether the needed answer comes from Supabase, Solana, or the player's wallet.**

## Details to specify during implementation

The core concepts above are established. The following are still to be decided rather than assumed:

- External NFT minting provider and exact minting flow.
- Exact Supabase data schema and wallet verification/transaction strategy.
- Encounter probability tables, RPS distribution, retry behavior, stage 3–10 configurations, and the reward algorithm.
- Exact leveling triggers, Totem Page acquisition rules, and Book assembly process.
- Crypto redemption rules for scrap, on-chain reward delivery, and shop pricing.
- Later leaderboard calculations and any optional retry-granting items.
