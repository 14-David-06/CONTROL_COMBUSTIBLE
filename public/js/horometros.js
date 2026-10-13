// ============================================================================
// horometros.js — VISTA "HORÓMETROS POR MÁQUINA" (public/html/horometros.html)
// ----------------------------------------------------------------------------
// Arriba los totales del periodo (máquinas, horas, galones y gal/hora de la
// flota). Debajo, una carta por máquina (todas las que tanquearon en el rango)
// con horas trabajadas, gal/hora, galones y su parte del consumo total.
// "Ver detalles" despliega tanqueos, promedio, horómetro inicial y final y cada
// tanqueo con sus datos rotulados. A la derecha, el cuadro de estados: cuenta
// las máquinas de cada estado y, al tocar uno, filtra por él.
// Los cálculos los hace el SERVIDOR (GET /api/horometros, regla de 24 h por
// día en src/records/domain/horometro.js): aquí solo se suman, filtran y ordenan.
// ============================================================================

const campoDesde = document.getElementById('horometros-desde');
const campoHasta = document.getElementById('horometros-hasta');
const campoBuscar = document.getElementById('horometros-buscar');
const campoEstado = document.getElementById('horometros-estado');
const campoOrden = document.getElementById('horometros-orden');
const contenedorTarjetas = document.getElementById('horometros-tarjetas');
const contenedorEstados = document.getElementById('horometros-estados');
const mensajeVacio = document.getElementById('horometros-vacio');
const textoPeriodo = document.getElementById('horometros-periodo');

let maquinasPeriodo = []; // Lo que devolvió el servidor para el rango de fechas
let maquinasVisibles = []; // Lo que se ve tras filtrar (también es lo que se exporta)
const maquinasAbiertas = new Set(); // Cartas con "Ver detalles" desplegado

// Los cinco estados que se muestran. El servidor distingue "tanque" y
// "sin-horometro", pero aquí van juntos en "na" (no aplica).
const ESTADOS = {
  ok: { etiqueta: 'Correcta', titulo: 'Registros correctos', descripcion: 'Horas y gal/hora calculados sin ajustes.' },
  ajustado: {
    etiqueta: 'Tramos ajustados',
    titulo: 'Con tramos ajustados',
    descripcion: 'El horómetro marcó más de 24 h por día (o bajó) y se usó el tope. Conviene revisar esas lecturas.'
  },
  'una-lectura': { etiqueta: 'Una sola lectura', titulo: 'Una sola lectura', descripcion: 'Solo un tanqueo trae horómetro: todavía no se pueden calcular horas.' },
  'sin-lecturas': { etiqueta: 'Sin lecturas', titulo: 'Sin lecturas numéricas', descripcion: 'Ningún tanqueo trae un número de horómetro (dañado, vacío...).' },
  na: { etiqueta: 'Sin horómetro', titulo: 'Sin horómetro o tanque móvil', descripcion: 'Marcadas "No aplica" en Máquinas, o el tanque móvil. No entran en horas ni promedio.' }
};
const grupoEstado = (m) => (['tanque', 'sin-horometro'].includes(m.estado) ? 'na' : m.estado);
const etiquetaEstado = (m) => (m.estado === 'tanque' ? 'Tanque móvil' : (ESTADOS[grupoEstado(m)] || ESTADOS.ok).etiqueta);
const esNoAplica = (m) => grupoEstado(m) === 'na';

// --- Formatos ----------------------------------------------------------------
const valido = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
const numero = (n, decimales = 2) =>
  valido(n) ? Number(n).toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) : '—';
const fechaCorta = (fecha) => String(fecha || '').slice(0, 10).split('-').reverse().join('/');
// Fecha local de hoy en YYYY-MM-DD (no UTC, para que no salte de día de noche).
function hoyLocalTexto() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}
// Ícono según el tipo de máquina (descripción o código).
function iconoMaquina(m) {
  const texto = `${m.descripcion || ''} ${m.maquina}`.toUpperCase();
  if (m.estado === 'tanque' || /TANQUE/.test(texto)) return '🛢️';
  if (/CAMIONETA/.test(texto)) return '🛻';
  if (/CAMI[OÓ]N|VOLQUETA|TRACTOMULA/.test(texto)) return '🚛';
  if (/MOTO/.test(texto)) return '🏍️';
  if (/TRACTOR/.test(texto)) return '🚜';
  return '⚙️';
}

