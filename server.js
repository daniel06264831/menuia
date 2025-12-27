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

// CLAVES API
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_51SeMjIDaJNbMOGNThpOULS40g4kjVPcrTPagicSbV450bdvVR1QLQZNJWykZuIrBYLJzlxwnqORWTUstVKKYPlDL00kAw1uJfH';

// ==========================================
// 🔵 MODO RENDER (VARIABLES DE ENTORNO) 🔵
// El servidor leerá la clave desde la configuración de Render.
// NO escribas tu clave aquí.
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://daniel:daniel25@capacitacion.nxd7yl9.mongodb.net/?retryWrites=true&w=majority&appName=capacitacion&authSource=admin";

// Inicializar Stripe
let stripe;
try {
    stripe = require('stripe')(STRIPE_KEY);
} catch (e) {
    console.warn("⚠️ Stripe no se pudo inicializar (Revisar Clave). El resto del servidor funcionará.");
}

// Validación de Node.js para fetch
if (!globalThis.fetch) {
    console.warn("⚠️ ADVERTENCIA: Tu versión de Node.js es antigua y no soporta 'fetch' nativo.");
    console.warn("   La IA podría fallar. Por favor actualiza a Node.js 18+ o instala 'node-fetch'.");
}

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Conectado exitosamente a MongoDB Atlas'))
    .catch(err => console.error('❌ Error conectando a Mongo:', err));

// --- SCHEMAS ---

// 1. Schema Tienda (Dueños)
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
        
        // Alta Demanda
        highDemand: { type: Boolean, default: false },
        highDemandTime: String,

        shipping: { freeThreshold: Number, freeKm: Number, maxRadius: Number, costPerKm: Number },
        bank: { name: String, clabe: String, owner: String },
        bankDetails: { name: String, clabe: String, owner: String },
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

// 2. Schema Pedidos (Historial)
const OrderSchema = new mongoose.Schema({
    shopSlug: { type: String, required: true, index: true },
    dailyId: { type: Number, default: 0 },
    ref: String,
    customerPhone: String,
    address: String,
    paymentMethod: String,
    type: String,
    items: [mongoose.Schema.Types.Mixed], 
    total: String, 
    status: { type: String, default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);

// 3. Schema Clientes (Usuarios Finales)
const CustomerSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    address: String,
    createdAt: { type: Date, default: Date.now }
});

const Customer = mongoose.model('Customer', CustomerSchema);


app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// --- MODO API BACKEND ---
// Comentamos esto porque tu frontend está en un HOSTING EXTERNO.
// app.use(express.static(path.join(__dirname, 'public')));
// app.use(express.static(__dirname));

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

    socket.on('register-order', async (payload) => {
        let slug = payload;
        let orderData = null;

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

                let newOrder = null;
                if (orderData) {
                    const startOfDay = new Date();
                    startOfDay.setHours(0,0,0,0);
                    
                    const countToday = await Order.countDocuments({
                        shopSlug: slug,
                        createdAt: { $gte: startOfDay }
                    });

                    newOrder = await Order.create({
                        shopSlug: slug,
                        dailyId: countToday + 1,
                        ref: orderData.ref,
                        customerPhone: orderData.customerPhone,
                        address: orderData.address,
                        paymentMethod: orderData.paymentMethod,
                        type: orderData.type || 'llevar',
                        items: orderData.items,
                        total: orderData.total,
                        status: orderData.status || 'pending',
                        createdAt: new Date()
                    });
                    
                    io.to(slug).emit('new-order-saved');
                    io.to(slug).emit('order-created-client', newOrder);
                }

                io.to(slug).emit('stats-update', shop.stats);
                io.to(slug).emit('order-notification', { message: '¡Nuevo Pedido!' });
            }
        } catch (e) { console.error("Error stats order:", e); }
    });

    socket.on('disconnect', () => {});
});

