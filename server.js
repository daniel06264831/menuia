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
// Confía en el proxy de Render/Cloudflare para obtener la IP real
app.set('trust proxy', 1);

const server = http.createServer(app);

// MIDDLEWARE GLOBAL
app.use(cors({
    origin: '*', // Permite conexiones desde tu hosting y localhost
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// LOGGING MIDDLEWARE - Para debugging en Render
app.use((req, res, next) => {
    console.log(`[REQUEST] ${req.method} ${req.url}`);
    next();
});

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
// CLAVES API - LIVE KEY PROVIDED BY USER




// ==========================================
// 🔵 MODO RENDER (VARIABLES DE ENTORNO) 🔵
// El servidor leerá la clave desde la configuración de Render.
// NO escribas tu clave aquí.
// ==========================================
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://daniel:daniel25@capacitacion.nxd7yl9.mongodb.net/?retryWrites=true&w=majority&appName=capacitacion&authSource=admin";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) console.error("⚠️ FATAL: STRIPE_SECRET_KEY no está definida en las variables de entorno.");
const stripe = require('stripe')(STRIPE_SECRET_KEY);




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
        logo: String, // Logo del Negocio
        coords: { lat: Number, lng: Number },
        hours: { open: Number, close: Number },
        prepTime: { type: String, default: "30-45 min" },

        // Alta Demanda
        highDemand: { type: Boolean, default: false },
        highDemandTime: String,

        // Manual Open/Close
        isOpen: { type: Boolean, default: true },

        // Destacado Manualmente (Top Shops)
        isFeatured: { type: Boolean, default: false },

        // Marca Popular (Carrusel Marcas)
        isPopularBrand: { type: Boolean, default: false },

        shipping: {
            freeShippingActive: { type: Boolean, default: false },
            freeShippingThreshold: { type: Number, default: 0 },
            freeThreshold: Number, // Legacy support if needed, but primary is freeShippingThreshold
            freeKm: Number,
            maxRadius: Number,
            costPerKm: Number
        },
        bank: { name: String, clabe: String, owner: String },
        bankDetails: { name: String, clabe: String, owner: String },
        // NEW: Dynamic Categories List
        categories: {
            type: [
                {
                    id: String,
                    name: String,
                    isDefault: { type: Boolean, default: false }
                }
            ],
            default: []
        },
        categoryTitles: {
            promos: { type: String, default: "🔥 Promociones" },
            especiales: { type: String, default: "⭐ Recomendados" },
            clasicos: { type: String, default: "🍽️ Menú Principal" },
            extras: { type: String, default: "🥤 Bebidas y Otros" }
        }
    },
    menu: { type: mongoose.Schema.Types.Mixed, default: {} },
    // New Advanced Promotions Module
    promotions: [mongoose.Schema.Types.Mixed]
}, { timestamps: true });

const Shop = mongoose.model('Shop', ShopSchema);

// 2. Schema Pedidos (Historial)
const OrderSchema = new mongoose.Schema({
    shopSlug: { type: String, required: true, index: true },
    dailyId: { type: Number, default: 0 },
    ref: String,
    customerName: String, // NEW
    customerPhone: String,
    address: String,
    note: String, // NEW: Delivery Note
    paymentMethod: String,
    type: String,
    items: [mongoose.Schema.Types.Mixed],
    costs: { // NEW: Financial Breakdown
        subtotal: Number,
        tip: Number,
        shipping: Number,
        service: Number,
        total: Number
    },
    total: String,
    status: { type: String, default: 'pending' },
    // DRIVER INFO
    driverId: { type: mongoose.Schema.Types.ObjectId, ref: 'DeliveryPartner' },
    driverName: String,
    driverPhone: String,
    deliveryStatus: { type: String, default: 'pending_assignment' }, // pending_assignment, to_store, at_store, on_way, delivered
    shopCoords: { lat: Number, lng: Number },
    shopName: String,
    createdAt: { type: Date, default: Date.now }
});

const Order = mongoose.model('Order', OrderSchema);

// 3. Schema Clientes (Usuarios Finales)
const CustomerSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    password: { type: String, required: true },
    address: String,
    // NUEVO CAMPO: Gustos aprendidos por la IA
    tastes: {
        items: [String],      // Ej: ["Pizza Hawaiana", "Sushi Roll"]
        categories: { type: Map, of: Number } // Ej: { "Sushi": 5, "Pizza": 2 }
    },
    profileImage: String, // Base64 image
    createdAt: { type: Date, default: Date.now }
});

const Customer = mongoose.model('Customer', CustomerSchema);

// 4. Schema Repartidores (Drivers)
const DeliveryPartnerSchema = new mongoose.Schema({
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    vehicle: { type: String, default: 'Moto' }, // Moto, Bici, Auto
    status: { type: String, default: 'offline' }, // offline, online, busy
    currentLocation: {
        lat: Number,
        lng: Number,
        updatedAt: Date
    },
    earnings: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

const DeliveryPartner = mongoose.model('DeliveryPartner', DeliveryPartnerSchema);


app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));

