const express = require('express');
const Member = require('../models/membermodel');
const User = require('../models/usermodel');
const Login = require('../models/loginmodel');
const { protect, adminOnly } = require('../middleware/auth');

const router = express.Router();

const MEMBER_STATUSES = ['active', 'inactive', 'suspended', 'expired'];

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && MEMBER_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const members = await Member.find(filter)
      .populate('user', 'fullName email phone')
      .populate('membership', 'name price durationDays')
      .populate('trainer', 'employeeCode specialization')
      .sort({ joinDate: -1 });
    res.json(members);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id)
      .populate('user', 'fullName email phone')
      .populate('membership', 'name price durationDays features')
      .populate('trainer', 'employeeCode specialization user');
    if (!member) return res.status(404).json({ message: 'Member not found' });
    return res.json(member);
  } catch (err) {
    return next(err);
  }
});

// Admins can either pass an existing `user` id, or full account details
// (fullName/email/password) and a member account is created for them.
router.post('/', protect, adminOnly, async (req, res, next) => {
  try {
    const { fullName, email, password, phone, ...memberFields } = req.body;

    let userId = memberFields.user;

    if (email && password) {
      const lowerEmail = String(email).toLowerCase();
      let account = await User.findOne({ email: lowerEmail });

      if (!account) {
        account = await User.create({
          fullName,
          email: lowerEmail,
          phone,
          role: 'member',
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

      const existingMember = await Member.findOne({ user: account._id });
      if (existingMember) {
        return res.status(400).json({ message: 'That user is already a member' });
      }

      userId = account._id;
    }

    if (!userId) {
      return res
        .status(400)
        .json({ message: 'Provide an existing user id or email + password' });
    }

    const member = await Member.create({ ...memberFields, user: userId });
    res.status(201).json(await member.populate('user', 'fullName email phone'));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const { fullName, email, phone, ...memberFields } = req.body;

    const existing = await Member.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Member not found' });

    const member = await Member.findByIdAndUpdate(req.params.id, memberFields, {
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

    return res.json(
      await member.populate([
        { path: 'user', select: 'fullName email phone' },
        { path: 'membership', select: 'name price durationDays' },
        { path: 'trainer', select: 'employeeCode specialization' },
      ])
    );
  } catch (err) {
    return next(err);
  }
});

router.patch('/:id/status', protect, adminOnly, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!MEMBER_STATUSES.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${MEMBER_STATUSES.join(', ')}` });
    }
    const member = await Member.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!member) return res.status(404).json({ message: 'Member not found' });
    return res.json(member);
  } catch (err) {
    return next(err);
  }
});

router.delete('/:id', protect, adminOnly, async (req, res, next) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    return res.json({ message: 'Member deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;