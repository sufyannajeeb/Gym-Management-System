const express = require('express');
const Trainer = require('../models/trainermodel');
const User = require('../models/usermodel');
const Login = require('../models/loginmodel');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');
const { phoneError } = require('../utils/phone');

const router = express.Router();

// Salary and hire date are internal details that only admins should see.
const forRequest = (req, trainer) => {
  const plain = typeof trainer.toObject === 'function' ? trainer.toObject() : { ...trainer };
  if (req.user?.role !== 'admin') {
    delete plain.salary;
    delete plain.hireDate;
  }
  return plain;
};

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.available === 'true') filter.isAvailable = true;
    if (req.query.specialization) filter.specialization = req.query.specialization;

    const trainers = await Trainer.find(filter)
      .populate('user', 'fullName email phone role')
      .sort({ hireDate: -1 });
    res.json(trainers.map((trainer) => forRequest(req, trainer)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const trainer = await Trainer.findById(req.params.id).populate(
      'user',
      'fullName email phone role'
    );
    if (!trainer) return res.status(404).json({ message: 'Trainer not found' });
    return res.json(forRequest(req, trainer));
  } catch (err) {
    return next(err);
  }
});

// Admins can either pass an existing `user` id, or full account details
// (fullName/email/password) and a trainer account is created for them.
router.post('/', protect, adminOnly, async (req, res, next) => {
  try {
    const { fullName, email, password, phone, ...trainerFields } = req.body;

    const phoneIssue = phoneError(phone);
    if (phoneIssue) {
      return res.status(400).json({ message: phoneIssue });
    }

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

    const phoneIssue = phoneError(phone);
    if (phoneIssue) {
      return res.status(400).json({ message: phoneIssue });
    }

    const existing = await Trainer.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Trainer not found' });

    const trainer = await Trainer.findByIdAndUpdate(req.params.id, trainerFields, {
      new: true,
      runValidators: true,
    });

    let account = existing.user ? await User.findById(existing.user) : null;

    const userUpdate = {};
    if (fullName) userUpdate.fullName = String(fullName).trim();
    if (email) userUpdate.email = String(email).toLowerCase().trim();
    if (phone !== undefined) userUpdate.phone = phone;

    if (account) {
      if (userUpdate.email) {
        const clash = await User.findOne({
          email: userUpdate.email,
          _id: { $ne: account._id },
        });
        if (clash) return res.status(400).json({ message: 'Email already in use' });
      }
      if (Object.keys(userUpdate).length > 0) {
        Object.assign(account, userUpdate);
        await account.save();
      }
    } else if (email) {
      // The trainer is orphaned (its linked user no longer exists). Recreate the
      // account so the name/email can actually be stored and displayed.
      const lowerEmail = String(email).toLowerCase().trim();
      account = await User.findOne({ email: lowerEmail });
      if (account) {
        if (fullName) {
          account.fullName = String(fullName).trim();
          await account.save();
        }
      } else {
        account = await User.create({
          fullName: fullName || `Trainer ${existing.employeeCode}`,
          email: lowerEmail,
          phone,
          role: 'trainer',
        });
      }
      trainer.user = account._id;
      await trainer.save();
    }

    if (password && account) {
      let credential = await Login.findOne({ user: account._id });
      if (credential) {
        credential.password = password;
        await credential.save();
      } else {
        await Login.create({ user: account._id, email: account.email, password });
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