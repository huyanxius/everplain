// Synthetic, offline graph fixtures. Runs the same trusted script bundle as JavaScriptCore.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const directory = path.resolve(__dirname, '../../Sources/EverplainMac/Resources/GraphLayout');
const context = vm.createContext({});
for (const file of ['native-layout-bridge.js', 'cytoscape-3.34.0.min.js', 'web-graph-source.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context, {filename:file});
assert.equal(context.cytoscape.version,'3.34.0');
const palette = Object.fromEntries(['faint','surface','ink-soft','info','rule','warning','rule-strong','ink','muted','accent-hover'].map(key=>[key,[100,120,90,1]]));
function run(input) { return JSON.parse(context.__nativeGraphLayout(JSON.stringify({width:900,height:600,palette,...input}))); }
function verify(result,count) {
  assert.equal(result.nodes.length,count); assert.ok(Number.isFinite(result.zoom)&&result.zoom>=.16&&result.zoom<=3.2);
  for(const node of result.nodes) for(const key of ['x','y','width','height','opacity','fontSize']) assert.ok(Number.isFinite(node[key]),key);
}
let actual=vm.runInContext('layoutOptions(false,true,false,560,false)',context);
for(const [key,value] of Object.entries({name:'cose',animate:false,componentSpacing:56,edgeElasticity:120,gravity:.34,idealEdgeLength:54,nestingFactor:1.15,nodeOverlap:14,nodeRepulsion:90000,numIter:800,padding:72,randomize:true})) assert.equal(actual[key],value,key);
const personal={personal:true,nodes:[{id:'self',label:'Synthetic root',nodeType:'self',level:0},{id:'t',label:'Synthetic topic',nodeType:'topic',level:1},{id:'d',label:'Synthetic document',nodeType:'document',level:2},{id:'k',label:'Synthetic knowledge',nodeType:'knowledge',level:3}],edges:[{id:'e1',source:'self',target:'t',relationType:'topic',direction:'directed',layer:'structure'},{id:'e2',source:'t',target:'d',relationType:'source',direction:'directed',layer:'structure'},{id:'e3',source:'d',target:'k',relationType:'evidence',direction:'directed',layer:'structure'}]};
const p=run(personal); verify(p,4); assert.equal(p.algorithm,'concentric'); assert.equal(p.nodes[0].width,70); assert.equal(p.nodes[1].width,18); assert.equal(p.nodes[3].width,6);
const resized=run({...personal,width:1200,height:800}); verify(resized,4); assert.notEqual(resized.pan.x,p.pan.x);
const library={personal:false,nodes:[{id:'root',label:'Synthetic library',nodeType:'dimension',level:0},{id:'doc',label:'Synthetic document',nodeType:'category',level:1},{id:'a',label:'A',nodeType:'entry',level:2},{id:'b',label:'B',nodeType:'entry',level:2}],edges:[{id:'root-doc',source:'root',target:'doc',relationType:'资料',direction:'directed',layer:'structure'},{id:'doc-a',source:'doc',target:'a',relationType:'涉及',direction:'directed',layer:'structure'},{id:'a-b',source:'a',target:'b',relationType:'合成关系',direction:'bidirectional',layer:'candidate'}]};
const l=run(library); verify(l,4); assert.equal(l.algorithm,'cose'); assert.equal(l.nodes[0].width,20); assert.equal(l.nodes[1].width,12);
const edge=l.edges.find(e=>e.id==='a-b'); assert.equal(edge.label,'候选 · 合成关系'); assert.equal(edge.dashed,true); assert.equal(edge.sourceArrow,true); assert.equal(edge.targetArrow,true);
const focused=run({...library,focusNodeId:'a'}); verify(focused,4); assert.equal(focused.nodes.find(n=>n.id==='a').width,16); assert.equal(focused.nodes.find(n=>n.id==='root').textOpacity,0); assert.ok(focused.zoom>=.8);
const isolated=run({personal:false,nodes:library.nodes,edges:[]}); verify(isolated,4); assert.equal(isolated.algorithm,'circle');
const maliciousLabel='"; globalThis.userTextExecuted = true; //'; const literal=run({personal:false,nodes:[{id:'literal',label:maliciousLabel,nodeType:'entry',level:2}],edges:[]}); verify(literal,1); assert.equal(context.userTextExecuted,undefined);
const many=Array.from({length:150},(_,i)=>({id:'n'+i,label:'Synthetic '+i,nodeType:i===0?'dimension':'entry',level:Math.min(2,i)}));
verify(run({personal:false,nodes:many,edges:many.slice(1).map((n,i)=>({id:'edge'+i,source:'n'+Math.floor(i/3),target:n.id,relationType:'synthetic',direction:'directed',layer:'structure'}))}),150);
const empty=run({personal:false,nodes:[],edges:[]}); assert.equal(empty.nodes.length,0); assert.equal(empty.algorithm,'empty');
console.log('PASS official locked Cytoscape version and exact Web layout parameters');
console.log('PASS concentric/COSE/circle, viewport sizes, node dimensions, focus styles, candidate arrows');
console.log('PASS literal user labels, empty graph, finite 150-node graph (no DOM or network)');
