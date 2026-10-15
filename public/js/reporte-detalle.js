// ============================================================================
// reporte-detalle.js — DETALLE DE UN REPORTE (public/html/reporte-detalle.html)
// ----------------------------------------------------------------------------
// Esta pantalla tiene DOS MODOS, según los parámetros de la URL:
//   * ?tipo=general        -> reporte anual con rango de fechas editable.
//   * ?anio=2026&mes=9     -> reporte de un mes concreto.
// Muestra la tarjeta del reporte, cuatro indicadores y seis pestañas:
// consumo (gráficas), cierres M1/M2 con chequeo, registros, máquinas,
// operarios y alertas. Los filtros (fechas, máquina, operario) se aplican en
// el navegador; en modo general, cambiar las fechas vuelve a pedir los datos.
// Se refresca solo cada 10 segundos y "Exportar PDF" imprime todas las pestañas.
// ============================================================================

const $rd = (id) => document.getElementById(id);

const NOMBRES_MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const COLORES_DONA = ['#d96a3d', '#e58a4f', '#f5a524', '#4f8b5e', '#2d5a41', '#4b7bb2'];
const COLOR_OTRAS = '#b9c2bb';
const REGISTROS_POR_PAGINA = 15;
// Diferencia máxima (galones) entre surtidor y registros para decir que un día "cuadra".
const TOLERANCIA_CIERRE = 2;

// Tipos de alerta: nombre, color de la etiqueta y cómo se marca el registro asociado.
const TIPOS_ALERTA = {
  sobrecapacidad: { nombre: 'Sobre capacidad', clase: 'rd-e-crit', icono: '⛽', nivel: 'Crítica' },
  promedio: { nombre: 'Sobre el promedio', clase: 'rd-e-adv', icono: '📈', nivel: 'Advertencia' },
  horometro_irregular: { nombre: 'Horómetro irregular', clase: 'rd-e-adv', icono: '⏱️', nivel: 'Revisar horómetro' },
  inspeccion_pendiente: { nombre: 'Inspección pendiente', clase: 'rd-e-adv', icono: '📋', nivel: 'Advertencia' },
  cierre_pendiente: { nombre: 'Cierre pendiente', clase: 'rd-e-crit', icono: '⏰', nivel: 'Crítica' }
};

// --- Modo según la URL -------------------------------------------------------
const parametrosReporte = new URLSearchParams(window.location.search);
const esReporteGeneral = parametrosReporte.get('tipo') === 'general';
const anioReporte = Number(parametrosReporte.get('anio'));
const mesReporte = Number(parametrosReporte.get('mes'));

// --- Estado de la pantalla -----------------------------------------------------
let suministros = []; // Registros de combustible del periodo descargado
let jornadas = []; // Jornadas (lecturas M1/M2 + checklist) del periodo descargado
let alertas = []; // Alertas del periodo descargado
let infoMaquinas = new Map(); // MÁQUINA -> { tipo, capacidad }
const filtro = { desde: '', hasta: '', maquina: '', operario: '' };
let limites = { desde: '', hasta: '' }; // Rango completo del reporte (para "Limpiar")
let agrupar = esReporteGeneral ? 'mes' : 'dia';
let pagina = 1;
let pestanaActual = 'consumo';

