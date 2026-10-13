// ============================================================================
// tanque-movil.service.js (APLICACIÓN) — ENTREGAS DEL TANQUE MÓVIL Y SU CUADRE
// ----------------------------------------------------------------------------
// El supervisor pasa a la app la planilla del tanque móvil: qué máquina recibió
// cuántos galones en el campo y con qué lectura (horómetro o km).
//
// CUADRE DEL DÍA (lo que se ve arriba en la pantalla):
//   * Cargado al móvil  = galones que el TANQUE PRINCIPAL le echó al tanque
//     móvil ese día (se lee de registros_combustible; aquí no se registra).
//   * Saldo anterior    = lo que le quedaba al móvil del día anterior.
//   * Repartido         = suma de las entregas a máquinas de ese día.
//   * Saldo             = saldo anterior + cargado - repartido.
// El saldo se acumula desde la PRIMERA entrega registrada en esta tabla: lo de
// antes nunca se pasó a la app, así que se toma como cero.
//
// Nada de esto toca la jornada, las lecturas M1/M2 ni el cierre del día.
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

  // Cuadre y entregas de un día.
  async resumenDia(fecha) {
    this.disponible();
    if (!esFechaValida(fecha)) throw bad('La fecha no es válida.');
    const desde = (await this.repository.primeraFecha()) || fecha;
    const inicio = desde < fecha ? desde : fecha;

    const [registros, entregas, tractores] = await Promise.all([
      this.recordRepository.findByDateRange(inicio, fecha, ''),
      this.repository.listar(inicio, fecha),
      this.tractorRepository.list()
    ]);
    const tractorDe = new Map(tractores.map((t) => [String(t.maquina || '').toUpperCase(), t]));

    // Lo que el tanque principal le cargó al móvil (registros a nombre del tanque móvil).
    const cargas = registros
      .filter((r) => {
        const clave = String(r.maquina || '').trim().toUpperCase();
        return esTanqueMovil(clave, tractorDe.get(clave));
      })
      .map((r) => ({
        fecha: String(r.fecha || '').slice(0, 10),
        operario: r.operario || '',
        cantidad: Number(r.cantidad) || 0
      }));

    const suma = (lista) => lista.reduce((total, x) => total + x.cantidad, 0);
    // Antes de la primera entrega registrada no se cuadra: saldo anterior = 0.
    const cuentaParaSaldo = (x) => x.fecha >= desde && x.fecha < fecha;
    const saldoAnterior = suma(cargas.filter(cuentaParaSaldo)) - suma(entregas.filter(cuentaParaSaldo));
    const cargasDelDia = cargas.filter((x) => x.fecha === fecha);
    const entregasDelDia = entregas.filter((x) => x.fecha === fecha);
    const cargado = suma(cargasDelDia);
    const repartido = suma(entregasDelDia);

    return {
      fecha,
      desde,
      saldoAnterior: redondear(saldoAnterior),
      cargado: redondear(cargado),
      disponible: redondear(saldoAnterior + cargado),
      repartido: redondear(repartido),
      saldo: redondear(saldoAnterior + cargado - repartido),
      cargas: cargasDelDia,
      entregas: entregasDelDia.map((e) => ({
        ...e,
        unidad: tractorDe.get(String(e.maquina).toUpperCase())?.unidad_medida || 'horas'
      }))
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
