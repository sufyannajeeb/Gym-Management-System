const express = require('express');
const ContactMessage = require('../models/contactmodel');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

// Public: the "Get In Touch" form and the newsletter box on every page.
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, message, topic, type } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const saved = await ContactMessage.create({
      name,
      email,
      phone,
      message,
      topic: topic || type || 'contact',
    });

    return res.status(201).json({
      message: 'Thanks, we received your message.',
      id: saved._id,
    });
  } catch (err) {
    return next(err);
  }
});

// Admin: read the inbox.
router.get('/', protect, adminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.topic) filter.topic = req.query.topic;
    const messages = await ContactMessage.find(filter).sort({ createdAt: -1 }).limit(100);
    res.json(messages);
  } catch (err) {
    next(err);
  }
});

// Admin: mark as handled / delete.
router.patch('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const message = await ContactMessage.findByIdAndUpdate(
      req.params.id,
      { handled: req.body.handled !== false },
      { new: true, runValidators: true }
    );
    if (!message) return res.status(404).json({ message: 'Message not found' });
    return res.json(message);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const message = await ContactMessage.findByIdAndDelete(req.params.id);
    if (!message) return res.status(404).json({ message: 'Message not found' });
    return res.json({ message: 'Message deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
