/* Bind a newly minted Token-2022 VCard receipt to the existing Closet row.
   Ownership, payment and NFT identity are verified on Solana server-side.
   Never trust a client-provided mint/transaction pair without that verification. */
import { createClient } from "npm:@supabase/supabase-js@2.49.8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
type O = Record<string, unknown>;
const asObject = (value: unknown): O =>
  value && typeof value === "object" && !Array.isArray(value) ? value as O : {};
const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const address = (value: unknown) =>
  typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const signature = (value: unknown) =>
  typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{60,90}$/.test(value);
const url = (value: unknown) =>
  typeof value === "string" && value.length <= 500 &&
  (/^https:\/\/[^ ]+$/i.test(value) || /^ipfs:\/\/[a-zA-Z0-9/._-]+$/i.test(value));
const treasury = "CT1fjjJMaNb2jgwH7rnuyiLcASmtmdRzSw7tQv8VXaRK";
const mintFeeLamports = 1_000_000;
async function rpc(key: string, method: string, params: unknown) {
  const response = await fetch("https://mainnet.helius-rpc.com/?api-key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error("Solana verification service HTTP " + response.status);
  const result = await response.json();
  if (result.error) throw Error("Solana verification unavailable: " + (result.error.message || result.error.code));
  return result.result;
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return json({ error: "Sign in to VHouse first." }, 401);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const heliusKey = Deno.env.get("HELIUS_API_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey || !heliusKey)
      return json({ error: "Receipt storage is not configured." }, 503);
    const viewer = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: identity, error: identityError } = await viewer.auth.getUser(token);
    if (identityError || !identity.user?.id) return json({ error: "VHouse session expired." }, 401);
    const playerId = identity.user.id;
    const input = asObject(await req.json().catch(() => ({})));
    const cardId = input.cardId;
    const mint = input.mintAddress;
    const transaction = input.transactionSignature;
    if (typeof cardId !== "string" || !/^[0-9a-f-]{36}$/i.test(cardId) ||
        !address(mint) || !signature(transaction))
      return json({ error: "Invalid VCard mint receipt." }, 400);

    // The user's Closet/inventory determines which row may be bound.
    const [cardRes, inventoryRes, accountRes] = await Promise.all([
      viewer.from("vcard_list").select("card_id,mint_address,mint_receipt")
        .eq("card_id",cardId).maybeSingle(),
      viewer.from("vhouse_player_inventory").select("thing")
        .eq("player_id",playerId).eq("thing",cardId).eq("type","VCard")
        .gt("quantity",0).maybeSingle(),
      viewer.from("vhouse_accounts").select("wallet_address")
        .eq("id",playerId).maybeSingle(),
    ]);
    if (cardRes.error || inventoryRes.error || accountRes.error)
      throw cardRes.error || inventoryRes.error || accountRes.error;
    if (!cardRes.data || !inventoryRes.data || !accountRes.data?.wallet_address)
      return json({ error: "VCard or linked player wallet not found." }, 403);
    const owner = accountRes.data.wallet_address;
    if (!address(owner)) return json({ error: "Linked player wallet is invalid." }, 400);
    if (cardRes.data.mint_address) {
      if (cardRes.data.mint_address === mint &&
          cardRes.data.mint_receipt?.transaction_signature === transaction)
        return json({ ok: true, cardId, mintAddress: mint, receipt: cardRes.data.mint_receipt, alreadySaved: true });
      return json({ error: "This VCard is already linked to a different receipt." }, 409);
    }

    // Transaction must be finalized and must contain the VHouse payment,
    // signed by this player's LINKED Phantom wallet, for this exact mint.
    const tx = asObject(await rpc(heliusKey, "getTransaction", [
      transaction, { encoding:"jsonParsed", commitment:"finalized", maxSupportedTransactionVersion:0 },
    ]));
    if (!tx.transaction || !tx.meta)
      return json({ error: "Mint transaction is not finalized yet. Retry receipt save.", retryable:true }, 409);
    if (asObject(tx.meta).err)
      return json({ error: "Mint transaction failed on Solana." }, 422);
    const message = asObject(asObject(tx.transaction).message);
    const keys = asArray(message.accountKeys);
    if (!keys.some(key => asObject(key).pubkey === owner && asObject(key).signer === true) ||
        !keys.some(key => asObject(key).pubkey === mint))
      return json({ error: "Transaction does not match the connected wallet and VCard mint." }, 403);
    const paid = asArray(message.instructions).some(ix => {
      const instruction = asObject(ix);
      const transfer = asObject(asObject(instruction.parsed).info);
      return instruction.program === "system" &&
        asObject(instruction.parsed).type === "transfer" &&
        transfer.source === owner && transfer.destination === treasury &&
        Number(transfer.lamports) === mintFeeLamports;
    });
    if (!paid) return json({ error: "Verified VHouse mint payment not found." }, 403);

    // Check the actual NFT, its wallet ownership and supply independently of the receipt.
    const [mintResult, holdingResult, assetResult] = await Promise.allSettled([
      rpc(heliusKey, "getAccountInfo", [mint, { encoding:"jsonParsed", commitment:"finalized" }]),
      rpc(heliusKey, "getTokenAccountsByOwner", [owner, { mint }, { encoding:"jsonParsed", commitment:"finalized" }]),
      rpc(heliusKey, "getAsset", { id:mint }),
    ]);
    const mintInfo = mintResult.status === "fulfilled" ? asObject(asObject(mintResult.value).value) : {};
    const token = asObject(asObject(asObject(mintInfo.data).parsed).info);
    const holdings = holdingResult.status === "fulfilled" ?
      asArray(asObject(holdingResult.value).value) : [];
    const asset = assetResult.status === "fulfilled" ? asObject(assetResult.value) : {};
    const owningToken = holdings.some(entry => {
      const parsed = asObject(asObject(asObject(asObject(entry).account).data).parsed);
      const info = asObject(parsed.info);
      const amount = asObject(info.tokenAmount);
      return info.mint === mint && amount.amount === "1" && Number(amount.decimals) === 0;
    });
    if (!mintInfo.owner || !token.supply || !holdings.length || !owningToken)
      return json({ error:"Mint account or wallet ownership is still being indexed. Retry receipt save.", retryable:true },409);
    if (String(token.supply)!=="1" || Number(token.decimals)!==0)
      return json({ error:"NFT supply or decimals did not pass verification." },422);
    if (asset.id && asset.id !== mint)
      return json({ error:"DAS asset identity mismatch." },422);
    if (asObject(asset.ownership).owner && asObject(asset.ownership).owner !== owner)
      return json({ error:"DAS asset owner does not match the VHouse wallet." },403);

    const content = asObject(asset.content);
    const links = asObject(content.links);
    const metadata = asObject(content.metadata);
    const verifiedUri = url(content.json_uri) ? content.json_uri : null;
    const suppliedUri = url(input.metadataUri) ? input.metadataUri : null;
    if (verifiedUri && suppliedUri && verifiedUri !== suppliedUri)
      return json({ error:"NFT metadata does not match the receipt." },403);
    const suppliedImage = url(input.imageUri) ? input.imageUri : null;
    const verifiedImage = url(links.image) ? links.image : null;
    if (verifiedImage && suppliedImage && verifiedImage !== suppliedImage)
      return json({ error:"NFT image does not match the receipt." },403);
    // If DAS indexing is still pending, preserve only chain-verified fields.
    const receipt = {
      mint_address:mint,
      transaction_signature:transaction,
      owner_wallet:owner,
      metadata_uri:verifiedUri,
      image_uri:verifiedImage,
      mint_date: typeof tx.blockTime === "number" ? new Date(tx.blockTime * 1000).toISOString() : null,
      nft_name:typeof metadata.name === "string" ? metadata.name : null,
      nft_symbol:typeof metadata.symbol === "string" ? metadata.symbol : null,
      verified_program:mintInfo.owner,
      payment_lamports:mintFeeLamports,
      verified_at:new Date().toISOString(),
    };
    const admin = createClient(supabaseUrl, serviceKey, {
      auth:{persistSession:false,autoRefreshToken:false},
    });
    // Narrow conditional update: never overwrite an already-bound card.
    const {data:saved,error:saveError} = await admin.from("vcard_list")
      .update({mint_address:mint,mint_receipt:receipt})
      .eq("card_id",cardId).is("mint_address",null)
      .select("card_id,mint_address,mint_receipt").maybeSingle();
    if (saveError) {
      if (saveError.code === "23505")
        return json({ error:"This mint is already assigned to a different VCard." },409);
      throw saveError;
    }
    if (!saved)
      return json({ error:"Receipt attachment conflicted with another save. Retry.",retryable:true },409);
    return json({ok:true,cardId:saved.card_id,mintAddress:saved.mint_address,receipt:saved.mint_receipt});
  } catch (error) {
    console.error("[vcard-mint-receipt]",error instanceof Error ? error.message : String(error));
    return json({error:"Unable to verify and save the mint receipt. Retry from the VCard."},503);
  }
});