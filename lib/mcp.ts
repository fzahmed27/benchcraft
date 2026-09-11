import { z } from 'zod'
import { catalogueSummary, categoryIds, capabilityIds, components, getComponent, partnerIds, refreshLivePricing, searchComponents } from './catalog/index'
import { designDevice, designRequest } from './design'
import { adapters, jobInput, jobStates } from './machines/schema'
import { createJob, getDesign, getJob, getMachine, listDesigns, listJobs, listMachines, saveDesign, updateJob } from './machines/store'

/**
 * Minimal Model Context Protocol server (Streamable HTTP, stateless, JSON responses).
 * Any MCP client — Claude Code, Claude Desktop, an agent SDK — can point at /api/mcp
 * and get the catalogue, the planner and the machine queue as tools.
 */

export const PROTOCOL_VERSION = '2025-06-18'

type JsonRpcId = string | number | null
type Request = { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: unknown }

export type McpContext = {
  /** 'api' when the caller presented a valid BENCH_API_TOKEN; null for anonymous callers. */
  actor: 'api' | null
  /** Whether D1 is available; catalogue tools work without it. */
  storage: boolean
}

type ToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
  requiresAuth?: boolean
  run: (args: unknown, ctx: McpContext) => Promise<unknown>
}

const searchArgs = z.object({
  q: z.string().max(120).optional(),
  category: z.enum(categoryIds).optional(),
  partner: z.enum(partnerIds).optional(),
  capability: z.enum(capabilityIds).optional(),
  maxPrice: z.number().positive().optional(),
  inStockOnly: z.boolean().optional(),
  live: z.boolean().optional().describe('Refresh Adafruit price and stock before searching'),
}).strict()

const submitArgs = z.object({
  machineId: z.string(),
  designId: z.string().uuid().optional(),
  fabricationIndex: z.number().int().min(0).default(0),
  title: z.string().max(120).optional(),
  file: jobInput.shape.file.optional(),
  settings: jobInput.shape.settings.optional(),
  projectId: z.string().uuid().optional(),
}).strict()

const text = (value: unknown) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], structuredContent: typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined })

const compact = (c: NonNullable<ReturnType<typeof getComponent>>) => ({ id: c.id, name: c.name, category: c.category, spec: c.spec, price: c.price, pricing: c.pricing, priceCheckedAt: c.priceCheckedAt, stock: c.stock, partner: c.source.partner, sku: c.source.sku, url: c.source.url, provides: c.provides, requires: c.requires, controller: c.controller ? { platform: c.controller.platform, wifi: c.controller.wifi, logicVoltage: c.controller.logicVoltage, gpio: c.controller.gpio } : undefined })

