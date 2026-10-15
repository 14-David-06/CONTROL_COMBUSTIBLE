// ============================================================================
// reportes.js — PANTALLA DE REPORTES (public/html/reportes.html)
// ----------------------------------------------------------------------------
// Tres secciones independientes:
//   1. Cartas mensuales: una por cada mes con registros + la carta "general".
//      Al hacer clic llevan a reporte-detalle.
//   2. Gráfica de consumo de los últimos 7 días.
//   3. Analítica por máquina: ranking del año con promedios y máximos.
// ============================================================================

const cartasReportes = document.getElementById('cartas-reportes');
const botonActualizarReportes = document.getElementById('boton-actualizar-reportes');
const botonActualizarAnalitica = document.getElementById('boton-actualizar-analitica');
const analiticaMaquinas = document.getElementById('analitica-maquinas');

// Nombres de meses para mostrar (el índice 0 corresponde a enero).
const nombresMeses = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
];

// Consulta las cartas mensuales generadas automaticamente en MySQL.
async function cargarReportes() {
  const respuesta = await fetch('/api/reportes'); // El servidor regenera los totales al consultarlos
  const reportes = await respuesta.json();
  pintarCartasReportes(reportes);
}

// Pinta una carta por cada mes generado en reportes_combustible.
function pintarCartasReportes(reportes) {
  cartasReportes.innerHTML = '';

  // Carta general para consultar rangos largos entre meses o durante todo el año.
  const cartaGeneral = document.createElement('button');
  cartaGeneral.type = 'button';
  cartaGeneral.className = 'carta-reporte carta-reporte-general';
  cartaGeneral.innerHTML = `
    <span class="carta-reporte-icono" aria-hidden="true">📅</span>
    <div class="carta-reporte-cuerpo">
      <strong>Reporte general anual</strong>
      <span>Consulta reportes continuos:</span>
      <span>reporte de máquinas y/o M1/M2</span>
    </div>
    <em class="estado-general">General</em>
    <i class="carta-reporte-flecha" aria-hidden="true">›</i>
  `;

  // La carta general abre el detalle en modo "general" (rango libre de fechas).
  cartaGeneral.addEventListener('click', () => {
    window.location.href = 'reporte-detalle?tipo=general';
  });

  cartasReportes.appendChild(cartaGeneral);

  // Una carta por mes con su rango, fecha de cierre, totales y estado.
  reportes.forEach((reporte) => {
    const carta = document.createElement('button');
    carta.type = 'button';
    carta.className = 'carta-reporte';
    // El estado ('abierto' o 'cerrado') pinta la etiqueta: naranja o verde.
    const estado = String(reporte.estado || '').toLowerCase();
    carta.innerHTML = `
      <span class="carta-reporte-icono" aria-hidden="true">📅</span>
      <div class="carta-reporte-cuerpo">
        <strong>${nombresMeses[reporte.mes - 1]} ${reporte.anio}</strong>
        <span>${reporte.fechaInicio} hasta ${reporte.fechaFin}</span>
        <span><b>Cierre:</b> ${reporte.fechaCierre}</span>
        <span><b>${reporte.totalRegistros} registros</b> | <b>${Number(reporte.totalGalones || 0).toFixed(2)} galones</b></span>
      </div>
      <em class="estado-${escapeHtml(estado)}">${escapeHtml(estado)}</em>
      <i class="carta-reporte-flecha" aria-hidden="true">›</i>
    `;

    // El año y el mes viajan por la URL hacia la pantalla de detalle.
    carta.addEventListener('click', () => {
      window.location.href = `reporte-detalle?anio=${reporte.anio}&mes=${reporte.mes}`;
    });
    cartasReportes.appendChild(carta);
  });
}

botonActualizarReportes.addEventListener('click', cargarReportes);
cargarReportes(); // Carga inicial

