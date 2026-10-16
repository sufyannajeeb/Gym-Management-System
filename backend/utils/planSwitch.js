const Membership = require('../models/membershipmodel');

// A member may only switch to a different plan once their current plan's
// duration has elapsed (e.g. about a month for a 30-day plan, a year for an
// annual plan). Returns the date switching becomes available.
const getPlanSwitchStatus = async (member) => {
  if (!member || !member.membership) {
    return { eligibleAt: null, locked: false };
  }

  let plan = member.membership;
  if (!plan.durationDays) {
    plan = await Membership.findById(plan._id || plan);
  }
  if (!plan || !plan.durationDays) {
    return { eligibleAt: null, locked: false };
  }

  const start = member.planStartedAt || member.joinDate;
  if (!start) return { eligibleAt: null, locked: false };

  const eligibleAt = new Date(start);
  if (Number.isNaN(eligibleAt.getTime())) return { eligibleAt: null, locked: false };
  eligibleAt.setDate(eligibleAt.getDate() + Math.max(Number(plan.durationDays) || 0, 1));

  return { eligibleAt, locked: Date.now() < eligibleAt.getTime() };
};

// Returns `null` when the switch is allowed, otherwise an object describing
// when the member will be allowed to switch (for a friendly 403 response).
const assertPlanSwitchAllowed = async (member, newMembershipId) => {
  if (!member || !member.membership) return null;

  const currentId = String(member.membership._id || member.membership);
  if (currentId === String(newMembershipId)) return null;

  const { eligibleAt, locked } = await getPlanSwitchStatus(member);
  return locked ? { eligibleAt } : null;
};

const formatEligibleDate = (date) =>
  new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

module.exports = { getPlanSwitchStatus, assertPlanSwitchAllowed, formatEligibleDate };
