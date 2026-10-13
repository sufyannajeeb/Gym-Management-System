const mongoose = require('mongoose');

const loginAttemptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    success: {
      type: Boolean,
      required: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    userAgent: {
      type: String,
      trim: true,
    },
    failureReason: {
      type: String,
      enum: ['invalid-credentials', 'inactive-account', 'locked-account', 'unknown-user'],
    },
  },
  { timestamps: true }
);

loginAttemptSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema);