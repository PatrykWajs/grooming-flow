/**
 * Main-thread client for the AI worker: loads the model config and prompt
 * embeddings, picks WebGPU or WASM, queues photos, reports progress.
 */
import type { Backend, ClassifyResult, ModelsConfig, ProgressMessage, PromptEmbeddings, WorkerRequest, WorkerResponse } from './protocol'

export interface ClassifyOutcome {
  result: ClassifyResult
}

type ProgressListener = (p: ProgressMessage) => void

export async function detectBackend(): Promise<Backend> {
  const nav = navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }
  if (!nav.gpu?.requestAdapter) return 'wasm'
  try {
    const adapter = await nav.gpu.requestAdapter()
    return adapter ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
}

export class AiClient {
  private worker: Worker | null = null
  private pending = new Map<string, { resolve: (r: ClassifyResult) => void; reject: (e: Error) => void }>()
  private listeners = new Set<ProgressListener>()
  private readyPromise: Promise<Backend> | null = null
  public backend: Backend = 'wasm'
  public models: ModelsConfig | null = null

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async ready(): Promise<Backend> {
    if (this.readyPromise) return this.readyPromise
    this.readyPromise = (async () => {
      const base = import.meta.env.BASE_URL
      const [models, embeddings] = await Promise.all([
        fetch(`${base}rules/models.json`).then((r) => r.json() as Promise<ModelsConfig>),
        fetch(`${base}rules/prompt-embeddings.json`).then((r) => r.json() as Promise<PromptEmbeddings>),
      ])
      this.models = models
      this.backend = await detectBackend()
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => this.handle(event.data))
      this.worker.addEventListener('error', (event) => {
        for (const [, p] of this.pending) p.reject(new Error(event.message))
        this.pending.clear()
      })
      const init: WorkerRequest = {
        type: 'init',
        baseUrl: base,
        hub: { useBrowserCache: true },
        models,
        promptEmbeddings: embeddings,
        backend: this.backend,
        wasmPaths: null,
      }
      await new Promise<void>((resolve) => {
        const once = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.type === 'ready') {
            this.worker?.removeEventListener('message', once)
            resolve()
          }
        }
        this.worker!.addEventListener('message', once)
        this.worker!.postMessage(init)
      })
      return this.backend
    })()
    return this.readyPromise
  }

  /** Download the models ahead of the first photo (shows the progress screen). */
  async warmup(removeBackground: boolean): Promise<void> {
    await this.ready()
    await new Promise<void>((resolve, reject) => {
      const once = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === 'ready') {
          this.worker?.removeEventListener('message', once)
          resolve()
        } else if (event.data.type === 'error' && event.data.id === null) {
          this.worker?.removeEventListener('message', once)
          reject(new Error(event.data.message))
        }
      }
      this.worker!.addEventListener('message', once)
      this.worker!.postMessage({ type: 'warmup', removeBackground } satisfies WorkerRequest)
    })
  }

  async classify(id: string, image: ImageBitmap, removeBackground: boolean): Promise<ClassifyResult> {
    await this.ready()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ type: 'classify', id, image, removeBackground } satisfies WorkerRequest, [image])
    })
  }

  private handle(message: WorkerResponse) {
    if (message.type === 'progress') {
      for (const l of this.listeners) l(message)
    } else if (message.type === 'result') {
      this.pending.get(message.id)?.resolve(message)
      this.pending.delete(message.id)
    } else if (message.type === 'error' && message.id) {
      this.pending.get(message.id)?.reject(new Error(message.message))
      this.pending.delete(message.id)
    }
  }

  dispose() {
    this.worker?.terminate()
    this.worker = null
    this.readyPromise = null
  }
}

export const aiClient = new AiClient()
