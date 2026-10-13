// ============================================================================
// tanque-movil.test.js — CUADRE Y REGLAS DEL TANQUE MÓVIL
// ----------------------------------------------------------------------------
// src/tanque-movil/application/tanque-movil.service.js con repositorios falsos
// (sin Airtable): total del día, lecturas que no encajan y que las entregas se
// sumen al reporte de horómetros de cada máquina.
// ============================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const { TanqueMovilService } = require('../src/tanque-movil/application/tanque-movil.service');
const { RecordService } = require('../src/records/application/record.service');

const tractores = [
  { maquina: 'MA116', descripcion: 'TRACTOR KUBOTA', unidad_medida: 'horas', sin_horometro: false },
  { maquina: 'LZT936', descripcion: 'CAMION VOLKSWAGEN', unidad_medida: 'km', sin_horometro: false },
  { maquina: 'TANQUE MOVILE', descripcion: 'TANQUE MOBIL', unidad_medida: 'horas', sin_horometro: false }
];
const tractorRepository = {
  list: async () => tractores,
  findByMachine: async (m) => tractores.find((t) => t.maquina === String(m).toUpperCase()) || null
};
// Tanque principal: el 8/10 le carga 150 gal al móvil y el 9/10, 100 gal.
const registros = [
  { fecha: '2026-10-08', maquina: 'TANQUE MOVILE', cantidad: 150, horometro: 'N/A' },
  { fecha: '2026-10-08', maquina: 'MA116', cantidad: 15, horometro: '1515.8' },
  { fecha: '2026-10-09', maquina: 'TANQUE MOVILE', cantidad: 100, horometro: 'N/A' },
  { fecha: '2026-10-10', maquina: 'MA116', cantidad: 15, horometro: '1530' }
];
const recordRepository = {
  findByDateRange: async (inicio, fin, busqueda = '') =>
    registros.filter((r) => r.fecha >= inicio && r.fecha <= fin && (!busqueda || r.maquina.includes(busqueda.toUpperCase())))
};
function repositorioMovil(entregas) {
  return {
    listar: async (inicio, fin, maquina = '') =>
      entregas.filter((e) => e.fecha >= inicio && e.fecha <= fin && (!maquina || e.maquina === maquina)),
    insert: async (datos) => ({ id: 'nuevo', ...datos })
  };
}

test('el día muestra sus entregas y el total, sin depender del tanque principal', async () => {
  const entregas = [
    { id: 'a', fecha: '2026-10-08', maquina: 'MA116', cantidad: 140, horometro: '1520' },
    { id: 'b', fecha: '2026-10-09', maquina: 'LZT936', cantidad: 35, horometro: '99829' },
    { id: 'c', fecha: '2026-10-09', maquina: 'MA116', cantidad: 70, horometro: '1525' }
  ];
  const servicio = new TanqueMovilService(repositorioMovil(entregas), recordRepository, tractorRepository);
  const dia = await servicio.resumenDia('2026-10-09');
  assert.equal(dia.repartido, 105);
  assert.equal(dia.entregas.length, 2);
  assert.equal(dia.entregas.find((e) => e.maquina === 'LZT936').unidad, 'km');
  assert.equal(dia.saldo, undefined); // Ya no hay cuadre contra el tanque principal
});

test('la lectura debe encajar entre la del día anterior y la del día siguiente', async () => {
  const servicio = new TanqueMovilService(repositorioMovil([]), recordRepository, tractorRepository);
  const base = { fecha: '2026-10-09', maquina: 'MA116', cantidad: 20 };
  await assert.rejects(servicio.crear({ ...base, horometro: '1500' }, 'sup'), /menor/);
  await assert.rejects(servicio.crear({ ...base, horometro: '1600' }, 'sup'), /mayor/);
  const creada = await servicio.crear({ ...base, horometro: '1520,5' }, 'sup');
  assert.equal(creada.horometro, '1520.5');
  await assert.rejects(servicio.crear({ ...base, maquina: 'TANQUE MOVILE', horometro: '' }, 'sup'), /sí mismo/);
  await assert.rejects(servicio.crear({ ...base, cantidad: 0, horometro: '1520' }, 'sup'), /mayores que cero/);
});

test('reporte de horómetros: las entregas del móvil se suman a la máquina', async () => {
  const entregas = [{ fecha: '2026-10-09', maquina: 'MA116', cantidad: 20, horometro: '1522', operario: 'X' }];
  const servicio = new RecordService(recordRepository, tractorRepository, null, null, repositorioMovil(entregas));
  const lista = await servicio.horometrosPorMaquina('2026-10-01', '2026-10-31');
  const ma116 = lista.find((m) => m.maquina === 'MA116');
  assert.equal(ma116.cantidadTanqueos, 3);
  assert.equal(ma116.galones, 50);
  assert.equal(ma116.galonesMovil, 20);
  assert.equal(ma116.horasTrabajadas, 14.2); // 1515.8 -> 1530
  assert.equal(ma116.galonesPorHora, 2.46); // (20 + 15) / 14.2
  assert.equal(ma116.tanqueos[1].origen, 'movil');
});