// Gráfica de barras con los galones despachados en cada uno de los últimos
// 7 días (todas las máquinas). Solo se piden los registros de esos 7 días.
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
async function cargarConsumoSemanaReportes() {
  const grafica = document.getElementById('grafica-consumo-reportes');
  const vacio = document.getElementById('grafica-consumo-reportes-vacia');
  const totalTexto = document.getElementById('rp-total-semana');
  if (!grafica) return;

  // Los últimos 7 días, del más antiguo a hoy.
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    dias.push(fecha);
  }
  const fechas = dias.map((fecha) => fechaLocalISO(fecha));

  try {
    const respuesta = await fetch(
      `/api/reportes-general/registros?fechaInicio=${fechas[0]}&fechaFin=${fechas[6]}`,
      { cache: 'no-store' }
    );
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    // La respuesta es { suministros, jornadas, conciliacion }: se suman los suministros.
    const { suministros = [] } = await respuesta.json();

    // Galones por día (sin contar los cierres de día).
    const totalesPorDia = fechas.map((fecha) =>
      suministros
        .filter((r) => String(r.fecha || '').slice(0, 10) === fecha && !Number(r.cierreDia))
        .reduce((total, r) => total + Number(r.cantidad || 0), 0)
    );
    const totalSemana = totalesPorDia.reduce((a, b) => a + b, 0);

    // Sin datos: se oculta la gráfica y se muestra el aviso.
    grafica.hidden = totalSemana <= 0;
    if (vacio) vacio.hidden = totalSemana > 0;
    if (totalTexto) totalTexto.textContent = totalSemana > 0 ? `${Math.round(totalSemana).toLocaleString('es-CO')} gal en la semana` : '';
    if (totalSemana <= 0) return;

    // Una columna por día: valor encima, barra con altura proporcional y el día abajo.
    const maximo = Math.max(...totalesPorDia, 1); // El mayor llega arriba
    grafica.innerHTML = totalesPorDia
      .map((valor, i) => {
        const dia = `${DIAS_CORTOS[dias[i].getDay()]} ${String(dias[i].getDate()).padStart(2, '0')}`;
        const esHoy = i === 6;
        return `
        <div class="rp-columna${esHoy ? ' rp-hoy' : ''}" title="${dia}: ${valor.toFixed(1)} gal">
          <span class="rp-riel">
            <span class="rp-barra" style="height:${Math.max(valor > 0 ? 3 : 0, (valor / maximo) * 100)}%">
              <b class="rp-valor">${valor > 0 ? Math.round(valor).toLocaleString('es-CO') : '0'}</b>
            </span>
          </span>
          <span class="rp-dia">${esHoy ? 'Hoy' : dia}</span>
        </div>`;
      })
      .join('');
  } catch (error) {
    grafica.hidden = true;
    if (vacio) {
      vacio.textContent = 'No se pudo cargar el consumo de los últimos 7 días.';
      vacio.hidden = false;
    }
    console.warn('No se pudo cargar el consumo de los últimos 7 días', error);
  }
}

cargarConsumoSemanaReportes();


