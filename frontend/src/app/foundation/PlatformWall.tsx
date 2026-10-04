import apple from '../../assets/platforms/apple-notes.svg'
import bilibili from '../../assets/platforms/bilibili.svg'
import chrome from '../../assets/platforms/chrome.svg'
import evernote from '../../assets/platforms/evernote.svg'
import flomo from '../../assets/platforms/flomo.png'
import keep from '../../assets/platforms/keep.svg'
import notion from '../../assets/platforms/notion.svg'
import obsidian from '../../assets/platforms/obsidian.svg'
import type { CSSProperties } from 'react'
import { useReveal } from './useReveal'

/*
 * 「收到一处」：列能直接搬进来的平台，和知识库「添加资料」里的来源一一对应。
 * 只列已经接通的导入来源，别把计划中的平台写上来；新增来源时两边一起改。
 * 用各家真 logo，是因为读者靠颜色认应用比读字快。
 * 动画演的就是标题那句话：八张卡先散在各自的 from 位置（单位是卡片自身宽高的百分比，带一点歪），
 * 滚进视口后依次落回网格。只演一次，不循环——读者往下读时不该还有东西在动。
 */
const platforms = [
  { name: '浏览器收藏', from: 'translate(-60%, -90%) rotate(-8deg)', logo: chrome },
  { name: 'Obsidian', from: 'translate(20%, -140%) rotate(6deg)', logo: obsidian },
  { name: 'Notion', from: 'translate(-30%, -110%) rotate(-5deg)', logo: notion },
  { name: '印象笔记', from: 'translate(70%, -80%) rotate(9deg)', logo: evernote },
  { name: 'Apple 备忘录', from: 'translate(-80%, 90%) rotate(7deg)', logo: apple },
  { name: 'flomo', from: 'translate(-10%, 140%) rotate(-6deg)', logo: flomo },
  { name: 'Google Keep', from: 'translate(30%, 120%) rotate(5deg)', logo: keep },
  { name: 'B 站收藏', from: 'translate(80%, 70%) rotate(-9deg)', logo: bilibili },
]

export function PlatformWall() {
  const [ref, shown] = useReveal<HTMLUListElement>(0.4)
  return <div className="ep-platforms">
    <ul aria-label="支持导入的平台" ref={ref} data-shown={shown}>
      {platforms.map((item, i) => <li key={item.name} style={{ '--from': item.from, transitionDelay: `${i * 70}ms` } as CSSProperties}><img src={item.logo} alt="" width={28} height={28} />{item.name}</li>)}
    </ul>
    <p>网页链接、截图、PDF、音视频也能直接拖进来。</p>
  </div>
}
