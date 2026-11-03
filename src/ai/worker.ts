/// <reference lib="webworker" />
/**
 * The AI worker: zero-shot classification with a fashion SigLIP vision tower
 * against prompt embeddings computed at build time, background removal
 * (RMBG-1.4) with the cutout laid on white, and pixel data for colour and
 * hashing. Everything runs on the device; model files come from the Hugging
 * Face Hub once and stay in the browser cache.
 */
import type { PreTrainedModel, Processor, RawImage as RawImageType, Tensor as TensorType } from '@huggingface/transformers'
import type { Backend, ClassifyRequest, InitRequest, ModelsConfig, Prediction, PromptEmbeddings, Scored, WorkerRequest, WorkerResponse } from './protocol'

type Transformers = typeof import('@huggingface/transformers')
type RawImage = InstanceType<typeof RawImageType>

let lib: Transformers | null = null
let config: InitRequest | null = null
let backend: Backend = 'wasm'

interface Loaded {
  model: PreTrainedModel
  processor: Processor
}

let vision: Loaded | null = null
let segmenter: Loaded | null = null

const post = (message: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer)

async function loadLib(): Promise<Transformers> {
  if (lib) return lib
  lib = await import('@huggingface/transformers')
  return lib
}

function progressFor(modelId: string) {
  return (event: { status?: string; file?: string; loaded?: number; total?: number; progress?: number }) => {
    if (event.status === 'progress' || event.status === 'download' || event.status === 'done') {
      post({ type: 'progress', model: modelId, file: event.file ?? '', loaded: event.loaded ?? 0, total: event.total ?? 0, status: event.status === 'done' ? 'ready' : 'download' })
    }
  }
}

async function init(request: InitRequest): Promise<void> {
  config = request
  backend = request.backend
  const t = await loadLib()
  t.env.allowLocalModels = false
  t.env.allowRemoteModels = true
  t.env.useBrowserCache = request.hub.useBrowserCache
  if (t.env.backends.onnx?.wasm) {
    if (request.wasmPaths) t.env.backends.onnx.wasm.wasmPaths = request.wasmPaths
    const threads = typeof SharedArrayBuffer !== 'undefined' && (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1
    t.env.backends.onnx.wasm.numThreads = threads
  }
  post({ type: 'ready', backend })
}

async function loadVision(models: ModelsConfig) {
  if (vision) return vision
  const t = await loadLib()
  const id = models.classifier.id
  const dtype = models.classifier.dtype[backend] as import('@huggingface/transformers').DataType
  const processor = await t.AutoProcessor.from_pretrained(id, { progress_callback: progressFor(id) })
  const model = await t.SiglipVisionModel.from_pretrained(id, { device: backend, dtype, progress_callback: progressFor(id) })
  vision = { model, processor }
  return vision
}

async function loadSegmenter(models: ModelsConfig) {
  if (segmenter) return segmenter
  const t = await loadLib()
  const id = models.bgRemoval.id
  const dtype = models.bgRemoval.dtype[backend] as import('@huggingface/transformers').DataType
  const model = await t.AutoModel.from_pretrained(id, { device: backend, dtype, config: { model_type: 'custom' } as never, progress_callback: progressFor(id) })
  const processor = await t.AutoProcessor.from_pretrained(id, {
    config: {
      do_normalize: true,
      do_pad: false,
      do_rescale: true,
      do_resize: true,
      image_mean: [0.5, 0.5, 0.5],
      feature_extractor_type: 'ImageFeatureExtractor',
      image_std: [1, 1, 1],
      resample: 2,
      rescale_factor: 1 / 255,
      size: { width: models.bgRemoval.size, height: models.bgRemoval.size },
    } as never,
    progress_callback: progressFor(id),
  })
  segmenter = { model, processor }
  return segmenter
}

function cosineTop(embedding: Float32Array | number[], labels: Record<string, number[]>, top = 5): Scored[] {
  const scored: Scored[] = []
  for (const [id, vector] of Object.entries(labels)) {
    let dot = 0
    for (let i = 0; i < vector.length; i++) dot += embedding[i] * vector[i]
    scored.push({ id, score: dot })
  }
  scored.sort((a, b) => b.score - a.score)
  // Softmax over the group with SigLIP's logit scale (≈ 100 × cosine).
  const scale = 100
  const max = scored[0]?.score ?? 0
  const exps = scored.map((s) => Math.exp(scale * (s.score - max)))
  const sum = exps.reduce((a, b) => a + b, 0)
  return scored.slice(0, top).map((s, i) => ({ id: s.id, score: exps[i] / sum }))
}

async function embed(image: RawImage): Promise<number[]> {
  const v = await loadVision(config!.models)
  const inputs = await v.processor(image)
  const output = await v.model(inputs)
  const tensor: InstanceType<typeof TensorType> = output.pooler_output ?? output.image_embeds ?? output.last_hidden_state
  const data = Array.from(tensor.data as Float32Array)
  const dim = tensor.dims[tensor.dims.length - 1]
  const row = data.slice(0, dim)
  const norm = Math.hypot(...row) || 1
  return row.map((x) => x / norm)
}

/** The garment with its background turned transparent (the mask becomes the alpha channel). */
async function removeBackground(image: RawImage): Promise<RawImage> {
  const t = await loadLib()
  const s = await loadSegmenter(config!.models)
  const { pixel_values } = await s.processor(image)
  const { output } = await s.model({ input: pixel_values })
  const mask = await t.RawImage.fromTensor(output[0].mul(255).to('uint8')).resize(image.width, image.height)
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image.toCanvas(), 0, 0)
  const pixels = ctx.getImageData(0, 0, image.width, image.height)
  for (let i = 0; i < mask.data.length; i++) pixels.data[4 * i + 3] = mask.data[i]
  ctx.putImageData(pixels, 0, 0)
  return t.RawImage.fromCanvas(canvas)
}

