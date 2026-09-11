import { env } from 'cloudflare:workers'
import { operatorAuth, jsonBody } from '@/lib/server'
import { handleMcpPost, PROTOCOL_VERSION, tools } from '@/lib/mcp'

/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless).
 * Point an MCP client at this URL. Read-only tools work anonymously inside the private site;
 * fabrication tools need `Authorization: Bearer <BENCH_API_TOKEN>`.
 */
export async function POST(request: Request) {
  let actor: 'api' | null = null
  if ((request.headers.get('authorization') ?? '').startsWith('Bearer ')) {
    const auth = operatorAuth(request)
    if (auth instanceof Response) return auth
    actor = 'api'
  }
  let body: unknown
  try { body = await jsonBody(request, 2_200_000) } catch { return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 }) }
  return handleMcpPost(body, { actor, storage: !!env.DB })
}

/** Human-readable discovery for anyone who opens the endpoint in a browser. */
export function GET() {
  return Response.json({
    name: 'benchcraft',
    protocol: 'Model Context Protocol',
    protocolVersion: PROTOCOL_VERSION,
    transport: 'streamable-http (POST JSON-RPC; no SSE stream)',
    tools: tools.map(t => ({ name: t.name, requiresAuth: !!t.requiresAuth, description: t.description })),
    connect: { claudeCode: 'claude mcp add --transport http benchcraft <this url> --header "Authorization: Bearer <BENCH_API_TOKEN>"' },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
