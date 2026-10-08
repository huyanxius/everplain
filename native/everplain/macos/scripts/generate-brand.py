#!/usr/bin/env python3
from pathlib import Path
import re,xml.etree.ElementTree as ET,sys
root=Path(__file__).resolve().parents[1]
paths=ET.parse(root/'DesignSources/brand.svg').getroot().findall('{http://www.w3.org/2000/svg}path')
lines=['// Exact original Web brand mask converted to native paths.','// Source: DesignSources/brand.svg','#if os(macOS)','import SwiftUI','struct BrandMark: Shape {','func path(in rect:CGRect)->Path {','var p=Path()']
for path in paths:
 tokens=re.findall(r'[A-Za-z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?',path.attrib['d']);i=0;op='';x=y=0;sx=sy=0
 while i<len(tokens):
  if tokens[i].isalpha():op=tokens[i];i+=1
  n={'M':2,'L':2,'H':1,'V':1,'C':6,'Z':0}[op.upper()]
  if n==0:lines.append('p.closeSubpath()');x,y=sx,sy;continue
  vals=list(map(float,tokens[i:i+n]));i+=n;rel=op.islower();code=op.upper()
  if code=='H':x=vals[0]+(x if rel else 0);lines.append(f'p.addLine(to:CGPoint(x:{x},y:{y}))')
  elif code=='V':y=vals[0]+(y if rel else 0);lines.append(f'p.addLine(to:CGPoint(x:{x},y:{y}))')
  elif code=='C':
   coords=[(vals[j]+(x if rel else 0),vals[j+1]+(y if rel else 0)) for j in [0,2,4]]
   (x1,y1),(x2,y2),(x,y)=coords;lines.append(f'p.addCurve(to:CGPoint(x:{x},y:{y}),control1:CGPoint(x:{x1},y:{y1}),control2:CGPoint(x:{x2},y:{y2}))')
  else:
   x,y=vals[0]+(x if rel else 0),vals[1]+(y if rel else 0)
   lines.append(f'p.{"move" if code=="M" else "addLine"}(to:CGPoint(x:{x},y:{y}))')
   if code=='M':sx,sy=x,y;op='l' if rel else 'L'
lines+=['return p.applying(CGAffineTransform(scaleX:rect.width/40,y:rect.height/40))','}','}','#endif','']
data='\n'.join(lines);dest=root/'Sources/EverplainMac/BrandMark.swift'
if '--check' in sys.argv: assert dest.read_text()==data
else:dest.write_text(data)
