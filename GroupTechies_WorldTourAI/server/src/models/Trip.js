import mongoose from 'mongoose'

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true, maxlength: 8000 },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
)

// Every itinerary the planner produced for this trip: the first plan and each re-plan after a change.
const versionSchema = new mongoose.Schema(
  {
    plan: { type: mongoose.Schema.Types.Mixed, required: true },
    hash: { type: String, required: true },
    prompt: { type: String, default: '', maxlength: 2000 },
    estimatedCost: { type: Number, default: null }, // in the plan's display currency
    currency: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
)

const tripSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 120, default: 'New trip' },
    customTitle: { type: Boolean, default: false },
    firstPrompt: { type: String, default: '', maxlength: 2000 },
    // Searchable summary, refreshed from the latest plan.
    origin: { type: String, default: '' },
    destination: { type: String, default: '' },
    cities: { type: [String], default: [] },
    durationDays: { type: Number, default: null },
    startDate: { type: String, default: '' },
    travelers: { type: Number, default: null },
    estimatedCost: { type: Number, default: null },
    currency: { type: String, default: '' },
    status: { type: String, enum: ['planning', 'planned', 'archived'], default: 'planning' },
    favorite: { type: Boolean, default: false },
    notes: { type: String, default: '', maxlength: 4000 },
    messages: { type: [messageSchema], default: [] },
    versions: { type: [versionSchema], default: [] },
    // The chat session (lets the traveler continue the conversation) and their package/flight/hotel picks.
    session: { type: mongoose.Schema.Types.Mixed, default: null },
    selection: { type: mongoose.Schema.Types.Mixed, default: null },
    share: {
      id: { type: String, default: undefined },
      enabled: { type: Boolean, default: false },
      createdAt: { type: Date, default: null },
    },
  },
  { timestamps: true, minimize: false },
)

tripSchema.index({ user: 1, updatedAt: -1 })
tripSchema.index({ 'share.id': 1 }, { unique: true, sparse: true })

tripSchema.methods.toSummary = function toSummary() {
  const latest = this.versions.at(-1)
  return {
    id: this._id.toString(),
    title: this.title,
    firstPrompt: this.firstPrompt,
    origin: this.origin,
    destination: this.destination,
    cities: this.cities,
    durationDays: this.durationDays,
    startDate: this.startDate,
    travelers: this.travelers,
    estimatedCost: this.estimatedCost,
    currency: this.currency,
    status: this.status,
    favorite: this.favorite,
    versions: this.versions.length,
    messages: this.messages.length,
    shared: !!this.share?.enabled,
    lastPlannedAt: latest?.createdAt ?? null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  }
}

export const Trip = mongoose.models.Trip || mongoose.model('Trip', tripSchema)
