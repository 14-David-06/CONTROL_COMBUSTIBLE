// ============================================================================
// auditoria.js — PANTALLA DE AUDITORÍA (public/html/auditoria.html)
// ----------------------------------------------------------------------------
// Consulta la bitácora del sistema: quién hizo qué, cuándo y en qué módulo.
// Incluye filtros (fechas, usuario, acción, módulo, búsqueda libre), tarjetas
// de resumen, paginación y ventana de detalle.
// Cada evento se muestra como una TARJETA (igual que los registros en Tablas)
// con fecha, hora, quién lo hizo y, si fue una edición, qué campos cambiaron
// con su valor ANTES y DESPUÉS.
// La bitácora es de solo lectura: no se pueden modificar ni eliminar eventos.
// ============================================================================

// Estado de la pantalla: página actual, tamaño de página y total de páginas.
const estadoAuditoria = {
  page: 1,
  limit: 20, // Eventos por página (el backend admite hasta 100)
  totalPages: 1,
  total: 0
};

// Elementos de la interfaz.
const modalDetalle = document.getElementById('detalle-auditoria-modal'); // Ventana emergente
const contenidoDetalle = document.getElementById('detalle-auditoria-contenido');
const tarjetasAuditoria = document.getElementById('tarjetas-auditoria'); // Contenedor de tarjetas
const mensajeAuditoriaVacia = document.getElementById('mensaje-auditoria-vacia');
const cantidadAuditoria = document.getElementById('cantidad-auditoria');
const rangoRegistros = document.getElementById('rango-registros');
const paginaActual = document.getElementById('pagina-actual');
// Tarjetas de resumen superiores.
const totalEventos = document.getElementById('total-eventos');
const usuariosUnicos = document.getElementById('usuarios-unicos');
const accionesUnicas = document.getElementById('acciones-unicas');
const modulosUnicos = document.getElementById('modulos-unicos');

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

// Construye la tarjeta de un evento.
function crearTarjetaAuditoria(registro) {
  const evento = interpretarEvento(registro);
  const { dia, hora } = partesFecha(registro.fecha || registro.creado_en);
  const accion = String(registro.accion || '').toUpperCase();
  const tarjeta = document.createElement('article');
  tarjeta.className = 'registro-tarjeta tarjeta-auditoria';

  let cuerpo = '';
  if (evento.tipo === 'cambios') {
    cuerpo = `<span class="eyebrow-dashboard">QUÉ CAMBIÓ · ANTES → DESPUÉS</span>${htmlCambios(evento.cambios)}`;
  } else if (evento.campos.length) {
    cuerpo = `<span class="eyebrow-dashboard">${escapeHtml(evento.etiqueta.toUpperCase())}</span>${htmlDatos(evento.campos)}`;
  }

  tarjeta.innerHTML = `
    <div class="registro-tarjeta-cabecera">
      <div>
        <span class="badge-registro-fecha">📅 ${escapeHtml(dia)} · 🕒 ${escapeHtml(hora)}</span>
        <h3>${escapeHtml(evento.titulo)}${evento.elemento ? ` <small class="auditoria-elemento">${escapeHtml(evento.elemento)}</small>` : ''}</h3>
        <p>👤 ${escapeHtml(registro.usuario || 'Sistema')} · ${escapeHtml(registro.rol || '—')}</p>
      </div>
      <span class="auditoria-etiqueta ${CLASE_ACCION[accion] || ''}">${escapeHtml(accion || '—')}</span>
    </div>
    ${cuerpo}
    <div class="acciones-tarjeta-registro">
      <button type="button" class="boton-secundario">🔎 Ver detalle</button>
    </div>`;

  // El id se pasa tal cual: en Airtable es un texto ("rec..."), no un número.
  tarjeta.querySelector('button').addEventListener('click', () => abrirDetalleAuditoria(registro.id));
  return tarjeta;
}

