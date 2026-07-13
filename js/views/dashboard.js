// Vista Inicio — el tablero de control del hato
import { fmtFecha, esc, mesLabel } from '../util.js';
import { columnChart, hbarChart, attachTooltips } from '../charts.js';
import { kpisHato, nacimientosPorMes, geneticasHato, alertas } from '../logic.js';
import { imprimir, construirInformeGeneral } from '../print.js';

export function render(el, ctx) {
  const { state } = ctx;
  const hato = kpisHato(state);
  const al = alertas(state);
  const nacimientos = nacimientosPorMes(state, 12);
  const geneticas = geneticasHato(state);

  const nAlertas = al.partosVencidos.length + al.partosProximos.length
    + al.serviciosPorConfirmar.length + al.reaplicaciones.length;

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card clickable" data-nav="vacas">
        <div class="kpi-val">${hato.vacasActivas}</div>
        <div class="kpi-label">🐄 Vacas activas</div>
      </div>
      <div class="kpi-card pink clickable" data-nav="reproduccion">
        <div class="kpi-val">${hato.prenadas}</div>
        <div class="kpi-label">🤰 Preñadas</div>
      </div>
      <div class="kpi-card blue clickable" data-nav="terneros">
        <div class="kpi-val">${hato.ternerosVivos}</div>
        <div class="kpi-label">🐮 Terneros vivos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-val">${hato.totalAnimales}</div>
        <div class="kpi-label">🌳 Animales en total</div>
        <div class="kpi-sub">${hato.vacasVendidas + hato.ternerosVendidos} vendidos histórico</div>
      </div>
    </div>

    <div class="fab-row">
      <button class="btn btn-ghost btn-sm" id="btn-informe">🖨️ Informe general (PDF)</button>
    </div>

    <div class="card">
      <h2>🔔 Para hoy <span class="h2-note">${nAlertas ? nAlertas + ' avisos' : 'todo al día'}</span></h2>
      <div class="alert-list">${renderAlertas(al)}</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <h2>🍼 Nacimientos por mes <span class="h2-note">últimos 12 meses</span></h2>
        ${columnChart(nacimientos.map(m => ({
          label: mesLabel(m.key),
          value: m.value,
          tip: mesLabel(m.key) + ': ' + m.value + ' nacimiento(s)',
        })), { money: false })}
      </div>
      <div class="card">
        <h2>🧬 Genética del hato <span class="h2-note">vacas activas</span></h2>
        ${hbarChart(geneticas, { money: false })}
      </div>
    </div>
  `;

  attachTooltips(el);
  el.querySelector('#btn-informe').onclick = () =>
    imprimir('informe-la-piedad', 'Informe general de la finca', construirInformeGeneral(state));
  el.querySelectorAll('[data-nav]').forEach(k =>
    k.addEventListener('click', () => ctx.nav(k.dataset.nav)));
}

function renderAlertas(al) {
  const items = [];

  for (const p of al.partosVencidos) {
    items.push(alerta('critical', '🐄', `Vaca <b>${esc(p.chapeta)}</b>: el parto estaba previsto para el ${fmtFecha(p.fechaProbParto)}`,
      `hace ${-p.dias} días — regístralo o revisa`));
  }
  for (const p of al.partosProximos) {
    items.push(alerta('pink', '🍼', `Vaca <b>${esc(p.chapeta)}</b>: parto probable el ${fmtFecha(p.fechaProbParto)}`,
      p.dias === 0 ? '¡hoy!' : `en ${p.dias} días`));
  }
  for (const s of al.serviciosPorConfirmar) {
    items.push(alerta('info', '💉', `Vaca <b>${esc(s.chapeta)}</b>: ${s.tipo === 'TE' ? 'transferencia' : 'inseminación'} del ${fmtFecha(s.fecha)} sin confirmar`,
      `hace ${s.dias} días — ya se puede palpar`));
  }
  for (const t of al.reaplicaciones) {
    items.push(alerta(t.dias < 0 ? 'critical' : 'warning', '🩺',
      `Reaplicar <b>${esc(t.producto)}</b> (${esc(t.aplicadoA)})`,
      t.dias < 0 ? `atrasado ${-t.dias} días` : (t.dias === 0 ? '¡hoy!' : `en ${t.dias} días`)));
  }

  if (!items.length) {
    return `<div class="empty-note">✅ No hay pendientes: ni partos cercanos ni servicios sin confirmar.</div>`;
  }
  return items.join('');
}

function alerta(tipo, ico, html, extra) {
  return `<div class="alert-item alert-${tipo}">
    <span class="alert-ico">${ico}</span>
    <span>${html}</span>
    <span class="alert-extra">${esc(extra)}</span>
  </div>`;
}
