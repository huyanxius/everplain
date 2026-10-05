/** Original illustration paths from the supplied offline prototype. */
export type UserAvatarId = 'xiaoping' | 'mo' | 'silver' | 'sand' | 'cat' | 'hime'

/** Persisted overrides. Missing values keep that character's original appearance. */
export type UserAvatarCustom = {
  hair?: string
  skin?: string
  sleeve?: string
  blush?: boolean
}

export type UserAvatarPerson = {
  readonly id: UserAvatarId
  readonly hair: string
  readonly hairBack: string
  readonly hairShade: string
  readonly sleeve: string
  readonly sleeveLight: string
  readonly front: string
  readonly frontLight: string
  readonly fold: string
  readonly back?: string
  readonly backPath?: string
  readonly bangs?: string
  readonly crown?: string
  readonly noBase?: number
  readonly locks?: number | string
  readonly ahoge?: number | string
  readonly acc?: string
  readonly hat?: string
  readonly hatBand?: string
  readonly face?: string
  readonly faceLight?: string
  readonly handShade?: string
  readonly blush?: number
  readonly ears?: string
  readonly strands?: string
  readonly behind?: string
  readonly extra?: string
  readonly fxBack: string
  readonly fx: string
  readonly fxClass: string
}

export const HAIR: Readonly<Record<string, string>> = {
 long:'M20 120 C14 54 56 20 102 20 C152 20 190 56 182 124 C180 156 188 182 196 214 L6 214 C16 182 24 156 20 120 Z',
 bob:'M22 118 C16 54 56 22 102 22 C150 22 188 54 180 120 C178 146 184 166 190 182 C170 192 150 188 140 180 L62 180 C52 188 30 192 12 182 C18 166 24 146 22 118 Z',
 // 短发贴着头顶收进脸里，两侧不留鼓包；早先那版两侧垂到下巴再平切，戴上像头盔
 short:'M34 118 C28 58 60 26 102 26 C144 26 176 58 168 118 C160 104 150 98 140 96 L64 96 C54 98 42 104 34 118 Z',
}
export const STRANDS: Readonly<Record<string, string>> = {
 a:'<g class="cp-strand cp-strand--a"><path class="cp-hair" d="M44 92 C54 102 60 118 58 136 C52 122 42 114 32 112 C34 104 38 96 44 92 Z"/></g>',
 b:'<g class="cp-strand cp-strand--b"><path class="cp-hair" d="M60 78 C78 88 86 106 84 128 C78 114 68 106 52 102 C52 92 55 84 60 78 Z"/><path class="cp-hair-shade" d="M70 90 C78 98 82 108 82 120 C76 110 70 104 62 100 Z"/></g>',
 c:'<g class="cp-strand cp-strand--c"><path class="cp-hair" d="M80 72 C104 78 114 98 108 122 C102 108 92 100 78 96 C78 88 78 80 80 72 Z"/><path class="cp-hair" d="M108 72 C134 76 148 94 150 120 C140 106 128 98 112 96 C114 88 112 80 108 72 Z"/><path class="cp-hair" d="M140 82 C156 92 164 108 162 128 C156 116 148 110 138 108 C140 100 140 90 140 82 Z"/></g>',
 // 男生的短刘海：三缕往一边扫，止在眉上，不盖眼睛
 m:'<g class="cp-strand cp-strand--b"><path class="cp-hair" d="M48 96 C66 80 92 78 110 88 C96 90 80 96 70 108 C64 102 56 98 48 96 Z"/><path class="cp-hair" d="M86 80 C112 72 140 80 156 100 C140 94 122 94 106 100 C102 92 96 86 86 80 Z"/><path class="cp-hair-shade" d="M94 84 C110 82 124 86 134 92 C120 92 108 94 100 98 Z"/></g>',
}
export const LOCKS='<g class="cp-layer" style="--dx:5;--dy:0"><g class="cp-lock cp-lock--left"><path class="cp-hair" d="M40 98 C34 128 36 162 47 196 C36 190 26 166 24 136 C23 118 30 104 40 98 Z"/></g><g class="cp-lock cp-lock--right"><path class="cp-hair" d="M160 98 C166 128 164 162 153 196 C164 190 174 166 176 136 C177 118 170 104 160 98 Z"/></g></g>'
export const SIDEBURNS='<g class="cp-layer" style="--dx:5;--dy:0"><path class="cp-hair" d="M44 98 C39 114 39 130 44 146 C37 141 33 126 34 114 C35 106 39 101 44 98 Z"/><path class="cp-hair" d="M156 98 C161 114 161 130 156 146 C163 141 167 126 166 114 C165 106 161 101 156 98 Z"/></g>'
export const AHOGE='<g class="cp-layer" style="--dx:9;--dy:-1"><g class="cp-ahoge"><path class="cp-hair" d="M98 32 C92 14 98 0 114 -4 C106 4 104 14 108 26 C112 18 120 14 128 16 C118 20 110 28 106 36 Z"/></g></g>'
export const ACC: Readonly<Record<string, string>> = {
 flower:'<g class="cp-layer" style="--dx:8;--dy:0"><g class="cp-ribbon"><path class="cp-ribbon-tail" d="M150 86 L166 136 L156 132 L150 142 L142 92 Z"/><path class="cp-star" d="M156 116 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z"/></g><g transform="translate(150 78)">'+Array.from({length:8},(_,i)=>`<ellipse class="cp-petal" cx="0" cy="-9" rx="3.6" ry="9" transform="rotate(${i*45})"/>`).join('')+'<circle class="cp-flower-heart" r="4"/></g></g>',
 glasses:'<g class="cp-layer" style="--dx:11;--dy:5"><rect class="cp-ink" x="61" y="111" width="35" height="35" rx="14"/><rect class="cp-ink" x="104" y="111" width="35" height="35" rx="14"/><path class="cp-ink" d="M96 126 Q100 122 104 126"/></g>',
 phones:'<g class="cp-layer" style="--dx:3;--dy:0"><path d="M30 118 C26 52 62 22 102 22 C142 22 176 52 170 118" fill="none" stroke="#3d3d3a" stroke-width="9" stroke-linecap="round"/><rect x="16" y="104" width="24" height="44" rx="11" fill="#3d3d3a"/><rect x="160" y="104" width="24" height="44" rx="11" fill="#3d3d3a"/><rect x="22" y="110" width="8" height="32" rx="4" fill="#5c5c58"/><rect x="170" y="110" width="8" height="32" rx="4" fill="#5c5c58"/></g>',
 beanie:'<g class="cp-layer" style="--dx:3;--dy:0"><path d="M34 96 C30 48 62 22 102 22 C142 22 172 48 168 96 Z" fill="var(--hat)"/><path d="M30 92 C60 82 144 82 172 92 L172 106 C144 96 60 96 30 106 Z" fill="var(--hat-band)"/><circle cx="102" cy="18" r="11" fill="var(--hat-band)"/></g>',
 beret:'<g class="cp-layer" style="--dx:2;--dy:0"><g transform="rotate(-14 112 40)"><ellipse cx="112" cy="40" rx="50" ry="17" fill="var(--hat)"/><path d="M66 44 C80 52 144 52 158 44" fill="none" stroke="var(--hat-band)" stroke-width="3" stroke-linecap="round"/><path d="M112 23 l2 -9" stroke="var(--hat)" stroke-width="4" stroke-linecap="round"/></g></g>',
 bun:'<g class="cp-layer" style="--dx:-4;--dy:-1"><g class="cp-sway-slow"><circle cx="104" cy="22" r="22" class="cp-hair"/><path class="cp-hair-shade" d="M90 30 C98 36 112 36 120 28 C116 38 94 40 90 30 Z"/></g></g>',
 clip:'<g class="cp-layer" style="--dx:8;--dy:0"><rect x="138" y="84" width="22" height="7" rx="3.5" fill="#c98a63" transform="rotate(-24 149 88)"/></g>',
}
export const PEOPLE: readonly UserAvatarPerson[] = [
 {id:'xiaoping',back:'long',bangs:'abc',locks:1,ahoge:1,acc:'flower',hair:'#e6d8c5',hairBack:'#d9c7b0',hairShade:'#d6c3aa',sleeve:'#66728a',sleeveLight:'#8592a8',front:'#707d94',frontLight:'#909db2',fold:'#56617a',fxBack:'',fx:'<g transform="translate(170 112)"><path class="fx-twinkle" d="M0 -7 l1.8 5.2 5.2 1.8 -5.2 1.8 -1.8 5.2 -1.8 -5.2 -5.2 -1.8 5.2 -1.8 Z" fill="#f3d7a8"/></g><g transform="translate(186 92) scale(.6)"><path class="fx-twinkle" style="animation-delay:-1.2s" d="M0 -7 l1.8 5.2 5.2 1.8 -5.2 1.8 -1.8 5.2 -1.8 -5.2 -5.2 -1.8 5.2 -1.8 Z" fill="#f3d7a8"/></g>',fxClass:'',},
 {id:'mo',back:'long',bangs:'abc',locks:1,acc:'phones',hair:'#3a3330',hairBack:'#2b2624',hairShade:'#4a413c',sleeve:'#5f7466',sleeveLight:'#7d9183',front:'#6a7f71',frontLight:'#8a9d90',fold:'#4d5f53',fxBack:'',fx:'<g fill="#6b6f68"><g class="fx-note" style="animation-delay:0s"><path transform="translate(184 92)" d="M0 0 L0 -16 L10 -19 L10 -4" fill="none" stroke="#6b6f68" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="181.5" cy="92" rx="4" ry="3"/><ellipse cx="191.5" cy="89" rx="4" ry="3"/></g><g class="fx-note" style="animation-delay:-1.6s"><path transform="translate(196 92)" d="M0 0 L0 -16 L10 -19 L10 -4" fill="none" stroke="#6b6f68" stroke-width="2.4" stroke-linecap="round"/><ellipse cx="193.5" cy="92" rx="4" ry="3"/><ellipse cx="203.5" cy="89" rx="4" ry="3"/></g></g>',fxClass:'groove',},
 // 照参考·中分男生：两片头发从发旋往外卷，中间一对小卷压在额前，鬓发外翘，露耳朵。银灰
 {id:'silver',noBase:1,hair:'#e2e2e6',hairBack:'#c9cad2',hairShade:'#cfd0d8',sleeve:'#3f4a63',sleeveLight:'#5a6680',front:'#46516b',frontLight:'#616d88',fold:'#333c52',fxBack:'',fx:'',fxClass:'',
  backPath:'M24 126 C16 62 56 24 102 24 C150 24 188 62 178 128 C176 146 180 160 188 172 C174 170 166 162 160 152 C150 166 54 166 42 152 C36 162 28 170 14 172 C22 160 26 146 24 126 Z',
  ears:'<ellipse cx="45" cy="134" rx="10" ry="14" fill="#f3dfcf"/><path d="M43 127 C47 131 47 139 43 143" fill="none" stroke="#e0c3ae" stroke-width="2.4" stroke-linecap="round"/><g transform="translate(200 0) scale(-1 1)"><ellipse cx="45" cy="134" rx="10" ry="14" fill="#f3dfcf"/><path d="M43 127 C47 131 47 139 43 143" fill="none" stroke="#e0c3ae" stroke-width="2.4" stroke-linecap="round"/></g>',
  strands:'<g class="cp-strand cp-strand--a"><path class="cp-hair-shade" d="M98 40 C90 54 84 70 84 90 C80 100 74 106 66 110 C80 110 90 102 94 90 C98 74 100 56 98 40 Z"/><path class="cp-hair" d="M98 34 C80 38 60 52 50 76 C44 92 42 106 36 120 C48 112 56 100 60 88 C64 100 66 110 64 122 C78 104 88 84 90 64 C92 54 95 44 98 34 Z"/></g><g class="cp-strand cp-strand--c"><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair-shade" d="M98 40 C90 54 84 70 84 90 C80 100 74 106 66 110 C80 110 90 102 94 90 C98 74 100 56 98 40 Z"/><path class="cp-hair" d="M98 34 C80 38 60 52 50 76 C44 92 42 106 36 120 C48 112 56 100 60 88 C64 100 66 110 64 122 C78 104 88 84 90 64 C92 54 95 44 98 34 Z"/></g></g><path class="cp-hair-shade" d="M100 30 C80 24 52 34 36 62 C54 48 72 44 88 50 C92 42 96 36 100 30 Z"/><path class="cp-hair" d="M100 26 C82 18 54 26 38 52 C56 40 74 38 88 44 C92 36 96 30 100 26 Z"/><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair-shade" d="M100 30 C80 24 52 34 36 62 C54 48 72 44 88 50 C92 42 96 36 100 30 Z"/><path class="cp-hair" d="M100 26 C82 18 54 26 38 52 C56 40 74 38 88 44 C92 36 96 30 100 26 Z"/></g><g class="cp-strand cp-strand--b"><path class="cp-hair" d="M80 52 C90 40 100 38 104 48 C108 38 120 40 128 52 C116 48 108 54 104 66 C100 54 92 48 80 52 Z"/></g>',
  locks:'<g transform="translate(-9 0)"><g class="cp-lock cp-lock--left"><path class="cp-hair" d="M46 96 C36 118 36 144 46 164 C38 162 32 156 28 148 C26 160 30 170 38 176 C24 178 16 168 16 156 C14 132 26 110 46 96 Z"/></g><g class="cp-lock cp-lock--right"><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair" d="M46 96 C36 118 36 144 46 164 C38 162 32 156 28 148 C26 160 30 170 38 176 C24 178 16 168 16 156 C14 132 26 110 46 96 Z"/></g></g></g>'},
 // 照参考·短乱发少年：一圈长短不一的尖发梢，头顶一个卷成圈的呆毛，尖耳朵。沙金
 {id:'sand',hair:'#ead3a6',hairBack:'#d8bd8c',hairShade:'#d6b986',sleeve:'#d9d3c6',sleeveLight:'#ece8df',front:'#e0dace',frontLight:'#f1ede5',fold:'#b9b0a1',fxBack:'',fx:'<g class="fx-leaf"><path d="M0 0 C6 -8 16 -8 20 0 C16 8 6 8 0 0 Z" fill="#8fb27a"/><path d="M2 0 L18 0" stroke="#6f9160" stroke-width="1.2"/></g>',fxClass:'',
  backPath:'M26 122 C20 60 58 28 102 28 C148 28 184 60 174 124 C172 138 166 148 158 154 C140 188 60 188 44 154 C36 148 28 138 26 122 Z',
  strands:'<g class="cp-strand cp-strand--a"><path class="cp-hair" d="M44 92 C54 102 58 120 54 140 C50 126 42 116 30 112 C32 102 38 96 44 92 Z"/><path class="cp-hair" d="M58 80 C72 92 78 108 74 130 C68 116 60 108 48 104 C50 94 52 86 58 80 Z"/><path class="cp-hair-shade" d="M62 90 C68 98 72 108 72 120 C66 110 60 104 54 100 Z"/></g><g class="cp-strand cp-strand--b"><path class="cp-hair" d="M76 72 C90 84 94 100 90 122 C84 108 78 100 66 96 C68 86 72 78 76 72 Z"/><path class="cp-hair" d="M96 70 C110 82 112 100 106 118 C102 104 94 96 84 92 C88 84 92 76 96 70 Z"/></g><g class="cp-strand cp-strand--c"><path class="cp-hair" d="M114 72 C130 80 136 98 132 120 C126 106 118 98 106 94 C108 86 110 78 114 72 Z"/><path class="cp-hair" d="M134 78 C150 88 156 106 152 128 C146 114 138 106 126 102 C128 92 130 84 134 78 Z"/><path class="cp-hair" d="M152 90 C166 100 170 118 166 138 C160 124 152 116 142 112 C144 104 148 96 152 90 Z"/><path class="cp-hair-shade" d="M136 90 C144 98 148 108 148 118 C142 110 136 104 130 100 Z"/></g>',
  locks:'<g class="cp-lock cp-lock--left"><path class="cp-hair" d="M40 98 C30 120 30 144 38 164 C30 158 24 142 24 126 C24 112 30 104 40 98 Z"/></g><g class="cp-lock cp-lock--right"><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair" d="M40 98 C30 120 30 144 38 164 C30 158 24 142 24 126 C24 112 30 104 40 98 Z"/></g></g>',
  ahoge:'<path class="cp-hair" d="M100 34 C90 8 114 -4 132 6 C146 14 142 36 122 36 C134 26 130 14 118 14 C108 14 104 22 106 34 Z"/><path class="cp-hair-shade" d="M110 24 C114 14 126 12 132 18 C124 16 116 18 112 28 Z"/>',
  extra:'<g transform="translate(0 -4)"><path d="M48 122 L14 104 C18 128 30 148 50 150 Z" fill="#f3dfcf"/><path d="M42 128 L24 118" fill="none" stroke="#e0c3ae" stroke-width="2.6" stroke-linecap="round"/><g transform="translate(200 0) scale(-1 1)"><path d="M48 122 L14 104 C18 128 30 148 50 150 Z" fill="#f3dfcf"/><path d="M42 128 L24 118" fill="none" stroke="#e0c3ae" stroke-width="2.6" stroke-linecap="round"/></g></g>'},
 // 照参考·猫耳少女：猫耳，蓬松层次短发，一缕长发落在两眼之间，两侧发梢往外炸，肤色偏深。银白
 {id:'cat',handShade:'#c99573',hair:'#e6e3de',hairBack:'#dad6cf',hairShade:'#cdc7bf',face:'#d8a988',faceLight:'#e8c2a5',blush:.6,sleeve:'#7b3f3d',sleeveLight:'#955755',front:'#844644',frontLight:'#9e5f5c',fold:'#5f302f',fxBack:'<g class="fx-tail"><path d="M200 214 C222 170 226 110 206 80 C198 70 184 76 190 88 C210 118 206 170 184 214 Z" fill="#e6e3de"/><path d="M206 80 C198 70 184 76 190 88 C194 92 202 90 204 84 Z" fill="#cfcac2"/></g>',fx:'',fxClass:'',
  backPath:'M24 160 C12 128 14 86 28 62 C46 34 72 24 102 24 C134 24 160 34 176 60 C190 86 192 128 180 160 C170 156 166 150 164 144 C150 186 50 186 36 144 C34 150 30 156 24 160 Z',
  behind:'<g class="cp-layer" style="--dx:-4;--dy:-2"><g class="fx-ear"><path class="cp-hair" d="M36 76 L26 2 L88 44 Z"/><path d="M44 64 L38 18 L76 44 Z" fill="#efd3cb"/><path d="M42 62 l6 -12 l3 9 l6 -10 l2 10 l7 -7 l-2 10 Z" fill="#fbf7f2"/></g><g class="fx-ear fx-ear--r"><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair" d="M36 76 L26 2 L88 44 Z"/><path d="M44 64 L38 18 L76 44 Z" fill="#efd3cb"/><path d="M42 62 l6 -12 l3 9 l6 -10 l2 10 l7 -7 l-2 10 Z" fill="#fbf7f2"/></g></g></g>',
  strands:'<g class="cp-strand cp-strand--a"><path class="cp-hair" d="M40 96 C52 108 56 128 50 150 C46 132 38 122 26 118 C28 108 34 100 40 96 Z"/><path class="cp-hair" d="M58 80 C72 94 76 114 70 136 C64 120 56 112 44 108 C46 96 52 86 58 80 Z"/></g><g class="cp-strand cp-strand--b"><path class="cp-hair-shade" d="M96 76 C104 94 104 120 98 146 C96 124 92 110 86 100 Z"/><path class="cp-hair" d="M92 70 C104 90 104 120 96 152 C92 128 86 112 76 102 C80 90 86 78 92 70 Z"/><path class="cp-hair" d="M110 70 C124 84 128 102 122 124 C116 110 108 102 98 98 C102 88 106 78 110 70 Z"/></g><g class="cp-strand cp-strand--c"><path class="cp-hair" d="M132 76 C148 88 154 108 148 130 C142 116 134 108 122 104 C124 94 128 84 132 76 Z"/><path class="cp-hair" d="M150 90 C164 102 168 122 162 144 C156 130 148 122 138 118 C140 108 146 98 150 90 Z"/></g>',
  locks:'<g class="cp-lock cp-lock--left"><path class="cp-hair" d="M40 100 C28 116 22 136 26 158 C20 152 14 144 10 134 C10 146 14 156 22 164 C12 164 4 156 2 146 C0 124 16 106 40 100 Z"/></g><g class="cp-lock cp-lock--right"><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair" d="M40 100 C28 116 22 136 26 158 C20 152 14 144 10 134 C10 146 14 156 22 164 C12 164 4 156 2 146 C0 124 16 106 40 100 Z"/></g></g>',
  ahoge:'<path class="cp-hair" d="M98 32 C94 14 104 4 118 6 C108 10 104 20 106 32 Z"/>'},
 // 照参考·齐刘海少女：齐刘海整片一起晃（不拆开，免得看出断口），两侧公主切鬓发，长发，鬓角三朵小白花。雾蓝黑
 {id:'hime',hair:'#4d566c',hairBack:'#3d4559',hairShade:'#444c61',sleeve:'#5a5468',sleeveLight:'#746e82',front:'#625c70',frontLight:'#7c768a',fold:'#48435a',back:'long',fxBack:'',fx:'<ellipse class="fx-petal" style="animation-delay:0s" cx="160" cy="70" rx="3.6" ry="5.6" fill="#fffaf3"/><ellipse class="fx-petal" style="animation-delay:-2.2s" cx="170" cy="70" rx="3.6" ry="5.6" fill="#fffaf3"/><ellipse class="fx-petal" style="animation-delay:-4.1s" cx="150" cy="70" rx="3.6" ry="5.6" fill="#fffaf3"/>',fxClass:'',
  strands:'<g class="cp-strand cp-strand--b"><g transform="translate(0 -9)"><path class="cp-hair" d="M32 108 C34 90 46 80 64 78 L138 78 C156 80 166 90 168 108 C162 114 156 116 150 112 C144 117 138 113 132 117 C126 113 120 118 114 113 C108 118 100 113 94 117 C88 113 82 118 76 113 C70 117 64 113 58 116 C52 112 46 116 40 112 C36 114 34 112 32 108 Z"/><path class="cp-hair-shade" d="M64 84 L70 112 L74 84 Z M98 84 L100 112 L104 84 Z M130 84 L130 112 L136 84 Z"/></g></g>',
  locks:'<g class="cp-lock cp-lock--left"><path class="cp-hair" d="M36 96 C44 98 52 100 58 104 C58 130 60 156 62 178 L32 178 C32 150 32 122 36 96 Z"/><path class="cp-hair-shade" d="M50 108 C50 130 51 152 53 174 L48 174 C47 152 47 130 50 108 Z"/></g><g class="cp-lock cp-lock--right"><g transform="translate(200 0) scale(-1 1)"><path class="cp-hair" d="M36 96 C44 98 52 100 58 104 C58 130 60 156 62 178 L32 178 C32 150 32 122 36 96 Z"/><path class="cp-hair-shade" d="M50 108 C50 130 51 152 53 174 L48 174 C47 152 47 130 50 108 Z"/></g></g>',
  extra:'<g transform="translate(152 84)"><g><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(0)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(72)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(144)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(216)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(288)"/><circle r="2.6" fill="#e6c36c"/></g></g><g transform="translate(166 98) scale(.7)"><g><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(0)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(72)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(144)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(216)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(288)"/><circle r="2.6" fill="#e6c36c"/></g></g><g transform="translate(160 70) scale(.6)"><g><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(0)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(72)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(144)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(216)"/><ellipse cx="0" cy="-6.5" rx="4.2" ry="6.5" fill="#fffaf3" transform="rotate(288)"/><circle r="2.6" fill="#e6c36c"/></g></g>'},
]