// --- MODO API BACKEND + FRONTEND ---
// Habilitamos esto para que la App Android pueda cargar el HTML desde Render
app.use(express.static(__dirname));

// --- INTELLIGENT DISPATCHER & GEO UTILS ---
const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
};

const distributeOrder = async (order, force = false) => {
    try {
        if (!order.shopCoords || !order.shopCoords.lat) {
            console.log("⚠️ Order missing shop coords, broadcasting to all online.");
            io.to('drivers').emit('new-request', order);
            return;
        }

        // 1. Get Candidates (Online or Busy)
        // We include busy to check for batching opportunities
        const candidates = await DeliveryPartner.find({
            status: { $in: ['online', 'busy'] },
            currentLocation: { $exists: true }
        });

        const scoredDrivers = [];

        for (const driver of candidates) {
            // A. Distance Check
            const dist = calculateDistance(
                driver.currentLocation.lat, driver.currentLocation.lng,
                order.shopCoords.lat, order.shopCoords.lng
            );

            // Constraint: Max 3km (unless force/retry mode)
            const maxDist = force ? 10 : 3;
            if (dist > maxDist) continue;

            let score = 100;

            // B. Distance Factor (Closer is better)
            // -10 points per km
            score -= (dist * 10);

            // C. Batching Logic (The "AI" part)
            // Check if driver is busy with an order from THE SAME RESTAURANT
            if (driver.status === 'busy') {
                const activeOrders = await Order.find({
                    driverId: driver._id,
                    status: { $in: ['driver_assigned', 'to_store', 'at_store'] } // only if not yet delivered
                });

                if (activeOrders.length > 0) {
                    // Check if any active order is from the same shop
                    const sameShop = activeOrders.some(o => o.shopSlug === order.shopSlug);
                    if (sameShop) {
                        // HUGE BOOST for batching (Assign multiples to same driver)
                        score += 500;
                        console.log(`🚀 Oportunidad de Batching para ${driver.name}`);
                    } else {
                        // Driver is busy with OTHER shop -> Exclude for now
                        continue;
                    }
                }
            }

            // D. Equity / Randomness (To avoid same driver getting all requests if others are close)
            // Agregamos un factor aleatorio de 0-20 puntos para distribuir equitativamente
            score += Math.random() * 20;

            scoredDrivers.push({ driver, score, dist });
        }

        // Sort by Score DESC
        scoredDrivers.sort((a, b) => b.score - a.score);

        // Emit to Top Candidates
        if (scoredDrivers.length > 0) {
            console.log(`✅ Distribuyendo orden ${order.ref} a ${scoredDrivers.length} conductores.`);

            scoredDrivers.forEach(d => {
                console.log(`   -> ${d.driver.name}: Score ${d.score.toFixed(0)}, Dist ${d.dist.toFixed(2)}km`);
                // Send specific event to their private room
                io.to(`driver_${d.driver._id}`).emit('new-request', order);
            });
        } else {
            console.log("⚠️ No hay conductores válidos cerca (<3km).");
            if (force) {
                // Last resort: Broadcast to all online
                io.to('drivers').emit('new-request', order);
            }
        }

    } catch (e) {
        console.error("Error distributing order:", e);
        // Fail-safe
        io.to('drivers').emit('new-request', order);
    }
};

