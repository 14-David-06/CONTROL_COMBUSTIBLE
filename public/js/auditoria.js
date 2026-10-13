// ============================================================================
// auditoria.js — PANTALLA DE AUDITORÍA (public/html/auditoria.html)
// ----------------------------------------------------------------------------
// Consulta la bitácora del sistema: quién hizo qué, cuándo y en qué módulo.
// Incluye filtros (fechas, usuario, acción, módulo, búsqueda libre), una
// TABLA paginada y un PANEL DE DETALLE a la derecha (en celular se abre desde
// abajo). Si el evento fue una edición, el detalle muestra qué campos
// cambiaron con su valor ANTES y DESPUÉS.
// La bitácora es de solo lectura: no se pueden modificar ni eliminar eventos.
// ============================================================================

// Estado de la pantalla: página actual, tamaño de página y total de páginas.
const estadoAuditoria = {
  page: 1,
  limit: 20, // Eventos por página (el backend admite hasta 100)
  totalPages: 1,
  total: 0,
  seleccionado: null // Id del evento abierto en el panel de detalle
};

// Elementos de la interfaz.
const filasAuditoria = document.getElementById('filas-auditoria'); // <tbody> de la tabla
const mensajeAuditoriaVacia = document.getElementById('mensaje-auditoria-vacia');
const rangoRegistros = document.getElementById('rango-registros');
const paginacion = document.getElementById('paginacion-auditoria');
const panelDetalle = document.getElementById('detalle-auditoria');
const fondoDetalle = document.getElementById('detalle-auditoria-fondo'); // Sombra detrás del panel en celular
const contenidoDetalle = document.getElementById('detalle-auditoria-contenido');
const DETALLE_VACIO = contenidoDetalle.innerHTML; // Texto inicial "Toca un evento..."

// Campos del formulario de filtros, agrupados para recorrerlos con facilidad.
const formFields = {
  desde: document.getElementById('filtro-fecha-desde'),
  hasta: document.getElementById('filtro-fecha-hasta'),
  usuario: document.getElementById('filtro-usuario'),
  accion: document.getElementById('filtro-accion'),
  modulo: document.getElementById('filtro-modulo'),
  busqueda: document.getElementById('filtro-busqueda')
};


// --- Textos legibles ---------------------------------------------------------
// Qué se hizo, en palabras (las claves son las que guarda el backend en "accion").
const TEXTO_ACCION = {
  LOGIN: 'Inició sesión',
  LOGOUT: 'Cerró sesión',
  CREAR: 'Creó',
  EDITAR: 'Editó',
  ELIMINAR: 'Eliminó',
  ANULAR: 'Anuló',
  CAMBIAR_ROL: 'Cambió el rol',
  CAMBIAR_CAPACIDAD: 'Cambió la capacidad',
  CAMBIAR_CONTRASENA: 'Cambió la contraseña',
  JUSTIFICAR: 'Justificó',
  CIERRE_DIA: 'Cerró el día',
  EDITAR_AUDITORIA: 'Editó la auditoría',
  ELIMINAR_AUDITORIA: 'Eliminó un evento de auditoría'
};
// Sobre qué (las claves son las que guarda el backend en "modulo").
const TEXTO_MODULO = {
  registros: 'un registro de combustible',
  tractores: 'una máquina',
  operarios: 'un operario',
  usuarios: 'un usuario',
  alertas: 'una alerta',
  reportes: 'un reporte',
  surtidor: 'el surtidor',
  jornadas: 'una jornada',
  auditoria: 'la auditoría'
};
// Color de la etiqueta de acción (clase CSS).
const CLASE_ACCION = {
  CREAR: 'crear',
  EDITAR: 'editar',
  CAMBIAR_ROL: 'editar',
  CAMBIAR_CAPACIDAD: 'editar',
  CAMBIAR_CONTRASENA: 'editar',
  JUSTIFICAR: 'editar',
  ELIMINAR: 'eliminar',
  ANULAR: 'eliminar',
  CIERRE_DIA: 'crear'
};
// Nombre bonito de cada campo. La clave va normalizada (minúsculas y sin "_"),
// así "numeroSai" y "numero_sai" son el mismo campo.
const NOMBRE_CAMPO = {
  maquina: 'Máquina',
  operario: 'Operario',
  cedula: 'Cédula',
  horometro: 'Horómetro',
  cantidad: 'Cantidad (gal)',
  numerosai: 'No. SAI',
  observaciones: 'Observaciones',
  nombre: 'Nombre',
  descripcion: 'Descripción',
  centrocosto: 'Centro de costo',
  capacidadgalones: 'Capacidad (gal)',
  sinhorometro: 'Sin horómetro',
  item: 'Ítem',
  usuario: 'Usuario',
  rol: 'Rol',
  permisos: 'Permisos',
  estado: 'Estado',
  fecha: 'Fecha',
  fecharegistro: 'Fecha del registro',
  correccionfecharetroactiva: 'Registro con fecha atrasada',
  m1inicial: 'M1 inicial',
  m1final: 'M1 final',
  m2inicial: 'M2 inicial',
  m2final: 'M2 final',
  totalgalones: 'Total galones',
  motivo: 'Motivo',
  justificacion: 'Justificación',
  resultado: 'Resultado'
};
// Campos internos que no aportan al lector (o son enormes, como la firma).
const CAMPOS_OCULTOS = new Set(['id', 'firma', 'registradoen', 'registradopor', 'creadoen', 'contrasena']);

