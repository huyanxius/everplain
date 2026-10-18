#!/usr/bin/env python3
"""Generate native Path declarations from the shared Web-extracted vector source."""
import json, pathlib, sys
root=pathlib.Path(__file__).resolve().parents[1]
source=root.parent/'tokens/assets/avatars.json'
data=json.loads(source.read_text())
def v(x): return repr(float(x))
def point(c,x='x',y='y'):return f'CGPoint(x:{v(c[x])},y:{v(c[y])})'
def path(commands):
    code=['{ var p=Path()']
    for c in commands:
        op=c['op']
        if op=='M':line=f'p.move(to:{point(c)})'
        elif op=='L':line=f'p.addLine(to:{point(c)})'
        elif op=='Q':line=f'p.addQuadCurve(to:{point(c)},control:{point(c,"x1","y1")})'
        elif op=='C':line=f'p.addCurve(to:{point(c)},control1:{point(c,"x1","y1")},control2:{point(c,"x2","y2")})'
        elif op=='A':
            assert c['rx']==c['ry'] and c['rotation']==0
            line=f'p.addArc(center:{point(c,"cx","cy")},radius:{v(c["rx"])},startAngle:.degrees({v(c["startAngleDegrees"])}),endAngle:.degrees({v(c["startAngleDegrees"]+c["sweepAngleDegrees"])}),clockwise:{str(c["sweepAngleDegrees"]<0).lower()})'
        elif op=='Z':line='p.closeSubpath()'
        else:raise ValueError(op)
        code.append(line)
    return '; '.join(code)+'; return p }()'
lines=['// Generated from tokens/assets/avatars.json; source SHA256 '+data['source_sha256'], '#if os(macOS)', 'import SwiftUI', 'struct AvatarDecoration { let path:Path; let fill:String; let opacity:Double; let strokeWidth:Double }', 'struct AvatarPreset { let id:String; let name:String; let color:String; let look:CGPoint; let gazeOrigin:CGPoint; let nose:Bool; let body:Path; let behind:[AvatarDecoration] }', 'enum AvatarData { static let presets:[AvatarPreset] = [']
for preset in data['presets']:
    decorations=[]
    for d in preset['behind']:
        if d['type']=='circle':
            geom=f'Path(ellipseIn:CGRect(x:{v(d["cx"]-d["r"])},y:{v(d["cy"]-d["r"])},width:{v(2*d["r"])},height:{v(2*d["r"])}))'
        else:geom=path(d['commands'])
        decorations.append(f'AvatarDecoration(path:{geom},fill:{json.dumps(d.get("stroke",d["fill"]))},opacity:{v(d["opacity"])},strokeWidth:{v(d.get("strokeWidth",0))})')
    lines.append('AvatarPreset(id:'+json.dumps(preset['id'])+',name:'+json.dumps(preset['name'],ensure_ascii=False)+',color:'+json.dumps(preset['color'])+',look:'+point(preset['look'])+',gazeOrigin:'+point(preset['gazeOrigin'])+',nose:'+str(preset['nose']).lower()+',body:'+path(preset['commands'])+',behind:['+','.join(decorations)+']),')
lines+= ['] }','#endif','']
output='\n'.join(lines)
destination=root/'Sources/EverplainMac/AvatarData.swift'
if '--check' in sys.argv:
    assert destination.read_text()==output,'Generated avatar data drift'
else:destination.write_text(output)
print('Verified seven native avatar paths' if '--check' in sys.argv else 'Generated seven native avatar paths')
