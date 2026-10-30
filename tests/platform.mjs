import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createModel,LIMITS} from '../src/core.mjs';
import {createPlatform} from '../src/platform.mjs';
let serial=0;const current='111111111111111111',other='222222222222222222',self='333333333333333333';
export function fixture({copy=true,withHash=true,integrations=true,storage={enabled:true},failWrite=false}={}) {
 const blobs=new Map(),listeners=new Map(),attachments=[],originalMenus=[],shared=[],deleted=[];let response={didCancel:true},chosenDocs=[],channel=current,opened=[],disabledWrite=failWrite,failDelete=false;
 const model=createModel(storage,{makeId:()=>`test-${++serial}`});
 const fm={getConstants:()=>({DocumentsDirPath:'/docs'}),fileExists:async path=>blobs.has(path),
  readFile:async(path,encoding)=>{if(!blobs.has(path))throw Error('missing');const data=blobs.get(path);return encoding==='base64'?data.toString('base64'):data.toString('utf8');},
  writeFile:async(dir,path,data,encoding)=>{if(disabledWrite)throw Error('no space');assert.equal(dir,'documents');blobs.set('/docs/'+path,Buffer.from(data,encoding));return '/docs/'+path;},
  removeFile:async(dir,path)=>{deleted.push(path);if(!failDelete)blobs.delete('/docs/'+path);return false;}};
 if(withHash)fm.getFileHash=async(uri,algorithm)=>crypto.createHash(algorithm).update(blobs.get(uri.startsWith('file://')?decodeURI(uri.slice(7)):uri)).digest('hex');
 const nativeMedia={launchImageLibrary:(options,callback)=>{assert.equal(options.mediaType,'mixed');callback(response);return Promise.resolve(response);}};
 const api={handleAttachFile:()=> 'original-files',handleSelectKeyboardItem:(chat,node)=>{attachments.push({chat,node});}};
 const menu={showMediaKeyboardActionSheet:options=>{originalMenus.push(options);return 'normal-menu';}};
 const upload={uploadMessageAttachments:options=>Promise.resolve({options})};
 const documentPicker={handleDocumentSelection:async()=>chosenDocs};
 const dispatcher={subscribe:(name,fn)=>listeners.set(name,fn),unsubscribe:(name,fn)=>{assert.equal(listeners.get(name),fn);listeners.delete(name);}};
 const mods=[api,nativeMedia,documentPicker,{DraftType:{ChannelMessage:0}},...(integrations?[menu,upload]:[])];
 const stores={SelectedChannelStore:{getChannelId:()=>channel},UserStore:{getCurrentUser:()=>({id:self})},UploadAttachmentStore:{getUploads:()=>[]}};
 const share={share:async(...args)=>{shared.push(args);}};
 const vendetta={plugin:{storage},metro:{modules:{},common:{ReactNative:{NativeModules:copy?{NativeFileModule:fm,NativeShareManagerModule:share}:{},Linking:{openURL:async()=>{}}},FluxDispatcher:dispatcher},findByProps:(...names)=>mods.find(o=>names.every(n=>n in o)),findByStoreName:name=>stores[name]},
  patcher:{instead:(name,obj,cb)=>{const original=obj[name];obj[name]=function(...args){return cb(args,original.bind(this));};return()=>obj[name]=original;},before:(name,obj,cb)=>{const original=obj[name];obj[name]=function(...args){cb(args);return original.apply(this,args);};return()=>obj[name]=original;}},
  commands:{registerCommand:()=>()=>{}},ui:{toasts:{showToast:()=>{}}}};
 const platform=createPlatform(vendetta,model);platform.setUI(chat=>opened.push(chat),()=>true,()=>{});platform.start();
 const asset=(name,data='hello',kind='image')=>{const uri=`file:///source/${++serial}`;const raw=Buffer.from(data);blobs.set(uri.slice(7),raw);return {uri,fileName:name,type:kind==='video'?'video/mp4':'image/jpeg',width:400,height:500,fileSize:raw.length,duration:kind==='video'?14:0};};
 return {model,platform,storage,vendetta,blobs,attachments,originalMenus,shared,deleted,opened,api,menu,upload,asset,
  setResponse:r=>response=r,setDocs:d=>chosenDocs=d,setChannel:c=>channel=c,emit:(name,e)=>listeners.get(name)?.(e),listeners,stores,
  setWriteFailure:v=>disabledWrite=v,setDeleteFailure:v=>failDelete=v};
}
let h=fixture();try{
 const f=h.model.createGroup('folder','Folder'),b=h.model.createGroup('batch','Batch');
 const first=h.asset('first.jpg','same-bytes'),renamed=h.asset('renamed.jpg','same-bytes'),video=h.asset('clip.mp4','video-bytes','video');
 h.setResponse({assets:[first,renamed,video]});let r=await h.platform.importMedia({folder:f.id,tags:['tag'],batch:b.id});assert.equal(r.added,2);assert.equal(r.duplicates,1);assert.equal(r.saved,2);assert.equal(h.attachments.length,0);
 const [photo,clip]=h.model.items();assert.equal(clip.kind,'video');assert.equal(clip.duration,14);assert.ok(photo.hash);assert.ok(h.blobs.has(photo.uri.slice(7)));
 h.model.editGroup('batch',b.id,{ids:[clip.id,photo.id]});await h.platform.attach([clip.id,photo.id],current,b.id);assert.equal(h.attachments[0].node.node.type,'ALAssetTypeVideo');assert.equal(h.attachments[0].node.node.image.playableDuration,14);assert.equal(h.model.view(current).lastBatch,b.id);assert.equal(h.model.sent(current,photo.id),null,'attachment is not send confirmation');
 const uploads=h.attachments.map(x=>({id:x.node.node.id,uri:x.node.node.image.uri}));
 const options={channelId:current,nonce:'444444444444444444',items:uploads};const returned=h.upload.uploadMessageAttachments(options);assert.ok(returned instanceof Promise);await returned;
 const message={id:'555555555555555555',nonce:options.nonce,channel_id:current,author:{id:self},timestamp:new Date().toISOString(),attachments:[{id:'666666666666666666',filename:clip.filename,url:'https://cdn.discordapp.com/attachments/a/b/clip.mp4'},{id:'777777777777777777',filename:photo.filename,url:'https://cdn.discordapp.com/attachments/a/b/test.jpg'}]};
 h.emit('MESSAGE_CREATE',{message:{...message,author:{id:other}}});assert.equal(h.model.sent(current,photo.id),null);
 h.emit('MESSAGE_CREATE',{message,optimistic:true});assert.equal(h.model.sent(current,photo.id),null);
 h.emit('MESSAGE_CREATE',{message:{...message,attachments:[{id:'666666666666666666',url:'file:///local'}]}});assert.equal(h.model.sent(current,photo.id),null);
 h.emit('MESSAGE_CREATE',{message:{...message,attachments:message.attachments.slice(0,1)}});assert.equal(h.model.sent(current,photo.id),null,'partial attachment confirmations must not mark every selected item sent');
 h.emit('MESSAGE_CREATE',{message});assert.ok(h.model.sent(current,photo.id));assert.ok(h.model.sent(current,clip.id));assert.equal(h.model.sent(other,photo.id),null);h.emit('MESSAGE_CREATE',{message});assert.equal(h.model.sent(current,photo.id).count,1);
 assert.equal(h.menu.showMediaKeyboardActionSheet({channel:{id:current},draftType:0}),undefined);assert.deepEqual(h.opened,[current]);h.platform.normalMenu(current);assert.equal(h.originalMenus.length,1);
 h.menu.showMediaKeyboardActionSheet({channel:{id:current},draftType:2});assert.equal(h.originalMenus.length,2,'other modal/command menus stay original');
 h.storage.enabled=false;h.menu.showMediaKeyboardActionSheet({channel:{id:current},draftType:0});assert.equal(h.originalMenus.length,3);assert.equal(h.api.handleAttachFile(),'original-files');h.storage.enabled=true;
 h.platform.bypassNext();h.menu.showMediaKeyboardActionSheet({channel:{id:current},draftType:0});assert.equal(h.originalMenus.length,4);h.menu.showMediaKeyboardActionSheet({channel:{id:current},draftType:0});assert.equal(h.opened.length,2);
 h.setChannel(other);await assert.rejects(h.platform.attach([photo.id],current),/chat/);h.setChannel(current);
 h.stores.UploadAttachmentStore.getUploads=()=>Array(10).fill({});await assert.rejects(h.platform.attach([photo.id],current),/slots/);h.stores.UploadAttachmentStore.getUploads=()=>[];
 const backup=await h.platform.exportBackup(true);assert.equal(backup.parts.length,3);assert.ok(h.platform.lastBackup());await h.platform.shareFile(backup.parts[0].uri,backup.parts[0].name);assert.equal(h.shared.length,1,'one user share action opens one native share sheet');assert.equal(h.shared[0][1],backup.parts[0].uri);
 const data=backup.parts.map(p=>h.blobs.get(p.uri.slice(7)).toString('utf8'));
 const clean=fixture();try{let result;for(const source of data.slice().reverse())result=await clean.platform.restorePart(source);assert.equal(result.remaining,0);assert.equal(clean.model.items().length,2);assert.deepEqual(clean.model.groups('batch')[0].ids,[clip.id,photo.id]);for(const p of clean.model.items()){assert.ok(p.managedPath);assert.ok(clean.blobs.get(p.uri.slice(7)));assert.equal(crypto.createHash('sha256').update(clean.blobs.get(p.uri.slice(7))).digest('hex'),p.hash);}assert.ok(clean.model.sent(current,photo.id));assert.equal((await clean.platform.restorePart(data[1])).skipped,true);
  const mutated=JSON.parse(data[1]);mutated.archiveId='corrupt';mutated.asset.data=Buffer.from('corrupted').toString('base64');const before=JSON.stringify(clean.model.snapshot());await assert.rejects(clean.platform.restorePart(JSON.stringify(mutated)),/checksum/);assert.equal(JSON.stringify(clean.model.snapshot()),before);
 }finally{clean.platform.stop();}
 const changed=h.asset('wrong.jpg','not-the-same');h.setResponse({assets:[changed]});await assert.rejects(h.platform.repair(photo.id),/match/);
 const replacement=h.asset('original-renamed.jpg','same-bytes');h.setResponse({assets:[replacement]});await h.platform.repair(photo.id);assert.equal(h.model.get(photo.id).folder,f.id);assert.deepEqual(h.model.get(photo.id).tags,['tag']);
 h.model.remove([photo.id]);h.setDeleteFailure(true);r=await h.platform.emptyTrash();assert.equal(r.failed,1);assert.equal(h.model.trash().length,1);h.setDeleteFailure(false);r=await h.platform.emptyTrash();assert.equal(r.cleared,1);assert.equal(h.model.trash().length,0);assert.ok(h.blobs.has(first.uri.slice(7)),'source original never deleted');
}finally{h.platform.stop();}assert.equal(h.listeners.size,0);assert.equal(h.api.handleAttachFile(),'original-files');
console.log('PASS: mixed-media import/content deduplication, ordered attachments, conservative send confirmation, guarded + shortcut, nonce matching, menu bypass and cleanup.');
console.log('PASS: portable full backup round-trip in reverse part order, checksum corruption rejection, native sharing, hash-verified repair, failed deletion retention.');

