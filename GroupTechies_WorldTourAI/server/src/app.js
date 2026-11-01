import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { config } from './config.js'
import { clerkIdentity } from './lib/identity.js'
import { cloudinaryPhotos } from './lib/photos.js'
import { errorHandler, notFound } from './middleware/errors.js'
import { meRoutes } from './routes/me.js'
import { clerkWebhookRoute, healthRoute, shareRoute } from './routes/public.js'
import { statsRoutes } from './routes/stats.js'
import { tripRoutes } from './routes/trips.js'

/**
 * The WorldTour accounts API. identity (Clerk) and photos (Cloudinary) are passed in so tests can use fakes.
 */
export function createApp({ identity = clerkIdentity(), photos = cloudinaryPhotos() } = {}) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1) // behind Vercel's proxy: rate limits use the real client address

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(
    cors({
      origin(origin, done) {
        // Same-origin and server-to-server calls (no Origin header) are allowed; browsers only from our sites.
        done(null, !origin || config.allowedOrigins.includes(origin.replace(/\/$/, '')))
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  )
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes and try again.' } }))

  // The webhook needs the raw body to check Clerk's signature, so it comes before the JSON parser.
  app.use('/api/webhooks/clerk', express.raw({ type: 'application/json', limit: '1mb' }), clerkWebhookRoute({ photos }))

  app.use(express.json({ limit: '4mb' }))
  app.use(identity.middleware)

  app.get('/', (_req, res) => res.json({ name: 'WorldTour accounts API', health: '/api/health' }))
  app.use('/api/health', healthRoute())
  app.use('/api/share', shareRoute())
  app.use('/api/me', meRoutes({ identity, photos }))
  app.use('/api/trips', tripRoutes({ identity }))
  app.use('/api/stats', statsRoutes({ identity }))

  app.use(notFound)
  app.use(errorHandler)
  return app
}

// Vercel's Express support picks up this file (or src/server.js) by name and expects the app as the
// default export, so every entry it might choose serves the same app.
export default createApp()
