import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { config } from '../config.js'
import { requireUser } from '../middleware/auth.js'
import { HttpError, parse } from '../middleware/errors.js'
import { Trip } from '../models/Trip.js'

const message = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8000),
  at: z.string().max(40).optional(),
})

/** What the planner sends: the whole conversation so far, the chat session, the latest plan and the picks. */
const snapshot = z.object({
  messages: z.array(message).max(config.maxMessages).optional(),
  session: z.record(z.string(), z.unknown()).nullable().optional(),
  plan: z.record(z.string(), z.unknown()).nullable().optional(),
  selection: z.record(z.string(), z.unknown()).nullable().optional(),
})

const tripUpdate = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  favorite: z.boolean().optional(),
  notes: z.string().max(4000).optional(),
  status: z.enum(['planning', 'planned', 'archived']).optional(),
})

const listQuery = z.object({
  search: z.string().trim().max(80).optional(),
  favorite: z.enum(['true', 'false']).optional(),
  status: z.enum(['planning', 'planned', 'archived', 'active']).optional(),
  sort: z.enum(['recent', 'oldest', 'budget', 'name']).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hashPlan = (plan) => createHash('sha1').update(JSON.stringify(plan)).digest('hex')

function parseDate(value) {
  const date = value ? new Date(value) : new Date()
  return Number.isNaN(date.getTime()) ? new Date() : date
}

/** Applies a planner snapshot: messages, session and picks are replaced; a plan not seen before becomes a new version. */
function applySnapshot(trip, data) {
  if (data.messages) {
    trip.messages = data.messages.slice(-config.maxMessages).map((m) => ({ role: m.role, content: m.content, at: parseDate(m.at) }))
    if (!trip.firstPrompt) trip.firstPrompt = data.messages.find((m) => m.role === 'user')?.content.slice(0, 2000) ?? ''
  }
  if (data.session !== undefined) trip.session = data.session
  if (data.selection !== undefined) trip.selection = data.selection
  const request = (trip.session && typeof trip.session.request === 'object' && trip.session.request) || {}
  if (data.plan) {
    const hash = hashPlan(data.plan)
    if (trip.versions.at(-1)?.hash !== hash) {
      const plan = data.plan
      const rate = Number(plan.usd_to_display) || 1
      const lastPrompt = [...(data.messages ?? trip.messages)].reverse().find((m) => m.role === 'user')?.content ?? ''
      trip.versions.push({
        plan,
        hash,
        prompt: lastPrompt.slice(0, 2000),
        estimatedCost: typeof plan.estimated_cost === 'number' ? Math.round(plan.estimated_cost * rate) : null,
        currency: String(plan.display_currency || 'USD'),
      })
      if (trip.versions.length > config.maxVersions) trip.versions.splice(0, trip.versions.length - config.maxVersions)
      if (trip.status !== 'archived') trip.status = 'planned'
    }
    summarise(trip, data.plan)
  } else if (!trip.versions.length) {
    summarise(trip, {
      origin: request.origin,
      destination: request.destination,
      cities: request.cities,
      duration: { days: request.duration_days },
      dates: { start_date: request.start_date },
      travelers: request.travelers,
    })
  }
}

function summarise(trip, plan) {
  trip.origin = String(plan.origin || trip.origin || '')
  trip.destination = String(plan.destination || trip.destination || '')
  trip.cities = Array.isArray(plan.cities) ? plan.cities.filter((c) => typeof c === 'string').slice(0, 10) : trip.cities
  trip.durationDays = Number(plan.duration?.days) || trip.durationDays || null
  trip.startDate = String(plan.dates?.start_date || trip.startDate || '')
  trip.travelers = Number(plan.travelers) || trip.travelers || null
  const latest = trip.versions.at(-1)
  if (latest) {
    trip.estimatedCost = latest.estimatedCost
    trip.currency = latest.currency
  }
  if (!trip.customTitle) {
    const where = trip.destination && trip.destination !== 'Multi-city' ? trip.destination : trip.cities.join(', ')
    trip.title = where ? `${where}${trip.durationDays ? ` · ${trip.durationDays} days` : ''}` : 'New trip'
  }
}

function detail(trip) {
  const latest = trip.versions.at(-1)
  return {
    ...trip.toSummary(),
    notes: trip.notes,
    messages: trip.messages.map((m) => ({ role: m.role, content: m.content, at: m.at })),
    session: trip.session,
    selection: trip.selection,
    plan: latest?.plan ?? null,
    versionList: trip.versions.map((v, index) => ({
      id: v._id.toString(),
      number: index + 1,
      prompt: v.prompt,
      estimatedCost: v.estimatedCost,
      currency: v.currency,
      createdAt: v.createdAt,
    })),
    share: { enabled: !!trip.share?.enabled, url: trip.share?.enabled && trip.share.id ? `${config.appUrl}/share/${trip.share.id}` : null },
  }
}

export function tripRoutes({ identity }) {
  const router = Router()
  router.use(requireUser(identity))

  const own = async (req) => {
    const trip = await Trip.findOne({ _id: req.params.id, user: req.user._id })
    if (!trip) throw new HttpError(404, 'Trip not found.')
    return trip
  }

  router.get('/', async (req, res) => {
    const q = parse(listQuery, req.query)
    const filter = { user: req.user._id }
    if (q.favorite === 'true') filter.favorite = true
    if (q.status === 'active') filter.status = { $ne: 'archived' }
    else if (q.status) filter.status = q.status
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), 'i')
      filter.$or = [{ title: rx }, { destination: rx }, { origin: rx }, { cities: rx }, { firstPrompt: rx }]
    }
    const sort = { recent: { updatedAt: -1 }, oldest: { createdAt: 1 }, budget: { estimatedCost: -1 }, name: { title: 1 } }[q.sort ?? 'recent']
    const limit = q.limit ?? 20
    const page = q.page ?? 1
    const [items, total] = await Promise.all([
      Trip.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).select('-session -selection -versions.plan -messages.content -notes'),
      Trip.countDocuments(filter),
    ])
    res.json({ trips: items.map((t) => t.toSummary()), total, page, pages: Math.max(1, Math.ceil(total / limit)) })
  })

  router.post('/', async (req, res) => {
    const data = parse(snapshot, req.body)
    const trip = new Trip({ user: req.user._id })
    applySnapshot(trip, data)
    await trip.save()
    res.status(201).json({ trip: detail(trip) })
  })

  router.get('/:id', async (req, res) => res.json({ trip: detail(await own(req)) }))

  router.get('/:id/versions/:versionId', async (req, res) => {
    const trip = await own(req)
    const version = trip.versions.id(req.params.versionId)
    if (!version) throw new HttpError(404, 'That version of the plan was not found.')
    res.json({ version: { id: version._id.toString(), prompt: version.prompt, createdAt: version.createdAt, plan: version.plan } })
  })

  router.put('/:id/sync', async (req, res) => {
    const data = parse(snapshot, req.body)
    const trip = await own(req)
    applySnapshot(trip, data)
    await trip.save()
    res.json({ trip: trip.toSummary() })
  })

  router.patch('/:id', async (req, res) => {
    const body = parse(tripUpdate, req.body)
    const trip = await own(req)
    if (body.title !== undefined) {
      trip.title = body.title
      trip.customTitle = true
    }
    if (body.favorite !== undefined) trip.favorite = body.favorite
    if (body.notes !== undefined) trip.notes = body.notes
    if (body.status !== undefined) trip.status = body.status === 'archived' ? 'archived' : trip.versions.length ? 'planned' : 'planning'
    await trip.save()
    res.json({ trip: trip.toSummary() })
  })

  router.delete('/:id', async (req, res) => {
    const trip = await own(req)
    await trip.deleteOne()
    res.json({ deleted: true })
  })

  /** Whether the trip is shared, and its link (the share dialog opens with this). */
  router.get('/:id/share', async (req, res) => {
    const trip = await own(req)
    const enabled = !!(trip.share?.enabled && trip.share.id)
    res.json({ share: { enabled, url: enabled ? `${config.appUrl}/share/${trip.share.id}` : null, canShare: trip.versions.length > 0 } })
  })

  router.post('/:id/share', async (req, res) => {
    const trip = await own(req)
    if (!trip.versions.length) throw new HttpError(400, 'Plan the trip first, then share it.')
    if (!trip.share?.id) trip.share = { id: randomBytes(9).toString('base64url'), enabled: true, createdAt: new Date() }
    else trip.share.enabled = true
    await trip.save()
    res.json({ share: { enabled: true, url: `${config.appUrl}/share/${trip.share.id}` } })
  })

  router.delete('/:id/share', async (req, res) => {
    const trip = await own(req)
    if (trip.share) trip.share.enabled = false
    await trip.save()
    res.json({ share: { enabled: false, url: null } })
  })

  return router
}