h=fixture({copy:false});try{const a=h.asset('linked.jpg');h.setResponse({assets:[a]});const r=await h.platform.importMedia();assert.equal(r.linked,1);assert.equal(r.unchecked,1);const id=h.model.items()[0].id;const reloaded=createModel(h.storage);assert.equal(reloaded.get(id).uri,a.uri,'linked organization survives reload');await assert.rejects(h.platform.exportBackup(true),/unavailable/);}finally{h.platform.stop();}
h=fixture({failWrite:true});try{h.setResponse({assets:[h.asset('linked.jpg')]});assert.equal((await h.platform.importMedia()).linked,1);}finally{h.platform.stop();}
h=fixture({withHash:false});try{h.setResponse({assets:[h.asset('a.jpg','identical'),h.asset('b.jpg','identical')]});const r=await h.platform.importMedia();assert.equal(r.duplicates,1,'pure-JS hash fallback works');}finally{h.platform.stop();}
h=fixture({integrations:false});try{const caps=h.platform.capabilities();assert.equal(caps.plus,false);assert.equal(caps.tracking,false);assert.equal(caps.files,true);}finally{h.platform.stop();}
console.log('PASS: native-file failure fallback, persistent linked metadata, pure-JS hashes, and unavailable integration status.');

h=fixture();try{const a=h.asset('large.mp4','tiny-test-data','video');a.fileSize=LIMITS.readBytes+1;h.setResponse({assets:[a]});const r=await h.platform.importMedia();assert.equal(r.linked,1);assert.equal(r.unchecked,0,'native hash supports files beyond JS read cap');const full=await h.platform.exportBackup(true);assert.equal(full.parts.length,2);assert.equal(full.parts[1].raw,true);assert.equal(full.parts[1].uri,a.uri);const rawRestore=fixture();try{const header=h.blobs.get(full.parts[0].uri.slice(7)).toString('utf8');assert.equal((await rawRestore.platform.restorePart(header)).remaining,1);const restoredAsset=rawRestore.asset('restored-large.mp4','tiny-test-data','video');restoredAsset.fileSize=LIMITS.readBytes+1;rawRestore.setResponse({assets:[restoredAsset]});const recovered=await rawRestore.platform.importMedia();assert.equal(recovered.repaired,1);assert.ok(!rawRestore.model.items()[0].missing);assert.equal(Object.values(rawRestore.model.snapshot().restores)[0].parts.length,2);}finally{rawRestore.platform.stop();}await h.platform.removeBackup(full);assert.ok(h.blobs.has(a.uri.slice(7)),'removing prepared backup never deletes raw originals');const meta=await h.platform.exportBackup(false);assert.equal(meta.parts.length,1);h.setResponse({didCancel:true});assert.ok((await h.platform.importMedia()).cancelled);}finally{h.platform.stop();}
console.log('PASS: large videos stay linked, raw-media backup/relink round-trip, metadata backup and picker cancellation.');
