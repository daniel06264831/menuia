const express = require('express');
const http = require('http'); 
const { Server } = require("socket.io");
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const https = require('https');

// --- CORRECCIÓN PARA RENDER ---
try {
    require('dotenv').config(); 
} catch (e) {
    console.log("Nota: 'dotenv' no encontrado. Usando variables de entorno del sistema.");
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});

const PORT = process.env.PORT || 3000;

// CLAVE MAESTRA PARA EL SUPER ADMIN
const SUPER_ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_51SeMjIDaJNbMOGNThpOULS40g4kjVPcrTPagicSbV450bdvVR1QLQZNJWykZuIrBYLJzlxwnqORWTUstVKKYPlDL00kAw1uJfH';
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://daniel:daniel25@capacitacion.nxd7yl9.mongodb.net/?retryWrites=true&w=majority&appName=capacitacion&authSource=admin";

const stripe = require('stripe')(STRIPE_KEY);

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado exitosamente a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a Mongo:', err));

// --- SCHEMAS ---

const ShopSchema = new mongoose.Schema({
    slug: { type: String, required: true, unique: true, index: true },
    credentials: {
        password: { type: String, required: true },
        ownerName: String,
        contactPhone: String
    },
    subscription: { 
        status: { type: String, default: 'trial' }, 
        plan: { type: String, default: 'free' }, 
        validUntil: Date,
        startDate: { type: Date, default: Date.now }
    },
    stats: { 
        visits: { type: Number, default: 0 }, 
        orders: { type: Number, default: 0 },
        lastReset: { type: String, default: '' } // Formato YYYY-MM-DD
    },
    config: {
        name: String, 
        address: String, 
        whatsapp: String, 
        businessType: { type: String, default: "Comida General" },
        heroImage: String,
        coords: { lat: Number, lng: Number },
        hours: { open: Number, close: Number },
        shipping: { freeThreshold: Number, freeKm: Number, maxRadius: Number, costPerKm: Number },
        bank: { name: String, clabe: String, owner: String },
        categoryTitles: { 
            promos: { type: String, default: "🔥 Promociones" }, 
            especiales: { type: String, default: "⭐ Recomendados" }, 
            clasicos: { type: String, default: "🍽️ Menú Principal" }, 
            extras: { type: String, default: "🥤 Bebidas y Otros" } 
        }
    },
    menu: { 
        promos: [mongoose.Schema.Types.Mixed], 
        especiales: [mongoose.Schema.Types.Mixed], 
        clasicos: [mongoose.Schema.Types.Mixed], 
        extras: [mongoose.Schema.Types.Mixed],
        groups: [mongoose.Schema.Types.Mixed]
    }
}, { timestamps: true });

const Shop = mongoose.model('Shop', ShopSchema);

