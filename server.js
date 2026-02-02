const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app); // Wrap Express in HTTP server
const io = socketIo(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity
        methods: ["GET", "POST"]
    }
});

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// --- MONGODB CONNECTION ---
const mongoUri = "mongodb+srv://sosushi:Hola2025@cluster0.kerhufq.mongodb.net/?appName=Cluster0";
mongoose.connect(mongoUri)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// --- SCHEMAS E MODELOS ---

// Esquema para Configuración (Alta Demanda, estado tienda)
const configSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    value: mongoose.Schema.Types.Mixed
});
const Config = mongoose.model('Config', configSchema);

// Esquema para Pedidos
const orderSchema = new mongoose.Schema({
    customer: {
        name: String,
        phone: String,
        address: String,
        details: String
    },
    items: [{
        originalId: String,
        name: String,
        protein: String,
        quantity: Number,
        price: Number,
        note: String
    }],
    paymentMethod: String,
    paymentAmount: Number,
    total: Number,
    shippingCost: Number,
    distanceKm: Number,
    status: {
        type: String,
        enum: ['pending', 'cooking', 'ready', 'delivering', 'completed', 'cancelled'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// User Schema con Referidos
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    salt: String,
    hash: String,
    referralCode: { type: String, unique: true }, // Código único de este usuario
    coupons: [{
        code: String,
        amount: Number,
        active: { type: Boolean, default: true },
        source: String
    }],
    createdAt: { type: Date, default: Date.now }
});

userSchema.methods.setPassword = function (password) {
    this.salt = crypto.randomBytes(16).toString('hex');
    this.hash = crypto.pbkdf2Sync(password, this.salt, 1000, 64, 'sha512').toString('hex');
};

userSchema.methods.validPassword = function (password) {
    const hash = crypto.pbkdf2Sync(password, this.salt, 1000, 64, 'sha512').toString('hex');
    return this.hash === hash;
};

const User = mongoose.model('User', userSchema);

// --- DATOS DEL MENÚ ---
const menuData = {
    promos: [
        { id: "promo1", name: "Promo 2 Clásicos", description: "Selecciona tus 2 rollos favoritos.", originalPrice: 150, price: 100, image: "defaul.jpg", proteins: [], tags: ['promo', 'share', 'heavy', 'light'] },
        { id: "promo2", name: "Promo Empa & Bocados", description: "2 Rollos Empanizados + 1 Bocados.", originalPrice: 255, price: 170, image: "empanizado.jpeg", proteins: [], tags: ['promo', 'crunchy', 'share', 'heavy'] }
    ],
    especiales: [
        { id: "esp1", name: "Mata Hambre", description: "Rollo empanizado con queso gratinado y tocino.", originalPrice: 110, price: 80, image: "mata.jpeg", proteins: ["Camarón", "Pollo", "Surimi"], tags: ['crunchy', 'heavy', 'cheese', 'meat'] },
        { id: "esp2", name: "Nachito Roll", description: "Rollo empanizado con queso amarillo y jalapeño.", originalPrice: 110, price: 80, image: "nachito.jpeg", proteins: ["Camarón", "Pollo", "Surimi"], tags: ['crunchy', 'spicy', 'heavy', 'cheese'] },
    ],
    clasicos: [
        { id: "cls1", name: "Ajonjolí", description: "Rollo cubierto de ajonjolí.", originalPrice: 90, price: 70, image: "defaul.jpg", proteins: ["Camarón", "Pollo", "Surimi"], tags: ['fresh', 'light', 'classic'] },
    ],
    extras: [
        { id: "app1", name: "Bocados de Arroz", description: "4 Bolitas empanizadas con queso.", originalPrice: 65, price: 55, image: "bolitas.png", proteins: ["Queso"], tags: ['side', 'crunchy', 'cheese'] }
    ]
};

// --- HELPER FUNCTIONS ---
function generateReferralCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
}

// --- API ENDPOINTS ---

app.get('/api/menu', (req, res) => {
    res.json(menuData);
});

app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order(req.body);
        const savedOrder = await newOrder.save();
        io.emit('new-order', savedOrder);
        res.status(201).json({ success: true, orderId: savedOrder._id });
    } catch (error) {
        console.error("Error al crear pedido:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
});

app.get('/api/orders', async (req, res) => {
    try {
        const { status, active } = req.query;
        let query = {};
        if (status) query.status = status;
        else if (active === 'true') query.status = { $nin: ['completed', 'cancelled'] };
        const orders = await Order.find(query).sort({ createdAt: -1 });
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/orders/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
        io.emit('order-status-changed', order);
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/config/high-demand', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'high_demand' });
        if (!config) config = await Config.create({ key: 'high_demand', value: false });
        res.json({ isHighDemand: config.value });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config/high-demand', async (req, res) => {
    try {
        const { enabled } = req.body;
        const config = await Config.findOneAndUpdate(
            { key: 'high_demand' },
            { value: enabled },
            { upsert: true, new: true }
        );
        res.json({ success: true, isHighDemand: config.value });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/config/hours', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'store_hours' });
        if (!config) {
            await Config.create({
                key: 'store_hours',
                value: { open: 16, close: 23, force_close: false }
            });
            config = { value: { open: 16, close: 23, force_close: false } };
        }
        res.json(config.value);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/config/hours', async (req, res) => {
    try {
        const { open, close, force_close } = req.body;
        const config = await Config.findOneAndUpdate(
            { key: 'store_hours' },
            { value: { open, close, force_close } },
            { upsert: true, new: true }
        );
        io.emit('config-updated', config.value);
        res.json({ success: true, config: config.value });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Auth & Referrals
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, phone, password, referredByCode } = req.body;

        if (!name || !phone || !password) {
            return res.status(400).json({ success: false, message: "Todos los campos son obligatorios" });
        }

        const existingUser = await User.findOne({ phone });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "El teléfono ya está registrado" });
        }

        const user = new User({ name, phone });
        user.setPassword(password);
        user.referralCode = generateReferralCode();

        if (referredByCode && referredByCode.length === 6) {
            const referrer = await User.findOne({ referralCode: referredByCode.toUpperCase() });
            if (referrer) {
                referrer.coupons.push({
                    code: 'REF-' + generateReferralCode(),
                    amount: 50,
                    source: name
                });
                await referrer.save();
            }
        }

        await user.save();

        res.status(201).json({
            success: true,
            message: "Usuario registrado",
            user: { id: user._id, name: user.name, phone: user.phone, referralCode: user.referralCode, coupons: user.coupons }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error en el servidor", error: error.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { phone, password } = req.body;

        if (!phone || !password) {
            return res.status(400).json({ success: false, message: "Faltan datos" });
        }

        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(401).json({ success: false, message: "Usuario no encontrado" });
        }

        if (!user.validPassword(password)) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        res.json({
            success: true,
            message: "Bienvenido",
            user: { id: user._id, name: user.name, phone: user.phone, referralCode: user.referralCode, coupons: user.coupons }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error en servidor" });
    }
});

app.get('/api/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json({ id: user._id, name: user.name, phone: user.phone, referralCode: user.referralCode, coupons: user.coupons });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/', (req, res) => {
    res.send("🚀 So Sushi API + Socket.IO Running");
});

server.listen(port, () => {
    console.log(`🚀 Servidor API + Socket.IO corriendo en puerto ${port}`);
});
