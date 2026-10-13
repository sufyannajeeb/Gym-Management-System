const mongoose = require('mongoose');

const trainerSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    employeeCode: {
      type: String,
      required: [true, 'Employee code is required'],
      unique: true,
      trim: true,
    },
    specialization: {
      type: [String],
      trim: true,
      default: [],
    },
    hireDate: {
      type: Date,
      required: true,
      default: Date.now,
    },
    salary: {
      type: Number,
      min: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    schedule: [
      {
        day: {
          type: String,
          enum: [
            'Monday',
            'Tuesday',
            'Wednesday',
            'Thursday',
            'Friday',
            'Saturday',
            'Sunday',
          ],
        },
        startTime: { type: String, match: [/^([01]\d|2[0-3]):[0-5]\d$/] },
        endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      },
    ],
  },
  { timestamps: true }
);

trainerSchema.index({ specialization: 1 });

module.exports = mongoose.model('Trainer', trainerSchema);