import { agentAuth, operatorAuth, jsonBody } from '@/lib/server'
import { adapters, machineInput, machineStatusInput } from '@/lib/machines/schema'
import { listMachines, setMachineStatus, setMachineTrust, upsertMachine } from '@/lib/machines/store'
import { z } from 'zod'

/** GET /api/machines → registered machines with live state, plus supported adapters. */
export async function GET() {
  try {
    return Response.json({ machines: await listMachines(), adapters }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ machines: [], adapters, error: 'Machine storage is unavailable' }, { status: 503 })
  }
}

/** POST /api/machines (bench agent) → register or update a machine. Trust is preserved, never granted here. */
export async function POST(request: Request) {
  const denied = agentAuth(request)
  if (denied) return denied
  try {
    const input = machineInput.parse(await jsonBody(request))
    const machine = await upsertMachine({ ...input, trusted: false }, { keepTrust: true })
    return Response.json({ machine })
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? 'Invalid machine registration' : 'Could not register machine' }, { status: e instanceof z.ZodError ? 400 : 503 })
  }
}

/**
 * PATCH /api/machines
 *  - bench agent: { id, status: { state, detail, ... } } heartbeat
 *  - operator:    { id, trusted } to allow jobs to start without approval
 */
export async function PATCH(request: Request) {
  let body: unknown
  try { body = await jsonBody(request) } catch { return Response.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = z.object({ id: z.string(), status: machineStatusInput.optional(), trusted: z.boolean().optional() }).safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid machine update' }, { status: 400 })
  const { id, status, trusted } = parsed.data
  try {
    if (status) {
      const denied = agentAuth(request)
      if (denied) return denied
      const ok = await setMachineStatus(id, status.state, status.detail)
      return ok ? Response.json({ ok: true }) : Response.json({ error: 'Machine not registered' }, { status: 404 })
    }
    if (trusted !== undefined) {
      const auth = operatorAuth(request)
      if (auth instanceof Response) return auth
      const machine = await setMachineTrust(id, trusted)
      return machine ? Response.json({ machine }) : Response.json({ error: 'Machine not registered' }, { status: 404 })
    }
    return Response.json({ error: 'Nothing to update' }, { status: 400 })
  } catch {
    return Response.json({ error: 'Machine storage is unavailable' }, { status: 503 })
  }
}
