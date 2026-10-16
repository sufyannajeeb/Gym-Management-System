const express = require('express');
const Member = require('../models/membermodel');
const User = require('../models/usermodel');
const Login = require('../models/loginmodel');
const { protect, adminOnly } = require('../middleware/auth');
const { assertPlanSwitchAllowed, formatEligibleDate } = require('../utils/planSwitch');
const { phoneError } = require('../utils/phone');

const router = express.Router();

const MEMBER_STATUSES = ['active', 'inactive', 'suspended', 'expired'];

const planSwitchBlocked = (res, blocked) =>
  res.status(403).json({
    message: `You can switch plans after ${formatEligibleDate(
      blocked.eligibleAt
    )}. Your current plan must finish first.`,
    eligibleAt: blocked.eligibleAt,
    canSwitchPlan: false,
  });

router.get('/', async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && MEMBER_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const members = await Member.find(filter)
      .populate('user', 'fullName email phone')
      .populate('membership', 'name price durationDays')
      .populate({
        path: 'trainer',
        select: 'employeeCode specialization user',
        populate: { path: 'user', select: 'fullName email phone' },
      })
      .sort({ joinDate: -1 });
    res.json(members);
  } catch (err) {
    next(err);
  }
});

// Current user's own member profile (get or assign membership/trainer? user only membership).
router.get('/me', protect, async (req, res, next) => {
  try {
    const member = await Member.findOne({ user: req.user.id })
      .populate('user', 'fullName email phone')
      .populate('membership', 'name price durationDays features sessionsPerWeek description')
      .populate({ path: 'trainer', select: 'employeeCode specialization user', populate: { path: 'user', select: 'fullName email phone' } });
    if (!member) return res.status(404).json({ message: 'No membership found' });
    return res.json(member);
  } catch (err) {
    return next(err);
  }
});

router.put('/me', protect, async (req, res, next) => {
  try {
    const membershipId =
      req.body?.membership ||
      req.body?.membershipId ||
      req.body?.membership_id ||
      req.body?.plan ||
      req.body?.planId;

    let member = await Member.findOne({ user: req.user.id });
    if (!member) member = new Member({ user: req.user.id, status: 'active', joinDate: new Date() });

    if (membershipId) {
      const membership = await (require('../models/membershipmodel')).findById(membershipId);
      if (!membership || membership.isActive === false) {
        return res.status(404).json({ message: 'Membership plan not found' });
      }
      const blocked = await assertPlanSwitchAllowed(member, membership._id);
      if (blocked) return planSwitchBlocked(res, blocked);
      // Only restart the switch lock when the plan actually changes.
      if (String(member.membership || '') !== String(membership._id)) {
        member.planStartedAt = new Date();
      }
      member.membership = membership._id;
    }

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

router.post('/choose-membership', protect, async (req, res, next) => {
  try {
    const membershipId =
      req.body?.membership ||
      req.body?.membershipId ||
      req.body?.membership_id ||
      req.body?.plan ||
      req.body?.planId;

    const MembershipModel = require('../models/membershipmodel');
    const membership = await MembershipModel.findById(membershipId);
    if (!membership || membership.isActive === false) {
      return res.status(404).json({ message: 'Membership plan not found' });
    }

    let member = await Member.findOne({ user: req.user.id });
    if (!member) member = new Member({ user: req.user.id, status: 'active', joinDate: new Date() });

    const blocked = await assertPlanSwitchAllowed(member, membership._id);
    if (blocked) return planSwitchBlocked(res, blocked);

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

router.get('/:id', async (req, res, next) => {
  try {
    const member = await Member.findById(req.params.id)
      .populate('user', 'fullName email phone')
      .populate('membership', 'name price durationDays features')
      .populate({ path: 'trainer', select: 'employeeCode specialization user', populate: { path: 'user', select: 'fullName email phone' } });
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

    // Reject bad phone numbers before creating the account + member profile so
    // we never leave a half-created record behind.
    const phoneIssue =
      phoneError(phone) || phoneError(memberFields.emergencyContact?.phone);
    if (phoneIssue) {
      return res.status(400).json({ message: phoneIssue });
    }

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

    const phoneIssue =
      phoneError(phone) || phoneError(memberFields.emergencyContact?.phone);
    if (phoneIssue) {
      return res.status(400).json({ message: phoneIssue });
    }

    const existing = await Member.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Member not found' });

    if (
      memberFields.membership !== undefined &&
      String(memberFields.membership || '') !== String(existing.membership || '')
    ) {
      memberFields.planStartedAt = new Date();
    }

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
        {
          path: 'trainer',
          select: 'employeeCode specialization user',
          populate: { path: 'user', select: 'fullName email phone' },
        },
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
