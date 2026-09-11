/**
 * Bambu Lab LAN-mode adapter for the Benchcraft bench agent (A1 mini, A1, P1, X1).
 *
 * Protocol, as used by Bambu Studio in LAN-only mode:
 *  - MQTT 3.1.1 over TLS on port 8883, user "bblp", password = the printer's LAN access code,
 *    self-signed certificate. Reports arrive on device/<SERIAL>/report; commands go to
 *    device/<SERIAL>/request.
 *  - Implicit FTPS on port 990, same credentials, files land in the printer's root (SD card).
 *  - Printers announce themselves over SSDP on UDP port 2021 (used by discovery).
 *
 * Both clients are implemented here directly so the agent stays dependency-free.
 */
import tls from 'node:tls'
import dgram from 'node:dgram'

// ───────────────────────── Minimal MQTT 3.1.1 client ─────────────────────────

function encodeLength(n) { const b = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 0x80; b.push(d) } while (n > 0); return Buffer.from(b) }
function str(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 0xff]), b]) }

export function mqttConnectPacket({ clientId, username, password, keepAlive = 30 }) {
  const flags = 0xc2 // username, password, clean session
  const body = Buffer.concat([str('MQTT'), Buffer.from([4, flags, keepAlive >> 8, keepAlive & 0xff]), str(clientId), str(username), str(password)])
  return Buffer.concat([Buffer.from([0x10]), encodeLength(body.length), body])
}
export function mqttSubscribePacket(id, topic) {
  const body = Buffer.concat([Buffer.from([id >> 8, id & 0xff]), str(topic), Buffer.from([0])])
  return Buffer.concat([Buffer.from([0x82]), encodeLength(body.length), body])
}
export function mqttPublishPacket(topic, payload) {
  const body = Buffer.concat([str(topic), Buffer.from(payload, 'utf8')])
  return Buffer.concat([Buffer.from([0x30]), encodeLength(body.length), body])
}
const PINGREQ = Buffer.from([0xc0, 0]), DISCONNECT = Buffer.from([0xe0, 0])

/** Incremental packet parser. Feed bytes, get { type, topic?, payload? } packets. */
export class MqttParser {
  constructor() { this.buf = Buffer.alloc(0) }
  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    const out = []
    for (;;) {
      if (this.buf.length < 2) break
      let mult = 1, len = 0, i = 1, byte
      do { if (i >= this.buf.length) return out; byte = this.buf[i++]; len += (byte & 127) * mult; mult *= 128 } while (byte & 128)
      if (this.buf.length < i + len) break
      const header = this.buf[0], type = header >> 4, body = this.buf.subarray(i, i + len)
      this.buf = this.buf.subarray(i + len)
      if (type === 3) { const tl = (body[0] << 8) | body[1]; const qos = (header >> 1) & 3; const topic = body.subarray(2, 2 + tl).toString('utf8'); const off = 2 + tl + (qos ? 2 : 0); out.push({ type: 'publish', topic, payload: body.subarray(off).toString('utf8') }) }
      else if (type === 2) out.push({ type: 'connack', code: body[1] })
      else if (type === 9) out.push({ type: 'suback' })
      else if (type === 13) out.push({ type: 'pingresp' })
      else out.push({ type: `t${type}` })
    }
    return out
  }
}