// Ranking de las máquinas con mayor consumo del año, con barra comparativa,
// promedio, máximo y capacidad del tanque. Se muestran las 8 primeras.
async function cargarAnaliticaMaquinas(){
  if(!analiticaMaquinas)return;
  try{
    const r=await fetch('/api/analitica/maquinas',{cache:'no-store'});
    if(!r.ok)throw new Error('No se pudo cargar el análisis.');
    const datos=await r.json();
    analiticaMaquinas.innerHTML='';
    if(!datos.length){analiticaMaquinas.innerHTML='<div class="estado-vacio-selector">No hay suficientes registros para mostrar análisis.</div>';return;}
    // El tanque móvil se quita ANTES de numerar y recortar: así el ranking va
    // de #1 a #8 sin huecos y siempre se ven 8 máquinas.
    const maquinas=datos.filter(x=>!x.esTanqueMovil&&!/^TANQUE M[OÓ][VB]IL/i.test(String(x.maquina||'')));
    if(!maquinas.length){analiticaMaquinas.innerHTML='<div class="estado-vacio-selector">No hay suficientes registros para mostrar análisis.</div>';return;}
    const maxTotal=Math.max(...maquinas.map(x=>Number(x.totalGalones)||0),1); // Referencia del 100% de la barra
    // Horómetro de la máquina en el año: lecturas, horas trabajadas y galones por hora.
    const fmt=(n,d=1)=>Number(n).toLocaleString('es-CO',{minimumFractionDigits:d,maximumFractionDigits:d});
    // Vehículos por kilometraje (unidad 'km'): los mismos campos traen km y gal/km.
    const metricasHorometro=(x)=>{
      const km=x.unidad==='km';
      const lectura=km?'Kilometraje':'Horómetro';
      if(x.sinHorometro)return '<span>Horómetro <strong>No aplica</strong></span>';
      if(x.horometroInicial===null||x.horometroInicial===undefined)return `<span>${lectura} <strong>Sin lecturas</strong></span>`;
      const lecturas=`<span>${lectura} <strong>${fmt(x.horometroInicial)} → ${fmt(x.horometroFinal)}</strong></span>`;
      if(x.horasTrabajadas===null||x.horasTrabajadas===undefined)return `${lecturas}<span>${km?'Km recorridos':'Horas trabajadas'} <strong>— (1 lectura)</strong></span>`;
      // Tramos recortados a 24 h por día (o con horómetro que bajó): se avisa, pero el cálculo sigue.
      const avisos=(x.tramosAjustados||0)+(x.tramosQueRetroceden||0);
      const aviso=avisos?`<span class="metrica-revisar" title="La lectura marcó más de lo posible por día (24 h o 1.000 km), o bajó, en ${avisos} tramo(s): se usó el tope. Revisa esas lecturas en el reporte de horómetros.">⚠ <strong>${avisos} tramo(s) ajustado(s)</strong></span>`:'';
      return `${lecturas}<span>${km?'Km recorridos':'Horas trabajadas'} <strong>${fmt(x.horasTrabajadas)} ${km?'km':'h'}</strong></span><span>${km?'Gal/km':'Gal/hora'} <strong>${x.galonesPorHora===null?'—':fmt(x.galonesPorHora,km?3:2)}</strong></span>${aviso}`;
    };
    maquinas.slice(0,8).forEach((x,i)=>{
      const card=document.createElement('article');
      // Si el consumo PROMEDIO ya llega al 85% de la capacidad del tanque, la
      // tarjeta se marca en modo advertencia (posible consumo anómalo).
      const variacion=x.capacidadGalones>0?(Number(x.promedioGalones)/Number(x.capacidadGalones))*100:0;
      const estado=variacion>=85?'advertencia':'normal';
      // El tipo de máquina se deduce de la primera palabra de la descripción.
      const tipoMaquina=String(x.descripcion||'').trim().split(/\s+/)[0]||'';
      const tipoEtiqueta=tipoMaquina?tipoMaquina.charAt(0).toUpperCase()+tipoMaquina.slice(1).toLowerCase():'';
      card.className=`analitica-maquina-card ${estado}`;
      // Ícono de la máquina (🚚 si va por kilometraje) con su puesto en el ranking.
      const icono=x.unidad==='km'?'🚚':'🚜';
      card.innerHTML=`<div class="analitica-card-top"><span class="icono-analitica" aria-hidden="true">${icono}<i class="ranking-analitica">#${i+1}</i></span><div><strong>${escapeHtml(x.maquina||'Sin máquina')}</strong><small>${x.registros} registros${tipoEtiqueta?` · <span class="badge-tipo-maquina">${escapeHtml(tipoEtiqueta)}</span>`:''}</small></div><b>${Number(x.totalGalones||0).toFixed(2)} GAL</b></div><div class="barra-analitica"><span style="width:${Math.min(100,Number(x.totalGalones||0)/maxTotal*100)}%"></span></div><div class="metricas-principales"><span><i aria-hidden="true">💧</i><small>Promedio</small><strong class="destacado">${Number(x.promedioGalones||0).toFixed(2)} GAL</strong></span><span><i aria-hidden="true">⏱️</i><small>Máximo</small><strong>${Number(x.maximoGalones||0).toFixed(2)} GAL</strong></span><span><i aria-hidden="true">⛽</i><small>Tanque</small><strong>${x.capacidadGalones?`${Number(x.capacidadGalones).toFixed(2)} GAL`:'—'}</strong></span></div><div class="metricas-analitica metricas-horometro">${metricasHorometro(x)}</div>`;
      analiticaMaquinas.appendChild(card);
    });
  }catch(e){analiticaMaquinas.innerHTML='<div class="estado-vacio-selector">No se pudo cargar el análisis. Verifica la conexión con el servidor.</div>';}
}

botonActualizarAnalitica?.addEventListener('click',cargarAnaliticaMaquinas);
cargarAnaliticaMaquinas();
