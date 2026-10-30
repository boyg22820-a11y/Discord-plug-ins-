import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const code=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
function harness({copy=true,throwOnWrite=false,noTarget=false}={}) {
 const storage={columns:6,sort:'filename',instant:true,enabled:true};
 const effects=[];let hooks=[],index=0;let mounted=false;let shown;let closed=0;let originalCalls=0;let command;let removedCommand=false;
 let channel='chat-a';let response={didCancel:true};const attachments=[],reads=[],writes=[],deletes=[],files=new Set();let nativeCalls=0;
 const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
   useState:initial=>{const i=index++;if(!(i in hooks))hooks[i]=typeof initial==='function'?initial():initial;return [hooks[i],value=>{hooks[i]=typeof value==='function'?value(hooks[i]):value;}];},
   useRef:initial=>{const i=index++;if(!(i in hooks))hooks[i]={current:initial};return hooks[i];},
   useEffect:fn=>{index++;if(!mounted)effects.push(fn);}};
 const fm={getConstants:()=>({DocumentsDirPath:'/private/documents'}),
  readFile:async(path,encoding)=>{reads.push(path);assert.equal(encoding,'base64');return 'YWJjZA==';},
  writeFile:async(dir,path,data,encoding)=>{writes.push(path);assert.equal(dir,'documents');assert.equal(encoding,'base64');if(throwOnWrite)throw Error('write');files.add('/private/documents/'+path);return '/private/documents/'+path;},
  removeFile:async(dir,path)=>{deletes.push(path);files.delete('/private/documents/'+path);},
  fileExists:async path=>files.has(path)};
 const api={handleAttachFile:()=>{originalCalls++;return 'stock';},handleSelectKeyboardItem:(...args)=>attachments.push(args)};
 const native={launchImageLibrary:(options,callback)=>{nativeCalls++;assert.equal(options.mediaType,'photo');assert.equal(options.selectionLimit,100);callback(response);return Promise.resolve(response);}};
 const alert={openLazy:()=>{},close:()=>{closed++;}};
 const RN={Modal:'Modal',SafeAreaView:'SafeAreaView',View:'View',Text:'Text',TextInput:'TextInput',Image:'Image',FlatList:'FlatList',TouchableOpacity:'Button',ScrollView:'ScrollView',Dimensions:{get:()=>({width:420,height:900})},NativeModules:copy?{NativeFileModule:fm}:{}};
 const vendetta={plugin:{storage},metro:{common:{React,ReactNative:RN},
  findByProps:(...names)=>[noTarget?null:api,native,alert].find(m=>m&&names.every(n=>n in m)),
  findByStoreName:()=>({getChannelId:()=>channel})},
  ui:{alerts:{showCustomAlert:(component,props)=>{shown={component,props};}},toasts:{showToast:()=>{}}},
  patcher:{instead:(name,obj,callback)=>{const original=obj[name];obj[name]=(...args)=>callback(args,original.bind(obj));return ()=>{obj[name]=original;};}},
  commands:{registerCommand:cmd=>{command=cmd;return ()=>{removedCommand=true;};}}};
 const plugin=vm.runInNewContext(`(function(vendetta){return ${code}\n})`,{setTimeout,clearTimeout,console,fetch:()=>{throw Error('Network must not be used');}})(vendetta);
 const renderPicker=()=>{assert.ok(shown);index=0;const tree=shown.component(shown.props);if(!mounted){mounted=true;for(const effect of effects.splice(0))effect();}return tree;};
 return {plugin,storage,api,attachments,reads,writes,deletes,files,renderPicker,
  setResponse:r=>{response=r;},setChannel:c=>{channel=c;},get command(){return command;},get removedCommand(){return removedCommand;},get nativeCalls(){return nativeCalls;},get originalCalls(){return originalCalls;},get closed(){return closed;},
  open:()=>api.handleAttachFile('chat-a'),get shown(){return shown;}};
}
function nodes(tree,type,into=[]) {
 if(!tree||typeof tree!=='object')return into;
 if(tree.type===type)into.push(tree);
 for(const c of (tree.children||[]).flat(Infinity))nodes(c,type,into);
 return into;
}
function press(tree,label){const btn=nodes(tree,'Button').find(b=>b.props.accessibilityLabel===label);assert.ok(btn,`button ${label}`);assert.ok(!btn.props.disabled,`enabled ${label}`);return btn.props.onPress();}
function grid(tree){return nodes(tree,'FlatList')[0];}
function asset(n,overrides={}) {return {uri:`file:///cache/p${n}.jpg`,fileName:`photo${n}.jpg`,type:'image/jpeg',width:400,height:500,fileSize:4,...overrides};}

