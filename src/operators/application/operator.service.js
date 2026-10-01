// ============================================================================
// operator.service.js (APLICACIÓN) — REGLAS DE NEGOCIO DE OPERARIOS
// ----------------------------------------------------------------------------
// Lo único con lógica propia es la eliminación (ver remove()).
// ============================================================================

class OperatorService {
  constructor(repository) {
    this.repository = repository;
  }

  // Operarios activos (para la pantalla y para el selector del registro).
  list() {
    return this.repository.list();
  }

  // Alta de operario (nombre + cédula).
  create(data) {
    return this.repository.create(data);
  }

  // Consulta por id.
  findById(id) {
    return this.repository.findById(id);
  }

  // ELIMINAR un operario: se borra la fila (no se anula), para que la cédula
  // quede libre también en la otra aplicación que comparte esta tabla.
  // Los suministros ya guardados no cambian: guardan nombre y cédula como texto.
  async remove(id) {
    const actual = await this.repository.findById(id);
    if (!actual) throw Object.assign(new Error('El operario no existe.'), { status: 404 });
    await this.repository.remove(id);
    return actual; // Datos previos, para dejarlos en la auditoría
  }
}

module.exports = { OperatorService };