// NUEVO: Schema para Pedidos (Historial)
const OrderSchema = new mongoose.Schema({
    shopSlug: { type: String, required: true, index: true },
    ref: String, // Mesa # o Nombre Cliente
    type: String, // 'mesa' o 'llevar'
    items: [mongoose.Schema.Types.Mixed], // Array de items con qty, price, options
    total: String, // Guardamos el total formateado o numérico
    status: { type: String, default: 'pending' }, // pending, completed, cancelled
    createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// --- HELPERS STATS DIARIOS ---
const checkDailyReset = (shop) => {
    const today = new Date().toLocaleDateString('en-CA'); 
    if (shop.stats.lastReset !== today) {
        shop.stats.visits = 0;
        shop.stats.orders = 0;
        shop.stats.lastReset = today;
        return true; 
    }
    return false;
};

// --- SOCKET.IO EVENTS ---
io.on('connection', (socket) => {
    console.log(`🔌 Nuevo cliente conectado: ${socket.id}`);

    socket.on('join-store', (slug) => { 
        socket.join(slug); 
    });
    
    socket.on('register-visit', async (slug) => {
        try {
            let shop = await Shop.findOne({ slug });
            if (shop) {
                checkDailyReset(shop); 
                shop.stats.visits += 1;
                await shop.save();
                io.to(slug).emit('stats-update', shop.stats);
            }
        } catch (e) { console.error("Error stats visit:", e); }
    });

    // MODIFICADO: Ahora recibe payload completo { slug, order } o solo slug (compatibilidad)
    socket.on('register-order', async (payload) => {
        let slug = payload;
        let orderData = null;

        // Si el payload es un objeto con la orden, lo extraemos
        if (typeof payload === 'object' && payload.slug) {
            slug = payload.slug;
            orderData = payload.order;
        }

        try {
            let shop = await Shop.findOne({ slug });
            if (shop) {
                checkDailyReset(shop);
                shop.stats.orders += 1;
                await shop.save();

                // NUEVO: Guardar en Base de Datos si hay datos de orden
                if (orderData) {
                    await Order.create({
                        shopSlug: slug,
                        ref: orderData.ref,
                        type: orderData.type,
                        items: orderData.items,
                        total: orderData.total,
                        status: orderData.status || 'pending',
                        createdAt: new Date()
                    });
                    
                    // Notificar al panel admin para que refresque la tabla
                    io.to(slug).emit('new-order-saved');
                }

                io.to(slug).emit('stats-update', shop.stats);
                io.to(slug).emit('order-notification', { message: '¡Nuevo Pedido!' });
            }
        } catch (e) { console.error("Error stats order:", e); }
    });

    socket.on('disconnect', () => {});
});

// --- HELPERS TEMPLATE ---
const getTemplateShop = (slug, name, owner, phone, address, whatsapp, password, businessType) => {
    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 15);
    const today = new Date().toLocaleDateString('en-CA');

    return {
        slug,
        credentials: { password, ownerName: owner, contactPhone: phone },
        subscription: { status: 'trial', plan: 'free', validUntil: trialEnds },
        stats: { visits: 0, orders: 0, lastReset: today },
        config: {
            name, address, whatsapp, businessType,
            heroImage: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&q=80&w=1000",
            coords: { "lat": 20.648325, "lng": -103.267706 },
            hours: { "open": 9, "close": 23 },
            shipping: { "freeThreshold": 500, "freeKm": 2.0, "maxRadius": 5.0, "costPerKm": 10 },
            bank: { "name": "Banco", "clabe": "000000000000000000", "owner": name }
        },
        menu: { promos: [], especiales: [], clasicos: [], extras: [], groups: [] }
    };
};

const resolveGoogleMapsLink = (url) => {
    return new Promise((resolve) => {
        if (!url.includes('goo.gl') && !url.includes('maps.app')) return resolve(url);
        try { https.get(url, (res) => { if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) resolve(res.headers.location); else resolve(url); }).on('error', () => resolve(url)); } catch (e) { resolve(url); }
    });
};

