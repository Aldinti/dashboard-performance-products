/**
 * script.js - Lógica principal del Dashboard Interactivo.
 * Carga datos locales y remotos, procesa y agrupa registros, controla filtros
 * y renderiza visualizaciones responsivas utilizando Google Charts y D3.js.
 */

// ==========================================================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================================================
let rawDataset = [];       // Datos puros cargados del JSON original (sin filtros ni agrupaciones)
let activeDataset = [];    // Datos filtrados y agregados listos para ser graficados
let productsList = [];     // Lista de todos los productos únicos en el archivo cargado
let monthsList = [];       // Lista de todos los meses únicos en el archivo cargado

// Colecciones para almacenar el estado de selección de filtros del usuario
const selectedProducts = new Set();
const selectedMonths = new Set();

// Mapa para ordenar los meses cronológicamente.
// Esto evita que los ejes y tablas queden ordenados alfabéticamente (ej: Abril antes de Enero).
const monthsOrder = {
    "Enero": 0, "Febrero": 1, "Marzo": 2, "Abril": 3, "Mayo": 4, "Junio": 5,
    "Julio": 6, "Agosto": 7, "Septiembre": 8, "Octubre": 9, "Noviembre": 10, "Diciembre": 11
};

// Paleta de colores consistente para los productos.
// Usamos acentos neón definidos en CSS para asegurar coherencia visual.
const productColors = {
    "Smartphone A": "#06b6d4", // Cian
    "Smartphone B": "#8b5cf6", // Violeta
    "Tablet X": "#10b981",     // Verde Esmeralda
    "Auriculares Z": "#ec4899", // Rosa
    "Teclado Mecánico": "#f59e0b", // Naranja
    "Cargador Rápido": "#eab308", // Amarillo
    "Smartwatch Y": "#3b82f6", // Azul
    "Laptop Pro": "#ef4444"    // Rojo
};
// Paleta por defecto para productos adicionales no predefinidos
const defaultColors = d3.schemeCategory10;

// Instancia global de Google Charts para poder redibujarla en redimensionamiento
let googleColumnChart = null;

// ==========================================================================
// INICIALIZACIÓN
// ==========================================================================

// Cargamos la biblioteca de Google Charts y configuramos el callback
google.charts.load('current', {'packages':['corechart']});
google.charts.setOnLoadCallback(initApp);

/**
 * Función principal que arranca la aplicación una vez cargado Google Charts.
 * Registra listeners de eventos y dispara la carga inicial de datos.
 */
function initApp() {
    setupEventListeners();
    fetchInitialData();
}

/**
 * Registra todos los escuchadores de eventos del DOM para interactividad.
 * Vincula acciones del menú lateral, cambios de tema, subida de archivos y redimensión.
 */
function setupEventListeners() {
    // Escuchador para la subida de archivos JSON locales
    document.getElementById('json-upload').addEventListener('change', handleFileUpload);

    // Escuchador para el botón [ACTUALIZAR] (recarga de datos desde la API del servidor)
    document.getElementById('update-api-btn').addEventListener('click', () => {
        const btn = document.getElementById('update-api-btn');
        const originalHtml = btn.innerHTML;
        
        // Bloqueamos interactividad para evitar llamadas en paralelo y damos feedback visual
        btn.disabled = true;
        btn.innerHTML = `<span class="btn-icon">🔄</span> Cargando...`;
        
        // Disparamos la recarga de datos remotos y pasamos un callback para restaurar el estado del botón
        fetchInitialData(() => {
            btn.innerHTML = `<span class="btn-icon">✅</span> ¡Hecho!`;
            
            // Esperamos 1 segundo antes de reestablecer la apariencia inicial para que el usuario note el éxito
            setTimeout(() => {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }, 1000);
        });
    });

    // Escuchadores para alternar el tema visual (Claro/Oscuro)
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

    // Escuchador para redimensionar gráficos de manera adaptativa (responsividad)
    // Redibujamos con un pequeño retraso (debounce) para no saturar al procesador
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (activeDataset.length > 0) {
                drawGoogleChart();
                drawD3Chart();
            }
        }, 150);
    });

    // Filtros Rápidos: Productos
    document.getElementById('select-all-prods').addEventListener('click', () => toggleAllCheckboxes('product', true));
    document.getElementById('deselect-all-prods').addEventListener('click', () => toggleAllCheckboxes('product', false));

    // Filtros Rápidos: Meses
    document.getElementById('select-all-months').addEventListener('click', () => toggleAllCheckboxes('month', true));
    document.getElementById('deselect-all-months').addEventListener('click', () => toggleAllCheckboxes('month', false));

    // Botón para restablecer el estado inicial del caso de estudio (Smartphone A/B/Tablet X + Enero/Febrero)
    document.getElementById('reset-filters-btn').addEventListener('click', applyDefaultSelections);

    // Selectores del gráfico D3 (Eje Y y Tamaño de Burbuja)
    document.getElementById('d3-y-axis-select').addEventListener('change', () => {
        // Redibujamos D3 de inmediato con la nueva métrica en el eje Y
        drawD3Chart();
    });
    document.getElementById('d3-size-select').addEventListener('change', () => {
        // Redibujamos D3 de inmediato con la nueva métrica de tamaño
        drawD3Chart();
    });

    // Recuperar el tema guardado en localStorage (persistencia de preferencia)
    const savedTheme = localStorage.getItem('dashboard-theme');
    if (savedTheme === 'light') {
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        updateThemeToggleButton(true);
    }
}

