#!/usr/bin/env node
/**
 * Benchcraft bench agent.
 *
 * Runs on a computer on the same network as your 3D printer or CNC (a Raspberry Pi is ideal),
 * registers each machine with the Benchcraft server, sends heartbeats, claims fabrication jobs,
 * converts OpenSCAD → STL → G-code when OpenSCAD and a slicer are installed, and drives the
 * machine through its local API. No npm dependencies; Node 22+.
 *
 * Usage:
 *   BENCH_AGENT_TOKEN=... node scripts/bench-agent.mjs bench-agent.json
 *   node scripts/bench-agent.mjs --example   # print an example config
 *   node scripts/bench-agent.mjs --discover  # find printers on the LAN and print machine entries
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bambu, bambuDiscover } from './bench-agent-bambu.mjs'

const EXAMPLE = {
  server: 'https://your-benchcraft-site.example',
  pollSeconds: 15,
  tools: {
    openscad: 'openscad',
    slicer: 'prusa-slicer',
    // {in} and {out} are replaced with the STL and the output path. PrusaSlicer shown; for a Bambu printer use
    // OrcaSlicer: ['--load-settings', 'machine.json;process.json', '--load-filaments', 'filament.json', '--slice', '0', '--export-3mf', '{out}', '{in}'] with slicerOutput '3mf'.
    slicerArgs: ['--export-gcode', '--load', '/home/pi/printer-profile.ini', '-o', '{out}', '{in}'],
    slicerOutput: 'gcode',
  },
  machines: [
    { id: 'sim-printer', name: 'Simulated printer', kind: 'fdm_printer', adapter: 'simulated', location: 'nowhere', capabilities: { buildVolumeMm: { x: 180, y: 180, z: 180 }, materials: ['PLA'], accepts: ['scad', 'stl', 'gcode'] } },
    { id: 'prusa-mini', name: 'Prusa MINI+', kind: 'fdm_printer', adapter: 'prusalink', url: 'http://192.168.1.50', apiKey: 'PRUSALINK_API_KEY', location: 'workshop shelf', capabilities: { buildVolumeMm: { x: 180, y: 180, z: 180 }, materials: ['PLA', 'PETG'], nozzleMm: 0.4 } },
    { id: 'voron', name: 'Voron 2.4', kind: 'fdm_printer', adapter: 'moonraker', url: 'http://voron.local', capabilities: { buildVolumeMm: { x: 350, y: 350, z: 340 }, materials: ['ABS', 'PLA'] } },
    { id: 'ender', name: 'Ender 3 + OctoPrint', kind: 'fdm_printer', adapter: 'octoprint', url: 'http://octopi.local', apiKey: 'OCTOPRINT_API_KEY', capabilities: { buildVolumeMm: { x: 220, y: 220, z: 250 }, materials: ['PLA'] } },
    { id: 'a1mini', name: 'Bambu Lab A1 mini', kind: 'fdm_printer', adapter: 'bambu', url: '192.168.1.60', serial: '0309CA4B0300123', accessCode: '12345678', location: 'desk', capabilities: { buildVolumeMm: { x: 180, y: 180, z: 180 }, materials: ['PLA', 'PETG'], nozzleMm: 0.4 } },
    { id: 'cnc', name: 'Desktop CNC (GRBL)', kind: 'cnc_router', adapter: 'grbl', port: '/dev/ttyUSB0', baud: 115200, capabilities: { buildVolumeMm: { x: 300, y: 180, z: 45 }, materials: ['plywood', 'acrylic'], accepts: ['gcode'] } },
  ],
}

const args = process.argv.slice(2)
if (args.includes('--example')) { console.log(JSON.stringify(EXAMPLE, null, 2)); process.exit(0) }
if (args.includes('--discover')) { await discover(); process.exit(0) }

/**
 * Find printers on the local network without any configuration: probes every host on the
 * machine's /24 subnets for OctoPrint, Moonraker, PrusaLink and Bambu (LAN mode) signatures
 * and prints ready-to-paste machine entries.
 */
