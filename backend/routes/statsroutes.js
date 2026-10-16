const express = require('express');
const Member = require('../models/membermodel');
const Trainer = require('../models/trainermodel');
const Membership = require('../models/membershipmodel');
const User = require('../models/usermodel');
const Order = require('../models/ordermodel');

const router = express.Router();

const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);

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

    // ---- Revenue ----

    // Plans assigned to members: each assigned membership plan contributes its price.
    const assignedPlans = await Member.find({ membership: { $ne: null } }).populate(
      'membership',
      'name price'
    );
    const planRevenue = sum(assignedPlans.map((member) => member.membership?.price));

    // Gym products sold through the store. Cancelled orders are not counted.
    const paidOrders = await Order.find({ status: { $ne: 'cancelled' } }).select(
      'total status deliveredAt readyAt createdAt'
    );
    const storeRevenue = sum(paidOrders.map((order) => order.total));
    const deliveredOrders = paidOrders.filter((order) => order.status === 'delivered').length;

    const totalRevenue = planRevenue + storeRevenue;

    // ---- Monthly trend (last 6 months) for the graph view ----
    const monthKey = (value) => {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    };
    const now = new Date();
    const buckets = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      buckets.push({
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleString('en', { month: 'short' }),
        storeRevenue: 0,
        newMembers: 0,
      });
    }
    const bucketByKey = Object.fromEntries(buckets.map((bucket) => [bucket.key, bucket]));

    for (const order of paidOrders) {
      const bucket = bucketByKey[monthKey(order.createdAt)];
      if (bucket) bucket.storeRevenue += Number(order.total) || 0;
    }

    const memberDates = await Member.find().select('joinDate');
    for (const member of memberDates) {
      const bucket = bucketByKey[monthKey(member.joinDate)];
      if (bucket) bucket.newMembers += 1;
    }

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
      // Revenue breakdown
      planRevenue,
      planMemberCount: assignedPlans.length,
      storeRevenue,
      orderCount: paidOrders.length,
      deliveredOrders,
      totalRevenue,
      monthly: buckets,
      recentMembers,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
