// print.js — informes en PDF usando el diálogo de impresión del navegador
// (en el computador: "Guardar como PDF"; en el celular: "Guardar como PDF" o imprimir)
import { esc, fmtFecha, fmtNum, hoyISO, diasEntre, mesLabel, edadTexto } from './util.js';
import { kpisHato, alertas, nacimientosPorMes, geneticasHato, TIPO_SERVICIO, vacasSinServicio,
         origenDe, ORIGEN_PRENEZ, gdpDe, esToro, montasDeToro } from './logic.js';
import { columnChart, hbarChart } from './charts.js';

// El nombre de la finca sale de la cabecera (que a su vez sale de Ajustes).
const nombreFinca = () => (document.querySelector('.topbar h1')?.textContent || 'Ganadería La Piedad')
  .replace(/^🐄\s*/, '').trim();

// Llena #print-root, ajusta el título (nombre sugerido del PDF) y abre el diálogo.
export function imprimir(tituloArchivo, titulo, bodyHTML, { subtitulo = '' } = {}) {
  const root = document.getElementById('print-root');
  const finca = nombreFinca();
  root.innerHTML = `
    <div class="print-head">
      <div>
        <div class="print-finca">🐄 ${esc(finca)}</div>
        <h1>${esc(titulo)}</h1>
        ${subtitulo ? `<div class="print-sub">${esc(subtitulo)}</div>` : ''}
      </div>
      <div class="print-fecha">Generado el ${fmtFecha(hoyISO())}</div>
    </div>
    ${bodyHTML}
    <div class="print-foot">${esc(finca)} — ${esc(titulo)} — ${fmtFecha(hoyISO())}</div>`;

  const tituloOriginal = document.title;
  document.title = tituloArchivo; // el navegador lo sugiere como nombre del PDF
  const restaurar = () => {
    document.title = tituloOriginal;
    root.innerHTML = '';
    window.removeEventListener('afterprint', restaurar);
  };
  window.addEventListener('afterprint', restaurar);
  window.print();
  // por si el navegador no dispara afterprint (algunos móviles)
  setTimeout(restaurar, 60000);
}