// ==========================================================================
// CARGA Y PROCESAMIENTO DE DATOS (JSON)
// ==========================================================================

/**
 * EXPLICACIÓN DE LA LÓGICA DE ACTUALIZACIÓN AUTOMÁTICA Y REDIBUJADO:
 * 
 * 1. Solicitud al Servidor (Petición): La función realiza una llamada fetch asíncrona a '/api/data'.
 *    Esto le indica al backend (Node/Express) que lea el archivo físico productos_100.json en disco 
 *    de forma dinámica, sin bloquear el servidor.
 * 2. Recepción y Actualización del Estado: Al recibir la respuesta HTTP 200, el cliente decodifica 
 *    el JSON y lo almacena en la variable global rawDataset, reemplazando los datos antiguos.
 * 3. Filtrado y Agrupamiento: La rutina de control de datos corre de inmediato, aplicando los filtros 
 *    de producto y mes seleccionados en los checkboxes laterales y sumando/agrupando los registros 
 *    duplicados en el activeDataset.
 * 4. Redibujado Automático: Con los nuevos datos en memoria, se invocan de forma secuencial las 
 *    funciones drawGoogleChart() y drawD3Chart(). Ambas limpian sus respectivos lienzos, adaptan la 
 *    estructura del dataset a los formatos nativos (DataTable para Google y elementos SVG para D3),
 *    y renderizan de nuevo los gráficos con transiciones animadas fluidas.
 */
function fetchInitialData(callback) {
    fetch('/api/data')
        .then(response => {
            if (!response.ok) throw new Error('Error de red al consultar la API.');
            return response.json();
        })
        .then(data => {
            rawDataset = data;
            document.getElementById('active-filename').textContent = 'productos_100.json (API)';
            processNewData();
            // Ejecutamos el callback si fue provisto para notificar la finalización de la carga
            if (callback) callback();
        })
        .catch(error => {
            console.error('No se pudo cargar la API inicial. Cargando datos locales simulados...', error);
            // Mensaje de error visible para el usuario en caso de falla de backend
            alert('Error al consultar el servidor. Asegurate de iniciar "npm start".');
            if (callback) callback();
        });
}

/**
 * Maneja la subida de un nuevo archivo JSON por parte del usuario.
 * Lee el archivo con FileReader, valida su sintaxis y estructura, y actualiza el dashboard.
 */
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Actualiza la UI para mostrar qué archivo se está cargando
    document.getElementById('active-filename').textContent = file.name;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            // Validamos que el JSON contenga la estructura mínima requerida para evitar errores en D3/Google Charts
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error("El archivo JSON debe contener un arreglo de objetos.");
            }
            
            const firstItem = data[0];
            const requiredFields = ['producto', 'mes', 'ventas', 'ingresos', 'precio'];
            const missing = requiredFields.filter(field => !(field in firstItem));
            
            if (missing.length > 0) {
                throw new Error(`Falta el/los campo(s): ${missing.join(', ')} en los registros.`);
            }

            // Si pasa la validación, guardamos el nuevo dataset en el estado global
            rawDataset = data;
            processNewData();
        } catch (error) {
            console.error("Error al procesar el archivo cargado:", error);
            alert(`Archivo no válido: ${error.message}`);
        }
    };
    reader.readAsText(file);
}

