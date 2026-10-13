// ============================================================================
// horometro.js (DOMINIO) — HORAS TRABAJADAS Y GALONES POR HORA
// ----------------------------------------------------------------------------
// Regla acordada con la operación:
//   * Un TRAMO va de una lectura numérica del horómetro a la siguiente. Los
//     registros sin número ("Horómetro dañado", "N/A"...) se saltan: el tramo
//     se mide contra la última lectura válida.
//   * Horas del tramo = lectura nueva - lectura anterior, pero NUNCA más de
//     24 h por cada día transcurrido entre las dos. Si las dos lecturas son del
//     MISMO día, ese día tiene 24 h en total: varios tramos del mismo día se
//     reparten esas 24 h (no suman 24 cada uno). Si el horómetro da más, se usa
//     el tope y el tramo queda marcado como AJUSTADO (suele ser un horómetro
//     reparado tras días dañado, un error de digitación o un odómetro en km).
//   * Si el horómetro BAJA (cambio o reinicio), el tramo cuenta 0 h y queda
//     marcado para revisar.
//   * Horas trabajadas de la máquina = suma de sus tramos (ya con topes).
//   * Gal/hora = galones cargados en esos tramos ÷ horas trabajadas. La
//     primera carga no entra: se gastó antes de la primera lectura medida.
// VEHÍCULOS POR KILOMETRAJE (unidad_medida='km' en Tractores): la misma regla,
// pero la lectura son km, el tope es KM_MAXIMOS_POR_DIA y el resultado se lee
// como "km recorridos" y "galones por km" (los nombres de los campos no cambian:
// horasTrabajadas = km y galonesPorHora = gal/km).
// La pantalla del reporte aplica esta MISMA regla (reporte-detalle.js ->
// calcularReporteHorometros): si cambias algo aquí, cámbialo también allá.
// PARA CAMBIAR EL TOPE DIARIO -> HORAS_MAXIMAS_POR_DIA / KM_MAXIMOS_POR_DIA.
// ============================================================================

const HORAS_MAXIMAS_POR_DIA = 24;
const KM_MAXIMOS_POR_DIA = 1000; // Un camión no recorre más de esto en un día
const HOROMETRO_NUMERICO = /^[0-9]+([.,][0-9]+)?$/; // Solo dígitos con coma o punto decimal
const MS_POR_DIA = 86400000;
const redondear = (n) => Math.round(n * 100) / 100;
const redondear3 = (n) => Math.round(n * 1000) / 1000;

// Lectura numérica del horómetro, o null si es texto ("Horómetro dañado").
function leerHorometro(valor) {
  const texto = String(valor ?? '').trim();
  return HOROMETRO_NUMERICO.test(texto) ? Number(texto.replace(',', '.')) : null;
}

// tanqueos: [{ fecha:'YYYY-MM-DD', registradoEn, horometro, cantidad }] de UNA máquina.
// unidad: 'horas' (horómetro) o 'km' (kilometraje); solo cambia el tope diario.
function calcularHorometro(tanqueos, { unidad = 'horas' } = {}) {
  const maximoPorDia = unidad === 'km' ? KM_MAXIMOS_POR_DIA : HORAS_MAXIMAS_POR_DIA;
  const ordenados = [...tanqueos].sort(
    (a, b) =>
      String(a.fecha).localeCompare(String(b.fecha)) ||
      String(a.registradoEn || '').localeCompare(String(b.registradoEn || ''))
  );

  let anterior = null; // Última lectura válida { horas, fecha }
  let primera = null;
  let horasTrabajadas = 0;
  let galonesTramos = 0;
  let tramosAjustados = 0;
  let tramosQueRetroceden = 0;
  let cantidadTramos = 0;
  const horasMismoDia = new Map(); // fecha -> horas ya usadas por tramos de ese mismo día

  const detalle = ordenados.map((t) => {
    const lectura = leerHorometro(t.horometro);
    const fila = {
      ...t,
      lectura,
      horasHorometro: null,
      topeHoras: null,
      horasTramo: null,
      ajustado: false,
      retrocede: false
    };
    if (lectura === null) return fila;
    if (!anterior) {
      primera = { horas: lectura, fecha: t.fecha };
    } else {
      const dias = Math.round((Date.parse(t.fecha) - Date.parse(anterior.fecha)) / MS_POR_DIA);
      const tope =
        dias >= 1
          ? dias * maximoPorDia
          : Math.max(0, maximoPorDia - (horasMismoDia.get(t.fecha) || 0));
      const diferencia = redondear(lectura - anterior.horas);
      fila.horasHorometro = diferencia;
      fila.topeHoras = tope;
      fila.retrocede = diferencia < 0;
      fila.ajustado = diferencia > tope;
      fila.horasTramo = fila.retrocede ? 0 : Math.min(diferencia, tope);
      if (dias < 1) horasMismoDia.set(t.fecha, (horasMismoDia.get(t.fecha) || 0) + fila.horasTramo);
      horasTrabajadas += fila.horasTramo;
      galonesTramos += Number(t.cantidad) || 0;
      cantidadTramos += 1;
      if (fila.ajustado) tramosAjustados += 1;
      if (fila.retrocede) tramosQueRetroceden += 1;
    }
    anterior = { horas: lectura, fecha: t.fecha };
    return fila;
  });

  const horas = cantidadTramos ? redondear(horasTrabajadas) : null;
  return {
    tanqueos: detalle,
    horometroInicial: primera ? primera.horas : null,
    horometroFinal: anterior ? anterior.horas : null,
    horasTrabajadas: horas,
    galonesTramos: cantidadTramos ? redondear(galonesTramos) : null, // Galones que entran al gal/hora
    // En km el consumo es pequeño (0,02 gal/km): se guardan 3 decimales.
    galonesPorHora: horas > 0 ? (unidad === 'km' ? redondear3(galonesTramos / horas) : redondear(galonesTramos / horas)) : null,
    tramosAjustados,
    tramosQueRetroceden
  };
}

module.exports = { calcularHorometro, leerHorometro, HORAS_MAXIMAS_POR_DIA, KM_MAXIMOS_POR_DIA };
