import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { initialProducts, initialOrders, initialSettings, initialDeliveryAreas, initialCustomers } from './src/data/initialData.ts';
import { Product, Order, StoreSettings, DeliveryArea, CustomerProfile } from './src/types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.resolve(DATA_DIR, 'store_data.json');

interface DatabaseSchema {
  products: Product[];
  orders: Order[];
  settings: StoreSettings;
  deliveryAreas: DeliveryArea[];
  customers: CustomerProfile[];
}

// Ensure database file exists
function loadDatabase(): DatabaseSchema {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Migration helpers
      if (!parsed.deliveryAreas) parsed.deliveryAreas = initialDeliveryAreas;
      if (!parsed.customers) parsed.customers = initialCustomers;
      if (!parsed.settings.adminPin) parsed.settings.adminPin = '1234';
      return parsed;
    }
  } catch (e) {
    console.error('Error reading database file:', e);
  }

  const initial: DatabaseSchema = {
    products: initialProducts,
    orders: initialOrders,
    settings: initialSettings,
    deliveryAreas: initialDeliveryAreas,
    customers: initialCustomers,
  };
  saveDatabase(initial);
  return initial;
}

function saveDatabase(data: DatabaseSchema) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving database file:', e);
  }
}

let db = loadDatabase();

// Connected Server-Sent Events (SSE) clients for real-time computer alerts
const sseClients = new Set<express.Response>();

