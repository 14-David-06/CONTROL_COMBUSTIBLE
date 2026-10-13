// ============================================================================
// tanque-movil.js — VISTA "TANQUE MÓVIL" (public/html/tanque-movil.html)
// ----------------------------------------------------------------------------
// El supervisor registra lo que el tanque móvil le echó a cada máquina en el
// campo, como en el registro del tanque principal pero sin lecturas iniciales
// ni cierre. El mismo formulario sirve para corregir una entrega ("Editar").
// La etiqueta de la lectura cambia sola: "Kilometraje (km)" en los vehículos
// marcados así en Máquinas y "Horómetro (h)" en el resto.
// ============================================================================

const campoFecha = document.getElementById('tm-fecha');
const formulario = document.getElementById('tm-formulario');
const campoMaquina = document.getElementById('tm-maquina');
const campoOperario = document.getElementById('tm-operario');
const listaOperarios = document.getElementById('tm-lista-operarios');
const campoLectura = document.getElementById('tm-horometro');
const etiquetaLectura = document.getElementById('tm-etiqueta-lectura');
const ayudaLectura = document.getElementById('tm-ayuda-lectura');
const campoCantidad = document.getElementById('tm-cantidad');
const campoSalida = document.getElementById('tm-salida');
const campoObservaciones = document.getElementById('tm-observaciones');
const botonGuardar = document.getElementById('tm-guardar');
const botonCancelar = document.getElementById('tm-cancelar');
const tituloFormulario = document.getElementById('tm-titulo-form');
const filas = document.getElementById('tm-filas');
const mensajeVacio = document.getElementById('tm-vacio');

let maquinas = []; // Catálogo de Máquinas (sin el tanque móvil)
let entregasDia = [];
let entregaEditando = null; // id de la entrega que se está corrigiendo

const TANQUE_MOVIL = /^TANQUE M[OÓ][VB]IL/;
const numero = (n, decimales = 1) =>
  Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
const galones = (n) => `${numero(n)} gal`;
function hoyLocalTexto() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}
const maquinaDe = (codigo) => maquinas.find((m) => m.maquina === codigo);

// --- Catálogos (máquinas y operarios) ------------------------------------------
async function cargarCatalogos() {
  const [respuestaMaquinas, respuestaOperarios] = await Promise.all([
    fetch('/api/tractores?selector=1', { cache: 'no-store' }),
    fetch('/api/operarios?selector=1', { cache: 'no-store' })
  ]);
  const lista = respuestaMaquinas.ok ? await respuestaMaquinas.json() : [];
  maquinas = lista.filter(
    (m) => !TANQUE_MOVIL.test(String(m.maquina || '').toUpperCase()) && !TANQUE_MOVIL.test(String(m.descripcion || '').toUpperCase())
  );
  campoMaquina.innerHTML = '<option value="">Seleccione una máquina</option>';
  maquinas.forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m.maquina;
    opcion.textContent = `${m.unidad_medida === 'km' ? '🚚' : '🚜'} ${m.maquina} · ${m.descripcion || ''}`;
    campoMaquina.appendChild(opcion);
  });
  const operarios = respuestaOperarios.ok ? await respuestaOperarios.json() : [];
  listaOperarios.innerHTML = '';
  operarios.forEach((o) => {
    const opcion = document.createElement('option');
    opcion.value = o.nombre;
    listaOperarios.appendChild(opcion);
  });
}

// Ajusta el campo de lectura a la máquina elegida (horas, km o no aplica).
function actualizarCampoLectura() {
  const maquina = maquinaDe(campoMaquina.value);
  if (maquina?.sin_horometro) {
    etiquetaLectura.textContent = 'Horómetro';
    campoLectura.value = 'N/A';
    campoLectura.readOnly = true;
    ayudaLectura.textContent = 'Esta máquina no lleva horómetro.';
    return;
  }
  if (campoLectura.value === 'N/A') campoLectura.value = '';
  campoLectura.readOnly = false;
  const esKm = maquina?.unidad_medida === 'km';
  etiquetaLectura.textContent = esKm ? 'Kilometraje (km)' : 'Horómetro (h)';
  campoLectura.placeholder = esKm ? 'Ej: 99829' : 'Ej: 1530.5';
  ayudaLectura.textContent = maquina
    ? esKm ? 'Vehículo por kilometraje: escribe el odómetro.' : 'Máquina por horómetro: escribe las horas.'
    : 'Elige la máquina y se indica si es horómetro o kilometraje.';
}

// --- Cuadre y tabla del día ----------------------------------------------------
async function cargarDia() {
  try {
    const respuesta = await fetch(`/api/tanque-movil?fecha=${encodeURIComponent(campoFecha.value)}`, { cache: 'no-store' });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.mensaje || 'No se pudo cargar el día.');
    pintarTotal(datos);
    entregasDia = datos.entregas || [];
    pintarTabla();
  } catch (error) {
    entregasDia = [];
    pintarTabla();
    mostrarAlertaError('No se pudo cargar', error.message);
  }
}