// Llena las cuatro tarjetas de resumen con los totales que calcula el servidor.
function renderResumen(resumen = {}) {
  totalEventos.textContent = Number(resumen.total_eventos || 0);
  usuariosUnicos.textContent = Number(resumen.usuarios_unicos || 0);
  accionesUnicas.textContent = Number(resumen.acciones_unicas || 0);
  modulosUnicos.textContent = Number(resumen.modulos_unicos || 0);
}

// Actualiza el indicador de página y habilita/deshabilita los botones.
function renderPaginacion(page, totalPages) {
  // Se acota la página entre 1 y el total, por si llega un valor fuera de rango.
  estadoAuditoria.page = Math.min(Math.max(1, Number(page) || 1), Math.max(1, Number(totalPages) || 1));
  estadoAuditoria.totalPages = Math.max(1, Number(totalPages) || 1);
  paginaActual.textContent = `Página ${estadoAuditoria.page} de ${estadoAuditoria.totalPages}`;
  document.getElementById('pagina-anterior').disabled = estadoAuditoria.page <= 1;
  document.getElementById('pagina-siguiente').disabled = estadoAuditoria.page >= estadoAuditoria.totalPages;
}

// Dibuja las tarjetas de los eventos recibidos.
function renderTarjetas(registros) {
  const lista = Array.isArray(registros) ? registros : [];
  tarjetasAuditoria.innerHTML = '';
  mensajeAuditoriaVacia.hidden = lista.length > 0;
  cantidadAuditoria.textContent = String(estadoAuditoria.total);
  const desde = lista.length ? (estadoAuditoria.page - 1) * estadoAuditoria.limit + 1 : 0;
  rangoRegistros.textContent = lista.length ? `${desde}–${desde + lista.length - 1} de ${estadoAuditoria.total}` : '0';
  lista.forEach((registro) => tarjetasAuditoria.appendChild(crearTarjetaAuditoria(registro)));
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
    renderResumen(datos.resumen || {});
    renderPaginacion(datos.page || 1, datos.totalPages || 1);
    renderTarjetas(datos.registros || []);
  } catch (error) {
    console.error(error);
    estadoAuditoria.total = 0;
    renderTarjetas([]);
    mostrarAlertaError('No se pudo cargar la auditoría', error.message);
  }
}

