import { env } from 'cloudflare:workers'
import { operatorAuth, jsonBody } from '@/lib/server'
import { designDevice, designRequest } from '@/lib/design'
import { getDesign, listDesigns, saveDesign } from '@/lib/machines/store'

/** POST /api/design { prompt, preferences?, inventory? } → design record (saved when storage is available). */
export async function POST(request: Request) {
  const auth = operatorAuth(request)
  if (auth instanceof Response) return auth
  try {
    const req = designRequest.parse(await jsonBody(request))
    const design = designDevice(req)
    let saved = false
    if (env.DB) { try { await saveDesign(design); saved = true } catch (e) { console.error('Design save failed', e) } }
    return Response.json({ design, saved }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Describe the device in a sentence or two (3–2000 characters).' }, { status: 400 })
  }
}

/** GET /api/design?id= → one saved design; without id → recent designs. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  try {
    if (id) {
      const design = await getDesign(id)
      return design ? Response.json({ design }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Design not found' }, { status: 404 })
    }
    return Response.json({ designs: await listDesigns() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Design storage is unavailable' }, { status: 503 })
  }
}
