import { z } from 'zod'
import { components as fullIndex, componentsProviding, getComponent, type CapabilityId, type Component } from './catalog/index.ts'
import { matchPrompt, type RecipeId } from './bench.ts'

// ───────────────────────── Request / record types ─────────────────────────

export const designRequest = z.object({
  prompt: z.string().trim().min(3).max(2000),
  preferences: z.object({
    controller: z.string().optional(),
    platform: z.enum(['micropython', 'arduino', 'python']).optional(),
    budgetUsd: z.number().positive().max(5000).optional(),
    portable: z.boolean().optional(),
  }).strict().default({}),
  /** Component ids the person already owns. The planner prefers these. */
  inventory: z.array(z.string()).max(50).default([]),
}).strict()

export type DesignRequest = z.infer<typeof designRequest>

export type DesignPart = {
  id: string; name: string; qty: number; role: string; price: number; pricing: Component['pricing']; stock: Component['stock']
  source: Component['source']; pins: Record<string, string>; owned: boolean
}

export type DesignRecord = {
  id: string
  createdAt: string
  prompt: string
  recognized: boolean
  summary: string
  needs: CapabilityId[]
  unsupported: string[]
  questions: string[]
  assumptions: string[]
  recipe: RecipeId | null
  controller: { id: string; name: string; platform: 'micropython' | 'arduino' | 'python'; logicVoltage: '3v3' | '5v' }
  parts: DesignPart[]
  wiring: Array<{ from: string; to: string; note: string }>
  power: { rails: Array<{ rail: string; demandMa: number; suppliedBy: string }>; warnings: string[] }
  firmware: { platform: string; filename: string; libraries: string[]; code: string }
  enclosure: { scad: string; innerMm: { w: number; d: number; h: number }; outerMm: { w: number; d: number; h: number }; features: string[] }
  fabrication: Array<{ title: string; machineKind: 'fdm_printer'; file: { name: string; type: 'scad'; content: string }; settings: { material: string; layerHeightMm: number; infillPercent: number; supports: boolean } }>
  assembly: string[]
  checklist: Array<{ title: string; detail: string; ok: boolean | null }>
  cost: { partsUsd: number; ownedUsd: number; currency: 'USD'; note: string }
  simulation: { note: string; inputs: Array<{ capability: CapabilityId; label: string; unit: string; min: number; max: number; initial: number }>; outputs: Array<{ capability: CapabilityId; label: string }>; trigger: { capability: CapabilityId; below: boolean; threshold: number; unit: string } | null }
}

// ───────────────────────── Intent extraction ─────────────────────────

type Rule = { test: RegExp; needs: CapabilityId[] }

const rules: Rule[] = [
  { test: /weather station|barometer|air pressure|altitude/, needs: ['sense:temperature', 'sense:humidity', 'sense:pressure'] },
  { test: /temperature|thermometer|too hot|too cold|warm|thermal|fridge|freezer|fermentation|brew/, needs: ['sense:temperature'] },
  { test: /humidity|humid|damp|mould|mold/, needs: ['sense:humidity'] },
  { test: /distance|how far|proximity|parking|ultrasonic|range ?finder|tank level|water level|bin (is )?full/, needs: ['sense:distance'] },
  { test: /motion|movement|someone (walks|enters|comes)|intruder|presence|occupan|pir\b|burglar/, needs: ['sense:motion'] },
  { test: /light level|brightness|when it gets dark|too dark|lux|daylight|sunlight|sunrise|sunset/, needs: ['sense:light'] },
  { test: /tilt|shake|vibrat|orientation|fall detect|accelerom|gyro|knock/, needs: ['sense:imu'] },
  { test: /current draw|power usage|how much power|watt|amps?\b|energy monitor/, needs: ['sense:current'] },
  { test: /soil|plant|moisture|garden|houseplant|pot(ted)?\b/, needs: ['sense:soil-moisture'] },
  { test: /weigh|weight|scale\b|kilogram|grams?\b|how heavy/, needs: ['sense:weight'] },
  { test: /button|press(ing)? (a|the)|start\/stop|push to/, needs: ['sense:button'] },
  { test: /knob|dial|encoder|adjustable|set ?point/, needs: ['sense:rotary'] },
  { test: /camera|photo|picture|video|time-?lapse|recogni[sz]e|detect (a )?(cat|dog|person|face)/, needs: ['sense:camera'] },
  { test: /servo|flap|lever|swing|(pet|cat|dog|fish) feeder|feeder (that|to) (drop|dispense|release)|open (the |a )?(lid|door|hatch)|wave|point(er)?\b/, needs: ['actuate:servo'] },
  { test: /stepper|precise rotation|turntable|rotate exactly|index(ing)? wheel/, needs: ['actuate:stepper'] },
  { test: /\bmotor\b|spin|wheel|robot|drive around|conveyor/, needs: ['actuate:dc-motor'] },
  { test: /pump|dispens|dose|dosing|pour|water (the|my) (plant|garden|pot)|irrigat/, needs: ['actuate:pump'] },
  { test: /solenoid|latch|unlock|lock\b|push rod|kick/, needs: ['actuate:solenoid'] },
  { test: /valve|sprinkler|tap water|hose/, needs: ['actuate:valve'] },
  { test: /relay|switch (on|off) (a|the|my)|turn (on|off) (a|the|my) (lamp|light|fan|heater|pump)/, needs: ['actuate:relay'] },
  { test: /led strip|light strip|lamp|light up|glow|neopixel|rgb|mood light|colou?r light|indicator light|night ?light/, needs: ['actuate:led-strip'] },
  { test: /buzz|beep|alarm|alert|siren|chime|make a sound|remind/, needs: ['actuate:buzzer'] },
  { test: /\bfan\b|cooling|airflow|ventilat|blow/, needs: ['actuate:fan'] },
  { test: /display|screen|show (the|me|a)|readout|oled|lcd|read ?out/, needs: ['display:text'] },
  { test: /wi-?fi|internet|phone|notif|dashboard|online|cloud|mqtt|home assistant|web ?(page|server|app)|remote(ly)?|from anywhere|log to|graph|e-?mail|text me|sms|telegram|slack|discord/, needs: ['connect:wifi'] },
  { test: /bluetooth|\bble\b/, needs: ['connect:ble'] },
  { test: /battery|portable|cordless|wearable|carry|pocket|hand-?held|rechargeable/, needs: ['power:battery'] },
]

