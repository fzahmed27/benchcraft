'use client'
import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, Box, CheckCircle2, Circle, CircleHelp, Cpu, Loader2, Printer, TriangleAlert, WandSparkles, Zap } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from 'sonner'
import { useMachines } from '@/components/machines'
import type { DesignRecord } from '@/lib/design'
import type { Machine, Job } from '@/lib/machines/schema'

function download(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const examples = [
  'Water my houseplant when the soil gets dry and show the moisture on a screen',
  'Beep and light up when someone walks into the garage at night',
  'Log the temperature of my fermentation bucket every 5 minutes to a web dashboard',
  'A kitchen scale that shows the weight and beeps above 2 kg',
  'Turn a fan on when my 3D printer enclosure gets above 35 °C',
]

export function Designer() {
  const { machines } = useMachines(10000)
  const [prompt, setPrompt] = useState('')
  const [platform, setPlatform] = useState<'' | 'micropython' | 'arduino' | 'python'>('')
  const [portable, setPortable] = useState(false)
  const [inventory, setInventory] = useState('')
  const [busy, setBusy] = useState(false)
  const [design, setDesign] = useState<DesignRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'parts' | 'wiring' | 'program' | 'enclosure' | 'assembly' | 'prototype'>('parts')

  async function run() {
    if (prompt.trim().length < 3) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, preferences: { ...(platform ? { platform } : {}), portable }, inventory: inventory.split(/[\s,]+/).filter(Boolean) }) })
      const data = await r.json() as { design?: DesignRecord; error?: string }
      if (!r.ok || !data.design) throw new Error(data.error ?? 'Design failed')
      setDesign(data.design); setTab('parts')
    } catch (e) { setError(e instanceof Error ? e.message : 'Design failed') } finally { setBusy(false) }
  }

  return <div className="workspace-content">
    <div className="page-heading"><div><div className="eyebrow green">PROMPT TO DEVICE</div><h1>Describe it. Build it.</h1><p>Say what the device should do. Benchcraft picks compatible parts from the partner index, writes the program, and generates an enclosure you can print.</p></div></div>
    <div className="panel designer-form">
      <label className="field-label" htmlFor="design-prompt">What should it do?</label>
      <textarea id="design-prompt" className="prompt-input" maxLength={2000} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="Water my houseplant when the soil gets dry…" />
      <div className="example-row">{examples.map(x => <button key={x} type="button" className="example-chip" onClick={() => setPrompt(x)}>{x}</button>)}</div>
      <div className="designer-options">
        <label>Program style <select value={platform} onChange={e => setPlatform(e.target.value as typeof platform)}><option value="">Let Benchcraft choose</option><option value="micropython">MicroPython (Pico / ESP32)</option><option value="arduino">Arduino C++</option><option value="python">Python on Raspberry Pi</option></select></label>
        <label className="check-inline"><input type="checkbox" checked={portable} onChange={e => setPortable(e.target.checked)} /> Battery powered</label>
        <label>Parts I already have <input value={inventory} onChange={e => setInventory(e.target.value)} placeholder="component ids, e.g. pico2w bme280" /></label>
        <button className="button primary" disabled={busy || prompt.trim().length < 3} onClick={run}>{busy ? <Loader2 className="spin" size={16} /> : <WandSparkles size={16} />} Design it</button>
      </div>
      {error && <p className="error-text"><TriangleAlert size={16} /> {error}</p>}
    </div>

    {design && <DesignView design={design} machines={machines} tab={tab} setTab={setTab} />}
  </div>
}