let h=harness();h.plugin.onLoad();
assert.equal(h.storage.columns,6,'approved preferences survive update');
assert.equal(h.nativeCalls,0,'loading plugin must not access photos');
assert.equal(h.command.name,'quickphotos');
assert.equal(h.command.execute([], {channel:{id:'chat-a'}}),undefined,'command never returns a message to send');
let tree=h.renderPicker();assert.equal(tree.type,'Modal');assert.equal(grid(tree).props.data.length,0);
h.setResponse({assets:[asset(1),asset(2),asset(1)]});await press(tree,'Add photos');
tree=h.renderPicker();assert.equal(grid(tree).props.data.length,2);assert.equal(h.storage.quickPhotos.length,2);assert.equal(h.writes.length,2);assert.equal(h.nativeCalls,1);
assert.ok(h.storage.quickPhotos.every(p=>p.uri.startsWith('file:///private/documents/better-media-picker/photos/')));
assert.equal(h.attachments.length,0,'import does not attach or send');
let tile=grid(tree).props.renderItem({item:grid(tree).props.data[0]});
await press(tile,'Favorite photo');tree=h.renderPicker();await press(tree,'All photos');tree=h.renderPicker();assert.equal(grid(tree).props.data.length,1,'favorites filter');
await press(tree,'Favorites only');tree=h.renderPicker();
const input=nodes(tree,'TextInput')[0];input.props.onChangeText('photo2');tree=h.renderPicker();assert.equal(grid(tree).props.data.length,1);assert.equal(grid(tree).props.data[0].filename,'photo2.jpg');
nodes(tree,'TextInput')[0].props.onChangeText('');tree=h.renderPicker();
await press(tree,'Tap to attach');tree=h.renderPicker();
for(const item of grid(tree).props.data) {tile=grid(tree).props.renderItem({item});await press(tile,item.filename);tree=h.renderPicker();}
await press(tree,'Attach 2 / 10');assert.equal(h.attachments.length,2);assert.equal(h.closed,1);
assert.equal(h.attachments[0][0],'chat-a');assert.equal(h.attachments[0][1].node.type,'ALAssetTypePhoto');assert.equal(h.attachments[0][1].node.image.mimeType,'image/jpeg');
h.plugin.onUnload();assert.ok(h.removedCommand);assert.equal(h.api.handleAttachFile(),'stock');
console.log('PASS: custom modal, command, import, local copies, deduplication, preferences, favorites/search, multi-select, composer attachment, cleanup.');

h=harness({copy:false});h.plugin.onLoad();h.open();tree=h.renderPicker();h.setResponse({assets:[asset(1)]});await press(tree,'Add photos');tree=h.renderPicker();assert.equal(grid(tree).props.data.length,1);assert.equal(h.storage.quickPhotos.length,0,'temporary references are not persisted');
h.setChannel('chat-b');tile=grid(tree).props.renderItem({item:grid(tree).props.data[0]});await press(tile,'photo1.jpg');assert.equal(h.attachments.length,0,'never attach to a different chat');
h.plugin.onUnload();assert.equal(h.nativeCalls,1);
console.log('PASS: missing copy bridge falls back to temporary collection; changed chat blocks attachment.');