export function mqttConnect({ host, port = 8883, username, password, clientId, onMessage, onClose, rejectUnauthorized = false }) {
  return new Promise((resolve, reject) => {
    const parser = new MqttParser()
    const sock = tls.connect({ host, port, rejectUnauthorized }, () => sock.write(mqttConnectPacket({ clientId, username, password })))
    let ready = false, ping
    const client = {
      subscribe(topic) { sock.write(mqttSubscribePacket(1, topic)) },
      publish(topic, obj) { sock.write(mqttPublishPacket(topic, JSON.stringify(obj))) },
      close() { clearInterval(ping); try { sock.write(DISCONNECT) } catch { /* closing */ } sock.destroy() },
    }
    sock.on('data', d => { for (const p of parser.feed(d)) {
      if (p.type === 'connack') { if (p.code !== 0) { reject(new Error(`MQTT connect refused (code ${p.code}); check the access code`)); sock.destroy(); return } ready = true; ping = setInterval(() => sock.write(PINGREQ), 20000); resolve(client) }
      else if (p.type === 'publish') onMessage?.(p.topic, p.payload)
    } })
    sock.on('error', e => { if (!ready) reject(e); onClose?.(e) })
    sock.on('close', () => { clearInterval(ping); if (!ready) reject(new Error('MQTT connection closed before CONNACK')); onClose?.() })
    sock.setTimeout(15000, () => { if (!ready) { reject(new Error('MQTT connect timed out')); sock.destroy() } })
  })
}

// ───────────────────────── Implicit FTPS upload ─────────────────────────

function ftpLine(sock) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = d => { buf += d.toString('latin1'); const lines = buf.split('\r\n'); for (const l of lines) if (/^\d{3} /.test(l)) { sock.off('data', onData); sock.off('error', onErr); resolve(l); return } }
    const onErr = e => { sock.off('data', onData); reject(e) }
    sock.on('data', onData); sock.once('error', onErr)
    setTimeout(() => { sock.off('data', onData); reject(new Error('FTPS timeout')) }, 20000)
  })
}

export async function ftpsUpload({ host, port = 990, username, password, name, content, rejectUnauthorized = false }) {
  const ctl = tls.connect({ host, port, rejectUnauthorized })
  await new Promise((r, j) => { ctl.once('secureConnect', r); ctl.once('error', j) })
  const send = async (cmd, ok) => { const p = ftpLine(ctl); ctl.write(cmd + '\r\n'); const line = await p; if (!ok.includes(Number(line.slice(0, 3)))) throw new Error(`FTPS ${cmd.split(' ')[0]} failed: ${line}`); return line }
  await ftpLine(ctl) // 220 banner
  await send(`USER ${username}`, [331, 230])
  await send(`PASS ${password}`, [230])
  await send('PBSZ 0', [200])
  await send('PROT P', [200])
  await send('TYPE I', [200])
  const pasv = await send('PASV', [227])
  const m = pasv.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/)
  if (!m) throw new Error(`FTPS PASV unparseable: ${pasv}`)
  const dataPort = Number(m[5]) * 256 + Number(m[6])
  const storReply = ftpLine(ctl)
  ctl.write(`STOR ${name}\r\n`)
  const data = tls.connect({ host, port: dataPort, rejectUnauthorized, session: ctl.getSession() })
  await new Promise((r, j) => { data.once('secureConnect', r); data.once('error', j) })
  const first = await storReply
  if (![125, 150].includes(Number(first.slice(0, 3)))) throw new Error(`FTPS STOR refused: ${first}`)
  await new Promise((r, j) => { data.end(content, r); data.once('error', j) })
  const done = await ftpLine(ctl)
  if (Number(done.slice(0, 3)) !== 226) throw new Error(`FTPS transfer not confirmed: ${done}`)
  try { ctl.write('QUIT\r\n') } catch { /* closing */ }
  ctl.destroy()
}

// ───────────────────────── Adapter ─────────────────────────

/** Map Bambu gcode_state to the agent's machine state. */
export function bambuState(report) {
  const s = report?.print?.gcode_state
  if (!s) return { state: 'idle', detail: 'No report yet' }
  const map = { IDLE: 'idle', FINISH: 'idle', FAILED: 'error', RUNNING: 'busy', PREPARE: 'busy', SLICING: 'busy', PAUSE: 'paused' }
  const detail = [s, report.print.mc_percent !== undefined ? `${report.print.mc_percent}%` : null, report.print.nozzle_temper !== undefined ? `nozzle ${Math.round(report.print.nozzle_temper)}°C` : null].filter(Boolean).join(' · ')
  return { state: map[s] ?? 'busy', detail }
}