async function discover() {
  const { networkInterfaces } = await import('node:os')
  const net = await import('node:net')
  const subnets = new Set()
  for (const list of Object.values(networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) subnets.add(i.address.split('.').slice(0, 3).join('.'))
  const hosts = [...subnets].flatMap(s => Array.from({ length: 254 }, (_, k) => `${s}.${k + 1}`))
  const ports = [80, 5000, 7125, 8883]
  const probe = (host, port) => new Promise(r => { const s = net.connect({ host, port }); const t = setTimeout(() => { s.destroy(); r(false) }, 600); s.on('connect', () => { clearTimeout(t); s.destroy(); r(true) }); s.on('error', () => { clearTimeout(t); r(false) }) })
  console.error(`Listening for Bambu Lab printers (SSDP) and probing ${hosts.length} hosts on ${[...subnets].join(', ')} …`)
  const ssdp = bambuDiscover(4000)
  const open = []
  let i = 0
  await Promise.all(Array.from({ length: 200 }, async () => { while (i < hosts.length) { const h = hosts[i++]; for (const p of ports) if (await probe(h, p)) open.push([h, p]) } }))
  const found = []
  for (const b of await ssdp) found.push({ id: `bambu-${b.serial.toLowerCase()}`, name: `${b.name}${b.model ? ` (${b.model})` : ''}`, kind: 'fdm_printer', adapter: 'bambu', url: b.ip, serial: b.serial, accessCode: 'PASTE_LAN_ACCESS_CODE_FROM_PRINTER_SCREEN' })
  const get = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); return { status: r.status, text: (await r.text()).slice(0, 4000), headers: r.headers } } catch { return null } }
  for (const [h, p] of open) {
    const base = `http://${h}:${p}`
    if (p === 8883) { if (!found.some(f => f.adapter === 'bambu' && f.url === h)) found.push({ id: `bambu-${h.replace(/\./g, '-')}`, name: `Bambu Lab printer at ${h}`, kind: 'fdm_printer', adapter: 'bambu', url: h, serial: 'PASTE_SERIAL_FROM_PRINTER_SCREEN', accessCode: 'PASTE_LAN_ACCESS_CODE_FROM_PRINTER_SCREEN' }); continue }
    let r = await get(`${base}/api/version`)
    if (r && r.status === 200 && /octoprint/i.test(r.text)) { found.push({ id: `octoprint-${h.replace(/\./g, '-')}`, name: `OctoPrint at ${h}`, kind: 'fdm_printer', adapter: 'octoprint', url: base, apiKey: 'PASTE_OCTOPRINT_API_KEY' }); continue }
    if (r && r.status === 401 && /prusa/i.test(r.headers.get('www-authenticate') ?? '')) { found.push({ id: `prusa-${h.replace(/\./g, '-')}`, name: `PrusaLink at ${h}`, kind: 'fdm_printer', adapter: 'prusalink', url: base, apiKey: 'PASTE_PRUSALINK_API_KEY' }); continue }
    r = await get(`${base}/server/info`)
    if (r && r.status === 200 && /klippy|moonraker/i.test(r.text)) { found.push({ id: `moonraker-${h.replace(/\./g, '-')}`, name: `Klipper printer at ${h}`, kind: 'fdm_printer', adapter: 'moonraker', url: base }); continue }
    r = await get(`${base}/api/v1/status`)
    const prusaJson = (() => { try { return r && r.status === 200 && 'printer' in JSON.parse(r.text) } catch { return false } })()
    if (r && (r.status === 401 || prusaJson)) { found.push({ id: `prusa-${h.replace(/\./g, '-')}`, name: `PrusaLink at ${h}`, kind: 'fdm_printer', adapter: 'prusalink', url: base, apiKey: 'PASTE_PRUSALINK_API_KEY' }); continue }
  }
  if (!found.length) { console.error('No printers found. Check the printer is on the same Wi-Fi and its local API is enabled (PrusaLink, OctoPrint, Moonraker, or Bambu LAN-only mode with the access code shown on the printer).'); return }
  console.error(`Found ${found.length} machine(s). Paste into the "machines" array of bench-agent.json:`)
  console.log(JSON.stringify(found, null, 2))
}
const configPath = args.find(a => !a.startsWith('--')) ?? 'bench-agent.json'
const config = JSON.parse(await readFile(configPath, 'utf8'))
const token = process.env.BENCH_AGENT_TOKEN ?? config.token
if (!token) { console.error('Set BENCH_AGENT_TOKEN (or "token" in the config).'); process.exit(2) }
const server = String(config.server).replace(/\/$/, '')
const pollMs = Math.max(5, Number(config.pollSeconds ?? 15)) * 1000
const workDir = join(tmpdir(), 'benchcraft-agent')
await mkdir(workDir, { recursive: true })

