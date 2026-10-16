const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/usermodel');
const Member = require('../models/membermodel');
const Membership = require('../models/membershipmodel');
const Trainer = require('../models/trainermodel');
const Login = require('../models/loginmodel');
const LoginAttempt = require('../models/loginattemptmodel');
const { signToken, protect, adminOnly, optionalAuth } = require('../middleware/auth');
const { assertPlanSwitchAllowed, formatEligibleDate } = require('../utils/planSwitch');
const { phoneError } = require('../utils/phone');

const router = express.Router();

const logAttempt = (req, user, success, failureReason) => {
  // The hardcoded fallback admin uses a non-ObjectId id, which the LoginAttempt
  // schema cannot store. Skip the user reference in that case.
  const userId =
    user?._id && mongoose.Types.ObjectId.isValid(user._id) ? user._id : undefined;
  return LoginAttempt.create({
    user: userId,
    email: String(req.body.email || '').toLowerCase(),
    success,
    failureReason,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch((err) => console.error('Login log failed:', err.message));
};

router.post('/register', optionalAuth, async (req, res, next) => {
  try {
    const { fullName, email, password, phone, role } = req.body;

    const phoneIssue = phoneError(phone);
    if (phoneIssue) {
      return res.status(400).json({ message: phoneIssue });
    }

    // Public signups are always members; only an authenticated admin can
    // create staff / trainer / admin accounts through this endpoint.
    const assignedRole = req.user?.role === 'admin' && role ? role : 'member';

    const exists = await User.findOne({ email: String(email).toLowerCase() });
    if (exists) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    const user = await User.create({ fullName, email, phone, role: assignedRole });

    try {
      await Login.create({
        user: user._id,
        email: String(email).toLowerCase(),
        password,
      });
    } catch (err) {
      await User.deleteOne({ _id: user._id });
      return next(err);
    }

    // Create an (empty) member profile so newly registered users show up in the
    // admin area right away. They choose a membership from the member module.
    if (assignedRole === 'member') {
      try {
        await Member.create({ user: user._id, status: 'active', joinDate: new Date() });
      } catch (err) {
        // Profile creation is best-effort; a missing profile is recovered on
        // demand by the "choose membership" flow.
        console.error('Member profile creation failed:', err.message);
      }
    }

    return res.status(201).json({
      token: signToken(user),
      user: user.toJSON(),
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').toLowerCase().trim();

    // Fallback for the requested admin credentials
    if (normalizedEmail === 'admin@gymfit.com' && password === 'admin1234') {
      const fallbackUser = {
        _id: 'admin-fallback-id',
        fullName: 'Site Admin',
        email: 'admin@gymfit.com',
        role: 'admin',
        isActive: true,
        toJSON() {
          return {
            _id: this._id,
            fullName: this.fullName,
            email: this.email,
            role: this.role,
            isActive: this.isActive,
          };
        },
      };
      await logAttempt(req, fallbackUser, true);
      return res.json({ token: signToken(fallbackUser), user: fallbackUser.toJSON() });
    }

    try {
      const user = await User.findOne({ email: normalizedEmail });
      if (!user) {
        await logAttempt(req, null, false, 'unknown-user');
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const login = await Login.findOne({ user: user._id }).select('+password');
      if (!login) {
        await logAttempt(req, user, false, 'invalid-credentials');
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const matches = await login.comparePassword(password);
      if (!matches) {
        await logAttempt(req, user, false, 'invalid-credentials');
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      if (!user.isActive) {
        await logAttempt(req, user, false, 'inactive-account');
        return res.status(403).json({ message: 'Account is inactive' });
      }

      await logAttempt(req, user, true);
      return res.json({ token: signToken(user), user: user.toJSON() });
    } catch (dbErr) {
      // If DB is unavailable, fall back to invalid credentials for non-admin users
      await logAttempt(req, null, false, 'db-error');
      return res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (err) {
    return next(err);
  }
});

router.get('/me', protect, async (req, res, next) => {
  try {
    // Fallback for admin user when DB is not available
    if (req.user.id === 'admin-fallback-id' && req.user.role === 'admin') {
      return res.json({
        _id: 'admin-fallback-id',
        fullName: 'Site Admin',
        email: 'admin@gymfit.com',
        role: 'admin',
        isActive: true,
      });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(user.toJSON());
  } catch (err) {
    // If DB error and it's the fallback admin
    if (req.user.id === 'admin-fallback-id' && req.user.role === 'admin') {
      return res.json({
        _id: 'admin-fallback-id',
        fullName: 'Site Admin',
        email: 'admin@gymfit.com',
        role: 'admin',
        isActive: true,
      });
    }
    return next(err);
  }
});

router.get('/users', protect, adminOnly, async (req, res, next) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get('/my/trainer', protect, async (req, res, next) => {
  try {
    const trainer = await Trainer.findOne({ user: req.user.id });
    if (!trainer) return res.status(404).json({ message: 'No trainer profile found' });
    return res.json(trainer);
  } catch (err) {
    return next(err);
  }
});

router.get('/my/membership', protect, async (req, res, next) => {
  try {
    const member = await Member.findOne({ user: req.user.id })
      .populate('membership')
      .populate({ path: 'trainer', select: 'employeeCode specialization user', populate: { path: 'user', select: 'fullName email phone' } });
    if (!member) return res.status(404).json({ message: 'No membership found' });
    return res.json(member);
  } catch (err) {
    return next(err);
  }
});

// Authenticated users choose/switch their own membership plan here.
router.post('/my/membership', protect, async (req, res, next) => {
  try {
    const membershipId =
      req.body?.membership ||
      req.body?.membershipId ||
      req.body?.membership_id ||
      req.body?.plan ||
      req.body?.planId;

    if (!membershipId) {
      return res.status(400).json({ message: 'Membership id is required' });
    }

    const membership = await Membership.findById(membershipId);
    if (!membership || membership.isActive === false) {
      return res.status(404).json({ message: 'Membership plan not found' });
    }

    let member = await Member.findOne({ user: req.user.id });
    if (!member) {
      member = new Member({ user: req.user.id, status: 'active', joinDate: new Date() });
    }

    const blocked = await assertPlanSwitchAllowed(member, membership._id);
    if (blocked) {
      return res.status(403).json({
        message: `You can switch plans after ${formatEligibleDate(
          blocked.eligibleAt
        )}. Your current plan must finish first.`,
        eligibleAt: blocked.eligibleAt,
        canSwitchPlan: false,
      });
    }

    if (String(member.membership || '') !== String(membership._id)) {
      member.planStartedAt = new Date();
    }
    member.membership = membership._id;
    if (!member.joinDate) member.joinDate = new Date();
    if (!member.status || member.status === 'expired') member.status = 'active';
    await member.save();

    const populated = await Member.findById(member._id)
      .populate('user', 'fullName email phone')
      .populate('membership', 'name price durationDays features sessionsPerWeek description')
      .populate({ path: 'trainer', select: 'employeeCode specialization user', populate: { path: 'user', select: 'fullName email phone' } });

    return res.json(populated);
  } catch (err) {
    return next(err);
  }
});

router.get('/login-attempts', protect, adminOnly, async (req, res, next) => {
  try {
    const attempts = await LoginAttempt.find().populate('user', 'fullName email').sort({ createdAt: -1 }).limit(50);
    res.json(attempts);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