/**
 * Analiza el dataset crudo, extrae listas únicas de productos y meses,
 * y recrea los paneles de control de checkboxes.
 */
function processNewData() {
    // 1. Extraer elementos únicos usando Sets
    const prodsSet = new Set();
    const monthsSet = new Set();
    
    rawDataset.forEach(item => {
        if (item.producto) prodsSet.add(item.producto.trim());
        if (item.mes) monthsSet.add(item.mes.trim());
    });

    // 2. Ordenamiento para mejor visualización
    // Productos: Alfabético
    productsList = Array.from(prodsSet).sort();
    // Meses: Cronológico (basado en el mapa de índice del año)
    monthsList = Array.from(monthsSet).sort((a, b) => {
        const orderA = monthsOrder[a] !== undefined ? monthsOrder[a] : 99;
        const orderB = monthsOrder[b] !== undefined ? monthsOrder[b] : 99;
        return orderA - orderB;
    });

    // 3. Renderizar los controles dinámicos en el panel lateral
    renderFilterCheckboxes('product', productsList, 'product-filters');
    renderFilterCheckboxes('month', monthsList, 'month-filters');

    // 4. Aplicar selección por defecto
    applyDefaultSelections();
}

/**
 * Renderiza checkboxes de filtros en un elemento del DOM basándose en una lista de valores.
 */
function renderFilterCheckboxes(type, list, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = ''; // Limpiamos placeholders o filtros viejos

    list.forEach((value, index) => {
        const label = document.createElement('label');
        label.className = 'filter-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.name = `${type}-filter`;
        checkbox.value = value;
        checkbox.id = `${type}-${index}`;
        
        // Listener para redibujar el dashboard al alternar checkboxes
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (type === 'product') selectedProducts.add(value);
                else selectedMonths.add(value);
            } else {
                if (type === 'product') selectedProducts.delete(value);
                else selectedMonths.delete(value);
            }
            updateDashboard();
        });

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(value));
        container.appendChild(label);
    });
}

/**
 * Aplica los filtros de selección iniciales acordados en el plan.
 * Prioriza Smartphone A, B y Tablet X para Enero y Febrero (requisito acadamico del .docx).
 * Si no están disponibles en el JSON cargado, selecciona todos por defecto.
 */
function applyDefaultSelections() {
    // Limpiamos los Sets globales
    selectedProducts.clear();
    selectedMonths.clear();

    // Productos del caso de estudio
    const defaultProds = ["Smartphone A", "Smartphone B", "Tablet X"];
    // Meses del caso de estudio
    const defaultMonths = ["Enero", "Febrero"];

    // Verificamos cuáles están realmente disponibles en el archivo cargado
    const prodsToSelect = defaultProds.filter(p => productsList.includes(p));
    const monthsToSelect = defaultMonths.filter(m => monthsList.includes(m));

    // Si no encontramos los por defecto (por ej., subieron otro archivo), elegimos todo
    const finalProds = prodsToSelect.length > 0 ? prodsToSelect : productsList;
    const finalMonths = monthsToSelect.length > 0 ? monthsToSelect : monthsList;

    // Registramos en los sets globales
    finalProds.forEach(p => selectedProducts.add(p));
    finalMonths.forEach(m => selectedMonths.add(m));

    // Actualizamos el estado visual de los checkboxes del DOM
    updateCheckboxVisuals('product', selectedProducts);
    updateCheckboxVisuals('month', selectedMonths);

    // Refrescamos KPIs y gráficos
    updateDashboard();
}

/**
 * Modifica la propiedad checked de los inputs para reflejar los Sets de datos globales.
 */
function updateCheckboxVisuals(type, selectedSet) {
    const checkboxes = document.querySelectorAll(`input[name="${type}-filter"]`);
    checkboxes.forEach(cb => {
        cb.checked = selectedSet.has(cb.value);
    });
}

