/** Messages between the main thread and the AI worker. */

export type Backend = 'webgpu' | 'wasm'

export interface ModelsConfig {
  version: number
  classifier: { id: string; dtype: Record<Backend, string>; approxMB: Record<Backend, number>; promptEmbeddings: string }
  bgRemoval: { id: string; dtype: Record<Backend, string>; approxMB: Record<Backend, number>; size: number }
  fallbackClassifier?: { id: string; dtype: Record<Backend, string> }
}

export interface PromptEmbeddings {
  model: string
  fingerprint: string
  dim: number
  labels: {
    categories: Record<string, number[]>
    subcategories: Record<string, number[]>
    patterns: Record<string, number[]>
    materials: Record<string, number[]>
  }
}

export interface Scored {
  id: string
  score: number
}

export interface Prediction {
  category: Scored[]
  subcategory: Scored[]
  pattern: Scored[]
  material: Scored[]
  embedding: number[]
}

export interface ClassifyRequest {
  type: 'classify'
  id: string
  /** The 1280 px photo. */
  image: ImageBitmap
  removeBackground: boolean
}

export interface ClassifyResult {
  type: 'result'
  id: string
  prediction: Prediction
  /** Cutout PNG when background removal ran; null otherwise. */
  cutout: Blob | null
  /** Pixels of the (cut-out) image at 128×128 for colour analysis, plus the 32×32 grey for pHash. */
  colourPixels: ImageData
  hashPixels: ImageData
  timings: Record<string, number>
}

export interface InitRequest {
  type: 'init'
  baseUrl: string
  hub: { useBrowserCache: boolean }
  models: ModelsConfig
  promptEmbeddings: PromptEmbeddings
  backend: Backend
  /** Override for the runtime's WASM location; null keeps the library default (versioned CDN, cached offline). */
  wasmPaths: string | null
}

export interface WarmupRequest {
  type: 'warmup'
  removeBackground: boolean
}

export interface ProgressMessage {
  type: 'progress'
  model: string
  file: string
  loaded: number
  total: number
  status: 'download' | 'ready' | 'error'
}

export interface ErrorMessage {
  type: 'error'
  id: string | null
  message: string
}

export interface ReadyMessage {
  type: 'ready'
  backend: Backend
}

export type WorkerRequest = InitRequest | ClassifyRequest | WarmupRequest
export type WorkerResponse = ClassifyResult | ProgressMessage | ErrorMessage | ReadyMessage
