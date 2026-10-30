import { LIMITS, localURI, validHash, text, safeId, validBase64, hashBase64 } from './core.mjs';
// Kettu adapter. Unknown client interfaces fail closed and expose a capability status.
export function createPlatform(vendetta, model) {
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