const log = (...a) => console.log(new Date().toISOString(), ...a)

async function api(path, init = {}) {
  const r = await fetch(server + path, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  const text = await r.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { raw: text } }
  if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status} ${body?.error ?? text.slice(0, 200)}`)
  return body
}

async function run(cmd, cmdArgs, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', d => { out += d })
    child.stderr.on('data', d => { err += d })
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)) }, timeoutMs)
    child.on('error', e => { clearTimeout(timer); reject(e) })
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`)) })
  })
}

async function toolAvailable(cmd) {
  if (!cmd) return false
  try { await run(cmd, ['--version'], { timeoutMs: 20000 }); return true } catch { return false }
}

const haveOpenscad = await toolAvailable(config.tools?.openscad)
const haveSlicer = await toolAvailable(config.tools?.slicer)
log(`OpenSCAD ${haveOpenscad ? 'available' : 'not found'}; slicer ${haveSlicer ? 'available' : 'not found'}`)

// ───────────────────────── Adapters ─────────────────────────

function octoprint(m) {
  const h = { 'X-Api-Key': m.apiKey }
  return {
    async status() {
      const r = await fetch(`${m.url}/api/printer?exclude=sd,temperature`, { headers: h })
      if (r.status === 409) return { state: 'error', detail: 'Printer not connected to OctoPrint' }
      const j = await r.json()
      const f = j.state?.flags ?? {}
      return { state: f.printing ? 'busy' : f.paused ? 'paused' : f.error ? 'error' : f.operational ? 'idle' : 'offline', detail: j.state?.text ?? '' }
    },
    async start(file) {
      const form = new FormData()
      form.set('file', new Blob([file.content]), file.name)
      form.set('print', 'true')
      const r = await fetch(`${m.url}/api/files/local`, { method: 'POST', headers: h, body: form })
      if (!r.ok) throw new Error(`OctoPrint upload failed: ${r.status}`)
    },
    async progress() {
      const j = await (await fetch(`${m.url}/api/job`, { headers: h })).json()
      const s = j.state ?? ''
      return { progress: Math.round(j.progress?.completion ?? 0), done: s === 'Operational' && (j.progress?.completion ?? 0) >= 100, failed: /error|cancel/i.test(s), detail: s }
    },
    async cancel() { await fetch(`${m.url}/api/job`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ command: 'cancel' }) }) },
    accepts: ['gcode'],
  }
}