const unsupportedRules: Array<{ test: RegExp; reason: string }> = [
  { test: /mains|110 ?v|120 ?v|220 ?v|230 ?v|240 ?v|wall (outlet|socket)|appliance|space heater|kettle|oven|toaster|microwave|hair ?dryer/, reason: 'Switching mains voltage is outside Benchcraft\'s scope. Use a certified smart plug for the mains side and let the device signal it over Wi-Fi.' },
  { test: /medic|insulin|patient|pacemaker|prescription|drug|iv drip|ventilator/, reason: 'Medical and safety-critical devices are excluded from the first release.' },
  { test: /drone|quadcopter|aircraft|fly\b|flying/, reason: 'Flight controllers are not supported.' },
  { test: /car (engine|brake|airbag)|vehicle control|steering/, reason: 'Vehicle control is safety-critical and not supported.' },
  { test: /weapon|gun|taser|trap (for|to catch) (people|someone)/, reason: 'Not supported.' },
]

function extractNumbers(s: string) {
  const num = (re: RegExp) => { const m = s.match(re); return m ? Number(m[1]) : undefined }
  const interval = s.match(/every\s+(\d+(?:\.\d+)?)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?|h(?:ours?|rs?)?)\b/)
  let intervalS: number | undefined
  if (interval) { const n = Number(interval[1]); const u = interval[2][0]; intervalS = u === 'h' ? n * 3600 : u === 'm' ? n * 60 : n }
  return {
    intervalS,
    volumeMl: num(/(\d+(?:\.\d+)?)\s*(?:ml|millilit)/),
    thresholdC: num(/(?:below|under|above|over|than|to|at)\s+(-?\d+(?:\.\d+)?)\s*(?:°|deg|c\b|celsius)/),
    thresholdCm: num(/(\d+(?:\.\d+)?)\s*cm\b/),
    thresholdPercent: num(/(\d+)\s*%/),
    thresholdG: (() => { const kg = num(/(\d+(?:\.\d+)?)\s*(?:kg|kilo)/); if (kg !== undefined) return kg * 1000; return num(/(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/) })(),
    count: num(/(\d+)\s*(?:leds?|lights|pixels)/),
  }
}

export function extractNeeds(prompt: string): { needs: CapabilityId[]; unsupported: string[]; numbers: ReturnType<typeof extractNumbers> } {
  const s = prompt.toLowerCase()
  const needs = new Set<CapabilityId>()
  for (const r of rules) if (r.test.test(s)) r.needs.forEach(n => needs.add(n))
  // "water the plant" without an explicit pump still means a pump.
  if (needs.has('sense:soil-moisture') && /water/.test(s) && !needs.has('actuate:valve')) needs.add('actuate:pump')
  // A dashboard or graph implies a display only if asked; a phone implies Wi-Fi (already covered).
  const unsupported = unsupportedRules.filter(r => r.test.test(s)).map(r => r.reason)
  return { needs: [...needs], unsupported, numbers: extractNumbers(s) }
}

// ───────────────────────── Pin naming ─────────────────────────

/** Constant names each component's code snippet expects, in the order pins are assigned. */
const pinNames: Record<string, string[]> = {
  ds18b20: ['PROBE_PIN'], dht22: ['DHT_PIN'], 'hc-sr04': ['TRIG_PIN', 'ECHO_PIN'], pir: ['PIR_PIN'],
  button: ['BUTTON_PIN'], rotary: ['ENC_A_PIN', 'ENC_B_PIN', 'ENC_SW_PIN'], 'servo-micro': ['SERVO_PIN'],
  'relay-stemma': ['RELAY_PIN'], 'neopixel-1m': ['LED_PIN'], buzzer: ['BUZZER_PIN'], 'lcd-16x2': ['LCD_RS', 'LCD_EN', 'LCD_D4', 'LCD_D5', 'LCD_D6', 'LCD_D7'],
  // pins consumed by a driver on behalf of the actuator it drives
  'pump-peristaltic': ['PUMP_PIN'], 'solenoid-12v': ['SOLENOID_PIN'], 'valve-12v': ['VALVE_PIN'], 'fan-5v': ['FAN_PIN'],
  'tt-motor': ['MOTOR_IN1_PIN', 'MOTOR_IN2_PIN', 'MOTOR_STBY_PIN'], nema17: ['STEP_A1_PIN', 'STEP_A2_PIN', 'STEP_B1_PIN', 'STEP_B2_PIN'],
  'loadcell-20kg': ['HX_DOUT_PIN', 'HX_SCK_PIN'],
}

// ───────────────────────── Planner ─────────────────────────

