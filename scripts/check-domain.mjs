import assert from 'node:assert/strict';
import {defaults,draft,checks,configSchema,projectInput,matchPrompt,partsFor,firmware,planMarkdown} from '../lib/bench.ts';
const p=draft();
assert.equal(checks(p)[1].ok,true);
assert.match(checks(p)[1].detail,/50.0 s/);
p.config={...defaults,volume:1000,timeout:30};
assert.equal(checks(p)[1].ok,false,'Dose exceeding cutoff must fail');
assert.equal(configSchema.safeParse({...defaults,flow:0}).success,false);
assert.equal(configSchema.safeParse({...defaults,cycles:1.5}).success,false);
assert.equal(configSchema.safeParse({...defaults,unknown:1}).success,false);
assert.equal(projectInput.safeParse({...p,name:''}).success,false);
assert.equal(matchPrompt('Log temperature every 10 seconds').recipe,'logger');
assert.equal(matchPrompt('Log temperature every 10 seconds').config.interval,10);
assert.equal(matchPrompt('Run 120 cycles').config.cycles,120);
assert.equal(matchPrompt('Dispense 250 ml').config.volume,250);
assert.equal(matchPrompt('Build a radio telescope').recognized,false);
assert.equal(new Set(partsFor('dispenser').map(p=>p.id)).size,partsFor('dispenser').length);
assert.match(firmware(p),/const bool DRY_RUN = true/);
assert.match(firmware(p),/const unsigned long ON_MS=30000UL/);
assert.match(planMarkdown(p),/Physical hardware has not been validated/);
assert.match(firmware(draft('logger')),/DEVICE_DISCONNECTED_C/);
console.log('Domain checks passed: recipe extraction, constraints, cutoff, exports, and firmware defaults.');

// ── Prompt-to-device: partner index, planner, machines, MCP ──────────────────
const {components, searchComponents, componentsProviding, catalogueSummary, getComponent} = await import('../lib/catalog/index.ts')
const {designDevice, extractNeeds} = await import('../lib/design.ts')
const {canTransition, jobInput, machineInput} = await import('../lib/machines/schema.ts')

assert.ok(components.length >= 45, 'index has at least 45 components')
assert.equal(new Set(components.map(c => c.id)).size, components.length, 'component ids are unique')
assert.ok(components.every(c => c.source.url.startsWith('https://')), 'every component has a source URL')
assert.ok(components.filter(c => c.controller).length >= 6, 'at least six controllers indexed')
assert.ok(components.every(c => !c.requires.driver || componentsProviding(c.requires.driver).length > 0), 'every required driver is indexed')
assert.ok(catalogueSummary().partners.adafruit.indexed > 30)
assert.equal(searchComponents({capability: 'sense:temperature', maxPrice: 5})[0].id, 'ds18b20')
assert.equal(searchComponents({partner: 'raspberrypi', category: 'Controller'}).length, 4)
assert.equal(getComponent('nope'), undefined)

assert.deepEqual(extractNeeds('Water my houseplant when the soil gets dry').needs.sort(), ['actuate:pump', 'sense:soil-moisture'])
assert.ok(extractNeeds('Turn on my space heater').unsupported.length === 1, 'mains devices are refused')
assert.equal(extractNeeds('Make me something cool').needs.length, 0)

const plant = designDevice({prompt: 'Water my houseplant when the soil gets dry and show the moisture on a screen'})
assert.equal(plant.recognized, true)
assert.ok(plant.parts.some(p => p.id === 'mosfet-n'), 'pump gets a MOSFET driver automatically')
assert.ok(plant.parts.some(p => p.id === 'psu-12v-5a') && plant.parts.some(p => p.id === 'buck-5v'), '12 V load adds a 12 V supply and a 5 V buck')
assert.match(plant.firmware.code, /^PUMP_PIN = \d+$/m, 'pin constant emitted for the driven actuator')
assert.match(plant.firmware.code, /DRY_RUN = True/)
assert.match(plant.firmware.code, /def run_pump_peristaltic\(\):/)
assert.match(plant.firmware.code, /if moisture < THRESHOLD:/)
assert.doesNotMatch(plant.firmware.code, /lambda/, 'no statement lambdas in generated Python')
assert.equal(plant.fabrication[0].file.type, 'scad')
assert.match(plant.enclosure.scad, /module body\(\)/)
assert.ok(plant.enclosure.outerMm.w > 100 && plant.enclosure.outerMm.h > 20)
assert.ok(plant.simulation.trigger && plant.simulation.trigger.capability === 'sense:soil-moisture' && plant.simulation.trigger.below === true)
assert.ok(plant.cost.partsUsd > 50 && plant.cost.partsUsd < 200)
const owned = designDevice({prompt: 'Water my houseplant when the soil gets dry', inventory: ['pico2w']})
assert.equal(owned.controller.id, 'pico2w', 'owned controller is preferred')
assert.equal(owned.cost.ownedUsd, 7)