/**
 * Activa o desactiva todos los filtros de una categoría.
 */
function toggleAllCheckboxes(type, check) {
    const set = type === 'product' ? selectedProducts : selectedMonths;
    const list = type === 'product' ? productsList : monthsList;

    set.clear();
    if (check) {
        list.forEach(item => set.add(item));
    }

    updateCheckboxVisuals(type, set);
    updateDashboard();
}

// ==========================================================================
// CÁLCULOS Y ACTUALIZACIONES DE UI (KPIs)
// ==========================================================================

/**
 * Filtra y agrupa dinámicamente los datos puros.
 * Recalcula las tarjetas informativas superiores y ordena el redibujado de los gráficos.
 */
function updateDashboard() {
    // 1. Filtrado inicial basado en las casillas seleccionadas por el usuario
    const filteredRaw = rawDataset.filter(item => {
        const matchesProd = selectedProducts.has(item.producto ? item.producto.trim() : '');
        const matchesMonth = selectedMonths.has(item.mes ? item.mes.trim() : '');
        return matchesProd && matchesMonth;
    });

    // 2. Lógica de Agregación:
    // Dado que el JSON puede contener múltiples transacciones para el mismo producto en el mismo mes,
    // debemos agruparlos sumando sus valores de forma dinámica.
    const groupMap = {};
    
    filteredRaw.forEach(item => {
        const prod = item.producto.trim();
        const mes = item.mes.trim();
        const key = `${prod}|||${mes}`; // Generamos una clave única combinada
        
        if (!groupMap[key]) {
            groupMap[key] = {
                producto: prod,
                mes: mes,
                ventas: 0,
                ingresos: 0,
                precioSuma: 0,
                conteo: 0
            };
        }
        
        groupMap[key].ventas += Number(item.ventas);
        groupMap[key].ingresos += Number(item.ingresos);
        groupMap[key].precioSuma += Number(item.precio);
        groupMap[key].conteo++;
    });

    // Convertimos el mapa agrupado de vuelta a un arreglo plano y promediamos el precio unitario
    activeDataset = Object.values(groupMap).map(group => {
        return {
            producto: group.producto,
            mes: group.mes,
            ventas: group.ventas,
            ingresos: group.ingresos,
            // Promedio simple de precio registrado para este producto en este mes
            precio: group.precioSuma / group.conteo
        };
    });

    // 3. Cálculo de KPIs
    calculateKPIs();

    // 4. Redibujar gráficos
    drawGoogleChart();
    drawD3Chart();
}

/**
 * Realiza agregaciones analíticas sobre los datos activos y actualiza los textos del DOM.
 */
function calculateKPIs() {
    let totalVentas = 0;
    let totalIngresos = 0;
    let sumaPrecios = 0;
    let conteoPrecios = 0;
    
    // Mapa auxiliar para determinar el producto más vendido en cantidad
    const productVolumeMap = {};

    activeDataset.forEach(item => {
        totalVentas += item.ventas;
        totalIngresos += item.ingresos;
        
        // Sumamos los precios unitarios
        sumaPrecios += item.precio;
        conteoPrecios++;

        // Acumulamos volumen por producto
        if (!productVolumeMap[item.producto]) {
            productVolumeMap[item.producto] = 0;
        }
        productVolumeMap[item.producto] += item.ventas;
    });

    // Calculamos el promedio del precio unitario de los productos cargados
    const precioPromedio = conteoPrecios > 0 ? (sumaPrecios / conteoPrecios) : 0;

    // Determinamos qué producto tiene más unidades vendidas totales
    let topProduct = "Ninguno";
    let maxVolume = -1;
    for (const [prod, vol] of Object.entries(productVolumeMap)) {
        if (vol > maxVolume) {
            maxVolume = vol;
            topProduct = prod;
        }
    }

    // Actualización de textos del DOM con formato adecuado
    document.getElementById('kpi-ventas').textContent = totalVentas.toLocaleString('es-AR');
    document.getElementById('kpi-ingresos').textContent = `$${totalIngresos.toLocaleString('es-AR', {minimumFractionDigits: 0, maximumFractionDigits: 0})}`;
    document.getElementById('kpi-precio-promedio').textContent = `$${precioPromedio.toLocaleString('es-AR', {minimumFractionDigits: 1, maximumFractionDigits: 2})}`;
    document.getElementById('kpi-producto-top').textContent = topProduct;
}

