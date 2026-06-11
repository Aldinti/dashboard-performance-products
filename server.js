// server.js - servidor simple para servir archivos estáticos y la API de datos
const express = require('express');
const path = require('path');
const fs = require('fs').promises; // Usamos la API de promesas de fs para operaciones de archivo no bloqueantes
const app = express();
const PORT = process.env.PORT || 3000;

// Servimos todos los archivos estáticos en el directorio raíz (HTML, JS, CSS)
app.use(express.static(path.join(__dirname)));

// Endpoint de la API para suministrar el archivo JSON de productos al cliente.
// Esto simula una integración con base de datos externa cargando los datos bajo demanda.
app.get('/api/data', async (req, res) => {
    try {
        const filePath = path.join(__dirname, 'productos_100.json');
        const fileContent = await fs.readFile(filePath, 'utf8');
        
        // Respondemos con los datos parseados directamente en formato JSON
        res.json(JSON.parse(fileContent));
    } catch (error) {
        console.error('Error al leer el archivo de productos:', error);
        res.status(500).json({ error: 'No se pudo leer la fuente de datos' });
    }
});

// Iniciar servidor local
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

// Captura de eventos del sistema para diagnóstico y cierre limpio
process.on('exit', (code) => {
    console.log(`El proceso del servidor terminó con el código de salida: ${code}`);
});

process.on('uncaughtException', (err) => {
    console.error('Ocurrió un error no capturado:', err);
});