// Ventana de detalle de un evento: quién, cuándo, qué, y la tabla completa
// campo por campo (antes / después) o los datos del evento.
async function abrirDetalleAuditoria(id) {
  try {
    const respuesta = await fetch(`/api/auditoria/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!respuesta.ok) throw new Error('No se pudo obtener el detalle.');
    const item = await respuesta.json();
    const evento = interpretarEvento(item);
    const detalle = evento.detalle;
    const { dia, hora } = partesFecha(item.creado_en || item.fecha);

    // Edición: todos los campos enviados, marcando los que cambiaron.
    let tabla = '';
    if (detalle.antes && detalle.despues) {
      const valoresAntes = new Map(Object.entries(detalle.antes).map(([c, v]) => [normalizarClave(c), v]));
      const filas = Object.entries(detalle.despues)
        .filter(([clave]) => !CAMPOS_OCULTOS.has(normalizarClave(clave)))
        .map(([clave, valor]) => {
          const anterior = valoresAntes.get(normalizarClave(clave));
          const cambio = !mismoValor(anterior, valor);
          return `<tr class="${cambio ? 'fila-cambiada' : ''}"><td>${escapeHtml(nombreCampo(clave))}</td><td>${escapeHtml(formatearValor(anterior))}</td><td>${escapeHtml(formatearValor(valor))}</td><td>${cambio ? '✏ Cambió' : 'Igual'}</td></tr>`;
        })
        .join('');
      tabla = `<table class="tabla-detalle-auditoria"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th><th></th></tr></thead><tbody>${filas || '<tr><td colspan="4">Sin campos</td></tr>'}</tbody></table>`;
    } else if (evento.campos.length) {
      tabla = `<table class="tabla-detalle-auditoria"><thead><tr><th>Campo</th><th>Valor</th></tr></thead><tbody>${evento.campos
        .map((c) => `<tr><td>${escapeHtml(c.campo)}</td><td>${escapeHtml(formatearValor(c.valor))}</td></tr>`)
        .join('')}</tbody></table>`;
    }

    contenidoDetalle.innerHTML = `
      <div class="confirmacion-linea"><span>📝</span><div><small>Acción</small><strong>${escapeHtml(evento.titulo)}</strong><em>${escapeHtml(evento.elemento || item.modulo || '—')}</em></div></div>
      <div class="confirmacion-linea"><span>👤</span><div><small>Quién</small><strong>${escapeHtml(item.usuario || 'Sistema')}</strong><em>${escapeHtml(item.rol || '—')}</em></div></div>
      <div class="confirmacion-linea"><span>🕒</span><div><small>Cuándo</small><strong>${escapeHtml(dia)}</strong><em>${escapeHtml(hora)}</em></div></div>
      <div class="confirmacion-linea"><span>🧩</span><div><small>Módulo</small><strong>${escapeHtml(item.modulo || '—')}</strong><em>Id: ${escapeHtml(item.registro_id || '—')}</em></div></div>
      ${detalle.motivo ? `<div class="confirmacion-linea" style="grid-column:1 / -1;"><span>💬</span><div><small>Motivo</small><strong>${escapeHtml(detalle.motivo)}</strong></div></div>` : ''}
      <div style="grid-column:1 / -1; width:100%; overflow-x:auto;">${tabla || '<p class="auditoria-sin-cambios">Este evento no guarda datos adicionales.</p>'}</div>
    `;
    modalDetalle.hidden = false; // Muestra la ventana
  } catch (error) {
    mostrarAlertaError('Detalle no disponible', error.message);
  }
}

// Vacía todos los filtros y vuelve a la primera página.
function limpiarFiltros() {
  Object.values(formFields).forEach((campo) => {
    if (campo && 'value' in campo) campo.value = '';
  });
  estadoAuditoria.page = 1;
  cargarAuditoria();
}

// Conecta todos los botones y campos de la pantalla.
function registrarEventos() {
  // Aplicar filtros: siempre se vuelve a la página 1.
  document.getElementById('boton-aplicar-filtros')?.addEventListener('click', () => {
    estadoAuditoria.page = 1;
    cargarAuditoria();
  });

  document.getElementById('boton-limpiar-filtros')?.addEventListener('click', limpiarFiltros);
  // Exportar CSV: se navega al endpoint con los mismos filtros y el navegador
  // descarga el archivo. (Ver la nota sobre el orden de rutas en auditoria.routes.js.)
  document.getElementById('boton-exportar-auditoria')?.addEventListener('click', () => {
    const query = construirQuery();
    window.location.href = `/api/auditoria/export?${query}`;
  });

  // Paginación.
  document.getElementById('pagina-anterior')?.addEventListener('click', () => {
    if (estadoAuditoria.page > 1) {
      estadoAuditoria.page -= 1;
      cargarAuditoria();
    }
  });

  document.getElementById('pagina-siguiente')?.addEventListener('click', () => {
    if (estadoAuditoria.page < estadoAuditoria.totalPages) {
      estadoAuditoria.page += 1;
      cargarAuditoria();
    }
  });

  // Cierre de la ventana de detalle: con el botón, con Escape o haciendo clic fuera del cuadro.
  document.getElementById('cerrar-detalle-auditoria')?.addEventListener('click', () => {
    modalDetalle.hidden = true;
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && modalDetalle && !modalDetalle.hidden) modalDetalle.hidden = true;
  });

  modalDetalle?.addEventListener('click', (evento) => {
    if (evento.target === modalDetalle) modalDetalle.hidden = true; // Solo si se pulsó el fondo
  });

  // La búsqueda libre recarga sola al escribir; los demás filtros esperan al
  // botón "Aplicar filtros".
  formFields.busqueda?.addEventListener('input', () => {
    estadoAuditoria.page = 1;
    cargarAuditoria();
  });
}

registrarEventos();
cargarAuditoria(); // Primera carga