const normalizarClave = (clave) => String(clave).toLowerCase().replace(/_/g, '');
const nombreCampo = (clave) => NOMBRE_CAMPO[normalizarClave(clave)] || clave;

// Arma la cadena de consulta (?page=1&limit=20&usuario=...) a partir de los
// filtros que estén llenos. Se usa tanto para cargar la lista como para exportar.
function construirQuery() {
  const params = new URLSearchParams();
  params.set('page', String(estadoAuditoria.page));
  params.set('limit', String(estadoAuditoria.limit));

  const filtroDesde = formFields.desde.value;
  const filtroHasta = formFields.hasta.value;
  const filtroUsuario = formFields.usuario.value.trim();
  const filtroAccion = formFields.accion.value;
  const filtroModulo = formFields.modulo.value;
  const filtroBusqueda = formFields.busqueda.value.trim();

  // Solo se envían los filtros con valor, para no ensuciar la URL.
  if (filtroDesde) params.set('fechaDesde', filtroDesde);
  if (filtroHasta) params.set('fechaHasta', filtroHasta);
  if (filtroUsuario) params.set('usuario', filtroUsuario);
  if (filtroAccion) params.set('accion', filtroAccion);
  if (filtroModulo) params.set('modulo', filtroModulo);
  if (filtroBusqueda) params.set('q', filtroBusqueda);

  return params.toString();
}

// Convierte cualquier valor en texto legible.
function formatearValor(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '—';
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

// Fecha (dd/mm/aaaa) y hora (hh:mm a. m.) por separado, en formato colombiano.
function partesFecha(fecha) {
  const valor = new Date(fecha);
  if (!fecha || Number.isNaN(valor.getTime())) return { dia: '—', hora: '—' };
  return {
    dia: valor.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    hora: valor.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
  };
}

// Normaliza el campo "detalle" (JSON) a un objeto manejable.
function convertirDetalle(detalle) {
  if (!detalle || typeof detalle !== 'object') return {};
  if (Array.isArray(detalle)) return { valores: detalle };
  return detalle;
}

// ¿Son el mismo valor? "3.9" y 3.9 cuentan como iguales; vacío y null también.
function mismoValor(a, b) {
  const vacio = (v) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);
  if (vacio(a) && vacio(b)) return true;
  const numA = Number(a);
  const numB = Number(b);
  if (a !== '' && b !== '' && !vacio(a) && !vacio(b) && Number.isFinite(numA) && Number.isFinite(numB))
    return numA === numB;
  return formatearValor(a) === formatearValor(b);
}

