require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const connectDB = require('./db');

const authRoutes = require('./routes/authroutes');
const membershipRoutes = require('./routes/membershiproutes');
const memberRoutes = require('./routes/memberroutes');
const trainerRoutes = require('./routes/trainerroutes');
const statsRoutes = require('./routes/statsroutes');
const contactRoutes = require('./routes/contactroutes');

const app = express();

app.use(cors());
app.use(express.json());

const publicDir = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/memberships', membershipRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/trainers', trainerRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/contact', contactRoutes);

// Unknown non-API routes fall back to the React build so that client side
// routes such as /dashboard can be refreshed or opened directly.
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    const indexFile = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }
  }
  return res.status(404).json({ message: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return res
      .status(400)
      .json({ message: `A record with that ${field} already exists` });
  }
  if (err.name === 'ValidationError') {
    return res
      .status(400)
      .json({ message: Object.values(err.errors).map((e) => e.message).join(', ') });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Invalid value for ${err.path}` });
  }
  return res.status(err.status || 500).json({ message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;

connectDB(process.env.MONGO_URI)
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  });