const geocodeAddress = (address) => {
    return new Promise((resolve, reject) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
        https.get(url, { headers: { 'User-Agent': 'MiPlataforma/1.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { const json = JSON.parse(data); if (json && json.length > 0) resolve({ lat: parseFloat(json[0].lat), lng: parseFloat(json[0].lon) }); else resolve(null); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
};

// --- RUTAS DE PAGO (STRIPE) ---
app.post('/api/create-subscription', async (req, res) => {
    const { slug } = req.body;
    const domain = `${req.protocol}://${req.get('host')}`; 
    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ 
                price_data: { 
                    currency: 'mxn', 
                    product_data: { name: 'Plan Menú Digital PRO' }, 
                    unit_amount: 10000, 
                    recurring: { interval: 'month' } 
                }, 
                quantity: 1 
            }],
            success_url: `${domain}/api/subscription-success?slug=${slug}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: 'https://iamenu.github.io/menuia/admin.html?canceled=true',
        });
        res.json({ url: session.url });
    } catch (e) { 
        console.error("Stripe Error:", e);
        res.status(500).json({ error: e.message }); 
    }
});

app.get('/api/subscription-success', async (req, res) => {
    const { slug } = req.query;
    if (slug) {
        await Shop.findOneAndUpdate({ slug }, {
            'subscription.status': 'active',
            'subscription.plan': 'pro_monthly',
            'subscription.validUntil': null 
        });
    }
    res.redirect('https://iamenu.github.io/menuia/admin.html?success=subscription');
});

// --- RUTAS API ---

app.post('/api/register', async (req, res) => {
    const { slug, restaurantName, ownerName, phone, address, whatsapp, password, businessType } = req.body;
    if (!slug || !restaurantName || !password) return res.status(400).json({ error: "Datos incompletos" });
    try {
        const existing = await Shop.findOne({ slug });
        if (existing) return res.status(400).json({ error: "Ese nombre de tienda ya existe." });
        const newShopData = getTemplateShop(slug, restaurantName, ownerName, phone, address, whatsapp, password, businessType);
        await Shop.create(newShopData);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error interno" }); }
});

app.post('/api/login', async (req, res) => {
    const { slug, password } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (shop && shop.credentials.password === password) res.json({ success: true });
        else res.status(401).json({ error: "Credenciales inválidas" });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

app.get('/api/shop/:slug', async (req, res) => {
    try {
        const shop = await Shop.findOne({ slug: req.params.slug }).lean();
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });
        const now = new Date();
        let isExpired = false;
        if (shop.subscription.status === 'trial' && shop.subscription.validUntil && new Date(shop.subscription.validUntil) < now) {
            isExpired = true;
            Shop.updateOne({ _id: shop._id }, { 'subscription.status': 'expired' }).exec();
        } else if (shop.subscription.status === 'expired') isExpired = true;
        delete shop.credentials;
        shop.isExpired = isExpired;
        res.json(shop);
    } catch (e) { res.status(500).json({ error: "Error servidor" }); }
});

app.post('/api/admin/get', async (req, res) => {
    const { slug, password } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });
        if (shop.credentials.password !== password) return res.status(401).json({ error: "Contraseña incorrecta" });
        
        if (checkDailyReset(shop)) await shop.save();

        res.json(shop);
    } catch (e) { res.status(500).json({ error: "Error interno" }); }
});

app.post('/api/shop/:slug', async (req, res) => {
    const { slug } = req.params;
    const { password, data } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop) return res.status(404).json({ error: "No encontrado" });
        if (shop.credentials.password !== password) return res.status(403).json({ error: "No autorizado" });
        shop.config = data.config;
        shop.menu = data.menu;
        await shop.save();
        io.to(slug).emit('shop-updated', { message: 'Datos actualizados' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error al guardar" }); }
});

app.post('/api/utils/parse-map', async (req, res) => {
    const { input } = req.body;
    if (!input) return res.status(400).json({ error: "Entrada vacía" });
    try {
        if (input.includes('http') || input.includes('goo.gl') || input.includes('maps.app')) {
            const finalUrl = await resolveGoogleMapsLink(input);
            const regex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
            const match = finalUrl.match(regex);
            if (match) return res.json({ success: true, lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
        }
        const coords = await geocodeAddress(input);
        if (coords) return res.json({ success: true, lat: coords.lat, lng: coords.lng });
        res.status(400).json({ error: "No se encontraron coordenadas." });
    } catch (e) { res.status(500).json({ error: "Error procesando ubicación." }); }
});

// --- RUTAS NUEVAS PARA PEDIDOS (ORDERS) ---

// Obtener lista de pedidos
app.post('/api/orders/list', async (req, res) => {
    const { slug, password } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop || shop.credentials.password !== password) return res.status(401).json({ error: "No autorizado" });

        // Traer últimos 50 pedidos, del más nuevo al más viejo
        const orders = await Order.find({ shopSlug: slug }).sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, orders });
    } catch (e) { res.status(500).json({ error: "Error obteniendo pedidos" }); }
});

// Actualizar estado del pedido (Pendiente -> Completado)
app.post('/api/orders/update-status', async (req, res) => {
    const { slug, password, orderId, status } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop || shop.credentials.password !== password) return res.status(401).json({ error: "No autorizado" });

        await Order.findByIdAndUpdate(orderId, { status });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error actualizando" }); }
});

// --- RUTAS SUPER ADMIN ---

app.post('/api/superadmin/list', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_PASS) return res.status(403).json({ error: "Acceso denegado" });
    try {
        const shops = await Shop.find({}, 'slug config.name config.businessType stats subscription updatedAt createdAt credentials.contactPhone').sort({ createdAt: -1 });
        res.json({ success: true, shops });
    } catch (e) { res.status(500).json({ error: "Error interno" }); }
});

app.post('/api/superadmin/approve-payment', async (req, res) => {
    const { masterKey, slug, months } = req.body;
    if (masterKey !== SUPER_ADMIN_PASS) return res.status(403).json({ error: "Acceso denegado" });
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });
        const now = new Date();
        let startDate = (shop.subscription.validUntil && new Date(shop.subscription.validUntil) > now) ? new Date(shop.subscription.validUntil) : now;
        startDate.setMonth(startDate.getMonth() + parseInt(months));
        shop.subscription.status = 'active';
        shop.subscription.plan = 'pro_manual';
        shop.subscription.validUntil = startDate;
        await shop.save();
        res.json({ success: true, validUntil: startDate });
    } catch (e) { res.status(500).json({ error: "Error al activar" }); }
});

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'landing.html')); });
app.get('/tienda/:slug', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'admin.html')); });
app.get('/controladmin', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'controladmin.html')); });

server.listen(PORT, '0.0.0.0', () => { console.log(`🚀 Servidor MongoDB listo en puerto ${PORT}`); });
