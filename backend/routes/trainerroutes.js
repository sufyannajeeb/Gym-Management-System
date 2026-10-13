const express = require('express');
const Trainer = require('../models/trainermodel');
const User = require('../models/usermodel');
const Login = require('../models/loginmodel');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.available === 'true') filter.isAvailable = true;
    if (req.query.specialization) filter.specialization = req.query.specialization;

    const trainers = await Trainer.find(filter)
      .populate('user', 'fullName email phone role')
      .sort({ hireDate: -1 });
    res.json(trainers);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const trainer = await Trainer.findById(req.params.id).populate(
      'user',
      'fullName email phone role'
    );
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' });
    return res.json(trainer);
  } catch (err) {
    return next(err);
  }
});

// Admins can either pass an existing `user` id, or full account details
// (fullName/email/password) and a trainer account is created for them.
router.post('/', protect, adminOnly, async (req, res, next) => {
  try {
    const { fullName, email, password, phone, ...trainerFields } = req.body;

    let userId = trainerFields.user;

    if (email && password) {
      const lowerEmail = String(email).toLowerCase();
      let account = await User.findOne({ email: lowerEmail });

      if (!account) {
        account = await User.create({
          fullName,
          email: lowerEmail,
          phone,
          role: 'trainer',
        });
        try {
          await Login.create({ user: account._id, email: lowerEmail, password });
        } catch (err) {
          await User.deleteOne({ _id: account._id });
          return next(err);
        }
      } else {
        const existingLogin = await Login.findOne({ user: account._id });
        if (!existingLogin) {
          await Login.create({ user: account._id, email: lowerEmail, password });
        }
      }

      const existingTrainer = await Trainer.findOne({ user: account._id });
      if (existingTrainer) {
        return res.status(400).json({ message: 'That user already has a trainer profile' });
      }

      userId = account._id;
    }

    if (!userId) {
      return res
        .status(400)
        .json({ message: 'Provide an existing user id or email + password' });
    }

    const trainer = await Trainer.create({ ...trainerFields, user: userId });
    res.status(201).json(await trainer.populate('user', 'fullName email phone role'));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const { fullName, email, phone, password, ...trainerFields } = req.body;

    const existing = await Trainer.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Trainer not found' });

    const trainer = await Trainer.findByIdAndUpdate(req.params.id, trainerFields, {
      new: true,
      runValidators: true,
    });

    const userUpdate = {};
    if (fullName) userUpdate.fullName = String(fullName).trim();
    if (email) userUpdate.email = String(email).toLowerCase().trim();
    if (phone !== undefined) userUpdate.phone = phone;

    if (Object.keys(userUpdate).length > 0) {
      if (userUpdate.email) {
        const clash = await User.findOne({
          email: userUpdate.email,
          _id: { $ne: existing.user },
        });
        if (clash) return res.status(400).json({ message: 'Email already in use' });
      }
      await User.findByIdAndUpdate(existing.user, userUpdate, { runValidators: true });
    }

    if (password) {
      const account = await User.findById(existing.user);
      if (account) {
        let credential = await Login.findOne({ user: account._id });
        if (credential) {
          credential.password = password;
          await credential.save();
        } else {
          await Login.create({ user: account._id, email: account.email, password });
        }
      }
    }

    return res.json(await trainer.populate('user', 'fullName email phone role'));
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const trainer = await Trainer.findByIdAndDelete(req.params.id);
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' });
    return res.json({ message: 'Trainer deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;