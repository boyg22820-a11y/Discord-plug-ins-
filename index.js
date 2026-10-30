(() => {
"use strict";
// Collection model. No Discord, network, native UI, or filesystem dependencies.
const RELEASE = '0.3.0';
const LIMITS = { items: 2000, batch: 10, groups: 200, chats: 500, undo: 20, readBytes: 20 * 1024 * 1024 };
const clone = value => JSON.parse(JSON.stringify(value));
const text = (value, max=100) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const safeId = value => typeof value === 'string' && !['__proto__','prototype','constructor'].includes(value) && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const localURI = value => typeof value === 'string' && /^(file|content):\/\//.test(value) && value.length < 4096;
const validHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nonnegative=(value,max=Number.MAX_SAFE_INTEGER)=>Number.isFinite(Number(value))?Math.min(max,Math.max(0,Number(value))):0;
function uniqueTags(value) { return [...new Set((Array.isArray(value)?value:String(value||'').split(',')).map(v=>text(v,40)).filter(Boolean))].slice(0,30); }
function createModel(storage, {now=Date.now, makeId=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12)}={}) {
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
function newSha256() {
  const K=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];let buffer=[],length=0,finished=false;
  const rotr=(x,n)=>(x>>>n)|(x<<(32-n));
  function block(bytes){const w=new Int32Array(64);for(let i=0;i<16;i++)w[i]=(bytes[i*4]<<24)|(bytes[i*4+1]<<16)|(bytes[i*4+2]<<8)|bytes[i*4+3];for(let i=16;i<64;i++){const x=w[i-15],y=w[i-2];w[i]=(w[i-16]+(rotr(x,7)^rotr(x,18)^(x>>>3))+w[i-7]+(rotr(y,17)^rotr(y,19)^(y>>>10)))|0;}let [a,b,c,d,e,f,g,h]=H;for(let i=0;i<64;i++){const t1=(h+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+K[i]+w[i])|0;const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))|0;h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0;}[a,b,c,d,e,f,g,h].forEach((x,i)=>H[i]=(H[i]+x)|0);}
  return {update(bytes){if(finished)throw Error('Hash already finalized');length+=bytes.length;for(const byte of bytes){buffer.push(byte);if(buffer.length===64){block(buffer);buffer=[];}}},digest(){if(finished)throw Error('Hash already finalized');finished=true;const bits=length*8;buffer.push(128);while(buffer.length%64!==56)buffer.push(0);const hi=Math.floor(bits/0x100000000),lo=bits>>>0;for(const n of [hi,lo])buffer.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255);for(let i=0;i<buffer.length;i+=64)block(buffer.slice(i,i+64));return H.map(n=>(n>>>0).toString(16).padStart(8,'0')).join('');}};
}
function validBase64(s,max=LIMITS.readBytes) {return typeof s==='string'&&s.length<=Math.ceil(max/3)*4&&s.length%4===0&&/^[A-Za-z0-9+/]*={0,2}$/.test(s);}
async function hashBase64(s, yieldFn=()=>Promise.resolve()) {
  if(!validBase64(s))throw Error('Invalid or oversized media data.');
  const table='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',hasher=newSha256();
  for(let offset=0;offset<s.length;offset+=32768){const bytes=[];const chunk=s.slice(offset,offset+32768);for(let i=0;i<chunk.length;i+=4){const a=table.indexOf(chunk[i]),b=table.indexOf(chunk[i+1]),c=table.indexOf(chunk[i+2]),d=table.indexOf(chunk[i+3]);bytes.push((a<<2)|(b>>4));if(c>=0)bytes.push(((b&15)<<4)|(c>>2));if(d>=0)bytes.push(((c&3)<<6)|d);}hasher.update(bytes);await yieldFn();}return hasher.digest();
}