// --- HELPERS stats DIARIOS ---
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
            // RULE: Limit 1 Active Cash Order
            if (orderData && orderData.paymentMethod === 'Efectivo') {
                const activeCash = await Order.countDocuments({
                    customerPhone: orderData.customerPhone,
                    status: { $nin: ['completed', 'cancelled', 'rejected'] },
                    paymentMethod: 'Efectivo'
                });
                if (activeCash >= 1) {
                    return socket.emit('order-error', { message: "❌ Ya tienes un pedido en Efectivo activo. Espera a que finalice." });
                }
            }

            let shop = await Shop.findOne({ slug });
            if (shop) {
                checkDailyReset(shop);
                shop.stats.orders += 1;
                await shop.save();

                let newOrder = null;
                if (orderData) {
                    const startOfDay = new Date();
                    startOfDay.setHours(0, 0, 0, 0);


                    const countToday = await Order.countDocuments({
                        shopSlug: slug,
                        createdAt: { $gte: startOfDay }
                    });

                    newOrder = await Order.create({
                        shopSlug: slug,
                        dailyId: countToday + 1,
                        ref: orderData.ref,
                        customerName: orderData.customerName || 'Cliente',
                        customerPhone: orderData.customerPhone || '5500000000',
                        shopName: shop.config.name, // Helpful for UI
                        shopCoords: shop.config.coords, // CRITICAL FOR DISTANCE
                        address: orderData.address,
                        note: orderData.note || '',
                        paymentMethod: orderData.paymentMethod || 'Efectivo',
                        type: orderData.type || 'delivery',
                        items: orderData.items,
                        paymentMethod: orderData.paymentMethod || 'Efectivo',
                        type: orderData.type || 'delivery',
                        items: orderData.items,
                        costs: orderData.costs || { subtotal: 0, tip: 0, shipping: 35, total: orderData.total }, // Ensure structure
                        total: orderData.total,
                        status: orderData.status || 'pending',
                        status: orderData.status || 'pending',
                        deliveryStatus: 'pending_assignment', // Default for new orders
                        createdAt: new Date()
                    });


                    // INTELLIGENT DISTRIBUTION LOGIC
                    if (newOrder.type === 'delivery') {
                        distributeOrder(newOrder);

                        // Retry logic (Fallback to wider range or re-notify after 2 min)
                        setTimeout(async () => {
                            const checkOrder = await Order.findById(newOrder._id);
                            if (checkOrder && checkOrder.deliveryStatus === 'pending_assignment' && checkOrder.status !== 'cancelled') {
                                console.log(`🔄 Re-trying distribution for Order ${checkOrder.ref}`);
                                distributeOrder(checkOrder, true); // true = force/widen search
                            }
                        }, 120000);
                    }

                    io.to(slug).emit('new-order-saved');
                    io.to(slug).emit('order-created-client', newOrder);
                }

                io.to(slug).emit('stats-update', shop.stats);
                io.to(slug).emit('order-notification', { message: '¡Nuevo Pedido!' });
            }
        } catch (e) { console.error("Error stats order:", e); }
    });

    socket.on('disconnect', () => { });

    // --- DRIVER SOCKET EVENTS ---
    socket.on('driver-login', async (data) => {
        const { phone, password } = data;
        const driver = await DeliveryPartner.findOne({ phone, password });
        if (driver) {
            socket.join('drivers'); // General room for broadcasting available orders
            socket.join(`driver_${driver._id}`); // Private room
            socket.emit('login-success', driver);

            // Send any pending orders immediately (INTELLIGENT FILTER)
            const pendingOrders = await Order.find({ type: 'delivery', deliveryStatus: 'pending_assignment' });
            pendingOrders.forEach(o => {
                if (driver.currentLocation && o.shopCoords) {
                    const d = calculateDistance(driver.currentLocation.lat, driver.currentLocation.lng, o.shopCoords.lat, o.shopCoords.lng);
                    if (d <= 3) {
                        socket.emit('new-request', o);
                    }
                }
            });

            // CHECK & SEND ACTIVE ORDER (Persistence Fix)
            const activeOrder = await Order.findOne({
                driverId: driver._id,
                status: { $in: ['driver_assigned', 'to_store', 'at_store', 'on_way'] }
            });
            if (activeOrder) {
                socket.emit('order-accepted', activeOrder);
            }

        } else {
            socket.emit('login-failed');
        }
    });

    socket.on('driver-online', async (driverId) => {
        await DeliveryPartner.findByIdAndUpdate(driverId, { status: 'online' });
        socket.join('drivers');

        // Send pending orders to this driver who just came online (INTELLIGENT FILTER)
        const driver = await DeliveryPartner.findById(driverId); // Need to fetch loc
        const pendingOrders = await Order.find({ type: 'delivery', deliveryStatus: 'pending_assignment' });
        pendingOrders.forEach(o => {
            if (driver && driver.currentLocation && o.shopCoords) {
                const d = calculateDistance(driver.currentLocation.lat, driver.currentLocation.lng, o.shopCoords.lat, o.shopCoords.lng);
                if (d <= 3) {
                    socket.emit('new-request', o);
                }
            }
        });

        // CHECK & SEND ACTIVE ORDER (Persistence Fix)
        const activeOrder = await Order.findOne({
            driverId: driverId,
            status: { $in: ['driver_assigned', 'to_store', 'at_store', 'on_way'] }
        });
        if (activeOrder) {
            socket.emit('order-accepted', activeOrder);
        }
    });

    socket.on('driver-offline', async (driverId) => {
        await DeliveryPartner.findByIdAndUpdate(driverId, { status: 'offline' });
        socket.leave('drivers');
    });

    socket.on('driver-location', async ({ driverId, lat, lng }) => {
        await DeliveryPartner.findByIdAndUpdate(driverId, {
            currentLocation: { lat, lng, updatedAt: new Date() }
        });

        // Broadcast to Client tracking this driver
        // Find active order for this driver
        const activeOrder = await Order.findOne({
            driverId: driverId,
            status: { $in: ['driver_assigned', 'on_way', 'to_store', 'at_store'] },
            deliveryStatus: { $ne: 'delivered' }
        });

        if (activeOrder) {
            io.to(activeOrder.shopSlug).emit('driver-moved', {
                orderId: activeOrder._id,
                driverId,
                lat,
                lng
            });
        }
    });

    socket.on('accept-order', async ({ driverId, orderId }) => {
        // Atomic check to prevent double booking
        const order = await Order.findOne({ _id: orderId, driverId: { $exists: false } });
        if (order) {
            const driver = await DeliveryPartner.findById(driverId);
            order.driverId = driverId;
            order.driverName = driver.name;
            order.driverPhone = driver.phone;
            order.deliveryStatus = 'to_store';
            order.status = 'driver_assigned'; // Update main status too so Shop sees it
            await order.save();

            await DeliveryPartner.findByIdAndUpdate(driverId, { status: 'busy' });

            // Notify Driver
            socket.emit('order-accepted', order);
            // Notify Shop
            io.to(order.shopSlug).emit('order-update', order);
            io.to(order.shopSlug).emit('driver-assigned', { orderId, driverName: driver.name });

            // Notify ALL drivers to remove the request
            socket.to('drivers').emit('order-taken', { message: 'Pedido tomado por otro conductor', orderId });
            // Notify User (future implementation via socket room for user)
        } else {
            socket.emit('order-taken', { message: "Esta orden ya fue tomada por otro repartidor." });
        }
    });

    socket.on('update-order-step', async ({ orderId, step }) => {
        // step: 'at_store', 'on_way', 'delivered'
        const order = await Order.findById(orderId);
        if (order) {
            order.deliveryStatus = step;
            if (step === 'delivered') {
                order.status = 'completed';
                await DeliveryPartner.findByIdAndUpdate(order.driverId, { status: 'online', $inc: { earnings: 35 } }); // Mock earning
            }
            await order.save();

            // Notify Shop
            io.to(order.shopSlug).emit('order-update', order);

            // Notify Driver (confirmation)
            socket.emit('order-step-updated', { orderId, step });
        }
    });

    socket.on('get-driver-history', async (driverId) => {
        try {
            // Fetch last 50 completed orders
            const history = await Order.find({
                driverId: driverId,
                status: { $in: ['completed'] }
            })
                .sort({ createdAt: -1 })
                .limit(50);

            socket.emit('driver-history-data', history);
        } catch (e) { console.error(e); }
    });
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
        prompt = `Eres un experto copywriter de ventas. Escribe una descripción corta, atractiva y persuasiva (máximo 30 palabras) para un producto llamado "${context.productName}". Ajusta el tono según el producto (si es comida, apetitoso; si es farmacia, confiable; etc.). Usa emojis.`;
    } else if (task === 'business_insight') {
        prompt = `Actúa como un consultor de negocios experto. Analiza estas estadísticas breves: ${JSON.stringify(context.stats)} para un negocio de tipo "${context.businessType}". Dame UN solo consejo estratégico, breve y accionable (máximo 20 palabras) para mejorar ventas hoy.`;
    } else if (task === 'social_post') {
        prompt = `Eres un community manager experto. Escribe un post para redes sociales (Instagram/Facebook) para el negocio "${context.shopName}". El estilo debe ser: ${context.style}. Incluye emojis y hashtags. Máximo 280 caracteres.`;
    } else if (task === 'optimize_hours') {
        prompt = `Para un negocio de tipo "${context.businessType}", sugiere un horario de apertura y cierre óptimo basado en estándares de la industria. Responde SOLAMENTE con un objeto JSON válido en este formato exacto, sin markdown ni explicaciones: {"open": 9, "close": 23}`;
    } else if (task === 'chef_chat') {
        // --- NUEVO TASK: ASISTENTE DE TIENDA (Multigiro) ---
        const bType = context.businessType || 'Restaurante';
        const isFood = bType.toLowerCase().includes('comida') || bType.toLowerCase().includes('restaurante') || bType.toLowerCase().includes('sushi') || bType.toLowerCase().includes('pizza');

        let persona = isFood
            ? 'Eres un "Mesero Virtual" súper amable y carismático 🤵. Recomienda platillos deliciosos.'
            : 'Eres un "Asistente de Tienda" experto y servicial 🏪. Ayuda a encontrar el producto ideal.';

        const menuSummary = (context.menu || []).map(i => `${i.name} ($${i.price})`).join(', ');
        prompt = `
        ${persona}
        Giro del Negocio: ${bType}.
        
        INVENTARIO / MENÚ DISPONIBLE:
        ${menuSummary}
        
        USUARIO DICE: "${context.userMsg}"
        
        INSTRUCCIONES:
        1. Responde de forma cálida y breve (máx 40 palabras).
        2. Basa tu recomendación SOLO en el inventario disponible arriba.
        3. Si es comida, menciona el sabor. Si es otro producto, menciona su utilidad.
        4. Usa emojis.
        `;
    } else if (task === 'marketplace_assistant') {
        const shopsSummary = (context.shops || []).map(s => `- ${s.name} (${s.type})`).join('\n');
        prompt = `
        Eres un Guía Local experto 🗺️. Alguien te pregunta dónde comprar o comer.

        COMERCIOS DISPONIBLES:
        ${shopsSummary}

        USUARIO DICE: "${context.userMsg}"

        INSTRUCCIONES:
        1. Responde con naturalidad y entusiasmo (ej. "¡Uff, tienes que ir a...", "Sin duda prueba...").
        2. Guíalos a una tienda específica de la lista.
        3. Sé breve y directo.
        4. Usa emojis divertidos (🌮🔥).
        `;
    } else {
        return res.status(400).json({ error: "Tarea no reconocida" });
    }

    try {
        if (!globalThis.fetch) throw new Error("Fetch no soportado.");

        console.log(`🤖 Enviando petición a Gemini (${task})...`);

        async function callGemini(model) {
            // Log para debuggear 404
            console.log(`🤖 Intentando modelo: ${model}`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            if (!r.ok) {
                // Si es 404, es muy probable que el nombre del modelo esté mal o la API Key no tenga acceso a este modelo específico
                const txt = await r.text();
                throw new Error(`Model ${model} failed (${r.status}): ${txt}`);
            }
            return r;
        }

        let response;
        try {
            // Intento 1: Modelo SOLICITADO POR USUARIO (gemini-2.5-flash)
            // Si el usuario tiene acceso a este modelo específico, funcionará.
            response = await callGemini('gemini-2.5-flash');
        } catch (e) {
            console.warn(`⚠️ Fallback: gemini-2.5-flash falló (${e.message}). Intentando 1.5-pro...`);
            try {
                // Intento 2: Gemini 1.5 Pro (Fallback potente)
                response = await callGemini('gemini-1.5-pro');
            } catch (e2) {
                console.warn(`⚠️ Fallback: 1.5-pro falló (${e2.message}). Intentando flash...`);
                try {
                    // Intento 3: Gemini 1.5 Flash (Fallback rápido)
                    response = await callGemini('gemini-1.5-flash');
                } catch (e3) {
                    console.error("❌ Todos los modelos fallaron.", e3);
                    return res.status(503).json({ error: "No pudimos conectar con nigún modelo de IA. Verifica tu API Key y acceso a modelos." });
                }
            }
        }


        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error Google API: ${errorText}`);
            return res.status(response.status).json({ error: "Error conectando con la IA de Google." });
        }

        const data = await response.json();

        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content) {
            let resultText = data.candidates[0].content.parts[0].text;

            // Limpieza de JSON para horarios
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
            logo: "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
            coords: { "lat": 20.648325, "lng": -103.267706 },
            hours: { "open": 9, "close": 23 },
            prepTime: "30-45 min",
            shipping: { "freeThreshold": 0, "freeKm": 5.0, "maxRadius": 10.0, "costPerKm": 11 },
            bank: { "name": "Banco", "clabe": "000000000000000000", "owner": name },
            highDemand: false,
            highDemandTime: "",
            isOpen: true,
            // DEFAULT CATEGORIES
            categories: [
                { id: 'promos', name: '🔥 Promociones', isDefault: true },
                { id: 'especiales', name: '⭐ Recomendados', isDefault: true },
                { id: 'clasicos', name: '🍽️ Menú Principal', isDefault: true },
                { id: 'extras', name: '🥤 Bebidas y Otros', isDefault: true }
            ],
            categoryTitles: {
                promos: "🔥 Promociones",
                especiales: "⭐ Recomendados",
                clasicos: "🍽️ Menú Principal",
                extras: "🥤 Bebidas y Otros"
            }
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

const fetchNominatim = (query, limit = 1) => {
    return new Promise((resolve, reject) => {
        // Limit to Mexico to reduce noise and improve relevance
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&addressdetails=1&countrycodes=mx`;
        console.log(`🌍 Geocoding (${limit}): ${query}`);

        const req = https.get(url, {
            headers: {
                'User-Agent': 'MiPlataforma/1.0',
                'Accept-Language': 'es-MX,es;q=0.9'
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json && Array.isArray(json)) {
                        const results = json.map(item => ({
                            lat: parseFloat(item.lat),
                            lng: parseFloat(item.lon),
                            address: item.display_name,
                            type: item.type
                        }));
                        resolve(results);
                    } else resolve([]);
                } catch (e) { resolve([]); }
            });
        });

        req.on('error', (e) => {
            console.error("Geo Request Error:", e.message);
            resolve([]);
        });
    });
};

