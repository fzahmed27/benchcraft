import assert from 'node:assert/strict'
import { acceptedInputs, startPreparedJob } from './bench-agent-jobs.mjs'

const tools = { kind: 'fdm_printer', canRenderScad: true, canSlice: true }
assert.deepEqual(acceptedInputs(['gcode'], tools), ['gcode', 'stl', 'scad'])
assert.deepEqual(acceptedInputs(['gcode'], { ...tools, canSlice: false }), ['gcode'])
assert.deepEqual(acceptedInputs(['gcode'], { ...tools, canRenderScad: false }), ['gcode', 'stl'])
assert.deepEqual(acceptedInputs(['gcode'], { ...tools, kind: 'cnc_router' }), ['gcode'])
assert.deepEqual(acceptedInputs(['gcode'], { ...tools, slicerOutput: '3mf' }), ['gcode'])
assert.ok(acceptedInputs(['3mf'], { ...tools, slicerOutput: '3mf' }).includes('scad'))

for (const scenario of ['ok', 'cancelled-before', 'cancelled-during', 'unavailable', 'transition-conflict']) {
  let starts = 0, conversions = 0, state = scenario === 'cancelled-before' ? 'cancelled' : 'preparing'
  const driver = { start: async () => { starts++ } }
  const run = () => startPreparedJob({ id: 'job' }, { name: 'printer', driver }, {
    getJob: async () => { if (scenario === 'unavailable') throw new Error('offline'); return { state } },
    prepare: async () => { conversions++; if (scenario === 'cancelled-during') state = 'cancelled'; return { type: 'gcode' } },
    reportJob: async () => { if (scenario === 'transition-conflict') throw new Error('conflict'); state = 'running' },
  })
  if (scenario === 'ok') await run()
  else await assert.rejects(run)
  assert.equal(starts, scenario === 'ok' ? 1 : 0, scenario)
  if (scenario === 'cancelled-before') assert.equal(conversions, 0)
}
console.log('Agent job checks passed: format conversion capabilities, cancellation, unavailable storage, and conflicting transitions.')