export const tools: ToolDef[] = [
  {
    name: 'catalogue_overview',
    description: 'What the Benchcraft partner component index covers: partners, capability vocabulary, indexed controllers, and pricing rules. Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async () => catalogueSummary(),
  },
  {
    name: 'search_components',
    description: 'Search the partner component index (Raspberry Pi, Arduino, Adafruit, generic parts). Filter by text, category, partner, capability such as "sense:temperature" or "actuate:pump", price, and stock. Set live=true to refresh Adafruit price and stock first.',
    inputSchema: { type: 'object', properties: { q: { type: 'string' }, category: { type: 'string', enum: [...categoryIds] }, partner: { type: 'string', enum: [...partnerIds] }, capability: { type: 'string', enum: [...capabilityIds] }, maxPrice: { type: 'number' }, inStockOnly: { type: 'boolean' }, live: { type: 'boolean' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: true },
    run: async (args) => {
      const a = searchArgs.parse(args ?? {})
      let pool = components
      let refreshed = 0
      if (a.live) { const r = await refreshLivePricing(components); pool = r.components; refreshed = r.refreshed }
      const results = searchComponents(a, pool)
      return { count: results.length, refreshed, results: results.map(compact) }
    },
  },
  {
    name: 'get_component',
    description: 'Full record for one component by id: sources, datasheet, footprint, power and bus requirements, and code snippets for MicroPython, Arduino and Python.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async (args) => {
      const { id } = z.object({ id: z.string() }).parse(args)
      const c = getComponent(id)
      if (!c) throw new Error(`No component with id "${id}". Use search_components to find ids.`)
      return c
    },
  },
  {
    name: 'design_device',
    description: 'Turn a plain-language request into a complete device design using only indexed parts: controller, parts list with prices and pins, wiring, power budget, generated firmware, a parametric enclosure (OpenSCAD), fabrication jobs, assembly steps and a checklist. Unsupported requests (mains voltage, medical, flight) are refused with a reason. Pass inventory ids the person already owns. The design is saved and can be fetched with get_design or fabricated with submit_fabrication_job.',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: 'What the device should do, in everyday words' }, preferences: { type: 'object', properties: { controller: { type: 'string' }, platform: { type: 'string', enum: ['micropython', 'arduino', 'python'] }, budgetUsd: { type: 'number' }, portable: { type: 'boolean' } }, additionalProperties: false }, inventory: { type: 'array', items: { type: 'string' } } }, required: ['prompt'], additionalProperties: false },
    annotations: { readOnlyHint: false, idempotentHint: true },
    run: async (args, ctx) => {
      const req = designRequest.parse(args)
      const design = designDevice(req)
      if (ctx.storage) { try { await saveDesign(design) } catch { /* design still returned */ } }
      return design
    },
  },
  {
    name: 'get_design',
    description: 'Fetch a saved design by id, or list recent designs when no id is given.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async (args, ctx) => {
      if (!ctx.storage) throw new Error('Design storage is unavailable in this environment.')
      const { id } = z.object({ id: z.string().uuid().optional() }).parse(args ?? {})
      if (!id) return { designs: await listDesigns() }
      const d = await getDesign(id)
      if (!d) throw new Error('Design not found')
      return d
    },
  },
  {
    name: 'list_machines',
    description: 'Fabrication machines registered by the bench agent (3D printers, CNC routers, lasers) with live state, build volume, materials, accepted file types and whether the operator trusts them to run jobs without approval. Also lists the adapters the bench agent supports.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async (_args, ctx) => ({ machines: ctx.storage ? await listMachines() : [], adapters, note: 'Register machines by running scripts/bench-agent.mjs on a computer on the same network as the machine.' }),
  },
  {
    name: 'submit_fabrication_job',
    description: 'Queue a file for a registered machine. Either reference a saved design (designId + fabricationIndex, default the enclosure) or pass a file inline (gcode, stl, scad, 3mf, svg, dxf as text). Jobs on untrusted machines wait for operator approval in the workbench; trusted machines start automatically. Requires a BENCH_API_TOKEN bearer token.',
    inputSchema: { type: 'object', properties: { machineId: { type: 'string' }, designId: { type: 'string' }, fabricationIndex: { type: 'integer', minimum: 0 }, title: { type: 'string' }, file: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['gcode', 'stl', 'scad', '3mf', 'svg', 'dxf'] }, content: { type: 'string' } }, required: ['name', 'type', 'content'] }, settings: { type: 'object', properties: { material: { type: 'string' }, layerHeightMm: { type: 'number' }, infillPercent: { type: 'integer' }, supports: { type: 'boolean' }, quantity: { type: 'integer' } } }, projectId: { type: 'string' } }, required: ['machineId'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    requiresAuth: true,
    run: async (args, ctx) => {
      if (!ctx.storage) throw new Error('Machine storage is unavailable in this environment.')
      const a = submitArgs.parse(args)
      const machine = await getMachine(a.machineId)
      if (!machine) throw new Error(`No machine "${a.machineId}". Call list_machines.`)
      let file = a.file, title = a.title, settings = a.settings
      if (!file) {
        if (!a.designId) throw new Error('Pass either a designId or an inline file.')
        const d = await getDesign(a.designId)
        if (!d) throw new Error('Design not found')
        const fab = d.fabrication[a.fabricationIndex]
        if (!fab) throw new Error(`Design has ${d.fabrication.length} fabrication item(s); index ${a.fabricationIndex} does not exist.`)
        if (fab.machineKind !== machine.kind) throw new Error(`That item needs a ${fab.machineKind}; ${machine.name} is a ${machine.kind}.`)
        file = fab.file; title = title ?? fab.title; settings = settings ?? { ...fab.settings, quantity: 1 }
      }
      const accepts = new Set([...machine.capabilities.accepts, ...adapters[machine.adapter].accepts])
      if (!accepts.has(file.type)) throw new Error(`${machine.name} accepts ${[...accepts].join(', ')}, not ${file.type}. Convert the file first or register the machine with canRenderScad / canSlice.`)
      const input = jobInput.parse({ machineId: a.machineId, title: title ?? file.name, projectId: a.projectId, file, settings: settings ?? { quantity: 1 }, requestedBy: 'mcp' })
      const job = await createJob(input, machine.trusted ? 'queued' : 'pending_approval')
      return { job, next: job.state === 'pending_approval' ? 'An operator must approve this job in the Benchcraft workbench before the machine starts.' : 'The bench agent will pick this job up on its next poll.' }
    },
  },
  {
    name: 'job_status',
    description: 'Status of one fabrication job by id, or a list of recent jobs filtered by machine and state.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, machineId: { type: 'string' }, state: { type: 'string', enum: [...jobStates] } }, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async (args, ctx) => {
      if (!ctx.storage) throw new Error('Machine storage is unavailable in this environment.')
      const a = z.object({ id: z.string().uuid().optional(), machineId: z.string().optional(), state: z.enum(jobStates).optional() }).parse(args ?? {})
      if (a.id) { const j = await getJob(a.id); if (!j) throw new Error('Job not found'); return j }
      return { jobs: await listJobs({ machineId: a.machineId, state: a.state }) }
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel a queued, pending or running fabrication job. Requires a BENCH_API_TOKEN bearer token.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true },
    requiresAuth: true,
    run: async (args, ctx) => {
      if (!ctx.storage) throw new Error('Machine storage is unavailable in this environment.')
      const { id } = z.object({ id: z.string().uuid() }).parse(args)
      const r = await updateJob(id, { state: 'cancelled', message: 'Cancelled by an agent' }, 'operator')
      if (r.error) throw new Error(r.error)
      return r.job
    },
  },
]

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

