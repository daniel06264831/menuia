const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();
const port = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());
app.use(express.static(__dirname));

// --- MONGODB CONNECTION ---
const mongoUri = "mongodb+srv://sosushi:Hola2025@cluster0.kerhufq.mongodb.net/?appName=Cluster0";
mongoose.connect(mongoUri)
    .then(() => console.log('✅ Conectado a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a MongoDB:', err));

// --- SCHEMAS E MODELOS ---

// Esquema para Configuración (Alta Demanda, estado tienda)
const configSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true }, // ej: "high_demand"
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
    paymentMethod: String, // 'efectivo' | 'transferencia'
    paymentAmount: Number, // Si es efectivo
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

// --- DATOS DEL MENÚ (Hardcoded en servidor por simplicidad, podría ir a DB después) ---
const menuData = {
    promos: [
        { id: "promo1", name: "Promo 2 Clásicos", description: "Selecciona tus 2 rollos favoritos.", originalPrice: 150, price: 100, image: "defaul.jpg", proteins: [], tags: ['promo', 'share', 'heavy', 'light'] },
        { id: "promo2", name: "Promo Empa & Bocados", description: "2 Rollos Empanizados + 1 Bocados.", originalPrice: 255, price: 170, image: "empanizado.jpeg", proteins: [], tags: ['promo', 'crunchy', 'share', 'heavy'] }
    ],
    especiales: [
        { id: "esp1", name: "Mata Hambre", description: "Rollo empanizado con queso gratinado y tocino.", originalPrice: 110, price: 80, image: "mata.jpeg", proteins: ["Camarón", "Pollo", "Surimi"], tags: ['crunchy', 'heavy', 'cheese', 'meat'] },
        { id: "esp2", name: "Nachito Roll", description: "Rollo empanizado con queso amarillo y jalapeño.", originalPrice: 110, price: 80, image: "nachito.jpeg", proteins: ["Camarón", "Pollo", "Surimi"], tags: ['crunchy', 'spicy', 'heavy', 'cheese'] },
        // ... (Se pueden agregar más aquí copiando del index.html original)
    ],
    clasicos: [
        { id: "cls1", name: "Ajonjolí", description: "Rollo cubierto de ajonjolí.", originalPrice: 90, price: 70, image: "defaul.jpg", proteins: ["Camarón", "Pollo", "Surimi"], tags: ['fresh', 'light', 'classic'] },
        // ...
    ],
    extras: [
        { id: "app1", name: "Bocados de Arroz", description: "4 Bolitas empanizadas con queso.", originalPrice: 65, price: 55, image: "bolitas.png", proteins: ["Queso"], tags: ['side', 'crunchy', 'cheese'] }
        // ...
    ]
};

// --- API ENDPOINTS ---

// 1. Obtener Menú
app.get('/api/menu', (req, res) => {
    res.json(menuData);
});

// 2. Crear Pedido
app.post('/api/orders', async (req, res) => {
    try {
        const newOrder = new Order(req.body);
        const savedOrder = await newOrder.save();

        // Aquí se podría integrar socket.io para notificar en tiempo real
        res.status(201).json({ success: true, orderId: savedOrder._id });
    } catch (error) {
        console.error("Error al crear pedido:", error);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
});

// 3. Listar Pedidos (Para Admin y Repartidor)
app.get('/api/orders', async (req, res) => {
    try {
        const { status, active } = req.query;
        let query = {};

        if (status) {
            query.status = status;
        } else if (active === 'true') {
            // Pedidos que no estén completados ni cancelados
            query.status = { $nin: ['completed', 'cancelled'] };
        }

        const orders = await Order.find(query).sort({ createdAt: -1 }); // Más recientes primero
        res.json(orders);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Actualizar Estado de Pedido
app.patch('/api/orders/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const order = await Order.findByIdAndUpdate(req.params.id, { status }, { new: true });
        res.json(order);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. Configuración: Alta Demanda
app.get('/api/config/high-demand', async (req, res) => {
    try {
        let config = await Config.findOne({ key: 'high_demand' });
        if (!config) {
            config = await Config.create({ key: 'high_demand', value: false });
        }
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

// Servir páginas específicas
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/delivery', (req, res) => res.sendFile(path.join(__dirname, 'delivery.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(port, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
});
