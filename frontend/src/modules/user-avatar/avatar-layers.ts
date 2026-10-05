import { ACC, AHOGE, HAIR, LOCKS, STRANDS, type UserAvatarPerson } from './avatar-data'

// Trusted SVG fragments only; colors come from the validated presets/overrides.
export function renderAvatarLayers(p: UserAvatarPerson, u: string, head: boolean): string {
 const bangs=[...(p.bangs||'')].map(k=>STRANDS[k]).join('')
 return ` <defs><radialGradient id="${u}f" cx="42%" cy="40%" r="70%"><stop offset="0%" stop-color="${p.faceLight||'#fffaf5'}"/><stop offset="100%" stop-color="${p.face||'#f6ece2'}"/></radialGradient>
 <linearGradient id="${u}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.sleeveLight}"/><stop offset="100%" stop-color="${p.sleeve}"/></linearGradient>
 <linearGradient id="${u}sf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.frontLight}"/><stop offset="100%" stop-color="${p.front}"/></linearGradient>
 <linearGradient id="${u}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${p.faceLight||'#fffaf5'}"/><stop offset="100%" stop-color="${p.handShade||'#f0dccb'}"/></linearGradient>
 <clipPath id="${u}face-clip"><ellipse cx="100" cy="127" rx="57" ry="52"/></clipPath>
 <filter id="${u}soft-edge" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="0.8"/></filter>
 <filter id="${u}soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3"/></filter></defs>
 ${head?'':(p.fxBack||'')}<g class="cp-rest"><g class="cp-bob">
  ${p.acc==='bun'?ACC.bun:''}
  <g class="cp-layer" style="--dx:-7;--dy:-2"><g class="cp-sway-slow"><path class="cp-hair-back" d="${p.backPath||HAIR[p.back]}"/></g></g>${p.behind||''}
  ${p.ears?`<g class="cp-layer" style="--dx:2;--dy:1">${p.ears}</g>`:''}
  <g class="cp-layer" style="--dx:4;--dy:1"><ellipse cx="100" cy="127" rx="57" ry="52" fill="url(#${u}f)"/></g>
  <g class="cp-layer" style="--dx:8;--dy:2"><ellipse class="cp-blush" cx="64" cy="153" rx="12" ry="7"/><ellipse class="cp-blush" cx="136" cy="153" rx="12" ry="7"/></g>
  <g class="cp-layer" style="--dx:11;--dy:5"><g class="cp-eyes"><rect class="cp-eye" x="72.5" y="112" width="12.5" height="33" rx="6.25"/><rect class="cp-eye" x="115" y="112" width="12.5" height="33" rx="6.25"/></g><g class="cp-happy"><path d="M71 132 Q79 120 87 132"/><path d="M114 132 Q122 120 130 132"/></g></g>
  <g class="cp-layer" style="--dx:3;--dy:0"><path class="cp-hair" d="${p.crown||'M32 110 C28 56 62 30 102 30 C146 30 174 58 170 112 C158 92 134 82 104 82 C76 82 50 92 32 110 Z'}"/></g>
  <g class="cp-layer" style="--dx:7;--dy:1"><path class="cp-face-shade" clip-path="url(#${u}face-clip)" d="M50 100 C72 112 130 112 152 102 L150 116 C128 124 74 124 52 114 Z"/>${p.noBase?'':'<path class="cp-hair" d="M32 110 C46 90 74 82 104 82 C134 82 158 92 170 112 C162 106 154 104 146 106 C138 100 128 102 120 104 C112 100 102 102 96 104 C88 100 78 102 70 106 C62 102 52 104 46 108 C40 106 36 108 32 110 Z"/>'}${p.strands||bangs}</g>
  ${p.locks===1?LOCKS:p.locks?`<g class="cp-layer" style="--dx:5;--dy:0">${p.locks}</g>`:''}${p.ahoge===1?AHOGE:p.ahoge?`<g class="cp-layer" style="--dx:9;--dy:-1"><g class="cp-ahoge">${p.ahoge}</g></g>`:''}${p.extra?`<g class="cp-layer" style="--dx:8;--dy:0">${p.extra}</g>`:''}${p.acc&&p.acc!=='bun'?ACC[p.acc]:''}
 </g>
 ${head?'':`<g class="cp-arms">
  <path fill="url(#${u}s)" d="M-4 216 C0 196 18 184 44 180 C72 176 104 174 126 176 L124 204 C100 208 60 212 30 216 Z"/>
  <path class="cp-fold" d="M60 182 C70 188 76 196 78 206"/><path class="cp-fold" d="M96 178 C102 184 106 192 106 201"/>
  <path class="cp-cuff" d="M124 175 C131 173 138 174 142 177 C145 186 145 196 141 203 C135 205 128 205 123 203 C126 194 126 184 124 175 Z"/>
  <path class="cp-rib" d="M130 176 C131 185 131 194 129 203 M135 176 C136 185 136 194 134 204 M139.5 177 C140.5 186 140.5 195 138.5 203"/>
  <path fill="url(#${u}h)" d="M140 179 C150 176 160 178 165 184 C169 189 168 196 163 199 C157 202 149 202 142 200 C144 193 144 186 140 179 Z"/>
  <path class="cp-finger" d="M150 184 C153 188 154 193 153 198 M156.5 185.5 C159.5 189 160.5 193 159.5 197.5"/>
  <ellipse class="cp-chin-shadow" cx="112" cy="181" rx="44" ry="6"/>
  <path fill="url(#${u}sf)" d="M224 218 C222 200 206 188 182 186 C156 184 126 184 104 187 L104 214 C130 216 170 218 224 218 Z"/>
  <path class="cp-fold" d="M160 189 C152 194 148 202 147 212"/><path class="cp-fold" d="M190 190 C184 196 181 204 181 214"/>
  <path class="cp-cuff" d="M106 186 C99 185 92 187 88 190 C85 199 85 207 88 213 C94 215 101 215 106 213 C104 205 104 194 106 186 Z"/>
  <path class="cp-rib" d="M100.5 187 C99.5 196 99.5 205 100.5 213.5 M96 188 C95 197 95 206 96 214 M91.5 189 C90.5 198 90.5 206 91.5 213"/>
  <path fill="url(#${u}h)" d="M90 190 C80 187 69 189 64 195 C60 200 61 206 66 209 C72 212 81 212 89 210 C87 203 87 196 90 190 Z"/>
  <path class="cp-finger" d="M79 194 C76 198 75 203 76 208 M72 196 C69 199 68 203 69 207"/></g>`}
 </g>${head?'':(p.fx||'')}`
}