export async function handleJsonRpc(msg: unknown, ctx: McpContext): Promise<unknown | null> {
  if (!msg || typeof msg !== 'object' || (msg as Request).jsonrpc !== '2.0' || typeof (msg as Request).method !== 'string') return rpcError(null, -32600, 'Invalid Request')
  const { id = null, method, params } = msg as Request
  const isNotification = (msg as Request).id === undefined
  switch (method) {
    case 'initialize':
      return { jsonrpc: '2.0', id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'benchcraft', version: '0.2.0' }, instructions: 'Benchcraft turns plain-language device requests into buildable designs from indexed partner components and fabricates enclosures on registered machines. Start with catalogue_overview, then design_device. Fabrication requires a token and operator approval unless the machine is trusted.' } }
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) } }
    case 'tools/call': {
      const p = z.object({ name: z.string(), arguments: z.unknown().optional() }).safeParse(params)
      if (!p.success) return rpcError(id, -32602, 'Invalid params')
      const tool = tools.find(t => t.name === p.data.name)
      if (!tool) return rpcError(id, -32602, `Unknown tool: ${p.data.name}`)
      if (tool.requiresAuth && ctx.actor !== 'api') return { jsonrpc: '2.0', id, result: { ...text(`${tool.name} requires a BENCH_API_TOKEN bearer token. Ask the Benchcraft operator for one.`), isError: true } }
      try {
        const result = await tool.run(p.data.arguments, ctx)
        return { jsonrpc: '2.0', id, result: text(result) }
      } catch (e) {
        const message = e instanceof z.ZodError ? `Invalid arguments: ${e.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}` : e instanceof Error ? e.message : 'Tool failed'
        return { jsonrpc: '2.0', id, result: { ...text(message), isError: true } }
      }
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`)
  }
}

/** Handle one HTTP POST carrying a JSON-RPC message or batch. */
export async function handleMcpPost(body: unknown, ctx: McpContext): Promise<Response> {
  const messages = Array.isArray(body) ? body : [body]
  if (!messages.length) return Response.json(rpcError(null, -32600, 'Empty batch'), { status: 400 })
  const responses = (await Promise.all(messages.map(m => handleJsonRpc(m, ctx)))).filter(r => r !== null)
  if (!responses.length) return new Response(null, { status: 202 })
  return Response.json(Array.isArray(body) ? responses : responses[0], { headers: { 'Cache-Control': 'no-store' } })
}
