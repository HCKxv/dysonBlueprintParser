// URL 参数（?txt=...）蓝图加载器
const DEFAULT_WHITELIST = [
  'raw.githubusercontent.com/DSPBluePrints/DysonSphereBluePrints/',
  'cdn.jsdelivr.net/gh/DSPBluePrints/DysonSphereBluePrints@main/',
]

export interface UrlLoadCallbacks {
  onLoadStart?: () => void
  onLoaded?: (text: string) => void
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

    if (!text.trim().startsWith('DYBP:')) throw new Error('链接不是有效的蓝图代码')
    onLoaded?.(text)
    return true
  } catch (e) {
    onError?.(e as Error)
    return false
  } finally {
    // 无论成功、失败还是压根没带参数，都在这里丢掉 ?txt=
    clearTxtParamFromUrl()
  }
}
