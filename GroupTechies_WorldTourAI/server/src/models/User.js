import mongoose from 'mongoose'

// Passwords are never stored here: Clerk keeps them (hashed) and handles sign-in.
const userSchema = new mongoose.Schema(
  {
    clerkId: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, trim: true, maxlength: 120, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 254, default: '' },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    photo: {
      url: { type: String, default: '' },
      publicId: { type: String, default: '' },
    },
    onboarded: { type: Boolean, default: false },
    preferences: {
      homeCity: { type: String, trim: true, maxlength: 80, default: '' },
      currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: '' },
      language: { type: String, enum: ['en', 'hi', 'gu', 'mr'], default: 'en' },
      theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' },
      readAloud: { type: Boolean, default: false },
    },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
)

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    fullName: this.fullName,
    email: this.email,
    phone: this.phone,
    photoUrl: this.photo?.url || '',
    onboarded: this.onboarded,
    preferences: {
      homeCity: this.preferences?.homeCity ?? '',
      currency: this.preferences?.currency ?? '',
      language: this.preferences?.language ?? 'en',
      theme: this.preferences?.theme ?? 'system',
      readAloud: !!this.preferences?.readAloud,
    },
    memberSince: this.createdAt,
  }
}

export const User = mongoose.models.User || mongoose.model('User', userSchema)