const geocodeAddress = async (address) => {
    // 1. Intento Directo
    let results = await fetchNominatim(address, 1);
    if (results.length > 0) return results[0];

    // 2. Limpieza General (Expandir, quitar CP, quitar Col.)
    let clean = address
        .replace(/,?\s*Jal\.?/gi, ", Jalisco")
        .replace(/\b\d{5}\b/g, "") // Quitar ZIP 5 digitos
        .replace(/Col\.|Colonia/gi, "");

    // Si cambió algo, probamos
    if (clean !== address) {
        console.log(`🔄 Re-intentando geocoding con: ${clean}`);
        results = await fetchNominatim(clean, 1);
        if (results.length > 0) return results[0];
    }

    // 3. Estrategia "Street + City" Agresiva
    // Asumimos que la PRIMERA parte es la calle+número y alguna de las ULTIMAS es la ciudad.
    const parts = address.split(',').map(p => p.trim()).filter(p => p.length > 0);

    if (parts.length >= 2) {
        // Intentamos: Parte 1 + Parte -1 (Estado) + Parte -2 (Ciudad?)
        // Caso: "Río Oro 979, El Vergel, 45595 San Pedro Tlaquepaque, Jal."
        // clean ya quitó el 45595 y Jal. -> "Río Oro 979, El Vergel, San Pedro Tlaquepaque, Jalisco"
        // parts de clean: [ "Río Oro 979", "El Vergel", "San Pedro Tlaquepaque", "Jalisco" ]

        // Probamos: Part[0] + Part[Length-2] (Ciudad)
        if (parts.length >= 3) {
            // Usamos clean para el split para que no tenga basura
            const cleanParts = clean.split(',').map(p => p.trim()).filter(p => p);
            if (cleanParts.length >= 2) {
                // Street + City (assumed second to last) + Mexico
                const simple = `${cleanParts[0]}, ${cleanParts[cleanParts.length - 2]}, Mexico`;
                console.log(`🔄 Re-intentando simple: ${simple}`);
                results = await fetchNominatim(simple, 1);
                if (results.length > 0) return results[0];
            }
        }
    }

    return null;
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

app.post('/api/driver/register', async (req, res) => {
    const { name, phone, password, vehicle } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: "Datos incompletos" });

    try {
        const existing = await DeliveryPartner.findOne({ phone });
        if (existing) return res.status(400).json({ error: "El número de celular ya está registrado." });

        const newDriver = await DeliveryPartner.create({
            name,
            phone,
            password,
            vehicle: vehicle || 'moto',
            status: 'offline',
            earnings: 0
        });

        res.json({ success: true, driver: newDriver });
    } catch (e) {
        console.error("Driver register error:", e);
        res.status(500).json({ error: "Error al registrar repartidor." });
    }
});

