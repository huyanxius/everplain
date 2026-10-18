// Extract trusted checked-in TSX geometry without React or a WebView runtime.
// Usage: node tokens/assets/generate.mjs /path/to/typescript/lib/typescript.js
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root=path.dirname(fileURLToPath(import.meta.url))
const require=createRequire(import.meta.url)
const ts=require(process.argv[2] || 'typescript')
const source=fs.readFileSync(path.join(root,'source/avatars.tsx'),'utf8')
const css=fs.readFileSync(path.join(root,'source/agent-avatar.css'),'utf8')
const h=(tag,props,...children)=>({tag,props:props||{},children:children.flat().filter(x=>x!=null)})
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h'}}).outputText
const context={exports:{},h}
vm.runInNewContext(code,context,{timeout:1000,filename:'avatars.tsx'})
const presets=context.exports.agentAvatarPresets

// SVG endpoint-arc -> center parameterization, per SVG implementation notes.
// This source uses circular unrotated arcs; retain general rx/ry/rotation.
function arc(x1,y1,rx,ry,rotation,large,sweep,x2,y2){
  rx=Math.abs(rx);ry=Math.abs(ry)
  const phi=rotation*Math.PI/180,c=Math.cos(phi),s=Math.sin(phi)
  const xp=c*(x1-x2)/2+s*(y1-y2)/2,yp=-s*(x1-x2)/2+c*(y1-y2)/2
  const scale=xp*xp/(rx*rx)+yp*yp/(ry*ry)
  if(scale>1){rx*=Math.sqrt(scale);ry*=Math.sqrt(scale)}
  const sign=large===sweep?-1:1
  const f=sign*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*yp*yp-ry*ry*xp*xp)/(rx*rx*yp*yp+ry*ry*xp*xp)))
  const cxp=f*rx*yp/ry,cyp=-f*ry*xp/rx
  const cx=c*cxp-s*cyp+(x1+x2)/2,cy=s*cxp+c*cyp+(y1+y2)/2
  const u=[(xp-cxp)/rx,(yp-cyp)/ry],v=[(-xp-cxp)/rx,(-yp-cyp)/ry]
  const start=Math.atan2(u[1],u[0]);let delta=Math.atan2(u[0]*v[1]-u[1]*v[0],u[0]*v[0]+u[1]*v[1])
  if(!sweep&&delta>0)delta-=2*Math.PI
  if(sweep&&delta<0)delta+=2*Math.PI
  return {op:'A',cx,cy,rx,ry,rotation,startAngleDegrees:start*180/Math.PI,sweepAngleDegrees:delta*180/Math.PI,x:x2,y:y2}
}
function commands(d){
  const t=d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)||[]
  let i=0,x=0,y=0,mx=0,my=0;const out=[]
  const n=()=>Number(t[i++])
  while(i<t.length){
    const op=t[i++]
    if(op==='M'||op==='L'){x=n();y=n();if(op==='M'){mx=x;my=y}out.push({op,x,y})}
    else if(op==='H'){x=n();out.push({op:'L',x,y})}
    else if(op==='V'){y=n();out.push({op:'L',x,y})}
    else if(op==='C'){const x1=n(),y1=n(),x2=n(),y2=n();x=n();y=n();out.push({op,x1,y1,x2,y2,x,y})}
    else if(op==='Q'){const x1=n(),y1=n();x=n();y=n();out.push({op,x1,y1,x,y})}
    else if(op==='A'){const rx=n(),ry=n(),rot=n(),large=n(),sweep=n(),x2=n(),y2=n();out.push(arc(x,y,rx,ry,rot,large,sweep,x2,y2));x=x2;y=y2}
    else if(op==='Z'||op==='z'){out.push({op:'Z'});x=mx;y=my}
    else throw Error('Unsupported path command '+op)
  }
  if(out.some(c=>Object.values(c).some(v=>typeof v==='number'&&!Number.isFinite(v))))throw Error('Nonfinite geometry')
  return out
}
function geometry(node,inherited='body'){
  const p=node.props,role=p.className==='aa-inner'?'inner':p.className==='aa-ink-fill'?'ink':inherited
  if(node.tag==='g')return node.children.flatMap(n=>geometry(n,role))
  const v={type:node.tag,fill:p.fill==='none'?'none':role,opacity:role==='ink'?.8:1}
  if(p.stroke){v.stroke='body';v.strokeWidth=Number(p.strokeWidth||1);v.strokeLinecap=p.strokeLinecap||'butt';v.fill='none'}
  for(const k of ['cx','cy','r','rx','ry','x','y','width','height'])if(p[k]!=null)v[k]=Number(p[k])
  if(p.d){v.path=p.d;v.commands=commands(p.d)}
  return [v]
}
// Björn Ottosson's reference Oklab matrices; match CSS color-mix(in oklab).
const linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4
const srgb=x=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055
function lab(hex){const [r,g,b]=hex.match(/[a-f\d]{2}/gi).map(x=>linear(parseInt(x,16)/255));const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b),m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b),s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s]}
function rgb([L,a,b]){const l=(L+.3963377774*a+.2158037573*b)**3,m=(L-.1055613458*a-.0638541728*b)**3,s=(L-.0894841775*a-1.291485548*b)**3;return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s].map(x=>Math.max(0,Math.min(1,srgb(x))))}
function inner(hex){const a=lab(hex),b=lab('#1b1a24');return rgb(a.map((x,i)=>.78*x+.22*b[i]))}
const output={source_sha256:crypto.createHash('sha256').update(source).digest('hex'),css_sha256:crypto.createHash('sha256').update(css).digest('hex'),viewBox:[0,0,120,120],ink:{hex:'#16141f',opacity:.86},innerMix:{space:'oklab',mixColor:'#1b1a24',mixWeight:.22},eyes:{offsetX:[-6.6,6.6],x:-3.6,y:-8,width:7.2,height:16,cornerRadius:3.6,defaultGazeDegrees:-14,happyPath:'M-4.4 2 Q0 -5.5 4.4 2',happyStrokeWidth:3.6},nose:{cx:0,cy:10.5,rx:2.6,ry:1.9},states:['idle','think','work','greet'],presets:presets.map(p=>({id:p.id,name:p.name,color:p.color,innerDefaultRgb:inner(p.color),path:p.shape,commands:commands(p.shape),look:p.look,gazeOrigin:{x:0,y:p.nose?2.2:0},nose:!!p.nose,behind:p.behind?geometry(p.behind()):[]}))}
fs.writeFileSync(path.join(root,'avatars.json'),JSON.stringify(output,null,2)+'\n')
fs.mkdirSync(path.join(root,'svg'),{recursive:true})
for(const p of output.presets){
 const innerColor='rgb('+p.innerDefaultRgb.map(v=>(v*100).toFixed(10)+'%').join(' ')+')'
 const fill=role=>role==='ink'?output.ink.hex:role==='inner'?innerColor:role==='none'?'none':p.color
 const layers=p.behind.map(s=>'<'+s.type+' '+Object.entries(s).filter(([k])=>!['type','commands','path','fill','stroke','strokeWidth','strokeLinecap'].includes(k)).map(([k,v])=>`${k}="${v}"`).join(' ')+` fill="${fill(s.fill)}"`+(s.path?` d="${s.path}"`:'')+(s.stroke?` stroke="${fill(s.stroke)}" stroke-width="${s.strokeWidth}" stroke-linecap="${s.strokeLinecap}"`:'')+'/>').join('')
 const eyes=output.eyes.offsetX.map(x=>`<rect x="${x-3.6}" y="-8" width="7.2" height="16" rx="3.6"/>`).join('')
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><title>${p.name}</title>${layers}<path d="${p.path}" fill="${p.color}"/><g transform="translate(${p.look.x} ${p.look.y})"><g transform="rotate(-14 0 ${p.gazeOrigin.y})" fill="#16141f" opacity=".86">${eyes}${p.nose?'<ellipse cx="0" cy="10.5" rx="2.6" ry="1.9"/>':''}</g></g></svg>\n`
 fs.writeFileSync(path.join(root,'svg',p.id+'.svg'),svg)
}
console.log('Extracted '+output.presets.length+' authentic avatar presets + static SVG/native arc geometry.')
