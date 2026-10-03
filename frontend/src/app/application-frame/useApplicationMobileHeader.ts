import { createContext, useContext } from 'react'

export const MobileHeaderTarget = createContext<HTMLElement | null>(null)
export function useApplicationMobileHeader() { return useContext(MobileHeaderTarget) }