// ==========================================================================
// GRÁFICO BÁSICO: GOOGLE CHART LIBRARY
// ==========================================================================

/**
 * Renderiza el gráfico de columnas de Google Charts.
 * Transforma el dataset agregador a formato tabular pivotado y aplica estilos.
 */
function drawGoogleChart() {
    // Si la librería de Google no está cargada o no hay datos, cancelamos
    if (!google.visualization || activeDataset.length === 0) {
        document.getElementById('google-chart').innerHTML = '<p class="loading-placeholder">Sin datos para graficar</p>';
        return;
    }

    // Listas únicas activas ordenadas para estructurar la tabla
    const activeProducts = Array.from(selectedProducts).sort();
    const activeMonths = Array.from(selectedMonths).sort((a, b) => monthsOrder[a] - monthsOrder[b]);

    if (activeProducts.length === 0 || activeMonths.length === 0) {
        document.getElementById('google-chart').innerHTML = '<p class="loading-placeholder">Selecciona al menos un producto y un mes.</p>';
        return;
    }

    // Estructuramos los datos para Google DataTable:
    // Primera columna: Eje X (Meses)
    // Columnas siguientes: Nombre de cada Producto (Ventas)
    const chartData = new google.visualization.DataTable();
    chartData.addColumn('string', 'Mes');
    
    activeProducts.forEach(prod => {
        chartData.addColumn('number', prod);
    });

    // Llenamos las filas
    activeMonths.forEach(mes => {
        const row = [mes];
        activeProducts.forEach(prod => {
            // Buscamos el registro agregado para este producto y mes
            const item = activeDataset.find(d => d.producto === prod && d.mes === mes);
            row.push(item ? item.ventas : 0); // Si no hay registros, indicamos 0 ventas
        });
        chartData.addRow(row);
    });

    // Detectamos si la página está en modo claro u oscuro para adaptar los colores de ejes y cuadrícula
    const isLightTheme = document.body.classList.contains('light-theme');
    
    // Obtenemos los colores para cada producto mapeados a la paleta neón consistente
    const colors = activeProducts.map(prod => productColors[prod] || defaultColors[Math.random() * 10]);

    // Opciones del gráfico (Estilos minimalistas alineados al diseño general)
    const options = {
        backgroundColor: 'transparent', // Permite que se note el blur glassmorphic
        colors: colors,
        fontName: 'Plus Jakarta Sans',
        legend: { 
            position: 'bottom', 
            textStyle: { 
                color: isLightTheme ? '#0f172a' : '#94a3b8', 
                fontSize: 11,
                fontName: 'Plus Jakarta Sans'
            } 
        },
        chartArea: { width: '85%', height: '70%', top: 20 },
        animation: {
            duration: 800,
            easing: 'out',
            startup: true // Activa animación al cargar por primera vez
        },
        vAxis: {
            title: 'Cantidad Vendida',
            titleTextStyle: { color: isLightTheme ? '#64748b' : '#94a3b8', fontSize: 11, italic: false },
            textStyle: { color: isLightTheme ? '#64748b' : '#94a3b8', fontSize: 10 },
            gridlines: { color: isLightTheme ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.06)' },
            baselineColor: isLightTheme ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255, 255, 255, 0.15)'
        },
        hAxis: {
            textStyle: { color: isLightTheme ? '#64748b' : '#94a3b8', fontSize: 10 },
            baselineColor: isLightTheme ? 'rgba(15, 23, 42, 0.15)' : 'rgba(255, 255, 255, 0.15)'
        },
        tooltip: {
            textStyle: { fontName: 'Plus Jakarta Sans', fontSize: 11 }
        }
    };

    // Renderizamos el gráfico
    if (!googleColumnChart) {
        googleColumnChart = new google.visualization.ColumnChart(document.getElementById('google-chart'));
    }
    googleColumnChart.draw(chartData, options);
}

// ==========================================================================
// GRÁFICO AVANZADO: D3.JS MULTIDIMENSIONAL
// ==========================================================================

