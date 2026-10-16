const mongoose = require('mongoose');
const { normalizePhone, isValidPhone, PHONE_MESSAGE } = require('../utils/phone');

const memberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    membership: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Membership',
    },
    // When the current plan was chosen/switched. Used to lock plan switching
    // until the current plan's duration has elapsed.
    planStartedAt: {
      type: Date,
    },
    joinDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'expired'],
      default: 'active',
    },
    trainer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trainer',
    },
    emergencyContact: {
      name: { type: String, trim: true },
      phone: {
        type: String,
        trim: true,
        set: normalizePhone,
        validate: { validator: isValidPhone, message: PHONE_MESSAGE },
      },
      relation: { type: String, trim: true },
    },
    medicalNotes: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    address: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

memberSchema.index({ status: 1, joinDate: -1 });

memberSchema.virtual('isCurrentlyActive').get(function isCurrentlyActive() {
  return this.status === 'active';
});

// The date a member is allowed to switch to a different plan. A plan is locked
// for its own duration (e.g. a 30-day plan for about a month, an annual plan
// for a year). Requires `membership` to be populated with `durationDays`.
memberSchema.virtual('planSwitchEligibleAt').get(function planSwitchEligibleAt() {
  if (!this.membership || !this.membership.durationDays) return null;
  const start = this.planStartedAt || this.joinDate;
  if (!start) return null;
  const date = new Date(start);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.max(Number(this.membership.durationDays) || 0, 1);
  date.setDate(date.getDate() + days);
  return date;
});

// Whether the member may switch plans right now.
memberSchema.virtual('canSwitchPlan').get(function canSwitchPlan() {
  const eligibleAt = this.planSwitchEligibleAt;
  if (!eligibleAt) return true;
  return Date.now() >= new Date(eligibleAt).getTime();
});

memberSchema.set('toJSON', { virtuals: true });
memberSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Member', memberSchema);