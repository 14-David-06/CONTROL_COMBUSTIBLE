// ============================================================================
// horometros.js — VISTA "HORÓMETROS POR MÁQUINA" (public/html/horometros.html)
// ----------------------------------------------------------------------------
// Arriba los totales del periodo (máquinas, horas, galones y gal/hora de la
// flota). Debajo, una carta por máquina (todas las que tanquearon en el rango)
// con horas trabajadas, gal/hora, galones y su parte del consumo total.
// "Ver detalles" oculta las demás cartas y abre esa máquina a todo el ancho:
// promedio, horómetro inicial y final y una TABLA con cada tanqueo. A la derecha, el cuadro de estados: cuenta
// las máquinas de cada estado y, al tocar uno, filtra por él.
// Los cálculos los hace el SERVIDOR (GET /api/horometros, regla de 24 h por
// día en src/records/domain/horometro.js): aquí solo se suman, filtran y ordenan.
// VEHÍCULOS POR KILOMETRAJE (unidad 'km'): los mismos campos traen km recorridos
// y gal/km; aquí solo cambian los rótulos (ver UNIDADES) y se suman aparte.
// Las entregas del TANQUE MÓVIL a cada máquina ya vienen incluidas (origen 'movil').
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
let maquinaEnDetalle = null; // Máquina abierta con "Ver detalles" (las demás se ocultan)

// Los cinco estados que se muestran. El servidor distingue "tanque" y
// "sin-horometro", pero aquí van juntos en "na" (no aplica).
const ESTADOS = {
  ok: { etiqueta: 'Correcta', titulo: 'Registros correctos', descripcion: 'Horas y gal/hora calculados sin ajustes.' },
  ajustado: {
    etiqueta: 'Tramos ajustados',
    titulo: 'Con tramos ajustados',
    descripcion: 'La lectura marcó más de lo posible (24 h o 1.000 km por día) o bajó, y se usó el tope. Conviene revisar esas lecturas.'
  },
  'una-lectura': { etiqueta: 'Una sola lectura', titulo: 'Una sola lectura', descripcion: 'Solo un tanqueo trae horómetro o kilometraje: todavía no se puede calcular el consumo.' },
  'sin-lecturas': { etiqueta: 'Sin lecturas', titulo: 'Sin lecturas numéricas', descripcion: 'Ningún tanqueo trae un número de horómetro o kilometraje (dañado, vacío...).' },
  na: { etiqueta: 'Sin horómetro', titulo: 'Sin horómetro o tanque móvil', descripcion: 'Marcadas "No aplica" en Máquinas, o el tanque móvil. No entran en horas ni promedio.' }
};
const grupoEstado = (m) => (['tanque', 'sin-horometro'].includes(m.estado) ? 'na' : m.estado);
const etiquetaEstado = (m) => (m.estado === 'tanque' ? 'Tanque móvil' : (ESTADOS[grupoEstado(m)] || ESTADOS.ok).etiqueta);
const esNoAplica = (m) => grupoEstado(m) === 'na';

