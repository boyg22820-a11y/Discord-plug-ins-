import { RELEASE, LIMITS, uniqueTags } from './core.mjs';
export function createUI(vendetta,model,platform) {
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