// Lista de cambios de una edición: solo los campos cuyo valor sí cambió.
// "antes" suele venir con nombres de la base (numero_sai) y "después" con los
// del formulario (numeroSai): se emparejan por la clave normalizada.
function calcularCambios(antes = {}, despues = {}) {
  const valoresAntes = new Map(
    Object.entries(antes || {}).map(([clave, valor]) => [normalizarClave(clave), valor])
  );
  return Object.entries(despues || {})
    .filter(([clave]) => !CAMPOS_OCULTOS.has(normalizarClave(clave)))
    .map(([clave, valor]) => ({ campo: nombreCampo(clave), antes: valoresAntes.get(normalizarClave(clave)), despues: valor }))
    .filter((c) => !mismoValor(c.antes, c.despues));
}

// Datos sueltos (un elemento creado, anulado, eliminado...) como lista campo/valor.
function camposVisibles(objeto = {}) {
  // Se omiten los campos internos y los objetos anidados (sí se muestran las listas).
  const esObjeto = (valor) => valor !== null && typeof valor === 'object' && !Array.isArray(valor);
  return Object.entries(objeto || {})
    .filter(([clave, valor]) => !CAMPOS_OCULTOS.has(normalizarClave(clave)) && !esObjeto(valor))
    .map(([clave, valor]) => ({ campo: nombreCampo(clave), valor }));
}

// Nombre corto del elemento afectado (máquina, operario, usuario...), para el título.
function elementoAfectado(detalle) {
  const fuentes = [detalle.despues, detalle.antes, detalle].filter((x) => x && typeof x === 'object');
  for (const fuente of fuentes) {
    const nombre = fuente.maquina || fuente.nombre || fuente.usuario || fuente.operario || fuente.fecha;
    if (nombre && typeof nombre !== 'object') return String(nombre);
  }
  return '';
}

// Interpreta un evento: título, tipo de contenido y los datos a mostrar.
function interpretarEvento(registro) {
  const detalle = convertirDetalle(registro.detalle);
  const accion = String(registro.accion || '').toUpperCase();
  const textoAccion = TEXTO_ACCION[accion] || accion || 'Evento';
  const sobre = ['LOGIN', 'LOGOUT', 'CAMBIAR_CONTRASENA', 'CIERRE_DIA'].includes(accion)
    ? ''
    : TEXTO_MODULO[registro.modulo] || registro.modulo || '';
  const elemento = elementoAfectado(detalle);
  const titulo = [textoAccion, sobre].filter(Boolean).join(' ');

  // Edición con "antes" y "después": se muestran solo los campos que cambiaron.
  if (detalle.antes && detalle.despues) {
    return { titulo, elemento, tipo: 'cambios', cambios: calcularCambios(detalle.antes, detalle.despues), detalle };
  }
  // Anulación o eliminación: lo que había antes, más el motivo si lo hubo.
  if (detalle.antes) {
    const campos = camposVisibles(detalle.antes);
    if (detalle.motivo) campos.unshift({ campo: 'Motivo', valor: detalle.motivo });
    return { titulo, elemento, tipo: 'datos', etiqueta: 'Datos que tenía', campos, detalle };
  }
  // Creación, cierre, login...: los datos guardados en el evento.
  return { titulo, elemento, tipo: 'datos', etiqueta: 'Datos', campos: camposVisibles(detalle), detalle };
}

// HTML de la lista de cambios "campo: antes → después".
function htmlCambios(cambios) {
  if (!cambios.length) return '<p class="auditoria-sin-cambios">Se guardó sin cambiar ningún dato.</p>';
  return `<div class="auditoria-cambios">${cambios
    .map(
      (c) => `
      <div class="auditoria-cambio">
        <span class="auditoria-campo">${escapeHtml(c.campo)}</span>
        <div class="auditoria-valores">
          <span class="auditoria-antes" title="Antes">${escapeHtml(formatearValor(c.antes))}</span>
          <span class="auditoria-flecha" aria-hidden="true">→</span>
          <span class="auditoria-despues" title="Después">${escapeHtml(formatearValor(c.despues))}</span>
        </div>
      </div>`
    )
    .join('')}</div>`;
}

// HTML de una lista "campo: valor".
function htmlDatos(campos) {
  if (!campos.length) return '';
  return `<div class="grid-campos-registro">${campos
    .map(
      (c) =>
        `<div class="campo-registro-tarjeta"><span>${escapeHtml(c.campo)}</span><strong class="auditoria-dato">${escapeHtml(formatearValor(c.valor))}</strong></div>`
    )
    .join('')}</div>`;
}