/** Command Bambu Studio sends to start a file already on the SD card. */
export function bambuPrintCommand(name, opts = {}) {
  return { print: { sequence_id: '0', command: 'project_file', param: name.endsWith('.3mf') ? 'Metadata/plate_1.gcode' : '', url: `file:///sdcard/${name}`, subtask_name: name.replace(/\.[^.]+$/, ''), md5: '', profile_id: '0', project_id: '0', subtask_id: '0', task_id: '0', timelapse: false, bed_leveling: opts.bedLeveling ?? true, flow_cali: false, vibration_cali: false, layer_inspect: false, use_ams: false, ams_mapping: [0] } }
}

export function bambu(m) {
  const serial = m.serial, host = m.url?.replace(/^https?:\/\//, '') ?? m.host
  let client = null, last = null, printingName = null, reportedDone = false
  async function ensure() {
    if (client) return client
    if (!serial || !m.accessCode || !host) throw new Error('Bambu machine needs url (printer IP), serial and accessCode (Settings → WLAN → LAN Only Mode on the printer)')
    client = await mqttConnect({ host, port: m.mqttPort ?? 8883, username: 'bblp', password: m.accessCode, clientId: `benchcraft-${Math.random().toString(36).slice(2, 8)}`,
      onMessage: (_t, payload) => { try { const j = JSON.parse(payload); if (j.print) last = { print: { ...(last?.print ?? {}), ...j.print } } } catch { /* ignore */ } },
      onClose: () => { client = null } })
    client.subscribe(`device/${serial}/report`)
    client.publish(`device/${serial}/request`, { pushing: { sequence_id: '0', command: 'pushall' } })
    await new Promise(r => setTimeout(r, 2000))
    return client
  }
  return {
    async status() { try { await ensure(); return bambuState(last) } catch (e) { return { state: 'offline', detail: e.message } } },
    async start(file) {
      const c = await ensure()
      await ftpsUpload({ host, port: m.ftpPort ?? 990, username: 'bblp', password: m.accessCode, name: file.name, content: file.content })
      printingName = file.name; reportedDone = false
      c.publish(`device/${serial}/request`, bambuPrintCommand(file.name, { bedLeveling: m.bedLeveling }))
    },
    async progress() {
      await ensure()
      const s = last?.print?.gcode_state, pct = Number(last?.print?.mc_percent ?? 0)
      if (s === 'FINISH' && printingName && !reportedDone) { reportedDone = true; return { progress: 100, done: true, failed: false, detail: `Finished ${printingName}` } }
      if (s === 'FAILED') return { progress: pct, done: false, failed: true, detail: `Printer reported FAILED (error ${last?.print?.print_error ?? 'unknown'})` }
      return { progress: pct, done: false, failed: false, detail: bambuState(last).detail }
    },
    async cancel() { const c = await ensure(); c.publish(`device/${serial}/request`, { print: { sequence_id: '0', command: 'stop' } }) },
    accepts: ['gcode', '3mf'],
  }
}

/** Listen briefly for Bambu SSDP announcements (UDP 2021). Returns [{ ip, serial, name, model }]. */
export function bambuDiscover(ms = 4000) {
  return new Promise(resolve => {
    const found = new Map()
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8')
      if (!/bambu|USN:/i.test(text)) return
      const get = k => text.match(new RegExp(`^${k}:\\s*(.+)$`, 'mi'))?.[1]?.trim()
      const serial = get('USN'); if (!serial) return
      found.set(serial, { ip: get('Location') ?? rinfo.address, serial, name: get('DevName.bambu.com') ?? 'Bambu Lab printer', model: get('DevModel.bambu.com') ?? '' })
    })
    sock.on('error', () => resolve([...found.values()]))
    try { sock.bind(2021, () => { try { sock.setBroadcast(true) } catch { /* fine */ } }) } catch { resolve([]) }
    setTimeout(() => { try { sock.close() } catch { /* closed */ } resolve([...found.values()]) }, ms)
  })
}