function tablaPrint(columns, rows) {
  const head = columns.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map(r => `<tr>${columns.map(c => {
    const v = c.render ? c.render(r) : esc(r[c.key] ?? '');
    return `<td${c.num ? ' class="num"' : ''}>${v === '' || v == null ? '—' : v}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="print-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const faltan = (fecha) => {
  const d = diasEntre(hoyISO(), fecha);
  return d == null ? '—' : (d < 0 ? `hace ${-d} días` : (d === 0 ? 'hoy' : d + ' días'));
};

// ── Informe general de la finca (para compartir o archivar) ──────
export function construirInformeGeneral(state) {
  const hato = kpisHato(state);
  const al = alertas(state);
  const activas = state.prenez.filter(p => p.estado === 'PREÑADA')
    .sort((a, b) => (a.fechaProbParto || '').localeCompare(b.fechaProbParto || ''));

  const avisos = [
    ...al.partosVencidos.map(p => `Vaca ${esc(p.chapeta)}: parto previsto el ${fmtFecha(p.fechaProbParto)} (hace ${-p.dias} días) — registrar o revisar`),
    ...al.partosProximos.map(p => `Vaca ${esc(p.chapeta)}: parto probable el ${fmtFecha(p.fechaProbParto)} (${p.dias === 0 ? 'hoy' : 'en ' + p.dias + ' días'})`),
    ...al.preparto.map(p => `Vaca ${esc(p.chapeta)}: toca empezar el preparto (pare en ${p.dias} días)`),
    ...al.serviciosPorConfirmar.map(s => `Vaca ${esc(s.chapeta)}: ${TIPO_SERVICIO[s.tipo] || 'servicio'} del ${fmtFecha(s.fecha)} lista para palpar`),
    ...al.reaplicaciones.map(t => `Sanidad: reaplicar ${esc(t.producto)} (${esc(t.aplicadoA)}) ${t.dias < 0 ? 'atrasado ' + (-t.dias) + ' días' : 'en ' + t.dias + ' días'}`),
  ];

  const nacimientos = nacimientosPorMes(state, 12);
  const sinServicio = vacasSinServicio(state);
  const ternerosVivos = state.terneros.filter(t => t.activo)
    .sort((a, b) => (a.fechaNac || '').localeCompare(b.fechaNac || ''));
  const toros = state.vacas.filter(v => esToro(v) && v.estado === 'ACTIVA');
  const sanidad = (state.tratamientos || []).filter(t => t.estado !== 'HECHO' && t.fechaReaplicar);

  return `
    <h2>El hato</h2>
    <div class="print-resumen">
      <div><b>${hato.vacasActivas}</b><span>Vacas activas</span></div>
      <div><b>${hato.prenadas}</b><span>Preñadas</span></div>
      <div><b>${hato.sinServicio}</b><span>Sin servicio</span></div>
      <div><b>${hato.ternerosVivos}</b><span>Terneros vivos</span></div>
      <div><b>${hato.toros}</b><span>Toros</span></div>
      <div><b>${hato.totalAnimales}</b><span>Animales en total</span></div>
    </div>

    <h2>Pendientes (${avisos.length})</h2>
    ${avisos.length
      ? `<ul class="print-lista">${avisos.map(a => `<li>${a}</li>`).join('')}</ul>`
      : '<p class="print-nota">Todo al día. ✔</p>'}

    <h2>Preñeces activas (${activas.length})</h2>
    ${activas.length ? tablaPrint([
      { key: 'chapeta', label: 'Vaca' },
      { key: 'origen', label: 'Origen', render: p => ORIGEN_PRENEZ[origenDe(p)] || 'por confirmar' },
      { key: 'fechaPrenez', label: 'Preñez', render: p => fmtFecha(p.fechaPrenez) },
      { key: 'fechaProbParto', label: 'Parto probable', render: p => fmtFecha(p.fechaProbParto) },
      { key: 'faltan', label: 'Faltan', render: p => faltan(p.fechaProbParto) },
      { key: 'fechaPreparto', label: 'Preparto', render: p => p.fechaPreparto ? fmtFecha(p.fechaPreparto) : '' },
      { key: 'observaciones', label: 'Observaciones' },
    ], activas) : '<p class="print-nota">Ninguna.</p>'}

    <h2>Vacas sin servicio (${sinServicio.length})</h2>
    ${sinServicio.length ? tablaPrint([
      { key: 'chapeta', label: 'Vaca', render: x => esc(x.vaca.chapeta) },
      { key: 'ultimoParto', label: 'Último parto', render: x => fmtFecha(x.vaca.ultimoParto) },
      { key: 'diasVacia', label: 'Días sin servicio', num: true, render: x => String(x.diasVacia) },
      { key: 'criaActual', label: 'Cría actual', render: x => esc(x.vaca.criaActual) },
    ], sinServicio) : '<p class="print-nota">Ninguna: todas están preñadas o en proceso. ✔</p>'}

    <h2>Terneros vivos (${ternerosVivos.length})</h2>
    ${ternerosVivos.length ? tablaPrint([
      { key: 'nombre', label: 'Nombre' },
      { key: 'sexo', label: 'Sexo' },
      { key: 'edad', label: 'Edad', render: t => edadTexto(t.fechaNac) },
      { key: 'codigoMadre', label: 'Madre' },
      { key: 'ultimoPeso', label: 'Último peso', num: true, render: t => t.ultimoPeso ? fmtNum(t.ultimoPeso, 1) + ' kg' : '' },
      { key: 'fechaUltimoPesaje', label: 'Pesado el', render: t => t.fechaUltimoPesaje ? fmtFecha(t.fechaUltimoPesaje) : '' },
      { key: 'gdp', label: 'Ganancia', num: true, render: t => { const g = gdpDe(state, t.nombre); return g != null ? fmtNum(g * 1000, 0) + ' g/día' : ''; } },
    ], ternerosVivos) : '<p class="print-nota">Ninguno.</p>'}

    ${toros.length ? `<h2>Toros (${toros.length})</h2>${tablaPrint([
      { key: 'chapeta', label: 'Nombre' },
      { key: 'genetica', label: 'Raza' },
      { key: 'edad', label: 'Edad', render: t => edadTexto(t.fechaNac) },
      { key: 'montas', label: 'Montas registradas', num: true, render: t => String(montasDeToro(state, t.chapeta).length) },
    ], toros)}` : ''}

    ${sanidad.length ? `<h2>Sanidad: reaplicaciones pendientes (${sanidad.length})</h2>${tablaPrint([
      { key: 'producto', label: 'Producto' },
      { key: 'aplicadoA', label: 'Aplicado a' },
      { key: 'fecha', label: 'Aplicado el', render: t => fmtFecha(t.fecha) },
      { key: 'fechaReaplicar', label: 'Reaplicar el', render: t => fmtFecha(t.fechaReaplicar) },
      { key: 'faltan', label: 'Faltan', render: t => faltan(t.fechaReaplicar) },
    ], sanidad)}` : ''}

    <h2>Nacimientos y genética</h2>
    <div class="print-chart">${columnChart(nacimientos.map(m => ({ label: mesLabel(m.key), value: m.value })), { money: false, height: 200 })}</div>
    <div class="print-chart">${hbarChart(geneticasHato(state), { money: false })}</div>`;
}

// ── Lista de báscula: para llevar al corral el día del pesaje ────
export function construirListaBascula(state) {
  const vivos = state.terneros.filter(t => t.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return `
    <p class="print-nota">Escribe el peso de hoy en la última columna y después regístralo en la app con
      <b>Pesajes → Pesaje masivo</b>.</p>
    ${tablaPrint([
      { key: 'nombre', label: 'Ternero' },
      { key: 'sexo', label: 'Sexo' },
      { key: 'edad', label: 'Edad', render: t => edadTexto(t.fechaNac) },
      { key: 'codigoMadre', label: 'Madre' },
      { key: 'ultimoPeso', label: 'Último peso', num: true, render: t => t.ultimoPeso ? fmtNum(t.ultimoPeso, 1) + ' kg' : '' },
      { key: 'fechaUltimoPesaje', label: 'Pesado el', render: t => t.fechaUltimoPesaje ? fmtFecha(t.fechaUltimoPesaje) : '' },
      { key: '_hoy', label: 'Peso hoy (kg)', render: () => '<span class="print-casilla"></span>' },
    ], vivos)}
    <p class="print-nota" style="margin-top:8px;">Fecha del pesaje: ______ / ______ / ________ &nbsp;&nbsp;&nbsp; Pesó: ____________________</p>`;
}

// ── Lista de vacas (la que se esté viendo, con su filtro) ────────
export function construirListaVacas(state, filas, repro) {
  return tablaPrint([
    { key: 'chapeta', label: 'Chapeta' },
    { key: 'codigo', label: 'Código' },
    { key: 'genetica', label: 'Genética' },
    { key: 'edad', label: 'Edad', render: v => edadTexto(v.fechaNac) },
    { key: 'ultimoParto', label: 'Último parto', render: v => fmtFecha(v.ultimoParto) },
    { key: 'criaActual', label: 'Cría actual' },
    { key: 'repro', label: 'Reproducción', render: v => {
        const r = repro.get(v.chapeta) || {};
        if (r.estado === 'PREÑADA') return 'preñada · parto ' + fmtFecha(v.fechaProbParto);
        if (r.estado === 'ESPERANDO') return `servicio hace ${r.diasServicio} d` + (r.listoParaPalpar ? ' · palpar' : '');
        if (r.estado === 'SIN_SERVICIO') return `${r.diasVacia} días sin servicio`;
        if (r.estado === 'DESCANSO') return `descansando (${r.diasVacia} d)`;
        if (r.estado === 'NOVILLA') return 'novilla';
        return '';
      } },
    { key: 'estado', label: 'Estado' },
  ], filas);
}

// ── Hoja de vida imprimible (recibe el HTML de la ficha, versión completa) ──
export function imprimirFicha(tituloArchivo, titulo, fichaHTML) {
  // los botones de acción no tienen sentido en papel: el CSS de impresión los oculta
  imprimir(tituloArchivo, titulo, `<div class="print-ficha">${fichaHTML}</div>`);
}
