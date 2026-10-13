const express = require('express');
const User = require('../models/usermodel');
const Member = require('../models/membermodel');
const Trainer = require('../models/trainermodel');
const Login = require('../models/loginmodel');
const LoginAttempt = require('../models/loginattemptmodel');
const { signToken, protect, adminOnly, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const logAttempt = (req, user, success, failureReason) =>
  LoginAttempt.create({
    user: user?._id,
    email: String(req.body.email || '').toLowerCase(),
    success,
    failureReason,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch((err) => console.error('Login log failed:', err.message));

router.post('/register', optionalAuth, async (req, res, next) => {
  try {
    const { fullName, email, password, phone, role } = req.body;

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
    const member = await Member.findOne({ user: req.user.id }).populate('membership');
    if (!member) return res.status(404).json({ message: 'No membership found' });
    return res.json(member);
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