// --- Datos ---------------------------------------------------------------------
async function cargarHorometros() {
  textoPeriodo.textContent = `Del ${fechaCorta(campoDesde.value)} al ${fechaCorta(campoHasta.value)}`;
  const parametros = new URLSearchParams({ fechaInicio: campoDesde.value, fechaFin: campoHasta.value });
  try {
    const respuesta = await fetch(`/api/horometros?${parametros}`, { cache: 'no-store' });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudo cargar el reporte de horómetros.');
    maquinasPeriodo = Array.isArray(datos) ? datos : [];
    pintar();
  } catch (error) {
    maquinasPeriodo = [];
    pintar();
    mostrarAlertaError('No se pudo cargar', error.message);
  }
}

// Filtro por texto (sirve también para contar los estados del cuadro lateral).
function coincideTexto(m) {
  const texto = campoBuscar.value.trim().toLowerCase();
  return !texto || m.maquina.toLowerCase().includes(texto) || String(m.descripcion || '').toLowerCase().includes(texto);
}

// Orden elegido. Las máquinas sin horómetro y el tanque van siempre al final,
// salvo en el orden por nombre.
const PRIORIDAD_REVISION = { ajustado: 0, 'sin-lecturas': 1, 'una-lectura': 2, ok: 3, na: 4 };
const ORDENES = {
  galones: (a, b) => b.galones - a.galones,
  horas: (a, b) => (b.horasTrabajadas ?? -1) - (a.horasTrabajadas ?? -1),
  galh: (a, b) => (b.galonesPorHora ?? -1) - (a.galonesPorHora ?? -1),
  revision: (a, b) => PRIORIDAD_REVISION[grupoEstado(a)] - PRIORIDAD_REVISION[grupoEstado(b)] || b.galones - a.galones,
  nombre: (a, b) => a.maquina.localeCompare(b.maquina, 'es', { numeric: true })
};
function filtrarYOrdenar() {
  const estado = campoEstado.value;
  const orden = ORDENES[campoOrden.value] || ORDENES.galones;
  const alFinal = campoOrden.value === 'nombre' ? () => 0 : (m) => (esNoAplica(m) ? 1 : 0);
  return maquinasPeriodo
    .filter((m) => coincideTexto(m) && (!estado || grupoEstado(m) === estado))
    .sort((a, b) => alFinal(a) - alFinal(b) || orden(a, b));
}

// --- Totales del periodo -----------------------------------------------------------
// Gal/hora de la flota = galones de los tramos ÷ horas, sumando todas las
// máquinas con horas (no es el promedio de los promedios, que engañaría).
function pintarTotales(lista) {
  const conHorometro = lista.filter((m) => !esNoAplica(m));
  const horas = conHorometro.reduce((t, m) => t + (Number(m.horasTrabajadas) || 0), 0);
  const galonesTramos = conHorometro.reduce((t, m) => t + (m.horasTrabajadas > 0 ? Number(m.galonesTramos) || 0 : 0), 0);
  const galones = lista.filter((m) => m.estado !== 'tanque').reduce((t, m) => t + m.galones, 0);
  const tanqueos = lista.reduce((t, m) => t + m.cantidadTanqueos, 0);
  document.getElementById('kpi-maquinas').textContent = String(lista.length);
  document.getElementById('kpi-maquinas-nota').textContent = `${tanqueos} tanqueos en el periodo`;
  document.getElementById('kpi-horas').textContent = `${numero(horas, 1)} h`;
  document.getElementById('kpi-galones').textContent = `${numero(galones, 1)} gal`;
  document.getElementById('kpi-galh').textContent = horas > 0 ? `${numero(galonesTramos / horas)} gal/h` : '—';
  return galones;
}

// --- Cuadro de estados (cuenta y filtra) -----------------------------------------
function pintarEstados() {
  const conteo = {};
  maquinasPeriodo.filter(coincideTexto).forEach((m) => {
    conteo[grupoEstado(m)] = (conteo[grupoEstado(m)] || 0) + 1;
  });
  contenedorEstados.innerHTML = Object.entries(ESTADOS)
    .map(
      ([clave, e]) => `
      <button type="button" class="estado-fila estado-${clave}${campoEstado.value === clave ? ' activo' : ''}" data-estado="${clave}" aria-pressed="${campoEstado.value === clave}">
        <i aria-hidden="true"></i>
        <span><strong>${escapeHtml(e.titulo)}</strong><small>${escapeHtml(e.descripcion)}</small></span>
        <b>${conteo[clave] || 0}</b>
      </button>`
    )
    .join('');
}

// --- Cartas ----------------------------------------------------------------------
// Un dato rotulado (mismo estilo que los campos de Historial).
function dato(etiqueta, valor) {
  return `<div class="campo-registro-tarjeta"><span>${escapeHtml(etiqueta)}</span><strong>${escapeHtml(valor)}</strong></div>`;
}

