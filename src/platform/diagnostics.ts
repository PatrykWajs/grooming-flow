/** Phone capability probe shown by the M0 shell and later in Settings. */
export interface Diagnostics {
  standalone: boolean
  webgpu: boolean
  wasmThreads: boolean
  /** null when the Storage API is missing. */
  persisted: boolean | null
  quotaMB: number | null
  usageMB: number | null
  userAgent: string
  language: string
}

type NavigatorWithExtras = Navigator & { standalone?: boolean; gpu?: unknown }

export async function collectDiagnostics(): Promise<Diagnostics> {
  const nav = navigator as NavigatorWithExtras
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
  const webgpu = 'gpu' in nav
  const wasmThreads =
    typeof SharedArrayBuffer !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true

  let persisted: boolean | null = null
  let quotaMB: number | null = null
  let usageMB: number | null = null

  if (nav.storage) {
    try {
      persisted = await nav.storage.persisted()
      if (persisted === false) persisted = await nav.storage.persist()
    } catch {
      persisted = null
    }
    try {
      const estimate = await nav.storage.estimate()
      quotaMB = estimate.quota != null ? Math.round(estimate.quota / 1048576) : null
      usageMB = estimate.usage != null ? Math.round(estimate.usage / 1048576) : null
    } catch {
      /* unsupported */
    }
  }

  return {
    standalone,
    webgpu,
    wasmThreads,
    persisted,
    quotaMB,
    usageMB,
    userAgent: nav.userAgent,
    language: nav.language,
  }
}
