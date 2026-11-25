/* Award the completed Raid's single level on its existing Token-2022 mint. */
(() => {
  "use strict";
  const RPCS=["https://solana-rpc.publicnode.com","https://rpc.solanatracker.io/public","https://api.mainnet-beta.solana.com"];
  const memoPrefix="VHOUSE:RAID_LEVEL:";
  const pendingKey=id=>"vhouse:raid-level:"+id;
  const readPending=id=>{try{return JSON.parse(localStorage.getItem(pendingKey(id))||"null");}catch{return null;}};
  const savePending=(id,value)=>{try{localStorage.setItem(pendingKey(id),JSON.stringify(value));}catch{}};
  const clearPending=id=>{try{localStorage.removeItem(pendingKey(id));}catch{}};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function gateways(uri){
    const cid=String(uri||"").match(/^ipfs:\/\/(?:ipfs\/)?(.+)$/i)?.[1]||String(uri||"").match(/^https:\/\/[^/]+\/ipfs\/(.+)$/i)?.[1];
    return cid?["https://gateway.pinata.cloud/ipfs/"+cid,"https://ipfs.io/ipfs/"+cid,"https://dweb.link/ipfs/"+cid]:/^https:\/\//i.test(uri||"")?[uri]:[];
  }
  async function readMedia(uri,kind){
    let last;
    for(const url of gateways(uri)){
      try{
        const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
        if(!res.ok)throw Error("IPFS HTTP "+res.status);
        return kind==="json"?await res.json():await res.blob();
      }catch(e){last=e;}
    }
    throw last||Error("VCARD_METADATA_UNAVAILABLE");
  }
  async function upload(client,blob,name,kind){
    const {data,error}=await client.functions.invoke("pinata-signed-upload",{body:{kind}});
    if(error||!data?.url)throw Error("IPFS upload authorization failed");
    const form=new FormData();
    form.append("network","public");
    form.append("file",new File([blob],name,{type:blob.type}));
    form.append("name",name);
    form.append("cid_version","v1");
    const res=await fetch(data.url,{method:"POST",body:form});
    const payload=await res.json();
    if(!res.ok||!payload?.data?.cid)throw Error("VCARD_IPFS_UPLOAD_FAILED");
    return "ipfs://"+payload.data.cid;
  }
  // Preserve the minted PNG, including artwork, effect, name and stats.
  // Only replace the existing LEVEL text in the Creator's dark-blue level band.
  function levelBand(pixels,w,h){
    const dark=(x,y)=>{const i=(y*w+x)*4;return Math.abs(pixels[i]-11)<=3&&Math.abs(pixels[i+1]-19)<=3&&Math.abs(pixels[i+2]-27)<=3&&pixels[i+3]>240;};
    let start=-1,best=null;
    for(let y=Math.floor(h*.35);y<=Math.floor(h*.75);y++){
      const ok=[.48,.60,.72,.84].every(f=>dark(Math.floor(w*f),y));
      if(ok&&start<0)start=y;
      if(!ok&&start>=0){
        const height=y-start;
        if(height>=w*.035&&height<=w*.15&&(!best||height>best.height))best={top:start,bottom:y,height};
        start=-1;
      }
    }
    if(!best)throw Error("VCARD_LEVEL_BAND_NOT_FOUND");
    return best;
  }
  async function levelPNG(uri,level){
    const blob=await readMedia(uri,"blob");
    const bitmap=await createImageBitmap(blob);
    const canvas=document.createElement("canvas");
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(bitmap,0,0);bitmap.close();
    const w=canvas.width,h=canvas.height,pixels=ctx.getImageData(0,0,w,h).data;
    const band=levelBand(pixels,w,h);
    let left=w,right=0,top=h,bottom=0;
    for(let y=band.top;y<band.bottom;y++)for(let x=Math.floor(w*.055);x<Math.floor(w*.47);x++){
      const i=(y*w+x)*4;
      if(pixels[i]>90&&pixels[i+1]>120&&pixels[i+2]>120&&pixels[i+3]>240){
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
      }
    }
    if(right<=left||bottom<=top)throw Error("VCARD_LEVEL_TEXT_NOT_FOUND");
    const pad=Math.max(2,Math.ceil(w*.003));
    const fontSize=Math.round(w*.039);
    ctx.fillStyle="#0b131b";
    ctx.fillRect(Math.max(0,left-pad),band.top,right-left+2*pad+1,band.height);
    ctx.fillStyle="#e0fefe";
    ctx.font="900 "+fontSize+"px Arial, sans-serif";
    ctx.textBaseline="middle";
    ctx.fillText("LEVEL "+level,left,(band.top+band.bottom)/2);
    return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("VCARD_PNG_FAILED")),"image/png"));
  }
  async function chainSDK(){
    const [web3,token,metadata]=await Promise.all([import("@solana/web3.js"),import("@solana/spl-token"),import("@solana/spl-token-metadata")]);
    return {...web3,...token,...metadata};
  }
  async function connection(sdk,mint){
    for(const endpoint of RPCS){
      try{
        const rpc=new sdk.Connection(endpoint,"confirmed");
        const info=await rpc.getAccountInfo(mint,"confirmed");
        if(info&&info.owner.equals(sdk.TOKEN_2022_PROGRAM_ID)){
          const meta=await sdk.getTokenMetadata(rpc,mint,"confirmed",sdk.TOKEN_2022_PROGRAM_ID);
          if(meta)return {rpc,info,meta};
        }
      }catch{}
    }
    throw Error("VCARD_MINT_UNAVAILABLE");
  }
  const fieldLevel=meta=>Number((meta.additionalMetadata||[]).find(([key])=>String(key).toLowerCase()==="level")?.[1]);
  async function record(client,raidId,mint,owner,pending){
    let last;
    for(let i=0;i<4;i++){
      const {data,error}=await client.functions.invoke("vcard-market-data",{body:{
        action:"record_edit",mode:"raid",raidId,mintAddress:mint,ownerWallet:owner,
        signature:pending.signature,level:pending.level
      }});
      if(!error&&!data?.error&&Number(data?.level)>=2)return data;
      last=data?.error||error?.message||"RAID_LEVEL_SAVE_FAILED";
      if(error?.context?.json)try{last=(await error.context.json())?.error||last;}catch{}
      if(i<3)await pause(1800);
    }
    throw Error(last);
  }
  async function findExisting(rpc,mint,raidId){
    const list=await rpc.getSignaturesForAddress(mint,{limit:100},"confirmed");
    const match=list.find(r=>!r.err&&String(r.memo||"").includes(memoPrefix+raidId));
    if(!match)return null;
    const tx=await rpc.getParsedTransaction(match.signature,{commitment:"confirmed",maxSupportedTransactionVersion:0});
    const instructions=tx?.transaction?.message?.instructions||[];
    const field=instructions.find(i=>i.parsed?.type==="updateTokenMetadataField"&&String(i.parsed?.info?.field).toLowerCase()==="level");
    if(!tx?.meta||tx.meta.err||!field)return null;
    return {signature:match.signature,level:Number(field.parsed.info.value)};
  }
  async function award(raid,client,onStatus){
    const id=raid.id;
    const {data:receipt,error}=await client.from("vhouse_raid_records").select("card_id,card_snapshot,status").eq("id",id).maybeSingle();
    if(error)throw error;
    if(receipt?.card_snapshot?.levelAward?.level){clearPending(id);return receipt.card_snapshot.levelAward;}
    const {data:card,error:cardError}=await client.from("vcard_list").select("mint_address,mint_receipt").eq("card_id",receipt?.card_id||raid.card.id).maybeSingle();
    if(cardError)throw cardError;
    const address=card?.mint_address||raid.card.mint_address;
    if(!address)throw Error("VCARD_MINT_NOT_FOUND");
    const sdk=await chainSDK();
    const mint=new sdk.PublicKey(address);
    const {rpc,info,meta}=await connection(sdk,mint);
    const owner=meta.updateAuthority?.toBase58();
    if(!owner)throw Error("VCARD_METADATA_AUTHORITY_NOT_FOUND");
    let pending=readPending(id);
    if(!pending?.signature){
      try{pending=await findExisting(rpc,mint,id);}catch{}
    }
    if(!pending?.signature){
      const previous=fieldLevel(meta);
      if(!Number.isSafeInteger(previous)||previous<1)throw Error("VCARD_LEVEL_NOT_FOUND");
      const level=previous+1;
      const phantom=window.phantom?.solana||window.solana;
      if(!phantom?.isPhantom||!phantom?.signAndSendTransaction)throw Error("Connect Phantom for the VCard level update.");
      const wallet=(await phantom.connect()).publicKey;
      if(wallet.toBase58()!==owner)throw Error("Connect the wallet that owns this VCard.");
      onStatus("PREPARING LEVEL "+previous+" → "+level);
      const old=await readMedia(meta.uri,"json");
      const png=await levelPNG(old.image,level);
      const imageURI=await upload(client,png,"vcard.png","image");
      const attributes=(Array.isArray(old.attributes)?old.attributes:[]).filter(a=>String(a?.trait_type).toLowerCase()!=="level");
      attributes.push({trait_type:"Level",value:level});
      const json={...old,image:imageURI,attributes,properties:{...old.properties,
        files:(Array.isArray(old.properties?.files)?old.properties.files:[]).map(f=>f.uri===old.image?{...f,uri:imageURI}:f),
        vhouse:{...old.properties?.vhouse,level}}};
      if(!json.properties.files.some(f=>f.uri===imageURI))json.properties.files.push({uri:imageURI,type:"image/png"});
      const uri="https://gateway.pinata.cloud/ipfs/"+(await upload(client,new Blob([JSON.stringify(json)],{type:"application/json"}),"metadata.json","metadata")).slice(7);
      const pairs=(meta.additionalMetadata||[]).map(([key,value])=>[key,String(key).toLowerCase()==="level"?String(level):value]);
      const updated={...meta,uri,additionalMetadata:pairs};
      const space=info.data.length+Math.max(0,sdk.pack(updated).length-sdk.pack(meta).length);
      const rent=Math.max(0,await rpc.getMinimumBalanceForRentExemption(space)-info.lamports);
      const tx=new sdk.Transaction();
      if(rent)tx.add(sdk.SystemProgram.transfer({fromPubkey:wallet,toPubkey:mint,lamports:rent}));
      tx.add(sdk.createUpdateFieldInstruction({programId:sdk.TOKEN_2022_PROGRAM_ID,metadata:mint,updateAuthority:wallet,field:sdk.Field.Uri,value:uri}));
      tx.add(sdk.createUpdateFieldInstruction({programId:sdk.TOKEN_2022_PROGRAM_ID,metadata:mint,updateAuthority:wallet,field:pairs.find(([key])=>String(key).toLowerCase()==="level")[0],value:String(level)}));
      tx.add(new sdk.TransactionInstruction({programId:new sdk.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),keys:[],data:new TextEncoder().encode(memoPrefix+id)}));
      const recent=await rpc.getLatestBlockhash("confirmed");
      tx.feePayer=wallet;tx.recentBlockhash=recent.blockhash;
      onStatus("APPROVE VCARD LEVEL UP IN PHANTOM · NO RAID SERVICE FEE");
      const signed=await phantom.signAndSendTransaction(tx,{skipPreflight:false,preflightCommitment:"confirmed"});
      const signature=typeof signed==="string"?signed:signed?.signature;
      if(!signature)throw Error("VCARD_LEVEL_SIGNATURE_MISSING");
      pending={signature,level};
      savePending(id,pending);
    }
    onStatus("SAVING VCARD LEVEL "+pending.level,pending.signature);
    const result=await record(client,id,address,owner,pending);
    clearPending(id);
    return result;
  }
  window.VHouseRaidLevel={award,levelBand,readPending};
})();
