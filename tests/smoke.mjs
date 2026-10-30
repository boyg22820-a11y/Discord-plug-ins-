import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import path from 'node:path';

const code = fs.readFileSync(new URL('../docs/BetterMediaPicker/index.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../docs/BetterMediaPicker/manifest.json', import.meta.url), 'utf8'));

function makeTest(cameraAvailable=true, attachAvailable=true) {
  let patched = null; let restored = false; const attachments=[];
  const target = {
    handleAttachFile() { return 'original'; },
    handleSelectKeyboardItem(id, item) { attachments.push([id,item]); }
  };
  const camera = cameraAvailable ? { getPhotos: async () => ({
    edges: [{ node: { id:'1', timestamp:12, type:'image/jpeg', image:{ uri:'file:///photo.jpg', filename:'photo.jpg', width:128, height:128 } }}],
    page_info: {has_next_page:false}
  }) } : null;
  const React = { createElement: (type, props, ...children) => ({type, props:props||{}, children}),
    useState: initial => [initial, () => {}], useEffect: ()=>{}, useRef: value => ({current:value}), Fragment:'Fragment' };
  const RN = { Text:'Text', View:'View', TouchableOpacity:'Touch', Image:'Image', ScrollView:'ScrollView', FlatList:'FlatList', Dimensions:{get:()=>({width:440,height:920})} };
  const vendetta={
    plugin:{storage:{}}, logger:{log:()=>{}},
    metro:{common:{React,ReactNative:RN},
      findByProps:(prop) => prop==='handleAttachFile' ? (attachAvailable ? target:null):prop==='getPhotos' ? camera:prop==='launchImageLibrary' ? { launchImageLibrary:()=>{} }:prop==='openLazy' ? {hideActionSheet:()=>{}}:null,
      findByStoreName:()=>({getChannelId:()=> 'abc'})},
    ui:{alerts:{showCustomAlert:(component)=>({component})}},
    patcher:{ instead:(name,obj,cb)=>{assert.equal(name,'handleAttachFile');assert.equal(obj,target); patched=cb; return ()=>{restored=true;};} }
  };
  const plugin=vm.runInNewContext(`(function(vendetta){return ${code}\n})`,{vendetta, console, setTimeout, clearTimeout})(vendetta);
  return {plugin,vendetta,get patched(){return patched},get restored(){return restored},attachments,target};
}
assert.equal(manifest.main,'index.js');
assert.equal(manifest.name,'BetterMediaPicker Prototype');
let s=makeTest();
assert.equal(typeof s.plugin.onLoad,'function');
assert.equal(typeof s.plugin.settings,'function');
s.plugin.onLoad();
assert.equal(s.vendetta.plugin.storage.columns,4);
assert.equal(s.vendetta.plugin.storage.sort,'newest');
assert.equal(typeof s.patched,'function');
let shown=s.patched([],s.target.handleAttachFile);
assert.equal(typeof shown.component, 'function');
s.vendetta.plugin.storage.enabled=false;
assert.equal(s.patched([],s.target.handleAttachFile),'original');
s.plugin.onUnload();
assert.equal(s.restored,true);
s=makeTest(false);s.plugin.onLoad();assert.equal(s.patched,null);s.plugin.onUnload();
s=makeTest(true,false);s.plugin.onLoad();assert.equal(s.patched,null);s.plugin.onUnload();
console.log('PASS: loader expression, plugin hooks, default settings, interception, disable fallback, missing API, cleanup.');


