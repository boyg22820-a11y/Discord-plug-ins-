// Collection model. No Discord, network, native UI, or filesystem dependencies.
export const RELEASE = '0.3.0';
export const LIMITS = { items: 2000, batch: 10, groups: 200, chats: 500, undo: 20, readBytes: 20 * 1024 * 1024 };
export const clone = value => JSON.parse(JSON.stringify(value));
export const text = (value, max=100) => typeof value === 'string' ? value.trim().slice(0,max) : '';
export const safeId = value => typeof value === 'string' && !['__proto__','prototype','constructor'].includes(value) && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export const localURI = value => typeof value === 'string' && /^(file|content):\/\//.test(value) && value.length < 4096;
export const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const nonnegative=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isFinite(Number(value))?Math.min(max,Math.max(0,Number(value))):0;
export function uniqueTags(value) { return [...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(v=>text(v,40)).filter(Boolean))].slice(0,30); }
export function createModel(storage, {now=Date.now, makeId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}={}) {
  const listeners = new Set();
  let undo = [];
  let db;
  const defaultView = {folder:'',tag:'',batch:'',query:'',favorites:false,recent:false,kind:'all',sort:'newest',offset:0,anchor:'',lastBatch:''};
  function normalizeItem(p) {
    if (!p || !safeId(p.id)) return null;
    const mime = text(p.mimeType,80);
    if (!/^(image|video)\/[a-zA-Z0-9.+-]+$/.test(mime)) return null;
    return {id:p.id,filename:text(p.filename,200)||'media',mimeType:mime,kind:mime.startsWith('video/')?'video':'image',
      uri:localURI(p.uri)?p.uri:'',managedPath:typeof p.managedPath==='string'&&/^better-media-picker\/(photos|media)\/[a-z0-9_-]+\.[a-z0-9]{1,6}$/.test(p.managedPath)?p.managedPath:'',
      width:nonnegative(p.width,100000),height:nonnegative(p.height,100000),duration:nonnegative(p.duration,1e9),
      fileSize:nonnegative(p.fileSize),addedAt:nonnegative(p.addedAt)||now(),favorite:!!p.favorite,
      folder:safeId(p.folder)?p.folder:'',tags:uniqueTags(p.tags),hash:validHash(p.hash)?p.hash:'',
      lastUsed:nonnegative(p.lastUsed),useCount:nonnegative(p.useCount),missing:!!p.missing,
      thumb:localURI(p.thumb)?p.thumb:'',sourceKey:localURI(p.sourceKey)?p.sourceKey:''};
  }
  function init() {
    const old=storage.quickPhotos;
    const input=storage.collectionV3;
    db={schema:3,items:[],folders:[],batches:[],chats:{},sent:{},restores:{},trash:[],prefs:{columns:[3,4,5,6].includes(storage.columns)?storage.columns:4,instant:storage.instant!==false,plus:true}};
    if(input && input.schema===3) {
      db.items=(Array.isArray(input.items)?input.items:[]).slice(0,LIMITS.items).map(normalizeItem).filter(Boolean);
      db.folders=(Array.isArray(input.folders)?input.folders:[]).filter(g=>safeId(g.id)&&text(g.name)).slice(0,LIMITS.groups).map(g=>({id:g.id,name:text(g.name),pinned:!!g.pinned}));
      db.batches=(Array.isArray(input.batches)?input.batches:[]).filter(g=>safeId(g.id)&&text(g.name)).slice(0,LIMITS.groups).map(g=>({id:g.id,name:text(g.name),pinned:!!g.pinned,ids:[...new Set((Array.isArray(g.ids)?g.ids:[]).filter(id=>db.items.some(p=>p.id===id)))].slice(0,LIMITS.batch)}));
      db.prefs={...db.prefs,...input.prefs};
      for(const [id,v] of Object.entries(input.chats||{}).slice(-LIMITS.chats)) if(/^\d{1,25}$/.test(id)) db.chats[id]={...defaultView,...cleanView(v),touched:Number(v.touched)||0};
      for(const [id,records] of Object.entries(input.sent||{}).slice(-LIMITS.chats)) if(/^\d{1,25}$/.test(id)) db.sent[id]=cleanSent(records);
      db.restores=input.restores&&typeof input.restores==='object'?clone(input.restores):{};
      db.trash=(Array.isArray(input.trash)?input.trash:[]).map(normalizeItem).filter(Boolean);
    } else {
      db.items=(Array.isArray(old)?old:[]).map(p=>normalizeItem({...p,mimeType:p.mimeType||'image/jpeg'})).filter(Boolean).slice(0,LIMITS.items);
      // Keep the old metadata untouched as a migration recovery point.
      db.prefs.plus=true;
    }
    db.prefs.columns=[3,4,5,6].includes(db.prefs.columns)?db.prefs.columns:4;
    db.prefs.instant=db.prefs.instant!==false;db.prefs.plus=db.prefs.plus!==false;
    persist();
  }
  function cleanView(v={}) {return {folder:safeId(v.folder)?v.folder:'',batch:safeId(v.batch)?v.batch:'',tag:text(v.tag,40),query:text(v.query,200),favorites:!!v.favorites,recent:!!v.recent,kind:['all','image','video'].includes(v.kind)?v.kind:'all',sort:['newest','oldest','filename','used'].includes(v.sort)?v.sort:'newest',offset:Math.max(0,Math.min(1e7,Number(v.offset)||0)),anchor:safeId(v.anchor)?v.anchor:'',lastBatch:safeId(v.lastBatch)?v.lastBatch:''};}
  function cleanSent(records) { const out={};for(const [key,v] of Object.entries(records||{}).slice(-LIMITS.items*2))if((safeId(key)||validHash(key))&&v&&/^\d{1,25}$/.test(String(v.messageId)))out[key]={at:Number(v.at)||0,messageId:String(v.messageId),count:Math.max(1,Number(v.count)||1)};return out; }
  function persist(notify=true) {storage.collectionV3=clone(db);if(notify)for(const fn of listeners)fn();}
  function snapshot() {return clone(db);}
  function commit(label, fn) {const prev=clone({items:db.items,folders:db.folders,batches:db.batches,trash:db.trash});fn();undo.push({label,prev});if(undo.length>LIMITS.undo)undo.shift();persist();}
  const get=id=>db.items.find(p=>p.id===id);
  function updateItem(id,patch) {const p=get(id);if(!p)return;Object.assign(p,patch);persist();}
  function add(item,destination={}) {
    let p=normalizeItem(item);if(!p)throw Error('Unsupported media item.');
    const duplicate=db.items.find(x=>p.hash&&x.hash===p.hash);
    if(duplicate){applyOrganization([duplicate.id],destination,false);return {item:clone(duplicate),duplicate:true};}
    if(db.items.length>=LIMITS.items)throw Error('Collection full. Remove items first.');
    if(get(p.id))p.id=makeId();p.folder=destination.folder&&db.folders.some(f=>f.id===destination.folder)?destination.folder:p.folder;p.tags=uniqueTags([...p.tags,...uniqueTags(destination.tags)]);
    db.items.push(p);
    if(destination.batch){const b=db.batches.find(b=>b.id===destination.batch);if(b&&b.ids.length<LIMITS.batch)b.ids.push(p.id);}
    persist();return {item:clone(p),duplicate:false};
  }
  function applyOrganization(ids,change,withUndo=true) {
    const action=()=>{
      for(const id of ids){const p=get(id);if(!p)continue;
        if('folder'in change)p.folder=db.folders.some(f=>f.id===change.folder)?change.folder:'';
        if('tags'in change)p.tags=uniqueTags([...p.tags,...uniqueTags(change.tags)]);
        if('favorite'in change)p.favorite=!!change.favorite;
        if(change.clearTags)p.tags=[];
      }
      if(change.batch){const b=db.batches.find(b=>b.id===change.batch);if(b){const merged=[...new Set([...b.ids,...ids.filter(get)])];if(merged.length>LIMITS.batch)throw Error('A batch can contain at most 10 items.');b.ids=merged;}}
    };
    // Validate before mutating anything.
    if(change.batch){const b=db.batches.find(b=>b.id===change.batch);if(b&&new Set([...b.ids,...ids.filter(get)]).size>LIMITS.batch)throw Error('A batch can contain at most 10 items.');}
    if(withUndo)commit('Organize items',action);else{action();persist();}
  }
  function createGroup(kind,name,ids=[]) {
    name=text(name);if(!name)throw Error('Enter a name.');
    const list=kind==='folder'?db.folders:db.batches;
    if(list.length>=LIMITS.groups)throw Error('Too many collections.');
    if(kind!=='folder'&&ids.length>LIMITS.batch)throw Error('A batch can contain at most 10 items.');
    const g={id:makeId(),name,pinned:false};if(kind!=='folder')g.ids=[...new Set(ids.filter(get))];
    commit('Create '+kind,()=>list.push(g));return clone(g);
  }
  function editGroup(kind,id,patch) {
    const list=kind==='folder'?db.folders:db.batches;const g=list.find(g=>g.id===id);if(!g)return;
    if(patch.ids&&new Set(patch.ids).size>LIMITS.batch)throw Error('A batch can contain at most 10 items.');
    commit('Edit '+kind,()=>{if(text(patch.name))g.name=text(patch.name);if('pinned'in patch)g.pinned=!!patch.pinned;if(kind==='batch'&&patch.ids)g.ids=[...new Set(patch.ids.filter(get))];});
  }
  function deleteGroup(kind,id) {commit('Remove '+kind,()=>{if(kind==='folder'){db.folders=db.folders.filter(g=>g.id!==id);db.items.forEach(p=>{if(p.folder===id)p.folder='';});}else db.batches=db.batches.filter(g=>g.id!==id);});}
  function remove(ids) {commit('Remove items',()=>{db.trash.push(...db.items.filter(p=>ids.includes(p.id)));db.items=db.items.filter(p=>!ids.includes(p.id));db.batches.forEach(b=>b.ids=b.ids.filter(id=>!ids.includes(id)));});}
  function restoreTrash() {commit('Restore removed items',()=>{for(const p of db.trash){if(!get(p.id)&&db.items.length<LIMITS.items)db.items.push(p);}db.trash=db.trash.filter(p=>!get(p.id));});}
  function mergeDuplicates(ids) {
    const items=ids.map(get).filter(Boolean);if(items.length<2||!items[0].hash||!items.every(p=>p.hash===items[0].hash))throw Error('Only matching content hashes can be merged.');
    const keep=items[0],drop=items.slice(1).map(p=>p.id);
    commit('Merge duplicates',()=>{keep.tags=uniqueTags(items.flatMap(p=>p.tags));keep.favorite=items.some(p=>p.favorite);keep.lastUsed=Math.max(...items.map(p=>p.lastUsed));keep.useCount=Math.max(...items.map(p=>p.useCount));if(!keep.folder)keep.folder=items.find(p=>p.folder)?.folder||'';
      if((!keep.uri||keep.missing)&&items.some(p=>p.uri&&!p.missing)){const good=items.find(p=>p.uri&&!p.missing);keep.uri=good.uri;keep.managedPath=good.managedPath;keep.missing=false;}
      db.trash.push(...items.slice(1).map(p=>p.managedPath===keep.managedPath?{...p,managedPath:''}:p));db.items=db.items.filter(p=>!drop.includes(p.id));db.batches.forEach(b=>b.ids=[...new Set(b.ids.map(id=>drop.includes(id)?keep.id:id))]);
    });return keep.id;
  }
  function undoLast() {const u=undo.pop();if(!u)return false;Object.assign(db,u.prev);persist();return u.label;}
  function trash() {return clone(db.trash.filter(p=>!get(p.id)));}
  function forgetTrash(ids) {db.trash=db.trash.filter(p=>!ids.includes(p.id));undo=[];persist();}
  function view(chat) {return {...defaultView,...(db.chats[chat]||{})};}
  function setView(chat,patch,notify=true) {if(!/^\d{1,25}$/.test(String(chat)))return;const prev=view(chat);db.chats[chat]={...cleanView({...prev,...patch}),touched:now()};if(Object.keys(db.chats).length>LIMITS.chats){const oldest=Object.keys(db.chats).sort((a,b)=>db.chats[a].touched-db.chats[b].touched)[0];delete db.chats[oldest];}persist(notify);}
  function filtered(chat) {const v=view(chat);let list=db.items.filter(p=>(!v.folder||p.folder===v.folder)&&(!v.tag||p.tags.includes(v.tag))&&(!v.favorites||p.favorite)&&(!v.recent||p.lastUsed>0)&&(v.kind==='all'||p.kind===v.kind)&&(!v.query||(p.filename+' '+p.tags.join(' ')).toLowerCase().includes(v.query.toLowerCase())));
    if(v.batch){const b=db.batches.find(b=>b.id===v.batch);list=b?b.ids.map(get).filter(p=>p&&list.some(x=>x.id===p.id)):[];return clone(list);}
    list.sort((a,b)=>v.recent||v.sort==='used'?b.lastUsed-a.lastUsed:v.sort==='filename'?a.filename.localeCompare(b.filename,undefined,{numeric:true}):v.sort==='oldest'?a.addedAt-b.addedAt:b.addedAt-a.addedAt);return clone(list);}
  function used(ids,chat,batch='') {for(const id of ids){const p=get(id);if(p){p.lastUsed=now();p.useCount++;}}if(batch)setView(chat,{lastBatch:batch},false);persist();}
  function recordSent(chat,ids,messageId,at=now()) {if(!/^\d{1,25}$/.test(String(chat))||!/^\d{1,25}$/.test(String(messageId)))return;const records=db.sent[chat]||(db.sent[chat]={});for(const id of ids){const p=get(id);if(!p)continue;for(const key of [p.id,p.hash].filter(Boolean)){const prev=records[key];if(prev?.messageId===String(messageId))continue;records[key]={at,messageId:String(messageId),count:(prev?.count||0)+1};}}persist();}
  function sent(chat,id) {const p=get(id);return p?clone(db.sent[chat]?.[p.hash]||db.sent[chat]?.[id]||null):null;}
  function summary() {return {items:db.items.length,saved:db.items.filter(p=>p.managedPath).length,linked:db.items.filter(p=>!p.managedPath).length,bytes:db.items.filter(p=>p.managedPath).reduce((n,p)=>n+p.fileSize,0),missing:db.items.filter(p=>p.missing||!p.uri).length,trash:trash().length,trashBytes:trash().filter(p=>p.managedPath).reduce((n,p)=>n+p.fileSize,0)};}
  function manifest() {const snap=snapshot();snap.items=snap.items.map(({uri,sourceKey,managedPath,thumb,...p})=>({...p,missing:true}));snap.trash=[];snap.restores={};return snap;}
  function mergeManifest(input,archiveId,total=1) {
    if(!safeId(archiveId)||!input||input.schema!==3||!Array.isArray(input.items)||input.items.length>LIMITS.items)throw Error('Invalid backup manifest.');
    if(!Array.isArray(input.folders)||!Array.isArray(input.batches)||input.folders.length>LIMITS.groups||input.batches.length>LIMITS.groups||input.folders.some(g=>!g||!safeId(g.id)||!text(g.name))||input.batches.some(g=>!g||!safeId(g.id)||!text(g.name)||!Array.isArray(g.ids)||g.ids.length>LIMITS.batch||g.ids.some(id=>!safeId(id))))throw Error('Invalid backup collections.');
    if(new Set(input.items.map(p=>p?.id)).size!==input.items.length||new Set(input.folders.map(g=>g.id)).size!==input.folders.length||new Set(input.batches.map(g=>g.id)).size!==input.batches.length)throw Error('Duplicate backup IDs.');
    let session=db.restores[archiveId];if(session)return clone(session);
    if(db.folders.length+input.folders.filter(g=>!db.folders.some(x=>x.id===g.id&&x.name===g.name)).length>LIMITS.groups||db.batches.length+input.batches.filter(g=>!db.batches.some(x=>x.id===g.id&&x.name===g.name)).length>LIMITS.groups)throw Error('Not enough room for backup collections.');
    const incoming=input.items.map(normalizeItem);if(incoming.some(p=>!p))throw Error('Invalid backup media metadata.');
    if(db.items.length+incoming.filter(p=>!db.items.some(x=>(p.hash&&x.hash===p.hash))).length>LIMITS.items)throw Error('Not enough room to restore this backup.');
    const map={},folders={},batches={};
    for(const g of (input.folders||[]).slice(0,LIMITS.groups)){if(!safeId(g.id)||!text(g.name))continue;let existing=db.folders.find(x=>x.id===g.id&&x.name===g.name);if(!existing){existing={id:db.folders.some(x=>x.id===g.id)?makeId():g.id,name:text(g.name),pinned:!!g.pinned};db.folders.push(existing);}folders[g.id]=existing.id;}
    for(const p of incoming){const existing=db.items.find(x=>(p.hash&&p.hash===x.hash));if(existing){map[p.id]=existing.id;existing.tags=uniqueTags([...existing.tags,...p.tags]);continue;}const id=get(p.id)?makeId():p.id;map[p.id]=id;db.items.push({...p,id,folder:folders[p.folder]||'',uri:'',managedPath:'',sourceKey:'',thumb:'',missing:true});}
    for(const g of (input.batches||[]).slice(0,LIMITS.groups)){if(!safeId(g.id)||!text(g.name))continue;const ids=[...new Set((g.ids||[]).map(id=>map[id]).filter(Boolean))].slice(0,LIMITS.batch);let existing=db.batches.find(x=>x.id===g.id&&x.name===g.name);if(!existing){existing={id:db.batches.some(x=>x.id===g.id)?makeId():g.id,name:text(g.name),ids,pinned:!!g.pinned};db.batches.push(existing);}batches[g.id]=existing.id;}
    for(const [chat,v] of Object.entries(input.chats||{}).slice(-LIMITS.chats)){if(!/^\d{1,25}$/.test(chat)||db.chats[chat])continue;db.chats[chat]={...cleanView(v),folder:folders[v.folder]||'',batch:batches[v.batch]||'',lastBatch:batches[v.lastBatch]||'',anchor:map[v.anchor]||'',touched:now()};}
    for(const [chat,records] of Object.entries(input.sent||{}).slice(-LIMITS.chats)){if(!/^\d{1,25}$/.test(chat))continue;db.sent[chat]||={};for(const [key,v] of Object.entries(cleanSent(records))){const mapped=map[key]||key;if(!db.sent[chat][mapped]||v.at>db.sent[chat][mapped].at)db.sent[chat][mapped]=v;}}
    if(input.prefs){db.prefs.columns=[3,4,5,6].includes(input.prefs.columns)?input.prefs.columns:db.prefs.columns;db.prefs.instant=input.prefs.instant!==false;db.prefs.plus=input.prefs.plus!==false;}
    session={map,parts:[],total,external:(Array.isArray(input.externalAssets)?input.externalAssets:[]).filter(a=>safeId(a.id)&&validHash(a.hash)&&Number.isInteger(a.part)&&a.part>0&&a.part<=input.items.length).map(a=>({id:map[a.id],hash:a.hash,part:a.part})).filter(a=>a.id)};db.restores[archiveId]=session;const keys=Object.keys(db.restores);if(keys.length>10)delete db.restores[keys[0]];undo=[];persist();return clone(session);
  }
  function completeRelink(id,hash) {for(const session of Object.values(db.restores)){for(const asset of session.external||[]){if(asset.id===id&&asset.hash===hash&&!session.parts.includes(asset.part))session.parts.push(asset.part);}}persist();}
  function restoredPart(archive,id) {const s=db.restores[archive];if(s&&!s.parts.includes(id)){s.parts.push(id);persist();}}
  init();
  return {subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},snapshot,get:id=>{const p=get(id);return p?clone(p):null;},items:()=>clone(db.items),add,updateItem,applyOrganization,createGroup,editGroup,deleteGroup,remove,restoreTrash,mergeDuplicates,undoLast,canUndo:()=>undo.length>0,trash,forgetTrash,view,setView,filtered,used,recordSent,sent,summary,manifest,mergeManifest,restoredPart,completeRelink,
    preferences:()=>clone(db.prefs),setPreferences:p=>{Object.assign(db.prefs,p);persist();},makeId,
    groups:kind=>clone(kind==='folder'?db.folders:db.batches).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||a.name.localeCompare(b.name)),
    tags:()=>[...new Set(db.items.flatMap(p=>p.tags))].sort(),
    duplicates:()=>{const groups={};db.items.forEach(p=>{if(p.hash)(groups[p.hash]||=[]).push(p.id);});return Object.values(groups).filter(ids=>ids.length>1);}};
}

