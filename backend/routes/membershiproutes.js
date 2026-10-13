const express = require('express');
const Membership = require('../models/membershipmodel');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const filter = req.query.all === 'true' ? {} : { isActive: true };
    const memberships = await Membership.find(filter).sort({ price: 1 });
    res.json(memberships);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const membership = await Membership.findById(req.params.id);
    if (!membership) return res.status(404).json({ message: 'Membership not found' });
    return res.json(membership);
  } catch (err) {
    return next(err);
  }
});

router.post('/', protect, adminOnly, async (req, res, next) => {
  try {
    const membership = await Membership.create(req.body);
    res.status(201).json(membership);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const membership = await Membership.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!membership) return res.status(404).json({ message: 'Membership not found' });
    return res.json(membership);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const membership = await Membership.findByIdAndDelete(req.params.id);
    if (!membership) return res.status(404).json({ message: 'Membership not found' });
    return res.json({ message: 'Membership deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;