// One MongoDB connection, reused across requests (and across warm Vercel invocations).
import mongoose from 'mongoose'
import { config } from './config.js'

mongoose.set('strictQuery', true)

let pending = null

// A dropped connection (Atlas idle timeout, rotated password, cold serverless instance) must be
// re-established, not answered with the earlier "connected" promise.
mongoose.connection.on('disconnected', () => {
  pending = null
})

export async function connectDatabase(uri = config.mongoUri) {
  if (mongoose.connection.readyState === 1) return mongoose.connection
  if (!uri) throw Object.assign(new Error('The database is not configured (MONGODB_URI is empty).'), { status: 503 })
  if (pending && mongoose.connection.readyState === 0) pending = null
  if (!pending) {
    pending = mongoose
      .connect(uri, { serverSelectionTimeoutMS: 8000, maxPoolSize: 5 })
      .then(() => mongoose.connection)
      .catch((error) => {
        pending = null
        throw Object.assign(new Error(`Could not reach the database: ${error.message}`), { status: 503 })
      })
  }
  return pending
}

export function databaseState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown'
}

export async function disconnectDatabase() {
  pending = null
  await mongoose.disconnect()
}