// --- Utilidades ---------------------------------------------------------------
const numero = (valor) => {
  const n = Number(String(valor ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const gal = (n, decimales = 1) =>
  Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const fechaCorta = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}` : '');
const fechaDe = (x) => String(x?.fecha || '').slice(0, 10);
const nombreMaquina = (m) => String(m || '').trim().toUpperCase();
// El tanque móvil es un depósito que se rellena, no una máquina que consume.
const esTanqueMovil = (m) => /^TANQUE M[OÓ][VB]IL/.test(nombreMaquina(m));
const tipoDe = (m) => (esTanqueMovil(m) ? 'Tanque' : infoMaquinas.get(nombreMaquina(m))?.tipo || '—');
const vacioFila = (columnas, texto) => `<tr><td colspan="${columnas}" class="rd-vacio">${texto}</td></tr>`;

function primeraPalabraCapitalizada(texto) {
  const palabra = String(texto || '').trim().split(/\s+/)[0] || '';
  return palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase() : '';
}

// Una jornada "vacía" se abrió solo por el checklist y nunca tuvo lecturas finales
// ni suministros: no se muestra en Cierres (no es un día de trabajo).
function esJornadaVacia(j) {
  const sinLecturas = [j.m1Final, j.m2Final].every((v) => v === null || v === undefined || String(v).trim() === '');
  return j.estado !== 'cerrada' && sinLecturas && !suministros.some((r) => fechaDe(r) === j.fecha);
}

// --- Carga de datos -------------------------------------------------------------
// Tipo y capacidad de cada máquina (columna "Tipo" y "Capacidad").
async function cargarInfoMaquinas() {
  try {
    const respuesta = await fetch('/api/analitica/maquinas', { cache: 'no-store' });
    if (!respuesta.ok) return;
    const datos = await respuesta.json();
    infoMaquinas = new Map(
      (Array.isArray(datos) ? datos : []).map((x) => [
        nombreMaquina(x.maquina),
        { tipo: primeraPalabraCapitalizada(x.descripcion), capacidad: numero(x.capacidadGalones) }
      ])
    );
  } catch (_) {} // Sin este dato las columnas "Tipo" y "Capacidad" muestran "—"
}

// Suministros y jornadas del periodo. La respuesta es { suministros, jornadas, conciliacion }.
async function cargarRegistros() {
  const url = esReporteGeneral
    ? `/api/reportes-general/registros?${new URLSearchParams({ fechaInicio: limites.desde, fechaFin: limites.hasta })}`
    : `/api/reportes/${anioReporte}/${mesReporte}/registros`;
  const respuesta = await fetch(url, { cache: 'no-store' });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const datos = await respuesta.json();
  suministros = Array.isArray(datos?.suministros) ? datos.suministros.filter((r) => !r.cierreDia || r.maquina) : [];
  jornadas = (Array.isArray(datos?.jornadas) ? datos.jornadas : []).map((j) => ({ ...j, fecha: fechaDe(j) }));
}

// Alertas: en modo general se piden todas y se recortan al rango; en modo
// mensual el servidor ya las entrega del mes.
async function cargarAlertas() {
  const url = esReporteGeneral ? '/api/alertas' : `/api/alertas/reportes/${anioReporte}/${mesReporte}`;
  try {
    const respuesta = await fetch(url, { cache: 'no-store' });
    if (!respuesta.ok) return;
    const lista = await respuesta.json();
    alertas = (Array.isArray(lista) ? lista : [])
      .map((a) => ({ ...a, fecha: fechaDe(a) }))
      .filter((a) => a.fecha >= limites.desde && a.fecha <= limites.hasta);
  } catch (error) {
    console.warn('No se pudieron cargar las alertas del reporte', error);
  }
}

async function cargarTodo() {
  await Promise.all([cargarRegistros(), cargarAlertas()]);
  llenarSelectores();
  pintarTodo();
}

// --- Filtros ---------------------------------------------------------------------
function datosFiltrados() {
  const dentro = (f) => f >= filtro.desde && f <= filtro.hasta;
  return {
    registros: suministros.filter(
      (r) =>
        dentro(fechaDe(r)) &&
        (!filtro.maquina || nombreMaquina(r.maquina) === filtro.maquina) &&
        (!filtro.operario || r.operario === filtro.operario)
    ),
    jornadas: jornadas.filter((j) => dentro(j.fecha)),
    alertas: alertas.filter((a) => dentro(a.fecha) && (!filtro.maquina || nombreMaquina(a.maquina) === filtro.maquina))
  };
}

// Las opciones de máquina y operario salen de los registros descargados.
function llenarSelectores() {
  const rellenar = (select, valores, textoTodos) => {
    const actual = select.value;
    select.innerHTML = `<option value="">${textoTodos}</option>`;
    valores.forEach((v) => select.add(new Option(v, v)));
    select.value = valores.includes(actual) ? actual : '';
  };
  rellenar($rd('rd-f-maquina'), [...new Set(suministros.map((r) => nombreMaquina(r.maquina)).filter(Boolean))].sort(), 'Todas las máquinas');
  rellenar($rd('rd-f-operario'), [...new Set(suministros.map((r) => String(r.operario || '').trim()).filter(Boolean))].sort(), 'Todos los operarios');
}

// --- Pintado ---------------------------------------------------------------------
function pintarTodo() {
  const { registros, jornadas: jornadasPeriodo, alertas: alertasPeriodo } = datosFiltrados();
  pintarCabecera(registros, jornadasPeriodo, alertasPeriodo);
  pintarConsumo(registros, jornadasPeriodo);
  pintarCierres(jornadasPeriodo);
  pintarRegistros(registros, alertasPeriodo);
  pintarMaquinas(registros, alertasPeriodo);
  pintarOperarios(registros);
  pintarAlertas(alertasPeriodo);
}

// Tarjeta del reporte, indicadores y pestañas con su cuenta.
function pintarCabecera(registros, jornadasPeriodo, alertasPeriodo) {
  $rd('rd-periodo').textContent = `${fechaCorta(filtro.desde)} – ${fechaCorta(filtro.hasta)}`;
  const partes = [filtro.maquina && `Máquina ${filtro.maquina}`, filtro.operario && `Operario ${filtro.operario}`].filter(Boolean);
  $rd('rd-filtro').textContent = partes.join(' · ') || 'Todas las máquinas y operarios';
  const textoActivos = partes.length ? `${partes.length} filtro(s) activo(s)` : '';
  $rd('rd-activos').textContent = textoActivos;
  $rd('rd-activos-cel').textContent = textoActivos;

  // Total entregado (incluye lo que se pasó al tanque móvil, mostrado aparte).
  const total = registros.reduce((t, r) => t + numero(r.cantidad), 0);
  const aTanque = registros.filter((r) => esTanqueMovil(r.maquina)).reduce((t, r) => t + numero(r.cantidad), 0);
  $rd('rd-k-total').innerHTML = `${gal(total)}<small>gal</small>`;
  $rd('rd-k-total-p').textContent = aTanque ? `${gal(total - aTanque)} a máquinas · ${gal(aTanque)} al tanque móvil` : 'Todo directo a máquinas';

  // Surtidor: solo jornadas cerradas. Se compara con lo registrado esos mismos días.
  const cerradas = jornadasPeriodo.filter((j) => j.estado === 'cerrada');
  const surtidor = cerradas.reduce((t, j) => t + numero(j.totalGalones), 0);
  $rd('rd-k-surtidor').innerHTML = `${gal(surtidor)}<small>gal</small>`;
  const pie = $rd('rd-k-surtidor-p');
  if (filtro.maquina || filtro.operario) {
    pie.className = '';
    pie.innerHTML = '<span class="rd-punto"></span>Total del surtidor (no se filtra por máquina)';
  } else if (!cerradas.length) {
    pie.className = '';
    pie.innerHTML = '<span class="rd-punto"></span>Sin días cerrados en el periodo';
  } else {
    const diasCerrados = new Set(cerradas.map((j) => j.fecha));
    const entregado = registros.filter((r) => diasCerrados.has(fechaDe(r))).reduce((t, r) => t + numero(r.cantidad), 0);
    const diferencia = surtidor - entregado;
    const cuadra = Math.abs(diferencia) <= TOLERANCIA_CIERRE * cerradas.length;
    pie.className = cuadra ? 'rd-ok' : 'rd-mal';
    pie.innerHTML = `<span class="rd-punto"></span>${cuadra ? 'Cuadra con lo registrado' : 'No cuadra con lo registrado'} (dif. ${diferencia >= 0 ? '+' : ''}${gal(diferencia)} gal)`;
  }

  const maquinas = new Set(registros.map((r) => nombreMaquina(r.maquina))).size;
  const operarios = new Set(registros.map((r) => r.operario)).size;
  $rd('rd-k-registros').textContent = String(registros.length);
  $rd('rd-k-registros-p').textContent = `${maquinas} máquinas · ${operarios} operarios`;

  const pendientes = alertasPeriodo.filter((a) => a.estado !== 'justificada').length;
  $rd('rd-k-alertas').textContent = String(alertasPeriodo.length);
  const pieAlertas = $rd('rd-k-alertas-p');
  pieAlertas.className = pendientes ? 'rd-mal' : 'rd-ok';
  pieAlertas.innerHTML = `<span class="rd-punto"></span>${
    alertasPeriodo.length ? `${pendientes} pendientes · ${alertasPeriodo.length - pendientes} justificadas` : 'Sin alertas'
  }`;

  pintarPestanas({
    cierres: jornadasPeriodo.filter((j) => !esJornadaVacia(j)).length,
    registros: registros.length,
    maquinas,
    operarios,
    alertas: alertasPeriodo.length
  });
}

// Botones de las pestañas. Sin cuentas (mientras carga) se pintan solo los nombres.
function pintarPestanas(cuentas = {}) {
  const pestanas = [
    ['consumo', '📊', 'Consumo'],
    ['cierres', '⛽', 'Cierres'],
    ['registros', '📋', 'Registros'],
    ['maquinas', '🚜', 'Máquinas'],
    ['operarios', '👷', 'Operarios'],
    ['alertas', '⚠️', 'Alertas']
  ];
  $rd('rd-pestanas').innerHTML = pestanas
    .map(
      ([id, icono, nombre]) =>
        `<button type="button" role="tab" data-pestana="${id}" aria-selected="${id === pestanaActual}">${icono} ${nombre}${
          cuentas[id] !== undefined ? ` <span class="rd-cuenta">${cuentas[id]}</span>` : ''
        }</button>`
    )
    .join('');
}

// Columnas surtidor vs. entregado (por mes o por día), ranking y dona.
function pintarConsumo(registros, jornadasPeriodo) {
  const cerradas = jornadasPeriodo.filter((j) => j.estado === 'cerrada');
  const sumaRegistros = (prueba) => registros.filter((r) => prueba(fechaDe(r))).reduce((t, r) => t + numero(r.cantidad), 0);
  const sumaSurtidor = (prueba) => cerradas.filter((j) => prueba(j.fecha)).reduce((t, j) => t + numero(j.totalGalones), 0);
  let grupos;
  if (agrupar === 'mes') {
    const anio = filtro.desde.slice(0, 4);
    const desde = Number(filtro.desde.slice(5, 7));
    const hasta = filtro.hasta.slice(0, 4) === anio ? Number(filtro.hasta.slice(5, 7)) : 12;
    grupos = [];
    for (let m = desde; m <= hasta; m++) {
      const clave = `${anio}-${String(m).padStart(2, '0')}`;
      grupos.push({ etiqueta: MESES_CORTOS[m - 1], entregado: sumaRegistros((f) => f.startsWith(clave)), surtidor: sumaSurtidor((f) => f.startsWith(clave)) });
    }
    $rd('rd-t-grafica').textContent = 'Consumo por mes';
  } else {
    const dias = [...new Set([...registros.map(fechaDe), ...cerradas.map((j) => j.fecha)])].sort();
    grupos = dias.map((d) => ({ etiqueta: `${d.slice(8, 10)}/${d.slice(5, 7)}`, entregado: sumaRegistros((f) => f === d), surtidor: sumaSurtidor((f) => f === d) }));
    $rd('rd-t-grafica').textContent = 'Consumo por día';
  }
  const hayDatos = grupos.some((g) => g.entregado > 0 || g.surtidor > 0);
  $rd('rd-g-vacio').hidden = hayDatos;
  const tope = Math.max(1, ...grupos.flatMap((g) => [g.entregado, g.surtidor]));
  const alto = (v) => `${v > 0 ? Math.max(2, (v / tope) * 92) : 0}%`;
  const valor = (v) => (v > 0 ? `<b>${Math.round(v).toLocaleString('es-CO')}</b>` : '');
  $rd('rd-g-columnas').innerHTML = grupos
    .map(
      (g) => `<div class="rd-col" title="${g.etiqueta}: surtidor ${gal(g.surtidor)} gal · entregado ${gal(g.entregado)} gal">
        <div class="rd-pareja"><span class="rd-barra rd-surtidor" style="height:${alto(g.surtidor)}">${valor(g.surtidor)}</span><span class="rd-barra" style="height:${alto(g.entregado)}">${valor(g.entregado)}</span></div>
      </div>`
    )
    .join('');
  $rd('rd-g-etiquetas').innerHTML = grupos.map((g) => `<span>${g.etiqueta}</span>`).join('');

  // Ranking y dona: solo máquinas que consumen (sin el tanque móvil).
  const porMaquina = new Map();
  registros
    .filter((r) => !esTanqueMovil(r.maquina) && nombreMaquina(r.maquina))
    .forEach((r) => porMaquina.set(nombreMaquina(r.maquina), (porMaquina.get(nombreMaquina(r.maquina)) || 0) + numero(r.cantidad)));
  const orden = [...porMaquina].sort((a, b) => b[1] - a[1]);
  const top = orden.slice(0, 6);
  const maximo = top[0]?.[1] || 1;
  $rd('rd-g-ranking').innerHTML = top.length
    ? top
        .map(
          ([m, g]) =>
            `<div class="rd-fila-rank"><b>${escapeHtml(m)}</b><span class="rd-pista"><span style="width:${Math.max(4, (g / maximo) * 100)}%"></span></span><em>${gal(g)} gal</em></div>`
        )
        .join('')
    : '<p class="rd-vacio">Sin consumo de máquinas en el periodo.</p>';

  const totalMaquinas = orden.reduce((t, x) => t + x[1], 0);
  const otras = orden.slice(6).reduce((t, x) => t + x[1], 0);
  const trozos = [
    ...top.map(([m, g], i) => ({ m, g, color: COLORES_DONA[i] })),
    ...(otras > 0 ? [{ m: `Otras (${orden.length - 6})`, g: otras, color: COLOR_OTRAS }] : [])
  ];
  const radio = 60;
  const circunferencia = 2 * Math.PI * radio;
  let acumulado = 0;
  const arcos = trozos
    .map((t) => {
      const largo = (t.g / (totalMaquinas || 1)) * circunferencia;
      const arco = `<circle r="${radio}" cx="85" cy="85" fill="none" stroke="${t.color}" stroke-width="24" stroke-dasharray="${largo} ${circunferencia - largo}" stroke-dashoffset="${-acumulado}"></circle>`;
      acumulado += largo;
      return arco;
    })
    .join('');
  $rd('rd-g-dona').innerHTML = totalMaquinas
    ? `<div class="rd-dona"><svg width="170" height="170" viewBox="0 0 170 170" aria-hidden="true">${arcos}</svg><div><strong>${gal(totalMaquinas)}</strong><small>gal a máquinas</small></div></div>
       <div class="rd-dona-leyenda">${trozos
         .map((t) => `<div><i style="background:${t.color}"></i><b>${escapeHtml(t.m)}</b><span>${gal((t.g / totalMaquinas) * 100)}%</span><span>${gal(t.g)}</span></div>`)
         .join('')}</div>`
    : '<p class="rd-vacio">Sin datos.</p>';
}

// Cierres del surtidor: lecturas, conciliación diaria y chequeo del equipo.
// Las jornadas vacías (solo checklist, sin uso) no se listan.
function pintarCierres(jornadasPeriodo) {
  const registradoDia = (fecha) => suministros.filter((r) => fechaDe(r) === fecha).reduce((t, r) => t + numero(r.cantidad), 0);
  const lecturas = (v) => (v === null || v === undefined || String(v).trim() === '' ? '—' : escapeHtml(v));
  const chequeo = (v) => {
    const texto = String(v || '').trim();
    const clase = !texto ? 'rd-e-gris' : /^no$|buen/i.test(texto) ? 'rd-e-ok' : 'rd-e-crit';
    return `<span class="rd-etiqueta ${clase}">${escapeHtml(texto || '—')}</span>`;
  };
  let cuadran = 0;
  let revisar = 0;
  let sinCerrar = 0;
  const visibles = jornadasPeriodo.filter((j) => !esJornadaVacia(j)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  $rd('rd-c-filas').innerHTML =
    visibles
      .map((j) => {
        const cerrada = j.estado === 'cerrada';
        const registrado = registradoDia(j.fecha);
        const diferencia = cerrada ? numero(j.totalGalones) - registrado : null;
        let estado;
        if (!cerrada) {
          estado = '<span class="rd-etiqueta rd-e-crit">Sin cerrar</span>';
          sinCerrar++;
        } else if (Math.abs(diferencia) <= TOLERANCIA_CIERRE) {
          estado = '<span class="rd-etiqueta rd-e-ok">Cuadra</span>';
          cuadran++;
        } else {
          estado = '<span class="rd-etiqueta rd-e-adv">Revisar</span>';
          revisar++;
        }
        return `<tr><td>${fechaCorta(j.fecha)}</td><td>${estado}</td>
          <td class="num">${lecturas(j.m1Inicial)}</td><td class="num">${lecturas(j.m1Final)}</td><td class="num">${cerrada ? gal(j.galonesM1) : '—'}</td>
          <td class="num">${lecturas(j.m2Inicial)}</td><td class="num">${lecturas(j.m2Final)}</td><td class="num">${cerrada ? gal(j.galonesM2) : '—'}</td>
          <td class="num"><b>${cerrada ? gal(j.totalGalones) : '—'}</b></td><td class="num">${gal(registrado)}</td>
          <td class="num">${diferencia === null ? '—' : (diferencia >= 0 ? '+' : '') + gal(diferencia)}</td>
          <td>${chequeo(j.fugaBiodiesel)}</td><td>${chequeo(j.sistemaElectrico)}</td><td>${chequeo(j.paradaEmergencia)}</td></tr>`;
      })
      .join('') || vacioFila(14, 'Sin cierres en el periodo.');

  const cerradas = jornadasPeriodo.filter((j) => j.estado === 'cerrada');
  $rd('rd-c-mini').innerHTML = `
    <div><small>Días cerrados</small><strong>${cerradas.length}</strong></div>
    <div><small>Cuadran con lo registrado</small><strong class="rd-ok">${cuadran}</strong></div>
    <div><small>Para revisar</small><strong class="${revisar ? 'rd-mal' : ''}">${revisar}</strong></div>
    <div><small>Sin cerrar (con uso)</small><strong class="${sinCerrar ? 'rd-mal' : ''}">${sinCerrar}</strong></div>
    <div><small>Galones M1 · M2</small><strong>${gal(cerradas.reduce((t, j) => t + numero(j.galonesM1), 0), 0)} · ${gal(cerradas.reduce((t, j) => t + numero(j.galonesM2), 0), 0)}</strong></div>`;
}

// Estado de un registro según la alerta que generó (por id o por fecha + máquina).
function alertaDeRegistro(registro, alertasPeriodo) {
  return alertasPeriodo.find(
    (a) => (a.registro_id && String(a.registro_id) === String(registro.id)) || (a.fecha === fechaDe(registro) && nombreMaquina(a.maquina) === nombreMaquina(registro.maquina))
  );
}

function pintarRegistros(registros, alertasPeriodo) {
  const busqueda = $rd('rd-reg-buscar').value.trim().toLowerCase();
  const lista = registros
    .filter((r) => !busqueda || [r.maquina, r.operario, r.numeroSai, r.cedula].some((v) => String(v || '').toLowerCase().includes(busqueda)))
    .sort((a, b) => fechaDe(b).localeCompare(fechaDe(a)) || numero(b.cantidad) - numero(a.cantidad));
  const paginas = Math.max(1, Math.ceil(lista.length / REGISTROS_POR_PAGINA));
  pagina = Math.min(pagina, paginas);
  const inicio = (pagina - 1) * REGISTROS_POR_PAGINA;
  $rd('rd-reg-sub').textContent = `${lista.length} registros · ${gal(lista.reduce((t, r) => t + numero(r.cantidad), 0))} gal`;
  // Al imprimir salen todos los registros (la clase rd-solo-pantalla oculta la paginación).
  $rd('rd-reg-filas').innerHTML =
    lista
      .map((r, i) => {
        const alerta = alertaDeRegistro(r, alertasPeriodo);
        const tipo = alerta ? TIPOS_ALERTA[alerta.tipo_alerta] || TIPOS_ALERTA.sobrecapacidad : null;
        const estado = esTanqueMovil(r.maquina)
          ? '<span class="rd-etiqueta rd-e-naranja">Tanque móvil</span>'
          : tipo
            ? `<span class="rd-etiqueta ${tipo.clase}">${tipo.nivel}</span>`
            : '<span class="rd-etiqueta rd-e-ok">Normal</span>';
        const fuera = i < inicio || i >= inicio + REGISTROS_POR_PAGINA ? ' class="rd-otra-pagina"' : '';
        return `<tr${fuera}><td>${i + 1}</td><td>${fechaCorta(fechaDe(r))}</td><td><b>${escapeHtml(r.maquina || '')}</b></td><td>${escapeHtml(tipoDe(r.maquina))}</td>
          <td>${escapeHtml(r.operario || '')}</td><td>${escapeHtml(r.cedula || '')}</td><td class="num">${escapeHtml(r.horometro || '—')}</td>
          <td class="num"><b>${gal(r.cantidad)}</b></td><td>${escapeHtml(r.numeroSai || '—')}</td><td>${estado}</td><td class="rd-texto">${escapeHtml(r.observaciones || '—')}</td></tr>`;
      })
      .join('') || vacioFila(11, 'No hay registros en este periodo.');
  $rd('rd-reg-pie').textContent = lista.length ? `Mostrando ${inicio + 1} – ${Math.min(inicio + REGISTROS_POR_PAGINA, lista.length)} de ${lista.length}` : '';
  $rd('rd-reg-paginas').innerHTML =
    paginas > 1
      ? `<button type="button" data-pagina="${pagina - 1}" ${pagina === 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>` +
        Array.from({ length: paginas }, (_, i) => `<button type="button" data-pagina="${i + 1}" class="${i + 1 === pagina ? 'actual' : ''}">${i + 1}</button>`).join('') +
        `<button type="button" data-pagina="${pagina + 1}" ${pagina === paginas ? 'disabled' : ''} aria-label="Página siguiente">›</button>`
      : '';
}

function pintarMaquinas(registros, alertasPeriodo) {
  const mapa = new Map();
  registros.forEach((r) => {
    const m = nombreMaquina(r.maquina);
    if (!m) return;
    const x = mapa.get(m) || { m, n: 0, g: 0, max: 0 };
    x.n++;
    x.g += numero(r.cantidad);
    x.max = Math.max(x.max, numero(r.cantidad));
    mapa.set(m, x);
  });
  const filas = [...mapa.values()].map((x) => ({
    ...x,
    alertas: alertasPeriodo.filter((a) => nombreMaquina(a.maquina) === x.m).length,
    capacidad: infoMaquinas.get(x.m)?.capacidad || 0
  }));
  const ordenes = {
    galones: (a, b) => b.g - a.g,
    menor: (a, b) => a.g - b.g,
    registros: (a, b) => b.n - a.n,
    alertas: (a, b) => b.alertas - a.alertas || b.g - a.g,
    nombre: (a, b) => a.m.localeCompare(b.m)
  };
  $rd('rd-maq-filas').innerHTML =
    filas
      .sort(ordenes[$rd('rd-maq-orden').value] || ordenes.galones)
      .map(
        (x, i) => `<tr><td>${i + 1}</td><td><b>${escapeHtml(x.m)}</b></td><td>${escapeHtml(tipoDe(x.m))}</td><td class="num">${x.n}</td>
          <td class="num"><b>${gal(x.g)}</b></td><td class="num">${gal(x.g / x.n)}</td><td class="num">${gal(x.max)}</td>
          <td class="num">${x.capacidad ? gal(x.capacidad) : '—'}</td>
          <td><span class="rd-etiqueta ${x.alertas ? 'rd-e-adv' : 'rd-e-ok'}">${x.alertas}</span></td></tr>`
      )
      .join('') || vacioFila(9, 'No hay consumo de máquinas en este periodo.');
}

function pintarOperarios(registros) {
  const mapa = new Map();
  registros.forEach((r) => {
    const nombre = String(r.operario || '').trim() || 'Sin operario';
    const x = mapa.get(nombre) || { nombre, cedula: r.cedula || '', n: 0, g: 0, maquinas: new Set(), ultimo: '' };
    x.n++;
    x.g += numero(r.cantidad);
    if (r.maquina) x.maquinas.add(nombreMaquina(r.maquina));
    if (fechaDe(r) > x.ultimo) x.ultimo = fechaDe(r);
    mapa.set(nombre, x);
  });
  $rd('rd-op-filas').innerHTML =
    [...mapa.values()]
      .sort((a, b) => b.g - a.g)
      .map(
        (x, i) => `<tr><td>${i + 1}</td><td><b>${escapeHtml(x.nombre)}</b></td><td>${escapeHtml(x.cedula)}</td><td class="num">${x.n}</td>
          <td class="num"><b>${gal(x.g)}</b></td><td class="rd-texto">${escapeHtml([...x.maquinas].join(', '))}</td><td>${fechaCorta(x.ultimo)}</td></tr>`
      )
      .join('') || vacioFila(7, 'No hay operarios en este periodo.');
}

function pintarAlertas(alertasPeriodo) {
  $rd('rd-al-mini').innerHTML = Object.entries(TIPOS_ALERTA)
    .map(([clave, t]) => {
      const n = alertasPeriodo.filter((a) => (a.tipo_alerta || 'sobrecapacidad') === clave).length;
      return `<div><small>${t.icono} ${t.nombre}</small><strong class="${n ? 'rd-mal' : ''}">${n}</strong></div>`;
    })
    .join('');
  const cifra = (v) => (v === '' || v === null || v === undefined || numero(v) === 0 ? '—' : gal(v, 2));
  $rd('rd-al-filas').innerHTML =
    [...alertasPeriodo]
      .sort((a, b) => (a.estado === 'justificada') - (b.estado === 'justificada') || b.fecha.localeCompare(a.fecha))
      .map((a) => {
        const t = TIPOS_ALERTA[a.tipo_alerta] || TIPOS_ALERTA.sobrecapacidad;
        // El soporte se abre por /api/alertas/:id/soporte (ruta protegida por sesión y permiso).
        const soporte = a.reporte_ruta ? `<a href="/api/alertas/${encodeURIComponent(a.id)}/soporte" target="_blank" rel="noopener">Abrir</a>` : '—';
        return `<tr><td>${fechaCorta(a.fecha)}</td><td><span class="rd-etiqueta ${t.clase}">${t.icono} ${t.nombre}</span></td><td><b>${escapeHtml(a.maquina || '')}</b></td>
          <td class="num">${cifra(a.cantidad)}</td><td class="num">${cifra(a.capacidad_galones)}</td><td class="num">${cifra(a.exceso_galones)}</td>
          <td class="rd-texto">${escapeHtml(a.detalle_alerta || '—')}</td>
          <td>${a.estado === 'justificada' ? '<span class="rd-etiqueta rd-e-ok">Justificada</span>' : '<span class="rd-etiqueta rd-e-crit">Pendiente</span>'}</td>
          <td class="rd-texto">${escapeHtml(a.justificacion || '—')}</td><td>${soporte}</td></tr>`;
      })
      .join('') || vacioFila(10, 'No hay alertas en este periodo.');
}

// --- Arranque ------------------------------------------------------------------------
function prepararPeriodo() {
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  const rol = String(sesion?.rol || '').replaceAll('_', ' ');
  $rd('rd-generado').textContent = sesion ? `${sesion.usuario}${rol ? ` · ${rol.charAt(0).toUpperCase()}${rol.slice(1)}` : ''}` : '—';

  if (esReporteGeneral) {
    const anio = new Date().getFullYear();
    limites = { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };
    $rd('titulo-reporte-mensual').textContent = 'Reporte general anual';
    $rd('rd-nombre-reporte').textContent = `General anual ${anio}`;
  } else {
    const ultimoDia = new Date(anioReporte, mesReporte, 0).getDate();
    const mes = String(mesReporte).padStart(2, '0');
    limites = { desde: `${anioReporte}-${mes}-01`, hasta: `${anioReporte}-${mes}-${String(ultimoDia).padStart(2, '0')}` };
    $rd('titulo-reporte-mensual').textContent = `${NOMBRES_MESES[mesReporte - 1]} ${anioReporte}`;
    $rd('rd-nombre-reporte').textContent = `Mensual · ${NOMBRES_MESES[mesReporte - 1]} ${anioReporte}`;
    // En un mes, agrupar por mes no tiene sentido: la gráfica va siempre por día.
    $rd('rd-agrupar').hidden = true;
    // Las fechas solo pueden moverse dentro del mes.
    ['fecha-inicio-reporte', 'fecha-fin-reporte'].forEach((id) => Object.assign($rd(id), { min: limites.desde, max: limites.hasta }));
  }
  Object.assign(filtro, limites);
  $rd('rd-periodo').textContent = `${fechaCorta(filtro.desde)} – ${fechaCorta(filtro.hasta)}`;
  $rd('fecha-inicio-reporte').value = filtro.desde;
  $rd('fecha-fin-reporte').value = filtro.hasta;
}

async function iniciar() {
  if (!esReporteGeneral && (!anioReporte || !mesReporte)) {
    $rd('titulo-reporte-mensual').textContent = 'Reporte no encontrado';
    return;
  }
  prepararPeriodo();
  pintarPestanas(); // Visibles desde el inicio; las cuentas llegan con los datos
  // En celular/tablet los filtros arrancan plegados; en PC siempre abiertos.
  const pantallaAngosta = matchMedia('(max-width: 980px)');
  const ajustarFiltros = () => ($rd('rd-filtros-plegable').open = !pantallaAngosta.matches);
  ajustarFiltros();
  pantallaAngosta.addEventListener('change', ajustarFiltros);
  try {
    await Promise.all([cargarInfoMaquinas(), cargarTodo()]);
    pintarTodo(); // Con el tipo y la capacidad de cada máquina ya cargados
  } catch (error) {
    console.warn('No se pudo cargar el reporte', error);
  }
}

// --- Eventos -----------------------------------------------------------------------
$rd('rd-pestanas').addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-pestana]');
  if (!boton) return;
  pestanaActual = boton.dataset.pestana;
  document.querySelectorAll('#rd-pestanas button').forEach((b) => b.setAttribute('aria-selected', String(b === boton)));
  document.querySelectorAll('.rd-panel').forEach((panel) => (panel.hidden = panel.id !== `rd-p-${pestanaActual}`));
});

$rd('rd-agrupar').addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-agrupar]');
  if (!boton) return;
  agrupar = boton.dataset.agrupar;
  $rd('rd-agrupar').querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b === boton));
  const { registros, jornadas: jornadasPeriodo } = datosFiltrados();
  pintarConsumo(registros, jornadasPeriodo);
});

$rd('rd-reg-buscar').addEventListener('input', () => {
  pagina = 1;
  const { registros, alertas: alertasPeriodo } = datosFiltrados();
  pintarRegistros(registros, alertasPeriodo);
});

$rd('rd-reg-paginas').addEventListener('click', (evento) => {
  const boton = evento.target.closest('button[data-pagina]');
  if (!boton || boton.disabled) return;
  pagina = Number(boton.dataset.pagina);
  const { registros, alertas: alertasPeriodo } = datosFiltrados();
  pintarRegistros(registros, alertasPeriodo);
});

$rd('rd-maq-orden').addEventListener('change', () => {
  const { registros, alertas: alertasPeriodo } = datosFiltrados();
  pintarMaquinas(registros, alertasPeriodo);
});

// Aplicar: en modo general, si el rango sale de lo descargado se vuelve a pedir al servidor.
$rd('rd-f-aplicar').addEventListener('click', async () => {
  let desde = $rd('fecha-inicio-reporte').value || limites.desde;
  let hasta = $rd('fecha-fin-reporte').value || limites.hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  Object.assign(filtro, { desde, hasta, maquina: $rd('rd-f-maquina').value, operario: $rd('rd-f-operario').value });
  pagina = 1;
  if (esReporteGeneral && (desde < limites.desde || hasta > limites.hasta)) {
    limites = { desde, hasta };
    await cargarTodo();
  } else {
    pintarTodo();
  }
});

$rd('rd-f-limpiar').addEventListener('click', async () => {
  const anio = new Date().getFullYear();
  const rangoInicial = esReporteGeneral ? { desde: `${anio}-01-01`, hasta: `${anio}-12-31` } : limites;
  const recargar = esReporteGeneral && (limites.desde !== rangoInicial.desde || limites.hasta !== rangoInicial.hasta);
  limites = rangoInicial;
  Object.assign(filtro, rangoInicial, { maquina: '', operario: '' });
  $rd('fecha-inicio-reporte').value = filtro.desde;
  $rd('fecha-fin-reporte').value = filtro.hasta;
  $rd('rd-f-maquina').value = '';
  $rd('rd-f-operario').value = '';
  $rd('rd-reg-buscar').value = '';
  pagina = 1;
  if (recargar) await cargarTodo();
  else pintarTodo();
});

// Imprimir y Exportar PDF hacen lo mismo: el CSS de impresión muestra todas
// las pestañas seguidas y todos los registros (sin paginar).
$rd('boton-imprimir-reporte').addEventListener('click', () => window.print());
$rd('boton-exportar-pdf-reporte').addEventListener('click', () => window.print());

iniciar();

// Se actualiza sola cada 10 segundos mientras la vista está abierta
// (conserva la pestaña, los filtros y la página en la que esté el usuario).
setInterval(async () => {
  try {
    if (document.hidden) return; // Pestaña del navegador en segundo plano: no se consulta
    await cargarTodo();
  } catch (error) {
    console.warn('No fue posible actualizar automaticamente el reporte:', error);
  }
}, 10000);
