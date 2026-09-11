import { database } from '../server'
import { canTransition, jobStates, machineInput, type Job, type JobInput, type JobState, type Machine, type MachineInput } from './schema'
import type { DesignRecord } from '../design'

type MachineRow = { id: string; payload: string; state: string; detail: string; last_seen_at: string | null; registered_at: string }
type JobRow = { id: string; machine_id: string; project_id: string | null; title: string; state: string; progress: number; message: string; requested_by: string; file_name: string; file_type: string; file_content: string; settings: string; created_at: string; updated_at: string }

const STALE_MS = 90_000

function rowToMachine(r: MachineRow): Machine {
  const base = machineInput.parse(JSON.parse(r.payload))
  const stale = !r.last_seen_at || Date.now() - Date.parse(r.last_seen_at) > STALE_MS
  return { ...base, state: stale ? 'offline' : (r.state as Machine['state']), detail: stale ? 'No heartbeat from the bench agent' : r.detail, lastSeenAt: r.last_seen_at, registeredAt: r.registered_at }
}

function rowToJob(r: JobRow, includeContent = false): Job & { file: Job['file'] & { content?: string } } {
  return {
    id: r.id, machineId: r.machine_id, projectId: r.project_id ?? undefined, title: r.title, state: r.state as JobState, progress: r.progress, message: r.message,
    requestedBy: r.requested_by as Job['requestedBy'], file: { name: r.file_name, type: r.file_type as Job['file']['type'], bytes: r.file_content.length, ...(includeContent ? { content: r.file_content } : {}) },
    settings: JSON.parse(r.settings), createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export async function listMachines(): Promise<Machine[]> {
  const r = await database().prepare('SELECT id,payload,state,detail,last_seen_at,registered_at FROM machines ORDER BY registered_at').all<MachineRow>()
  return r.results.map(rowToMachine)
}

export async function getMachine(id: string): Promise<Machine | null> {
  const r = await database().prepare('SELECT id,payload,state,detail,last_seen_at,registered_at FROM machines WHERE id=?').bind(id).first<MachineRow>()
  return r ? rowToMachine(r) : null
}

/** Register or update a machine. Trust is never raised by the agent; it is set by the operator through the workbench. */
export async function upsertMachine(input: MachineInput, opts: { keepTrust?: boolean } = { keepTrust: true }): Promise<Machine> {
  const now = new Date().toISOString()
  const existing = await getMachine(input.id)
  const trusted = opts.keepTrust && existing ? existing.trusted : input.trusted
  const payload = JSON.stringify({ ...input, trusted })
  await database().prepare('INSERT INTO machines (id,name,kind,adapter,payload,state,detail,last_seen_at,registered_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,adapter=excluded.adapter,payload=excluded.payload,last_seen_at=excluded.last_seen_at')
    .bind(input.id, input.name, input.kind, input.adapter, payload, existing?.state ?? 'idle', existing?.detail ?? 'Registered', now, existing?.registeredAt ?? now).run()
  return (await getMachine(input.id))!
}

export async function setMachineTrust(id: string, trusted: boolean): Promise<Machine | null> {
  const existing = await getMachine(id)
  if (!existing) return null
  const base = machineInput.parse({ id: existing.id, name: existing.name, kind: existing.kind, adapter: existing.adapter, location: existing.location, capabilities: existing.capabilities, trusted })
  await database().prepare('UPDATE machines SET payload=? WHERE id=?').bind(JSON.stringify(base), id).run()
  return getMachine(id)
}

export async function setMachineStatus(id: string, state: Machine['state'], detail: string): Promise<boolean> {
  const r = await database().prepare('UPDATE machines SET state=?,detail=?,last_seen_at=? WHERE id=?').bind(state, detail.slice(0, 240), new Date().toISOString(), id).run()
  return (r.meta.changes ?? 0) > 0
}

export async function createJob(input: JobInput, initialState: JobState): Promise<Job> {
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const message = initialState === 'pending_approval' ? 'Waiting for operator approval in the workbench' : 'Queued for the bench agent'
  await database().prepare('INSERT INTO jobs (id,machine_id,project_id,title,state,progress,message,requested_by,file_name,file_type,file_content,settings,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, input.machineId, input.projectId ?? null, input.title, initialState, 0, message, input.requestedBy, input.file.name, input.file.type, input.file.content, JSON.stringify(input.settings), now, now).run()
  return (await getJob(id))!
}

export async function getJob(id: string, includeContent = false) {
  const r = await database().prepare('SELECT * FROM jobs WHERE id=?').bind(id).first<JobRow>()
  return r ? rowToJob(r, includeContent) : null
}

export async function listJobs(filter: { machineId?: string; state?: JobState; limit?: number } = {}): Promise<Job[]> {
  const clauses: string[] = [], binds: unknown[] = []
  if (filter.machineId) { clauses.push('machine_id=?'); binds.push(filter.machineId) }
  if (filter.state) { clauses.push('state=?'); binds.push(filter.state) }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const r = await database().prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`).bind(...binds, Math.min(filter.limit ?? 50, 200)).all<JobRow>()
  return r.results.map(row => rowToJob(row))
}

export async function updateJob(id: string, patch: { state?: JobState; progress?: number; message?: string }, actor: 'agent' | 'operator'): Promise<{ job: Job | null; error?: string }> {
  const job = await getJob(id)
  if (!job) return { job: null, error: 'Job not found' }
  if (patch.state && patch.state !== job.state) {
    if (!jobStates.includes(patch.state) || !canTransition(job.state, patch.state)) return { job, error: `Cannot move a ${job.state} job to ${patch.state}` }
    // Operators approve and cancel; agents run. Neither may skip the approval gate.
    if (actor === 'agent' && job.state === 'pending_approval') return { job, error: 'Job needs operator approval before the agent can take it' }
    if (actor === 'agent' && patch.state === 'queued' && job.state !== 'failed') return { job, error: 'Agents cannot queue jobs' }
  }
  const now = new Date().toISOString()
  await database().prepare('UPDATE jobs SET state=?,progress=?,message=?,updated_at=? WHERE id=?')
    .bind(patch.state ?? job.state, patch.progress ?? (patch.state === 'completed' ? 100 : job.progress), (patch.message ?? job.message).slice(0, 400), now, id).run()
  return { job: await getJob(id) }
}

/** Atomically hand the oldest queued job for a machine to the agent. */
export async function claimNextJob(machineId: string): Promise<(Job & { file: Job['file'] & { content: string } }) | null> {
  const next = await database().prepare("SELECT id FROM jobs WHERE machine_id=? AND state='queued' ORDER BY created_at LIMIT 1").bind(machineId).first<{ id: string }>()
  if (!next) return null
  const now = new Date().toISOString()
  const r = await database().prepare("UPDATE jobs SET state='claimed',message='Claimed by the bench agent',updated_at=? WHERE id=? AND state='queued'").bind(now, next.id).run()
  if (!(r.meta.changes ?? 0)) return null
  return (await getJob(next.id, true)) as Job & { file: Job['file'] & { content: string } }
}

export async function saveDesign(design: DesignRecord): Promise<void> {
  await database().prepare('INSERT INTO designs (id,prompt,summary,payload,created_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
    .bind(design.id, design.prompt, design.summary, JSON.stringify(design), design.createdAt).run()
}

export async function getDesign(id: string): Promise<DesignRecord | null> {
  const r = await database().prepare('SELECT payload FROM designs WHERE id=?').bind(id).first<{ payload: string }>()
  return r ? JSON.parse(r.payload) as DesignRecord : null
}

export async function listDesigns(limit = 20): Promise<Array<{ id: string; prompt: string; summary: string; createdAt: string }>> {
  const r = await database().prepare('SELECT id,prompt,summary,created_at FROM designs ORDER BY created_at DESC LIMIT ?').bind(Math.min(limit, 100)).all<{ id: string; prompt: string; summary: string; created_at: string }>()
  return r.results.map(x => ({ id: x.id, prompt: x.prompt, summary: x.summary, createdAt: x.created_at }))
}