function DesignView({ design: d, machines, tab, setTab }: { design: DesignRecord; machines: Machine[]; tab: string; setTab: (t: 'parts' | 'wiring' | 'program' | 'enclosure' | 'assembly' | 'prototype') => void }) {
  const printers = machines.filter(m => m.kind === 'fdm_printer')
  const [chosenMachine, setMachineId] = useState('')
  const machineId = chosenMachine || printers[0]?.id || ''
  const [job, setJob] = useState<Job | null>(null)
  const [sending, setSending] = useState(false)
  useEffect(() => {
    if (!job || ['completed', 'failed', 'cancelled'].includes(job.state)) return
    const t = setInterval(async () => { const r = await fetch(`/api/jobs?id=${job.id}`); if (r.ok) setJob((await r.json() as { job: Job }).job) }, 4000)
    return () => clearInterval(t)
  }, [job])

  async function send() {
    const fab = d.fabrication[0]
    if (!fab || !machineId) return
    setSending(true)
    try {
      const r = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ machineId, title: fab.title, file: fab.file, settings: { ...fab.settings, quantity: 1 } }) })
      const data = await r.json() as { job?: Job; error?: string }
      if (!r.ok || !data.job) throw new Error(data.error ?? 'Could not queue the job')
      setJob(data.job)
      toast.success(data.job.state === 'pending_approval' ? 'Queued. Approve it under Machines to start printing.' : 'Sent to the printer.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not queue the job') } finally { setSending(false) }
  }

  const toBuy = d.parts.filter(p => !p.owned)
  return <div className="design-result">
    <div className={`panel design-summary ${d.recognized ? '' : 'design-summary-warn'}`}>
      <div className="design-summary-head">{d.recognized ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}<div><h2>{d.recognized ? 'Recommended design' : 'Needs a change before it can be built'}</h2><p>{d.summary}</p></div></div>
      {d.unsupported.length > 0 && <ul className="design-list warn">{d.unsupported.map(u => <li key={u}>{u}</li>)}</ul>}
      {d.questions.length > 0 && <ul className="design-list">{d.questions.map(q => <li key={q}><CircleHelp size={15} /> {q}</li>)}</ul>}
      <div className="stats-row design-stats">
        <div><span className="stat-icon"><Cpu size={18} /></span><strong>{d.controller.name}</strong><span>{d.controller.platform === 'micropython' ? 'MicroPython' : d.controller.platform === 'arduino' ? 'Arduino C++' : 'Python'} · {d.controller.logicVoltage === '3v3' ? '3.3 V' : '5 V'} logic</span></div>
        <div><span className="stat-icon"><Zap size={18} /></span><strong>${d.cost.partsUsd.toFixed(2)} to buy</strong><span>{toBuy.length} parts{d.cost.ownedUsd > 0 ? ` · $${d.cost.ownedUsd.toFixed(2)} already owned` : ''}</span></div>
        <div><span className="stat-icon"><Box size={18} /></span><strong>{d.enclosure.outerMm.w} × {d.enclosure.outerMm.d} × {d.enclosure.outerMm.h} mm</strong><span>Printed enclosure</span></div>
      </div>
      {(d.assumptions.length > 0 || d.power.warnings.length > 0) && <details className="design-details"><summary>{d.assumptions.length} assumption{d.assumptions.length === 1 ? '' : 's'}{d.power.warnings.length ? ` · ${d.power.warnings.length} warning${d.power.warnings.length === 1 ? '' : 's'}` : ''}</summary><ul className="design-list">{d.power.warnings.map(w => <li key={w} className="warn-item"><TriangleAlert size={14} /> {w}</li>)}{d.assumptions.map(a => <li key={a}>{a}</li>)}</ul></details>}
    </div>

    <div className="tabs-line design-tabs">{(['parts', 'wiring', 'program', 'enclosure', 'assembly', 'prototype'] as const).map(t => <button key={t} className={`tab-button ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'prototype' ? 'Try it' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>

    {tab === 'parts' && <div className="panel design-panel"><div className="panel-heading"><h2>Parts list</h2><span className="tag neutral">{d.cost.note}</span></div>
      <Table><TableHeader><TableRow><TableHead>Qty</TableHead><TableHead>Part</TableHead><TableHead>Why</TableHead><TableHead>Source</TableHead><TableHead>Stock</TableHead><TableHead className="num">Price</TableHead></TableRow></TableHeader>
        <TableBody>{d.parts.map(p => <TableRow key={p.id}><TableCell>{p.qty}</TableCell><TableCell><strong>{p.name}</strong>{p.owned && <span className="tag neutral owned-tag">owned</span>}{Object.keys(p.pins).length > 0 && <div className="pin-list">{Object.entries(p.pins).map(([k, v]) => <span key={k}><code>{v}</code> {k.replace(/_PIN$/, '').toLowerCase()}</span>)}</div>}</TableCell><TableCell className="muted small">{p.role}</TableCell><TableCell><a href={p.source.url} target="_blank" rel="noreferrer">{p.source.partner} {p.source.sku}</a></TableCell><TableCell><span className={`tag stock-${p.stock}`}>{p.stock.replace('-', ' ')}</span></TableCell><TableCell className="num">{p.owned ? '—' : `$${(p.price * p.qty).toFixed(2)}`}<div className="tiny muted">{p.pricing}</div></TableCell></TableRow>)}</TableBody></Table>
      <div className="power-summary"><h3>Power</h3>{d.power.rails.map(r => <div key={r.rail} className="power-line"><span>{r.rail}</span><span>{r.demandMa} mA</span><span className="muted">{r.suppliedBy}</span></div>)}</div>
      <div className="heading-actions"><button className="button secondary" onClick={() => download('parts.csv', 'qty,part,role,partner,sku,url,stock,unit_price_usd,pricing\n' + d.parts.map(p => [p.qty, p.name, p.role, p.source.partner, p.source.sku, p.source.url, p.stock, p.price, p.pricing].map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv')}><ArrowDownToLine size={16} /> Download BOM</button></div>
    </div>}

    {tab === 'wiring' && <div className="panel design-panel"><div className="panel-heading"><h2>Wiring</h2><span className="tag neutral">{d.wiring.length} connections</span></div>
      <Table><TableHeader><TableRow><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Note</TableHead></TableRow></TableHeader><TableBody>{d.wiring.map((w, i) => <TableRow key={i}><TableCell>{w.from}</TableCell><TableCell>{w.to}</TableCell><TableCell className="muted small">{w.note}</TableCell></TableRow>)}</TableBody></Table></div>}

    {tab === 'program' && <div className="panel design-panel"><div className="panel-heading"><h2>{d.firmware.filename}</h2><div className="heading-actions">{d.firmware.libraries.length > 0 && <span className="tag neutral">Libraries: {d.firmware.libraries.join(', ')}</span>}<button className="button secondary" onClick={() => download(d.firmware.filename, d.firmware.code)}><ArrowDownToLine size={16} /> Download</button></div></div>
      <pre className="code-block"><code>{d.firmware.code}</code></pre></div>}

    {tab === 'enclosure' && <div className="panel design-panel"><div className="panel-heading"><h2>Enclosure</h2><div className="heading-actions"><button className="button secondary" onClick={() => download('enclosure.scad', d.enclosure.scad)}><ArrowDownToLine size={16} /> Download OpenSCAD</button></div></div>
      <div className="enclosure-grid"><div><h3>Features</h3><ul className="design-list">{d.enclosure.features.map(f => <li key={f}>{f}</li>)}</ul><p className="muted small">Inside {d.enclosure.innerMm.w} × {d.enclosure.innerMm.d} × {d.enclosure.innerMm.h} mm. Boards sit on 4 mm standoffs. Fit-check the first print; footprints are catalogue estimates.</p></div>
        <div className="fab-box"><h3><Printer size={18} /> Print it</h3>{printers.length === 0 ? <p className="muted small">No printer is registered yet. Run the bench agent next to your printer (see Machines), or download the OpenSCAD file and slice it yourself.</p> : <>
          <label>Printer <select value={machineId} onChange={e => setMachineId(e.target.value)}>{printers.map(m => <option key={m.id} value={m.id}>{m.name} · {m.state}{m.trusted ? '' : ' · needs approval'}</option>)}</select></label>
          <button className="button primary" disabled={sending || !machineId} onClick={send}>{sending ? <Loader2 className="spin" size={16} /> : <Printer size={16} />} Send enclosure to printer</button>
          {job && <div className={`job-status job-${job.state}`}><strong>{job.state.replace('_', ' ')}</strong> · {job.progress}% · {job.message}</div>}
          <p className="tiny muted">Jobs on untrusted machines wait for your approval under Machines. The bench agent converts OpenSCAD to G-code when OpenSCAD and a slicer are installed next to it.</p></>}</div></div>
      <pre className="code-block small-code"><code>{d.enclosure.scad}</code></pre></div>}

    {tab === 'assembly' && <div className="panel design-panel"><div className="panel-heading"><h2>Assembly</h2></div><ol className="assembly-steps">{d.assembly.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <h3>Done when</h3>{d.checklist.map(c => <div key={c.title} className="check-row">{c.ok === true ? <CheckCircle2 size={18} className="ok" /> : c.ok === false ? <TriangleAlert size={18} className="warn" /> : <Circle size={18} className="muted" />}<div><strong>{c.title}</strong><div className="muted small">{c.detail}</div></div></div>)}</div>}

    {tab === 'prototype' && <Prototype key={d.id} design={d} />}
  </div>
}

function Prototype({ design: d }: { design: DesignRecord }) {
  const [values, setValues] = useState<Record<string, number>>(() => Object.fromEntries(d.simulation.inputs.map(i => [i.capability, i.initial])))
  const active = useMemo(() => {
    const t = d.simulation.trigger
    if (!t) return d.simulation.outputs.length > 0 && d.simulation.inputs.length === 0
    const v = values[t.capability]
    if (v === undefined) return false
    if (t.capability === 'sense:button' || t.capability === 'sense:motion') return v >= 1
    return t.below ? v < t.threshold : v > t.threshold
  }, [values, d])
  return <div className="panel design-panel"><div className="panel-heading"><h2>Try the prototype</h2><span className="tag neutral">Simulated</span></div>
    <p className="muted small">{d.simulation.note}</p>
    <div className="proto-grid">
      <div><h3>Inputs</h3>{d.simulation.inputs.length === 0 && <p className="muted small">This design has no sensors; the actuators run on a timer.</p>}{d.simulation.inputs.map(i => <label key={i.capability} className="proto-input"><span>{i.label} <strong>{values[i.capability]} {i.unit}</strong></span><input type="range" min={i.min} max={i.max} step={i.max - i.min > 100 ? 1 : 0.5} value={values[i.capability]} onChange={e => setValues(v => ({ ...v, [i.capability]: Number(e.target.value) }))} /></label>)}</div>
      <div><h3>Device response</h3>{d.simulation.trigger && <p className="muted small">Rule: {d.simulation.trigger.capability.split(':')[1].replace('-', ' ')} {d.simulation.trigger.capability === 'sense:button' || d.simulation.trigger.capability === 'sense:motion' ? 'detected' : `${d.simulation.trigger.below ? 'below' : 'above'} ${d.simulation.trigger.threshold} ${d.simulation.trigger.unit}`}</p>}
        {d.simulation.outputs.length === 0 && <p className="muted small">Readings are logged{d.needs.includes('connect:wifi') ? ' and reported over Wi-Fi' : ' over USB'}.</p>}
        {d.simulation.outputs.map(o => <div key={o.capability} className={`proto-output ${active || o.capability.startsWith('display') ? 'on' : ''}`}><span className="proto-dot" /> {o.label} {o.capability.startsWith('display') ? <em>{Object.entries(values).map(([k, v]) => `${k.split(':')[1]}=${v}`).join(' ') || 'running'}</em> : <em>{active ? 'ON' : 'off'}</em>}</div>)}</div>
    </div></div>
}
