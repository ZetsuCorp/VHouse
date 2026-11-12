 # VHOUSE
### A Journey of Creation

**A Zetsu Reality — From The Zetsumetsu Corporation**

**Build:** 0.2.0-draft2  
**Status:** Active Development  
**Creator:** Artworqq Kevin Suber

## Overview

VHouse is a Web3 journey game combining virtual characters, digital assets, blockchain technology, and player-controlled game data.

Players create VCards, explore VCard Town, manage their assets, complete Journeys, and develop their characters through an integrated game economy.

The game consists of three main environments:

- **VHouse:** Character management, inventory, NFT creation, and statistics.
- **Journey:** Missions, encounters, progression, and rewards.
- **Shop:** Items, boosts, services, and resource trading.

The long-term objective is to collect five Totem Pages and assemble a Book, a digital NFT binder.

## VHouse Rules

VHouse operates through three fundamental checks:

- **EX — Existence:** Does the asset or data exist?
- **OWN — Ownership:** Who owns it?
- **USE — Usage:** Is it available for use?

These rules govern player interactions across VHouse, Supabase, Solana, and connected wallets.

**DATA + HOUSE RULES = GAME FUNCTIONALITY**

## VCards

VCards are customizable virtual characters connected to game records and blockchain assets.

Each VCard includes a character identity, artwork, team, description, statistics, and progression data.

Players choose between three teams:

- **STONE**
- **WIND**
- **BLADE**

Characters begin at Level 1 with 100 ATK and 100 DEF. The progression system supports development through Level 10.

## VCard Creation Unit

The VCard Creation Unit manages the lifecycle of VCard NFTs.

**MINT**

Create and mint a Solana Token-2022 VCard with custom artwork, metadata, and a unique blockchain identity.

Features include image cropping, PNG generation, IPFS storage, wallet authorization, and transaction verification.

New VCards use Token-2022 extensions including NonTransferable, MetadataPointer, and MintCloseAuthority.

**LOAD**

Load existing NFTs, retrieve their metadata, and verify wallet ownership.

Supports Token-2022 NFTs and Metaplex Core ownership verification.

**UPDATE**

Modify a VCard's name, description, team, or artwork while preserving its NFT identity.

**CUSTOMIZE**

Apply visual effects, including GLOW, HOLO, and EMBER.

**BURN**

Burn an eligible VCard NFT, close its associated token and mint accounts, and reclaim their recoverable SOL through a signed Solana transaction.

## VCard Growth & Payments

VHouse connects character customization with blockchain value accumulation.

Paid UPDATE and CUSTOMIZE transactions distribute SOL between VHouse and the NFT's mint account.

The NFT's SOL balance can increase as the character develops.

Completed transactions are verified against Solana, and VHouse records the associated Updates and Customizations.

The VCard Creation Unit handles transactions while Supabase maintains the character's internal records.

## VCard Billboard

The Billboard combines blockchain information and VHouse character data.

It displays:

- NFT artwork, identity, and metadata.
- Wallet ownership and mint information.
- Current and original SOL balances.
- Recoverable SOL.
- Updates and Customizations.
- Character statistics and effects.
- Recorded SOL balance history.
- Growth percentages and transaction activity.

Growth is measured against the VCard's original mint-account balance.

Blockchain data and internal VHouse data remain independently tracked while being presented together.

## VCard Closet & Inventory

The VCard Closet allows players to browse their registered characters.

VHouse also provides an inventory interface for items, resources, and player information.

Character records are stored through Supabase, while broader inventory features remain in development.

## Journey

Journey is the game's mission and character progression system.

It uses:

- Ten-stage mission progression.
- STONE, WIND, and BLADE encounters.
- Coin-flip outcomes.
- Luck and Speed attributes.
- Resource collection.
- Character progression and rewards.

The mission selection interface is available. Mission execution and reward distribution are still being developed.

## Shop

The VHouse Shop contains three sections:

- **Mission Boosts:** Items that influence Journey performance.
- **Journey Service:** Services that assist player missions.
- **Trade Scraps:** Resource exchange and trading.

The current Shop demonstrates these functions while persistent transactions and inventory integration remain in development.

## Technology

VHouse combines:

- HTML, CSS, and JavaScript.
- GitHub Pages.
- Supabase.
- Solana and Token-2022.
- Phantom Wallet.
- IPFS and Pinata.
- Solana RPC and Solscan.

## Development Milestone — November 2026

VHouse has reached its integrated VCard and blockchain milestone.

Completed development includes:

- Game environments and navigation.
- Player authentication and wallet integration.
- VCard creation and management.
- Token-2022 NFT minting.
- External NFT loading.
- NFT Updates and Customizations.
- IPFS artwork and metadata.
- Blockchain transaction verification.
- Supabase VCard purchase tracking.
- NFT balance history and growth visualization.
- Integrated VCard Billboard.

**Next Development Phase:** Journey execution, persistent Shop and inventory systems, character progression, and reward distribution.

---
Remaining Development

The next phases include:

Connecting Journey missions to live player statistics.

Implementing mission results, progression, and rewards.

Replacing demonstration Shop and inventory data with persistent player records.

Completing VCard selection and state-management workflows.

Reconciling game records after NFT burning.

Extending blockchain indexing and NFT discovery.

Completing Totem Page and Book functionality.

Publishing complete legal documentation.

Further transaction, interface, and production testing.

**V HOUSE: A Journey of Creation**  
**A Zetsu Reality**  
**From The Zetsumetsu Corporation**

**Artworqq Kevin Suber**  
© 2024–2026 The Zetsumetsu Corporation. All rights reserved.
