// Local development: `npm run dev` (reads server/.env). On Vercel the default export is used instead
// and nothing listens on a port.
import app from './app.js'
import { config } from './config.js'

if (!process.env.VERCEL) {
  app.listen(config.port, () => {
    console.log(`WorldTour accounts API on http://localhost:${config.port} (health: /api/health)`)
  })
}

export default app
