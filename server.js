const express = require('express');
const http = require('http'); 
const { Server } = require("socket.io");
const mongoose = require('mongoose'); // Importamos Mongoose
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const https = require('https');

// Clave Secreta de Stripe (Test Mode)
const stripe = require('stripe')('sk_test_51SeMjIDaJNbMOGNThpOULS40g4kjVPcrTPagicSbV450bdvVR1QLQZNJWykZuIrBYLJzlxwnqORWTUstVKKYPlDL00kAw1uJfH');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000; // Render usa process.env.PORT

// --- CONEXIÓN A MONGODB ATLAS ---
const MONGO_URI = "mongodb+srv://daniel:daniel25@capacitacion.nxd7yl9.mongodb.net/?retryWrites=true&w=majority&appName=capacitacion&authSource=admin";

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado exitosamente a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a Mongo:', err));

// --- DEFINICIÓN DEL ESQUEMA (MODELO DE DATOS) ---
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
        orders: { type: Number, default: 0 } 
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
        groups: [mongoose.Schema.Types.Mixed] // Grupos de modificadores
    }
}, { timestamps: true }); // Agrega createdAt y updatedAt automáticamente

const Shop = mongoose.model('Shop', ShopSchema);

// --- MIDDLEWARES ---
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
// Servir archivos estáticos desde la raíz (para que encuentre style.css o scripts si los hubiera)
app.use(express.static(__dirname));

// --- SOCKET.IO EVENTS (TIEMPO REAL) ---
io.on('connection', (socket) => {
    socket.on('join-store', (slug) => { socket.join(slug); });
    
    // Nueva Visita (Incremento atómico en Mongo)
    socket.on('register-visit', async (slug) => {
        try {
            const shop = await Shop.findOneAndUpdate(
                { slug }, 
                { $inc: { 'stats.visits': 1 } }, 
                { new: true, fields: 'stats' }
            );
            if (shop) io.to(slug).emit('stats-update', shop.stats);
        } catch (e) { console.error("Error stats visit:", e); }
    });

    // Nuevo Pedido
    socket.on('register-order', async (slug) => {
        try {
            const shop = await Shop.findOneAndUpdate(
                { slug }, 
                { $inc: { 'stats.orders': 1 } }, 
                { new: true, fields: 'stats' }
            );
            if (shop) {
                io.to(slug).emit('stats-update', shop.stats);
                io.to(slug).emit('order-notification', { message: '¡Nuevo Pedido!' });
            }
        } catch (e) { console.error("Error stats order:", e); }
    });
});

// --- HELPERS ---
const getTemplateShop = (slug, name, owner, phone, address, whatsapp, password, businessType) => {
    const trialEnds = new Date();
    trialEnds.setDate(trialEnds.getDate() + 15);

    return {
        slug,
        credentials: { password, ownerName: owner, contactPhone: phone },
        subscription: { status: 'trial', plan: 'free', validUntil: trialEnds },
        stats: { visits: 0, orders: 0 },
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

// --- UTILIDADES MAPAS ---
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
    const domain = `${req.protocol}://${req.get('host')}`; // Detecta dominio automáticamente
    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [{ 
                price_data: { 
                    currency: 'mxn', 
                    product_data: { name: 'Plan Menú Digital PRO' }, 
                    unit_amount: 10000, // $100.00 MXN
                    recurring: { interval: 'month' } 
                }, 
                quantity: 1 
            }],
            success_url: `${domain}/api/subscription-success?slug=${slug}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${domain}/admin?canceled=true`,
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
            'subscription.validUntil': null // Indefinido mientras pague
        });
    }
    res.redirect('/admin?success=subscription');
});

// --- RUTAS API DEL SISTEMA ---

// REGISTRO
app.post('/api/register', async (req, res) => {
    const { slug, restaurantName, ownerName, phone, address, whatsapp, password, businessType } = req.body;
    console.log(`[REGISTER] Intento: ${slug}`);
    
    if (!slug || !restaurantName || !password) return res.status(400).json({ error: "Datos incompletos" });
    
    try {
        const existing = await Shop.findOne({ slug });
        if (existing) return res.status(400).json({ error: "Ese nombre de tienda ya existe." });

        const newShopData = getTemplateShop(slug, restaurantName, ownerName, phone, address, whatsapp, password, businessType);
        await Shop.create(newShopData);
        
        console.log(`[REGISTER] Creado: ${slug}`);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error interno" });
    }
});

// LOGIN (Simple Check)
app.post('/api/login', async (req, res) => {
    const { slug, password } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (shop && shop.credentials.password === password) res.json({ success: true });
        else res.status(401).json({ error: "Credenciales inválidas" });
    } catch (e) { res.status(500).json({ error: "Error" }); }
});

// GET TIENDA (PÚBLICO)
app.get('/api/shop/:slug', async (req, res) => {
    try {
        const shop = await Shop.findOne({ slug: req.params.slug }).lean(); // .lean() para objeto JS plano
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });

        // Verificar Vencimiento
        const now = new Date();
        let isExpired = false;
        if (shop.subscription.status === 'trial' && shop.subscription.validUntil && new Date(shop.subscription.validUntil) < now) {
            isExpired = true;
            // Actualizar DB sin bloquear respuesta
            Shop.updateOne({ _id: shop._id }, { 'subscription.status': 'expired' }).exec();
        } else if (shop.subscription.status === 'expired') {
            isExpired = true;
        }

        // Limpiar credenciales antes de enviar
        delete shop.credentials;
        shop.isExpired = isExpired;

        res.json(shop);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error servidor" });
    }
});

// ADMIN GET (CON LOGIN)
app.post('/api/admin/get', async (req, res) => {
    const { slug, password } = req.body;
    try {
        const shop = await Shop.findOne({ slug }); // Mongoose Document
        
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });
        if (shop.credentials.password !== password) return res.status(401).json({ error: "Contraseña incorrecta" });

        // Chequeo de expiración al login
        const now = new Date();
        if (shop.subscription.status === 'trial' && shop.subscription.validUntil && new Date(shop.subscription.validUntil) < now) {
            shop.subscription.status = 'expired';
            await shop.save();
        }

        res.json(shop);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error interno" });
    }
});

// GUARDAR CAMBIOS (ADMIN)
app.post('/api/shop/:slug', async (req, res) => {
    const { slug } = req.params;
    const { password, data } = req.body;
    
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop) return res.status(404).json({ error: "No encontrado" });
        if (shop.credentials.password !== password) return res.status(403).json({ error: "No autorizado" });

        // Actualizar campos permitidos
        shop.config = data.config;
        shop.menu = data.menu;
        
        // Mongoose maneja la mezcla de objetos, pero para Arrays anidados reemplazamos completo
        await shop.save();
        
        io.to(slug).emit('shop-updated', { message: 'Datos actualizados' });
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Error al guardar" });
    }
});

// UTILIDAD MAPAS
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

// RUTAS VISTAS (CORREGIDAS PARA ARCHIVOS EN RAÍZ)
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'landing.html')); });
app.get('/tienda/:slug', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/admin', (req, res) => { res.sendFile(path.join(__dirname, 'admin.html')); });

server.listen(PORT, '0.0.0.0', () => { console.log(`🚀 Servidor MongoDB listo en puerto ${PORT}`); });
