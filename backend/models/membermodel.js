const mongoose = require('mongoose');

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
      phone: { type: String, trim: true },
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

module.exports = mongoose.model('Member', memberSchema);