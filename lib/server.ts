import { env } from 'cloudflare:workers'

export function database() { if (!env.DB) throw new Error('Project storage unavailable'); return env.DB }

/** Same-origin check for browser-initiated writes. */
export function guard(request: Request) {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Request origin not allowed' }, { status: 403 })
  return null
}

export async function jsonBody(request: Request, limit = 15000) {
  const text = await request.text()
  if (text.length > limit) throw new Error('Request too large')
  return JSON.parse(text)
}

function secret(name: string): string | undefined {
  const value = (env as unknown as Record<string, string | undefined>)[name]
  return value && value.length >= 16 ? value : undefined
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function bearer(request: Request) {
  const h = request.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

/**
 * The local bench agent authenticates with BENCH_AGENT_TOKEN. Returns a response to send when denied.
 * If no token is configured, machine endpoints are closed rather than open.
 */
export function agentAuth(request: Request): Response | null {
  const token = secret('BENCH_AGENT_TOKEN')
  if (!token) return Response.json({ error: 'BENCH_AGENT_TOKEN is not configured; machine endpoints are closed.' }, { status: 503 })
  const given = bearer(request)
  if (!given || !timingSafeEqual(given, token)) return Response.json({ error: 'Invalid bench agent token' }, { status: 401 })
  return null
}

/**
 * Operators act from the workbench (same origin) or with BENCH_API_TOKEN from an agent such as Claude Code.
 * Returns the actor kind, or a response to send when denied.
 */
export function operatorAuth(request: Request): { actor: 'ui' | 'api' } | Response {
  const given = bearer(request)
  if (given) {
    const token = secret('BENCH_API_TOKEN')
    if (token && timingSafeEqual(given, token)) return { actor: 'api' }
    return Response.json({ error: 'Invalid API token' }, { status: 401 })
  }
  const denied = guard(request)
  if (denied) return denied
  // Cross-site browsers cannot forge this header on a same-origin fetch without CORS approval.
  if (request.method !== 'GET' && !request.headers.get('origin') && request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Request origin not allowed' }, { status: 403 })
  return { actor: 'ui' }
}

export function tokensConfigured() {
  return { agent: !!secret('BENCH_AGENT_TOKEN'), api: !!secret('BENCH_API_TOKEN'), ai: !!(env as unknown as Record<string, string>).OPENAI_API_KEY }
}