// --- Tabla -------------------------------------------------------------------
// Ícono y nombre corto de cada módulo para la columna "Módulo".
const MODULO_TABLA = {
  registros: ['⛽', 'Registros'],
  tractores: ['🚜', 'Máquinas'],
  operarios: ['👷', 'Operarios'],
  usuarios: ['👤', 'Usuarios'],
  alertas: ['🔔', 'Alertas'],
  reportes: ['📊', 'Reportes'],
  surtidor: ['🛢️', 'Surtidor'],
  jornadas: ['📅', 'Jornadas'],
  auditoria: ['🛡️', 'Auditoría']
};
// Rol legible: "super_administrador" -> "Super administrador".
const nombreRol = (rol) => {
  const texto = String(rol || '').replace(/_/g, ' ').trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : '—';
};
const moduloTabla = (modulo) => MODULO_TABLA[modulo] || ['🧩', modulo || '—'];
// Clase de color de la etiqueta; inicio y cierre de sesión van en morado.
const claseAccion = (accion) => CLASE_ACCION[accion] || (['LOGIN', 'LOGOUT'].includes(accion) ? 'sesion' : '');

// Texto corto de la columna "Detalles": qué se hizo y, si fue una edición,
// el primer cambio (los demás se ven en el panel de detalle).
function resumenDetalles(evento) {
  let segunda = '';
  if (evento.tipo === 'cambios' && evento.cambios.length) {
    const c = evento.cambios[0];
    const mas = evento.cambios.length > 1 ? ` (+${evento.cambios.length - 1} más)` : '';
    segunda = `${c.campo}: ${formatearValor(c.antes)} → ${formatearValor(c.despues)}${mas}`;
  } else if (evento.detalle.motivo) {
    segunda = `Motivo: ${evento.detalle.motivo}`;
  }
  return `<strong>${escapeHtml(evento.titulo)}${evento.elemento ? ` · ${escapeHtml(evento.elemento)}` : ''}</strong>${
    segunda ? `<small>${escapeHtml(segunda)}</small>` : ''
  }`;
}

// Construye la fila de un evento. Toda la fila abre el detalle.
function crearFilaAuditoria(registro) {
  const evento = interpretarEvento(registro);
  const { dia, hora } = partesFecha(registro.fecha || registro.creado_en);
  const accion = String(registro.accion || '').toUpperCase();
  const usuario = registro.usuario || 'Sistema';
  const [icono, modulo] = moduloTabla(registro.modulo);
  const fila = document.createElement('tr');
  fila.tabIndex = 0;
  fila.dataset.id = registro.id;
  if (String(registro.id) === String(estadoAuditoria.seleccionado)) fila.classList.add('seleccionada');

  fila.innerHTML = `
    <td class="auditoria-fecha"><strong>${escapeHtml(dia)}</strong><small>${escapeHtml(hora)}</small></td>
    <td><div class="auditoria-usuario"><span class="auditoria-avatar" aria-hidden="true">${escapeHtml(usuario.charAt(0).toUpperCase())}</span><div><strong>${escapeHtml(usuario)}</strong><small>${escapeHtml(nombreRol(registro.rol))}</small></div></div></td>
    <td><span class="auditoria-etiqueta ${claseAccion(accion)}">${escapeHtml(accion.replace(/_/g, ' ') || '—')}</span></td>
    <td class="col-modulo"><span class="auditoria-modulo"><span aria-hidden="true">${icono}</span>${escapeHtml(modulo)}</span></td>
    <td class="auditoria-detalles">${resumenDetalles(evento)}</td>
    <td><button type="button" class="boton-secundario auditoria-ver">Ver</button></td>`;

  // El id se pasa tal cual: en Airtable es un texto ("rec..."), no un número.
  const abrir = () => mostrarDetalle(registro, fila);
  fila.addEventListener('click', abrir);
  fila.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') abrir();
  });
  return fila;
}