export function designDevice(input: DesignRequest, index: Component[] = fullIndex): DesignRecord {
  const req = designRequest.parse(input)
  const { needs, unsupported, numbers } = extractNeeds(req.prompt)
  const inventory = new Set(req.inventory)
  const assumptions: string[] = []
  const questions: string[] = []
  const warnings: string[] = []
  const legacy = matchPrompt(req.prompt)

  if (needs.length === 0) {
    questions.push('What should the device sense (temperature, motion, distance, weight…) and what should it do in response (light, sound, pump, motor, message)?')
  }
  const wantsWifi = needs.includes('connect:wifi')
  const wantsBattery = needs.includes('power:battery') || req.preferences.portable === true
  const wantsCamera = needs.includes('sense:camera')
  if (wantsBattery && (needs.includes('actuate:pump') || needs.includes('actuate:stepper') || needs.includes('actuate:valve'))) {
    warnings.push('Pumps, valves and steppers need a 12 V supply; battery operation would need a much larger pack than this design includes.')
  }

  // 1. Controller
  const controllers = index.filter(c => c.controller)
  let controller = req.preferences.controller ? controllers.find(c => c.id === req.preferences.controller) : undefined
  if (!controller) controller = controllers.find(c => inventory.has(c.id) && (!wantsCamera || c.controller!.buses.includes('csi')))
  if (!controller) {
    const pool = controllers.filter(c => {
      if (wantsCamera && !c.controller!.buses.includes('csi')) return false
      if (!wantsCamera && c.provides.includes('sbc')) return false
      if (req.preferences.platform && c.controller!.platform !== req.preferences.platform) return false
      return true
    })
    const ranked = pool.sort((a, b) => {
      const score = (c: Component) => (wantsBattery && c.provides.includes('power:charger') ? -20 : 0) + (wantsWifi && !c.controller!.wifi ? 50 : 0) + c.price
      return score(a) - score(b)
    })
    controller = ranked[0] ?? controllers[0]
  }
  const ctl = controller.controller!
  const platform = ctl.platform

  // 2. Parts: greedy set cover over needs, then drivers, power, assembly
  const parts = new Map<string, DesignPart>()
  const addPart = (c: Component, role: string, qty = 1) => {
    const existing = parts.get(c.id)
    if (existing) { existing.qty += qty; return existing }
    const p: DesignPart = { id: c.id, name: c.name, qty, role, price: c.price, pricing: c.pricing, stock: c.stock, source: c.source, pins: {}, owned: inventory.has(c.id) }
    parts.set(c.id, p)
    return p
  }
  addPart(controller, 'Controller: runs the program and talks to every other part')

  const remaining = new Set(needs.filter(n => !controller!.provides.includes(n) && !n.startsWith('power:') && n !== 'connect:wifi' && n !== 'connect:ble'))
  if (wantsWifi && !ctl.wifi) warnings.push(`${controller.name} has no Wi-Fi; choose a Wi-Fi board for notifications or dashboards.`)
  const chosen: Component[] = []
  const compatible = (c: Component) => {
    if (c.requires.bus && !ctl.buses.includes(c.requires.bus)) return false
    if (c.requires.power === '5v' && ctl.logicVoltage === '3v3' && c.category === 'Display' && c.requires.bus === 'gpio') return false // parallel 5 V LCD on 3.3 V logic
    if (c.category === 'Controller') return false
    return true
  }
  while (remaining.size) {
    let best: { c: Component; covers: CapabilityId[]; score: number } | null = null
    for (const c of index) {
      if (!compatible(c)) continue
      const covers = c.provides.filter(p => remaining.has(p))
      if (!covers.length) continue
      const score = covers.length * 100 - c.price + (inventory.has(c.id) ? 1000 : 0) + (c.stock === 'in-stock' ? 5 : 0) - (c.stock === 'out-of-stock' ? 40 : 0)
      if (!best || score > best.score) best = { c, covers, score }
    }
    if (!best) {
      const missing = [...remaining]
      unsupported.push(`No indexed component provides ${missing.join(', ')} for ${controller.name}.`)
      break
    }
    chosen.push(best.c)
    addPart(best.c, roleFor(best.c, best.covers))
    best.covers.forEach(c => remaining.delete(c))
  }

  // Drivers required by chosen actuators
  const driven = new Map<string, Component>() // driver id -> actuator that owns its pins
  for (const c of [...chosen]) {
    if (!c.requires.driver) continue
    const driver = componentsProviding(c.requires.driver, index).find(compatible)
    if (!driver) { unsupported.push(`${c.name} needs a ${c.requires.driver} driver that is not indexed.`); continue }
    addPart(driver, `Driver: lets ${controller.name} switch ${c.name.toLowerCase()} safely`)
    driven.set(driver.id, c)
    if (!chosen.includes(driver)) chosen.push(driver)
  }

  // 3. Pin assignment
  const pool = [...ctl.pinPool]
  const takePins = (n: number) => { if (pool.length < n) { warnings.push(`${controller!.name} has run out of free GPIO pins; remove a part or choose a bigger board.`); return Array.from({ length: n }, (_, i) => `NC${i}`) } return pool.splice(0, n) }
  const wiring: DesignRecord['wiring'] = []
  const railDemand: Record<string, number> = { '3v3': 0, '5v': 0, '12v': 0 }
  for (const c of chosen) {
    const part = parts.get(c.id)!
    const owner = driven.get(c.id) ?? c
    const names = pinNames[owner.id] ?? [owner.id.toUpperCase().replace(/-/g, '_') + '_PIN']
    const count = c.requires.driver ? 0 : Math.max(c.requires.pins, c.requires.bus === 'gpio' || c.requires.bus === 'pwm' || c.requires.bus === 'onewire' ? names.length : 0)
    if (c.requires.power) railDemand[c.requires.power] += c.requires.currentMa * part.qty
    if (c.requires.bus === 'i2c') {
      const b = ctl.busPins.i2c
      wiring.push({ from: `${controller.name} ${b.SDA}/${b.SCL} (I2C)`, to: `${c.name} SDA/SCL`, note: 'STEMMA QT cable or two wires; shared bus' })
      wiring.push({ from: `${controller.name} 3V3 + GND`, to: `${c.name} VIN + GND`, note: 'Power from the board' })
    } else if (c.requires.bus === 'csi') {
      wiring.push({ from: `${controller.name} CSI connector`, to: `${c.name} ribbon`, note: 'Blue side of the ribbon faces the connector latch' })
    } else if (count > 0) {
      const pins = takePins(count)
      pins.forEach((pin, i) => { part.pins[names[i] ?? `PIN${i}`] = pin })
      const target = driven.get(c.id) ? `${c.name} signal input(s)` : `${c.name} signal`
      wiring.push({ from: `${controller.name} ${pins.join(', ')}`, to: target, note: c.requires.bus === 'onewire' ? '4.7 kΩ pull-up from data to 3V3' : c.requires.bus === 'pwm' ? 'PWM signal' : c.category === 'Sensor' && c.requires.pins === 1 ? 'Digital input' : 'Digital output' })
      if (c.requires.power) wiring.push({ from: c.requires.power === '12v' ? '12 V supply +/−' : `${controller.name} ${c.requires.power === '5v' ? 'VBUS/5V' : '3V3'} + GND`, to: `${c.name} power`, note: c.requires.power === '5v' && c.requires.currentMa > 400 ? 'Use the external 5 V supply, not the board pin' : 'Power' })
    }
    if (driven.get(c.id)) {
      const act = driven.get(c.id)!
      wiring.push({ from: `${c.name} output`, to: `${act.name} −`, note: 'Low-side switching; add a flyback diode across inductive loads' })
      wiring.push({ from: act.requires.power === '12v' ? '12 V supply +' : '5 V supply +', to: `${act.name} +`, note: `Fuse the supply for ${act.requires.currentMa} mA peak` })
    }
  }

  // 4. Power
  const rails: DesignRecord['power']['rails'] = []
  const needs12 = railDemand['12v'] > 0
  if (needs12) { const psu = getComponent('psu-12v-5a')!; addPart(psu, 'Powers the 12 V loads'); rails.push({ rail: '12 V', demandMa: railDemand['12v'], suppliedBy: psu.name }) }
  const boardCan5v = ctl.suppliesRails.includes('5v')
  if (wantsBattery) {
    const lipo = getComponent('lipo-1200')!; addPart(lipo, 'Battery for portable use')
    if (!controller.provides.includes('power:charger')) addPart(getComponent('lipo-charger')!, 'Recharges the battery over USB')
    rails.push({ rail: '3.3 V / battery', demandMa: railDemand['3v3'] + railDemand['5v'], suppliedBy: lipo.name })
    if (railDemand['5v'] > 0) warnings.push('5 V parts on a 3.7 V battery need a boost converter; consider swapping them for 3.3 V equivalents.')
  } else if (needs12) {
    const buck = getComponent('buck-5v')!; addPart(buck, 'Makes 5 V for the controller from the 12 V brick')
    rails.push({ rail: '5 V', demandMa: railDemand['5v'] + 300, suppliedBy: buck.name })
    rails.push({ rail: '3.3 V', demandMa: railDemand['3v3'], suppliedBy: `${controller.name} regulator` })
    if (railDemand['5v'] + 300 > 1200) warnings.push('5 V demand exceeds the buck converter rating; add a second converter or a dedicated 5 V supply.')
  } else {
    const psu = getComponent('psu-5v-2a5')!; addPart(psu, 'Wall power for the device')
    rails.push({ rail: '5 V', demandMa: railDemand['5v'] + 300, suppliedBy: psu.name })
    rails.push({ rail: '3.3 V', demandMa: railDemand['3v3'], suppliedBy: `${controller.name} regulator` })
    if (!boardCan5v && railDemand['5v'] > 0) warnings.push(`${controller.name} cannot pass 5 V through to peripherals; wire 5 V parts directly to the supply.`)
    if (railDemand['5v'] + 300 > 2500) warnings.push('5 V demand exceeds a 2.5 A supply; choose a bigger supply.')
  }
  if (railDemand['3v3'] > 300) warnings.push('3.3 V demand is above what most boards regulate on-board; add a 3.3 V regulator.')

  // 5. Assembly parts
  const i2cCount = chosen.filter(c => c.requires.bus === 'i2c').length
  if (i2cCount) addPart(getComponent('stemma-cable')!, 'Plug-in I2C cables', i2cCount)
  addPart(getComponent('jumpers')!, 'Wiring')
  if (chosen.some(c => c.requires.bus === 'gpio' || c.requires.bus === 'pwm' || c.requires.bus === 'onewire' || c.category === 'Driver')) addPart(getComponent('breadboard-half')!, 'Solder-free assembly')
  addPart(getComponent('enclosure-printed')!, 'Printed case, generated below')
  addPart(getComponent('m3-hardware')!, 'Mounts boards in the case')

  // 6. Firmware
  const rule = ruleFor(chosen.filter(c => c.category === 'Sensor'), chosen.filter(c => c.category === 'Actuator'), numbers)
  const firmware = buildFirmware(platform, controller, chosen, parts, numbers, req.prompt, wantsWifi, rule)

  // 7. Enclosure
  const enclosure = buildEnclosure(controller, chosen, parts)

  // 8. Cost
  const partsUsd = [...parts.values()].reduce((s, p) => s + (p.owned ? 0 : p.price * p.qty), 0)
  const ownedUsd = [...parts.values()].reduce((s, p) => s + (p.owned ? p.price * p.qty : 0), 0)
  if (req.preferences.budgetUsd && partsUsd > req.preferences.budgetUsd) warnings.push(`Estimated parts cost $${partsUsd.toFixed(2)} exceeds the $${req.preferences.budgetUsd} budget.`)

  // 9. Assumptions and summary
  if (needs.includes('actuate:pump') && !numbers.volumeMl) assumptions.push('Dose volume not stated; the program uses 50 mL per run. Change DOSE_ML in the program.')
  if (needs.some(n => n.startsWith('sense:')) && !numbers.intervalS) assumptions.push('Reading interval not stated; the device reads sensors every 10 seconds.')
  if (needs.includes('sense:soil-moisture') && !numbers.thresholdPercent) assumptions.push('Dry threshold not stated; watering starts below 30 % moisture.')
  if (needs.includes('sense:temperature') && numbers.thresholdC === undefined && needs.some(n => n.startsWith('actuate:'))) assumptions.push('Temperature threshold not stated; the trigger is set at 25 °C.')
  assumptions.push('Actuators start in dry-run mode: the program prints what it would do until DRY_RUN is set to false after checking the wiring.')
  const summary = summarise(needs, controller, chosen, wantsBattery)

  return {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    prompt: req.prompt,
    recognized: needs.length > 0 && unsupported.length === 0,
    summary,
    needs,
    unsupported,
    questions,
    assumptions,
    recipe: legacy.recognized ? legacy.recipe : null,
    controller: { id: controller.id, name: controller.name, platform, logicVoltage: ctl.logicVoltage },
    parts: [...parts.values()],
    wiring,
    power: { rails, warnings },
    firmware,
    enclosure,
    fabrication: [{
      title: `Enclosure for: ${summary.slice(0, 80)}`,
      machineKind: 'fdm_printer',
      file: { name: 'enclosure.scad', type: 'scad', content: enclosure.scad },
      settings: { material: 'PLA', layerHeightMm: 0.2, infillPercent: 20, supports: false },
    }],
    assembly: buildAssembly(controller, chosen, parts, wiring, platform),
    checklist: [
      { title: 'Parts are compatible', detail: `Every part is rated for ${ctl.logicVoltage === '3v3' ? '3.3 V' : '5 V'} logic or isolated by a driver.`, ok: unsupported.length === 0 },
      { title: 'Power budget', detail: rails.map(r => `${r.rail}: ${r.demandMa} mA from ${r.suppliedBy}`).join(' · '), ok: warnings.length === 0 ? true : null },
      { title: 'Program uploaded', detail: `${firmware.filename} runs on ${controller.name} and prints readings over USB.`, ok: null },
      { title: 'Dry run observed', detail: 'Sensor readings change when you act on them; actuators log REQUEST_ON without moving.', ok: null },
      { title: 'Enclosure fits', detail: 'Boards sit on the standoffs and connectors reach their cutouts.', ok: null },
      { title: 'Device does what the prompt asked', detail: req.prompt, ok: null },
    ],
    cost: { partsUsd: Math.round(partsUsd * 100) / 100, ownedUsd: Math.round(ownedUsd * 100) / 100, currency: 'USD', note: 'Live Adafruit prices as of the index date; MSRP and estimate prices must be confirmed at checkout. Shipping and tax excluded.' },
    simulation: buildSimulation(needs, numbers, rule),
  }
}

