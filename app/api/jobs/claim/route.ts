import { agentAuth, jsonBody } from '@/lib/server'
import { claimNextJob } from '@/lib/machines/store'
import { z } from 'zod'

/** POST /api/jobs/claim { machineId } (bench agent) → the oldest queued job with its file content, or null. */
export async function POST(request: Request) {
  const denied = agentAuth(request)
  if (denied) return denied
  try {
    const { machineId } = z.object({ machineId: z.string() }).parse(await jsonBody(request))
    const job = await claimNextJob(machineId)
    return Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return Response.json({ error: e instanceof z.ZodError ? 'machineId required' : 'Machine storage is unavailable' }, { status: e instanceof z.ZodError ? 400 : 503 })
  }
}
