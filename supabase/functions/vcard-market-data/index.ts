/* VHouse Billboard data bridge. The active VCard comes from the authenticated
   player's EXISTING account record; do not create a second selection store. */
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const send = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => x && typeof x === "object" && !Array.isArray(x) ? x as Obj : {};
const isMint = (value: unknown) => typeof value === "string" &&
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const isSignature = (value: unknown) => typeof value === "string" &&
  /^[1-9A-HJ-NP-Za-km-z]{60,90}$/.test(value);

async function heliusRpc(key: string, method: string, params: unknown) {
  const response = await fetch("https://mainnet.helius-rpc.com/?api-key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error("Helius HTTP " + response.status);
  const data = await response.json();
  if (data.error) throw Error("Helius " + method + ": " + (data.error.message || "RPC error"));
  return data.result;
}


/* The NFT Load screen reads the Token-2022 mint extensions and the IPFS JSON
   directly. Read those same fields here through Helius Solana RPC; DAS is
   additional market data, not the sole source of the NFT's identity. */
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function metadataURL(uri: unknown) {
  const value = stringValue(uri);
  if (!value) return null;
  if (/^ipfs:\/\/([a-zA-Z0-9/._-]+)$/.test(value))
    return "https://gateway.pinata.cloud/ipfs/" + value.slice(7);
  try {
    const u = new URL(value);
    // These are the IPFS metadata gateways VHouse's Load/Mint already use.
    if (u.protocol === "https:" &&
        ["gateway.pinata.cloud","ipfs.io","dweb.link"].includes(u.hostname) &&
        u.pathname.startsWith("/ipfs/")) return value;
  } catch { /* The URI is not a VHouse IPFS metadata URL. */ }
  return null;
}
async function readMintInfo(key: string, mint: string, receipt: Obj) {
  const result = obj(await heliusRpc(key,"getAccountInfo",
    [mint,{encoding:"jsonParsed",commitment:"confirmed"}]));
  const account = obj(result.value);
  if (!Object.keys(account).length) throw Error("Mint account not found");
  const info = obj(obj(obj(account.data).parsed).info);
  const extensions = Array.isArray(info.extensions) ? info.extensions.map(obj) : [];
  const extension = (key: string) => extensions.find(e =>
    String(e.extension || "").toLowerCase() === key.toLowerCase());
  const tokenMetadata = obj(extension("tokenMetadata")?.state);
  const close = obj(extension("mintCloseAuthority")?.state);
  const metadataUri = stringValue(tokenMetadata.uri) ||
    stringValue(receipt.metadata_uri);
  const offchainURL = metadataURL(metadataUri);
  let json: Obj = {};
  if (offchainURL) {
    try {
      const response = await fetch(offchainURL,{signal:AbortSignal.timeout(10000)});
      if (response.ok) json = obj(await response.json());
    } catch (error) {
      console.warn("[vcard-market-data] NFT IPFS JSON:", error instanceof Error ? error.message : error);
    }
  }
  const additional = Array.isArray(tokenMetadata.additionalMetadata)
    ? tokenMetadata.additionalMetadata : [];
  const traits = Array.isArray(json.attributes) ? json.attributes :
    additional.filter((pair: unknown) => Array.isArray(pair) && pair.length === 2)
      .map((pair: unknown) => ({trait_type:(pair as string[])[0], value:(pair as string[])[1]}));
  return {
    tokenStandard: account.owner === TOKEN_2022_PROGRAM ? "Token-2022" : null,
    nftName: stringValue(tokenMetadata.name) || stringValue(json.name),
    symbol: stringValue(tokenMetadata.symbol) || stringValue(json.symbol),
    metadataUri,
    updateAuthority:stringValue(tokenMetadata.updateAuthority),
    closeAuthority:stringValue(close.closeAuthority),
    soulbound:account.owner === TOKEN_2022_PROGRAM &&
      Boolean(extension("nonTransferable")),
    imageUri:stringValue(json.image) || stringValue(receipt.image_uri),
    description:stringValue(json.description),
    attributes:traits,
    mintAccountLamports:typeof account.lamports === "number" ? account.lamports : null,
    supply:stringValue(info.supply),
    decimals:typeof info.decimals === "number" ? info.decimals : null,
  };
}

function mintAccountEvent(tx: unknown, mint: string, signature: string, fallbackTime: number | null) {
  const record = obj(tx);
  const message = obj(obj(record.transaction).message);
  const accountKeys = Array.isArray(message.accountKeys) ? message.accountKeys : [];
  const index = accountKeys.findIndex((key: unknown) =>
    typeof key === "string" ? key === mint : obj(key).pubkey === mint);
  const meta = obj(record.meta);
  const previous = Array.isArray(meta.preBalances) ? Number(meta.preBalances[index]) : NaN;
  const following = Array.isArray(meta.postBalances) ? Number(meta.postBalances[index]) : NaN;
  if (index < 0 || !Number.isFinite(following) || following < 0) return null;
  return {
    signature,
    time: typeof record.blockTime === "number" ? record.blockTime : fallbackTime,
    beforeLamports: Number.isFinite(previous) && previous >= 0 ? previous : null,
    afterLamports: following,
    deltaLamports: Number.isFinite(previous) && previous >= 0 ? following - previous : null,
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return send({ error: "Method not allowed" }, 405);
  try {
    const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return send({ error: "Sign in to VHouse first." }, 401);
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !anon) throw Error("VHouse account service unavailable");
    const client = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await client.auth.getUser(token);
    if (authError || !authData.user?.id) return send({ error: "VHouse sign-in expired." }, 401);
    const playerId = authData.user.id;

    const body = await request.json().catch(() => ({}));
    const cardId = obj(body).cardId;
    if (typeof cardId !== "string" || cardId.length > 150 || !cardId)
      return send({ error: "Active VCard ID required." }, 400);

    const { data: account, error: accountError } = await client
      .from("vhouse_accounts").select("active_vcard_id")
      .eq("id", playerId).maybeSingle();
    if (accountError) throw accountError;
    if (!account?.active_vcard_id) return send({ status: "no_active" });
    if (cardId !== account.active_vcard_id)
      return send({ error: "Active VCard changed. Refresh the player data." }, 409);

    const [inventoryResult, cardResult] = await Promise.all([
      client.from("vhouse_player_inventory").select("thing")
        .eq("player_id", playerId).eq("thing", cardId).eq("type", "VCard")
        .gt("quantity", 0).maybeSingle(),
      client.from("vcard_list")
        .select("card_id,name,image,description,designation,level,atk,def,luck,speed,mint_address,mint_receipt,created_at")
        .eq("card_id", cardId).maybeSingle(),
    ]);
    if (inventoryResult.error) throw inventoryResult.error;
    if (cardResult.error) throw cardResult.error;
    if (!inventoryResult.data || !cardResult.data)
      return send({ error: "Active VCard is not in this player's VHouse inventory." }, 403);
    const card = cardResult.data;
    const mint = card.mint_address;

    // Accumulated VHouse data, read under the user's existing RLS policies.
    const [checksResult, chainResult] = await Promise.all([
      client.from("vcard_verification_chain")
        .select("event_id,card_id,state,ex,own,use,quantity,source,checked_at")
        .eq("player_id", playerId).eq("card_id", cardId)
        .order("checked_at", { ascending: true }).limit(200),
      client.from("vhouse_chain")
        .select("event_id,item,state,ex,own,use,quantity,source,checked_at")
        .eq("player_id", playerId)
        .in("item", [...new Set([cardId, typeof mint === "string" ? mint : cardId])])
        .order("checked_at", { ascending: true }).limit(200),
    ]);
    if (checksResult.error) throw checksResult.error;
    if (chainResult.error) throw chainResult.error;
    const vhouse = {
      card,
      verification: checksResult.data || [],
      events: chainResult.data || [],
    };
    if (!isMint(mint)) return send({ status: "no_mint", vhouse });

    const apiKey = Deno.env.get("HELIUS_API_KEY");
    if (!apiKey) return send({ status: "helius_unconfigured", vhouse });

    // Load's source of truth: the mint extensions + its current IPFS metadata.
    // Helius DAS adds indexed asset data without replacing those fields.
    const receipt = obj(card.mint_receipt);
    const [mintResponse, assetResponse, signaturesResponse] = await Promise.allSettled([
      readMintInfo(apiKey,mint,receipt),
      heliusRpc(apiKey,"getAsset",{id:mint}),
      heliusRpc(apiKey,"getSignaturesForAddress",[mint,{limit:20}]),
    ]);
    const failures: string[] = [];
    const loaded = mintResponse.status === "fulfilled" ? mintResponse.value : null;
    if (mintResponse.status === "rejected")
      failures.push("Mint account: " + String(mintResponse.reason));
    const asset = assetResponse.status === "fulfilled" ? assetResponse.value : null;
    if (assetResponse.status === "rejected")
      failures.push("DAS: " + String(assetResponse.reason));
    const signatures = signaturesResponse.status === "fulfilled" &&
      Array.isArray(signaturesResponse.value) ? signaturesResponse.value : [];
    if (signaturesResponse.status === "rejected")
      failures.push("Transaction history: " + String(signaturesResponse.reason));
    // Load verifies ownership using Token-2022 accounts. Read the linked wallet
    // from the already-verified mint receipt rather than asking for a new wallet.
    const recordedOwner = stringValue(receipt.owner_wallet);
    let currentOwner: string | null = null;
    if (recordedOwner && isMint(recordedOwner) && loaded?.supply === "1") {
      try {
        const accounts = obj(await heliusRpc(apiKey,"getTokenAccountsByOwner",[
          recordedOwner,{mint},{encoding:"jsonParsed",commitment:"confirmed"}
        ]));
        const matches = Array.isArray(accounts.value) ? accounts.value : [];
        if (matches.some((row: unknown) => {
          const info = obj(obj(obj(obj(row).account).data).parsed);
          const token = obj(info.info);
          return token.mint === mint && token.owner === recordedOwner &&
            obj(token.tokenAmount).amount === "1";
        })) currentOwner = recordedOwner;
      } catch (error) {
        failures.push("Token owner lookup: " + String(error));
      }
    }
    // Transaction signature is already stored on the original mint receipt.
    // Read its initial mint-account SOL once for actual before/after growth.
    let initialMintLamports: number | null = null;
    let mintedAt: number | null = null;
    if (isSignature(receipt.transaction_signature)) {
      try {
        const original = await heliusRpc(apiKey,"getTransaction",[
          receipt.transaction_signature,{encoding:"jsonParsed",
            maxSupportedTransactionVersion:0,commitment:"confirmed"}
        ]);
        const originalEvent = mintAccountEvent(original,mint,
          String(receipt.transaction_signature),null);
        initialMintLamports = originalEvent?.afterLamports ?? null;
        mintedAt = obj(original).blockTime as number | null;
      } catch (error) {
        failures.push("Mint receipt transaction: " + String(error));
      }
    }

    // Limit work per viewing; do not claim this is complete history when truncated.
    const recent = signatures.slice(0, 12);
    const transactions: Array<ReturnType<typeof mintAccountEvent>> = [];
    for (let i = 0; i < recent.length; i += 4) {
      const batch = await Promise.allSettled(recent.slice(i, i + 4).map(async (row: unknown) => {
        const event = obj(row);
        if (!isSignature(event.signature) || event.err) return null;
        const tx = await heliusRpc(apiKey, "getTransaction",
          [event.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0,
            commitment: "confirmed" }]);
        return mintAccountEvent(tx, mint, event.signature, typeof event.blockTime === "number"
          ? event.blockTime : null);
      }));
      for (const record of batch) {
        if (record.status === "fulfilled" && record.value) transactions.push(record.value);
      }
    }
    transactions.sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0));
    const historyComplete = signatures.length <= 12 &&
      transactions.length === signatures.filter((row: unknown) => !obj(row).err).length;
    return send({
      status: loaded || asset ? "ok" : "chain_partial",
      vhouse,
      chain: {
        loaded,
        currentOwner: currentOwner || stringValue(obj(asset?.ownership).owner),
        initialMintLamports,
        mintedAt,
        asset: asset ? {
          id: asset.id, interface: asset.interface, content: asset.content,
          ownership: asset.ownership, authorities: asset.authorities,
          mint_extensions: asset.mint_extensions, token_info: asset.token_info,
          burnt: asset.burnt, system: asset.system,
        } : null,
        balanceLamports: loaded?.mintAccountLamports ?? null,
        history: transactions,
        historyComplete,
        signatures: signatures
          .filter((row: unknown) => isSignature(obj(row).signature))
          .map((row: unknown) => ({
            signature: obj(row).signature,
            time: obj(row).blockTime ?? null,
            failed: Boolean(obj(row).err),
          })),
      },
      warnings: failures,
    });
  } catch (error) {
    console.error("[vcard-market-data]", error instanceof Error ? error.message : error);
    return send({ error: "Unable to retrieve VCard market data." }, 500);
  }
});