function moonraker(m) {
  return {
    async status() {
      const j = await (await fetch(`${m.url}/printer/objects/query?print_stats&webhooks`)).json()
      const st = j.result?.status ?? {}
      const s = st.print_stats?.state ?? 'standby'
      const klippy = st.webhooks?.state
      if (klippy && klippy !== 'ready') return { state: 'error', detail: `Klipper ${klippy}` }
      return { state: s === 'printing' ? 'busy' : s === 'paused' ? 'paused' : s === 'error' ? 'error' : 'idle', detail: s }
    },
    async start(file) {
      const form = new FormData()
      form.set('file', new Blob([file.content]), file.name)
      form.set('print', 'true')
      const r = await fetch(`${m.url}/server/files/upload`, { method: 'POST', body: form })
      if (!r.ok) throw new Error(`Moonraker upload failed: ${r.status}`)
    },
    async progress() {
      const j = await (await fetch(`${m.url}/printer/objects/query?print_stats&virtual_sdcard`)).json()
      const st = j.result?.status ?? {}
      const s = st.print_stats?.state
      return { progress: Math.round((st.virtual_sdcard?.progress ?? 0) * 100), done: s === 'complete', failed: s === 'error' || s === 'cancelled', detail: s ?? '' }
    },
    async cancel() { await fetch(`${m.url}/printer/print/cancel`, { method: 'POST' }) },
    accepts: ['gcode'],
  }
}

function prusalink(m) {
  const h = { 'X-Api-Key': m.apiKey }
  return {
    async status() {
      const r = await fetch(`${m.url}/api/v1/status`, { headers: h })
      if (!r.ok) return { state: 'offline', detail: `HTTP ${r.status}` }
      const j = await r.json()
      const s = (j.printer?.state ?? '').toUpperCase()
      return { state: s === 'PRINTING' ? 'busy' : s === 'PAUSED' ? 'paused' : /ERROR|ATTENTION/.test(s) ? 'error' : /IDLE|READY|FINISHED|STOPPED/.test(s) ? 'idle' : 'busy', detail: s }
    },
    async start(file) {
      const r = await fetch(`${m.url}/api/v1/files/usb/${encodeURIComponent(file.name)}`, { method: 'PUT', headers: { ...h, 'content-type': 'application/octet-stream', 'Overwrite': '?1', 'Print-After-Upload': '?1' }, body: file.content })
      if (!r.ok && r.status !== 201) throw new Error(`PrusaLink upload failed: ${r.status}`)
    },
    async progress() {
      const j = await (await fetch(`${m.url}/api/v1/status`, { headers: h })).json()
      const s = (j.printer?.state ?? '').toUpperCase()
      return { progress: Math.round(j.job?.progress ?? 0), done: s === 'FINISHED' || (s === 'IDLE' && (j.job?.progress ?? 0) >= 100), failed: /ERROR|STOPPED/.test(s), detail: s }
    },
    async cancel() { const j = await (await fetch(`${m.url}/api/v1/status`, { headers: h })).json(); if (j.job?.id) await fetch(`${m.url}/api/v1/job/${j.job.id}`, { method: 'DELETE', headers: h }) },
    accepts: ['gcode', 'bgcode'],
  }
}

function grbl(m) {
  let port = null, buffer = '', lines = [], sent = 0, total = 0, failed = false, running = false
  async function open() {
    if (port) return port
    let SerialPort
    try { ({ SerialPort } = await import('serialport')) } catch { throw new Error('GRBL adapter needs the optional "serialport" package: npm i serialport') }
    port = new SerialPort({ path: m.port, baudRate: m.baud ?? 115200 })
    port.on('data', d => { buffer += d.toString(); let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1); onLine(line) } })
    await new Promise(r => setTimeout(r, 2000))
    return port
  }
  let lastStatus = { state: 'idle', detail: 'Idle' }
  function onLine(line) {
    if (line.startsWith('<')) { const st = line.slice(1).split(/[|,]/)[0]; lastStatus = { state: /Run|Jog|Home/.test(st) ? 'busy' : /Hold/.test(st) ? 'paused' : /Alarm/.test(st) ? 'error' : 'idle', detail: st } }
    else if (line === 'ok') sendNext()
    else if (line.startsWith('error') || line.startsWith('ALARM')) { failed = true; running = false; lastStatus = { state: 'error', detail: line } }
  }
  function sendNext() { if (!running) return; if (sent >= total) { running = false; return } port.write(lines[sent++] + '\n') }
  return {
    async status() { try { const p = await open(); p.write('?'); await new Promise(r => setTimeout(r, 300)); return lastStatus } catch (e) { return { state: 'offline', detail: e.message } } },
    async start(file) { await open(); lines = file.content.split('\n').map(l => l.replace(/\(.*?\)|;.*$/g, '').trim()).filter(Boolean); sent = 0; total = lines.length; failed = false; running = true; sendNext() },
    async progress() { return { progress: total ? Math.round(sent / total * 100) : 0, done: !running && sent >= total && !failed, failed, detail: lastStatus.detail } },
    async cancel() { running = false; port?.write('!'); port?.write('\x18') },
    accepts: ['gcode'],
  }
}

