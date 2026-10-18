import { useEffect, useRef, useState, type CSSProperties } from 'react'
import './companion.css'

/*
 * 拟人形象「小平」，趴在官网右下角，下巴搁在手臂上探出头来：Everplain 自己的大头插画角色，和七个几何 bot（agent-avatar）是两套东西——
 * bot 是用户的 Agent，小平是产品本身，只出现在官网。
 *
 * 2.5D 的做法：头被拆成前后七层，转头时每层按自己的"深度"平移（后发反向、眼睛最多），
 * 视差叠起来就像脸在转。--turn 是左右（-1 看左，1 看右），--nod 是上下（正数低头）。
 * 所有层的平移都写在外层 g 上，里层 g 留给飘动、眨眼这类循环动画，两种 transform 不打架。
 *
 * 动作：
 * - 视线跟着指针走，指针停 4 秒后自己慢慢张望；
 * - 一直在呼吸、眨眼，刘海和侧发分开飘，呆毛弹；
 * - 点一下会笑（眼睛变弯）并蹦一下。
 * 用户开了"减少动态效果"就只保留静止的一个侧脸角度。
 */

type Mood = 'idle' | 'happy'

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function Companion({ size = 120, label = 'Everplain 的小平' }: { size?: number; label?: string }) {
  const root = useRef<SVGSVGElement>(null)
  const [mood, setMood] = useState<Mood>('idle')

  useEffect(() => {
    const el = root.current
    if (!el) return
    if (prefersReducedMotion()) {
      el.style.setProperty('--turn', '0.25')
      el.style.setProperty('--nod', '0')
      return
    }
    let target = { turn: 0.2, nod: 0 }
    const current = { turn: 0.2, nod: 0 }
    let lastMove = 0
    let frame = 0
    const onMove = (event: PointerEvent) => {
      const box = el.getBoundingClientRect()
      const cx = box.left + box.width / 2
      const cy = box.top + box.height / 2
      target = {
        turn: Math.max(-1, Math.min(1, (event.clientX - cx) / (window.innerWidth * 0.45))),
        nod: Math.max(-1, Math.min(1, (event.clientY - cy) / (window.innerHeight * 0.6))),
      }
      lastMove = performance.now()
    }
    const tick = (now: number) => {
      if (now - lastMove > 4000) {
        // 没人理它时自己张望：两个不同周期的正弦叠一下，避免机械地左右摆
        target = { turn: Math.sin(now / 2300) * 0.7 + Math.sin(now / 900) * 0.12, nod: Math.sin(now / 3100) * 0.35 }
      }
      current.turn += (target.turn - current.turn) * 0.08
      current.nod += (target.nod - current.nod) * 0.08
      el.style.setProperty('--turn', current.turn.toFixed(3))
      el.style.setProperty('--nod', current.nod.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    frame = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (mood !== 'happy') return
    const timer = window.setTimeout(() => setMood('idle'), 1600)
    return () => window.clearTimeout(timer)
  }, [mood])

  return (
    <svg
      ref={root}
      className="companion"
      data-mood={mood}
      viewBox="0 -10 220 224"
      width={size}
      height={size * 224 / 220}
      role="img"
      aria-label={label}
      onClick={() => setMood('happy')}
      style={{ '--turn': 0.2, '--nod': 0 } as CSSProperties}
    >
      <defs>
        <radialGradient id="companion-face" cx="42%" cy="40%" r="70%">
          <stop offset="0%" style={{ stopColor: 'var(--cp-face-light)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--cp-face)' }} />
        </radialGradient>
        {/* 袖子上亮下暗，做出圆柱的体积；手同理 */}
        <linearGradient id="companion-sleeve" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--cp-sleeve-light)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--cp-sleeve)' }} />
        </linearGradient>
        <linearGradient id="companion-sleeve-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--cp-sleeve-front-light)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--cp-sleeve-front)' }} />
        </linearGradient>
        <linearGradient id="companion-hand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--cp-face-light)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--cp-hand-shade)' }} />
        </linearGradient>
        <clipPath id="companion-face-clip"><ellipse cx="100" cy="127" rx="57" ry="52" /></clipPath>
        <filter id="companion-soft-edge" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="0.8" /></filter>
        <filter id="companion-soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3" /></filter>
      </defs>

      <g className="cp-rest">
        <g className="cp-bob">
          {/* 后发：转头时反向移动，拉出纵深 */}
          <g className="cp-layer" style={{ '--dx': -7, '--dy': -2 } as CSSProperties}>
            <g className="cp-sway-slow">
              <path className="cp-hair-back" d="M20 120 C14 54 56 20 102 20 C152 20 190 56 182 124 C180 156 188 182 196 214 L6 214 C16 182 24 156 20 120 Z" />
            </g>
          </g>

          {/* 脸 */}
          <g className="cp-layer" style={{ '--dx': 4, '--dy': 1 } as CSSProperties}>
            <ellipse className="cp-face" cx="100" cy="127" rx="57" ry="52" fill="url(#companion-face)" />
          </g>

          {/* 腮红 */}
          <g className="cp-layer" style={{ '--dx': 8, '--dy': 2 } as CSSProperties}>
            <ellipse className="cp-blush" cx="64" cy="153" rx="12" ry="7" />
            <ellipse className="cp-blush" cx="136" cy="153" rx="12" ry="7" />
          </g>

          {/* 眼睛：深度最大，平时是竖椭圆，开心时换成弯眼 */}
          <g className="cp-layer" style={{ '--dx': 11, '--dy': 5 } as CSSProperties}>
            <g className="cp-eyes">
              <rect className="cp-eye" x="72.5" y="112" width="12.5" height="33" rx="6.25" />
              <rect className="cp-eye" x="115" y="112" width="12.5" height="33" rx="6.25" />
            </g>
            <g className="cp-happy">
              <path d="M71 132 Q79 120 87 132" />
              <path d="M114 132 Q122 120 130 132" />
            </g>
          </g>

          {/* 头顶的发冠 */}
          <g className="cp-layer" style={{ '--dx': 3, '--dy': 0 } as CSSProperties}>
            <path className="cp-hair" d="M32 110 C28 56 62 30 102 30 C146 30 174 58 170 112 C158 92 134 82 104 82 C76 82 50 92 32 110 Z" />
          </g>

          {/* 刘海：五缕分三组飘；先在额头上落一层投影 */}
          <g className="cp-layer" style={{ '--dx': 7, '--dy': 1 } as CSSProperties}>
            <path className="cp-face-shade" clipPath="url(#companion-face-clip)" d="M50 100 C72 112 130 112 152 102 L150 116 C128 124 74 124 52 114 Z" />
            <g className="cp-strand cp-strand--a">
              <path className="cp-hair" d="M44 92 C54 102 60 118 58 136 C52 122 42 114 32 112 C34 104 38 96 44 92 Z" />
            </g>
            <g className="cp-strand cp-strand--b">
              <path className="cp-hair" d="M60 78 C78 88 86 106 84 128 C78 114 68 106 52 102 C52 92 55 84 60 78 Z" />
              <path className="cp-hair-shade" d="M70 90 C78 98 82 108 82 120 C76 110 70 104 62 100 Z" />
            </g>
            <g className="cp-strand cp-strand--c">
              <path className="cp-hair" d="M80 72 C104 78 114 98 108 122 C102 108 92 100 78 96 C78 88 78 80 80 72 Z" />
              <path className="cp-hair" d="M108 72 C134 76 148 94 150 120 C140 106 128 98 112 96 C114 88 112 80 108 72 Z" />
              <path className="cp-hair" d="M140 82 C156 92 164 108 162 128 C156 116 148 110 138 108 C140 100 140 90 140 82 Z" />
            </g>
          </g>

          {/* 侧发：从耳边垂下来，飘得比刘海慢 */}
          <g className="cp-layer" style={{ '--dx': 5, '--dy': 0 } as CSSProperties}>
            <g className="cp-lock cp-lock--left">
              <path className="cp-hair" d="M40 98 C34 128 36 162 47 196 C36 190 26 166 24 136 C23 118 30 104 40 98 Z" />
            </g>
            <g className="cp-lock cp-lock--right">
              <path className="cp-hair" d="M160 98 C166 128 164 162 153 196 C164 190 174 166 176 136 C177 118 170 104 160 98 Z" />
            </g>
          </g>

          {/* 呆毛 */}
          <g className="cp-layer" style={{ '--dx': 9, '--dy': -1 } as CSSProperties}>
            <g className="cp-ahoge">
              <path className="cp-hair" d="M98 32 C92 14 98 0 114 -4 C106 4 104 14 108 26 C112 18 120 14 128 16 C118 20 110 28 106 36 Z" />
            </g>
          </g>

          {/* 发夹：一朵花，挂一条带星星的书签缎带 */}
          <g className="cp-layer" style={{ '--dx': 8, '--dy': 0 } as CSSProperties}>
            <g className="cp-ribbon">
              <path className="cp-ribbon-tail" d="M150 86 L166 136 L156 132 L150 142 L142 92 Z" />
              <path className="cp-star" d="M156 116 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z" />
            </g>
            <g className="cp-flower" transform="translate(150 78)">
              {Array.from({ length: 8 }, (_, i) => (
                <ellipse key={i} className="cp-petal" cx="0" cy="-9" rx="3.6" ry="9" transform={`rotate(${i * 45})`} />
              ))}
              <circle className="cp-flower-heart" r="4" />
            </g>
          </g>
        </g>
        {/*
          * 趴着：两条前臂交叠，下巴搁在上面。后臂从左边伸到右边，前臂从右边伸到左边压在它上面；
          * 手从罗纹袖口里垂出来，指尖往下弯，两道细线分出手指。手臂不跟着转头。
          */}
        <g className="cp-arms">
          <path className="cp-sleeve" d="M-4 216 C0 196 18 184 44 180 C72 176 104 174 126 176 L124 204 C100 208 60 212 30 216 Z" />
          <path className="cp-fold" d="M60 182 C70 188 76 196 78 206" />
          <path className="cp-fold" d="M96 178 C102 184 106 192 106 201" />
          <path className="cp-cuff" d="M124 175 C131 173 138 174 142 177 C145 186 145 196 141 203 C135 205 128 205 123 203 C126 194 126 184 124 175 Z" />
          <path className="cp-rib" d="M130 176 C131 185 131 194 129 203 M135 176 C136 185 136 194 134 204 M139.5 177 C140.5 186 140.5 195 138.5 203" />
          <path className="cp-hand" d="M140 179 C150 176 160 178 165 184 C169 189 168 196 163 199 C157 202 149 202 142 200 C144 193 144 186 140 179 Z" />
          <path className="cp-finger" d="M150 184 C153 188 154 193 153 198 M156.5 185.5 C159.5 189 160.5 193 159.5 197.5" />

          <ellipse className="cp-chin-shadow" cx="112" cy="181" rx="44" ry="6" />

          <path className="cp-sleeve cp-sleeve--front" d="M224 218 C222 200 206 188 182 186 C156 184 126 184 104 187 L104 214 C130 216 170 218 224 218 Z" />
          <path className="cp-fold" d="M160 189 C152 194 148 202 147 212" />
          <path className="cp-fold" d="M190 190 C184 196 181 204 181 214" />
          <path className="cp-cuff" d="M106 186 C99 185 92 187 88 190 C85 199 85 207 88 213 C94 215 101 215 106 213 C104 205 104 194 106 186 Z" />
          <path className="cp-rib" d="M100.5 187 C99.5 196 99.5 205 100.5 213.5 M96 188 C95 197 95 206 96 214 M91.5 189 C90.5 198 90.5 206 91.5 213" />
          <path className="cp-hand" d="M90 190 C80 187 69 189 64 195 C60 200 61 206 66 209 C72 212 81 212 89 210 C87 203 87 196 90 190 Z" />
          <path className="cp-finger" d="M79 194 C76 198 75 203 76 208 M72 196 C69 199 68 203 69 207" />
        </g>
      </g>
    </svg>
  )
}
