import { catalogueSummary, categoryIds, capabilityIds, components, partnerIds, refreshLivePricing, searchComponents, type CatalogueQuery } from '@/lib/catalog/index'
import { recipes } from '@/lib/bench'

const pick = <T extends readonly string[]>(value: string | null, allowed: T): T[number] | undefined => value && (allowed as readonly string[]).includes(value) ? value as T[number] : undefined

/**
 * GET /api/catalogue?q=&category=&partner=&capability=&maxPrice=&inStockOnly=1&live=1
 * Partner component index. `live=1` refreshes Adafruit price and stock (cached 10 minutes).
 */
export async function GET(request: Request) {
  const u = new URL(request.url)
  const query: CatalogueQuery = {
    q: u.searchParams.get('q') ?? undefined,
    category: pick(u.searchParams.get('category'), categoryIds),
    partner: pick(u.searchParams.get('partner'), partnerIds),
    capability: pick(u.searchParams.get('capability'), capabilityIds),
    maxPrice: u.searchParams.get('maxPrice') ? Number(u.searchParams.get('maxPrice')) : undefined,
    inStockOnly: u.searchParams.get('inStockOnly') === '1',
  }
  let pool = components
  let live: { refreshed: number; failed: string[] } | null = null
  if (u.searchParams.get('live') === '1') {
    const r = await refreshLivePricing(components)
    pool = r.components
    live = { refreshed: r.refreshed, failed: r.failed }
  }
  const parts = searchComponents(query, pool)
  return Response.json({
    parts,
    count: parts.length,
    summary: catalogueSummary(pool),
    recipes,
    live,
    pricing: 'USD. Adafruit prices are live or dated; Raspberry Pi prices are MSRP; Arduino and generic prices are estimates.',
  }, { headers: { 'Cache-Control': live ? 'no-store' : 'public, max-age=300' } })
}