// Explica por qué un tramo se ajustó (o vacío si no se ajustó).
function motivoAjuste(t) {
  if (t.retrocede) return `El horómetro bajó (${numero(t.horasHorometro, 1)} h): se cuentan 0 h`;
  if (t.ajustado) return `El horómetro marcó ${numero(t.horasHorometro, 1)} h, pero en ese tiempo solo caben ${numero(t.topeHoras, 0)} h (24 h por día)`;
  return '';
}

// Cada tanqueo es un bloque pequeño con todos sus datos rotulados.
function htmlTanqueo(t, indice) {
  const motivo = motivoAjuste(t);
  const horas = t.horasTramo === null ? (indice === 0 ? 'Primera lectura' : '—') : `${numero(t.horasTramo, 1)} h`;
  return `
    <li class="tanqueo-item${motivo ? ' tanqueo-ajustado' : ''}">
      <div class="tanqueo-cabecera"><strong>📅 ${escapeHtml(fechaCorta(t.fecha))}</strong><span>👤 ${escapeHtml(t.operario || '—')}</span></div>
      <div class="tanqueo-datos">
        ${dato('Horómetro', t.horometro || '—')}
        ${dato('Galones', numero(t.cantidad))}
        ${dato('Horas trabajadas', horas)}
        ${dato('Gal/hora', numero(t.galonesPorHoraTramo))}
      </div>
      ${motivo ? `<p class="tanqueo-motivo">⚠ ${escapeHtml(motivo)}</p>` : ''}
      ${t.observaciones ? `<p class="tanqueo-observacion">💬 ${escapeHtml(t.observaciones)}</p>` : ''}
    </li>`;
}

// Texto del aviso dentro de "Ver detalles" según el estado.
function avisoEstado(m) {
  if (m.estado === 'ajustado') {
    const n = (m.tramosAjustados || 0) + (m.tramosQueRetroceden || 0);
    return `⚠ ${n} tramo(s) ajustado(s): abajo, en rojo, está la lectura que se pasó del tope.`;
  }
  if (m.estado === 'tanque') return 'Tanque móvil: no tiene horómetro y sus galones no suman al total (luego se reparten a la maquinaria).';
  return grupoEstado(m) === 'ok' ? '' : ESTADOS[grupoEstado(m)].descripcion;
}

function crearTarjeta(m, galonesTotales) {
  const grupo = grupoEstado(m);
  const abierta = maquinasAbiertas.has(m.maquina);
  const porcentaje = m.estado !== 'tanque' && galonesTotales > 0 ? (m.galones / galonesTotales) * 100 : null;
  const aviso = avisoEstado(m);
  const horas = valido(m.horasTrabajadas) ? `${numero(m.horasTrabajadas, 1)} h` : '—';
  const galh = valido(m.galonesPorHora) ? numero(m.galonesPorHora) : '—';

  const tarjeta = document.createElement('article');
  tarjeta.className = `panel carta-horometro estado-${grupo}`;
  tarjeta.innerHTML = `
    <div class="carta-horometro-cabecera">
      <span class="carta-horometro-icono" aria-hidden="true">${iconoMaquina(m)}</span>
      <div class="carta-horometro-nombre"><h3>${escapeHtml(m.maquina)}</h3><p>${escapeHtml(m.descripcion || 'Sin descripción')}</p></div>
      <span class="etiqueta-estado estado-${grupo}">${escapeHtml(etiquetaEstado(m))}</span>
    </div>
    <div class="carta-horometro-metricas">
      <div><small>Horas</small><strong>${escapeHtml(horas)}</strong></div>
      <div class="metrica-galh"><small>Gal/hora</small><strong>${escapeHtml(galh)}</strong></div>
      <div><small>Galones</small><strong>${escapeHtml(numero(m.galones, 1))}</strong></div>
    </div>
    <div class="carta-horometro-barra">
      <div class="barra-consumo"><span></span></div>
      <small>${porcentaje === null ? 'No suma al total' : `${numero(porcentaje, 1)} % del total`}</small>
    </div>
    <button type="button" class="carta-horometro-ver" aria-expanded="${abierta}"><span>👁 Ver detalles · ${m.cantidadTanqueos} tanqueo${m.cantidadTanqueos === 1 ? '' : 's'}</span><span aria-hidden="true">${abierta ? '▾' : '›'}</span></button>
    <div class="carta-horometro-detalle" ${abierta ? '' : 'hidden'}>
      <div class="grid-campos-registro">
        ${dato('Tanqueos', String(m.cantidadTanqueos))}
        ${dato('Promedio por tanqueo', `${numero(m.promedio)} gal`)}
        ${dato('Horómetro inicial', numero(m.horometroInicial, 1))}
        ${dato('Horómetro final', numero(m.horometroFinal, 1))}
      </div>
      ${aviso ? `<p class="carta-horometro-aviso estado-${grupo}">${escapeHtml(aviso)}</p>` : ''}
      <ol class="lista-tanqueos">${m.tanqueos.map(htmlTanqueo).join('')}</ol>
    </div>`;

  // El ancho de la barra se pone por JS (los estilos en línea los bloquea la CSP).
  tarjeta.querySelector('.barra-consumo span').style.width = `${Math.min(100, porcentaje || 0)}%`;

  const boton = tarjeta.querySelector('.carta-horometro-ver');
  const detalle = tarjeta.querySelector('.carta-horometro-detalle');
  boton.addEventListener('click', () => {
    detalle.hidden = !detalle.hidden;
    if (detalle.hidden) maquinasAbiertas.delete(m.maquina);
    else maquinasAbiertas.add(m.maquina);
    boton.setAttribute('aria-expanded', String(!detalle.hidden));
    boton.lastElementChild.textContent = detalle.hidden ? '›' : '▾';
  });
  return tarjeta;
}

