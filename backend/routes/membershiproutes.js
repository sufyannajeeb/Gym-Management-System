const express = require('express');
const Membership = require('../models/membershipmodel');
const Member = require('../models/membermodel');
const { protect, adminOnly } = require('../middleware/auth');
const {
  assertPlanSwitchAllowed,
  formatEligibleDate,
} = require('../utils/planSwitch');

const router = express.Router();

// Authenticated member chooses (or switches) their own membership plan.
const chooseMembership = async (req, res, next, membershipId) => {
  try {
    const membership = await Membership.findById(membershipId);
    if (!membership || membership.isActive === false) {
      return res.status(404).json({ message: 'Membership plan not found' });
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    let member = await Member.findOne({ user: userId });
    if (!member) {
      member = new Member({ user: userId, status: 'active', joinDate: new Date() });
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
};

router.post('/choose', protect, async (req, res, next) => {
  const membershipId =
    req.body?.membership ||
    req.body?.membershipId ||
    req.body?.membership_id ||
    req.body?.plan ||
    req.body?.planId;
  return chooseMembership(req, res, next, membershipId);
});

router.post('/:id/choose', protect, async (req, res, next) => {
  return chooseMembership(req, res, next, req.params.id);
});

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
