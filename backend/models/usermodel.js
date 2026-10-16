const mongoose = require('mongoose');
const { normalizePhone, isValidPhone, PHONE_MESSAGE } = require('../utils/phone');

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    role: {
      type: String,
      enum: ['admin', 'staff', 'trainer', 'member'],
      default: 'member',
    },
    phone: {
      type: String,
      trim: true,
      set: normalizePhone,
      validate: { validator: isValidPhone, message: PHONE_MESSAGE },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);