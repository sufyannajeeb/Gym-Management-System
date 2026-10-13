const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema(
  {
    // "contact" = Get In Touch form, "newsletter" = footer subscription
    topic: {
      type: String,
      enum: ['contact', 'newsletter'],
      default: 'contact',
    },
    name: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email'],
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 30,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    handled: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

contactSchema.index({ topic: 1, createdAt: -1 });

module.exports = mongoose.model('ContactMessage', contactSchema);