// Total del día junto al título de la tabla.
function pintarTotal(d) {
  const cantidad = (d.entregas || []).length;
  document.getElementById('tm-total').textContent = `${galones(d.repartido)} · ${cantidad} entrega${cantidad === 1 ? '' : 's'}`;
}

function pintarTabla() {
  filas.innerHTML = '';
  mensajeVacio.hidden = entregasDia.length > 0;
  entregasDia.forEach((e) => {
    const lectura = e.horometro ? `${e.horometro}${e.horometro !== 'N/A' && /^[0-9.,]+$/.test(e.horometro) ? (e.unidad === 'km' ? ' km' : ' h') : ''}` : '—';
    const fila = document.createElement('tr');
    fila.innerHTML = `
      <td><strong>${escapeHtml(e.maquina)}</strong></td>
      <td>${escapeHtml(e.operario || '—')}</td>
      <td>${escapeHtml(lectura)}</td>
      <td>${escapeHtml(galones(e.cantidad))}</td>
      <td>${escapeHtml(e.numeroSalida || '—')}</td>
      <td class="tm-acciones">
        <button type="button" class="boton-secundario tm-editar">Editar</button>
        <button type="button" class="boton-eliminar tm-borrar">Anular</button>
      </td>`;
    fila.querySelector('.tm-editar').addEventListener('click', () => empezarEdicion(e));
    fila.querySelector('.tm-borrar').addEventListener('click', () => anularEntrega(e));
    filas.appendChild(fila);
  });
}

// --- Guardar / editar / anular -------------------------------------------------
function limpiarFormulario() {
  formulario.reset();
  entregaEditando = null;
  tituloFormulario.textContent = 'Registrar entrega de combustible';
  botonGuardar.textContent = '+ Agregar';
  botonCancelar.hidden = true;
  actualizarCampoLectura();
}

function empezarEdicion(e) {
  entregaEditando = e.id;
  campoMaquina.value = e.maquina;
  actualizarCampoLectura();
  campoOperario.value = e.operario || '';
  campoLectura.value = e.horometro || '';
  campoCantidad.value = e.cantidad;
  campoSalida.value = e.numeroSalida || '';
  campoObservaciones.value = e.observaciones || '';
  tituloFormulario.textContent = `Corregir entrega de ${e.maquina}`;
  botonGuardar.textContent = 'Guardar cambios';
  botonCancelar.hidden = false;
  formulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const datos = {
    fecha: campoFecha.value,
    maquina: campoMaquina.value,
    operario: campoOperario.value.trim(),
    horometro: campoLectura.value.trim(),
    cantidad: Number(campoCantidad.value),
    numeroSalida: campoSalida.value.trim(),
    observaciones: campoObservaciones.value.trim()
  };
  if (!datos.maquina || !(datos.cantidad > 0)) {
    mostrarAlertaError('Datos incompletos', 'Elige la máquina y escribe los galones.');
    return;
  }
  botonGuardar.disabled = true;
  try {
    const respuesta = await fetch(entregaEditando ? `/api/tanque-movil/${entregaEditando}` : '/api/tanque-movil', {
      method: entregaEditando ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(cuerpo.mensaje || 'No se pudo guardar la entrega.');
    const editada = Boolean(entregaEditando);
    limpiarFormulario();
    await cargarDia();
    mostrarAlertaExito(editada ? 'Entrega corregida' : 'Entrega registrada', `${datos.maquina}: ${galones(datos.cantidad)}.`);
  } catch (error) {
    mostrarAlertaError('No se pudo guardar', error.message);
  } finally {
    botonGuardar.disabled = false;
  }
});

async function anularEntrega(e) {
  const motivo = await solicitarMotivoAnulacion(
    'Anular entrega',
    `${escapeHtml(e.maquina)} · ${galones(e.cantidad)}. Escribe el motivo (queda en la auditoría).`
  );
  if (!motivo) return;
  const respuesta = await fetch(`/api/tanque-movil/${e.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motivo })
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    mostrarAlertaError('No se pudo anular', cuerpo.mensaje || 'Intenta de nuevo.');
    return;
  }
  if (entregaEditando === e.id) limpiarFormulario();
  await cargarDia();
  mostrarAlertaExito('Entrega anulada', 'El total del día se actualizó.');
}

// --- Inicio ----------------------------------------------------------------------
campoMaquina.addEventListener('change', actualizarCampoLectura);
botonCancelar.addEventListener('click', limpiarFormulario);
campoFecha.addEventListener('change', () => {
  if (campoFecha.value > hoyLocalTexto()) campoFecha.value = hoyLocalTexto();
  limpiarFormulario();
  cargarDia();
});

campoFecha.value = hoyLocalTexto();
campoFecha.max = hoyLocalTexto();
// Sin permiso, protegerVista ya avisó y redirige: no se piden datos.
if (usuarioTienePermiso('tanque_movil'))
  cargarCatalogos()
    .catch(() => mostrarAlertaError('No se pudo cargar', 'No se pudieron traer las máquinas y operarios.'))
    .finally(() => {
      actualizarCampoLectura();
      cargarDia();
    });
