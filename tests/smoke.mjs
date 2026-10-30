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
    useState: initial => [initial, () => {}], useEffect: ()=>{}, Fragment:'Fragment' };
  const RN = { Text:'Text', View:'View', TouchableOpacity:'Touch', Image:'Image', ScrollView:'ScrollView', FlatList:'FlatList', Dimensions:{get:()=>({width:440,height:920})} };
  const vendetta={
    plugin:{storage:{}}, logger:{log:()=>{}},
    metro:{common:{React,ReactNative:RN},
      findByProps:(prop) => prop==='handleAttachFile' ? (attachAvailable ? target:null):prop==='getPhotos' ? camera:prop==='launchImageLibrary' ? { launchImageLibrary:()=>{} }:prop==='openLazy' ? {hideActionSheet:()=>{}}:null,
      findByStoreName:()=>({getChannelId:()=> 'abc'})},
    ui:{alerts:{showCustomAlert:(component)=>({component})}},
    patcher:{ instead:(name,obj,cb)=>{assert.equal(name,'handleAttachFile');assert.equal(obj,target); patched=cb; return ()=>{restored=true;};} }
  };
  const plugin=vm.runInNewContext(`(function(vendetta){return ${code}\n})`,{vendetta, console})(vendetta);
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
