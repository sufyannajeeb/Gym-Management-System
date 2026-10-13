const express = require('express');
const Member = require('../models/membermodel');
const Trainer = require('../models/trainermodel');
const Membership = require('../models/membershipmodel');
const User = require('../models/usermodel');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const [memberCount, activeMembers, trainerCount, availableTrainers, planCount, users] =
      await Promise.all([
        Member.countDocuments(),
        Member.countDocuments({ status: 'active' }),
        Trainer.countDocuments(),
        Trainer.countDocuments({ isAvailable: true }),
        Membership.countDocuments({ isActive: true }),
        User.countDocuments(),
      ]);

    const recentMembers = await Member.find()
      .populate('user', 'fullName email')
      .populate('membership', 'name')
      .sort({ joinDate: -1 })
      .limit(5);

    res.json({
      memberCount,
      activeMembers,
      trainerCount,
      availableTrainers,
      planCount,
      userCount: users,
      recentMembers,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;