// Rótulos según cómo se mide la máquina: horómetro (horas) o kilometraje (km).
const UNIDADES = {
  horas: { corto: 'h', medida: 'Horas', trabajado: 'Horas trabajadas', lectura: 'Horómetro', consumo: 'Gal/hora', tope: '24 h por día' },
  km: { corto: 'km', medida: 'Km', trabajado: 'Km recorridos', lectura: 'Kilometraje', consumo: 'Gal/km', tope: '1.000 km por día' }
};
const unidadDe = (m) => UNIDADES[m.unidad === 'km' ? 'km' : 'horas'];

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
// Horas y km se suman por separado: nunca se mezclan unidades.
function sumarConsumo(lista) {
  const cantidad = lista.reduce((t, m) => t + (Number(m.horasTrabajadas) || 0), 0);
  const galones = lista.reduce((t, m) => t + (m.horasTrabajadas > 0 ? Number(m.galonesTramos) || 0 : 0), 0);
  return { cantidad, consumo: cantidad > 0 ? galones / cantidad : null };
}
function pintarTotales(lista) {
  const conLectura = lista.filter((m) => !esNoAplica(m));
  const porHoras = sumarConsumo(conLectura.filter((m) => m.unidad !== 'km'));
  const porKm = sumarConsumo(conLectura.filter((m) => m.unidad === 'km'));
  const galones = lista.filter((m) => m.estado !== 'tanque').reduce((t, m) => t + m.galones, 0);
  const tanqueos = lista.reduce((t, m) => t + m.cantidadTanqueos, 0);
  document.getElementById('kpi-maquinas').textContent = String(lista.length);
  document.getElementById('kpi-maquinas-nota').textContent = `${tanqueos} tanqueos en el periodo`;
  document.getElementById('kpi-horas').textContent = `${numero(porHoras.cantidad, 1)} h`;
  document.getElementById('kpi-km').textContent = `${numero(porKm.cantidad, 0)} km`;
  document.getElementById('kpi-galkm').textContent =
    porKm.consumo === null ? 'vehículos por kilometraje' : `${numero(porKm.consumo, 3)} gal/km en vehículos`;
  document.getElementById('kpi-galones').textContent = `${numero(galones, 1)} gal`;
  document.getElementById('kpi-galh').textContent = porHoras.consumo === null ? '—' : `${numero(porHoras.consumo)} gal/h`;
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
function motivoAjuste(t, m) {
  const u = unidadDe(m);
  const lectura = u.lectura.toLowerCase();
  if (t.retrocede) return `El ${lectura} bajó (${numero(t.horasHorometro, 1)} ${u.corto}): se cuentan 0 ${u.corto}`;
  if (t.ajustado)
    return `El ${lectura} marcó ${numero(t.horasHorometro, 1)} ${u.corto}, pero en ese tiempo solo caben ${numero(t.topeHoras, 0)} ${u.corto} (${u.tope})`;
  return '';
}

// Fila de la tabla de tanqueos. Si el tramo se ajustó, la fila va en rojo y
// la columna "Nota" explica por qué.
function filaTanqueo(t, indice, m) {
  const motivo = motivoAjuste(t, m);
  const horas = t.horasTramo === null ? (indice === 0 ? 'Primera lectura' : '—') : `${numero(t.horasTramo, 1)} ${unidadDe(m).corto}`;
  const nota = [
    t.origen === 'movil' ? '🛢️ Del tanque móvil' : '',
    motivo ? `⚠ ${motivo}` : '',
    t.observaciones ? `💬 ${t.observaciones}` : ''
  ].filter(Boolean);
  return `
    <tr class="${motivo ? 'tanqueo-ajustado' : ''}">
      <td>${escapeHtml(fechaCorta(t.fecha))}</td>
      <td>${escapeHtml(t.operario || '—')}</td>
      <td>${escapeHtml(t.horometro || '—')}</td>
      <td>${escapeHtml(numero(t.cantidad))}</td>
      <td>${escapeHtml(horas)}</td>
      <td>${escapeHtml(numero(t.galonesPorHoraTramo, m.unidad === 'km' ? 3 : 2))}</td>
      <td class="tanqueo-nota">${nota.map((n) => `<span>${escapeHtml(n)}</span>`).join('') || '—'}</td>
    </tr>`;
}

// Texto del aviso dentro de "Ver detalles" según el estado.
function avisoEstado(m) {
  if (m.estado === 'ajustado') {
    const n = (m.tramosAjustados || 0) + (m.tramosQueRetroceden || 0);
    return `⚠ ${n} tramo(s) ajustado(s): en la tabla, en rojo, está la lectura que se pasó del tope.`;
  }
  if (m.estado === 'tanque') return 'Tanque móvil: no tiene horómetro y sus galones no suman al total (se reparten a cada máquina en la vista Tanque móvil).';
  return grupoEstado(m) === 'ok' ? '' : ESTADOS[grupoEstado(m)].descripcion;
}

// Detalle de una máquina: datos generales, aviso del estado y la tabla de tanqueos.
function htmlDetalle(m) {
  const grupo = grupoEstado(m);
  const aviso = avisoEstado(m);
  const u = unidadDe(m);
  return `
    <div class="carta-horometro-detalle">
      <div class="grid-campos-registro">
        ${dato('Tanqueos', String(m.cantidadTanqueos))}
        ${dato('Promedio por tanqueo', `${numero(m.promedio)} gal`)}
        ${dato(`${u.lectura} inicial`, numero(m.horometroInicial, 1))}
        ${dato(`${u.lectura} final`, numero(m.horometroFinal, 1))}
        ${m.galonesMovil > 0 ? dato('Del tanque móvil', `${numero(m.galonesMovil)} gal`) : ''}
      </div>
      ${aviso ? `<p class="carta-horometro-aviso estado-${grupo}">${escapeHtml(aviso)}</p>` : ''}
      <div class="tabla-tanqueos-scroll">
        <table class="tabla-tanqueos">
          <thead><tr><th>Fecha</th><th>Operario</th><th>${u.lectura}</th><th>Galones</th><th>${u.trabajado}</th><th>${u.consumo}</th><th>Nota</th></tr></thead>
          <tbody>${m.tanqueos.map((t, i) => filaTanqueo(t, i, m)).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// Carta de una máquina. Con "expandida" ocupa todo el ancho y muestra el
// detalle; las demás cartas no se dibujan mientras tanto.
function crearTarjeta(m, galonesTotales, expandida = false) {
  const grupo = grupoEstado(m);
  const porcentaje = m.estado !== 'tanque' && galonesTotales > 0 ? (m.galones / galonesTotales) * 100 : null;
  const u = unidadDe(m);
  const horas = valido(m.horasTrabajadas) ? `${numero(m.horasTrabajadas, 1)} ${u.corto}` : '—';
  const galh = valido(m.galonesPorHora) ? numero(m.galonesPorHora, m.unidad === 'km' ? 3 : 2) : '—';
  const textoBoton = expandida
    ? '<span>← Volver a todas las máquinas</span><span aria-hidden="true">✕</span>'
    : `<span>👁 Ver detalles · ${m.cantidadTanqueos} tanqueo${m.cantidadTanqueos === 1 ? '' : 's'}</span><span aria-hidden="true">›</span>`;

  const tarjeta = document.createElement('article');
  tarjeta.className = `panel carta-horometro estado-${grupo}${expandida ? ' carta-expandida' : ''}`;
  tarjeta.dataset.maquina = m.maquina;
  tarjeta.innerHTML = `
    <div class="carta-horometro-cabecera">
      <span class="carta-horometro-icono" aria-hidden="true">${iconoMaquina(m)}</span>
      <div class="carta-horometro-nombre"><h3>${escapeHtml(m.maquina)}</h3><p>${escapeHtml(m.descripcion || 'Sin descripción')}</p></div>
      <span class="etiqueta-estado estado-${grupo}">${escapeHtml(etiquetaEstado(m))}</span>
    </div>
    <div class="carta-horometro-resumen">
      <div class="carta-horometro-metricas">
        <div><small>${u.medida}</small><strong>${escapeHtml(horas)}</strong></div>
        <div class="metrica-galh"><small>${u.consumo}</small><strong>${escapeHtml(galh)}</strong></div>
        <div><small>Galones</small><strong>${escapeHtml(numero(m.galones, 1))}</strong></div>
      </div>
      <div class="carta-horometro-barra">
        <div class="barra-consumo"><span></span></div>
        <small>${porcentaje === null ? 'No suma al total' : `${numero(porcentaje, 1)} % del total`}</small>
      </div>
    </div>
    ${expandida ? htmlDetalle(m) : ''}
    <button type="button" class="carta-horometro-ver" aria-expanded="${expandida}">${textoBoton}</button>`;

  // El ancho de la barra se pone por JS (los estilos en línea los bloquea la CSP).
  tarjeta.querySelector('.barra-consumo span').style.width = `${Math.min(100, porcentaje || 0)}%`;
  tarjeta.querySelector('.carta-horometro-ver').addEventListener('click', () => {
    maquinaEnDetalle = expandida ? null : m.maquina;
    pintar();
    // Al abrir se sube al detalle; al volver, a la carta de esa misma máquina.
    const destino = expandida
      ? contenedorTarjetas.querySelector(`[data-maquina="${CSS.escape(m.maquina)}"]`)
      : contenedorTarjetas;
    destino?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return tarjeta;
}

function pintar() {
  maquinasVisibles = filtrarYOrdenar();
  const galonesTotales = pintarTotales(maquinasVisibles);
  pintarEstados();
  // Si la máquina abierta ya no pasa los filtros, se vuelve a la lista completa.
  const enDetalle = maquinasVisibles.find((m) => m.maquina === maquinaEnDetalle);
  if (!enDetalle) maquinaEnDetalle = null;
  contenedorTarjetas.innerHTML = '';
  if (enDetalle) contenedorTarjetas.appendChild(crearTarjeta(enDetalle, galonesTotales, true));
  else maquinasVisibles.forEach((m) => contenedorTarjetas.appendChild(crearTarjeta(m, galonesTotales)));
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
            m.maquina, m.tipo, unidadDe(m).trabajado, fechaCorta(t.fecha), t.origen === 'movil' ? 'Tanque móvil' : 'Tanque principal',
            t.operario, t.horometro, num(t.cantidad),
            num(t.horasHorometro, 1), num(t.horasTramo, 1), motivoAjuste(t, m), num(t.galonesPorHoraTramo, 3), t.observaciones,
            m.cantidadTanqueos, num(m.galones), num(m.promedio), num(m.horometroInicial, 1), num(m.horometroFinal, 1),
            num(m.horasTrabajadas, 1), num(m.galonesPorHora, 3), etiquetaEstado(m)
          ].map(celda).join('')}</tr>`
      )
    )
    .join('');
  // En las máquinas de km, "horas" son km y "gal/hora" es gal/km (columna "Medida").
  const encabezados = ['Máquina', 'Tipo', 'Medida', 'Fecha', 'Origen', 'Operario', 'Lectura (h o km)', 'Galones', 'Diferencia según la lectura', 'Horas o km del tramo (con tope)', 'Ajuste', 'Gal por h o km del tramo', 'Observaciones',
    'Tanqueos (máquina)', 'Galones (máquina)', 'Promedio por tanqueo', 'Lectura inicial', 'Lectura final', 'Horas o km (máquina)', 'Gal por h o km (máquina)', 'Estado'];
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