/**
 * Renderiza el gráfico de burbujas multidimensional con D3.js.
 * Utiliza transiciones D3, enlaces de datos y maneja eventos interactivos (tooltip flotante).
 */
function drawD3Chart() {
    // Contenedor HTML donde se inyectará el SVG
    const container = d3.select('#d3-chart');
    container.html(''); // Vaciamos el gráfico viejo

    // Listas únicas activas
    const activeProducts = Array.from(selectedProducts).sort();
    const activeMonths = Array.from(selectedMonths).sort((a, b) => monthsOrder[a] - monthsOrder[b]);

    if (activeProducts.length === 0 || activeMonths.length === 0 || activeDataset.length === 0) {
        container.append('p')
            .attr('class', 'loading-placeholder')
            .text('Selecciona productos y meses para visualizar.');
        d3.select('#d3-legend').html('');
        return;
    }

    // Leemos el tamaño del contenedor del DOM para hacerlo responsivo
    const rect = document.getElementById('d3-chart').getBoundingClientRect();
    const width = rect.width || 500;
    const height = 380;
    
    // Márgenes del SVG para dar espacio a ejes y leyendas
    const margin = { top: 25, right: 30, bottom: 40, left: 60 };

    // Creamos el elemento SVG
    const svg = container.append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('style', 'overflow: visible;');

    // Determinamos qué métrica va en el eje Y y cuál controla el tamaño según las selecciones del dropdown
    const yMetric = document.getElementById('d3-y-axis-select').value; // 'ventas' o 'ingresos'
    const sizeMetric = document.getElementById('d3-size-select').value; // 'precio', 'ingresos' o 'ventas'

    // Detectamos si el tema actual es claro u oscuro para adaptar colores de fuente en SVG
    const isLightTheme = document.body.classList.contains('light-theme');
    const labelColor = isLightTheme ? '#64748b' : '#94a3b8';
    const gridColor = isLightTheme ? 'rgba(15, 23, 42, 0.08)' : 'rgba(255, 255, 255, 0.06)';

    // ========================
    // ESCALAS D3
    // ========================

    // 1. Eje X: Escala de puntos categórica ordenada para los meses activos
    const x = d3.scalePoint()
        .domain(activeMonths)
        .range([margin.left, width - margin.right])
        .padding(0.6);

    // 2. Eje Y: Escala lineal continua para la métrica Y (Ventas o Ingresos)
    const yMax = d3.max(activeDataset, d => d[yMetric]) || 0;
    const y = d3.scaleLinear()
        .domain([0, yMax * 1.15]) // Añadimos 15% de margen superior para que las burbujas no queden cortadas
        .range([height - margin.bottom, margin.top]);

    // 3. Tamaño de Burbuja (Radio r): Escala de raíz cuadrada (scaleSqrt)
    // Usamos raíz cuadrada en vez de lineal porque el ojo humano percibe el tamaño por área, no por radio.
    const sizeMax = d3.max(activeDataset, d => d[sizeMetric]) || 1;
    const r = d3.scaleSqrt()
        .domain([0, sizeMax])
        .range([5, 26]); // Mapea desde 5px de radio hasta un máximo de 26px para burbujas notorias pero equilibradas

    // ========================
    // LÍNEAS DE CUADRÍCULA (GRIDLINES)
    // ========================
    
    // Líneas horizontales de fondo para facilitar la lectura de valores Y
    svg.append('g')
        .attr('class', 'grid-line')
        .attr('transform', `translate(0, 0)`)
        .selectAll('line')
        .data(y.ticks(6))
        .enter()
        .append('line')
        .attr('x1', margin.left)
        .attr('x2', width - margin.right)
        .attr('y1', d => y(d))
        .attr('y2', d => y(d))
        .attr('stroke', gridColor);

    // ========================
    // EJES (AXES)
    // ========================

    // Eje X inferior
    svg.append('g')
        .attr('transform', `translate(0, ${height - margin.bottom})`)
        .call(d3.axisBottom(x))
        .call(g => g.select('.domain').attr('stroke', gridColor)) // Color de la línea del eje
        .call(g => g.selectAll('.tick line').attr('stroke', gridColor)) // Color de los ticks
        .selectAll('text')
        .attr('fill', labelColor)
        .style('font-family', 'Plus Jakarta Sans')
        .style('font-size', '10px')
        .style('font-weight', '500');

    // Eje Y izquierdo
    svg.append('g')
        .attr('transform', `translate(${margin.left}, 0)`)
        .call(d3.axisLeft(y).ticks(6).tickFormat(d => {
            // Formateador dinámico: si son ingresos agregamos signo de peso y abreviatura K si es mayor a 1000
            if (yMetric === 'ingresos') {
                return d >= 1000 ? `$${(d/1000).toFixed(0)}k` : `$${d}`;
            }
            return d;
        }))
        .call(g => g.select('.domain').attr('stroke', gridColor))
        .call(g => g.selectAll('.tick line').attr('stroke', gridColor))
        .selectAll('text')
        .attr('fill', labelColor)
        .style('font-family', 'Plus Jakarta Sans')
        .style('font-size', '10px');

    // Etiqueta del Eje Y
    svg.append('text')
        .attr('transform', 'rotate(-90)')
        .attr('y', 15)
        .attr('x', - (height / 2) + 10)
        .attr('fill', labelColor)
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .attr('text-anchor', 'middle')
        .text(yMetric === 'ingresos' ? 'Ingresos Totales ($)' : 'Unidades Vendidas');

    // ========================
    // RENDERIZADO DE BURBUJAS (CIRCLES)
    // ========================
    const tooltip = d3.select('#d3-tooltip');

    // Enlazamos los datos aggregated de activeDataset
    const bubbles = svg.selectAll('.bubble')
        .data(activeDataset, d => `${d.producto}|||${d.mes}`);

    // Eliminamos burbujas obsoletas con transición de encogimiento
    bubbles.exit()
        .transition()
        .duration(400)
        .attr('r', 0)
        .remove();

    // Dibujamos burbujas nuevas y actualizamos las existentes
    const bubblesEnter = bubbles.enter()
        .append('circle')
        .attr('class', 'bubble')
        // Inicializamos coordenadas en el eje X y con radio 0 para animar la entrada (efecto de pop-in)
        .attr('cx', d => x(d.mes))
        .attr('cy', d => y(0)) 
        .attr('r', 0)
        .attr('fill', d => productColors[d.producto] || '#94a3b8')
        .attr('fill-opacity', 0.6)
        .attr('stroke', d => productColors[d.producto] || '#94a3b8')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer');

    // Fusionamos las nuevas con las actualizadas (Merge) y ejecutamos transición suave
    bubblesEnter.merge(bubbles)
        .transition()
        .duration(800)
        .ease(d3.easeCubicOut)
        .attr('cx', d => x(d.mes))
        .attr('cy', d => y(d[yMetric]))
        .attr('r', d => r(d[sizeMetric]));

    // ========================
    // INTERACTIVIDAD Y EVENTOS (TOOLTIP)
    // ========================
    
    // Volvemos a seleccionar para aplicar los event listeners sobre el grupo completo (sin transiciones que interrumpan)
    svg.selectAll('.bubble')
        .on('mouseover', function(event, d) {
            // 1. Resaltamos visualmente la burbuja seleccionada aumentando su opacidad
            d3.select(this)
                .transition()
                .duration(150)
                .attr('fill-opacity', 0.85)
                .attr('stroke-width', 2.5);

            // Opacamos ligeramente al resto de las burbujas para enfocar la atención
            svg.selectAll('.bubble')
                .filter(function() { return this !== event.target; })
                .transition()
                .duration(150)
                .attr('fill-opacity', 0.2)
                .attr('stroke-opacity', 0.4);

            // 2. Poblamos y mostramos el Tooltip flotante con formato limpio
            tooltip.html(`
                <div class="tooltip-title">${d.producto}</div>
                <div class="tooltip-row"><span>Mes:</span><span class="tooltip-val">${d.mes}</span></div>
                <div class="tooltip-row"><span>Ventas:</span><span class="tooltip-val">${d.ventas.toLocaleString('es-AR')} u.</span></div>
                <div class="tooltip-row"><span>Ingresos:</span><span class="tooltip-val">$${d.ingresos.toLocaleString('es-AR', {maximumFractionDigits:0})}</span></div>
                <div class="tooltip-row"><span>Precio Promedio:</span><span class="tooltip-val">$${d.precio.toLocaleString('es-AR', {minimumFractionDigits: 1, maximumFractionDigits: 2})}</span></div>
            `);

            tooltip.transition()
                .duration(200)
                .style('opacity', 1);
        })
        .on('mousemove', function(event) {
            // Posicionamos el tooltip 15px abajo y a la derecha del puntero del mouse
            const xOffset = event.pageX + 15;
            const yOffset = event.pageY + 15;
            
            tooltip
                .style('left', `${xOffset}px`)
                .style('top', `${yOffset}px`);
        })
        .on('mouseleave', function() {
            // Restauramos los estilos de opacidad originales de todas las burbujas
            svg.selectAll('.bubble')
                .transition()
                .duration(200)
                .attr('fill-opacity', 0.6)
                .attr('stroke-opacity', 1)
                .attr('stroke-width', 1.5);

            // Ocultamos el tooltip
            tooltip.transition()
                .duration(200)
                .style('opacity', 0);
        });

    // ========================
    // LEYENDA DEL GRÁFICO D3 (INTERACTIVA)
    // ========================
    renderD3Legend(activeProducts);
}

