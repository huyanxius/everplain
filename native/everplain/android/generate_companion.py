"""Extract authored Xiaoping SVG geometry/palette and exact fill-box bounds, without a Web runtime."""
import sys,re,json,math,hashlib,pathlib,xml.etree.ElementTree as ET
root=pathlib.Path(__file__).resolve().parent
source=pathlib.Path(sys.argv[1]) if len(sys.argv)>1 else pathlib.Path('/workspace/scratch/7f7bbb4d3ee6/native-parity-reference/live-source/frontend/src/modules/companion')
tsx=(source/'Companion.tsx').read_text();css=(source/'companion.css').read_text()
s='<svg viewBox="0 -10 220 224">'+tsx[tsx.index('<defs>'):tsx.index('</svg>')+6]
s=re.sub(r'\{/\*.*?\*/\}','',s,flags=re.S)
s=re.sub(r'\{Array\.from\(\{ length: 8 \}.*?\)\)\}',lambda m:'\n'.join(f'<ellipse class="cp-petal" cx="0" cy="-9" rx="3.6" ry="9" transform="rotate({i*45})" />' for i in range(8)),s,flags=re.S)
s=re.sub(r'style=\{\{\s*\'--dx\':\s*([-\d.]+),\s*\'--dy\':\s*([-\d.]+)\s*\}\s*as CSSProperties\}',r'data-dx="\1" data-dy="\2"',s)
s=re.sub(r'style=\{\{\s*stopColor:\s*\'([^\']+)\'\s*\}\}',r'stop-color="\1"',s)
s=s.replace('className=','class=').replace('clipPath=','clip-path=')
svg=ET.fromstring(s)
def union(bounds):
 bounds=[b for b in bounds if b is not None]
 return None if not bounds else [min(b[0] for b in bounds),min(b[1] for b in bounds),max(b[2] for b in bounds),max(b[3] for b in bounds)]
def roots(a,b,c):
 if abs(a)<1e-12:return [] if abs(b)<1e-12 else [-c/b]
 d=b*b-4*a*c
 return [] if d<0 else [(-b+math.sqrt(d))/(2*a),(-b-math.sqrt(d))/(2*a)]
def path_bounds(d):
 values=re.findall(r'[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?',d)
 i=0;cmd='';x=y=0;sx=sy=0;points=[]
 while i<len(values):
  if values[i].isalpha():cmd=values[i];i+=1
  op=cmd.upper();n={'M':2,'L':2,'C':6,'Q':4,'Z':0}[op]
  if op=='Z':points.append((sx,sy));x,y=sx,sy;cmd='';continue
  p=list(map(float,values[i:i+n]));i+=n
  if cmd.islower():p=[v+(x if j%2==0 else y) for j,v in enumerate(p)]
  if op in ('M','L'):
   x,y=p;points.append((x,y))
   if op=='M':sx,sy=x,y;cmd='l' if cmd.islower() else 'L'
  else:
   pts=[(x,y)]+list(zip(p[::2],p[1::2]));times=[0,1]
   for axis in (0,1):
    q=[v[axis] for v in pts]
    if op=='C':times+=roots(3*(-q[0]+3*q[1]-3*q[2]+q[3]),2*(3*q[0]-6*q[1]+3*q[2]),-3*q[0]+3*q[1])
    else:times+=roots(0,2*(q[0]-2*q[1]+q[2]),2*(q[1]-q[0]))
   for t in times:
    if 0<=t<=1:
     if op=='C':points.append(tuple((1-t)**3*pts[0][a]+3*(1-t)**2*t*pts[1][a]+3*(1-t)*t*t*pts[2][a]+t**3*pts[3][a] for a in (0,1)))
     else:points.append(tuple((1-t)**2*pts[0][a]+2*(1-t)*t*pts[1][a]+t*t*pts[2][a] for a in (0,1)))
   x,y=pts[-1]
 return [min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)]
def transform_bbox(node,b):
 if b is None:return b
 for name,args in re.findall(r'(translate|rotate)\(([^)]+)\)',node.get('transform','')):
  p=list(map(float,re.findall(r'[-\d.]+',args)))
  if name=='translate':dx=p[0];dy=p[1] if len(p)>1 else 0;b=[b[0]+dx,b[1]+dy,b[2]+dx,b[3]+dy]
  else:
   angle=math.radians(p[0]);c=math.cos(angle);s=math.sin(angle)
   if node.tag=='ellipse':
    cx=float(node.get('cx',0));cy=float(node.get('cy',0));rx=float(node.get('rx',0));ry=float(node.get('ry',0))
    x=cx*c-cy*s;y=cx*s+cy*c;w=math.hypot(rx*c,ry*s);h=math.hypot(rx*s,ry*c);b=[x-w,y-h,x+w,y+h]
   else:
    pts=[(x*c-y*s,x*s+y*c) for x in (b[0],b[2]) for y in (b[1],b[3])];b=[min(x for x,y in pts),min(y for x,y in pts),max(x for x,y in pts),max(y for x,y in pts)]
 return b
def parse(node):
 children=[parse(child) for child in node if child.tag not in ('defs','filter')]
 a=dict(node.attrib);f=lambda k,default=0:float(a.get(k,default));b=None
 if node.tag=='path':b=path_bounds(a['d'])
 elif node.tag in ('ellipse','circle'):
  rx=f('rx',f('r'));ry=f('ry',f('r'));b=[f('cx')-rx,f('cy')-ry,f('cx')+rx,f('cy')+ry]
 elif node.tag=='rect':b=[f('x'),f('y'),f('x')+f('width'),f('y')+f('height')]
 elif node.tag in ('g','svg'):b=union(c['parentBounds'] for c in children)
 return {'type':node.tag,'attributes':a,'bounds':b,'parentBounds':transform_bbox(node,b),'children':children}
palette=dict(re.findall(r'(--cp-[\w-]+):\s*(#[\da-fA-F]+)',css))
data={'source':'Everplain Companion.tsx / companion.css','sourceSha256':hashlib.sha256(tsx.encode()).hexdigest(),'cssSha256':hashlib.sha256(css.encode()).hexdigest(),'viewBox':[0,-10,220,224],'palette':palette,'defs':[parse(node) for node in svg.find('defs') if node.tag not in ('filter','clipPath')],'root':parse(svg)}
out=root/'app/src/main/assets/companion.json';out.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
check=lambda node:1+sum(check(c) for c in node['children'])
assert len(palette)==20,len(palette)
print(out,check(data['root']),'nodes',data['sourceSha256'])
