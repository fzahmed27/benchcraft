import { z } from 'zod'

/**
 * Capability vocabulary shared by the catalogue, the planner, and agents.
 * `provides` says what a component adds to a device. `requires` says what it
 * needs from the rest of the design (a bus, pins, power, a driver).
 */
export const capabilityIds = [
  // controllers
  'mcu', 'sbc',
  // sensing
  'sense:temperature', 'sense:humidity', 'sense:pressure', 'sense:distance', 'sense:motion',
  'sense:light', 'sense:imu', 'sense:current', 'sense:soil-moisture', 'sense:weight',
  'sense:button', 'sense:rotary', 'sense:touch', 'sense:sound', 'sense:camera', 'sense:fingerprint',
  // actuation
  'actuate:servo', 'actuate:stepper', 'actuate:dc-motor', 'actuate:pump', 'actuate:relay',
  'actuate:solenoid', 'actuate:valve', 'actuate:led-strip', 'actuate:buzzer', 'actuate:fan', 'actuate:cooler',
  // display
  'display:text', 'display:graphic', 'display:touch',
  // drivers
  'drive:mosfet', 'drive:stepper', 'drive:dc-motor', 'drive:relay', 'drive:adc',
  // power
  'power:5v', 'power:12v', 'power:battery', 'power:charger',
  // connectivity
  'connect:wifi', 'connect:ble', 'connect:usb',
  // mechanical / assembly
  'mech:enclosure', 'mech:wiring', 'mech:prototyping', 'mech:mounting',
] as const

export type CapabilityId = typeof capabilityIds[number]

export const busIds = ['i2c', 'spi', 'uart', 'onewire', 'pwm', 'adc', 'gpio', 'usb', 'csi'] as const
export type BusId = typeof busIds[number]

export const requirementSchema = z.object({
  /** A bus the component must be attached to. */
  bus: z.enum(busIds).optional(),
  /** Number of GPIO-class pins consumed on the controller (not counting shared buses). */
  pins: z.number().int().min(0).max(40).default(0),
  /** Supply rail the component needs. */
  power: z.enum(['3v3', '5v', '12v']).optional(),
  /** Peak current draw on that rail in mA, used for supply sizing. */
  currentMa: z.number().min(0).max(20000).default(0),
  /** A driver capability that must sit between the controller and this part. */
  driver: z.enum(['drive:mosfet', 'drive:stepper', 'drive:dc-motor', 'drive:relay', 'drive:adc']).optional(),
}).strict()

export type Requirement = z.infer<typeof requirementSchema>

export const partnerIds = ['adafruit', 'raspberrypi', 'arduino', 'sparkfun', 'seeed', 'generic'] as const
export type PartnerId = typeof partnerIds[number]

export const categoryIds = [
  'Controller', 'Sensor', 'Actuator', 'Driver', 'Display', 'Power', 'Connectivity', 'Mechanical', 'Assembly',
] as const
export type CategoryId = typeof categoryIds[number]

export const sourceSchema = z.object({
  partner: z.enum(partnerIds),
  sku: z.string().min(1).max(64),
  url: z.string().url(),
}).strict()

export const controllerSpecSchema = z.object({
  platform: z.enum(['micropython', 'arduino', 'python']),
  logicVoltage: z.enum(['3v3', '5v']),
  gpio: z.number().int().min(1).max(60),
  buses: z.array(z.enum(busIds)),
  /** Ordered GPIO names the planner hands out to peripherals. */
  pinPool: z.array(z.string()),
  /** Fixed bus pins (documented default pins), by bus. */
  busPins: z.record(z.string(), z.record(z.string(), z.string())),
  wifi: z.boolean(),
  ble: z.boolean(),
  /** Whether the board's 5 V and 3.3 V rails can be used by peripherals from USB power. */
  suppliesRails: z.array(z.enum(['3v3', '5v'])),
}).strict()

export type ControllerSpec = z.infer<typeof controllerSpecSchema>

export const codeSnippetSchema = z.object({
  /** Library or module names to install, per platform. */
  libraries: z.array(z.string()).default([]),
  setup: z.string().default(''),
  loop: z.string().default(''),
}).strict()

export const componentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(120),
  category: z.enum(categoryIds),
  spec: z.string().max(240),
  notes: z.string().max(600),
  source: sourceSchema,
  alsoFrom: z.array(sourceSchema).default([]),
  datasheet: z.string().url().optional(),
  /** Unit price in USD. `pricing` says how trustworthy it is. */
  price: z.number().min(0),
  currency: z.literal('USD').default('USD'),
  pricing: z.enum(['live', 'estimate', 'msrp']),
  priceCheckedAt: z.string(),
  stock: z.enum(['in-stock', 'low', 'out-of-stock', 'unknown']).default('unknown'),
  provides: z.array(z.enum(capabilityIds)),
  requires: requirementSchema.default({ pins: 0, currentMa: 0 }),
  /** Supply capability of power parts: rail and current it can deliver. */
  supplies: z.object({ rail: z.enum(['3v3', '5v', '12v']), currentMa: z.number() }).optional(),
  /** Bounding box in mm, used for enclosure sizing. `external` parts live outside the box. */
  footprint: z.object({ w: z.number(), d: z.number(), h: z.number(), external: z.boolean().default(false) }),
  controller: controllerSpecSchema.optional(),
  code: z.object({
    micropython: codeSnippetSchema.optional(),
    arduino: codeSnippetSchema.optional(),
    python: codeSnippetSchema.optional(),
  }).default({}),
  tags: z.array(z.string()).default([]),
}).strict()

export type Component = z.infer<typeof componentSchema>
export type ComponentInput = z.input<typeof componentSchema>

export const partners: Record<PartnerId, { name: string; homepage: string; liveApi: 'public' | 'keyed' | 'none'; note: string }> = {
  adafruit: { name: 'Adafruit', homepage: 'https://www.adafruit.com', liveApi: 'public', note: 'Public product API returns live price and stock. Benchcraft refreshes Adafruit SKUs on demand.' },
  raspberrypi: { name: 'Raspberry Pi', homepage: 'https://www.raspberrypi.com/products/', liveApi: 'none', note: 'Published recommended retail prices; buy through an approved reseller such as Adafruit.' },
  arduino: { name: 'Arduino', homepage: 'https://store.arduino.cc', liveApi: 'none', note: 'Store prices are recorded as estimates and must be confirmed at checkout.' },
  sparkfun: { name: 'SparkFun', homepage: 'https://www.sparkfun.com', liveApi: 'none', note: 'Alternate source for many breakouts. Prices recorded as estimates.' },
  seeed: { name: 'Seeed Studio', homepage: 'https://www.seeedstudio.com', liveApi: 'none', note: 'Grove modules and XIAO boards. Prices recorded as estimates.' },
  generic: { name: 'Generic', homepage: '', liveApi: 'none', note: 'Commodity parts available from many suppliers; any equivalent spec is acceptable.' },
}
