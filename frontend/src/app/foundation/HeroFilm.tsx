import { useEffect, useRef, useState } from 'react'
import { PauseIcon, PlayIcon } from '@phosphor-icons/react'
import { prefersReducedMotion } from './useReveal'

/*
 * 首屏影像位。成片还没定，现在 HERO_FILM 为空，首屏只显示纸面底色。
 * 成片到位后只改这里：src 是固定机位、可无缝循环的短片（建议 ≤ 8MB 的 H.264），
 * poster 是它的第一帧，用来在视频加载前和加载失败时顶住画面。
 * 这里不再做滚动控制播放：首屏影像只负责氛围，产品介绍交给下面的演示。
 */
export const HERO_FILM: { src: string; mobileSrc?: string; poster: string } | null = null

export function HeroFilm({ film = HERO_FILM }: { film?: typeof HERO_FILM }) {
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(() => !prefersReducedMotion())
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const element = video.current
    if (!element) return
    if (playing) void element.play()?.catch(() => {})
    else element.pause()
  }, [playing])

  if (!film) return <div className="ep-hero-media" data-film="empty" aria-hidden="true" />
  return <div className="ep-hero-media" data-film={failed ? 'fallback' : 'ready'}>
    <img className="ep-hero-poster" src={film.poster} alt="" fetchPriority="high" aria-hidden="true" />
    {!failed && <video ref={video} className="ep-hero-video" muted loop playsInline autoPlay={playing} poster={film.poster} preload="auto" disablePictureInPicture tabIndex={-1} aria-hidden="true" onError={() => setFailed(true)}>
      {film.mobileSrc && <source src={film.mobileSrc} type="video/mp4" media="(max-width: 767px)" />}
      <source src={film.src} type="video/mp4" onError={() => setFailed(true)} />
    </video>}
    {!failed && <button className="ep-motion-toggle" type="button" onClick={() => setPlaying(!playing)} aria-label={playing ? '暂停首屏影像' : '播放首屏影像'}>
      {playing ? <PauseIcon size={13} weight="fill" aria-hidden="true" /> : <PlayIcon size={13} weight="fill" aria-hidden="true" />}
    </button>}
  </div>
}
