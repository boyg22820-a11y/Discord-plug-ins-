import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fixture} from './platform.mjs';
import {createUI} from '../src/ui.mjs';
let h=fixture();
const pools=new Map();let activePool=null,cursor=0,shown=null,clipboard='';let renderEffects=[];
const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
 useState:initial=>{const p=activePool,i=cursor++;if(!(i in p.slots))p.slots[i]=typeof initial==='function'?initial():initial;return [p.slots[i],value=>p.slots[i]=typeof value==='function'?value(p.slots[i]):value];},
 useRef:initial=>{const p=activePool,i=cursor++;if(!(i in p.slots))p.slots[i]={current:initial};return p.slots[i];},
 useEffect:(fn,deps)=>{const p=activePool,i=cursor++;const prev=p.slots[i];if(!prev||deps?.some((v,n)=>v!==prev.deps?.[n]))renderEffects.push(()=>{prev?.cleanup?.();p.slots[i]={deps,cleanup:fn()};});}};
function unmount(){for(const p of pools.values())for(const slot of p.slots)slot?.cleanup?.();pools.clear();}
const RN=h.vendetta.metro.common.ReactNative;Object.assign(RN,{Text:'Text',View:'View',ScrollView:'ScrollView',TouchableOpacity:'Button',TextInput:'Input',Modal:'Modal',SafeAreaView:'SafeArea',Image:'Image',FlatList:'List',Dimensions:{get:()=>({width:430,height:900})}});
h.vendetta.metro.common.React=React;h.vendetta.metro.common.clipboard={setString:value=>{clipboard=value;}};
h.vendetta.ui.alerts={showCustomAlert:(component,props)=>{unmount();shown={component,props};}};
const oldFind=h.vendetta.metro.findByProps;h.vendetta.metro.findByProps=(...names)=>names.includes('openLazy')?{close:()=>{},openLazy:()=>{}}:oldFind(...names);
const ui=createUI(h.vendetta,h.model,h.platform);
function renderFunction(fn,props={}) {let pool=pools.get(fn);if(!pool){pool={slots:[],count:null};pools.set(fn,pool);}activePool=pool;cursor=0;const tree=fn(props);if(pool.count!==null)assert.equal(cursor,pool.count,'React hook count must be stable across every panel');pool.count=cursor;return tree;}
function resolve(tree){if(!tree||typeof tree!=='object')return tree;if(typeof tree.type==='function')return resolve(renderFunction(tree.type,tree.props));return {...tree,children:(tree.children||[]).flat(Infinity).map(resolve)};}
function render(){assert.ok(shown);const tree=resolve(renderFunction(shown.component,shown.props));for(const effect of renderEffects.splice(0))effect();return tree;}
function nodes(tree,type,out=[]){if(!tree||typeof tree!=='object')return out;if(tree.type===type)out.push(tree);for(const child of tree.children||[])nodes(child,type,out);return out;}
function press(tree,label){const b=nodes(tree,'Button').find(b=>b.props.accessibilityLabel===label);assert.ok(b,'button '+label);assert.ok(!b.props.disabled,'button enabled '+label);return b.props.onPress();}
function input(tree,label,value){const i=nodes(tree,'Input').find(i=>i.props.accessibilityLabel===label);assert.ok(i,label);i.props.onChangeText(value);}
try {
 const channel=h.platform.currentChannel();ui.open(channel);let tree=render();assert.equal(tree.type,'Modal');
 await press(tree,'Collections');tree=render();input(tree,'Collection name (create or rename)','Anime');tree=render();await press(tree,'New folder');tree=render();assert.equal(h.model.groups('folder')[0].name,'Anime');
 input(tree,'Collection name (create or rename)','Set');tree=render();await press(tree,'New batch from selection');tree=render();assert.equal(h.model.groups('batch')[0].name,'Set');
 await press(tree,'Browse');tree=render();await press(tree,'Add media');tree=render();await press(tree,'Anime');tree=render();await press(tree,'Set');tree=render();input(tree,'Tags, separated by commas','red, favorite');tree=render();h.setResponse({assets:[h.asset('a.jpg','a-data'),h.asset('b.jpg','b-data'),h.asset('v.mp4','v-data','video')]});await press(tree,'Choose photos and videos');tree=render();assert.equal(h.model.items().length,3);assert.ok(h.model.items().every(p=>p.tags.includes('red')));assert.equal(h.model.groups('batch')[0].ids.length,3);
 await press(tree,'Collections');tree=render();await press(tree,'Edit Set');tree=render();const before=h.model.groups('batch')[0].ids;await press(tree,'Up 2');tree=render();assert.equal(h.model.groups('batch')[0].ids[0],before[1]);
 await press(tree,'Pin Anime');tree=render();await press(tree,'Pin Set');tree=render();await press(tree,'Browse');tree=render();assert.ok(nodes(tree,'Button').some(b=>b.props.accessibilityLabel==='📁 Anime'));
 await press(tree,'Organize');tree=render();await press(tree,'Select filtered items');tree=render();input(tree,'Tags to add, separated by commas','bulk');tree=render();await press(tree,'Add tags to selected');tree=render();assert.ok(h.model.items().every(p=>p.tags.includes('bulk')));await press(tree,'Remove selected to trash');tree=render();assert.equal(h.model.items().length,0);await press(tree,'Undo');tree=render();assert.equal(h.model.items().length,3);
 for(const panel of ['Storage','Backup','Browse','Collections','Organize','Browse']){await press(tree,panel);tree=render();}
 await press(tree,'Backup');tree=render();await press(tree,'Copy metadata JSON');assert.ok(clipboard.includes('quick-media-backup'));assert.ok(!clipboard.includes('file:///'));
 for(let i=0;i<16;i++)h.model.add({id:'scroll-'+i,filename:'scroll-'+i+'.jpg',mimeType:'image/jpeg',uri:'file:///source/scroll-'+i,fileSize:10,addedAt:Date.now()+100+i});
 await press(tree,'Browse');tree=render();const list=nodes(tree,'List')[0];list.props.onScroll({nativeEvent:{contentOffset:{y:700}}});list.props.onViewableItemsChanged({viewableItems:[{isViewable:true,item:h.model.items()[1]}]});list.props.onMomentumScrollEnd();assert.equal(h.model.view(channel).offset,700);assert.equal(h.model.view(channel).anchor,h.model.items()[1].id);
 const tile=list.props.renderItem({item:h.model.items()[0]});tile.children[0].props.onLongPress();tree=render();assert.ok(nodes(tree,'Button').some(b=>b.props.accessibilityLabel==='Repair item'));
 await press(tree,'Close');unmount();h.setChannel('222222222222222222');ui.open(h.platform.currentChannel());tree=render();assert.equal(h.model.view(h.platform.currentChannel()).offset,0,'new chat does not inherit previous scroll');
 await press(tree,'Close');unmount();h.setChannel(channel);ui.open(channel);tree=render();let restored;const newList=nodes(tree,'List')[0];newList.props.ref.current={scrollToOffset:args=>{restored=args.offset;}};newList.props.onContentSizeChange();assert.ok(restored>0,'saved anchor is restored on re-entry');
 for(const p of ['Browse','Storage','Backup','Collections','Organize','Browse']){await press(tree,p);tree=render();}
}finally{unmount();h.platform.stop();}
console.log('PASS: all UI panels keep React hook order, import destinations, pinning, ordered batches, bulk Undo, metadata backup and per-chat scroll restoration.');
const output=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');assert.equal(output,fs.readFileSync(new URL('../docs/BetterMediaPicker/index.js',import.meta.url),'utf8'));const manifest=JSON.parse(fs.readFileSync(new URL('../docs/BetterMediaPicker/manifest.json',import.meta.url),'utf8'));assert.equal(manifest.version,'0.3.0');assert.equal(manifest.hash,crypto.createHash('sha256').update(output).digest('hex'));
assert.doesNotMatch(output,/^import /m);assert.doesNotMatch(output,/^export /m);
h=fixture();h.platform.stop();h.vendetta.metro.common.React=React;Object.assign(h.vendetta.metro.common.ReactNative,RN);h.vendetta.ui.alerts={showCustomAlert:()=>{}};
const plugin=vm.runInNewContext('(function(vendetta){return '+output+'\n})',{setTimeout,clearTimeout,setInterval,clearInterval})(h.vendetta);assert.equal(typeof plugin.onLoad,'function');assert.equal(typeof plugin.settings,'function');plugin.onLoad();plugin.onUnload();
console.log('PASS: distributable loader expression, lifecycle, version/hash and source parity.');
