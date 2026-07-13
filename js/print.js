// print.js — informes en PDF usando el diálogo de impresión del navegador
// (en el computador: "Guardar como PDF"; en el celular: "Guardar como PDF" o imprimir)
import { esc, fmtFecha, hoyISO, diasEntre, mesLabel } from './util.js';
import { kpisHato, alertas, nacimientosPorMes, geneticasHato } from './logic.js';
import { columnChart, hbarChart } from './charts.js';

// Llena #print-root, ajusta el título (nombre sugerido del PDF) y abre el diálogo.
export function imprimir(tituloArchivo, titulo, bodyHTML) {
  const root = document.getElementById('print-root');
  root.innerHTML = `
    <div class="print-head">
      <div>
        <div class="print-finca">🐄 Ganadería La Piedad</div>
        <h1>${esc(titulo)}</h1>
      </div>
      <div class="print-fecha">Generado el ${fmtFecha(hoyISO())}</div>
    </div>
    ${bodyHTML}
    <div class="print-foot">Ganadería La Piedad — ${esc(titulo)} — ${fmtFecha(hoyISO())}</div>`;

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

// ── Informe general de la finca (para compartir o archivar) ──────
export function construirInformeGeneral(state) {
  const hato = kpisHato(state);
  const al = alertas(state);
  const activas = state.prenez.filter(p => p.estado === 'PREÑADA')
    .sort((a, b) => (a.fechaProbParto || '').localeCompare(b.fechaProbParto || ''));

  const avisos = [
    ...al.partosVencidos.map(p => `Vaca ${esc(p.chapeta)}: parto previsto el ${fmtFecha(p.fechaProbParto)} (hace ${-p.dias} días) — registrar o revisar`),
    ...al.partosProximos.map(p => `Vaca ${esc(p.chapeta)}: parto probable el ${fmtFecha(p.fechaProbParto)} (${p.dias === 0 ? 'hoy' : 'en ' + p.dias + ' días'})`),
    ...al.serviciosPorConfirmar.map(s => `Vaca ${esc(s.chapeta)}: ${s.tipo === 'TE' ? 'transferencia' : 'inseminación'} del ${fmtFecha(s.fecha)} lista para confirmar`),
  ];

  const nacimientos = nacimientosPorMes(state, 12);

  return `
    <h2>El hato</h2>
    <div class="print-resumen">
      <div><b>${hato.vacasActivas}</b><span>Vacas activas</span></div>
      <div><b>${hato.prenadas}</b><span>Preñadas</span></div>
      <div><b>${hato.ternerosVivos}</b><span>Terneros vivos</span></div>
      <div><b>${hato.totalAnimales}</b><span>Animales en total</span></div>
    </div>

    <h2>Pendientes (${avisos.length})</h2>
    ${avisos.length
      ? `<ul class="print-lista">${avisos.map(a => `<li>${a}</li>`).join('')}</ul>`
      : '<p class="print-nota">Todo al día. ✔</p>'}

    <h2>Preñeces activas (${activas.length})</h2>
    ${activas.length ? tablaPrint([
      { key: 'chapeta', label: 'Vaca' },
      { key: 'fechaPrenez', label: 'Fecha preñez', render: p => fmtFecha(p.fechaPrenez) },
      { key: 'fechaProbParto', label: 'Parto probable', render: p => fmtFecha(p.fechaProbParto) },
      { key: 'faltan', label: 'Faltan', render: p => {
          const d = diasEntre(hoyISO(), p.fechaProbParto);
          return d == null ? '—' : (d < 0 ? `hace ${-d} días` : d + ' días');
        } },
      { key: 'observaciones', label: 'Observaciones' },
    ], activas) : '<p class="print-nota">Ninguna.</p>'}

    <h2>Nacimientos y genética</h2>
    <div class="print-chart">${columnChart(nacimientos.map(m => ({ label: mesLabel(m.key), value: m.value })), { money: false, height: 200 })}</div>
    <div class="print-chart">${hbarChart(geneticasHato(state), { money: false })}</div>`;
}

// ── Hoja de vida imprimible (recibe el mismo HTML de la ficha) ────
export function imprimirFicha(tituloArchivo, titulo, fichaHTML) {
  // los botones de acción no tienen sentido en papel: el CSS de impresión los oculta
  imprimir(tituloArchivo, titulo, `<div class="print-ficha">${fichaHTML}</div>`);
}