/**
 * The cutout over an opaque white background: what the user sees in every
 * theme, what the classifier scores and what the hash is taken from. (A
 * transparent cutout drawn on the dark theme looked black.)
 */
async function onWhite(image: RawImage): Promise<RawImage> {
  const t = await loadLib()
  const canvas = new OffscreenCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, image.width, image.height)
  ctx.drawImage(image.toCanvas(), 0, 0)
  return t.RawImage.fromCanvas(canvas)
}

function pixelsOf(image: RawImage, size: number): ImageData {
  const canvas = new OffscreenCanvas(size, size)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(image.toCanvas(), 0, 0, size, size)
  return ctx.getImageData(0, 0, size, size)
}

async function classify(request: ClassifyRequest): Promise<void> {
  const t = await loadLib()
  const timings: Record<string, number> = {}
  const started = performance.now()
  const canvas = new OffscreenCanvas(request.image.width, request.image.height)
  canvas.getContext('2d')!.drawImage(request.image, 0, 0)
  request.image.close()
  let image = t.RawImage.fromCanvas(canvas)
  let cutout: Blob | null = null
  let colourPixels: ImageData | null = null
  if (request.removeBackground) {
    const t0 = performance.now()
    try {
      const garment = await removeBackground(image)
      // Colour is read from the garment pixels alone (alpha); everything else sees the cutout on white.
      colourPixels = pixelsOf(garment, 192)
      image = await onWhite(garment)
      cutout = await image.toBlob('image/png')
    } catch (error) {
      post({ type: 'error', id: null, message: `bg-removal: ${(error as Error).message}` })
    }
    timings.bgRemoval = performance.now() - t0
  }
  const t1 = performance.now()
  const embedding = await embed(image)
  timings.embed = performance.now() - t1
  const labels = config!.promptEmbeddings.labels
  const prediction: Prediction = {
    category: cosineTop(embedding, labels.categories, 3),
    subcategory: cosineTop(embedding, labels.subcategories, 5),
    pattern: cosineTop(embedding, labels.patterns, 3),
    material: cosineTop(embedding, labels.materials, 3),
    embedding,
  }
  const hashPixels = pixelsOf(image, 32)
  timings.total = performance.now() - started
  post({ type: 'result', id: request.id, prediction, cutout, colourPixels: colourPixels ?? pixelsOf(image, 192), hashPixels, timings })
}

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data
  const run = async () => {
    if (request.type === 'init') await init(request)
    else if (request.type === 'warmup') {
      await loadVision(config!.models)
      if (request.removeBackground) await loadSegmenter(config!.models)
      post({ type: 'ready', backend })
    } else if (request.type === 'classify') await classify(request)
  }
  run().catch((error: Error) => post({ type: 'error', id: request.type === 'classify' ? request.id : null, message: error.message }))
})

export type { PromptEmbeddings }
