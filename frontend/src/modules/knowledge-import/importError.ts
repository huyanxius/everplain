export function importErrorMessage(error: unknown, status?: number): string {
  const record = typeof error === 'object' && error !== null ? error as { detail?: unknown; error?: { message?: unknown }; message?: unknown } : undefined
  const detail = record?.detail
  const message = typeof detail === 'string' ? detail : typeof record?.error?.message === 'string' ? record.error.message : undefined
  if (message) return `${message}${status ? `（HTTP ${status}）` : ''}`
  if (Array.isArray(detail)) {
    // Do not echo validation inputs: they may include note contents or credentials.
    const fields = [...new Set(detail.flatMap(item => Array.isArray(item?.loc) ? item.loc.filter((value: unknown) => typeof value === 'string' && ['source_type', 'files', 'library_id'].includes(value)) : []))]
    return `导入请求格式未通过验证${fields.length ? `：${fields.join('、')}` : ''}（HTTP ${status ?? 422}）。请重新选择资料后重试。`
  }
  if (!status && error instanceof Error) return error.message
  const messages: Record<number, string> = {
    400: '导入请求无法解析，请重新选择资料后重试',
    401: '登录已失效，请重新登录后重试本批',
    403: '服务器拒绝了本次导入，请检查登录状态和资料库访问权限',
    409: '本次导入请求存在冲突，请刷新导入记录确认状态',
    413: '上传请求超过服务器接收限制，请缩小本批后重试',
    422: '服务器无法接收这批资料，请检查文件格式后重试',
    429: '导入请求过于频繁，请稍后重试本批',
    500: '服务器接收导入时发生错误，可重试本批',
    502: '导入服务暂时无法连接，可稍后重试本批',
    503: '导入服务暂时不可用，可稍后重试本批',
    504: '服务器接收导入超时，可重试本批',
  }
  return status ? `${messages[status] ?? '服务器未能完成导入请求'}（HTTP ${status}）。` : '无法连接导入服务，请检查网络后重试本批。'
}
