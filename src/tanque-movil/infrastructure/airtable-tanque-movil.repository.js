// ============================================================================
// airtable-tanque-movil.repository.js (INFRAESTRUCTURA) — ENTREGAS DEL TANQUE MÓVIL
// ----------------------------------------------------------------------------
// Tabla "tanque_movil" (airtable/schema.js): lo que el tanque móvil le echa a
// cada máquina en el campo. Va aparte de registros_combustible: no toca
// jornadas, lecturas M1/M2 ni el cierre del tanque principal.
// Nunca se borra una fila: se anula (estado='ANULADO' con motivo).
// ============================================================================

const { textoFormula, combinarFormula } = require('../../shared/infrastructure/airtable-formula');

const TABLA = 'tanque_movil';

// Fila de Airtable -> objeto que usa la app.
const aEntrega = (f) => ({
  id: f.id,
  fecha: String(f.fecha || '').slice(0, 10),
  maquina: f.maquina || '',
  operario: f.operario || '',
  horometro: f.horometro ?? '',
  cantidad: Number(f.cantidad) || 0,
  numeroSalida: f.numero_salida || '',
  observaciones: f.observaciones || '',
  registradoPor: f.registrado_por || '',
  registradoEn: f.registrado_en || '',
  estado: f.estado || 'ACTIVO'
});

class AirtableTanqueMovilRepository {
  constructor(cliente) {
    this.cliente = cliente;
  }

  // Entregas activas entre dos fechas (YYYY-MM-DD, incluidas). Sin "maquina"
  // trae todas; con "maquina" solo las de esa máquina.
  async listar(inicio, fin, maquina = '') {
    const filas = await this.cliente.listar(TABLA, {
      formula: combinarFormula('AND', [
        `{estado}!='ANULADO'`,
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')>=${textoFormula(inicio)}`,
        `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<=${textoFormula(fin)}`,
        maquina ? `UPPER({maquina})=UPPER(${textoFormula(maquina)})` : ''
      ]),
      orden: [
        { campo: 'fecha', direccion: 'asc' },
        { campo: 'registrado_en', direccion: 'asc' }
      ]
    });
    return filas.map(aEntrega);
  }

  // Fecha de la primera entrega registrada (desde ahí se cuadra el saldo).
  async primeraFecha() {
    const [fila] = await this.cliente.listar(TABLA, {
      formula: `{estado}!='ANULADO'`,
      orden: [{ campo: 'fecha', direccion: 'asc' }],
      maxFilas: 1
    });
    return fila ? String(fila.fecha || '').slice(0, 10) : null;
  }

  async findById(id) {
    const fila = await this.cliente.obtener(TABLA, id);
    return fila ? aEntrega(fila) : null;
  }

  async insert(datos) {
    const [fila] = await this.cliente.crear(TABLA, [
      {
        fecha: datos.fecha,
        maquina: datos.maquina,
        operario: datos.operario || null,
        horometro: datos.horometro || null,
        cantidad: datos.cantidad,
        numero_salida: datos.numeroSalida || null,
        observaciones: datos.observaciones || null,
        registrado_por: datos.registradoPor || null,
        registrado_en: new Date().toISOString(),
        estado: 'ACTIVO'
      }
    ]);
    return aEntrega(fila);
  }

  async update(id, datos) {
    await this.cliente.actualizar(TABLA, [
      {
        id,
        campos: {
          fecha: datos.fecha,
          maquina: datos.maquina,
          operario: datos.operario || null,
          horometro: datos.horometro || null,
          cantidad: datos.cantidad,
          numero_salida: datos.numeroSalida || null,
          observaciones: datos.observaciones || null
        }
      }
    ]);
    return this.findById(id);
  }

  async remove(id, motivo, usuario) {
    await this.cliente.actualizar(TABLA, [
      {
        id,
        campos: {
          estado: 'ANULADO',
          motivo_anulacion: motivo,
          usuario_anulacion: usuario || null,
          fecha_anulacion: new Date().toISOString()
        }
      }
    ]);
    return true;
  }
}

module.exports = { AirtableTanqueMovilRepository };
