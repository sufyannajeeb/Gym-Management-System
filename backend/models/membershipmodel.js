const mongoose = require('mongoose');

const membershipSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Membership name is required'],
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    durationDays: {
      type: Number,
      required: [true, 'Duration in days is required'],
      min: 1,
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: 0,
    },
    features: {
      type: [String],
      default: [],
    },
    sessionsPerWeek: {
      type: Number,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Membership', membershipSchema);