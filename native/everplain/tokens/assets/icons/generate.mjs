// Generate exact artwork from the pinned package and the Web's own NavIcon set.
// Native consumers render these vectors; there is no React runtime in the apps.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const ts=createRequire(import.meta.url)(process.argv[2] || 'typescript');
const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat().filter(x=>x!=null)});
const flatten=n=>n.tag==='Fragment'?n.children.flatMap(flatten):[{type:n.tag,attributes:n.props,...(n.children.length?{children:n.children.flatMap(flatten)}:{})}];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const source=JSON.parse(fs.readFileSync(path.join(root,'SOURCE.json')));
const phosphor={};
for(const name of source.names){
 const raw=fs.readFileSync(path.join(root,'source/phosphor',name+'.es.js'),'utf8');
 const alias=raw.match(/import \* as (\w+) from "react";/)[1];
 const map=raw.match(/const (\w+) =[^\n]*new Map/)[1];
 const code=raw.replace(/import \* as \w+ from "react";/,'').replace(/export\s*\{[\s\S]*?\};/,'')+`\nresult = ${map}.get('regular');`;
 const ctx={[alias]:{createElement:h,Fragment:'Fragment'},result:null};
 vm.runInNewContext(code,ctx,{timeout:1000,filename:name+'.es.js'});
 phosphor[name]={viewBox:[0,0,256,256],fill:'currentColor',sourceSha256:sha(raw),nodes:flatten(ctx.result)};
}
const navRaw=fs.readFileSync(path.join(root,'source/NavIcon.tsx'),'utf8');
const navCode=ts.transpileModule(navRaw+'\nexport const sourceShapes = shapes;', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'Fragment'}}).outputText;
const navContext={exports:{},h,Fragment:'Fragment'};
vm.runInNewContext(navCode,navContext,{timeout:1000,filename:'NavIcon.tsx'});
const navigation=Object.fromEntries(Object.entries(navContext.exports.sourceShapes).map(([name,node])=>[name,{viewBox:[0,0,24,24],fill:'none',stroke:'currentColor',strokeWidth:1.75,strokeLinecap:'round',strokeLinejoin:'round',nodes:flatten(node)}]));
const data={sourcePackage:source.package,sourceVersion:source.version,navSourceSha256:sha(navRaw),navigation,phosphor};
fs.writeFileSync(path.join(root,'icons.json'),JSON.stringify(data,null,2)+'\n');
fs.mkdirSync(path.join(root,'svg'),{recursive:true});
const xmlEscape=s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const attr=k=>k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
const nodeXml=n=>`<${n.type} ${Object.entries(n.attributes).filter(([k])=>k!=='key').map(([k,v])=>`${attr(k)}="${xmlEscape(v)}"`).join(' ')}>${(n.children||[]).map(nodeXml).join('')}</${n.type}>`;
for(const [family,icons] of Object.entries({navigation,phosphor}))for(const [name,icon]of Object.entries(icons)){
 const attrs=Object.entries(icon).filter(([k])=>!['nodes','viewBox','sourceSha256'].includes(k)).map(([k,v])=>`${attr(k)}="${xmlEscape(v)}"`).join(' ');
 fs.writeFileSync(path.join(root,'svg',family+'-'+name+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.viewBox.join(' ')}" ${attrs}>${icon.nodes.map(nodeXml).join('')}</svg>\n`);
}
console.log(`Generated ${Object.keys(navigation).length} exact Web navigation icons and ${Object.keys(phosphor).length} pinned Phosphor regular icons.`);