function pintar() {
  maquinasVisibles = filtrarYOrdenar();
  const galonesTotales = pintarTotales(maquinasVisibles);
  pintarEstados();
  contenedorTarjetas.innerHTML = '';
  maquinasVisibles.forEach((m) => contenedorTarjetas.appendChild(crearTarjeta(m, galonesTotales)));
  mensajeVacio.hidden = maquinasVisibles.length > 0;
}

// --- Excel: una fila por tanqueo con los totales de su máquina -------------------
function exportarExcel() {
  const celda = (v) => `<td>${escapeHtml(v === null || v === undefined ? '' : String(v))}</td>`;
  const num = (n, d = 2) => (valido(n) ? Number(n).toFixed(d) : '');
  const filas = maquinasVisibles
    .flatMap((m) =>
      m.tanqueos.map(
        (t) =>
          `<tr>${[
            m.maquina, m.tipo, fechaCorta(t.fecha), t.operario, t.horometro, num(t.cantidad),
            num(t.horasHorometro, 1), num(t.horasTramo, 1), motivoAjuste(t), num(t.galonesPorHoraTramo), t.observaciones,
            m.cantidadTanqueos, num(m.galones), num(m.promedio), num(m.horometroInicial, 1), num(m.horometroFinal, 1),
            num(m.horasTrabajadas, 1), num(m.galonesPorHora), etiquetaEstado(m)
          ].map(celda).join('')}</tr>`
      )
    )
    .join('');
  const encabezados = ['Máquina', 'Tipo', 'Fecha', 'Operario', 'Horómetro', 'Galones', 'Horas según horómetro', 'Horas trabajadas (máx. 24 h/día)', 'Ajuste', 'Gal/hora del tramo', 'Observaciones',
    'Tanqueos (máquina)', 'Galones (máquina)', 'Promedio por tanqueo', 'Horómetro inicial', 'Horómetro final', 'Horas trabajadas (máquina)', 'Gal/hora (máquina)', 'Estado'];
  const html = `<html><head><meta charset="UTF-8"></head><body><table><thead><tr>${encabezados.map((e) => `<th>${e}</th>`).join('')}</tr></thead><tbody>${filas}</tbody></table></body></html>`;
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob([html], { type: 'application/vnd.ms-excel' }));
  enlace.download = `horometros-${campoDesde.value}-a-${campoHasta.value}.xls`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

// --- Eventos y carga inicial: del 1 de enero del año actual hasta hoy -------------
function fechasPorDefecto() {
  const hoy = hoyLocalTexto();
  campoDesde.value = `${hoy.slice(0, 4)}-01-01`;
  campoHasta.value = hoy;
}

function limpiarFiltros() {
  campoBuscar.value = '';
  campoEstado.value = '';
  campoOrden.value = 'galones';
  fechasPorDefecto();
  cargarHorometros();
}

fechasPorDefecto();
campoDesde.addEventListener('change', cargarHorometros);
campoHasta.addEventListener('change', cargarHorometros);
campoBuscar.addEventListener('input', pintar);
campoEstado.addEventListener('change', pintar);
campoOrden.addEventListener('change', pintar);
// Tocar un estado del cuadro lateral filtra por él; tocarlo otra vez lo quita.
contenedorEstados.addEventListener('click', (e) => {
  const fila = e.target.closest('[data-estado]');
  if (!fila) return;
  campoEstado.value = campoEstado.value === fila.dataset.estado ? '' : fila.dataset.estado;
  pintar();
});
document.getElementById('horometros-limpiar').addEventListener('click', limpiarFiltros);
document.getElementById('horometros-exportar').addEventListener('click', exportarExcel);
document.getElementById('horometros-imprimir').addEventListener('click', () => window.print());
cargarHorometros();
