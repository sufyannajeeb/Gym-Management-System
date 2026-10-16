const path = require('path');
// Read the project root .env so seeding targets the same database as the server.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const connectDB = require('./db');
const User = require('./models/usermodel');
const Member = require('./models/membermodel');
const Trainer = require('./models/trainermodel');
const Membership = require('./models/membershipmodel');
const Login = require('./models/loginmodel');
const LoginAttempt = require('./models/loginattemptmodel');

const seed = async () => {
  await connectDB(process.env.MONGO_URI);

  await Promise.all([
    User.deleteMany({}),
    Login.deleteMany({}),
    LoginAttempt.deleteMany({}),
    Member.deleteMany({}),
    Trainer.deleteMany({}),
    Membership.deleteMany({}),
  ]);

  const memberships = await Membership.create([
    {
      name: 'Starter',
      description: 'Access to the gym floor and open area for the month.',
      durationDays: 30,
      price: 29,
      features: ['Gym floor access', 'Locker room', '1 induction session'],
      sessionsPerWeek: 2,
    },
    {
      name: 'Pro',
      description: 'Full class access with a dedicated trainer.',
      durationDays: 30,
      price: 59,
      features: ['Unlimited classes', 'Free weights area', 'Sauna access', 'Nutrition plan'],
      sessionsPerWeek: 5,
    },
    {
      name: 'Elite',
      description: 'Annual contract with personal coaching and priority booking.',
      durationDays: 365,
      price: 480,
      features: [
        'Personal trainer',
        'Unlimited classes',
        'Priority class booking',
        'Body composition analysis',
      ],
      sessionsPerWeek: 7,
    },
  ]);

  const users = await User.create([
    {
      fullName: 'Site Admin',
      email: 'admin@gymfit.com',
      role: 'admin',
      phone: '9800000100',
    },
    {
      fullName: 'Marcus Reid',
      email: 'trainer@gymfit.com',
      role: 'trainer',
      phone: '9800000142',
    },
    {
      fullName: 'Sofia Bennett',
      email: 'sofia@example.com',
      role: 'member',
      phone: '9800000188',
    },
    {
      fullName: 'Daniel Okafor',
      email: 'daniel@example.com',
      role: 'member',
      phone: '9800000163',
    },
  ]);

  await Login.create([
    { user: users[0]._id, email: 'admin@gymfit.com', password: 'admin1234' },
    { user: users[1]._id, email: 'trainer@gymfit.com', password: 'trainer1234' },
    { user: users[2]._id, email: 'sofia@example.com', password: 'member1234' },
    { user: users[3]._id, email: 'daniel@example.com', password: 'member1234' },
  ]);

  const trainer = await Trainer.create({
    user: users[1]._id,
    employeeCode: 'TRN-001',
    specialization: ['Strength', 'HIIT'],
    hireDate: new Date('2023-04-10'),
    salary: 3200,
    isAvailable: true,
    schedule: [
      { day: 'Monday', startTime: '06:00', endTime: '14:00' },
      { day: 'Wednesday', startTime: '06:00', endTime: '14:00' },
      { day: 'Friday', startTime: '12:00', endTime: '20:00' },
    ],
  });

  await Member.create([
    {
      user: users[2]._id,
      membership: memberships[1]._id,
      joinDate: new Date('2025-11-02'),
      status: 'active',
      trainer: trainer._id,
      emergencyContact: { name: 'Lena Bennett', phone: '9800000199', relation: 'Sister' },
    },
    {
      user: users[3]._id,
      membership: memberships[0]._id,
      joinDate: new Date('2026-01-15'),
      status: 'active',
      trainer: trainer._id,
    },
  ]);

  console.log('Seed complete');
  console.log('Admin login: admin@gymfit.com / admin1234');
  process.exit(0);
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});