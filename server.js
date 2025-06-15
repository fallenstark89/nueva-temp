const express = require('express');
const app = express();
const path = require('path');
const port = process.env.PORT || 3000;

// Middleware para parsear JSON
app.use(express.json());

// Configuración de CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    
    // Manejar preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    next();
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Configuración de áreas y sensores
const areas = {
    'almacen': {
        name: 'Almacén Principal',
        icon: 'fa-warehouse',
        sensors: [1, 2, 3, 4, 5, 6],
        disconnectTimeout: 15000 // 15 segundos
    },
    'cocina-principal': {
        name: 'Cocina Principal',
        icon: 'fa-utensils',
        sensors: [7, 8, 9],
        disconnectTimeout: 15000
    },
    'panaderia': {
        name: 'Panadería',
        icon: 'fa-bread-slice',
        sensors: [10, 11],
        disconnectTimeout: 15000
    },
    'cocina-timeout': {
        name: 'Cocina Time Out',
        icon: 'fa-clock',
        sensors: [12, 13],
        disconnectTimeout: 15000
    },
    'cocina-banquete': {
        name: 'Cocina Banquete',
        icon: 'fa-glass-cheers',
        sensors: [14, 15, 16],
        disconnectTimeout: 15000
    }
};

// Almacenamiento temporal de las temperaturas
const sensors = {};
const temperatureHistory = {}; // Almacenamiento del historial
const MAX_HISTORY_DAYS = 30; // Mantener historial de 30 días

// Función para obtener el tiempo de desconexión de un sensor
function getDisconnectTimeout(sensorId) {
    const sensorNum = parseInt(sensorId.split('_')[1]);
    for (const area of Object.values(areas)) {
        if (area.sensors.includes(sensorNum)) {
            return area.disconnectTimeout || 15000; // Default a 15 segundos si no está definido
        }
    }
    return 15000; // Default global
}

// Función para limpiar historial antiguo
function cleanOldHistory() {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - (MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000));
    
    Object.keys(temperatureHistory).forEach(sensorId => {
        temperatureHistory[sensorId] = temperatureHistory[sensorId].filter(entry => 
            new Date(entry.timestamp) > cutoffDate
        );
    });
}

// Limpiar historial antiguo cada hora
setInterval(cleanOldHistory, 60 * 60 * 1000);

// Ruta para recibir datos del sensor
app.post('/api/temperature', (req, res) => {
    try {
        console.log('Petición POST recibida:', req.body);
        
        const { sensorId, temperature } = req.body;
        
        if (typeof temperature === 'number' && sensorId) {
            const timestamp = new Date(); // Usar la fecha actual del servidor
            const temperatureData = {
                temperature: parseFloat(temperature.toFixed(1)),
                lastUpdate: timestamp,
                lastValidUpdate: timestamp
            };
            
            sensors[sensorId] = temperatureData;
            
            // Guardar en el historial
            if (!temperatureHistory[sensorId]) {
                temperatureHistory[sensorId] = [];
            }
            temperatureHistory[sensorId].push({
                temperature: temperatureData.temperature,
                timestamp: timestamp
            });
            
            console.log(`Nueva temperatura recibida del sensor ${sensorId}: ${temperatureData.temperature}°C`);
            res.status(200).json({ 
                success: true,
                message: 'Datos recibidos correctamente'
            });
        } else {
            console.log('Error: Datos de temperatura no válidos');
            res.status(400).json({ 
                error: 'Datos de temperatura no válidos',
                received: req.body
            });
        }
    } catch (error) {
        console.error('Error al procesar datos del sensor:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Ruta para obtener el historial de temperaturas
app.get('/api/temperature/history', (req, res) => {
    try {
        const { sensorId, startDate, endDate } = req.query;
        
        if (!sensorId || !startDate || !endDate) {
            return res.status(400).json({
                error: 'Faltan parámetros requeridos'
            });
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({
                error: 'Fechas inválidas'
            });
        }

        const sensorHistory = temperatureHistory[sensorId] || [];
        const filteredHistory = sensorHistory.filter(entry => {
            const entryDate = new Date(entry.timestamp);
            return entryDate >= start && entryDate <= end;
        });

        res.status(200).json({
            status: 'ok',
            temperatures: filteredHistory
        });
    } catch (error) {
        console.error('Error al obtener historial de temperaturas:', error);
        res.status(500).json({
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Ruta para obtener todas las temperaturas
app.get('/api/temperature', (req, res) => {
    try {
        const now = new Date();
        const response = {
            sensors: {},
            status: 'ok'
        };

        // Procesar cada sensor según las áreas definidas
        Object.values(areas).forEach(area => {
            area.sensors.forEach(sensorNum => {
                const sensorId = `sensor_${sensorNum}`;
                const sensor = sensors[sensorId];
                
                if (sensor) {
                    // Asegurarse de que lastUpdate no sea una fecha futura
                    const lastUpdate = new Date(sensor.lastUpdate);
                    const validLastUpdate = lastUpdate > now ? now : lastUpdate;
                    
                    const isDisconnected = (now - validLastUpdate) > getDisconnectTimeout(sensorId);
                    response.sensors[sensorId] = {
                        temperature: sensor.temperature,
                        lastUpdate: validLastUpdate,
                        isDisconnected: isDisconnected,
                        disconnectTimeout: getDisconnectTimeout(sensorId)
                    };
                } else {
                    // Si el sensor no existe, crear una entrada con valores nulos
                    response.sensors[sensorId] = {
                        temperature: null,
                        lastUpdate: null,
                        isDisconnected: true,
                        disconnectTimeout: getDisconnectTimeout(sensorId)
                    };
                }
            });
        });

        console.log('Solicitud GET recibida. Sensores:', response.sensors);
        res.status(200).json(response);
    } catch (error) {
        console.error('Error al obtener temperaturas:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message
        });
    }
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Manejo de errores global
app.use((err, req, res, next) => {
    console.error('Error en el servidor:', err);
    res.status(500).json({ 
        error: 'Error interno del servidor',
        details: err.message
    });
});

// Exportar la aplicación para Vercel
module.exports = app;

app.listen(port, () => {
    console.log(`Servidor HTTP corriendo en http://localhost:${port}`);
}); 