// Incremental SHA-256. Base64 decoding is chunked, avoiding a second full byte array.
export function newSha256() {
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];let buffer=[],length=0,finished=false;
  const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  function block(bytes){const w=new Int32Array(64);for(let i=0;i<16;i++)w[i]=(bytes[i*4]<<24)|(bytes[i*4+1]<<16)|(bytes[i*4+2]<<8)|bytes[i*4+3];for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]+(rotr(y,17)^rotr(y,19)^(y>>>10)))|0;}let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])|0;const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}[a,b,c,d,e,f,g,h].forEach((x,i)=>H[i]=(H[i]+x)|0);}
  return {update(bytes){if(finished)throw Error('Hash already finalized');length+=bytes.length;for(const byte of bytes){buffer.push(byte);if(buffer.length===64){block(buffer);buffer=[];}}},digest(){if(finished)throw Error('Hash already finalized');finished=true;const bits=length*8;buffer.push(128);while(buffer.length%64!==56)buffer.push(0);const hi=Math.floor(bits/0x100000000),lo=bits>>>0;for(const n of [hi,lo])buffer.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);for(let i=0;i<buffer.length;i+=64)block(buffer.slice(i,i+64));return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');}};
}
export function validBase64(s,max=LIMITS.readBytes) {return typeof s==='string'&&s.length<=Math.ceil(max/3)*4&&s.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(s);}
export async function hashBase64(s, yieldFn=()=>Promise.resolve()) {
  if(!validBase64(s))throw Error('Invalid or oversized media data.');
  const table='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',hasher=newSha256();
  for(let offset=0;offset<s.length;offset+=32768){const bytes=[];const chunk=s.slice(offset,offset+32768);for(let i=0;i<chunk.length;i+=4){const a=table.indexOf(chunk[i]),b=table.indexOf(chunk[i+1]),c=table.indexOf(chunk[i+2]),d=table.indexOf(chunk[i+3]);bytes.push((a<<2)|(b>>4));if(c>=0)bytes.push(((b&15)<<4)|(c>>2));if(d>=0)bytes.push(((c&3)<<6)|d);}hasher.update(bytes);await yieldFn();}return hasher.digest();
}
