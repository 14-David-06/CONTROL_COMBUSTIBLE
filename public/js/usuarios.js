// ============================================================================
// usuarios.js — PANTALLA DE USUARIOS Y PERMISOS (public/html/usuarios.html)
// ----------------------------------------------------------------------------
// Administra las cuentas del sistema: crear, cambiar rol/contraseña, asignar
// permisos por vista y eliminar usuarios.
// Los permisos son DE CADA USUARIO: el rol solo enciende los que trae de
// entrada (ROLES) y a la persona se le pueden sumar permisos "extra".
// SI CREAS UNA VISTA NUEVA: agrégala a PERMISOS (y al rol que la trae) aquí Y
// al arreglo VISTAS_DISPONIBLES del backend (src/shared/application/permisos.js).
// ============================================================================

// Todos los permisos que se pueden asignar, agrupados por área.
const PERMISOS = [
  { vista: 'registro', etiqueta: 'Crear registros de combustible', area: 'Operación' },
  { vista: 'tanque_movil', etiqueta: 'Registrar entregas del tanque móvil', area: 'Operación' },
  { vista: 'tablas', etiqueta: 'Ver registros', area: 'Consulta' },
  { vista: 'reportes', etiqueta: 'Ver reportes', area: 'Consulta' },
  { vista: 'alertas', etiqueta: 'Justificar alertas', area: 'Consulta' },
  { vista: 'auditoria', etiqueta: 'Consultar auditoría y exportar', area: 'Consulta' },
  { vista: 'tractores', etiqueta: 'Administrar máquinas', area: 'Administración' },
  { vista: 'operarios', etiqueta: 'Administrar operarios', area: 'Administración' },
  { vista: 'usuarios', etiqueta: 'Administrar usuarios', area: 'Administración' }
];

// Roles y los permisos que cada uno trae de entrada (los mismos que sugería la
// pantalla anterior). El super administrador tiene acceso total sin permisos.
const ROLES = [
  { rol: 'super_administrador', etiqueta: 'Super administrador', icono: '👑', descripcion: 'Acceso total al sistema.', permisos: [] },
  { rol: 'administrador', etiqueta: 'Administrador', icono: '🛠️', descripcion: 'Gestiona máquinas, operarios y usuarios.', permisos: ['tractores', 'operarios', 'usuarios', 'auditoria'] },
  { rol: 'supervisor', etiqueta: 'Supervisor', icono: '📋', descripcion: 'Consulta, valida y registra el tanque móvil.', permisos: ['tablas', 'reportes', 'tanque_movil', 'alertas', 'auditoria'] },
  { rol: 'operario', etiqueta: 'Operario', icono: '⛽', descripcion: 'Registra el combustible.', permisos: ['registro'] }
];
const rolDe = (rol) => ROLES.find((r) => r.rol === rol);
const etiquetaPermiso = (vista) => PERMISOS.find((p) => p.vista === vista)?.etiqueta || vista;

// Rol de quien esta viendo la pantalla. Solo un super administrador puede
// asignar o ver el rol "super_administrador" (el backend aplica la misma regla).
function obtenerRolActual() {
  const sesion = typeof obtenerSesionActual === 'function' ? obtenerSesionActual() : null;
  return sesion?.rol || '';
}
const esSuperAdminActual = obtenerRolActual() === 'super_administrador';
const ROLES_ASIGNABLES = ROLES.filter((r) => esSuperAdminActual || r.rol !== 'super_administrador');

// Elementos de la pantalla.
const campoBuscar = document.getElementById('us-buscar');
const filtroRol = document.getElementById('us-filtro-rol');
const filtroEstado = document.getElementById('us-filtro-estado');
const filas = document.getElementById('us-filas');
const mensajeVacio = document.getElementById('us-vacio');
const contador = document.getElementById('us-contador');
// Panel lateral de crear/editar.
const fondo = document.getElementById('us-fondo');
const panel = document.getElementById('us-panel');
const formulario = document.getElementById('us-formulario');
const tituloPanel = document.getElementById('us-panel-titulo');
const campoUsuario = document.getElementById('us-usuario');
const campoContrasena = document.getElementById('us-contrasena');
const etiquetaContrasena = document.getElementById('us-etiqueta-contrasena');
const ayudaContrasena = document.getElementById('us-ayuda-contrasena');
const eleccionRol = document.getElementById('us-roles-elegir');
const bloquePermisos = document.getElementById('us-bloque-permisos');
const listaPermisos = document.getElementById('us-permisos');
const notaTotal = document.getElementById('us-nota-total');
const botonGuardar = document.getElementById('us-guardar');

