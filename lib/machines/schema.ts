import { z } from 'zod'

export const machineKinds = ['fdm_printer', 'cnc_router', 'laser_cutter', 'serial_bridge'] as const
export type MachineKind = typeof machineKinds[number]

export const adapterIds = ['octoprint', 'moonraker', 'prusalink', 'bambu', 'grbl', 'simulated'] as const
export type AdapterId = typeof adapterIds[number]

export const machineStates = ['offline', 'idle', 'busy', 'error', 'paused'] as const

/** What each adapter can do. The bench agent implements these against the real machine on the LAN. */
export const adapters: Record<AdapterId, { name: string; kinds: MachineKind[]; transport: string; accepts: string[]; notes: string }> = {
  octoprint: { name: 'OctoPrint', kinds: ['fdm_printer'], transport: 'HTTP REST + API key', accepts: ['gcode'], notes: 'Any printer running OctoPrint (Raspberry Pi + USB). Upload and print via /api/files/local.' },
  moonraker: { name: 'Moonraker (Klipper)', kinds: ['fdm_printer'], transport: 'HTTP REST', accepts: ['gcode'], notes: 'Klipper printers: Voron, Creality Sonic Pad, Prusa MK4 with Klipper, etc.' },
  prusalink: { name: 'PrusaLink', kinds: ['fdm_printer'], transport: 'HTTP REST + API key', accepts: ['gcode', 'bgcode'], notes: 'Prusa MINI+, MK4, XL and Core One built-in link.' },
  bambu: { name: 'Bambu Lab (local MQTT + FTPS)', kinds: ['fdm_printer'], transport: 'MQTT over TLS + FTPS, LAN mode', accepts: ['3mf', 'gcode'], notes: 'A1 mini, A1, P1, X1 in LAN-only mode with the access code.' },
  grbl: { name: 'GRBL / grblHAL', kinds: ['cnc_router', 'laser_cutter'], transport: 'USB serial 115200', accepts: ['gcode'], notes: 'Desktop CNC routers and diode lasers. Streams G-code line by line with flow control.' },
  simulated: { name: 'Simulated machine', kinds: ['fdm_printer', 'cnc_router', 'laser_cutter'], transport: 'none', accepts: ['gcode', 'stl', 'scad', '3mf'], notes: 'Accepts any job and reports progress on a timer. Lets the whole prompt-to-fabrication loop run before hardware arrives.' },
}

export const machineInput = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(machineKinds),
  adapter: z.enum(adapterIds),
  /** Human-readable location of the machine, for the operator. */
  location: z.string().max(120).default(''),
  capabilities: z.object({
    buildVolumeMm: z.object({ x: z.number().positive(), y: z.number().positive(), z: z.number().positive() }).optional(),
    materials: z.array(z.string().max(40)).max(20).default([]),
    nozzleMm: z.number().positive().optional(),
    /** File types the agent can turn into a job for this machine (after local conversion). */
    accepts: z.array(z.enum(['gcode', 'bgcode', 'stl', 'scad', '3mf', 'svg', 'dxf'])).default([]),
    /** Whether the local agent has OpenSCAD and a slicer available for this machine. */
    canRenderScad: z.boolean().default(false),
    canSlice: z.boolean().default(false),
  }).default({ materials: [], accepts: [], canRenderScad: false, canSlice: false }),
  /** Trusted machines run approved jobs automatically; untrusted ones require operator approval per job. */
  trusted: z.boolean().default(false),
}).strict()

export type MachineInput = z.infer<typeof machineInput>

export const machineStatusInput = z.object({
  state: z.enum(machineStates),
  detail: z.string().max(240).default(''),
  temperatures: z.record(z.string(), z.number()).optional(),
  progress: z.number().min(0).max(100).optional(),
  currentJobId: z.string().uuid().nullable().optional(),
}).strict()

export type Machine = MachineInput & {
  state: typeof machineStates[number]
  detail: string
  lastSeenAt: string | null
  registeredAt: string
}

export const jobStates = ['pending_approval', 'queued', 'claimed', 'preparing', 'running', 'paused', 'completed', 'failed', 'cancelled'] as const
export type JobState = typeof jobStates[number]

export const jobInput = z.object({
  machineId: z.string().regex(/^[a-z0-9-]{2,40}$/),
  /** What is being fabricated, in plain language, for the operator's approval screen. */
  title: z.string().trim().min(1).max(120),
  projectId: z.string().uuid().optional(),
  file: z.object({
    name: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
    type: z.enum(['gcode', 'stl', 'scad', '3mf', 'svg', 'dxf']),
    /** Inline text content (OpenSCAD, G-code, SVG). Binary files are not accepted inline. */
    content: z.string().max(2_000_000),
  }).strict(),
  settings: z.object({
    material: z.string().max(40).optional(),
    layerHeightMm: z.number().min(0.05).max(1).optional(),
    infillPercent: z.number().int().min(0).max(100).optional(),
    supports: z.boolean().optional(),
    quantity: z.number().int().min(1).max(20).default(1),
  }).default({ quantity: 1 }),
  /** Who asked for this: 'ui' for the workbench, 'mcp' for an agent tool call. */
  requestedBy: z.enum(['ui', 'mcp', 'api']).default('api'),
}).strict()

export type JobInput = z.infer<typeof jobInput>

export const jobUpdateInput = z.object({
  state: z.enum(jobStates).optional(),
  progress: z.number().min(0).max(100).optional(),
  message: z.string().max(400).optional(),
}).strict()

export type Job = Omit<JobInput, 'file'> & {
  id: string
  state: JobState
  progress: number
  message: string
  file: { name: string; type: JobInput['file']['type']; bytes: number }
  createdAt: string
  updatedAt: string
}

/** Legal state transitions. The agent may only move a job forward from a claimed state; the operator may approve or cancel. */
export const transitions: Record<JobState, JobState[]> = {
  pending_approval: ['queued', 'cancelled'],
  queued: ['claimed', 'cancelled'],
  claimed: ['preparing', 'running', 'failed', 'cancelled'],
  preparing: ['running', 'failed', 'cancelled'],
  running: ['paused', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled', 'failed'],
  completed: [],
  failed: ['queued'],
  cancelled: [],
}

export function canTransition(from: JobState, to: JobState) {
  return transitions[from].includes(to)
}
