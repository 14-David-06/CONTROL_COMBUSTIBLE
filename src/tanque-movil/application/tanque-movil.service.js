// ============================================================================
// tanque-movil.service.js (APLICACIÓN) — ENTREGAS DEL TANQUE MÓVIL Y SU CUADRE
// ----------------------------------------------------------------------------
// El supervisor pasa a la app la planilla del tanque móvil: qué máquina recibió
// cuántos galones en el campo y con qué lectura (horómetro o km).
//
// Funciona como el registro del tanque principal pero SIN lecturas iniciales
// ni cierre: no hay cuadre contra el tanque principal (no siempre se registra
// el llenado del móvil). Nada de esto toca la jornada, M1/M2 ni el cierre.
// ============================================================================

const { hoyLocal, esFechaValida } = require('../../shared/application/fechas');
const { leerHorometro } = require('../../records/domain/horometro');
const { esTanqueMovil } = require('../../records/application/record.service');

const bad = (mensaje) => Object.assign(new Error(mensaje), { status: 400 });
const redondear = (n) => Math.round(n * 100) / 100;
const textoLimpio = (valor, maximo) => String(valor ?? '').trim().slice(0, maximo);
const PRIMER_DIA = '2000-01-01';

class TanqueMovilService {
  constructor(repository, recordRepository, tractorRepository) {
    this.repository = repository; // null si la base no es Airtable
    this.recordRepository = recordRepository;
    this.tractorRepository = tractorRepository;
  }

  disponible() {
    if (!this.repository)
      throw Object.assign(new Error('El tanque móvil solo está disponible con Airtable.'), {
        status: 501
      });
  }

  // Entregas de un día y su total (lo que registró el supervisor).
  async resumenDia(fecha) {
    this.disponible();
    if (!esFechaValida(fecha)) throw bad('La fecha no es válida.');
    const [entregas, tractores] = await Promise.all([
      this.repository.listar(fecha, fecha),
      this.tractorRepository.list()
    ]);
    const unidadDe = new Map(tractores.map((t) => [String(t.maquina || '').toUpperCase(), t.unidad_medida]));
    return {
      fecha,
      repartido: redondear(entregas.reduce((total, e) => total + e.cantidad, 0)),
      entregas: entregas.map((e) => ({ ...e, unidad: unidadDe.get(String(e.maquina).toUpperCase()) || 'horas' }))
    };
  }

  // Revisa y normaliza lo que llega del formulario. idActual = la entrega que
  // se está editando (para no compararla consigo misma).
  async validar(datos, idActual = null) {
    const fecha = String(datos.fecha || '').slice(0, 10);
    if (!esFechaValida(fecha)) throw bad('La fecha no es válida.');
    if (fecha > hoyLocal()) throw bad('La fecha no puede ser posterior a hoy.');

    const tractor = await this.tractorRepository.findByMachine(textoLimpio(datos.maquina, 40));
    if (!tractor) throw bad('La máquina no existe en Tractores.');
    if (esTanqueMovil(tractor.maquina, tractor))
      throw bad('El tanque móvil no se puede tanquear a sí mismo.');

    const cantidad = Number(String(datos.cantidad ?? '').replace(',', '.'));
    if (!Number.isFinite(cantidad) || cantidad <= 0) throw bad('Los galones deben ser mayores que cero.');
    if (cantidad > 2000) throw bad('La cantidad de galones no es razonable.');

    const esKm = tractor.unidad_medida === 'km';
    const nombre = esKm ? 'kilometraje' : 'horómetro';
    let horometro = tractor.sin_horometro ? 'N/A' : textoLimpio(datos.horometro, 40);
    const lectura = tractor.sin_horometro ? null : leerHorometro(horometro);
    if (lectura !== null) {
      horometro = String(lectura);
      // La lectura debe encajar entre la del día anterior y la del día siguiente,
      // mirando los dos lados: tanque principal y tanque móvil.
      const [registros, entregas] = await Promise.all([
        this.recordRepository.findByDateRange(PRIMER_DIA, '2999-12-31', tractor.maquina),
        this.repository.listar(PRIMER_DIA, '2999-12-31', tractor.maquina)
      ]);
      const lecturas = [
        ...registros
          .filter((r) => String(r.maquina || '').trim().toUpperCase() === tractor.maquina.toUpperCase())
          .map((r) => ({ fecha: String(r.fecha || '').slice(0, 10), valor: leerHorometro(r.horometro) })),
        ...entregas
          .filter((e) => e.id !== idActual)
          .map((e) => ({ fecha: e.fecha, valor: leerHorometro(e.horometro) }))
      ].filter((x) => x.valor !== null);
      const anterior = Math.max(...lecturas.filter((x) => x.fecha < fecha).map((x) => x.valor), -Infinity);
      const siguiente = Math.min(...lecturas.filter((x) => x.fecha > fecha).map((x) => x.valor), Infinity);
      if (lectura < anterior)
        throw bad(`El ${nombre} no puede ser menor al de un día anterior para ${tractor.maquina}: ${anterior}.`);
      if (lectura > siguiente)
        throw bad(`El ${nombre} no puede ser mayor al de un día posterior para ${tractor.maquina}: ${siguiente}.`);
    }

    return {
      fecha,
      maquina: tractor.maquina,
      operario: textoLimpio(datos.operario, 80),
      horometro,
      cantidad: redondear(cantidad),
      numeroSalida: textoLimpio(datos.numeroSalida, 30),
      observaciones: textoLimpio(datos.observaciones, 500)
    };
  }

  async crear(datos, usuario) {
    this.disponible();
    const limpio = await this.validar(datos);
    return this.repository.insert({ ...limpio, registradoPor: usuario });
  }

  async actualizar(id, datos) {
    this.disponible();
    const antes = await this.repository.findById(id);
    if (!antes || antes.estado === 'ANULADO')
      throw Object.assign(new Error('La entrega no existe.'), { status: 404 });
    const despues = await this.repository.update(id, await this.validar(datos, id));
    return { antes, despues };
  }

  async anular(id, motivo, usuario) {
    this.disponible();
    const motivoLimpio = textoLimpio(motivo, 300);
    if (!motivoLimpio) throw bad('El motivo es obligatorio.');
    const antes = await this.repository.findById(id);
    if (!antes || antes.estado === 'ANULADO')
      throw Object.assign(new Error('La entrega no existe.'), { status: 404 });
    await this.repository.remove(id, motivoLimpio, usuario);
    return antes;
  }
}

module.exports = { TanqueMovilService };