let usuarios = [];
let usuarioEditando = null; // null = creando uno nuevo
let rolElegido = '';
let permisosElegidos = new Set();

// Extrae el mensaje de error que envia el backend, con un texto de respaldo.
async function extraerMensajeError(respuesta, mensajePorDefecto) {
  try {
    const datos = await respuesta.json();
    return datos?.mensaje || mensajePorDefecto;
  } catch (_) {
    return mensajePorDefecto; // La respuesta no era JSON
  }
}

// Permisos que la persona tiene además de los que trae su rol.
function permisosExtra(usuario) {
  if (usuario.rol === 'super_administrador') return [];
  const delRol = rolDe(usuario.rol)?.permisos || [];
  return (usuario.permisos || []).filter((vista) => !delRol.includes(vista));
}
// "Pendiente" = todavía entra con la contraseña inicial y debe cambiarla.
const estadoDe = (usuario) => (usuario.debe_cambiar_contrasena ? 'pendiente' : 'activo');
const iniciales = (nombre) => String(nombre || '?').replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
function fechaCorta(valor) {
  const fecha = valor ? new Date(valor) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

// --- Carga y lista ---------------------------------------------------------
async function cargarUsuarios() {
  const respuesta = await fetch('/api/usuarios', { headers: { 'Content-Type': 'application/json' } });

  // Sin permiso o con error: la lista queda vacía y se explica el motivo.
  if (!respuesta.ok) {
    usuarios = [];
    pintar();
    const mensaje = await extraerMensajeError(respuesta, 'No se pudo cargar la lista de usuarios.');
    mostrarAlertaError('No se pudo cargar la lista', mensaje);
    return;
  }
  usuarios = await respuesta.json();
  pintar();
}

function pintarResumen() {
  document.getElementById('us-kpi-total').textContent = usuarios.length;
  document.getElementById('us-kpi-activos').textContent = usuarios.filter((u) => estadoDe(u) === 'activo').length;
  document.getElementById('us-kpi-pendientes').textContent = usuarios.filter((u) => estadoDe(u) === 'pendiente').length;
  document.getElementById('us-kpi-extra').textContent = usuarios.filter((u) => permisosExtra(u).length).length;
}

function usuariosFiltrados() {
  const texto = campoBuscar.value.trim().toLowerCase();
  return usuarios.filter((u) => {
    const rol = rolDe(u.rol)?.etiqueta || u.rol;
    if (texto && !`${u.usuario} ${rol}`.toLowerCase().includes(texto)) return false;
    if (filtroRol.value && u.rol !== filtroRol.value) return false;
    if (filtroEstado.value === 'extra') return permisosExtra(u).length > 0;
    return !filtroEstado.value || estadoDe(u) === filtroEstado.value;
  });
}

function pintar() {
  pintarResumen();
  const visibles = usuariosFiltrados();
  filas.innerHTML = '';
  mensajeVacio.hidden = visibles.length > 0;
  contador.textContent = `${visibles.length} de ${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'}`;

  visibles.forEach((usuario) => {
    const rol = rolDe(usuario.rol);
    const extra = permisosExtra(usuario);
    const esTotal = usuario.rol === 'super_administrador';
    const cantidad = (usuario.permisos || []).length;
    const pendiente = estadoDe(usuario) === 'pendiente';
    const fila = document.createElement('tr');
    fila.innerHTML = `
      <td><div class="us-celda-usuario"><span class="us-avatar us-rol-${escapeHtml(usuario.rol)}">${escapeHtml(iniciales(usuario.usuario))}</span><strong>${escapeHtml(usuario.usuario)}</strong></div></td>
      <td data-titulo="Rol"><span class="us-chip-rol us-rol-${escapeHtml(usuario.rol)}">${escapeHtml(rol?.etiqueta || usuario.rol)}</span>${
        extra.length ? ` <span class="us-chip-extra" title="${escapeHtml(extra.map(etiquetaPermiso).join(', '))}">+${extra.length} extra</span>` : ''
      }</td>
      <td data-titulo="Permisos">${esTotal ? 'Acceso total' : `${cantidad} permiso${cantidad === 1 ? '' : 's'}`}</td>
      <td data-titulo="Estado"><span class="us-estado ${pendiente ? 'us-estado-pendiente' : ''}">${pendiente ? 'Debe cambiar contraseña' : 'Activo'}</span></td>
      <td data-titulo="Creado">${escapeHtml(fechaCorta(usuario.creado_en))}</td>
      <td class="us-acciones">
        <button type="button" class="us-icono us-editar" aria-label="Editar ${escapeHtml(usuario.usuario)}" title="Editar">✏️</button>
        <button type="button" class="us-icono us-borrar" aria-label="Eliminar ${escapeHtml(usuario.usuario)}" title="Eliminar">🗑️</button>
      </td>`;
    fila.querySelector('.us-editar').addEventListener('click', () => abrirPanel(usuario));
    fila.querySelector('.us-borrar').addEventListener('click', () => eliminarUsuario(usuario));
    filas.appendChild(fila);
  });
}

// Guía "Roles del sistema": qué trae cada rol.
function pintarGuiaRoles() {
  document.getElementById('us-roles-lista').innerHTML = ROLES.map(
    (r) => `
    <div class="us-guia-rol">
      <span class="us-guia-icono us-rol-${r.rol}" aria-hidden="true">${r.icono}</span>
      <div>
        <span class="us-chip-rol us-rol-${r.rol}">${r.etiqueta}</span>
        <p>${r.descripcion}</p>
        <small>${r.permisos.length ? r.permisos.map(etiquetaPermiso).join(' · ') : 'Todos los módulos'}</small>
      </div>
    </div>`
  ).join('');
}

// --- Panel lateral de crear / editar ---------------------------------------
function abrirPanel(usuario = null) {
  usuarioEditando = usuario;
  formulario.reset();
  campoUsuario.value = usuario?.usuario || '';
  campoUsuario.readOnly = Boolean(usuario); // El nombre de usuario no se cambia
  campoContrasena.value = usuario ? '' : '123456';
  campoContrasena.required = !usuario;
  etiquetaContrasena.textContent = usuario ? 'Nueva contraseña' : 'Contraseña inicial';
  ayudaContrasena.textContent = usuario
    ? 'Déjala vacía si no cambia. Si pones 123456, le pedirá cambiarla al entrar.'
    : 'Con 123456 el sistema le pedirá cambiarla al entrar.';
  tituloPanel.textContent = usuario ? `Editar usuario: ${usuario.usuario}` : 'Nuevo usuario';
  botonGuardar.textContent = usuario ? 'Guardar cambios' : 'Crear usuario';

  rolElegido = usuario?.rol || '';
  permisosElegidos = new Set(usuario ? usuario.permisos || [] : []);
  pintarEleccionRol();
  pintarPermisos();

  fondo.hidden = false;
  panel.hidden = false;
  document.body.classList.add('us-panel-abierto');
  (usuario ? campoContrasena : campoUsuario).focus();
}

function cerrarPanel() {
  fondo.hidden = true;
  panel.hidden = true;
  document.body.classList.remove('us-panel-abierto');
  usuarioEditando = null;
}

// Tarjetas para elegir el rol. Al cambiarlo se encienden sus permisos.
function pintarEleccionRol() {
  eleccionRol.innerHTML = '';
  ROLES_ASIGNABLES.forEach((r) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = `us-opcion-rol${rolElegido === r.rol ? ' activa' : ''}`;
    boton.setAttribute('role', 'radio');
    boton.setAttribute('aria-checked', String(rolElegido === r.rol));
    boton.innerHTML = `<span aria-hidden="true">${r.icono}</span>${r.etiqueta}`;
    boton.addEventListener('click', () => {
      rolElegido = r.rol;
      permisosElegidos = new Set(r.permisos);
      pintarEleccionRol();
      pintarPermisos();
    });
    eleccionRol.appendChild(boton);
  });
}