function simulated(m) {
  let job = null
  const seconds = m.simulateSeconds ?? 30
  return {
    async status() { return job ? { state: 'busy', detail: `Simulating ${job.name}` } : { state: 'idle', detail: 'Simulated machine ready' } },
    async start(file) { job = { name: file.name, startedAt: Date.now() } },
    async progress() { if (!job) return { progress: 0, done: false, failed: false, detail: 'idle' }; const p = Math.min(100, Math.round((Date.now() - job.startedAt) / (seconds * 1000) * 100)); if (p >= 100) { const n = job.name; job = null; return { progress: 100, done: true, failed: false, detail: `Finished ${n}` } } return { progress: p, done: false, failed: false, detail: `Simulating ${job.name}` } },
    async cancel() { job = null },
    accepts: ['gcode', 'stl', 'scad', '3mf', 'svg', 'dxf'],
  }
}

const factories = { octoprint, moonraker, prusalink, grbl, simulated, bambu }

// ───────────────────────── File preparation ─────────────────────────

async function prepare(job, machine) {
  let { name, type, content } = job.file
  const base = name.replace(/\.[^.]+$/, '')
  if (type === 'scad' && !machine.accepts.includes('scad')) {
    if (!haveOpenscad) throw new Error('Job is OpenSCAD but OpenSCAD is not installed on the agent. Install it or download the STL manually.')
    const scadPath = join(workDir, `${job.id}.scad`), stlPath = join(workDir, `${job.id}.stl`)
    await writeFile(scadPath, content)
    await run(config.tools.openscad, ['-o', stlPath, scadPath])
    name = `${base}.stl`; type = 'stl'; content = await readFile(stlPath)
  }
  if (type === 'stl' && !machine.accepts.includes('stl')) {
    if (!haveSlicer) throw new Error('Job needs slicing but no slicer is installed on the agent. Install PrusaSlicer or CuraEngine and set tools.slicer.')
    const outType = config.tools.slicerOutput === '3mf' ? '3mf' : 'gcode'
    const stlPath = join(workDir, `${job.id}.stl`), outPath = join(workDir, `${job.id}.${outType}`)
    if (!(await stat(stlPath).catch(() => null))) await writeFile(stlPath, content)
    const extra = []
    const prusaStyle = !(config.tools.slicerArgs ?? []).some(a => /orca|bambu|--export-3mf/.test(String(a)))
    if (prusaStyle && job.settings?.layerHeightMm) extra.push('--layer-height', String(job.settings.layerHeightMm))
    if (prusaStyle && job.settings?.infillPercent !== undefined) extra.push('--fill-density', `${job.settings.infillPercent}%`)
    if (prusaStyle && job.settings?.supports) extra.push('--support-material')
    const template = config.tools.slicerArgs ?? ['--export-gcode', '-o', '{out}', '{in}']
    const slicerArgs = template.map(a => String(a).replace('{out}', outPath).replace('{in}', stlPath))
    await run(config.tools.slicer, [...extra, ...slicerArgs])
    name = `${base}.${outType}`; type = outType; content = await readFile(outPath)
  }
  if (!machine.accepts.includes(type)) throw new Error(`${machine.name} cannot take a ${type} file`)
  return { name, type, content }
}

