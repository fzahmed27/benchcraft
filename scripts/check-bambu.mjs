/**
 * Exercises the Bambu Lab adapter against a fake printer: a TLS MQTT broker and an implicit-FTPS
 * server on localhost with a throwaway self-signed certificate. Needs the openssl CLI.
 *   node scripts/check-bambu.mjs
 */
import tls from 'node:tls'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MqttParser, mqttPublishPacket, bambu, bambuPrintCommand, bambuState } from './bench-agent-bambu.mjs'
const dir = mkdtempSync(join(tmpdir(), 'benchcraft-bambu-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=fake-bambu'], { stdio: 'ignore' })
const creds = { key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }
const SERIAL = 'TESTSERIAL01'
const log = []
let uploaded = null, state = { gcode_state: 'IDLE', mc_percent: 0, nozzle_temper: 25 }

// ── fake MQTT broker
tls.createServer(creds, sock => {
  const parser = new MqttParser()
  const report = () => sock.write(mqttPublishPacket(`device/${SERIAL}/report`, JSON.stringify({ print: state })))
  sock.on('data', d => { for (const p of parser.feed(d)) {
    if (p.type === 't1') { const body = d.subarray(2); const pl = (body[0] << 8) | body[1]; const proto = body.subarray(2, 2 + pl).toString(); log.push(`CONNECT proto=${proto}`); sock.write(Buffer.from([0x20, 2, 0, 0])) }
    else if (p.type === 't8') { log.push('SUBSCRIBE'); sock.write(Buffer.from([0x90, 3, 0, 1, 0])) }
    else if (p.type === 't12') sock.write(Buffer.from([0xd0, 0]))
    else if (p.type === 'publish') {
      const j = JSON.parse(p.payload); log.push(`REQUEST ${p.topic} ${j.pushing?.command ?? j.print?.command}`)
      if (j.pushing?.command === 'pushall') report()
      if (j.print?.command === 'project_file') { log.push(`print url=${j.print.url} param=${j.print.param}`); state = { ...state, gcode_state: 'RUNNING', mc_percent: 10 }; report(); setTimeout(() => { state = { ...state, mc_percent: 60 }; report() }, 800); setTimeout(() => { state = { ...state, gcode_state: 'FINISH', mc_percent: 100 }; report() }, 1600) }
      if (j.print?.command === 'stop') { state = { ...state, gcode_state: 'IDLE' }; report() }
    }
  } })
}).listen(18883)

// ── fake implicit FTPS
const dataSrv = tls.createServer(creds, sock => { const chunks = []; sock.on('data', c => chunks.push(c)); sock.on('end', () => { uploaded = Buffer.concat(chunks); dataSrv.emit('uploaded') }) }).listen(0)
tls.createServer(creds, sock => {
  sock.write('220 fake bambu ftp\r\n')
  sock.on('data', d => { for (const line of d.toString().split('\r\n').filter(Boolean)) {
    const [cmd] = line.split(' '); log.push(`FTP ${line.startsWith('PASS') ? 'PASS ****' : line}`)
    if (cmd === 'USER') sock.write('331 password\r\n'); else if (cmd === 'PASS') sock.write('230 ok\r\n')
    else if (['PBSZ', 'PROT', 'TYPE'].includes(cmd)) sock.write('200 ok\r\n')
    else if (cmd === 'PASV') { const port = dataSrv.address().port; sock.write(`227 Entering Passive Mode (127,0,0,1,${port >> 8},${port & 255})\r\n`) }
    else if (cmd === 'STOR') { sock.write('150 go\r\n'); dataSrv.once('uploaded', () => sock.write('226 done\r\n')) }
    else if (cmd === 'QUIT') sock.write('221 bye\r\n')
  } })
}).listen(10990)

// ── drive the adapter like the bench agent does
const m = bambu({ url: '127.0.0.1', mqttPort: 18883, ftpPort: 10990, serial: SERIAL, accessCode: '12345678' })
assert.equal(bambuState({ print: { gcode_state: 'PAUSE' } }).state, 'paused')
assert.equal(bambuPrintCommand('box.3mf').print.param, 'Metadata/plate_1.gcode')
assert.equal(bambuPrintCommand('box.gcode').print.url, 'file:///sdcard/box.gcode')
assert.equal((await m.status()).state, 'idle')
await m.start({ name: 'enclosure.gcode', type: 'gcode', content: 'G28\nG1 X10\n' })
assert.equal(uploaded?.toString(), 'G28\nG1 X10\n', 'file uploaded byte-for-byte over FTPS')
const seen = []
for (const t of [300, 900, 1000]) { await new Promise(r => setTimeout(r, t)); seen.push(await m.progress()) }
assert.deepEqual(seen.map(p => [p.progress, p.done]), [[10, false], [60, false], [100, true]])
assert.equal((await m.status()).state, 'idle')
await m.cancel()
await new Promise(r => setTimeout(r, 300))
assert.ok(log.includes('REQUEST device/TESTSERIAL01/request project_file') && log.includes('FTP STOR enclosure.gcode') && log.at(-1).endsWith('stop'), log.join(' | '))
console.log('Bambu adapter checks passed: MQTT connect/subscribe/pushall, FTPS upload, project_file, progress to FINISH, stop.')
process.exit(0)