// Interruptores de permisos por área, marcando cuáles son del rol y cuáles extra.
function pintarPermisos() {
  const esTotal = rolElegido === 'super_administrador';
  bloquePermisos.hidden = esTotal || !rolElegido;
  notaTotal.hidden = !esTotal;
  if (esTotal || !rolElegido) return;

  const delRol = rolDe(rolElegido)?.permisos || [];
  listaPermisos.innerHTML = '';
  [...new Set(PERMISOS.map((p) => p.area))].forEach((area) => {
    const titulo = document.createElement('h3');
    titulo.className = 'us-area';
    titulo.textContent = area;
    listaPermisos.appendChild(titulo);

    PERMISOS.filter((p) => p.area === area).forEach((permiso) => {
      const activo = permisosElegidos.has(permiso.vista);
      const esDelRol = delRol.includes(permiso.vista);
      const fila = document.createElement('label');
      fila.className = `us-permiso${activo ? ' activo' : ''}${activo && !esDelRol ? ' es-extra' : ''}`;
      fila.innerHTML = `
        <input type="checkbox" class="us-interruptor" ${activo ? 'checked' : ''}>
        <span class="us-permiso-texto">${escapeHtml(permiso.etiqueta)}</span>
        ${activo ? `<b class="${esDelRol ? 'us-marca-rol' : 'us-marca-extra'}">${esDelRol ? 'del rol' : 'extra'}</b>` : ''}`;
      fila.querySelector('input').addEventListener('change', (evento) => {
        if (evento.target.checked) permisosElegidos.add(permiso.vista);
        else permisosElegidos.delete(permiso.vista);
        pintarPermisos();
      });
      listaPermisos.appendChild(fila);
    });
  });
}

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  if (!rolElegido) {
    mostrarAlertaError('Falta el rol', 'Elige el rol del usuario.');
    return;
  }
  const permisos = rolElegido === 'super_administrador' ? [] : [...permisosElegidos];
  const editando = usuarioEditando;
  botonGuardar.disabled = true;
  try {
    const respuesta = await fetch(editando ? `/api/usuarios/${editando.id}` : '/api/usuarios', {
      method: editando ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        editando
          ? { rol: rolElegido, contrasena: campoContrasena.value, permisos } // Contraseña vacía = no cambia
          : { usuario: campoUsuario.value.trim(), contrasena: campoContrasena.value.trim(), rol: rolElegido, permisos }
      )
    });
    if (!respuesta.ok) {
      const mensaje = await extraerMensajeError(respuesta, editando ? 'No se pudo actualizar el usuario.' : 'No se pudo crear el usuario.');
      mostrarAlertaError(editando ? 'No se pudo guardar' : 'No se pudo crear el usuario', mensaje);
      return;
    }
    cerrarPanel(); // También borra la contraseña escrita
    await cargarUsuarios();
    mostrarAlertaExito(editando ? 'Usuario actualizado' : 'Usuario creado', editando ? 'Los cambios del usuario fueron guardados.' : 'El usuario fue creado correctamente.');
  } finally {
    botonGuardar.disabled = false;
  }
});

