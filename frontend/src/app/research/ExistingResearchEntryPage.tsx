import { Select } from '../ui/Select'
import { ArrowLeftIcon, ArrowRightIcon, CircleNotchIcon, FileTextIcon, FolderOpenIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'

import { isSupportedResearchMaterialFile, RESEARCH_MATERIAL_ACCEPT, uploadInitialResearchMaterials } from '../../modules/research-materials'
import { createExistingResearchProject } from '../../modules/socio-match-workspace'
import { researchWorkspaceDestination } from '../research-workspace/researchProjectWorkspaceModel'
import { PageContent, PageShell } from '../ui/PageShell'
import './existing-research-entry.css'

const PROJECT_STAGES = ['材料整理', '研究设计', '田野进行中', '资料分析', '写作与修订'] as const
function entryRequestKey() { return `existing:${globalThis.crypto?.randomUUID?.() ?? Date.now()}` }

export function ExistingResearchEntryPage() {
  const navigate = useNavigate()
  const requestKey = useRef<string | null>(null)
  const uploadedFiles = useRef(new Set<File>())
  const [projectTitle, setProjectTitle] = useState('')
  const [projectStage, setProjectStage] = useState<(typeof PROJECT_STAGES)[number]>('材料整理')
  const [methodOrientation, setMethodOrientation] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function establishProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !projectTitle.trim() || files.length === 0) return
    const unsupported = files.find((file) => !isSupportedResearchMaterialFile(file))
    if (unsupported) {
      setError(`${unsupported.name} 不是可导入的 PDF、DOCX、TXT 或 Markdown 文件。`)
      return
    }

    setBusy(true)
    setError(null)
    try {
      requestKey.current ??= entryRequestKey()
      const taskId = createdTaskId ?? (await createExistingResearchProject(requestKey.current, {
        projectTitle: projectTitle.trim(),
        projectStage,
        methodOrientation: methodOrientation.trim() || undefined,
      })).taskId
      setCreatedTaskId(taskId)
      for (const file of files) {
        if (uploadedFiles.current.has(file)) continue
        await uploadInitialResearchMaterials(taskId, [file])
        uploadedFiles.current.add(file)
      }
      navigate(researchWorkspaceDestination(taskId, 'materials'), { replace: true })
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '项目暂时无法建立，请重试。')
    } finally {
      setBusy(false)
    }
  }


  return <PageShell>
    <PageContent>
      <section className="research-import" aria-labelledby="research-import-title">
        <Link className="qx-btn qx-btn--ghost research-import__back" to="/research/new"><ArrowLeftIcon />返回从零开始</Link>
        <header className="research-import__heading">
          <div className="research-import__mark" aria-hidden="true"><FolderOpenIcon /></div>
          <h1 id="research-import-title" className="qx-section-title">接入已有研究</h1>
          <p className="qx-body">给正在进行的研究一个位置。导入已有材料，接着往下做。</p>
        </header>
        <form className="research-import__form" noValidate onSubmit={establishProject} aria-busy={busy}>
          <section className="qx-card research-import__project" aria-labelledby="research-import-project">
            <h2 id="research-import-project" className="qx-heading">项目</h2>
            <label className="research-import__field" htmlFor="research-project-title">
              <span>项目名称</span>
              <input className="qx-input" id="research-project-title" autoFocus required maxLength={300} disabled={busy || Boolean(createdTaskId)} value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} placeholder="例如：城市公共空间研究" />
            </label>
            <div className="research-import__row">
              <label className="research-import__field" htmlFor="research-project-stage">
                <span>当前阶段</span>
                <Select className="qx-input" id="research-project-stage" disabled={busy || Boolean(createdTaskId)} value={projectStage} onChange={(nextValue) => setProjectStage(nextValue as (typeof PROJECT_STAGES)[number])} options={PROJECT_STAGES.map(stage => ({ value: stage, label: stage }))} />
              </label>
              <label className="research-import__field" htmlFor="research-method-orientation">
                <span>方法取向 <small aria-hidden="true">可选</small></span>
                <input className="qx-input" id="research-method-orientation" maxLength={300} disabled={busy || Boolean(createdTaskId)} value={methodOrientation} onChange={(event) => setMethodOrientation(event.target.value)} placeholder="例如：访谈、文献分析" />
              </label>
            </div>
          </section>
          <section className="qx-card research-import__materials" aria-labelledby="research-import-materials">
            <header><h2 id="research-import-materials" className="qx-heading">初始材料</h2><span className="qx-meta">{files.length ? `${files.length} 份` : '尚未选择'}</span></header>
            <label className="research-import__upload" htmlFor="research-initial-materials" data-disabled={busy}>
              <PlusIcon aria-hidden="true" /><strong>{files.length ? '重新选择材料' : '选择初始材料'}</strong>
              <span>PDF、DOCX、TXT 或 Markdown，可一次选择多份</span>
              <input id="research-initial-materials" aria-label="选择初始材料" type="file" multiple required accept={RESEARCH_MATERIAL_ACCEPT} disabled={busy} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setError(null); event.target.value = '' }} />
            </label>
            <div aria-label="待导入材料">
              {files.length ? <ul className="research-import__files">{files.map((file, index) => <li key={`${file.name}:${file.size}:${index}`}>
                <FileTextIcon aria-hidden="true" />
                <div><strong>{file.name}</strong><span className="qx-meta">{Math.max(1, Math.ceil(file.size / 1024))} KB</span></div>
                <button className="qx-btn qx-btn--ghost qx-btn--icon" type="button" disabled={busy} aria-label={`移除 ${file.name}`} onClick={() => setFiles(current => current.filter((_, fileIndex) => fileIndex !== index))}><XIcon /></button>
              </li>)}</ul> : <p className="qx-meta research-import__empty">访谈、阅读笔记和文献，都可以从这里开始整理。</p>}
            </div>
          </section>
          <footer className="research-import__footer">
            {error ? <p className="research-import__error" role="alert">{error}</p> : <p className="qx-meta">建立后，进入这项研究的材料工作台。</p>}
            <button className="qx-btn qx-btn--primary qx-btn--lg" type="submit" disabled={busy || !projectTitle.trim() || files.length === 0}>
              {busy ? <><CircleNotchIcon className="research-import__spinner" />正在建立并导入…</> : <>{createdTaskId && error ? '重试导入材料' : '建立项目并导入材料'}<ArrowRightIcon /></>}
            </button>
          </footer>
        </form>
      </section>
    </PageContent>
  </PageShell>
}