function roleFor(c: Component, covers: CapabilityId[]) {
  const what = covers.map(x => x.split(':')[1].replace('-', ' ')).join(', ')
  return c.category === 'Sensor' ? `Senses ${what}` : c.category === 'Actuator' ? `Acts: ${what}` : c.category === 'Display' ? 'Shows readings' : `Provides ${what}`
}

function summarise(needs: CapabilityId[], controller: Component, chosen: Component[], battery: boolean) {
  const senses = chosen.filter(c => c.category === 'Sensor').map(c => c.name.toLowerCase())
  const acts = chosen.filter(c => c.category === 'Actuator').map(c => c.name.toLowerCase())
  const disp = chosen.find(c => c.category === 'Display')
  const bits = [`A ${battery ? 'battery-powered' : 'mains-powered'} device built on a ${controller.name}`]
  if (senses.length) bits.push(`that measures with ${senses.join(' and ')}`)
  if (acts.length) bits.push(`${senses.length ? 'and ' : 'that '}controls ${acts.join(' and ')}`)
  if (disp) bits.push(`showing status on a ${disp.name.toLowerCase()}`)
  if (needs.includes('connect:wifi')) bits.push('with Wi-Fi reporting')
  return bits.join(' ') + '.'
}

// ───────────────────────── Firmware ─────────────────────────

