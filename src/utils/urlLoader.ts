// URL 参数（?txt=...）蓝图加载器
const DEFAULT_WHITELIST = [
  'raw.githubusercontent.com/DSPBluePrints/',
  'cdn.jsdelivr.net/gh/DSPBluePrints/',
]

/** 蓝图种类 */
export type BlueprintKind = 'sphere' | 'factory'

/** 蓝图的开头标记 */
const BLUEPRINT_PREFIXES: ReadonlyArray<{ prefix: string, kind: BlueprintKind }> = [
  { prefix: 'DYBP:', kind: 'sphere' },
  { prefix: 'BLUEPRINT:', kind: 'factory' },
]

export interface UrlLoadCallbacks {
  onLoadStart?: () => void
  onLoaded?: (text: string, type: BlueprintKind) => void
  onError?: (e: Error) => void
}

/**
 * 去掉地址栏上的 ?txt= 参数（保留其他参数与 hash）
 * 蓝图只从 URL 读取一次，加载完成后参数无需再留在地址栏中
 */
export function clearTxtParamFromUrl(): boolean {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('txt')) return false
  url.searchParams.delete('txt')
  try {
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    return true
  } catch {
    /* 特殊环境下 replaceState 不可用时忽略 */
    return false
  }
}

function isUrlAllowed(url: URL, list: string[] = DEFAULT_WHITELIST): boolean {
  const host = url.hostname
  const path = url.pathname
  return list.some((entry) => {
    if (entry.includes('/')) {
      const slash = entry.indexOf('/')
      const entryHost = entry.slice(0, slash)
      let entryPath = entry.slice(slash)
      if (!entryPath.endsWith('/')) {
        entryPath += '/'
      }
      return host === entryHost && (path + '/').startsWith(entryPath)
    }
    return host === entry
  })
}

export async function loadBlueprintFromUrl({
  onLoadStart,
  onLoaded,
  onError,
}: UrlLoadCallbacks): Promise<boolean> {
  const params = new URLSearchParams(window.location.search)

  try {
    const txtUrl = params.get('txt')
    if (!txtUrl) return false

    onLoadStart?.()
    const resolved = new URL(txtUrl, window.location.href)
    const isWhitelist = isUrlAllowed(resolved)
    const isSameOrigin = resolved.hostname === window.location.hostname
    if (!isSameOrigin && !isWhitelist) {
      throw new Error('未知的蓝图链接')
    }

    const response = await fetch(resolved.href)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()

    const value = text.trim()
    const matched = BLUEPRINT_PREFIXES.find(({ prefix }) => value.startsWith(prefix))
    if (!matched) throw new Error('链接不是有效的蓝图代码')

    onLoaded?.(text, matched.kind)
    return true
  } catch (e) {
    onError?.(e as Error)
    return false
  } finally {
    // 无论成功、失败还是压根没带参数，都在这里丢掉 ?txt=
    clearTxtParamFromUrl()
  }
}
