import { useState, type ReactNode, type Ref } from 'react'
import { MobileHeaderTarget } from './useApplicationMobileHeader'
import { useMobileViewport } from '../ui/useMobileViewport'
import './application-frame.css'

export type ApplicationFrameProps = {
  collapsed: boolean
  splitRail?: boolean
  recordsOpen?: boolean
  recordsLabel?: string
  drawerOpen: boolean
  narrow: boolean
  immersive: boolean
  workspace: boolean
  wide: boolean
  sidebarRef: Ref<HTMLElement>
  brand: ReactNode
  toggle: ReactNode
  newConversation: ReactNode
  navigation: ReactNode
  secondaryNavigation: ReactNode
  history: ReactNode
  account: ReactNode
  notifications: ReactNode
  mobileHeader: ReactNode
  notice: ReactNode
  skipLabel: string
  sidebarLabel: string
  dismissLabel: string
  onDismiss: () => void
  children: ReactNode
}

/** The application has one viewport and one content scroll owner. */
export function ApplicationFrame(props: ApplicationFrameProps) {
  const { collapsed, drawerOpen, narrow, immersive, workspace, wide } = props
  const [mobileHeaderTarget, setMobileHeaderTarget] = useState<HTMLDivElement | null>(null)
  useMobileViewport(narrow)
  return (
    <MobileHeaderTarget.Provider value={narrow && !immersive ? mobileHeaderTarget : null}>
    <div className="application-frame" data-collapsed={collapsed} data-drawer={drawerOpen} data-immersive={immersive} data-split-rail={Boolean(props.splitRail && !narrow)} data-records-open={Boolean(props.recordsOpen)}>
      {props.notice}
      {!immersive && <>
        <a className="application-frame__skip" href="#main-content">{props.skipLabel}</a>
        {narrow && drawerOpen && <button type="button" className="application-frame__scrim" aria-label={props.dismissLabel} tabIndex={-1} onClick={props.onDismiss} />}
        <aside ref={props.sidebarRef} id="application-sidebar" className="application-sidebar" aria-label={props.sidebarLabel} role={narrow ? 'dialog' : undefined} aria-modal={narrow && drawerOpen || undefined} aria-hidden={narrow && !drawerOpen || undefined} inert={narrow && !drawerOpen} onClick={event => { if (narrow && (event.target as HTMLElement).closest('a[href], [data-close-navigation]')) props.onDismiss() }}>
          {props.splitRail && !narrow ? <>
            <div className="application-icon-rail">
              <div className="application-sidebar__top">{props.brand}</div>
              <div className="application-sidebar__scroll">
                <div className="application-sidebar__new">{props.newConversation}</div>
                <div className="application-sidebar__navigation">{props.navigation}{props.secondaryNavigation}</div>
              </div>
              <div className="application-sidebar__bottom">{props.account}{props.notifications}</div>
            </div>
            <section id="application-records" className="application-records" hidden={!props.recordsOpen} aria-label={props.recordsLabel}>
              <header className="application-records__heading"><h2 className="qx-card__title">{props.recordsLabel}</h2></header>
              <div className="application-sidebar__history">{props.history}</div>
            </section>
          </> : <>
          <div className="application-sidebar__top">{props.brand}{props.toggle}</div>
          <div className="application-sidebar__scroll">
            <div className="application-sidebar__new">{props.newConversation}</div>
            <div className="application-sidebar__navigation">{props.navigation}{props.secondaryNavigation}</div>
            <div className="application-sidebar__history">{props.history}</div>
          </div>
          <div className="application-sidebar__bottom">{props.account}{props.notifications}</div>
          </>}
        </aside>
      </>}
      <div className="application-frame__body" inert={!immersive && narrow && drawerOpen}>
        {!immersive && props.splitRail && !narrow && <div className="application-frame__rail-toggle">{props.toggle}</div>}
        {!immersive && <header className="application-frame__mobile">{props.mobileHeader}<div ref={setMobileHeaderTarget} className="application-frame__mobile-context" /></header>}
        <main id="main-content" tabIndex={-1} className="application-frame__main" data-workspace={workspace} data-wide={wide || immersive} inert={!immersive && narrow && drawerOpen}>
          {props.children}
        </main>
      </div>
    </div>
    </MobileHeaderTarget.Provider>
  )
}
