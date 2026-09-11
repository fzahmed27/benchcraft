import { componentSchema, partners, type CapabilityId, type CategoryId, type Component, type PartnerId } from './schema.ts'
import { seedComponents } from './seed.ts'

export * from './schema.ts'

/** Validated partner index. Throws at import time if the seed is malformed. */
export const components: Component[] = seedComponents.map(c => componentSchema.parse(c))

const byId = new Map(components.map(c => [c.id, c]))

export function getComponent(id: string): Component | undefined {
  return byId.get(id)
}

export type CatalogueQuery = {
  q?: string
  category?: CategoryId
  partner?: PartnerId
  capability?: CapabilityId
  /** Only components that a controller with these buses can drive directly. */
  buses?: string[]
  maxPrice?: number
  inStockOnly?: boolean
}

export function searchComponents(query: CatalogueQuery = {}, pool: Component[] = components): Component[] {
  const q = query.q?.trim().toLowerCase()
  return pool.filter(c => {
    if (query.category && c.category !== query.category) return false
    if (query.partner && c.source.partner !== query.partner && !c.alsoFrom.some(s => s.partner === query.partner)) return false
    if (query.capability && !c.provides.includes(query.capability)) return false
    if (query.buses && c.requires.bus && !query.buses.includes(c.requires.bus)) return false
    if (query.maxPrice !== undefined && c.price > query.maxPrice) return false
    if (query.inStockOnly && c.stock === 'out-of-stock') return false
    if (q) {
      const hay = [c.id, c.name, c.spec, c.notes, c.category, ...c.tags, ...c.provides, c.source.sku].join(' ').toLowerCase()
      if (!q.split(/\s+/).every(term => hay.includes(term))) return false
    }
    return true
  })
}

export function componentsProviding(capability: CapabilityId, pool: Component[] = components): Component[] {
  return pool.filter(c => c.provides.includes(capability)).sort((a, b) => a.price - b.price)
}

/** Summary an agent can read in one call to learn what the index covers. */
export function catalogueSummary(pool: Component[] = components) {
  const capabilities = new Map<string, number>()
  const byPartner = new Map<string, number>()
  for (const c of pool) {
    for (const p of c.provides) capabilities.set(p, (capabilities.get(p) ?? 0) + 1)
    byPartner.set(c.source.partner, (byPartner.get(c.source.partner) ?? 0) + 1)
  }
  return {
    count: pool.length,
    partners: Object.fromEntries(Object.entries(partners).map(([id, p]) => [id, { ...p, indexed: byPartner.get(id) ?? 0 }])),
    capabilities: Object.fromEntries([...capabilities.entries()].sort()),
    controllers: pool.filter(c => c.controller).map(c => ({ id: c.id, name: c.name, platform: c.controller!.platform, wifi: c.controller!.wifi, logicVoltage: c.controller!.logicVoltage, price: c.price })),
    pricing: 'USD. "live" prices were read from the partner API on priceCheckedAt; "msrp" and "estimate" prices must be confirmed at checkout.',
  }
}

// ───────────────────────── Live partner refresh ─────────────────────────

type AdafruitProduct = { product_id: string; product_price: string; product_stock: string; discontinue_status?: string }

const liveCache = new Map<string, { fetchedAt: number; price: number; stock: Component['stock'] }>()
const LIVE_TTL_MS = 10 * 60 * 1000

function adafruitStock(value: string): Component['stock'] {
  if (value === 'in stock') return 'in-stock'
  const n = Number(value)
  if (Number.isNaN(n)) return 'unknown'
  if (n <= 0) return 'out-of-stock'
  if (n < 20) return 'low'
  return 'in-stock'
}

/**
 * Refresh price and stock for every component that has an Adafruit SKU using
 * Adafruit's public product API. Returns a new array; components whose lookup
 * fails keep their seeded values. Bounded by `limit` so one request cannot fan
 * out into hundreds of upstream calls.
 */
export async function refreshLivePricing(pool: Component[] = components, opts: { limit?: number; timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<{ components: Component[]; refreshed: number; failed: string[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const limit = opts.limit ?? 60
  const timeoutMs = opts.timeoutMs ?? 8000
  const now = Date.now()
  const failed: string[] = []
  let refreshed = 0
  const targets = pool.map(c => {
    const src = c.source.partner === 'adafruit' ? c.source : c.alsoFrom.find(s => s.partner === 'adafruit')
    return src ? { c, sku: src.sku } : null
  }).filter((t): t is { c: Component; sku: string } => !!t).slice(0, limit)

  const results = await Promise.all(targets.map(async ({ c, sku }) => {
    const cached = liveCache.get(sku)
    if (cached && now - cached.fetchedAt < LIVE_TTL_MS) return { c, live: cached }
    try {
      const r = await fetchImpl(`https://www.adafruit.com/api/product/${encodeURIComponent(sku)}`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error(String(r.status))
      const p = await r.json() as AdafruitProduct
      const price = Number(p.product_price)
      if (!Number.isFinite(price)) throw new Error('bad price')
      const live = { fetchedAt: now, price, stock: adafruitStock(String(p.product_stock)) }
      liveCache.set(sku, live)
      return { c, live }
    } catch {
      failed.push(c.id)
      return { c, live: null }
    }
  }))

  const liveById = new Map(results.filter(r => r.live).map(r => [r.c.id, r.live!]))
  const out = pool.map(c => {
    const live = liveById.get(c.id)
    if (!live) return c
    refreshed++
    // Only adopt the live price when Adafruit is the primary source; otherwise keep MSRP and update stock only.
    const primary = c.source.partner === 'adafruit'
    return { ...c, price: primary ? live.price : c.price, pricing: primary ? 'live' as const : c.pricing, stock: live.stock, priceCheckedAt: new Date(live.fetchedAt).toISOString().slice(0, 10) }
  })
  return { components: out, refreshed, failed }
}
