import { agentAuth, operatorAuth, jsonBody } from '@/lib/server'
import { adapters, jobInput, jobStates, jobUpdateInput } from '@/lib/machines/schema'
import { createJob, getJob, getMachine, listJobs, updateJob } from '@/lib/machines/store'
import { z } from 'zod'

/** GET /api/jobs?machineId=&state=&id= */
export async function GET(request: Request) {
  const u = new URL(request.url)
  try {
    const id = u.searchParams.get('id')
    if (id) { const job = await getJob(id); return job ? Response.json({ job }, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Job not found' }, { status: 404 }) }
    const state = u.searchParams.get('state')
    const jobs = await listJobs({ machineId: u.searchParams.get('machineId') ?? undefined, state: state && (jobStates as readonly string[]).includes(state) ? state as typeof jobStates[number] : undefined })
    return Response.json({ jobs }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: 'Machine storage is unavailable' }, { status: 503 })
  }
}

/** POST /api/jobs (operator: workbench or API token) → create a fabrication job. */
export async function POST(request: Request) {
  const auth = operatorAuth(request)
  if (auth instanceof Response) return auth
  try {
    const raw = await jsonBody(request, 2_100_000)
    const input = jobInput.parse({ ...(raw as object), requestedBy: auth.actor })
    const machine = await getMachine(input.machineId)
    if (!machine) return Response.json({ error: 'Machine not registered' }, { status: 404 })
    const accepts = new Set([...machine.capabilities.accepts, ...adapters[machine.adapter].accepts])
    if (!accepts.has(input.file.type)) return Response.json({ error: `${machine.name} accepts ${[...accepts].join(', ')}, not ${input.file.type}` }, { status: 400 })
    const job = await createJob(input, machine.trusted ? 'queued' : 'pending_approval')
    return Response.json({ job })
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: 'Invalid job: check machineId, title, file name/type/content.' }, { status: 400 })
    return Response.json({ error: 'Could not create the job' }, { status: 503 })
  }
}

/**
 * PATCH /api/jobs { id, state?, progress?, message? }
 * Bench agent (token) reports progress; operators approve (state: queued) or cancel.
 */
export async function PATCH(request: Request) {
  let body: unknown
  try { body = await jsonBody(request) } catch { return Response.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = jobUpdateInput.extend({ id: z.string().uuid() }).safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid job update' }, { status: 400 })
  const { id, ...patch } = parsed.data
  const isAgent = (request.headers.get('authorization') ?? '').startsWith('Bearer ') && !agentAuth(request)
  let actor: 'agent' | 'operator'
  if (isAgent) actor = 'agent'
  else { const auth = operatorAuth(request); if (auth instanceof Response) return auth; actor = 'operator' }
  if (actor === 'operator' && patch.state && !['queued', 'cancelled'].includes(patch.state)) return Response.json({ error: 'Operators can only approve (queued) or cancel jobs' }, { status: 400 })
  try {
    const r = await updateJob(id, patch, actor)
    if (r.error) return Response.json({ error: r.error }, { status: r.job ? 409 : 404 })
    return Response.json({ job: r.job })
  } catch {
    return Response.json({ error: 'Machine storage is unavailable' }, { status: 503 })
  }
}