app.post('/api/driver/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const driver = await DeliveryPartner.findOne({ phone, password });
        if (driver) {
            res.json({ success: true, driver: driver });
        } else {
            res.status(401).json({ error: "Credenciales inválidas" });
        }
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
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

        // Mantener/Mezclar config para evitar borrados accidentales si el frontend no manda todo
        // Aunque el frontend actual manda todo, es mas seguro hacer merge en campos top-level
        // Sin embargo, Mongoose maneja objetos anidados. 
        // Vamos a asignar directamente pero asegurando tipos en coords.

        if (data.config.coords) {
            data.config.coords.lat = parseFloat(data.config.coords.lat);
            data.config.coords.lng = parseFloat(data.config.coords.lng);
        }

        shop.config = data.config;
        shop.menu = data.menu;
        if (data.promotions) shop.promotions = data.promotions;

        await shop.save();

        console.log(`✅ Tienda ${slug} actualizada. Dirección: ${shop.config.address}, Coords: ${JSON.stringify(shop.config.coords)}`);

        io.to(slug).emit('shop-updated', { message: 'Datos actualizados' });
        res.json({ success: true });
    } catch (e) {
        console.error("Error saving shop:", e);
        res.status(500).json({ error: "Error al guardar" });
    }
});

// NUEVO ENDPOINT PARA AUTOCOMPLETE
app.post('/api/utils/search-address', async (req, res) => {
    const { query } = req.body;
    if (!query || query.length < 3) return res.json({ success: true, results: [] });

    try {
        // 1. Intento Directo
        let results = await fetchNominatim(query, 5);

        // 2. Si no hay resultados, intentar limpieza y estrategias
        if (!results || results.length === 0) {
            let clean = query
                .replace(/,?\s*Jal\.?/gi, ", Jalisco")
                .replace(/\b\d{5}\b/g, "")
                .replace(/Col\.|Colonia/gi, "");

            // Intento Clean
            if (clean !== query) {
                results = await fetchNominatim(clean, 5);
            }

            // Intento "Simple" si aun falla
            if ((!results || results.length === 0) && clean.includes(',')) {
                // Usamos la logica de partes limpias
                const parts = clean.split(',').map(p => p.trim()).filter(p => p);
                if (parts.length >= 3) {
                    // Street + City
                    const simple = `${parts[0]}, ${parts[parts.length - 2]}`;
                    console.log(`🔎 Autocomplete Simple: ${simple}`);
                    results = await fetchNominatim(simple, 5);
                }
            }
        }

        res.json({ success: true, results: results || [] });
    } catch (e) {
        res.status(500).json({ error: "Error searching" });
    }
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

app.post('/api/utils/reverse-geocode', async (req, res) => {
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: "Faltan coordenadas" });
    try {
        const address = await reverseGeocode(lat, lng);
        res.json({ success: true, address: address || "Dirección no encontrada" });
    } catch (e) {
        console.error("Geocode error:", e);
        res.status(500).json({ error: "Error al obtener dirección" });
    }
});