// Botones de página: siempre la primera, la última y las vecinas de la actual,
// con "…" en los huecos. Ej.: ‹ 1 2 3 … 13 ›
function renderPaginacion(page, totalPages) {
  // Se acota la página entre 1 y el total, por si llega un valor fuera de rango.
  estadoAuditoria.totalPages = Math.max(1, Number(totalPages) || 1);
  estadoAuditoria.page = Math.min(Math.max(1, Number(page) || 1), estadoAuditoria.totalPages);
  const { page: actual, totalPages: total } = estadoAuditoria;

  const numeros = [...new Set([1, actual - 1, actual, actual + 1, total])]
    .filter((n) => n >= 1 && n <= total)
    .sort((a, b) => a - b);
  const botones = [`<button type="button" data-pagina="${actual - 1}" aria-label="Página anterior" ${actual <= 1 ? 'disabled' : ''}>‹</button>`];
  numeros.forEach((n, i) => {
    if (i && n - numeros[i - 1] > 1) botones.push('<span class="auditoria-puntos">…</span>');
    botones.push(`<button type="button" data-pagina="${n}" class="${n === actual ? 'actual' : ''}" ${n === actual ? 'aria-current="page"' : ''}>${n}</button>`);
  });
  botones.push(`<button type="button" data-pagina="${actual + 1}" aria-label="Página siguiente" ${actual >= total ? 'disabled' : ''}>›</button>`);
  paginacion.innerHTML = botones.join('');
}

// Dibuja las filas de los eventos recibidos.
function renderTabla(registros) {
  const lista = Array.isArray(registros) ? registros : [];
  filasAuditoria.innerHTML = '';
  mensajeAuditoriaVacia.hidden = lista.length > 0;
  const desde = lista.length ? (estadoAuditoria.page - 1) * estadoAuditoria.limit + 1 : 0;
  rangoRegistros.textContent = lista.length ? `${desde} – ${desde + lista.length - 1} de ${estadoAuditoria.total}` : '0';
  lista.forEach((registro) => filasAuditoria.appendChild(crearFilaAuditoria(registro)));
}

// Descarga la página actual de eventos aplicando los filtros vigentes.
async function cargarAuditoria() {
  const query = construirQuery();
  try {
    const respuesta = await fetch(`/api/auditoria?${query}`, { cache: 'no-store' });
    if (!respuesta.ok) {
      const errorData = await respuesta.json().catch(() => ({}));
      throw new Error(errorData.mensaje || 'No se pudo cargar la auditoría.');
    }

    const datos = await respuesta.json();
    estadoAuditoria.total = Number(datos.total || 0);
    renderPaginacion(datos.page || 1, datos.totalPages || 1);
    renderTabla(datos.registros || []);
  } catch (error) {
    console.error(error);
    estadoAuditoria.total = 0;
    renderPaginacion(1, 1);
    renderTabla([]);
    mostrarAlertaError('No se pudo cargar la auditoría', error.message);
  }
}

// --- Panel de detalle --------------------------------------------------------
// Una línea "ícono · rótulo · valor" del panel.
const lineaDetalle = (icono, rotulo, valorHtml) =>
  `<div class="auditoria-detalle-linea"><span aria-hidden="true">${icono}</span><div><small>${escapeHtml(rotulo)}</small><strong>${valorHtml}</strong></div></div>`;

