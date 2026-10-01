import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listCourses, type SharedCourse } from '../../modules/shared-knowledge'
import './courses.css'

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
  return <div className="course-reference-selector">
    <label>知识来源 <select aria-label="选择个人知识库" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">不使用个人知识库</option>
      {value && !found ? <option value={value}>当前知识库{failed ? '暂不可用' : ''}</option> : null}
      {courses.map((course) => <option key={course.id} value={course.id} disabled={course.access === 'unavailable'}>{course.name ?? '知识库不可用'}{course.access === 'unavailable' ? '（不可用）' : ''}</option>)}
    </select></label>
    {hasConversation ? <span>切换将开启新对话</span> : value ? <span>本次对话将使用所选知识库</span> : null}
    {(failed || found?.access === 'unavailable') ? <Link to="/library">查看知识库</Link> : null}
  </div>
}