// --- RUTAS NUEVAS: CLIENTES ---
app.get('/api/customer/orders/:phone', async (req, res) => {
    const { phone } = req.params;
    try {
        const activeOrders = await Order.find({
            customerPhone: phone,
            status: { $nin: ['completed', 'cancelled', 'rejected'] }
        }).sort({ createdAt: -1 });

        // Enrich with Shop Names (Optional, but good for UI)
        // For performance, we could just return the data as is, or do a quick lookup.
        // Let's do a quick map if needed, or just rely on 'shopSlug'

        // We will fetch shop names manually to keep it fast
        const results = await Promise.all(activeOrders.map(async (o) => {
            const shop = await Shop.findOne({ slug: o.shopSlug }).select('config.name');
            return {
                ...o.toObject(),
                shopName: shop ? shop.config.name : o.shopSlug
            };
        }));

        res.json({ success: true, orders: results });
    } catch (e) {
        console.error("Error fetching orders:", e);
        res.status(500).json({ error: "Error al buscar pedidos" });
    }
});

app.post('/api/customer/register', async (req, res) => {
    const { name, phone, password, address } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: "Faltan datos requeridos" });
    try {
        const existing = await Customer.findOne({ phone });
        if (existing) return res.status(400).json({ error: "Este número ya está registrado." });
        const customer = await Customer.create({ name, phone, password, address: address || "", tastes: { items: [], categories: {} }, profileImage: "" });
        // Devolvemos tastes vacío al registrar
        res.json({ success: true, customer: { name: customer.name, phone: customer.phone, address: customer.address, tastes: customer.tastes, profileImage: customer.profileImage } });
    } catch (e) { res.status(500).json({ error: "Error al registrar cliente" }); }
});