// Llena el panel con el evento elegido. Los datos ya vienen en la lista, así
// que no hace falta volver a pedirlos al servidor.
function mostrarDetalle(registro, fila) {
  estadoAuditoria.seleccionado = registro.id;
  filasAuditoria.querySelectorAll('tr.seleccionada').forEach((tr) => tr.classList.remove('seleccionada'));
  fila?.classList.add('seleccionada');

  const evento = interpretarEvento(registro);
  const detalle = evento.detalle;
  const accion = String(registro.accion || '').toUpperCase();
  const { dia, hora } = partesFecha(registro.fecha || registro.creado_en);
  const [icono, modulo] = moduloTabla(registro.modulo);
  const afectado = [evento.elemento, registro.registro_id ? `Id: ${registro.registro_id}` : ''].filter(Boolean).join(' · ');

  let cuerpo = '';
  if (evento.tipo === 'cambios') {
    cuerpo = `<h3 class="auditoria-detalle-subtitulo">✏️ Cambios realizados</h3>${htmlCambios(evento.cambios)}`;
  } else if (evento.campos.length) {
    cuerpo = `<h3 class="auditoria-detalle-subtitulo">📋 ${escapeHtml(evento.etiqueta)}</h3>${htmlDatos(evento.campos)}`;
  }

  contenidoDetalle.innerHTML = `
    <div class="auditoria-detalle-accion">
      <span aria-hidden="true">📝</span>
      <div><strong>${escapeHtml(evento.titulo)}</strong><small>${escapeHtml(dia)} · ${escapeHtml(hora)}</small></div>
    </div>
    ${lineaDetalle('👤', 'Usuario', escapeHtml(registro.usuario || 'Sistema'))}
    ${lineaDetalle('🎖️', 'Rol', escapeHtml(nombreRol(registro.rol)))}
    ${lineaDetalle('⚡', 'Acción', `<span class="auditoria-etiqueta ${claseAccion(accion)}">${escapeHtml(accion.replace(/_/g, ' ') || '—')}</span>`)}
    ${lineaDetalle(icono, 'Módulo', escapeHtml(modulo))}
    ${afectado ? lineaDetalle('📄', 'Registro afectado', escapeHtml(afectado)) : ''}
    ${detalle.motivo ? lineaDetalle('💬', 'Motivo', escapeHtml(detalle.motivo)) : ''}
    ${cuerpo}`;

  panelDetalle.classList.add('abierto'); // En celular lo sube desde abajo
  fondoDetalle.hidden = false;
}

// Cierra el panel y vuelve al texto inicial.
function cerrarDetalle() {
  estadoAuditoria.seleccionado = null;
  filasAuditoria.querySelectorAll('tr.seleccionada').forEach((tr) => tr.classList.remove('seleccionada'));
  contenidoDetalle.innerHTML = DETALLE_VACIO;
  panelDetalle.classList.remove('abierto');
  fondoDetalle.hidden = true;
}

// --- Filtros y eventos -------------------------------------------------------
// Vacía todos los filtros y vuelve a la primera página.
function limpiarFiltros() {
  Object.values(formFields).forEach((campo) => {
    if (campo && 'value' in campo) campo.value = '';
  });
  estadoAuditoria.page = 1;
  cargarAuditoria();
}

// Recarga desde la página 1 (se usa cada vez que cambia un filtro).
function aplicarFiltros() {
  estadoAuditoria.page = 1;
  cargarAuditoria();
}

// Conecta todos los botones y campos de la pantalla.
function registrarEventos() {
  // Fechas, acción y módulo: se aplican al cambiarlos.
  [formFields.desde, formFields.hasta, formFields.accion, formFields.modulo].forEach((campo) =>
    campo?.addEventListener('change', aplicarFiltros)
  );
  // Buscador y usuario: esperan 350 ms después de la última tecla, para no
  // consultar al servidor con cada letra.
  let espera = null;
  [formFields.busqueda, formFields.usuario].forEach((campo) =>
    campo?.addEventListener('input', () => {
      clearTimeout(espera);
      espera = setTimeout(aplicarFiltros, 350);
    })
  );

  document.getElementById('boton-limpiar-filtros')?.addEventListener('click', limpiarFiltros);
  // Exportar CSV: se navega al endpoint con los mismos filtros y el navegador
  // descarga el archivo. (Ver la nota sobre el orden de rutas en auditoria.routes.js.)
  document.getElementById('boton-exportar-auditoria')?.addEventListener('click', () => {
    const query = construirQuery();
    window.location.href = `/api/auditoria/export?${query}`;
  });

  // Paginación: cada botón trae en data-pagina la página a la que lleva.
  paginacion.addEventListener('click', (e) => {
    const boton = e.target.closest('button[data-pagina]');
    if (!boton || boton.disabled) return;
    estadoAuditoria.page = Number(boton.dataset.pagina);
    cargarAuditoria();
  });

  // Cierre del panel de detalle: con la X, con Escape o tocando el fondo (celular).
  document.getElementById('cerrar-detalle-auditoria')?.addEventListener('click', cerrarDetalle);
  fondoDetalle.addEventListener('click', cerrarDetalle);
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && estadoAuditoria.seleccionado !== null) cerrarDetalle();
  });
}

registrarEventos();
cargarAuditoria(); // Primera carga
