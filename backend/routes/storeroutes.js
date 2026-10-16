const express = require('express');
const mongoose = require('mongoose');
const Item = require('../models/itemmodel');
const Order = require('../models/ordermodel');
const { protect, adminOnly, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const isAdmin = (req) => req.user?.role === 'admin';

const isValidId = (value) => mongoose.Types.ObjectId.isValid(value);

// ---------- Items ----------

// Public list. Admins may pass ?all=true to include inactive items.
router.get('/items', optionalAuth, async (req, res, next) => {
  try {
    const filter = {};
    const includeAll = req.query.all === 'true' && isAdmin(req);
    if (!includeAll) filter.isActive = true;
    if (req.query.category) filter.category = req.query.category;
    const items = await Item.find(filter).sort({ sortOrder: 1, createdAt: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

// Persist a manual display order. Body: { ids: [itemId, ...] } in the desired order.
router.put('/items/reorder', protect, adminOnly, async (req, res, next) => {
  try {
    const raw = Array.isArray(req.body?.ids)
      ? req.body.ids
      : Array.isArray(req.body?.order)
        ? req.body.order
        : [];
    const ids = [...new Set(raw.map(String))].filter(Boolean);
    if (ids.length === 0) {
      return res.status(400).json({ message: 'An ordered list of item ids is required' });
    }
    if (!ids.every(isValidId)) {
      return res.status(400).json({ message: 'One or more item ids are invalid' });
    }

    await Item.bulkWrite(
      ids.map((id, index) => ({
        updateOne: { filter: { _id: id }, update: { $set: { sortOrder: index } } },
      }))
    );

    const items = await Item.find().sort({ sortOrder: 1, createdAt: -1 });
    res.json(items);
  } catch (err) {
    next(err);
  }
});

router.get('/items/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Item not found' });
    const item = await Item.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.post('/items', protect, adminOnly, async (req, res, next) => {
  try {
    // New items go to the top of the list (matching the previous newest-first default).
    const first = await Item.findOne().sort({ sortOrder: 1, createdAt: -1 }).select('sortOrder');
    const sortOrder = first ? (Number(first.sortOrder) || 0) - 1 : 0;
    const item = await Item.create({ ...req.body, sortOrder });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
});

router.put('/items/:id', protect, adminOnly, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Item not found' });
    const item = await Item.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.patch('/items/:id/stock', protect, adminOnly, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Item not found' });
    const stock = Number(req.body?.stock);
    if (Number.isNaN(stock) || stock < 0) {
      return res.status(400).json({ message: 'Stock must be a non-negative number' });
    }
    const item = await Item.findByIdAndUpdate(
      req.params.id,
      { stock },
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json(item);
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:id', protect, adminOnly, async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ message: 'Item not found' });
    const item = await Item.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    res.json({ message: 'Item deleted' });
  } catch (err) {
    next(err);
  }
});

// ---------- Orders ----------

// Place an order (no payment; picked up/delivered in the gym).
router.post('/orders', protect, async (req, res, next) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const normalized = rawItems
      .map((entry) => ({
        id: entry?.item || entry?.itemId || entry?.id,
        quantity: Number(entry?.quantity ?? entry?.qty ?? 1),
      }))
      .filter((entry) => entry.id && entry.quantity > 0);

    if (normalized.length === 0) {
      return res.status(400).json({ message: 'At least one item is required' });
    }

    // Validate stock before decrementing anything.
    const documents = {};
    for (const entry of normalized) {
      if (!isValidId(entry.id)) {
        return res.status(400).json({ message: `Invalid item id: ${entry.id}` });
      }
      const item = await Item.findById(entry.id);
      if (!item || item.isActive === false) {
        return res.status(404).json({ message: 'One of the items is no longer available' });
      }
      if (item.stock < entry.quantity) {
        return res.status(400).json({
          message: `Not enough stock for "${item.name}". Available: ${item.stock}`,
        });
      }
      documents[entry.id] = item;
    }

    // Decrement stock.
    for (const entry of normalized) {
      await Item.findByIdAndUpdate(entry.id, { $inc: { stock: -entry.quantity } });
    }

    const orderItems = normalized.map((entry) => {
      const item = documents[entry.id];
      return {
        item: item._id,
        name: item.name,
        price: item.price,
        quantity: entry.quantity,
      };
    });

    const total = orderItems.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0
    );

    const order = await Order.create({
      user: req.user.id,
      items: orderItems,
      total,
      notes: req.body?.notes ? String(req.body.notes).trim() : undefined,
      status: 'placed',
    });

    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

// Current user's own orders.
router.get('/orders/me', protect, async (req, res, next) => {
  try {
    if (!isValidId(req.user.id)) return res.json([]);
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// All orders (admin).
router.get('/orders', protect, adminOnly, async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const orders = await Order.find(filter)
      .populate('user', 'fullName email phone')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    next(err);
  }
});

// Mark an order as ready for pickup (admin).
router.patch('/orders/:id/ready', protect, adminOnly, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status === 'ready') return res.json(order);
    if (order.status === 'delivered') return res.status(400).json({ message: 'Order already delivered' });
    if (order.status === 'cancelled') return res.status(400).json({ message: 'Order is cancelled' });

    order.status = 'ready';
    order.readyAt = new Date();
    if (isValidId(req.user.id)) order.readyBy = req.user.id;
    await order.save();
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// Mark an order as delivered (admin). Only after it is ready for pickup.
router.patch('/orders/:id/deliver', protect, adminOnly, async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    if (order.status === 'delivered') return res.json(order);
    if (order.status !== 'ready') {
      return res.status(400).json({ message: 'Mark the order ready before delivery' });
    }
    order.status = 'delivered';
    order.deliveredAt = new Date();
    if (isValidId(req.user.id)) order.deliveredBy = req.user.id;
    await order.save();
    res.json(order);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