app.post('/api/customer/login', async (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: "Faltan datos" });
    try {
        const customer = await Customer.findOne({ phone });
        if (customer && customer.password === password) {
            // Devolvemos también los gustos guardados
            res.json({ success: true, customer: { name: customer.name, phone: customer.phone, address: customer.address, tastes: customer.tastes, profileImage: customer.profileImage } });
        } else {
            res.status(401).json({ error: "Credenciales inválidas" });
        }
    } catch (e) { res.status(500).json({ error: "Error en el servidor" }); }
});

// --- RUTAS REPARTIDORES (DRIVERS) ---
app.post('/api/driver/register', async (req, res) => {
    const { name, phone, password, vehicle } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: "Datos incompletos" });
    try {
        const existing = await DeliveryPartner.findOne({ phone });
        if (existing) return res.status(400).json({ error: "Ya existe un repartidor con este teléfono." });

        await DeliveryPartner.create({ name, phone, password, vehicle });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: "Error al registrar repartidor." });
    }
});

app.post('/api/driver/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        const driver = await DeliveryPartner.findOne({ phone });
        if (driver && driver.password === password) {
            res.json({ success: true, driver });
        } else {
            res.status(401).json({ error: "Credenciales inválidas" });
        }
    } catch (e) {
        res.status(500).json({ error: "Error servidor" });
    }
});

// NUEVO ENDPOINT: Actualizar gustos del usuario
app.post('/api/customer/update-tastes', async (req, res) => {
    const { phone, tastes } = req.body;
    if (!phone || !tastes) return res.status(400).json({ error: "Faltan datos" });

    try {
        await Customer.findOneAndUpdate({ phone }, { tastes });
        res.json({ success: true });
    } catch (e) {
        console.error("Error guardando gustos:", e);
        res.status(500).json({ error: "Error actualizando preferencias" });
    }
});

// NUEVO: Subir foto de perfil
app.post('/api/customer/upload-profile', async (req, res) => {
    const { phone, image } = req.body;
    if (!phone || !image) return res.status(400).json({ error: "Datos faltantes" });

    try {
        const user = await Customer.findOne({ phone });
        if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

        // Valida con password si es necesario, pero aqui asumimos sesion activa si manda phone
        // Idealmente pedir password o token, pero por simplicidad y como el frontend manda phone...
        // Vemos que el frontend guarda "USER_PHONE".

        user.profileImage = image;
        await user.save();

        res.json({ success: true, image: user.profileImage });
    } catch (e) {
        console.error("Profile Upload Error:", e);
        res.status(500).json({ error: "Error al subir imagen." });
    }
});