// --- API IA (GOOGLE GEMINI) ---
app.post('/api/ai/generate', async (req, res) => {
    const { task, context } = req.body;
    
    // Verificación de seguridad
    if (!GEMINI_API_KEY) {
        console.error("❌ ERROR IA: No se encontró la variable GEMINI_API_KEY en Render.");
        return res.status(500).json({ error: "Configuración de servidor incompleta (Falta API Key)." });
    }

    // Construcción del Prompt
    let prompt = "";
    if (task === 'product_description') {
        prompt = `Eres un experto copywriter gastronómico. Escribe una descripción corta, apetitosa y atractiva (máximo 30 palabras) para un producto llamado "${context.productName}". Usa emojis relevantes.`;
    } else if (task === 'business_insight') {
        prompt = `Actúa como un consultor de negocios experto. Analiza estas estadísticas breves: ${JSON.stringify(context.stats)} para un negocio de tipo "${context.businessType}". Dame UN solo consejo estratégico, breve y accionable (máximo 20 palabras) para mejorar ventas hoy.`;
    } else if (task === 'social_post') {
        prompt = `Eres un community manager experto. Escribe un post para redes sociales (Instagram/Facebook) para el negocio "${context.shopName}". El estilo debe ser: ${context.style}. Incluye emojis y hashtags. Máximo 280 caracteres.`;
    } else if (task === 'optimize_hours') {
        prompt = `Para un negocio de tipo "${context.businessType}", sugiere un horario de apertura y cierre óptimo basado en estándares de la industria. Responde SOLAMENTE con un objeto JSON válido en este formato exacto, sin markdown ni explicaciones: {"open": 9, "close": 23}`;
    
    // --- NUEVA TAREA: CHAT DE MENÚ (REAL) ---
    } else if (task === 'menu_chat') {
        // Limitamos el contexto del menú para no saturar el token limit, enviando solo nombres y descripciones.
        const menuSummary = context.menu.map(i => `${i.name} ($${i.price}): ${i.description || ''}`).join('\n');
        
        prompt = `Eres un mesero virtual amigable y experto llamado "IA Chef".
        
        MENÚ DISPONIBLE:
        ${menuSummary}

        USUARIO DICE: "${context.message}"

        TU TAREA:
        1. Responde al usuario recomendando 1 o 2 productos específicos del menú anterior.
        2. Sé breve (máximo 40 palabras), usa emojis y sé persuasivo.
        3. Si el usuario saluda, saluda y ofrece ayuda.
        4. Si el usuario pide algo que NO está en el menú, sugiere amablemente algo parecido que SÍ esté.
        `;
    } else {
        return res.status(400).json({ error: "Tarea no reconocida" });
    }

    try {
        if (!globalThis.fetch) throw new Error("Fetch no soportado.");

        console.log(`🤖 Enviando petición a Gemini (${task})...`);

        const modelName = 'gemini-2.5-flash';
        
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error Google API: ${errorText}`);
            return res.status(response.status).json({ error: "Error conectando con la IA de Google." });
        }

        const data = await response.json();

        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            let resultText = data.candidates[0].content.parts[0].text;

            if (task === 'optimize_hours') {
                try {
                    resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();
                    const jsonResult = JSON.parse(resultText);
                    return res.json({ success: true, result: jsonResult });
                } catch (e) {
                    return res.json({ success: true, result: { open: 9, close: 22 } });
                }
            }

            res.json({ success: true, result: resultText });
        } else {
            res.status(500).json({ error: "La IA no devolvió respuesta." });
        }
    } catch (e) {
        console.error("❌ Error IA:", e.message);
        res.status(500).json({ error: e.message });
    }
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
            bank: { "name": "Banco", "clabe": "000000000000000000", "owner": name },
            highDemand: false,
            highDemandTime: ""
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

const reverseGeocode = (lat, lng) => {
    return new Promise((resolve, reject) => {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        https.get(url, { headers: { 'User-Agent': 'MiPlataforma/1.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { 
                    const json = JSON.parse(data); 
                    if (json && json.display_name) resolve(json.display_name); 
                    else resolve(null); 
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
};

const geocodeAddress = (address) => {
    return new Promise((resolve, reject) => {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
        https.get(url, { headers: { 'User-Agent': 'MiPlataforma/1.0' } }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { 
                    const json = JSON.parse(data); 
                    if (json && json.length > 0) {
                        resolve({ 
                            lat: parseFloat(json[0].lat), 
                            lng: parseFloat(json[0].lon),
                            address: json[0].display_name 
                        }); 
                    } else resolve(null); 
                } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
};

// --- RUTAS API TIENDAS ---

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
        if (input.includes('http') || input.includes('goo.gl') || input.includes('maps.app') || input.includes('google.com/maps')) {
            const finalUrl = await resolveGoogleMapsLink(input);
            const regex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
            const match = finalUrl.match(regex);
            
            if (match) {
                const lat = parseFloat(match[1]);
                const lng = parseFloat(match[2]);
                let address = "";

                try {
                    const realAddress = await reverseGeocode(lat, lng);
                    if (realAddress) {
                        address = realAddress;
                    } else {
                        if (finalUrl.includes('/place/')) {
                            const parts = finalUrl.split('/place/')[1].split('/')[0];
                            address = decodeURIComponent(parts).replace(/\+/g, ' ');
                        }
                    }
                } catch (e) { console.log("Error en reverse geocoding"); }

                return res.json({ success: true, lat: lat, lng: lng, address: address || undefined });
            }
        }

        const coords = await geocodeAddress(input);
        if (coords) {
            return res.json({ success: true, lat: coords.lat, lng: coords.lng, address: coords.address });
        }

        res.status(400).json({ error: "No se encontraron coordenadas." });
    } catch (e) { res.status(500).json({ error: "Error procesando ubicación." }); }
});

// --- RUTAS NUEVAS: CLIENTES ---
app.post('/api/customer/register', async (req, res) => {
    const { name, phone, password, address } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: "Faltan datos requeridos" });
    try {
        const existing = await Customer.findOne({ phone });
        if (existing) return res.status(400).json({ error: "Este número ya está registrado." });
        const customer = await Customer.create({ name, phone, password, address: address || "" });
        res.json({ success: true, customer: { name: customer.name, phone: customer.phone, address: customer.address } });
    } catch (e) { res.status(500).json({ error: "Error al registrar cliente" }); }
});

app.post('/api/customer/login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: "Faltan datos" });
    try {
        const customer = await Customer.findOne({ phone });
        if (customer && customer.password === password) {
            res.json({ success: true, customer: { name: customer.name, phone: customer.phone, address: customer.address } });
        } else {
            res.status(401).json({ error: "Credenciales inválidas" });
        }
    } catch (e) { res.status(500).json({ error: "Error en el servidor" }); }
});

// --- RUTAS PEDIDOS ---
app.post('/api/orders/list', async (req, res) => {
    const { slug, password, limit, startDate, endDate } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop || shop.credentials.password !== password) return res.status(401).json({ error: "No autorizado" });
        
        let query = { shopSlug: slug };
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const maxLimit = limit ? parseInt(limit) : 100;
        const orders = await Order.find(query).sort({ createdAt: -1 }).limit(maxLimit);
        res.json({ success: true, orders });
    } catch (e) { res.status(500).json({ error: "Error obteniendo pedidos" }); }
});

app.post('/api/orders/update-status', async (req, res) => {
    const { slug, password, orderId, status } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop || shop.credentials.password !== password) return res.status(401).json({ error: "No autorizado" });
        await Order.findByIdAndUpdate(orderId, { status });
        io.to(slug).emit('order-status-updated', { orderId, status });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Error actualizando" }); }
});

app.post('/api/analytics/summary', async (req, res) => {
    const { slug, password } = req.body;
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop || shop.credentials.password !== password) return res.status(401).json({ error: "No autorizado" });

        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const monthlyOrders = await Order.find({ shopSlug: slug, createdAt: { $gte: startOfMonth } }).select('total createdAt status');

        let salesToday = 0;
        let salesMonth = 0;
        const last7Days = {};
        for(let i=6; i>=0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days[d.toLocaleDateString('en-US', {weekday: 'short'})] = 0;
        }

        monthlyOrders.forEach(o => {
            let val = 0;
            if(typeof o.total === 'string') val = parseFloat(o.total.replace(/[^0-9.-]+/g,""));
            else if (typeof o.total === 'number') val = o.total;
            if(isNaN(val)) val = 0;
            
            salesMonth += val;
            if(o.createdAt >= startOfDay) salesToday += val;

            const dayKey = new Date(o.createdAt).toLocaleDateString('en-US', {weekday: 'short'});
            if (last7Days[dayKey] !== undefined) last7Days[dayKey] += val;
        });

        res.json({ success: true, salesToday, salesMonth, orderCountMonth: monthlyOrders.length, chartData: last7Days });
    } catch (e) { res.status(500).json({ error: "Error calculando finanzas" }); }
});

app.get('/api/shops/public', async (req, res) => {
    try {
        const shops = await Shop.find({}, 'slug config.name config.businessType config.heroImage config.hours config.address config.coords config.highDemand').lean();
        res.json({ success: true, shops });
    } catch (e) { res.status(500).json({ error: "Error al obtener tiendas" }); }
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

// --- MODO API: RUTAS FRONTEND ELIMINADAS ---
// No servimos archivos estáticos. Solo un JSON de bienvenida.

app.get('/', (req, res) => { 
    res.json({ 
        status: "Online", 
        message: "Servidor API Backend funcionando correctamente 🚀", 
        info: "El frontend (HTML) debe estar alojado en un hosting externo (ej: Netlify/Vercel)." 
    }); 
});

server.listen(PORT, '0.0.0.0', () => { console.log(`🚀 Servidor MongoDB listo en puerto ${PORT}`); });
