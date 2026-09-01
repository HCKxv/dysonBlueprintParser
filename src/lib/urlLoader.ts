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
  const txtUrl = params.get('txt')
  if (!txtUrl) return false

  try {
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
  }
}