// --- RUTAS STRIPE ---
app.post('/api/create-checkout-session', async (req, res) => {
    const { items, slug, userPhone } = req.body;

    // RULE: Limit 1 Active Card Order
    try {
        const activeCard = await Order.countDocuments({
            customerPhone: userPhone,
            status: { $nin: ['completed', 'cancelled', 'rejected'] },
            paymentMethod: 'Tarjeta' // Matches DB field from Stripe successes usually logic flow needs care
        });
        // Note: Stripe orders created via webhook usually get 'Tarjeta'. 
        // We check if *user* has pending ones. 
        // Actually, if status is pending_payment it might not be in DB yet? 
        // Usually we create DB record after webhook success.
        // BUT, if user has an active order (Preparing/Delivering) with Card, block new one.
        if (activeCard >= 1) {
            return res.status(400).json({ error: "❌ Ya tienes un pedido con Tarjeta activo. Espera a que finalice." });
        }
    } catch (e) { console.log(e); }

    try {
        // Transform CART items to Stripe Line Items
        const line_items = items.map(item => ({
            price_data: {
                currency: 'mxn',
                product_data: {
                    name: item.name,
                    images: item.image ? [item.image] : [],
                },
                unit_amount: Math.round(item.price * 100), // cents
            },
            quantity: item.qty,
        }));

        // Add Delivery Fee (Hardcoded for now as per frontend)
        line_items.push({
            price_data: {
                currency: 'mxn',
                product_data: { name: 'Tarifa de entrega' },
                unit_amount: 5200, // $52.00
            },
            quantity: 1,
        });

        // Add Service Fee
        line_items.push({
            price_data: {
                currency: 'mxn',
                product_data: { name: 'Tarifa de servicio' },
                unit_amount: 600, // $6.00
            },
            quantity: 1,
        });

        // Add Tip (Simplification: Fixed logic or passed from frontend would be better, 
        // but for checkout session limitation we might rely on Total)
        // NOTE: For exact total matching, passing the full amount as a custom SKU is another option,
        // but itemized is better for UX. Given the complexity of tips/discounts, 
        // we'll use a single custom line item for the "Total a Pagar" to avoid mismatch.

        const finalLineItems = [{
            price_data: {
                currency: 'mxn',
                product_data: { name: `Pedido en ${slug}` },
                unit_amount: Math.round(req.body.total * 100), // Total from Frontend
            },
            quantity: 1,
        }];

        const session = await stripe.checkout.sessions.create({
            line_items: finalLineItems, // Using single item for total exact match
            mode: 'payment',
            success_url: `https://menuia.onrender.com/menu.html?slug=${slug}&status=success&ref=${Date.now()}`,
            cancel_url: `https://menuia.onrender.com/menu.html?slug=${slug}&status=cancel`,
        });

        res.json({ url: session.url });
    } catch (e) {
        console.error("Stripe Checkout Error:", e);
        res.status(500).json({ error: e.message });
    }
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
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            last7Days[d.toLocaleDateString('en-US', { weekday: 'short' })] = 0;
        }

        monthlyOrders.forEach(o => {
            let val = 0;
            if (typeof o.total === 'string') val = parseFloat(o.total.replace(/[^0-9.-]+/g, ""));
            else if (typeof o.total === 'number') val = o.total;
            if (isNaN(val)) val = 0;

            salesMonth += val;
            if (o.createdAt >= startOfDay) salesToday += val;

            const dayKey = new Date(o.createdAt).toLocaleDateString('en-US', { weekday: 'short' });
            if (last7Days[dayKey] !== undefined) last7Days[dayKey] += val;
        });

        res.json({ success: true, salesToday, salesMonth, orderCountMonth: monthlyOrders.length, chartData: last7Days });
    } catch (e) { res.status(500).json({ error: "Error calculando finanzas" }); }
});

app.get('/api/shops/public', async (req, res) => {
    try {
        const shopsRaw = await Shop.find({}, 'slug config.name config.businessType config.isFeatured config.isPopularBrand config.heroImage config.logo config.hours config.address config.coords config.highDemand config.isOpen config.shipping promotions').lean();

        // Mocking Popularity/Ratings for "Trending" feature since we don't have real reviews yet
        const shops = shopsRaw.map(s => ({
            ...s,
            rating: (Math.random() * (5.0 - 4.2) + 4.2).toFixed(1), // Random 4.2 - 5.0
            reviewCount: Math.floor(Math.random() * 500) + 50
        }));

        res.json({ success: true, shops });
    } catch (e) { res.status(500).json({ error: "Error al obtener tiendas" }); }
});

// --- RUTAS SUPER ADMIN ---
app.post('/api/superadmin/list', async (req, res) => {
    const { masterKey } = req.body;
    if (masterKey !== SUPER_ADMIN_PASS) return res.status(403).json({ error: "Acceso denegado" });
    try {
        const shops = await Shop.find({}, 'slug config.name config.businessType config.isFeatured config.isPopularBrand config.logo stats subscription updatedAt createdAt credentials.contactPhone').sort({ createdAt: -1 });
        res.json({ success: true, shops });
    } catch (e) { res.status(500).json({ error: "Error interno" }); }
});

app.post('/api/superadmin/toggle-feature', async (req, res) => {
    const { masterKey, slug } = req.body;
    if (masterKey !== SUPER_ADMIN_PASS) return res.status(403).json({ error: "Acceso denegado" });
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });

        // Toggle
        const current = shop.config.isFeatured || false;
        shop.config.isFeatured = !current;
        await shop.save();

        console.log(`[Socket] Emitting featured update for ${slug}: ${shop.config.isFeatured}`);
        io.emit('shop-config-updated', { slug, type: 'featured', value: shop.config.isFeatured });

        res.json({ success: true, isFeatured: shop.config.isFeatured });
    } catch (e) { res.status(500).json({ error: "Error al actualizar" }); }
});

app.post('/api/superadmin/toggle-brand', async (req, res) => {
    const { masterKey, slug } = req.body;
    if (masterKey !== SUPER_ADMIN_PASS) return res.status(403).json({ error: "Acceso denegado" });
    try {
        const shop = await Shop.findOne({ slug });
        if (!shop) return res.status(404).json({ error: "Tienda no encontrada" });

        // Toggle
        const current = shop.config.isPopularBrand || false;
        shop.config.isPopularBrand = !current;
        await shop.save();

        console.log(`[Socket] Emitting brand update for ${slug}: ${shop.config.isPopularBrand}`);
        io.emit('shop-config-updated', { slug, type: 'brand', value: shop.config.isPopularBrand });

        res.json({ success: true, isPopularBrand: shop.config.isPopularBrand });
    } catch (e) { res.status(500).json({ error: "Error al actualizar" }); }
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