/**
 * Renderiza la leyenda debajo del gráfico D3.
 * Si el usuario hace clic sobre un ítem de la leyenda, desactiva ese producto del filtro de forma inmediata.
 */
function renderD3Legend(activeProducts) {
    const legendContainer = d3.select('#d3-legend');
    legendContainer.html(''); // Limpiamos leyenda previa

    activeProducts.forEach(prod => {
        const item = legendContainer.append('div')
            .attr('class', 'legend-item')
            .attr('style', 'cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: background 0.2s;')
            .attr('title', `Hacé clic para deseleccionar ${prod}`);

        // Agregamos el círculo de color
        item.append('div')
            .attr('class', 'legend-color')
            .style('background-color', productColors[prod] || '#94a3b8');

        // Texto del producto
        item.append('span')
            .text(prod);

        // Hover effect
        item.on('mouseover', function() {
            d3.select(this).style('background', 'var(--hover-bg)');
        }).on('mouseout', function() {
            d3.select(this).style('background', 'none');
        });

        // Al hacer clic, buscamos el checkbox del filtro y lo apagamos
        item.on('click', () => {
            // Removemos de la lista global de productos activos
            selectedProducts.delete(prod);
            // Actualizamos visualmente el checkbox del DOM
            updateCheckboxVisuals('product', selectedProducts);
            // Re-procesamos datos
            updateDashboard();
        });
    });
}

