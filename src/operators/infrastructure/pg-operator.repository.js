// ============================================================================
// pg-operator.repository.js (INFRAESTRUCTURA) — SQL DE OPERARIOS
// ----------------------------------------------------------------------------
// Consultas sobre la tabla "operarios".
// ============================================================================

const { OperatorRepository } = require('../domain/operator.repository');

class PgOperatorRepository extends OperatorRepository {
  constructor(db) {
    super();
    this.db = db;
  }

  // Solo operarios activos, ordenados alfabéticamente para el selector.
  async list() {
    const [filas] = await this.db.query(
      "SELECT id,nombre,cedula FROM operarios WHERE estado<>'ANULADO' ORDER BY nombre ASC"
    );
    return filas;
  }

  // Fila completa, incluidos estado y datos de anulación.
  async findById(id) {
    const [filas] = await this.db.query('SELECT * FROM operarios WHERE id=?', [id]);
    return filas[0] || null;
  }

  // Alta: el nombre se guarda en mayúsculas para que coincida con lo que se
  // almacena en los registros de combustible.
  async create(datos) {
    const nombre = String(datos.nombre || '')
      .trim()
      .toUpperCase();
    const cedula = String(datos.cedula || '').trim();
    const [filas] = await this.db.query(
      'INSERT INTO operarios(nombre,cedula) VALUES(?,?) RETURNING id',
      [nombre, cedula]
    );
    return { id: filas[0].id, nombre, cedula };
  }

  // Borra el operario. Los registros históricos no se afectan: guardan el
  // nombre y la cédula como texto, sin depender de esta fila.
  async remove(id) {
    const [, resultado] = await this.db.query('DELETE FROM operarios WHERE id=?', [id]);
    return resultado.rowCount > 0;
  }
}

module.exports = { PgOperatorRepository };