// Elimina un usuario de usuarios_combustible.
// OJO: este sí es un borrado real (no una anulación como en los otros módulos).
async function eliminarUsuario(usuario) {
  const confirmado = await confirmarAccion('Eliminar usuario', `¿Desea eliminar el usuario ${usuario.usuario}?`, 'Sí, eliminar');
  if (!confirmado) return;

  const respuesta = await fetch(`/api/usuarios/${usuario.id}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' }
  });
  if (!respuesta.ok) {
    const mensaje = await extraerMensajeError(respuesta, 'No se pudo eliminar el usuario.');
    mostrarAlertaError('No se pudo eliminar', mensaje);
    return;
  }
  await cargarUsuarios();
  mostrarAlertaExito('Usuario eliminado', 'El usuario fue eliminado correctamente.');
}

// --- Arranque de la pantalla ------------------------------------------------
// Sin ser super administrador no se ve esa opción en el filtro.
if (!esSuperAdminActual) filtroRol.querySelector('option[value="super_administrador"]')?.remove();

document.getElementById('us-nuevo').addEventListener('click', () => abrirPanel());
document.getElementById('us-cerrar').addEventListener('click', cerrarPanel);
document.getElementById('us-cancelar').addEventListener('click', cerrarPanel);
document.getElementById('us-restaurar').addEventListener('click', () => {
  permisosElegidos = new Set(rolDe(rolElegido)?.permisos || []);
  pintarPermisos();
});
fondo.addEventListener('click', cerrarPanel);
document.addEventListener('keydown', (evento) => {
  if (evento.key === 'Escape' && !panel.hidden) cerrarPanel();
});
campoBuscar.addEventListener('input', pintar);
filtroRol.addEventListener('change', pintar);
filtroEstado.addEventListener('change', pintar);

pintarGuiaRoles();
cargarUsuarios();