const scale = designDevice({prompt: 'A scale that shows the weight and beeps above 2 kg, notify my phone', preferences: {platform: 'arduino'}})
assert.equal(scale.firmware.filename, 'device.ino')
assert.match(scale.firmware.code, /const float THRESHOLD = 2000;/)
assert.match(scale.firmware.code, /const int HX_DOUT_PIN = \d+;/)
assert.match(scale.firmware.code, /#include <WiFi.h>/)
assert.match(scale.firmware.code, /void run_buzzer\(\)/)
assert.match(scale.firmware.code, /String statusLine = "grams=" \+ String\(grams\);/)

const cam = designDevice({prompt: 'Take a photo of my bird feeder every 10 minutes and email it'})
assert.equal(cam.controller.platform, 'python')
assert.ok(cam.parts.some(p => p.id === 'picam3'))
assert.doesNotMatch(cam.firmware.code, /servo/, 'bird feeder does not add a servo')
assert.match(cam.firmware.code, /INTERVAL_S = 600/)

const battery = designDevice({prompt: 'Beep when someone walks into the garage', preferences: {portable: true}})
assert.equal(battery.controller.id, 'esp32s3-feather', 'battery designs prefer the board with a charger')
assert.ok(battery.parts.some(p => p.id === 'lipo-1200') && !battery.parts.some(p => p.id === 'lipo-charger'))

const vague = designDevice({prompt: 'Make me something cool'})
assert.equal(vague.recognized, false)
assert.equal(vague.questions.length, 1)
const mains = designDevice({prompt: 'Turn on my space heater when the room is cold'})
assert.equal(mains.recognized, false)
assert.ok(mains.unsupported[0].includes('mains'))

assert.equal(canTransition('pending_approval', 'queued'), true)
assert.equal(canTransition('pending_approval', 'running'), false)
assert.equal(canTransition('completed', 'queued'), false)
assert.equal(jobInput.safeParse({machineId: 'x', title: 'T', file: {name: 'a.scad', type: 'scad', content: 'cube(1);'}}).success, false, 'machine ids need at least two characters')
assert.equal(jobInput.safeParse({machineId: 'sim', title: 'T', file: {name: '../evil', type: 'scad', content: 'cube(1);'}}).success, false, 'file names are restricted')
assert.equal(machineInput.safeParse({id: 'sim', name: 'S', kind: 'fdm_printer', adapter: 'simulated'}).success, true)

console.log('Prompt-to-device checks passed: partner index, planner, firmware, enclosure, simulation, job rules.')

// An owned compatible sensor must be preferred over buying an alternative.
const tempDefault = designDevice({ prompt: 'Measure temperature' })
const tempSensor = tempDefault.parts.find(p => components.find(c => c.id === p.id)?.category === 'Sensor')
assert.ok(tempSensor)
const tempOwned = designDevice({ prompt: 'Measure temperature', inventory: [tempSensor.id] })
assert.ok(tempOwned.parts.some(p => p.id === tempSensor.id && p.owned), 'reuse the owned temperature sensor')
const unavailableIndex = components.map(c => c.id === tempSensor.id ? { ...c, stock: 'out-of-stock' } : c)
const tempAvailable = designDevice({ prompt: 'Measure temperature' }, unavailableIndex)
assert.ok(!tempAvailable.parts.some(p => p.id === tempSensor.id), 'prefer an available temperature sensor')
console.log('Planner regression checks passed: owned and available components preferred.')