/** Turn a board pin label into the number or identifier the platform expects. */
function pinLiteral(pin: string, platform: 'micropython' | 'arduino' | 'python') {
  if (platform === 'arduino') return pin.replace(/^D(?=\d)/, '').replace(/^GP(IO)?/, '')
  return pin.replace(/^GP(IO)?/, '')
}

/** Names assigned on the left of `=` in a snippet's loop, e.g. `temp_c, humidity = ...`. */
function readingNames(loop: string) {
  const out: string[] = []
  for (const line of loop.split('\n')) {
    const m = line.match(/^\s*(?:(?:unsigned\s+|const\s+)?[A-Za-z_][A-Za-z0-9_]*\s+)?([a-zA-Z_][a-zA-Z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)\s*=[^=]/)
    if (m) out.push(...m[1].split(',').map(x => x.trim()))
  }
  return out
}

const isArduinoDecl = (line: string) => /^[A-Za-z_][A-Za-z0-9_<>:]*\s+[A-Za-z_][A-Za-z0-9_]*(\(.*\))?;\s*$/.test(line.trim())

type BehaviourRule = { threshold: number; python: string[]; arduino: string[]; trigger: DesignRecord['simulation']['trigger'] }

function buildFirmware(platform: 'micropython' | 'arduino' | 'python', controller: Component, chosen: Component[], parts: Map<string, DesignPart>, numbers: ReturnType<typeof extractNumbers>, prompt: string, wifi: boolean, rule: BehaviourRule): DesignRecord['firmware'] {
  const wifiOn = wifi && !!controller.controller?.wifi
  const libraries = new Set<string>()
  const sensors = chosen.filter(c => c.category === 'Sensor')
  const displays = chosen.filter(c => c.category === 'Display')
  const actuators = chosen.filter(c => c.category === 'Actuator')
  const intervalS = numbers.intervalS ?? 10
  const ctlCode = controller.code[platform]
  ctlCode?.libraries.forEach(l => libraries.add(l))
  const missing: string[] = []
  const snippetFor = (c: Component) => { const sn = c.code[platform]; if (!sn) { missing.push(c.name); return null } sn.libraries.forEach(l => libraries.add(l)); return sn }
  const pinConsts = [...parts.values()].flatMap(part => Object.entries(part.pins).map(([name, pin]) => platform === 'arduino' ? `const int ${name} = ${pinLiteral(pin, platform)};` : `${name} = ${pinLiteral(pin, platform)}`))
  const header = `Benchcraft generated program for: ${prompt.replace(/\s+/g, ' ').slice(0, 120)}\nController: ${controller.name}. Review wiring before setting DRY_RUN to false.`
  const readings = sensors.flatMap(c => readingNames(c.code[platform]?.loop ?? ''))

  if (platform === 'micropython' || platform === 'python') {
    const setups: string[] = [], sensorLoops: string[] = [], displayLoops: string[] = [], actions: string[] = []
    for (const c of sensors) { const sn = snippetFor(c); if (sn) { setups.push(sn.setup); if (sn.loop) sensorLoops.push(sn.loop) } }
    for (const c of displays) { const sn = snippetFor(c); if (sn) { setups.push(sn.setup); if (sn.loop) displayLoops.push(sn.loop) } }
    for (const c of actuators) { const sn = snippetFor(c); if (sn) { setups.push(sn.setup); actions.push(`def run_${c.id.replace(/-/g, '_')}():\n    ${(sn.loop || 'pass').split('\n').join('\n    ')}`) } }
    const statusLine = readings.length ? `status_line = " ".join(f"{n}={v}" for n, v in [${readings.map(r => `("${r}", ${r})`).join(', ')}])` : 'status_line = "running"'
    const code = [
      `"""${header}"""`,
      ctlCode?.setup ?? (platform === 'micropython' ? 'from machine import Pin, I2C, PWM, ADC\nimport time' : 'import time'),
      '',
      'DRY_RUN = True          # set False only after checking the wiring',
      `INTERVAL_S = ${intervalS}`,
      `DOSE_ML = ${numbers.volumeMl ?? 50}`,
      'FLOW_ML_PER_MIN = 100   # measure your pump and update',
      'seconds_for_dose = DOSE_ML / FLOW_ML_PER_MIN * 60',
      'open_seconds = 5',
      `THRESHOLD = ${rule.threshold}`,
      ...pinConsts,
      '',
      ...setups.map(s => s.trim()),
      ...(missing.length ? [`# TODO: no ${platform} snippet indexed for ${missing.join(', ')}`] : []),
      '',
      ...(wifiOn ? (platform === 'micropython' ? [
        'WIFI_SSID = "your-network"',
        'WIFI_PASSWORD = "your-password"',
        'REPORT_URL = ""   # e.g. https://example.com/ingest — empty means print only',
        'import network, urequests',
        'wlan = network.WLAN(network.STA_IF); wlan.active(True)',
        'if WIFI_SSID != "your-network":',
        '    wlan.connect(WIFI_SSID, WIFI_PASSWORD)',
        '',
        'def report(line):',
        '    if REPORT_URL and wlan.isconnected():',
        '        try:',
        '            urequests.post(REPORT_URL, json={"status": line}).close()',
        '        except Exception as e:',
        '            print("report failed", e)',
        '',
      ] : [
        'REPORT_URL = ""   # e.g. https://example.com/ingest — empty means print only',
        'import requests',
        '',
        'def report(line):',
        '    if REPORT_URL:',
        '        try:',
        '            requests.post(REPORT_URL, json={"status": line}, timeout=5)',
        '        except Exception as e:',
        '            print("report failed", e)',
        '',
      ]) : []),
      'def act(name, fn):',
      '    if DRY_RUN:',
      '        print("REQUEST_ON", name)',
      '    else:',
      '        fn()',
      '',
      ...actions.flatMap(a => [a, '']),
      'while True:',
      ...sensorLoops.map(l => '    ' + l.split('\n').join('\n    ')),
      '    ' + statusLine,
      '    print(status_line)',
      ...(wifiOn ? ['    report(status_line)'] : []),
      ...displayLoops.map(l => '    ' + l.split('\n').join('\n    ')),
      ...rule.python.map(l => '    ' + l),
      '    time.sleep(INTERVAL_S)',
      '',
    ].join('\n')
    return { platform, filename: 'main.py', libraries: [...libraries], code }
  }

  const includes = new Set<string>(), globals: string[] = [], setupCalls: string[] = [], sensorLoops: string[] = [], displayLoops: string[] = [], actions: string[] = []
  const splitSetup = (setup: string) => { for (const line of setup.split('\n')) { const t = line.trim(); if (!t) continue; if (t.startsWith('#include')) includes.add(t); else if (isArduinoDecl(t)) globals.push(t); else setupCalls.push(t) } }
  if (ctlCode?.setup) splitSetup(ctlCode.setup)
  for (const c of sensors) { const sn = snippetFor(c); if (sn) { splitSetup(sn.setup); if (sn.loop) sensorLoops.push(sn.loop) } }
  for (const c of displays) { const sn = snippetFor(c); if (sn) { splitSetup(sn.setup); if (sn.loop) displayLoops.push(sn.loop) } }
  for (const c of actuators) { const sn = snippetFor(c); if (sn) { splitSetup(sn.setup); actions.push(`void run_${c.id.replace(/-/g, '_')}() { ${sn.loop || ''} }`) } }
  const statusLine = readings.length ? `String statusLine = ${readings.map(r => `"${r}=" + String(${r})`).join(' + " " + ')};` : 'String statusLine = "running";'
  const code = [
    `// ${header.replace(/\n/g, '\n// ')}`,
    ...includes,
    'const bool DRY_RUN = true;   // set false only after checking the wiring',
    `const unsigned long INTERVAL_MS = ${intervalS * 1000}UL;`,
    `const float DOSE_ML = ${numbers.volumeMl ?? 50};`,
    'const float FLOW_ML_PER_MIN = 100;   // measure your pump and update',
    'const unsigned long doseMs = DOSE_ML / FLOW_ML_PER_MIN * 60000;',
    'const unsigned long openMs = 5000;',
    `const float THRESHOLD = ${rule.threshold};`,
    ...pinConsts,
    ...globals,
    ...(missing.length ? [`// TODO: no Arduino snippet indexed for ${missing.join(', ')}`] : []),
    ...(wifiOn ? [
      controller.id === 'uno-r4-wifi' ? '#include <WiFiS3.h>' : '#include <WiFi.h>',
      'const char* WIFI_SSID = "your-network";',
      'const char* WIFI_PASSWORD = "your-password";',
      'const char* REPORT_HOST = "";   // e.g. example.com — empty means print only',
      'const char* REPORT_PATH = "/ingest";',
      'WiFiClient reportClient;',
      'void report(const String& line) {',
      '  if (strlen(REPORT_HOST) == 0 || WiFi.status() != WL_CONNECTED) return;',
      '  if (!reportClient.connect(REPORT_HOST, 80)) { Serial.println("report failed"); return; }',
      '  String body = "{\\"status\\":\\"" + line + "\\"}";',
      '  reportClient.print(String("POST ") + REPORT_PATH + " HTTP/1.1\\r\\nHost: " + REPORT_HOST + "\\r\\nContent-Type: application/json\\r\\nContent-Length: " + body.length() + "\\r\\nConnection: close\\r\\n\\r\\n" + body);',
      '  reportClient.stop();',
      '}',
    ] : []),
    'unsigned long lastRun = 0;',
    'void act(const char* name, void (*fn)()) { if (DRY_RUN) { Serial.print("REQUEST_ON "); Serial.println(name); } else { fn(); } }',
    ...actions,
    'void setup() {',
    '  Serial.begin(115200);',
    ...(wifiOn ? ['  if (strcmp(WIFI_SSID, "your-network") != 0) WiFi.begin(WIFI_SSID, WIFI_PASSWORD);'] : []),
    ...setupCalls.map(l => '  ' + l),
    '}',
    'void loop() {',
    '  if (millis() - lastRun < INTERVAL_MS) return;',
    '  lastRun = millis();',
    ...sensorLoops.flatMap(l => l.split('\n').map(x => '  ' + x)),
    '  ' + statusLine,
    '  Serial.println(statusLine);',
    ...(wifiOn ? ['  report(statusLine);'] : []),
    ...displayLoops.flatMap(l => l.split('\n').map(x => '  ' + x)),
    ...rule.arduino.map(l => '  ' + l),
    '}',
    '',
  ].join('\n')
  return { platform, filename: 'device.ino', libraries: [...libraries], code }
}

function ruleFor(sensors: Component[], actuators: Component[], numbers: ReturnType<typeof extractNumbers>): BehaviourRule {
  const sensor = sensors.find(c => !c.provides.includes('sense:button') && !c.provides.includes('sense:rotary'))
  const button = sensors.find(c => c.provides.includes('sense:button'))
  const calls = actuators.map(a => `act("${a.id.replace(/-/g, '_')}", run_${a.id.replace(/-/g, '_')})`)
  if (!actuators.length) return { threshold: numbers.thresholdC ?? numbers.thresholdPercent ?? numbers.thresholdCm ?? 0, python: [], arduino: [], trigger: null }
  if (button && !sensor) return { threshold: 0, python: ['if pressed:', ...calls.map(c => '    ' + c)], arduino: [`if (pressed) { ${calls.map(c => c + ';').join(' ')} }`], trigger: { capability: 'sense:button', below: false, threshold: 0, unit: 'pressed' } }
  if (!sensor) return { threshold: 0, python: calls, arduino: calls.map(c => c + ';'), trigger: null }
  const cap = sensor.provides[0]
  const map: Partial<Record<CapabilityId, { py: string; ard: string; threshold: number; below: boolean }>> = {
    'sense:temperature': { py: 'temp_c', ard: 'tempC', threshold: numbers.thresholdC ?? 25, below: false },
    'sense:soil-moisture': { py: 'moisture', ard: 'moisture', threshold: numbers.thresholdPercent ? numbers.thresholdPercent * 20 : 600, below: true },
    'sense:distance': { py: 'distance_cm', ard: 'distanceCm', threshold: numbers.thresholdCm ?? 30, below: true },
    'sense:light': { py: 'lux', ard: 'lux', threshold: 50, below: true },
    'sense:motion': { py: 'motion_detected', ard: 'motionDetected', threshold: 0, below: false },
    'sense:weight': { py: 'grams', ard: 'grams', threshold: numbers.thresholdG ?? 500, below: false },
    'sense:humidity': { py: 'humidity', ard: 'humidity', threshold: numbers.thresholdPercent ?? 60, below: false },
    'sense:current': { py: 'current_ma', ard: 'currentMa', threshold: 500, below: false },
  }
  const m = map[cap] ?? { py: 'True', ard: 'true', threshold: 0, below: false }
  const cmp = m.below ? '<' : '>'
  const pyCond = m.py === 'True' ? 'True' : m.py === 'motion_detected' ? 'motion_detected' : `${m.py} ${cmp} THRESHOLD`
  const ardCond = m.ard === 'true' ? 'true' : m.ard === 'motionDetected' ? 'motionDetected' : `${m.ard} ${cmp} THRESHOLD`
  const units: Partial<Record<CapabilityId, string>> = { 'sense:temperature': '°C', 'sense:soil-moisture': 'raw', 'sense:distance': 'cm', 'sense:light': 'lux', 'sense:motion': 'on/off', 'sense:weight': 'g', 'sense:humidity': '%', 'sense:current': 'mA' }
  return { threshold: m.threshold, python: [`if ${pyCond}:`, ...calls.map(c => '    ' + c)], arduino: [`if (${ardCond}) { ${calls.map(c => c + ';').join(' ')} }`], trigger: map[cap] ? { capability: cap, below: m.below, threshold: m.threshold, unit: units[cap] ?? '' } : null }
}

// ───────────────────────── Enclosure ─────────────────────────

function buildEnclosure(controller: Component, chosen: Component[], parts: Map<string, DesignPart>): DesignRecord['enclosure'] {
  const inside = [controller, ...chosen].filter(c => !c.footprint.external && c.footprint.w > 0)
  if (parts.has('breadboard-half')) inside.push(getComponent('breadboard-half')!)
  if (parts.has('buck-5v')) inside.push(getComponent('buck-5v')!)
  if (parts.has('lipo-1200')) inside.push(getComponent('lipo-1200')!)
  const gap = 6, wall = 2.4, clearance = 8
  // Row packing: widest first, rows up to ~130 mm.
  const sorted = [...inside].sort((a, b) => b.footprint.w - a.footprint.w)
  const rowLimit = Math.max(130, sorted[0]?.footprint.w ?? 60)
  const placed: Array<{ c: Component; x: number; y: number }> = []
  let x = gap, y = gap, rowH = 0, maxW = 0
  for (const c of sorted) {
    if (x + c.footprint.w + gap > rowLimit + gap && x > gap) { x = gap; y += rowH + gap; rowH = 0 }
    placed.push({ c, x, y })
    x += c.footprint.w + gap
    rowH = Math.max(rowH, c.footprint.d)
    maxW = Math.max(maxW, x)
  }
  const innerW = Math.ceil(maxW), innerD = Math.ceil(y + rowH + gap)
  const innerH = Math.ceil(Math.max(...inside.map(c => c.footprint.h), 10) + clearance)
  const features: string[] = []
  const buttons = parts.get('button')?.qty ?? 0
  const hasDisplay = chosen.some(c => c.category === 'Display')
  const hasFan = chosen.some(c => c.id === 'fan-5v')
  const hasProbe = chosen.some(c => c.footprint.external && c.category === 'Sensor') || chosen.some(c => c.footprint.external && c.category === 'Actuator')
  features.push('USB slot beside the controller', 'Corner screw bosses for the lid')
  if (buttons) features.push(`${buttons} × 16 mm button hole(s) in the lid`)
  if (hasDisplay) features.push('Display window in the lid')
  if (hasFan) features.push('Vent slots on one wall')
  if (hasProbe) features.push('Cable gland hole for external sensors / actuators')
  const ctlPos = placed.find(p => p.c.id === controller.id)!
  const scad = `// Benchcraft generated enclosure. Units: mm. Fit-check before printing.
// Inner cavity ${innerW} x ${innerD} x ${innerH}. Wall ${wall}. Boards sit on 4 mm standoffs.
$fn = 40;
inner = [${innerW}, ${innerD}, ${innerH}];
wall = ${wall};
lid_t = 2.4;
standoff_h = 4;
outer = [inner[0] + 2*wall, inner[1] + 2*wall, inner[2] + wall];

module rounded_box(size, r) {
  hull() for (dx = [r, size[0]-r], dy = [r, size[1]-r]) translate([dx, dy, 0]) cylinder(r = r, h = size[2]);
}
module standoffs(pos, size, h) {
  for (p = [[3,3],[size[0]-3,3],[3,size[1]-3],[size[0]-3,size[1]-3]])
    translate([wall + pos[0] + p[0], wall + pos[1] + p[1], wall]) difference() { cylinder(d = 6, h = h); cylinder(d = 2.6, h = h + 1); }
}
module body() {
  difference() {
    rounded_box(outer, 3);
    translate([wall, wall, wall]) cube(inner);
    // USB slot beside the controller
    translate([-1, wall + ${ctlPos.y.toFixed(1)} + ${(controller.footprint.d / 2 - 6).toFixed(1)}, wall + standoff_h + 1]) cube([wall + 2, 12, 8]);
${hasFan ? '    for (i = [0:5]) translate([outer[0] - wall - 1, wall + 8 + i*6, wall + 4]) cube([wall + 2, 3, inner[2] - 10]);\n' : ''}${hasProbe ? '    translate([outer[0]/2, outer[1] + 1, wall + inner[2]/2]) rotate([90,0,0]) cylinder(d = 8, h = wall + 2);\n' : ''}  }
  // lid screw bosses
  for (p = [[4,4],[outer[0]-4,4],[4,outer[1]-4],[outer[0]-4,outer[1]-4]])
    translate([p[0], p[1], wall]) difference() { cylinder(d = 6, h = inner[2]); cylinder(d = 2.6, h = inner[2] + 1); }
${placed.filter(p => p.c.footprint.w >= 15 && p.c.footprint.d >= 15).map(p => `  standoffs([${p.x.toFixed(1)}, ${p.y.toFixed(1)}], [${p.c.footprint.w}, ${p.c.footprint.d}], standoff_h); // ${p.c.name}`).join('\n')}
}
module lid() {
  difference() {
    rounded_box([outer[0], outer[1], lid_t], 3);
    for (p = [[4,4],[outer[0]-4,4],[4,outer[1]-4],[outer[0]-4,outer[1]-4]]) translate([p[0], p[1], -1]) cylinder(d = 3.2, h = lid_t + 2);
${Array.from({ length: buttons }, (_, i) => `    translate([outer[0] - 16 - i*22, 16, -1]) cylinder(d = 16.2, h = lid_t + 2); // button ${i + 1}`).join('\n')}
${hasDisplay ? '    translate([wall + 6, outer[1] - 30, -1]) cube([30, 16, lid_t + 2]); // display window\n' : ''}  }
}
body();
translate([outer[0] + 10, 0, 0]) lid();
`
  return { scad, innerMm: { w: innerW, d: innerD, h: innerH }, outerMm: { w: innerW + 2 * wall, d: innerD + 2 * wall, h: innerH + wall + 2.4 }, features }
}

// ───────────────────────── Assembly and simulation ─────────────────────────

function buildAssembly(controller: Component, chosen: Component[], parts: Map<string, DesignPart>, wiring: DesignRecord['wiring'], platform: string): string[] {
  const steps: string[] = []
  steps.push(`Print the enclosure (body and lid) or download enclosure.scad and send it to any 3D printer.`)
  steps.push(`Install ${platform === 'micropython' ? 'MicroPython on the ' + controller.name + ' (hold BOOTSEL, plug in USB, copy the .uf2 file)' : platform === 'arduino' ? 'the Arduino IDE and add the board package for ' + controller.name : 'Raspberry Pi OS on a microSD card and boot the ' + controller.name}.`)
  if (parts.has('breadboard-half')) steps.push(`Seat the ${controller.name} on the breadboard and screw the breadboard onto its standoffs.`)
  for (const w of wiring) steps.push(`Connect ${w.from} → ${w.to}. ${w.note}.`)
  steps.push('Check every connection twice with the power off. Then plug in USB only (no 12 V yet).')
  steps.push(`Copy the program (${platform === 'arduino' ? 'device.ino' : 'main.py'}) to the board and open the serial monitor at 115200 baud. You should see readings.`)
  if (chosen.some(c => c.category === 'Actuator')) steps.push('Watch for REQUEST_ON lines while the device is in dry run. When they appear at the right moments, connect the load supply and set DRY_RUN to false.')
  steps.push('Fit the boards into the case, route external sensors through the gland hole, and screw the lid on.')
  return steps
}

function buildSimulation(needs: CapabilityId[], numbers: ReturnType<typeof extractNumbers>, rule: BehaviourRule): DesignRecord['simulation'] {
  const inputs: DesignRecord['simulation']['inputs'] = []
  const outputs: DesignRecord['simulation']['outputs'] = []
  const add = (capability: CapabilityId, label: string, unit: string, min: number, max: number, initial: number) => inputs.push({ capability, label, unit, min, max, initial })
  if (needs.includes('sense:temperature')) add('sense:temperature', 'Temperature', '°C', -10, 60, 22)
  if (needs.includes('sense:humidity')) add('sense:humidity', 'Humidity', '%', 0, 100, 45)
  if (needs.includes('sense:soil-moisture')) add('sense:soil-moisture', 'Soil moisture', 'raw', 200, 2000, 900)
  if (needs.includes('sense:distance')) add('sense:distance', 'Distance', 'cm', 2, 400, numbers.thresholdCm ? numbers.thresholdCm * 2 : 100)
  if (needs.includes('sense:light')) add('sense:light', 'Light', 'lux', 0, 2000, 300)
  if (needs.includes('sense:motion')) add('sense:motion', 'Motion', 'on/off', 0, 1, 0)
  if (needs.includes('sense:weight')) add('sense:weight', 'Weight', 'g', 0, 20000, 0)
  if (needs.includes('sense:button')) add('sense:button', 'Button', 'pressed', 0, 1, 0)
  for (const n of needs) if (n.startsWith('actuate:') || n.startsWith('display:')) outputs.push({ capability: n, label: n.split(':')[1].replace('-', ' ') })
  return { note: 'The prototype simulates ideal sensor values and instant actuator response. Real sensors are noisy and slower; verify thresholds on the physical device.', inputs, outputs, trigger: rule.trigger }
}
