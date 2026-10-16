/* Temporary smoke test: exercises the new/changed API endpoints and cleans up
   after itself so no data is left behind in the local database. */
const path = require('path');
// Match the server: always read the project root .env.
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const axios = require('axios');
const mongoose = require('mongoose');

const BASE = process.env.SMOKE_BASE || 'http://localhost:5050';
const results = [];

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const run = async () => {
  // 1. health
  const health = await axios.get(`${BASE}/api/health`, { validateStatus: () => true });
  check('GET /api/health', health.status === 200 && health.data.status === 'ok');

  // 2. public read endpoints used by the pages
  const [stats, plans, members, trainers] = await Promise.all(
    ['/api/stats', '/api/memberships', '/api/members', '/api/trainers'].map((url) =>
      axios.get(`${BASE}${url}`, { validateStatus: () => true })
    )
  );
  check('GET /api/stats', stats.status === 200 && typeof stats.data.memberCount === 'number');
  check('GET /api/memberships', plans.status === 200 && Array.isArray(plans.data));
  check('GET /api/members', members.status === 200 && Array.isArray(members.data));
  check('GET /api/trainers', trainers.status === 200 && Array.isArray(trainers.data));

  // 3. contact + newsletter forms
  const contact = await axios.post(
    `${BASE}/api/contact`,
    { type: 'contact', name: 'Smoke Test', email: 'smoke@example.com', message: 'Hello there' },
    { validateStatus: () => true }
  );
  check('POST /api/contact (form)', contact.status === 201, JSON.stringify(contact.data));

  const newsletter = await axios.post(
    `${BASE}/api/contact`,
    { type: 'newsletter', email: 'smoke-news@example.com' },
    { validateStatus: () => true }
  );
  check('POST /api/contact (newsletter)', newsletter.status === 201);

  // 4. login as seeded admin
  const login = await axios.post(
    `${BASE}/api/auth/login`,
    { email: 'admin@gymfit.com', password: 'admin1234' },
    { validateStatus: () => true }
  );
  check('POST /api/auth/login (admin)', login.status === 200 && !!login.data.token);
  const token = login.data.token;
  const auth = { headers: { Authorization: `Bearer ${token}` } };

  const inbox = await axios.get(`${BASE}/api/contact`, { ...auth, validateStatus: () => true });
  check(
    'GET /api/contact (admin inbox)',
    inbox.status === 200 && inbox.data.some((m) => m.email === 'smoke@example.com')
  );

  const inboxForbidden = await axios.get(`${BASE}/api/contact`, { validateStatus: () => true });
  check('GET /api/contact is admin only', inboxForbidden.status === 401);

  // 5. public register cannot self-assign admin
  const stamp = Date.now();
  const regEmail = `smoke-reg-${stamp}@example.com`;
  const reg = await axios.post(
    `${BASE}/api/auth/register`,
    { fullName: 'Smoke Reg', email: regEmail, password: 'password123', role: 'admin' },
    { validateStatus: () => true }
  );
  check(
    'POST /api/auth/register ignores role escalation',
    reg.status === 201 && reg.data.user.role === 'member',
    `role=${reg.data.user?.role}`
  );

  // 6. admin creates a member with inline account details
  const memberEmail = `smoke-member-${stamp}@example.com`;
  const newMember = await axios.post(
    `${BASE}/api/members`,
    {
      fullName: 'Smoke Member',
      email: memberEmail,
      password: 'password123',
      phone: '9800011111',
      membership: plans.data[0]?._id,
      status: 'active',
    },
    { ...auth, validateStatus: () => true }
  );
  check(
    'POST /api/members (inline account)',
    newMember.status === 201 && newMember.data.user?.email === memberEmail,
    JSON.stringify(newMember.data).slice(0, 160)
  );

  // 7. status change + delete
  if (newMember.status === 201) {
    const patched = await axios.patch(
      `${BASE}/api/members/${newMember.data._id}/status`,
      { status: 'suspended' },
      { ...auth, validateStatus: () => true }
    );
    check('PATCH /api/members/:id/status', patched.status === 200 && patched.data.status === 'suspended');

    // 7b. member edit also updates the linked user profile
    const edited = await axios.put(
      `${BASE}/api/members/${newMember.data._id}`,
      {
        fullName: 'Smoke Member Renamed',
        email: memberEmail,
        phone: '9800022222',
        status: 'active',
        membership: plans.data[0]?._id,
        emergencyContact: { name: 'Jane Doe', phone: '9800033333', relation: 'Sister' },
        address: '1 Smoke Street',
      },
      { ...auth, validateStatus: () => true }
    );
    check(
      'PUT /api/members/:id updates profile',
      edited.status === 200 &&
        edited.data.user?.fullName === 'Smoke Member Renamed' &&
        edited.data.user?.phone === '9800022222' &&
        edited.data.address === '1 Smoke Street',
      JSON.stringify(edited.data).slice(0, 160)
    );

    const clash = await axios.put(
      `${BASE}/api/members/${newMember.data._id}`,
      { email: 'admin@gymfit.com' },
      { ...auth, validateStatus: () => true }
    );
    check('PUT /api/members/:id rejects duplicate email', clash.status === 400);

    const del = await axios.delete(`${BASE}/api/members/${newMember.data._id}`, {
      ...auth,
      validateStatus: () => true,
    });
    check('DELETE /api/members/:id', del.status === 200);
  }

  // 8. admin creates a trainer with inline account details
  const trainerEmail = `smoke-trainer-${stamp}@example.com`;
  const newTrainer = await axios.post(
    `${BASE}/api/trainers`,
    {
      fullName: 'Smoke Trainer',
      email: trainerEmail,
      password: 'password123',
      employeeCode: `SMK-${stamp}`,
      specialization: ['Mobility'],
      salary: 1000,
    },
    { ...auth, validateStatus: () => true }
  );
  check(
    'POST /api/trainers (inline account)',
    newTrainer.status === 201 && newTrainer.data.user?.email === trainerEmail,
    JSON.stringify(newTrainer.data).slice(0, 160)
  );
  if (newTrainer.status === 201) {
    // 8b. trainer edit also updates the linked user profile
    const edited = await axios.put(
      `${BASE}/api/trainers/${newTrainer.data._id}`,
      {
        fullName: 'Smoke Trainer Renamed',
        email: trainerEmail,
        salary: 1200,
        isAvailable: false,
        schedule: [{ day: 'Monday', startTime: '09:00', endTime: '11:00' }],
      },
      { ...auth, validateStatus: () => true }
    );
    check(
      'PUT /api/trainers/:id updates profile',
      edited.status === 200 &&
        edited.data.user?.fullName === 'Smoke Trainer Renamed' &&
        edited.data.schedule?.length === 1 &&
        edited.data.schedule?.[0]?.day === 'Monday',
      JSON.stringify(edited.data).slice(0, 160)
    );

    const del = await axios.delete(`${BASE}/api/trainers/${newTrainer.data._id}`, {
      ...auth,
      validateStatus: () => true,
    });
    check('DELETE /api/trainers/:id', del.status === 200);
  }

  // 9. static build served by express
  const home = await axios.get(`${BASE}/`, { validateStatus: () => true });
  check(
    'GET / serves the React build',
    home.status === 200 && String(home.data).includes('root'),
    `status=${home.status}`
  );

  // ---- cleanup anything the test created ----
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const testUsers = await db
    .collection('users')
    .find({ email: { $regex: '^smoke-' } }, { projection: { _id: 1 } })
    .toArray();
  const testUserIds = testUsers.map((u) => u._id);

  const removedMessages = await db
    .collection('contactmessages')
    .deleteMany({ email: { $regex: '^smoke' } });
  const removedTrainers = await db
    .collection('trainers')
    .deleteMany({ employeeCode: { $regex: '^SMK-' } });
  const removedMembers = await db.collection('members').deleteMany({ user: { $in: testUserIds } });
  const removedLogins = await db.collection('logins').deleteMany({ user: { $in: testUserIds } });
  const removedAttempts = await db
    .collection('loginattempts')
    .deleteMany({ email: { $regex: '^smoke-' } });
  const removedUsers = await db.collection('users').deleteMany({ _id: { $in: testUserIds } });

  console.log(
    `cleanup: users=${removedUsers.deletedCount} members=${removedMembers.deletedCount} ` +
      `trainers=${removedTrainers.deletedCount} logins=${removedLogins.deletedCount} ` +
      `messages=${removedMessages.deletedCount} attempts=${removedAttempts.deletedCount}`
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await mongoose.disconnect();
  process.exit(failed.length ? 1 : 0);
};

run().catch(async (err) => {
  console.error('SMOKE TEST ERROR:', err.response ? err.response.data : err.message);
  process.exit(1);
});
