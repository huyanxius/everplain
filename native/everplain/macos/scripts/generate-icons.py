#!/usr/bin/env python3
"""Generate native geometry from exact Web Phosphor paths (per-icon weights). stdlib only."""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
source = root / 'DesignSources/web-icons.json'
data = json.loads(source.read_text())
names = data['icons']
def num(value): return format(float(value), '.13g')
def pt(values): return f'CGPoint(x:{num(values[0])},y:{num(values[1])})'
def lower(name): return name[0].lower() + name[1:]
lines = [f'// Generated from exact @phosphor-icons/react {data["sourceVersion"]} source-weight outlines (MIT).',
         '// Source SHA256 ' + hashlib.sha256(source.read_bytes()).hexdigest(), '#if os(macOS)', 'import SwiftUI',
         'enum WebIconName { case ' + ', '.join(lower(n) for n in names) + ' }',
         'struct WebIcon: View {', '    let name: WebIconName', '    var size: Double = 16.1',
         '    var body: some View { WebIconPath(name:name).fill().frame(width:size,height:size).accessibilityHidden(true) }', '}',
         'private struct WebIconPath: Shape {', '    let name: WebIconName', '    func path(in rect:CGRect)->Path {', '        var p=Path()', '        switch name {']
for name, icon in names.items():
    lines.append('        case .' + lower(name) + ':')
    for cmd in icon['nativeCommands']:
        op, v = cmd[0], cmd[1:]
        if op == 'M': code = 'p.move(to:' + pt(v) + ')'
        elif op == 'L': code = 'p.addLine(to:' + pt(v) + ')'
        elif op == 'C': code = 'p.addCurve(to:' + pt(v) + ',control1:' + pt(v[2:]) + ',control2:' + pt(v[4:]) + ')'
        elif op == 'Q': code = 'p.addQuadCurve(to:' + pt(v) + ',control:' + pt(v[2:]) + ')'
        elif op == 'A': code = f'p.addArc(center:.zero,radius:{num(v[2])},startAngle:.degrees({num(v[5])}),endAngle:.degrees({num(v[5]+v[6])}),clockwise:{str(v[6]<0).lower()},transform:CGAffineTransform(translationX:{num(v[0])},y:{num(v[1])}).rotated(by:{num(v[4])} * .pi / 180).scaledBy(x:1,y:{num(v[3]/v[2])}))'
        elif op == 'Z': code = 'p.closeSubpath()'
        else: raise ValueError(op)
        lines.append('            ' + code)
lines += ['        }', '        return p.applying(CGAffineTransform(scaleX:rect.width/256,y:rect.height/256))', '    }', '}', '#endif', '']
result = '\n'.join(lines)
target = root / 'Sources/EverplainMac/WebIcons.swift'
if '--check' in sys.argv:
    assert target.read_text() == result, 'Generated icon geometry drift'
else:
    target.write_text(result)
print(f'Verified {len(names)} exact native icon outlines' if '--check' in sys.argv else f'Generated {len(names)} native icon outlines')