// Runtime diagnostics must stay passive and exclude private property values.
s=makeTest(false);
let copied=''; let getterCalls=0;
s.vendetta.metro.common.clipboard={setString:value=>{copied=value;}};
s.vendetta.debug={getDebugInfo:()=>({bunny:{version:'test-kettu'},discord:{version:'351.11'},react:{nativeVersion:'test-rn'},device:{model:'PRIVATE_DEVICE'}})};
const picker={MediaPicker: function MediaPicker(){}};
Object.defineProperty(picker,'getPhotos',{enumerable:true,get(){getterCalls++;throw Error('Do not invoke');}});
picker.secret='PRIVATE_TOKEN';
s.vendetta.metro.modules={
  1:{isInitialized:true,publicModule:{exports:picker}},
  2:{isInitialized:false,publicModule:{exports:{PhotoPicker:()=>{}}}},
  3:{isInitialized:true,publicModule:{exports:{default:function GalleryPicker(){}}}}
};
s.vendetta.metro.common.ReactNative.NativeModules={MediaLibrary:{privateURI:'file:///PRIVATE_PHOTO.jpg'}};
s.plugin.onLoad();
function buttons(tree,result=[]) {
  if(!tree || typeof tree!=='object')return result;
  if(tree.type==='Touch') result.push(tree);
  for(const child of (tree.children||[]).flat(Infinity)) buttons(child,result);
  return result;
}
let tree=s.plugin.settings();
let scan=buttons(tree).find(b=>b.children[0].children[0]==='Scan loaded modules');
let state=[];let cursor=0;
s.vendetta.metro.common.React.useState=initial=>{
 const i=cursor++;if(!(i in state))state[i]=initial;
 return [state[i],value=>{state[i]=typeof value==='function'?value(state[i]):value;}];
};
cursor=0; tree=s.plugin.settings();
await buttons(tree).find(b=>b.children[0].children[0]==='Scan loaded modules').props.onPress();
cursor=0;tree=s.plugin.settings();
buttons(tree).find(b=>b.children[0].children[0]==='Copy diagnostic report').props.onPress();
assert.match(copied,/Module 1:.*MediaPicker/);
assert.match(copied,/Module 3:.*GalleryPicker/);
assert.doesNotMatch(copied,/Module 2:/);
assert.doesNotMatch(copied,/PRIVATE_|file:\/\//);
assert.equal(getterCalls,0);
assert.equal(s.patched,null);
// A module initialized after opening the tray must appear in the next scan.
s.vendetta.metro.modules[2].isInitialized=true;
cursor=0;tree=s.plugin.settings();
await buttons(tree).find(b=>b.children[0].children[0]==='Scan loaded modules').props.onPress();
cursor=0;tree=s.plugin.settings();
buttons(tree).find(b=>b.children[0].children[0]==='Copy diagnostic report').props.onPress();
assert.match(copied,/Module 2:.*PhotoPicker/);
// Unload cancels in-flight scans, and preserves existing settings.
s.vendetta.plugin.storage.columns=6;
cursor=0;tree=s.plugin.settings();
const pending=buttons(tree).find(b=>b.children[0].children[0]==='Scan loaded modules').props.onPress();
s.plugin.onUnload();await pending;
assert.equal(s.vendetta.plugin.storage.columns,6);
console.log('PASS: diagnostics UI, metadata-only report, skipped getters, lazy module refresh, clipboard, unload cancellation.');

// Targeted capture must preserve real API calls and redact every data value.
s=makeTest(false);copied='';getterCalls=0;
s.vendetta.metro.common.clipboard={setString:value=>{copied=value;}};
const apiPromise=Promise.resolve({edges:[{node:{image:{uri:'file:///PRIVATE_URI',filename:'PRIVATE_NAME.jpg',width:400},timestamp:123}}],page_info:{has_next_page:true,end_cursor:'PRIVATE_CURSOR'}});
const callArgs=[{first:120,after:'PRIVATE_CURSOR',include:['filename']}];
let invoked=0;
const photoAPI={getDeviceMediaPhotos(...args){invoked++;assert.equal(args[0],callArgs[0]);return apiPromise;}};
s.vendetta.metro.modules={10334:{isInitialized:true,publicModule:{exports:photoAPI}}};
let undone=0;
s.vendetta.patcher.instead=(name,owner,callback)=>{
 assert.equal(name,'getDeviceMediaPhotos');
 const original=owner[name];
 owner[name]=(...args)=>callback(args,original.bind(owner));
 return ()=>{owner[name]=original;undone++;};
};
s.plugin.onLoad();
let captureButtons=buttons(s.plugin.settings());
captureButtons.find(b=>b.children[0].children[0]==='Start Photos API capture (60 seconds)').props.onPress();
assert.equal(invoked,0,'starting capture must not invoke the photo API');
assert.equal(photoAPI.getDeviceMediaPhotos(...callArgs),apiPromise,'promise identity must be preserved');
await apiPromise;await new Promise(resolve=>setImmediate(resolve));
buttons(s.plugin.settings()).find(b=>b.children[0].children[0]==='Copy diagnostic report').props.onPress();
assert.match(copied,/Resolved shape:/);
assert.match(copied,/"uri":"string"/);
assert.match(copied,/"first":"number"/);
assert.doesNotMatch(copied,/PRIVATE_|file:\/\//);
s.plugin.onUnload();assert.equal(undone,1);
assert.equal(invoked,1);
console.log('PASS: API capture preserves arguments and promise identity, redacts values, never calls API itself, and restores hook.');
