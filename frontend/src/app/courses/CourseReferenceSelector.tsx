import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listCourses, type SharedCourse } from '../../modules/shared-knowledge'
import { Select } from '../ui/Select'
import '../conversation-view/conversation-composer.css'

export function CourseReferenceSelector({ value, hasConversation, disabled, onChange }: {
  value: string
  hasConversation: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const [courses, setCourses] = useState<SharedCourse[]>([])
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void listCourses().then((items) => { if (active) { setCourses(items.filter((item) => item.access === 'owner')); setFailed(false) } }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [value])
  const found = courses.find((course) => course.id === value)
  return <div className="cv-library-selector">
    <label><span className="qx-meta">知识来源</span><Select aria-label="选择个人知识库" value={value} disabled={disabled} onChange={onChange} options={[
      { value: '', label: '不使用个人知识库' },
      ...(value && !found ? [{ value, label: `当前知识库${failed ? '暂不可用' : ''}` }] : []),
      ...courses.map(course => ({ value: course.id, label: `${course.name ?? '知识库不可用'}${course.access === 'unavailable' ? '（不可用）' : ''}`, disabled: course.access === 'unavailable' })),
    ]} /></label>
    {hasConversation ? <span className="qx-meta">切换将开启新对话</span> : value ? <span className="qx-meta">本次对话将使用所选知识库</span> : null}
    {(failed || found?.access === 'unavailable') ? <Link className="qx-btn qx-btn--ghost" to="/library">查看知识库</Link> : null}
  </div>
}