// ───────────────────────── Main loop ─────────────────────────

const machines = (config.machines ?? []).map(m => {
  const make = factories[m.adapter]
  if (!make) { log(`Skipping ${m.id}: unknown adapter ${m.adapter}`); return null }
  const driver = make(m)
  return { ...m, driver, accepts: [...new Set([...(m.capabilities?.accepts ?? []), ...driver.accepts])], current: null }
}).filter(Boolean)

async function register() {
  for (const m of machines) {
    const body = { id: m.id, name: m.name, kind: m.kind, adapter: m.adapter, location: m.location ?? '', capabilities: { ...(m.capabilities ?? {}), accepts: m.accepts, canRenderScad: haveOpenscad, canSlice: haveSlicer }, trusted: false }
    try { await api('/api/machines', { method: 'POST', body: JSON.stringify(body) }); log(`registered ${m.id}`) } catch (e) { log(`register ${m.id} failed: ${e.message}`) }
  }
}

async function reportJob(id, patch) {
  try { await api('/api/jobs', { method: 'PATCH', body: JSON.stringify({ id, ...patch }) }) } catch (e) { log(`job ${id} update failed: ${e.message}`) }
}

async function tick(m) {
  let status
  try { status = await m.driver.status() } catch (e) { status = { state: 'offline', detail: e.message } }
  await api('/api/machines', { method: 'PATCH', body: JSON.stringify({ id: m.id, status: { state: status.state, detail: String(status.detail ?? '').slice(0, 240) } }) }).catch(e => log(`heartbeat ${m.id} failed: ${e.message}`))

  if (m.current) {
    let p
    try { p = await m.driver.progress() } catch (e) { p = { progress: m.current.progress, done: false, failed: false, detail: e.message } }
    if (p.done) { await reportJob(m.current.id, { state: 'completed', progress: 100, message: p.detail || 'Finished' }); log(`${m.id}: job ${m.current.id} completed`); m.current = null }
    else if (p.failed) { await reportJob(m.current.id, { state: 'failed', message: p.detail || 'Machine reported a failure' }); log(`${m.id}: job ${m.current.id} failed`); m.current = null }
    else if (p.progress !== m.current.progress) { m.current.progress = p.progress; await reportJob(m.current.id, { progress: p.progress, message: p.detail || 'Running' }) }
    // Operator cancel from the workbench
    try { const { job } = await api(`/api/jobs?id=${m.current?.id}`); if (job && job.state === 'cancelled' && m.current) { await m.driver.cancel(); log(`${m.id}: cancelled ${job.id}`); m.current = null } } catch { /* ignore */ }
    return
  }
  if (status.state !== 'idle') return
  const { job } = await api('/api/jobs/claim', { method: 'POST', body: JSON.stringify({ machineId: m.id }) })
  if (!job) return
  log(`${m.id}: claimed ${job.id} (${job.title})`)
  await reportJob(job.id, { state: 'preparing', message: 'Converting and uploading' })
  try {
    const file = await prepare(job, m)
    await m.driver.start(file)
    m.current = { id: job.id, progress: 0 }
    await reportJob(job.id, { state: 'running', progress: 0, message: `Started on ${m.name}` })
  } catch (e) {
    log(`${m.id}: job ${job.id} failed: ${e.message}`)
    await reportJob(job.id, { state: 'failed', message: e.message.slice(0, 400) })
  }
}

await register()
log(`bench agent watching ${machines.length} machine(s) every ${pollMs / 1000}s → ${server}`)
for (;;) {
  for (const m of machines) { try { await tick(m) } catch (e) { log(`${m.id}: ${e.message}`) } }
  await new Promise(r => setTimeout(r, pollMs))
}
