#!/usr/bin/env node
/**
 * Encode the taxonomy prompts with the classifier's text tower once, at build
 * time, so the phone only ever downloads the vision tower.
 *
 *   node scripts/build-prompt-embeddings.mjs            # writes public/rules/prompt-embeddings.json
 *   node scripts/build-prompt-embeddings.mjs --check    # exits 1 when taxonomy.json is newer than the output
 *
 * Runs in Node with @huggingface/transformers (downloads the text model once
 * into .cache/transformers). The output is deterministic for a given model id
 * and taxonomy; commit it.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const rulesDir = `${root}public/rules/`
const outFile = `${rulesDir}prompt-embeddings.json`
const taxonomy = JSON.parse(readFileSync(`${rulesDir}taxonomy.json`, 'utf8'))
const models = JSON.parse(readFileSync(`${rulesDir}models.json`, 'utf8'))

const TEMPLATES = ['a photo of {}.', 'a product photo of {}, on a plain background.', 'a flat lay photo of {}.']

function prompts() {
  const labels = { categories: {}, subcategories: {}, patterns: {}, materials: {} }
  const categoryPrompts = {
    tops: 'a top such as a shirt, t-shirt, polo or sweater',
    outerwear: 'a jacket, blazer or coat',
    bottoms: 'trousers, jeans, chinos or shorts',
    shoes: 'a pair of shoes',
    belts: 'a belt',
    accessories: 'an accessory such as a watch, sunglasses, hat, scarf, bag or tie',
    sets: 'a full suit or a tracksuit',
  }
  for (const category of taxonomy.categories) {
    labels.categories[category.id] = categoryPrompts[category.id] ?? category.en.toLowerCase()
    for (const sub of category.subcategories) labels.subcategories[sub.id] = sub.prompt ?? sub.en.toLowerCase()
  }
  for (const pattern of taxonomy.patterns) labels.patterns[pattern.id] = `a ${pattern.prompt} garment`
  for (const material of taxonomy.materials) if (material.id !== 'other') labels.materials[material.id] = `a garment made of ${material.en}`
  return labels
}

function fingerprint(labels) {
  return createHash('sha256').update(JSON.stringify({ model: models.classifier.id, labels })).digest('hex').slice(0, 16)
}

async function main() {
  const labels = prompts()
  const hash = fingerprint(labels)
  if (process.argv.includes('--check')) {
    if (!existsSync(outFile)) {
      console.error('prompt-embeddings.json is missing')
      process.exit(1)
    }
    const current = JSON.parse(readFileSync(outFile, 'utf8'))
    if (current.fingerprint !== hash) {
      console.error('prompt-embeddings.json is stale: run `npm run embeddings`')
      process.exit(1)
    }
    console.log('prompt-embeddings.json up to date')
    return
  }
  if (existsSync(outFile)) {
    const current = JSON.parse(readFileSync(outFile, 'utf8'))
    if (current.fingerprint === hash && !process.argv.includes('--force')) {
      console.log('prompt-embeddings.json already up to date (use --force to rebuild)')
      return
    }
  }

  const { AutoTokenizer, SiglipTextModel, env } = await import('@huggingface/transformers')
  env.cacheDir = `${root}.cache/transformers`
  mkdirSync(env.cacheDir, { recursive: true })
  const modelId = models.classifier.id
  console.log(`loading text tower of ${modelId} ...`)
  const tokenizer = await AutoTokenizer.from_pretrained(modelId)
  const model = await SiglipTextModel.from_pretrained(modelId, { dtype: 'q8' })

  async function encode(texts) {
    const inputs = tokenizer(texts, { padding: 'max_length', truncation: true })
    const output = await model(inputs)
    const tensor = output.pooler_output ?? output.text_embeds ?? output.last_hidden_state
    const [n, dim] = tensor.dims.length === 2 ? tensor.dims : [tensor.dims[0], tensor.dims[tensor.dims.length - 1]]
    const data = tensor.data
    const rows = []
    for (let i = 0; i < n; i++) {
      const row = Array.from(data.slice(i * dim, (i + 1) * dim))
      const norm = Math.hypot(...row) || 1
      rows.push(row.map((v) => v / norm))
    }
    return rows
  }

  const result = { model: modelId, fingerprint: hash, builtAt: new Date().toISOString(), dim: 0, labels: {} }
  for (const [group, entries] of Object.entries(labels)) {
    result.labels[group] = {}
    for (const [id, text] of Object.entries(entries)) {
      const variants = TEMPLATES.map((t) => t.replace('{}', text))
      const rows = await encode(variants)
      const dim = rows[0].length
      const mean = new Array(dim).fill(0)
      for (const row of rows) for (let i = 0; i < dim; i++) mean[i] += row[i] / rows.length
      const norm = Math.hypot(...mean) || 1
      result.labels[group][id] = mean.map((v) => Number((v / norm).toFixed(5)))
      result.dim = dim
    }
    console.log(`${group}: ${Object.keys(entries).length} labels`)
  }
  writeFileSync(outFile, JSON.stringify(result))
  console.log(`wrote ${outFile} (${Math.round(statSync(outFile).size / 1024)} KB, dim ${result.dim})`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
