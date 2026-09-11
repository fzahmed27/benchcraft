import { env } from 'cloudflare:workers'
import { tokensConfigured } from '@/lib/server'
import { listMachines } from '@/lib/machines/store'

export async function GET() {
  const tokens = tokensConfigured()
  let machines: Awaited<ReturnType<typeof listMachines>> = []
  let storage = !!env.DB
  if (storage) { try { machines = await listMachines() } catch { storage = false } }
  const online = machines.filter(m => m.state !== 'offline')
  return Response.json({
    aiConnected: tokens.ai,
    storage,
    hardwareConnected: online.length > 0,
    machines: machines.map(m => ({ id: m.id, name: m.name, kind: m.kind, state: m.state, detail: m.detail, trusted: m.trusted })),
    agentTokenConfigured: tokens.agent,
    apiTokenConfigured: tokens.api,
    mcpEndpoint: '/api/mcp',
  }, { headers: { 'Cache-Control': 'no-store' } })
}
