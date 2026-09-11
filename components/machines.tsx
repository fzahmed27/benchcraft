'use client'
import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Printer, ShieldCheck, Terminal, TriangleAlert, Unplug, X } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import type { Machine, Job, AdapterId } from '@/lib/machines/schema'

type Adapters = Record<AdapterId, { name: string; kinds: string[]; transport: string; accepts: string[]; notes: string }>

export function useMachines(pollMs = 5000) {
  const [machines, setMachines] = useState<Machine[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [adapters, setAdapters] = useState<Adapters | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    try {
      const [m, j] = await Promise.all([fetch('/api/machines'), fetch('/api/jobs')])
      const md = await m.json() as { machines: Machine[]; adapters: Adapters; error?: string }
      const jd = await j.json() as { jobs?: Job[] }
      setMachines(md.machines ?? []); setAdapters(md.adapters ?? null); setJobs(jd.jobs ?? []); setError(md.error ?? null)
    } catch { setError('Machine status is unavailable') }
  }, [])
  useEffect(() => { const first = setTimeout(() => { void refresh() }, 0); const t = setInterval(() => { void refresh() }, pollMs); return () => { clearTimeout(first); clearInterval(t) } }, [refresh, pollMs])
  return { machines, jobs, adapters, error, refresh }
}

export function MachinesPanel({ tokens }: { tokens: { agent: boolean; api: boolean } }) {
  const { machines, jobs, adapters, error, refresh } = useMachines()
  const [busy, setBusy] = useState<string | null>(null)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  async function patchJob(id: string, state: 'queued' | 'cancelled') {
    setBusy(id)
    try {
      const r = await fetch('/api/jobs', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, state, message: state === 'queued' ? 'Approved by the operator' : 'Cancelled by the operator' }) })
      const d = await r.json() as { error?: string }
      if (!r.ok) throw new Error(d.error ?? 'Update failed')
      toast.success(state === 'queued' ? 'Approved. The bench agent will start it.' : 'Cancelled.')
      await refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed') } finally { setBusy(null) }
  }
  async function setTrust(id: string, trusted: boolean) {
    setBusy(id)
    try {
      const r = await fetch('/api/machines', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, trusted }) })
      if (!r.ok) throw new Error((await r.json() as { error?: string }).error ?? 'Update failed')
      toast.success(trusted ? 'Jobs on this machine now start without approval.' : 'Jobs on this machine now need approval.')
      await refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Update failed') } finally { setBusy(null) }
  }

  const pending = jobs.filter(j => j.state === 'pending_approval')
  return <div className="workspace-content">
    <div className="page-heading"><div><div className="eyebrow green">FABRICATION</div><h1>Machines</h1><p>3D printers and CNC machines connected through the bench agent, and the jobs waiting for them.</p></div>{pending.length > 0 && <span className="tag">{pending.length} awaiting approval</span>}</div>
    {error && <div className="note-strip"><TriangleAlert size={19} /><p>{error}</p></div>}

    {machines.length === 0 ? <div className="empty-card panel"><Unplug size={36} /><h2>No machines yet</h2><p>Run the bench agent on a computer next to your printer or CNC. It registers the machine here and relays jobs.</p></div>
      : <div className="connection-grid">{machines.map(m => <div key={m.id} className="panel connection-card machine-card"><div className="machine-head"><Printer size={24} /><span className={`tag state-${m.state}`}>{m.state}</span></div><h2>{m.name}</h2><p className="muted small">{m.kind.replace('_', ' ')} · {adapters?.[m.adapter]?.name ?? m.adapter}{m.location ? ` · ${m.location}` : ''}</p><p className="small">{m.detail}</p>
        {m.capabilities.buildVolumeMm && <p className="tiny muted">Build volume {m.capabilities.buildVolumeMm.x} × {m.capabilities.buildVolumeMm.y} × {m.capabilities.buildVolumeMm.z} mm{m.capabilities.materials.length ? ` · ${m.capabilities.materials.join(', ')}` : ''}</p>}
        <p className="tiny muted">Accepts {[...new Set([...(adapters?.[m.adapter]?.accepts ?? []), ...m.capabilities.accepts])].join(', ')}{m.capabilities.canRenderScad ? ' · renders OpenSCAD' : ''}{m.capabilities.canSlice ? ' · slices STL' : ''}</p>
        <label className="check-inline trust-toggle"><input type="checkbox" checked={m.trusted} disabled={busy === m.id} onChange={e => setTrust(m.id, e.target.checked)} /> <ShieldCheck size={15} /> Start jobs without approval</label></div>)}</div>}

    <div className="panel full-panel jobs-panel"><div className="panel-heading"><h2>Fabrication jobs</h2><span className="tag neutral">{jobs.length} recent</span></div>
      {jobs.length === 0 ? <p className="muted small jobs-empty">Nothing queued. Design a device and send its enclosure to a printer, or let an agent call submit_fabrication_job.</p>
        : <Table><TableHeader><TableRow><TableHead>Job</TableHead><TableHead>Machine</TableHead><TableHead>State</TableHead><TableHead>Progress</TableHead><TableHead>From</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>{jobs.map(j => <TableRow key={j.id}><TableCell><strong>{j.title}</strong><div className="tiny muted">{j.file.name} · {(j.file.bytes / 1024).toFixed(1)} kB · {new Date(j.createdAt).toLocaleString()}</div></TableCell><TableCell>{machines.find(m => m.id === j.machineId)?.name ?? j.machineId}</TableCell><TableCell><span className={`tag job-${j.state}`}>{j.state.replace('_', ' ')}</span><div className="tiny muted">{j.message}</div></TableCell><TableCell>{j.progress}%</TableCell><TableCell className="muted small">{j.requestedBy === 'mcp' ? 'Agent (MCP)' : j.requestedBy === 'api' ? 'API' : 'Workbench'}</TableCell>
            <TableCell className="job-actions">{j.state === 'pending_approval' && <button className="button primary small-button" disabled={busy === j.id} onClick={() => patchJob(j.id, 'queued')}>{busy === j.id ? <Loader2 className="spin" size={14} /> : <Check size={14} />} Approve</button>}{['pending_approval', 'queued', 'claimed', 'preparing', 'running', 'paused'].includes(j.state) && <button className="button secondary small-button" disabled={busy === j.id} onClick={() => patchJob(j.id, 'cancelled')}><X size={14} /> Cancel</button>}</TableCell></TableRow>)}</TableBody></Table>}
    </div>

    <div className="connection-grid setup-grid">
      <div className="panel connection-card"><Terminal size={24} /><h2>Connect a machine</h2><p className="small">On a computer beside the printer (a Raspberry Pi works well):</p>
        <pre className="code-block small-code">{`node scripts/bench-agent.mjs --example > bench-agent.json
# edit server, machines, and API keys, then:
BENCH_AGENT_TOKEN=… node scripts/bench-agent.mjs bench-agent.json`}</pre>
        <p className="tiny muted">Adapters: {adapters ? Object.values(adapters).map(a => a.name).join(', ') : '…'}. Install OpenSCAD and PrusaSlicer on that computer so designs go straight from OpenSCAD to G-code.</p>
        <p className={`tiny ${tokens.agent ? 'ok-text' : 'warn-text'}`}>{tokens.agent ? 'Agent token is configured.' : 'Set the BENCH_AGENT_TOKEN secret on the site before the agent can register machines.'}</p></div>
      <div className="panel connection-card"><ShieldCheck size={24} /><h2>Connect an agent</h2><p className="small">Any Model Context Protocol client can use the catalogue, the planner, and the machines:</p>
        <pre className="code-block small-code">{`claude mcp add --transport http benchcraft \\
  ${origin}/api/mcp \\
  --header "Authorization: Bearer <BENCH_API_TOKEN>"`}</pre>
        <p className="tiny muted">Read-only tools work without a token. Fabrication tools need the token, and jobs still wait for your approval unless the machine is trusted.</p>
        <p className={`tiny ${tokens.api ? 'ok-text' : 'warn-text'}`}>{tokens.api ? 'API token is configured.' : 'Set the BENCH_API_TOKEN secret to let outside agents queue jobs.'}</p></div>
    </div>
  </div>
}
