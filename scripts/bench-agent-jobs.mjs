/** Source formats the agent can actually convert to the driver's native formats. */
export function acceptedInputs(native, { kind, canRenderScad, canSlice, slicerOutput = 'gcode' }) {
  const accepts = new Set(native)
  // A printer slicer must never generate toolpaths for CNC routers or lasers.
  if (kind === 'fdm_printer' && canSlice && accepts.has(slicerOutput)) accepts.add('stl')
  if (canRenderScad && accepts.has('stl')) accepts.add('scad')
  return [...accepts]
}

/** Fail closed if cancellation or a storage failure happens during conversion. */
export async function startPreparedJob(job, machine, { prepare, getJob, reportJob }) {
  const assertPreparing = async () => {
    const current = await getJob(job.id)
    if (current?.state !== 'preparing') throw new Error(`Job is ${current?.state ?? 'unavailable'}; refusing to start`)
  }
  await assertPreparing()
  const file = await prepare(job, machine)
  await assertPreparing()
  // The server atomically rejects this transition if cancellation won the race.
  await reportJob(job.id, { state: 'running', progress: 0, message: `Starting on ${machine.name}` })
  await machine.driver.start(file)
}