// Kettu adapter. Unknown client interfaces fail closed and expose a capability status.
function createPlatform(vendetta, model) {
  const metro=vendetta.metro,RN=metro.common.ReactNative;
  const safe=fn=>{try{return fn();}catch(_){return null;}};
  const find=(...props)=>safe(()=>metro.findByProps(...props));
  const store=name=>safe(()=>metro.findByStoreName(name));
  const cleanups=[],pendingPicks=new Set(),pendingItems=new Map(),pendingNonces=new Map();
  const caps={files:false,plus:false,tracking:false,share:false,documents:false,hash:false};
  let active=false,epoch=0,busy=false,open=null,canOpen=()=>false,closeUI=()=>{},menuBypass=false,retryTimer=null;
  const menus=new Map();
  const sleep=()=>new Promise(resolve=>setTimeout(resolve,0));
  const currentChannel=()=>safe(()=>store('SelectedChannelStore').getChannelId());
  const currentUser=()=>safe(()=>store('UserStore').getCurrentUser().id);
  function native(...names){for(const name of names){const n=safe(()=>RN.NativeModules?.[name])||safe(()=>globalThis.__turboModuleProxy?.(name));if(n)return n;}return null;}
  function files(){const fm=native('NativeFileModule','RTNFileManager','DCDFileManager')||find('readFile','writeFile','getConstants');return fm&&typeof fm.readFile==='function'&&typeof fm.writeFile==='function'?fm:null;}
  const own=(o,k)=>{try{const d=Object.getOwnPropertyDescriptor(o,k);return d?.value;}catch(_){return undefined;}};
  function loaded(key){const ms=metro.modules;for(const id of Object.keys(ms||{})){const m=own(ms,id);if(!own(m,'isInitialized')||own(m,'hasError'))continue;const exp=own(own(m,'publicModule'),'exports');for(const c of [exp,own(exp,'default')]){if(!c||!Object.prototype.hasOwnProperty.call(c,key))continue;if(typeof safe(()=>c[key])==='function')return c;}}return null;}
  const moduleFor=key=>loaded(key)||find(key);
  const managed=path=>typeof path==='string'&&/^better-media-picker\/(photos|media|backups)\/[a-z0-9_-]+\.[a-z0-9.]{1,15}$/.test(path);
  const absolute=uri=>uri.startsWith('file://')?decodeURI(uri.slice(7)):uri;
  function docsPath(rel){const root=files()?.getConstants?.().DocumentsDirPath;if(typeof root!=='string'||!root.startsWith('/'))throw Error('Private file storage is unavailable.');return root.replace(/\/$/,'')+'/'+rel;}
  async function discard(path){if(!managed(path))return false;const fm=files();if(!fm?.removeFile)return false;try{await fm.removeFile('documents',path);return fm.fileExists?!(await fm.fileExists(docsPath(path))):false;}catch(_){return false;}}
  async function readData(item) {
    if(!localURI(item.uri)||!item.fileSize||item.fileSize>LIMITS.readBytes)throw Error('This file cannot be read within the 20 MiB per-file memory limit.');
    const fm=files();if(!fm)throw Error('The native file interface is unavailable.');
    const data=await fm.readFile(absolute(item.uri),'base64');if(!data||!validBase64(data))throw Error('Unreadable or oversized media data.');return data;
  }
  async function contentHash(item,data) {
    const fm=files();if(fm&&typeof fm.getFileHash==='function'){
      try{const hash=String(await fm.getFileHash(item.uri,'sha256',4096)).toLowerCase();if(validHash(hash)){caps.hash=true;return hash;}}catch(_){}
    }
    try{const hash=await hashBase64(data===undefined?await readData(item):data,sleep);caps.hash=true;return hash;}catch(_){return '';}
  }
  const ext=item=>({'image/png':'png','image/gif':'gif','image/webp':'webp','image/heic':'heic','image/heif':'heif','image/avif':'avif','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','video/x-matroska':'mkv','video/3gpp':'3gp'}[item.mimeType]||(item.kind==='video'?'mp4':'jpg'));
  async function saveCopy(item,data) {
    const fm=files();if(!fm)return {...item,managedPath:''};
    const path='better-media-picker/media/'+model.makeId()+'.'+ext(item);
    try {
      const full=docsPath(path);
      const bytes=data===undefined?await readData(item):data;if(!validBase64(bytes))throw Error('Invalid media data');
      await fm.writeFile('documents',path,bytes,'base64');
      if(fm.fileExists&&!(await fm.fileExists(full)))throw Error('Write did not create a file');
      return {...item,uri:'file://'+full,managedPath:path,missing:false};
    }catch(_){await discard(path);return {...item,managedPath:''};}
  }
  function normalizeAsset(asset,index) {
    if(!asset||!localURI(asset.uri))return null;
    const name=text(asset.fileName||asset.name,200)||'media-'+(index+1);
    let mime=text(asset.type,80);
    if(!mime){const extension=name.split('.').pop().toLowerCase();mime=({mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',png:'image/png',gif:'image/gif',webp:'image/webp',jpg:'image/jpeg',jpeg:'image/jpeg'})[extension]||'image/jpeg';}
    if(!/^(image|video)\/[\w.+-]+$/.test(mime))return null;
    return {id:model.makeId(),uri:asset.uri,filename:name,mimeType:mime,kind:mime.startsWith('video/')?'video':'image',width:Number(asset.width)||0,height:Number(asset.height)||0,duration:Number(asset.duration)||0,fileSize:Number(asset.fileSize||asset.size)||0,addedAt:Date.now()+index,favorite:false,tags:[],folder:'',sourceKey:asset.uri};
  }
  function pickMedia() {
    const api=moduleFor('launchImageLibrary');if(!api)throw Error('Android media picker unavailable.');
    return new Promise((resolve,reject)=>{let done=false;const cancel=()=>finish({didCancel:true});const finish=value=>{if(done)return;done=true;pendingPicks.delete(cancel);resolve(value||{didCancel:true});};pendingPicks.add(cancel);
      try{const result=api.launchImageLibrary({mediaType:'mixed',selectionLimit:100,includeExtra:false},finish);if(result?.then)result.then(finish,()=>{if(!done){done=true;pendingPicks.delete(cancel);reject(Error('Media picker failed.'));}});}catch(_){done=true;pendingPicks.delete(cancel);reject(Error('Media picker could not open.'));}
    });
  }
  async function importMedia(destination={},progress=()=>{}) {
    if(busy)throw Error('Another file operation is running.');busy=true;const token=epoch;
    const report={added:0,duplicates:0,repaired:0,saved:0,linked:0,unchecked:0,skipped:0};
    try {
      const response=await pickMedia();if(!active||token!==epoch||response.didCancel)return {...report,cancelled:true};
      if(response.errorCode||!Array.isArray(response.assets))throw Error('Android did not return usable media.');
      for(const [index,asset] of response.assets.slice(0,100).entries()){
        if(!active||token!==epoch)break;
        let item=normalizeAsset(asset,index);if(!item){report.skipped++;continue;}
        let data;try{data=await readData(item);}catch(_){}
        if(data!==undefined)item.fileSize=data.length/4*3-(data.endsWith('==')?2:data.endsWith('=')?1:0);
        item.hash=await contentHash(item,data);if(!active||token!==epoch)break;
        const duplicate=model.items().find(p=>(item.hash&&p.hash===item.hash));
        if(duplicate){
          if(duplicate.missing||!duplicate.uri){const repaired=await saveCopy(item,data);if(!active||token!==epoch){if(repaired.managedPath)await discard(repaired.managedPath);break;}model.updateItem(duplicate.id,{uri:repaired.uri,managedPath:repaired.managedPath||'',sourceKey:item.uri,missing:false});model.completeRelink(duplicate.id,item.hash);report.repaired++;}
          else{model.applyOrganization([duplicate.id],destination,false);report.duplicates++;}
          progress(report);continue;
        }
        if(destination.batch&&model.groups('batch').find(b=>b.id===destination.batch)?.ids.length>=LIMITS.batch){report.skipped++;continue;}
        if(model.items().length>=LIMITS.items){report.skipped++;continue;}
        item=await saveCopy(item,data);
        if(!active||token!==epoch){if(item.managedPath)await discard(item.managedPath);break;}
        try{model.add(item,destination);}catch(error){if(item.managedPath)await discard(item.managedPath);throw error;}
        report.added++;if(item.managedPath)report.saved++;else report.linked++;if(!item.hash)report.unchecked++;
        progress(report);await sleep();
      }
      return report;
    }finally{if(token===epoch)busy=false;}
  }
  async function checkFiles(progress=()=>{}) {
    const fm=files();let missing=0,checked=0,unknown=0;
    for(const p of model.items()){
      if(!p.uri){model.updateItem(p.id,{missing:true});missing++;continue;}
      if(!p.uri.startsWith('file://')&&typeof fm?.getSize==='function'){try{const size=await fm.getSize(p.uri);if(typeof size==='number'){model.updateItem(p.id,{missing:size<=0});checked++;if(size<=0)missing++;continue;}}catch(_){model.updateItem(p.id,{missing:true});checked++;missing++;continue;}}
      if(!fm?.fileExists||!p.uri.startsWith('file://')){unknown++;continue;}
      let exists;try{exists=await fm.fileExists(absolute(p.uri));}catch(_){unknown++;continue;}
      model.updateItem(p.id,{missing:!exists});if(!exists)missing++;checked++;progress(checked);await sleep();
    }return {checked,missing,unknown};
  }
  async function repair(id) {
    if(busy)throw Error('Another file operation is running.');busy=true;const token=epoch;
    try{const old=model.get(id);if(!old)throw Error('Item no longer exists.');const response=await pickMedia();if(response.didCancel||!active||token!==epoch)return false;
      if(response.errorCode)throw Error('Media picker returned an error.');
      if(!response.assets||response.assets.length!==1)throw Error('Choose exactly one replacement file.');
      let replacement=normalizeAsset(response.assets[0],0);if(!replacement)throw Error('Unsupported media.');
      let data;try{data=await readData(replacement);}catch(_){}
      replacement.hash=await contentHash(replacement,data);
      if(old.hash&&replacement.hash!==old.hash)throw Error('The selected file does not match the original content hash.');
      if(!active||token!==epoch)return false;
      replacement=await saveCopy(replacement,data);
      if(!active||token!==epoch){if(replacement.managedPath)await discard(replacement.managedPath);return false;}
      model.completeRelink(id,replacement.hash);model.updateItem(id,{...replacement,id,folder:old.folder,tags:old.tags,favorite:old.favorite,addedAt:old.addedAt,lastUsed:old.lastUsed,useCount:old.useCount,missing:false});
      if(old.managedPath&&old.managedPath!==replacement.managedPath)await discard(old.managedPath);return true;
    }finally{if(token===epoch)busy=false;}
  }
  async function auditHashes(progress=()=>{}) {let hashed=0,unchecked=0;for(const item of model.items()){if(!active)break;if(!item.hash){const hash=await contentHash(item);if(!active)break;if(hash){model.updateItem(item.id,{hash});hashed++;}else unchecked++;}progress({hashed,unchecked});await sleep();}return {hashed,unchecked,groups:model.duplicates()};}
  async function emptyTrash() {let cleared=0,failed=0;for(const item of model.trash()){if(item.managedPath&&!(await discard(item.managedPath))){failed++;continue;}model.forgetTrash([item.id]);cleared++;}return {cleared,failed};}
  async function attach(ids,channelId,batch='') {
    if(!active||!vendetta.plugin.storage.enabled)throw Error('Plugin is disabled.');
    if(!channelId||currentChannel()!==channelId)throw Error('Return to the chat where you opened Quick Media.');
    const items=ids.map(id=>model.get(id)).filter(Boolean);if(!items.length)return;
    const api=find('handleAttachFile','handleSelectKeyboardItem');if(!api)throw Error('Attachment interface unavailable.');
    const uploads=store('UploadAttachmentStore');let existing=0;
    if(typeof uploads?.getUploads==='function'){const list=safe(()=>uploads.getUploads(channelId,0));if(Array.isArray(list))existing=list.length;}
    if(items.length>LIMITS.batch-existing)throw Error(`Only ${Math.max(0,LIMITS.batch-existing)} attachment slots remain. Remove composer attachments first.`);
    const fm=files();
    for(const item of items){if(item.missing||!localURI(item.uri))throw Error('A selected file needs repair.');if(item.uri.startsWith('file://')&&fm?.fileExists&&!(await fm.fileExists(absolute(item.uri)))){model.updateItem(item.id,{missing:true});throw Error('A selected file is missing. Use Repair.');}}
    if(!active||currentChannel()!==channelId)throw Error('Active chat changed. Open Quick Media again.');
    const attached=[];
    for(const item of items){const uploadId='qp-'+model.makeId();pendingItems.set(uploadId,{itemId:item.id,uri:item.uri,channelId,at:Date.now()});
      try{api.handleSelectKeyboardItem(channelId,{node:{id:uploadId,image:{uri:item.uri,filename:item.filename,mimeType:item.mimeType,width:item.width,height:item.height,playableDuration:item.duration||0},type:item.kind==='video'?'ALAssetTypeVideo':'ALAssetTypePhoto'}},false,api.handleSelectKeyboardItem.length>=5?{target:0}:false,undefined);attached.push(item.id);}
      catch(_){pendingItems.delete(uploadId);if(attached.length)model.used(attached,channelId,batch);throw Error('Some attachments could not be added. Check the composer before retrying.');}}
    model.used(attached,channelId,batch);
    const cutoff=Date.now()-3600000;for(const [key,p] of pendingItems)if(p.at<cutoff)pendingItems.delete(key);
    while(pendingItems.size>500)pendingItems.delete(pendingItems.keys().next().value);
  }
  function observeUpload(options) {
    if(!options||!/^\d{1,25}$/.test(String(options.nonce))||!Array.isArray(options.items))return;
    const ids=[];for(const upload of options.items){const file=upload?.file||upload?._file||upload;for(const [id,p] of pendingItems){if(p.channelId===options.channelId&&(String(file?.id)===id||file?.uri===p.uri||file?.originalUri===p.uri)){ids.push(p.itemId);}}}
    if(ids.length)pendingNonces.set(String(options.nonce),{channelId:options.channelId,ids:[...new Set(ids)],expectedCount:options.items.length,at:Date.now()});
    for(const [nonce,p] of pendingNonces)if(Date.now()-p.at>3600000)pendingNonces.delete(nonce);
    while(pendingNonces.size>200)pendingNonces.delete(pendingNonces.keys().next().value);
  }
  function onMessage(event) {
    const message=event?.message;if(!message||message.author?.id!==currentUser()||event.optimistic||message.optimistic)return;
    const pending=pendingNonces.get(String(message.nonce));if(!pending||message.channel_id!==pending.channelId)return;
    if(!/^\d{17,25}$/.test(String(message.id))||!Array.isArray(message.attachments)||!message.attachments.length)return;
    // Only server attachment URLs and IDs count; local echo/selection/upload success alone never does.
    if(!message.attachments.every(a=>/^\d{17,25}$/.test(String(a.id))&&/^https:\/\/(cdn|media)\.discordapp\.(com|net)\//.test(a.url||'')))return;
    if(message.attachments.length!==pending.expectedCount)return;
    const expected=Object.create(null);for(const id of pending.ids){const name=model.get(id)?.filename;if(!name)return;expected[name]=(expected[name]||0)+1;}
    for(const [name,count] of Object.entries(expected)){if(message.attachments.filter(a=>a.filename===name||a.filename==='SPOILER_'+name).length<count)return;}
    model.recordSent(pending.channelId,pending.ids,message.id,Date.parse(message.timestamp)||Date.now());pendingNonces.delete(String(message.nonce));
  }
  function installIntegrations() {
    if(!caps.plus){const api=moduleFor('showMediaKeyboardActionSheet');const draft=find('DraftType')?.DraftType;const chatDraft=draft?.ChannelMessage??0;
      if(api){try{cleanups.push(vendetta.patcher.instead('showMediaKeyboardActionSheet',api,(args,original)=>{
        const options=args[0],channelId=options?.channel?.id;
        if(options&&channelId===currentChannel()&&options.draftType===chatDraft){menus.set(channelId,()=>original(...args));if(menus.size>20)menus.delete(menus.keys().next().value);
          if(menuBypass){menuBypass=false;return original(...args);}
          if(active&&vendetta.plugin.storage.enabled&&model.preferences().plus&&canOpen()){try{open(channelId);return;}catch(_){}}
        }return original(...args);
      }));caps.plus=true;}catch(_){}}
    }
    if(!caps.tracking){const api=moduleFor('uploadMessageAttachments'),dispatcher=metro.common.FluxDispatcher;
      if(api&&dispatcher?.subscribe&&dispatcher?.unsubscribe&&currentUser()){
        try{const undo=vendetta.patcher.before('uploadMessageAttachments',api,args=>{try{observeUpload(args[0]);}catch(_){}});const handler=event=>safe(()=>onMessage(event));dispatcher.subscribe('MESSAGE_CREATE',handler);cleanups.push(()=>{safe(()=>dispatcher.unsubscribe('MESSAGE_CREATE',handler));safe(undo);});caps.tracking=true;}catch(_){}}
    }
  }
  async function shareFile(uri,name,expectedHash='',fileSize=0) {
    if(expectedHash&&await contentHash({uri,fileSize})!==expectedHash)throw Error('The source media changed or is unavailable. Prepare this backup again.');
    const api=native('NativeShareManagerModule','RTNShareManager','DCDShareManager');
    if(typeof api?.share==='function'){await api.share(null,uri,name,'Quick Media backup',null,()=>{});return;}
    const share=moduleFor('showShareActionSheet');if(share){await share.showShareActionSheet({url:uri,subject:name},'Quick Media backup');return;}
    throw Error('Native file sharing is unavailable on this build. Nothing was exported outside Kettu.');
  }
  async function exportBackup(includeMedia,progress=()=>{}) {
    if(busy)throw Error('Another file operation is running.');busy=true;const token=epoch;const paths=[];
    try {
      const fm=files();if(!fm)throw Error('Private file storage is unavailable.');
      const manifest=model.manifest(),archiveId=model.makeId(),items=model.items();
      manifest.externalAssets=[];
      if(includeMedia){for(let i=0;i<items.length;i++){
        if(!active||token!==epoch)throw Error('Backup cancelled.');
        const item=items[i];if(!item.uri)throw Error('A media file is missing. Repair it before making a full backup.');
        const hash=await contentHash(item);if(!hash)throw Error('A media file cannot be read/hashed on this build. Full backup was not created; use metadata backup plus your originals.');
        if(item.hash&&item.hash!==hash)throw Error('A media file changed since import. Repair it before making a full backup.');
        manifest.items[i].hash=hash;
        if(!item.fileSize||item.fileSize>LIMITS.readBytes)manifest.externalAssets.push({id:item.id,hash,part:i+1});
        progress(i+1,items.length);
      }}
      const first='better-media-picker/backups/'+archiveId+'-0.qpm.json';
      const header={type:'quick-media-backup',version:1,archiveId,part:0,total:includeMedia?items.length+1:1,mode:includeMedia?'full':'metadata',manifest};
      await fm.writeFile('documents',first,JSON.stringify(header),'utf8');paths.push({path:first,uri:'file://'+docsPath(first),name:archiveId+'-0.qpm.json'});
      if(includeMedia){for(let i=0;i<items.length;i++){
        if(!active||token!==epoch)throw Error('Backup cancelled.');
        const item=items[i],hash=manifest.items[i].hash;
        if(manifest.externalAssets.some(a=>a.part===i+1)){
          paths.push({raw:true,path:'',uri:item.uri,name:item.filename,hash,fileSize:item.fileSize,part:i+1});
        }else{
          const data=await readData(item);if(await hashBase64(data,sleep)!==hash)throw Error('A media file changed during backup. Prepare it again.');
          const part={...header,part:i+1,asset:{id:item.id,hash,data}};
          const path='better-media-picker/backups/'+archiveId+'-'+(i+1)+'.qpm.json';await fm.writeFile('documents',path,JSON.stringify(part),'utf8');paths.push({path,uri:'file://'+docsPath(path),name:archiveId+'-'+(i+1)+'.qpm.json'});
        }progress(i+1,items.length);
      }}
      if(!active||token!==epoch)throw Error('Backup cancelled.');
      const archive={archiveId,parts:paths,mode:includeMedia?'full':'metadata'};
      const old=Array.isArray(vendetta.plugin.storage.preparedBackups)?vendetta.plugin.storage.preparedBackups:[];vendetta.plugin.storage.preparedBackups=[...old,archive].slice(-10);return archive;
    }catch(error){for(const p of paths)if(p.path)await discard(p.path);throw error;}finally{if(token===epoch)busy=false;}
  }
  async function restoreDocuments(progress=()=>{}) {
    const api=moduleFor('handleDocumentSelection');if(!api)throw Error('Document picker unavailable. Paste metadata backup JSON instead.');
    const docs=await api.handleDocumentSelection({pickMultiple:true,extensions:['json'],types:['application/json']});if(!Array.isArray(docs))return [];
    let count=0,result={};for(const d of docs){if(!active)throw Error('Restore cancelled.');if(!localURI(d.uri)||!(Number(d.size)>0)||Number(d.size)>32*1024*1024)throw Error('Backup part is unreadable or larger than 32 MiB.');result=await restorePart(await files().readFile(absolute(d.uri),'utf8'));count++;progress(count,docs.length);}return {count,...result};
  }
  async function restorePart(source) {
    const token=epoch;if(!active)throw Error('Plugin is disabled.');
    if(typeof source!=='string'||source.length>32*1024*1024)throw Error('Invalid backup part size.');
    let p;try{p=JSON.parse(source);}catch(_){throw Error('Invalid backup JSON.');}
    if(p?.type!=='quick-media-backup'||p.version!==1||!['metadata','full'].includes(p.mode)||!safeId(p.archiveId)||!Number.isInteger(p.part)||p.part<0||!Number.isInteger(p.total)||p.total<1||p.total>LIMITS.items+1||p.part>=p.total)throw Error('Unsupported backup format.');
    if(!p.manifest||!Array.isArray(p.manifest.items)||p.total!==(p.mode==='full'?p.manifest.items.length+1:1)||!!p.asset!==(p.part>0))throw Error('Inconsistent backup part.');
    if(p.asset&&p.manifest.items[p.part-1]?.id!==p.asset.id)throw Error('Media part is out of alignment with its manifest.');
    let data;if(p.asset){if(!safeId(p.asset.id)||!validBase64(p.asset.data)||!validHash(p.asset.hash))throw Error('Invalid backup media.');if(await hashBase64(p.asset.data,sleep)!==p.asset.hash)throw Error('Backup media checksum failed.');const meta=p.manifest?.items?.find(x=>x.id===p.asset.id);if(!meta||(meta.hash&&meta.hash!==p.asset.hash))throw Error('Backup media does not match its manifest.');data=p.asset.data;}
    if(!active||token!==epoch)throw Error('Restore cancelled.');
    const session=model.mergeManifest(p.manifest,p.archiveId,p.total);
    if(session.parts.includes(p.part))return {skipped:true,remaining:Math.max(0,p.total-session.parts.length)};
    if(p.asset){const id=session.map[p.asset.id],item=model.get(id);if(!item)throw Error('Backup item not found.');if(item.hash&&item.hash!==p.asset.hash)throw Error('Restored media conflicts with the existing content hash.');
      const replacement=await saveCopy({...item,hash:p.asset.hash},data);if(!replacement.managedPath)throw Error('Could not restore media to private storage. This part was not marked restored.');
      if(!active||token!==epoch){await discard(replacement.managedPath);throw Error('Restore cancelled.');}
      const old=model.get(id);model.updateItem(id,{uri:replacement.uri,managedPath:replacement.managedPath,hash:p.asset.hash,missing:false});if(old.managedPath&&old.managedPath!==replacement.managedPath)await discard(old.managedPath);
    }
    model.restoredPart(p.archiveId,p.part);return {remaining:Math.max(0,p.total-session.parts.length-1),metadataOnly:p.mode==='metadata'};
  }
  function start() {
    active=true;epoch++;if(typeof vendetta.plugin.storage.enabled!=='boolean')vendetta.plugin.storage.enabled=true;
    const api=find('handleAttachFile','handleSelectKeyboardItem');if(api){try{cleanups.push(vendetta.patcher.instead('handleAttachFile',api,(args,original)=>{if(!active||!vendetta.plugin.storage.enabled||!canOpen())return original(...args);try{open(currentChannel());}catch(_){return original(...args);}}));caps.files=true;}catch(_){}}
    if(vendetta.commands?.registerCommand){try{const undo=vendetta.commands.registerCommand({name:'quickphotos',description:'Open your Quick Media collection',options:[],execute(_args,ctx){try{open(ctx?.channel?.id);}catch(error){safe(()=>vendetta.ui.toasts.showToast(error.message));}}});if(typeof undo==='function')cleanups.push(undo);}catch(_){}}
    installIntegrations();let attempts=0;retryTimer=setInterval(()=>{if(!active)return;if(caps.plus&&caps.tracking||attempts++>=12){clearInterval(retryTimer);retryTimer=null;return;}installIntegrations();},5000);
  }
  function stop(){active=false;epoch++;busy=false;clearInterval(retryTimer);retryTimer=null;for(const cancel of pendingPicks)cancel();pendingPicks.clear();closeUI();while(cleanups.length)safe(cleanups.pop());pendingItems.clear();pendingNonces.clear();menus.clear();Object.keys(caps).forEach(k=>caps[k]=false);}
  function capabilities(){const fm=files();caps.documents=!!fm;caps.share=typeof native('NativeShareManagerModule','RTNShareManager','DCDShareManager')?.share==='function';return {...caps};}
  return {start,stop,currentChannel,attach,importMedia,repair,checkFiles,auditHashes,emptyTrash,exportBackup,restorePart,restoreDocuments,shareFile,discard,capabilities,
    lastBackup:()=>{const list=vendetta.plugin.storage.preparedBackups;return Array.isArray(list)?list[list.length-1]||null:null;},
    removeBackup:async archive=>{let cleared=0,failed=0;for(const p of archive.parts){if(p.raw||await discard(p.path))cleared++;else failed++;}if(!failed)vendetta.plugin.storage.preparedBackups=(vendetta.plugin.storage.preparedBackups||[]).filter(a=>a.archiveId!==archive.archiveId);return {cleared,failed};},
    setUI:(fn,can,close)=>{open=fn;canOpen=can;closeUI=close;},active:()=>active,installIntegrations,
    normalMenu:chat=>{const fn=menus.get(chat);if(fn&&currentChannel()===chat){fn();return true;}menuBypass=true;return false;},
    canNormalMenu:chat=>menus.has(chat),bypassNext:()=>{menuBypass=true;},
    openVideo:async item=>{if(!RN.Linking?.openURL)throw Error('External video playback unavailable.');try{await RN.Linking.openURL(item.uri);}catch(_){throw Error('This device could not open the video externally. You can still attach it to the composer.');}},
    metadataText:()=>JSON.stringify({type:'quick-media-backup',version:1,archiveId:model.makeId(),part:0,total:1,mode:'metadata',manifest:model.manifest()})};
}

function createUI(vendetta,model,platform) {
  const React=vendetta.metro.common.React,RN=vendetta.metro.common.ReactNative,E=React.createElement;
  let showing=false;const closers=new Set();
  const t=(value,style={})=>E(RN.Text,{style:{color:'#f2f3f5',fontSize:14,...style}},String(value));
  const button=(label,press,selected=false,disabled=false)=>E(RN.TouchableOpacity,{key:label,onPress:press,disabled,accessibilityRole:'button',accessibilityLabel:label,style:{backgroundColor:selected?'#5865f2':'#353840',opacity:disabled?.45:1,paddingVertical:9,paddingHorizontal:11,margin:3,borderRadius:10}},t(label,{fontWeight:'600',textAlign:'center',fontSize:13}));
  const row=(...children)=>E(RN.View,{style:{flexDirection:'row',flexWrap:'wrap',alignItems:'center'}},...children);
  const title=value=>t(value,{fontSize:18,fontWeight:'700',marginVertical:12});
  const hint=value=>t(value,{color:'#aeb2c0',fontSize:12,marginVertical:7});
  const field=(label,value,onChange,multiline=false)=>E(RN.TextInput,{value,onChangeText:onChange,placeholder:label,placeholderTextColor:'#969bab',accessibilityLabel:label,multiline,autoCorrect:false,style:{backgroundColor:'#30333b',color:'#f2f3f5',padding:11,borderRadius:10,marginVertical:7,minHeight:multiline?100:44,textAlignVertical:multiline?'top':'center'}});
  const bytes=n=>n>=1024*1024?(n/1024/1024).toFixed(1)+' MiB':(n/1024).toFixed(1)+' KiB';
  const duration=n=>Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0');
  function useModel(){const [,set]=React.useState(0);React.useEffect(()=>model.subscribe(()=>set(n=>n+1)),[]);}
  function closeAlert(){try{vendetta.metro.findByProps('openLazy','close')?.close();}catch(_){}}
  function Picker({channelId='0',initialPanel='Browse'}) {
    useModel();
    const [panel,setPanel]=React.useState(initialPanel),[selection,setSelection]=React.useState([]),[busy,setBusy]=React.useState(false),[notice,setNotice]=React.useState('');
    const [visible,setVisible]=React.useState(true),[width,setWidth]=React.useState(RN.Dimensions.get('window').width);
    const [name,setName]=React.useState(''),[importTags,setImportTags]=React.useState(''),[importFolder,setImportFolder]=React.useState(model.view(channelId).folder),[importBatch,setImportBatch]=React.useState('');
    const [bulkTags,setBulkTags]=React.useState(''),[bulkFolder,setBulkFolder]=React.useState(''),[bulkBatch,setBulkBatch]=React.useState('');
    const [detail,setDetail]=React.useState(''),[editBatch,setEditBatch]=React.useState(''),[archive,setArchive]=React.useState(platform.lastBackup()),[restoreText,setRestoreText]=React.useState(''),[confirmPurge,setConfirmPurge]=React.useState(false);
    const mounted=React.useRef(true),lock=React.useRef(false),listRef=React.useRef(null),offsetRef=React.useRef(model.view(channelId).offset),anchorRef=React.useRef(model.view(channelId).anchor),restoredKey=React.useRef('');
    const onViewable=React.useRef(({viewableItems})=>{const id=viewableItems.find(x=>x.isViewable)?.item?.id;if(id)anchorRef.current=id;}).current;
    const v=model.view(channelId),prefs=model.preferences(),items=model.filtered(channelId),folders=model.groups('folder'),batches=model.groups('batch');
    const tile=Math.max(32,Math.floor((width-24)/prefs.columns)-4);
    const gridKey=JSON.stringify([prefs.columns,v.folder,v.batch,v.tag,v.favorites,v.recent,v.kind,v.query,v.sort]);
    function close(){model.setView(channelId,{offset:offsetRef.current,anchor:anchorRef.current},false);setVisible(false);showing=false;closeAlert();}
    React.useEffect(()=>{mounted.current=true;closers.add(close);return()=>{mounted.current=false;closers.delete(close);showing=false;};},[]);
    React.useEffect(()=>{offsetRef.current=v.offset;anchorRef.current=v.anchor;restoredKey.current='';},[gridKey]);
    const message=value=>{if(mounted.current)setNotice(value);};
    async function run(action,label='Working…') {if(lock.current)return;lock.current=true;setBusy(true);message(label);try{await action();}catch(error){message(error?.message||'This operation could not finish.');}finally{lock.current=false;if(mounted.current)setBusy(false);}}
    function change(patch){model.setView(channelId,{...patch,offset:0,anchor:''});offsetRef.current=0;anchorRef.current='';}
    function toggle(id,manage=false){setSelection(ids=>ids.includes(id)?ids.filter(x=>x!==id):ids.length<(manage?LIMITS.items:LIMITS.batch)?[...ids,id]:ids);}
    function attach(ids,batch=''){return run(async()=>{await platform.attach(ids,channelId,batch);close();},'Adding to composer…');}
    function safeAction(action){try{action();message('Updated. Undo is available.');}catch(error){message(error.message);}}
    function select(id){if(busy)return;if(prefs.instant)return attach([id]);toggle(id);}
    function groupsChoice(groups,value,setter,empty){return row(button(empty,()=>setter(''),!value,busy),...groups.map(g=>button(g.name,()=>setter(g.id),value===g.id,busy)));}
    const selectedItems=selection.map(id=>model.get(id)).filter(Boolean);
    const restoreResult=r=>`${r.count||1} part(s) processed. ${r.remaining||0} part(s) remaining.`+(r.metadataOnly?' Metadata backup: media files may need repair.':'');
    let content;
    if(panel==='Browse') {
      const activeFolder=folders.find(g=>g.id===v.folder),activeBatch=batches.find(g=>g.id===v.batch),lastBatch=batches.find(g=>g.id===v.lastBatch);
      content=E(RN.View,{style:{flex:1}},
        row(button('All',()=>change({folder:'',batch:'',tag:'',favorites:false,recent:false,kind:'all'}),!v.folder&&!v.batch&&!v.tag&&!v.favorites&&!v.recent,busy),
          button('Recent',()=>change({recent:!v.recent,batch:''}),v.recent,busy),button('Favorites',()=>change({favorites:!v.favorites}),v.favorites,busy),
          button(v.kind==='all'?'Photos + videos':v.kind==='image'?'Photos':'Videos',()=>change({kind:v.kind==='all'?'image':v.kind==='image'?'video':'all'}),v.kind!=='all',busy)),
        E(RN.ScrollView,{horizontal:true,style:{maxHeight:44},showsHorizontalScrollIndicator:false},row(
          ...folders.filter(g=>g.pinned).map(g=>button('📁 '+g.name,()=>change({folder:g.id,batch:''}),v.folder===g.id,busy)),
          ...batches.filter(g=>g.pinned).map(g=>button('Batch: '+g.name,()=>attach(g.ids,g.id),false,busy||!g.ids.length)),
          lastBatch?button('Last batch: '+lastBatch.name,()=>attach(lastBatch.ids,lastBatch.id),false,busy||!lastBatch.ids.length):null)),
        activeFolder||activeBatch||v.tag?hint([activeFolder?.name,activeBatch?'Batch: '+activeBatch.name:'',v.tag?'#'+v.tag:''].filter(Boolean).join(' · ')):null,
        field('Search filenames or tags',v.query,value=>change({query:value})),
        row(button('Add media',()=>{setImportFolder(v.folder);setImportBatch(v.batch);setPanel('Import');},true,busy),
          button(prefs.columns+' columns',()=>model.setPreferences({columns:[3,4,5,6][([3,4,5,6].indexOf(prefs.columns)+1)%4]}),false,busy),
          button(({newest:'Recently added',oldest:'Oldest added',filename:'Filename',used:'Last used'})[v.sort],()=>change({sort:['newest','oldest','filename','used'][(['newest','oldest','filename','used'].indexOf(v.sort)+1)%4]}),false,busy)),
        E(RN.FlatList,{key:gridKey,ref:listRef,data:items,numColumns:prefs.columns,keyExtractor:p=>p.id,style:{flex:1},initialNumToRender:prefs.columns*6,windowSize:5,extraData:[selection,busy],keyboardShouldPersistTaps:'handled',
          onContentSizeChange:()=>{if(restoredKey.current===gridKey)return;restoredKey.current=gridKey;const i=items.findIndex(p=>p.id===v.anchor);const desired=i>=0?Math.floor(i/prefs.columns)*(tile+38):v.offset;if(desired>0)listRef.current?.scrollToOffset?.({offset:desired,animated:false});},
          onScroll:event=>{offsetRef.current=Math.max(0,event.nativeEvent.contentOffset.y);},scrollEventThrottle:100,
          onMomentumScrollEnd:()=>model.setView(channelId,{offset:offsetRef.current,anchor:anchorRef.current},false),
          onScrollEndDrag:()=>model.setView(channelId,{offset:offsetRef.current,anchor:anchorRef.current},false),
          onViewableItemsChanged:onViewable,
          renderItem:({item})=>{const sent=model.sent(channelId,item.id);return E(RN.View,{style:{width:tile,margin:2}},
            E(RN.TouchableOpacity,{onPress:()=>select(item.id),onLongPress:()=>{setDetail(item.id);setPanel('Details');},disabled:busy,accessibilityRole:'button',accessibilityLabel:item.filename,style:{height:tile,backgroundColor:'#353840',borderRadius:8,overflow:'hidden',borderWidth:selection.includes(item.id)?3:0,borderColor:'#7882ff'}},
              item.missing||!item.uri?t('Needs repair',{textAlign:'center',paddingTop:15,fontSize:11}):item.kind==='video'?E(RN.View,{style:{flex:1,justifyContent:'center',alignItems:'center'}},t('▶',{fontSize:26}),t(duration(item.duration),{fontSize:12})):E(RN.Image,{source:{uri:item.uri},resizeMode:'cover',onError:()=>model.updateItem(item.id,{missing:true}),style:{width:'100%',height:'100%'}}),
              sent?E(RN.View,{style:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#202127dd',padding:3}},t('Sent here',{fontSize:10,color:'#9ce2b7'})):null,
              selection.includes(item.id)?t('✓',{position:'absolute',left:4,top:2,backgroundColor:'#5865f2',padding:3}):null),
            E(RN.TouchableOpacity,{onPress:()=>model.applyOrganization([item.id],{favorite:!item.favorite}),disabled:busy,accessibilityRole:'button',accessibilityLabel:item.favorite?'Unfavorite '+item.filename:'Favorite '+item.filename,style:{position:'absolute',right:2,top:2,padding:4,backgroundColor:'#202127cc',borderRadius:8}},t(item.favorite?'★':'☆',{color:'#ffdb78',fontSize:18})),
            E(RN.Text,{numberOfLines:1,style:{color:'#c3c6d0',fontSize:10,marginTop:3}},item.filename),t(item.managedPath?'Saved':item.missing?'Missing':'Linked',{fontSize:10,color:'#9297a8'}));},
          ListEmptyComponent:E(RN.View,{style:{padding:20}},title(model.items().length?'No matching media':'Your Quick Media collection'),hint(model.items().length?'Change the folder, tag or search.':'Add a batch of photos or videos to start. This collection contains media you choose, not an automatic scan of your phone.'))}),
        row(button(prefs.instant?'Tap attaches':'Multi-select',()=>{model.setPreferences({instant:!prefs.instant});setSelection([]);},prefs.instant,busy),
          !prefs.instant?button('Attach '+selection.length,()=>attach(selection),true,busy||!selection.length):null,
          button('Organize '+selection.length,()=>setPanel('Organize'),false,busy)));
    } else if(panel==='Import') {
      content=E(RN.ScrollView,{style:{flex:1}},title('Choose destination before import'),hint('Android opens once to select new media. Saved copies use Kettu storage; linked files may need re-selection later.'),title('Folder'),groupsChoice(folders,importFolder,setImportFolder,'Unfiled'),title('Batch (optional, 10 items max)'),groupsChoice(batches,importBatch,setImportBatch,'No batch'),field('Tags, separated by commas',importTags,setImportTags),
        button('Choose photos and videos',()=>run(async()=>{const r=await platform.importMedia({folder:importFolder,batch:importBatch,tags:uniqueTags(importTags)},p=>message(`Adding ${p.added} · duplicates ${p.duplicates}`));message(r.cancelled?'Import cancelled.':`${r.added} added · ${r.duplicates} duplicates skipped · ${r.repaired} reconnected · ${r.saved} saved · ${r.linked} linked · ${r.unchecked} not hash-checked · ${r.skipped} skipped.`);setPanel('Browse');},'Opening Android picker…'),true,busy),hint('If a batch fills up, remaining files are skipped. Recently added refers to import time, not original capture time.'));
    } else if(panel==='Collections') {
      const editing=batches.find(g=>g.id===editBatch);
      content=E(RN.ScrollView,{style:{flex:1}},field('Collection name (create or rename)',name,setName),row(button('New folder',()=>safeAction(()=>{model.createGroup('folder',name);setName('');}),true,busy),button('New batch from selection',()=>safeAction(()=>{const b=model.createGroup('batch',name,selection);setEditBatch(b.id);setName('');}),false,busy)),
        title('Folders'),...folders.map(g=>E(RN.View,{key:g.id,style:{backgroundColor:'#292c34',padding:8,marginVertical:3,borderRadius:10}},t((g.pinned?'★ ':'')+g.name),row(button('Open '+g.name,()=>{change({folder:g.id,batch:''});setPanel('Browse');},false,busy),button((g.pinned?'Unpin ':'Pin ')+g.name,()=>model.editGroup('folder',g.id,{pinned:!g.pinned}),false,busy),button('Rename '+g.name,()=>safeAction(()=>model.editGroup('folder',g.id,{name})),false,busy),button('Remove folder '+g.name,()=>safeAction(()=>model.deleteGroup('folder',g.id)),false,busy)))),
        title('Batches'),hint('Attach adds the whole batch to the composer in its saved order. It never presses Send.'),...batches.map(g=>E(RN.View,{key:g.id,style:{backgroundColor:'#292c34',padding:8,marginVertical:3,borderRadius:10}},t((g.pinned?'★ ':'')+g.name+' · '+g.ids.length),row(button('Attach batch '+g.name,()=>attach(g.ids,g.id),true,busy||!g.ids.length),button('View '+g.name,()=>{change({batch:g.id,folder:'',tag:'',query:'',favorites:false,recent:false,kind:'all'});setPanel('Browse');},false,busy),button('Edit '+g.name,()=>setEditBatch(g.id),false,busy),button((g.pinned?'Unpin ':'Pin ')+g.name,()=>model.editGroup('batch',g.id,{pinned:!g.pinned}),false,busy)))),
        editing?E(RN.View,null,title('Edit batch: '+editing.name),row(button('Rename batch',()=>safeAction(()=>model.editGroup('batch',editing.id,{name})),false,busy),button('Replace with selected items',()=>safeAction(()=>model.editGroup('batch',editing.id,{ids:selection})),false,busy),button('Delete batch',()=>safeAction(()=>{model.deleteGroup('batch',editing.id);setEditBatch('');}),false,busy)),
          ...editing.ids.map((id,i)=>E(RN.View,{key:id},hint((i+1)+'. '+(model.get(id)?.filename||'Missing item')),row(button('Up '+(i+1),()=>{const ids=editing.ids.slice();[ids[i-1],ids[i]]=[ids[i],ids[i-1]];model.editGroup('batch',editing.id,{ids});},false,busy||i===0),button('Down '+(i+1),()=>{const ids=editing.ids.slice();[ids[i+1],ids[i]]=[ids[i],ids[i+1]];model.editGroup('batch',editing.id,{ids});},false,busy||i===editing.ids.length-1),button('Remove from batch '+(i+1),()=>model.editGroup('batch',editing.id,{ids:editing.ids.filter(x=>x!==id)}),false,busy))))):null,
        title('Tags'),row(button('Any tag',()=>{change({tag:''});setPanel('Browse');},!v.tag,busy),...model.tags().map(tag=>button('#'+tag,()=>{change({tag,batch:''});setPanel('Browse');},v.tag===tag,busy))));
    } else if(panel==='Organize') {
      content=E(RN.ScrollView,{style:{flex:1}},title(selection.length+' selected'),hint('Select any number here for organization. Attachment batches still have a limit of 10.'),row(button('Select filtered items',()=>setSelection(items.map(p=>p.id)),false,busy),button('Clear selection',()=>setSelection([]),false,busy),button('Favorite selected',()=>safeAction(()=>model.applyOrganization(selection,{favorite:true})),false,busy||!selection.length),button('Unfavorite selected',()=>safeAction(()=>model.applyOrganization(selection,{favorite:false})),false,busy||!selection.length)),
        field('Tags to add, separated by commas',bulkTags,setBulkTags),row(button('Add tags to selected',()=>safeAction(()=>model.applyOrganization(selection,{tags:uniqueTags(bulkTags)})),false,busy||!selection.length),button('Clear selected tags',()=>safeAction(()=>model.applyOrganization(selection,{clearTags:true})),false,busy||!selection.length)),
        title('Move to folder'),groupsChoice(folders,bulkFolder,setBulkFolder,'Unfiled'),button('Move selected',()=>safeAction(()=>model.applyOrganization(selection,{folder:bulkFolder})),false,busy||!selection.length),
        title('Add to batch'),groupsChoice(batches,bulkBatch,setBulkBatch,'Choose batch'),button('Add selected to batch',()=>safeAction(()=>model.applyOrganization(selection,{batch:bulkBatch})),false,busy||!selection.length||!bulkBatch),
        button('Remove selected to trash',()=>safeAction(()=>{model.remove(selection);setSelection([]);}),false,busy||!selection.length),
        ...items.map(p=>button((selection.includes(p.id)?'✓ ':'')+p.filename,()=>toggle(p.id,true),selection.includes(p.id),busy)));
    } else if(panel==='Storage') {
      const sum=model.summary(),duplicates=model.duplicates();
      content=E(RN.ScrollView,{style:{flex:1}},title('Storage and file health'),t(`${sum.items} items · ${sum.saved} saved · ${sum.linked} linked · ${bytes(sum.bytes)} saved copies · ${bytes(sum.trashBytes)} trash`),hint('Linked media is a reference to the picker’s file. It may expire. Saved copies use app-private storage. Files larger than 20 MiB remain linked to avoid large base64 allocations.'),
        row(button('Check saved files',()=>run(async()=>{const r=await platform.checkFiles(n=>message('Checking '+n+' files…'));message(`${r.checked} checked · ${r.missing} missing · ${r.unknown} linked/unchecked.`);}),false,busy),button('Check exact duplicates',()=>run(async()=>{const r=await platform.auditHashes(p=>message(`Hashed ${p.hashed} · unchecked ${p.unchecked}`));message(`${r.groups.length} exact duplicate group(s); ${r.unchecked} unreadable/unchecked files.`);}),false,busy)),
        ...duplicates.map((ids,i)=>E(RN.View,{key:ids[0]},hint('Duplicate group '+(i+1)+': '+ids.map(id=>model.get(id)?.filename).join(', ')),button('Merge duplicate group '+(i+1),()=>safeAction(()=>model.mergeDuplicates(ids)),false,busy))),
        title('Missing or linked media'),...model.items().filter(p=>p.missing||!p.uri||!p.managedPath).map(p=>E(RN.View,{key:p.id},hint(p.filename+(p.missing?' · missing':' · linked')),button('Repair '+p.filename,()=>run(async()=>{await platform.repair(p.id);message('File reconnected; folder, tags and batches were preserved.');}),false,busy))),
        title('Trash: '+sum.trash),hint('Removed media stays here so Undo can restore it. Emptying trash deletes only plugin-owned copies and clears Undo history.'),
        row(button('Restore trash items',()=>safeAction(()=>model.restoreTrash()),false,busy||!sum.trash),button('Empty trash',()=>setConfirmPurge(true),false,busy||!sum.trash)),
        confirmPurge?row(button('Confirm permanently empty trash',()=>run(async()=>{const r=await platform.emptyTrash();setConfirmPurge(false);message(r.cleared+' entries cleared; '+r.failed+' could not be deleted and remain in trash. Originals were not touched.');}),false,busy),button('Cancel empty trash',()=>setConfirmPurge(false),false,busy)):null);
    } else if(panel==='Backup') {
      content=E(RN.ScrollView,{style:{flex:1}},title('Portable backup and restore'),hint('Backups include organization, batch order, favorites, preferences, per-chat browsing and tracked-send records. Full backups also include media bytes. Backups are unencrypted; choose where to save them in Android’s share sheet.'),
        row(button('Prepare metadata backup',()=>run(async()=>{setArchive(await platform.exportBackup(false));message('Metadata prepared. Share the file outside Kettu to keep a portable backup.');}),false,busy),
          button('Prepare full media backup',()=>run(async()=>{setArchive(await platform.exportBackup(true,(n,total)=>message(`Preparing media part ${n}/${total}…`)));message('Full backup prepared. Save every JSON part and every original-media part outside Kettu.');}),true,busy)),
        hint('Media up to 20 MiB is embedded in JSON parts. Larger files are shared as original media files using native sharing, without loading the whole file into JavaScript. Every file must be readable/hashable; full backup fails explicitly otherwise.'),
        button('Copy metadata JSON',()=>run(async()=>{const value=platform.metadataText();if(value.length>500000)throw Error('Metadata is too large for safe clipboard transfer. Export a file instead.');const clipboard=vendetta.metro.common.clipboard;if(!clipboard?.setString)throw Error('Clipboard unavailable.');await clipboard.setString(value);message('Metadata copied. It contains no media bytes.');}),false,busy),
        archive?E(RN.View,null,title(archive.mode+' backup · '+archive.parts.length+' parts'),hint('Saved only inside Kettu so far. Use each Share button and save its file to Files/Downloads or your chosen destination. A share sheet opening does not confirm the destination saved it.'),...archive.parts.map((p,i)=>button('Share backup part '+(i+1)+' / '+archive.parts.length,()=>run(async()=>{await platform.shareFile(p.uri,p.name,p.hash,p.fileSize);message('Share sheet opened for part '+(i+1)+'. Ensure you save every part.');}),false,busy)),button('Remove prepared backup copies',()=>run(async()=>{const r=await platform.removeBackup(archive);if(!r.failed)setArchive(null);message(r.cleared+' prepared copies removed; '+r.failed+' could not be deleted.');}),false,busy)):null,
        ...Object.entries(model.snapshot().restores).filter(([,r])=>r.total>r.parts.length).map(([id,r])=>hint('Restore '+id+': '+r.parts.length+' / '+r.total+' parts recovered.')),
        title('Restore'),hint('Restore merges into your collection. Import all JSON parts in any order. If your backup includes original-media parts, use Add media to select those originals afterwards; their hashes reconnect the matching entries without losing organization. Missing parts stay marked for repair.'),
        button('Choose backup JSON files',()=>run(async()=>{const r=await platform.restoreDocuments((n,total)=>message(`Restoring part ${n}/${total}…`));message(restoreResult(r));}),true,busy),
        field('Or paste metadata backup JSON',restoreText,setRestoreText,true),button('Restore pasted metadata',()=>run(async()=>{if(restoreText.length>500000)throw Error('Use file restore for large backup parts.');const r=await platform.restorePart(restoreText);setRestoreText('');message(restoreResult(r));}),false,busy||!restoreText));
    } else if(panel==='Details') {
      const item=model.get(detail),sent=item?model.sent(channelId,item.id):null;
      content=item?E(RN.ScrollView,{style:{flex:1}},title(item.filename),item.kind==='image'&&item.uri?E(RN.Image,{source:{uri:item.uri},resizeMode:'contain',style:{width:'100%',height:260}}):title('▶ Video · '+duration(item.duration)),
        hint(`${item.kind} · ${bytes(item.fileSize)} · ${item.width} × ${item.height} · ${item.managedPath?'Saved copy':'Linked file'}`),
        hint(sent?'Confirmed sent here: '+new Date(sent.at).toLocaleString():'No confirmed Quick Media send recorded here. This is not a scan of all previous messages.'),
        hint(item.hash?'Exact content hash available.':'Content hash unavailable; duplicate checking is incomplete for this file.'),
        hint('Tags: '+(item.tags.join(', ')||'none')),
        row(button('Attach item',()=>attach([item.id]),true,busy),button('Select for organization',()=>{setSelection(ids=>ids.includes(item.id)?ids:[...ids,item.id]);setPanel('Organize');},false,busy),button('Repair item',()=>run(async()=>{await platform.repair(item.id);message('Reconnected.');}),false,busy)),
        item.kind==='video'?button('Open video in external player',()=>run(async()=>{await platform.openVideo(item);message('Video opened.');}),false,busy):null):hint('This item no longer exists.');
    }
    const undo=model.canUndo();
    return E(RN.Modal,{visible:visible&&platform.active(),animationType:'slide',presentationStyle:'fullScreen',onRequestClose:()=>{if(!lock.current){if(panel!=='Browse')setPanel('Browse');else close();}}},
      E(RN.SafeAreaView||RN.View,{style:{flex:1,backgroundColor:'#202127'}},E(RN.View,{onLayout:event=>{const n=event.nativeEvent.layout.width;if(n>0)setWidth(n);},style:{flex:1,padding:12}},
        row(t('Quick Media',{fontSize:23,fontWeight:'800',flex:1}),button('Close',close,false,busy)),
        row(button('Browse',()=>setPanel('Browse'),panel==='Browse',busy),button('Collections',()=>setPanel('Collections'),panel==='Collections',busy),button('Organize',()=>setPanel('Organize'),panel==='Organize',busy),button('Storage',()=>setPanel('Storage'),panel==='Storage',busy),button('Backup',()=>setPanel('Backup'),panel==='Backup',busy)),
        notice?E(RN.Text,{numberOfLines:4,style:{color:'#ffdc98',fontSize:12,marginVertical:6}},notice):null,
        row(undo?button('Undo',()=>message('Undid: '+model.undoLast()),false,busy):null,button('Discord menu',()=>{close();if(!platform.normalMenu(channelId))try{vendetta.ui.toasts.showToast('Press + again for the normal Discord menu.');}catch(_){}},false,busy)),
        content)));
  }
  function shell(props){const Boundary=vendetta.ui?.components?.ErrorBoundary;return Boundary?E(Boundary,null,E(Picker,props)):E(Picker,props);}
  function open(chat,initialPanel='Browse'){if(!platform.active()||!vendetta.plugin.storage.enabled)throw Error('Enable the plugin first.');if(showing)return;showing=true;try{const result=vendetta.ui.alerts.showCustomAlert(shell,{channelId:chat||'0',initialPanel});if(result?.catch)result.catch(()=>{showing=false;});}catch(error){showing=false;throw error;}}
  function closeAll(){for(const fn of closers)try{fn();}catch(_){}closers.clear();showing=false;}
  platform.setUI(open,()=>!!RN.Modal&&typeof vendetta.ui?.alerts?.showCustomAlert==='function',closeAll);
  function Settings(){useModel();const [,update]=React.useState(0),[notice,setNotice]=React.useState('');const caps=platform.capabilities(),prefs=model.preferences();return E(RN.ScrollView,{style:{flex:1,backgroundColor:'#202127'},contentContainerStyle:{padding:16,paddingBottom:48}},
    title('BetterMediaPicker · Quick Media '+RELEASE),hint('Folders, tags, batches, videos, duplicate checks, per-chat browsing, and backup tools. Select or attach media, then review and press Send yourself.'),
    row(button(vendetta.plugin.storage.enabled?'Enabled':'Disabled',()=>{vendetta.plugin.storage.enabled=!vendetta.plugin.storage.enabled;update(n=>n+1);},vendetta.plugin.storage.enabled),button('Open Quick Media',()=>{try{open(platform.currentChannel());}catch(error){setNotice(error.message);}},true)),
    title('Chat shortcuts'),button(prefs.plus?'Open Quick Media from +: On':'Open Quick Media from +: Off',()=>model.setPreferences({plus:!prefs.plus}),prefs.plus),
    hint('The + shortcut only replaces the channel-message media menu when its exact interface is found. Other command/modal attachment menus keep their original behavior.'),
    row(button('Normal Discord menu on next +',()=>{platform.bypassNext();setNotice('Press + in a chat to open its normal menu once.');}),button('Retry client integrations',()=>{platform.installIntegrations();update(n=>n+1);})),
    title('Client integration status'),hint('Files shortcut: '+(caps.files?'hook installed':'unavailable')+'\n+ menu shortcut: '+(caps.plus?'hook installed; phone verification needed':'not found; Files or /quickphotos still available')+'\nConfirmed-send tracking: '+(caps.tracking?'hooks installed; only matched confirmed sends count':'unavailable; no sent badges inferred')+'\nPrivate file interface: '+(caps.documents?'found':'unavailable; linked imports only')+'\nNative backup sharing: '+(caps.share?'found; phone verification needed':'not found; export may be unavailable')),
    hint('Send tracking starts with this version and only covers identifiable Quick Media uploads. It does not scan old messages or label untracked media as never sent.'),
    title('Defaults'),row(...[3,4,5,6].map(n=>button(String(n)+' columns',()=>model.setPreferences({columns:n}),prefs.columns===n))),button(prefs.instant?'Single tap attaches':'Multi-select then attach',()=>model.setPreferences({instant:!prefs.instant}),prefs.instant),
    title('Collection'),hint(JSON.stringify(model.summary())),button('Open backup tools',()=>{try{open(platform.currentChannel(),'Backup');}catch(error){setNotice(error.message);}}),
    hint('Photos/videos you add remain local to this device until you explicitly attach them or export a backup. Private copies use app storage. Linked files can lose access; organization metadata survives so Repair can reconnect them.'),
    notice?hint(notice):null);
  }
  return {Settings,Picker,open,closeAll};
}

const model=createModel(vendetta.plugin.storage);
const platform=createPlatform(vendetta,model);
const ui=createUI(vendetta,model,platform);
return {onLoad:()=>platform.start(),onUnload:()=>platform.stop(),settings:ui.Settings};
})()