h=harness();h.plugin.onLoad();h.open();tree=h.renderPicker();h.setResponse({assets:[asset(1),asset(2,{fileName:'photo1.jpg'})]});await press(tree,'Add photos');assert.equal(h.storage.quickPhotos.length,2,'distinct URIs with same filename are retained');tree=h.renderPicker();await press(tree,'Manage');tree=h.renderPicker();tile=grid(tree).props.renderItem({item:grid(tree).props.data[0]});await press(tile,'Remove');assert.equal(h.storage.quickPhotos.length,1);assert.equal(h.deletes.length,1);assert.ok(h.deletes[0].startsWith('better-media-picker/photos/'));assert.ok(!h.deletes.some(p=>p.includes('/cache/')),'never delete source photos');h.plugin.onUnload();
console.log('PASS: distinct same-named files are retained; removal deletes only managed copies.');

h=harness({throwOnWrite:true});h.plugin.onLoad();h.open();tree=h.renderPicker();h.setResponse({assets:[asset(1)]});await press(tree,'Add photos');tree=h.renderPicker();assert.equal(grid(tree).props.data.length,1);assert.equal(h.storage.quickPhotos.length,0);assert.ok(grid(tree).props.data.every(p=>!p.managedPath));h.plugin.onUnload();
console.log('PASS: failed native writes fall back to temporary photos.');

h=harness();h.plugin.onLoad();h.open();tree=h.renderPicker();h.setResponse({didCancel:true});await press(tree,'Add photos');assert.equal(h.storage.quickPhotos.length,0);assert.equal(h.writes.length,0);
h.setResponse({assets:[asset(1,{fileSize:30*1024*1024}),asset(2,{fileSize:0}),asset(3,{uri:'https://example.com/photo.jpg'})]});await press(h.renderPicker(),'Add photos');assert.equal(h.reads.length,0,'do not read oversized or unknown-size files');assert.equal(grid(h.renderPicker()).props.data.length,2,'reject remote image URLs');h.plugin.onUnload();
console.log('PASS: cancellation, file size limits, remote URI rejection.');

h=harness();h.plugin.onLoad();h.open();tree=h.renderPicker();h.setResponse({assets:Array.from({length:12},(_,i)=>asset(i))});await press(tree,'Add photos');tree=h.renderPicker();await press(tree,'Tap to attach');tree=h.renderPicker();for(const item of grid(tree).props.data){await press(grid(tree).props.renderItem({item}),item.filename);tree=h.renderPicker();}await press(tree,'Attach 10 / 10');assert.equal(h.attachments.length,10);h.plugin.onUnload();
console.log('PASS: selection is capped at ten photos.');

h=harness();h.plugin.onLoad();h.storage.enabled=false;assert.equal(h.open(),'stock');assert.equal(h.shown,undefined);h.storage.enabled=true;h.open();tree=h.renderPicker();h.setResponse({assets:[asset(1)]});await press(tree,'Add photos');h.files.clear();tree=h.renderPicker();await press(grid(tree).props.renderItem({item:grid(tree).props.data[0]}),'photo1.jpg');assert.equal(h.attachments.length,0,'expired saved copy blocks composer changes');h.plugin.onUnload();
h=harness({noTarget:true});h.plugin.onLoad();assert.equal(h.command.execute([], {channel:{id:'chat-a'}}),undefined);assert.ok(h.shown,'command can open picker even when Files shortcut is unavailable');h.plugin.onUnload();
console.log('PASS: disabled plugin uses original picker; missing files block attachment; command works without Files hook.');

h=harness();h.plugin.onLoad();h.open();tree=h.renderPicker();h.setResponse({assets:[asset(1)]});await press(tree,'Add photos');tree=h.renderPicker();await press(grid(tree).props.renderItem({item:grid(tree).props.data[0]}),'photo1.jpg');assert.equal(h.attachments.length,1,'single tap attaches once');assert.equal(h.closed,1);h.plugin.onUnload();
const manifest=JSON.parse(fs.readFileSync(new URL('../docs/BetterMediaPicker/manifest.json',import.meta.url),'utf8'));
assert.equal(manifest.version,'0.2.0');assert.equal(manifest.hash,crypto.createHash('sha256').update(code).digest('hex'));
assert.equal(code,fs.readFileSync(new URL('../docs/BetterMediaPicker/index.js',import.meta.url),'utf8'));
console.log('PASS: one-tap attachment and deployment hash/source parity.');