function broadcastSSE(type: string, payload: unknown) {
  const message = `data: ${JSON.stringify({ type, payload })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch {
      sseClients.delete(client);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Real-time events stream (SSE)
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // Security: Check Admin PIN
  app.post('/api/admin/verify-pin', (req, res) => {
    const { pin } = req.body;
    if (pin && String(pin).trim() === String(db.settings.adminPin).trim()) {
      return res.json({ success: true, authorized: true });
    }
    return res.status(401).json({ success: false, error: 'Senha incorreta' });
  });

  // State endpoint
  app.get('/api/state', (_req, res) => {
    res.json(db);
  });

  // Products API
  app.get('/api/products', (_req, res) => {
    res.json(db.products);
  });

  app.post('/api/products', (req, res) => {
    const product = req.body as Product;
    if (!product || !product.id) {
      return res.status(400).json({ error: 'Produto inválido' });
    }
    db.products.unshift(product);
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.status(201).json(product);
  });

  app.put('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const index = db.products.findIndex(p => p.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    db.products[index] = { ...db.products[index], ...req.body };
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json(db.products[index]);
  });

  app.post('/api/products/:id/stock', (req, res) => {
    const { id } = req.params;
    const { delta } = req.body;
    const product = db.products.find(p => p.id === id);
    if (!product) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    product.stock = Math.max(0, product.stock + (Number(delta) || 0));
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json(product);
  });

  app.delete('/api/products/:id', (req, res) => {
    const { id } = req.params;
    db.products = db.products.filter(p => p.id !== id);
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json({ success: true });
  });

  // Delivery Areas API
  app.get('/api/delivery-areas', (_req, res) => {
    res.json(db.deliveryAreas);
  });

  app.post('/api/delivery-areas', (req, res) => {
    const area = req.body as DeliveryArea;
    if (!area || !area.id || !area.name) {
      return res.status(400).json({ error: 'Área inválida' });
    }
    db.deliveryAreas.push(area);
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.status(201).json(area);
  });

  app.put('/api/delivery-areas/:id', (req, res) => {
    const { id } = req.params;
    const idx = db.deliveryAreas.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Área não encontrada' });
    db.deliveryAreas[idx] = { ...db.deliveryAreas[idx], ...req.body };
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json(db.deliveryAreas[idx]);
  });

  app.delete('/api/delivery-areas/:id', (req, res) => {
    const { id } = req.params;
    db.deliveryAreas = db.deliveryAreas.filter(a => a.id !== id);
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json({ success: true });
  });

  // Customers API
  app.get('/api/customers', (_req, res) => {
    res.json(db.customers);
  });

  app.post('/api/customers', (req, res) => {
    const cust = req.body as CustomerProfile;
    if (!cust || !cust.phone || !cust.name) {
      return res.status(400).json({ error: 'Cliente inválido' });
    }
    const cleanPhone = cust.phone.replace(/\D/g, '');
    const existingIndex = db.customers.findIndex(c => c.phone.replace(/\D/g, '') === cleanPhone);
    if (existingIndex >= 0) {
      db.customers[existingIndex] = { ...db.customers[existingIndex], ...cust };
    } else {
      db.customers.unshift({
        ...cust,
        id: cust.id || `cust-${Date.now()}`,
        createdAt: new Date().toISOString(),
      });
    }
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json(existingIndex >= 0 ? db.customers[existingIndex] : db.customers[0]);
  });

  app.get('/api/customers/by-phone/:phone', (req, res) => {
    const cleanPhone = req.params.phone.replace(/\D/g, '');
    const found = db.customers.find(c => c.phone.replace(/\D/g, '') === cleanPhone);
    if (!found) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(found);
  });

  // Orders API
  app.get('/api/orders', (_req, res) => {
    res.json(db.orders);
  });

  app.post('/api/orders', (req, res) => {
    const order = req.body as Order;
    if (!order || !order.id) {
      return res.status(400).json({ error: 'Pedido inválido' });
    }

    // Decrement stock for sold products
    for (const item of order.items) {
      const prod = db.products.find(p => p.id === item.productId);
      if (prod) {
        prod.stock = Math.max(0, prod.stock - item.quantity);
      }
    }

    // Update customer stats
    if (order.customer && order.customer.phone) {
      const cleanPhone = order.customer.phone.replace(/\D/g, '');
      const cust = db.customers.find(c => c.phone.replace(/\D/g, '') === cleanPhone);
      if (cust) {
        cust.totalOrdersCount = (cust.totalOrdersCount || 0) + 1;
        cust.totalSpent = (cust.totalSpent || 0) + order.total;
        cust.lastOrderAt = new Date().toISOString();
        cust.address = order.customer.address;
        cust.number = order.customer.number;
        cust.neighborhood = order.customer.neighborhood;
        if (order.customer.complement) cust.complement = order.customer.complement;
        if (order.customer.reference) cust.reference = order.customer.reference;
      } else {
        db.customers.unshift({
          id: `cust-${Date.now()}`,
          name: order.customer.name,
          phone: order.customer.phone,
          address: order.customer.address,
          number: order.customer.number,
          neighborhood: order.customer.neighborhood,
          complement: order.customer.complement,
          reference: order.customer.reference,
          createdAt: new Date().toISOString(),
          totalOrdersCount: 1,
          totalSpent: order.total,
          lastOrderAt: new Date().toISOString(),
        });
      }
    }

    db.orders.unshift(order);
    saveDatabase(db);

    // CRITICAL: Notify the owner's desktop system in real-time!
    broadcastSSE('NEW_ORDER', order);
    broadcastSSE('STATE_UPDATED', db);

    res.status(201).json(order);
  });

  app.patch('/api/orders/:id/status', (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const order = db.orders.find(o => o.id === id);
    if (!order) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }
    order.status = status;
    order.updatedAt = new Date().toISOString();
    saveDatabase(db);
    broadcastSSE('ORDER_STATUS_CHANGED', order);
    broadcastSSE('STATE_UPDATED', db);
    res.json(order);
  });

  // Settings API
  app.get('/api/settings', (_req, res) => {
    res.json(db.settings);
  });

  app.put('/api/settings', (req, res) => {
    db.settings = { ...db.settings, ...req.body };
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json(db.settings);
  });

  // Reset Demo Data
  app.post('/api/reset-demo', (_req, res) => {
    db = {
      products: initialProducts,
      orders: initialOrders,
      settings: initialSettings,
      deliveryAreas: initialDeliveryAreas,
      customers: initialCustomers,
    };
    saveDatabase(db);
    broadcastSSE('STATE_UPDATED', db);
    res.json({ success: true });
  });

  // Attach Vite or Static
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Depósito Express] Sistema rodando na porta ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
