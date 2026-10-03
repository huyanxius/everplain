import type { ComponentProps, ReactNode } from 'react'

export function CourseIconButton({ label, children, className = '', ...props }: Omit<ComponentProps<'button'>, 'children'> & { label: string; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} className={["qx-btn qx-btn--ghost qx-btn--icon", `course-icon-button ${className}`].filter(Boolean).join(' ')} {...props}>{children}</button>
}