// ==========================================================================
// CONTROL DEL TEMA VISUAL (CLARO / OSCURO)
// ==========================================================================

/**
 * Alterna el tema visual de la aplicación entre oscuro y claro.
 * Guarda la elección en localStorage y dispara el rediseño de Google Charts y D3 para adaptar sus colores.
 */
function toggleTheme() {
    const isDark = document.body.classList.contains('dark-theme');
    
    if (isDark) {
        // Cambiar a claro
        document.body.classList.remove('dark-theme');
        document.body.classList.add('light-theme');
        localStorage.setItem('dashboard-theme', 'light');
        updateThemeToggleButton(true);
    } else {
        // Cambiar a oscuro
        document.body.classList.remove('light-theme');
        document.body.classList.add('dark-theme');
        localStorage.setItem('dashboard-theme', 'dark');
        updateThemeToggleButton(false);
    }

    // Es crítico redibujar ambos gráficos porque Google Charts y D3 renderizan
    // elementos SVG internos (texto de ejes, ticks, rejillas) cuyos colores deben actualizarse
    // al instante para no perder visibilidad ni contraste.
    if (activeDataset.length > 0) {
        drawGoogleChart();
        drawD3Chart();
    }
}

/**
 * Modifica la visibilidad de los iconos de Sol/Luna dentro del botón de cambio de tema.
 */
function updateThemeToggleButton(isLight) {
    const sunIcon = document.querySelector('.sun-icon');
    const moonIcon = document.querySelector('.moon-icon');
    
    if (isLight) {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'inline-block';
    } else {
        sunIcon.style.display = 'inline-block';
        moonIcon.style.display = 'none';
    }
}
