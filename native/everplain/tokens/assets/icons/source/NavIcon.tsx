import type { ReactNode } from 'react'

/** Navigation uses one quiet, optically consistent outline set. */
const shapes = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  chat: <path d="M20 11.5a8 8 0 0 1-8 8H4l-1 2V11.5a8.5 8.5 0 1 1 17 0Z" />,
  library: <><rect x="3" y="4" width="5" height="16" rx="1" /><path d="M11 4v16M15 5l4-1 3 15-4 1Z" /></>,
  graph: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="m10.8 7.3-4.6 8.4m7-8.4 4.6 8.4M7.5 18h9" /></>,
  file: <><path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6" /></>,
  compose: <><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M10 14l1-4L19 2l3 3-8 8-4 1ZM17 4l3 3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  import: <><path d="M3 8V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v12H3V8ZM12 10v7m-3-3 3 3 3-3" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.5 6.8-4m-6.8 7 6.8 4" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" /></>,
  connection: <><path d="m9 7 3-3a5 5 0 0 1 7 7l-3 3M8 10l-3 3a5 5 0 0 0 7 7l3-3m-7-1 8-8" /></>,
  card: <><rect x="2" y="5" width="20" height="14" rx="3" /><path d="M2 10h20M6 15h4" /></>,
  users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3" /></>,
  shield: <><path d="m12 2 8 3v6c0 5-3 8-8 11-5-3-8-6-8-11V5Zm-4 9 3 3 5-5" /></>,
  settings: <><path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h4m4 0h10" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  more: <><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="3" y="15" width="6" height="6" rx="1" /><rect x="15" y="15" width="6" height="6" rx="1" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
} satisfies Record<string, ReactNode>

export type NavIconName = keyof typeof shapes

export function NavIcon({ name, className = '' }: { name: NavIconName; className?: string }) {
  return <svg className={`application-nav-icon ${className}`} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>
}
