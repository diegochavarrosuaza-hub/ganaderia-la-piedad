// Vista Reproducción — servicios (IA/TE), confirmaciones y preñeces activas
import { fmtFecha, esc, diasEntre, hoyISO } from '../util.js';
import { tablaHTML, badge, toast, confirmar } from '../ui.js';
import { kpisReproduccion, confirmarServicio, TIPO_SERVICIO,
         origenDe, ORIGEN_PRENEZ, ajustes } from '../logic.js';
import { formServicio, formPrenez, formParto,
         formEditarPrenez, formEditarServicio } from '../forms.js';
import { abrirFichaVaca } from '../fichas.js';

export function render(el, ctx) {
  const { state } = ctx;
  const k = kpisReproduccion(state);
  const aj = ajustes(state);

  const activas = state.prenez.filter(p => p.estado === 'PREÑADA')
    .sort((a, b) => (a.fechaProbParto || '').localeCompare(b.fechaProbParto || ''));
  const servicios = [...state.servicios].sort((a, b) => {
    if ((a.resultado === 'PENDIENTE') !== (b.resultado === 'PENDIENTE')) {
      return a.resultado === 'PENDIENTE' ? -1 : 1; // pendientes primero
    }
    return (b.fecha || '').localeCompare(a.fecha || '');
  });

  el.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card pink"><div class="kpi-val">${k.prenadas}</div>
        <div class="kpi-label">🤰 Preñadas ahora</div></div>
      <div class="kpi-card yellow"><div class="kpi-val">${k.pendientes}</div>
        <div class="kpi-label">⏳ Servicios por confirmar</div></div>
      ${[['🐂 Éxito monta', k.tasaMN], ['💉 Éxito inseminación', k.tasaIA], ['🔬 Éxito transferencias', k.tasaTE]]
        .map(([label, t]) => `
      <div class="kpi-card blue"><div class="kpi-val">${t ? t.pct + '%' : '—'}</div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-sub">${t ? `de ${t.n} confirmado${t.n === 1 ? '' : 's'}` : 'aún sin confirmaciones'}</div></div>`).join('')}
    </div>

    <div class="fab-row">
      <button class="btn btn-primary" id="btn-ia">💉 Nueva inseminación</button>
      <button class="btn btn-blue" id="btn-te">🔬 Nueva transferencia</button>
      <button class="btn btn-warn" id="btn-mn">🐂 Monta con toro</button>
      <button class="btn btn-pink" id="btn-prenez">🤰 Preñez directa (monta)</button>
    </div>

    <div class="card">
      <h2>🍼 Preñeces activas <span class="h2-note">${activas.length}</span></h2>
      <div class="table-wrap" style="box-shadow:none;">${tablaHTML({
        columns: [
          { key: 'chapeta', label: 'Vaca', render: p => `<b>${esc(p.chapeta)}</b>` },
          { key: 'fechaPrenez', label: 'Preñez', render: p => fmtFecha(p.fechaPrenez) },
          { key: 'fechaProbParto', label: 'Parto probable', render: p => `<b>${fmtFecha(p.fechaProbParto)}</b>` },
          { key: 'dias', label: 'Faltan', render: p => {
              const d = diasEntre(hoyISO(), p.fechaProbParto);
              if (d == null) return '';
              if (d < 0) return `<span class="badge badge-vencido">hace ${-d} días</span>`;
              if (d <= 30) return `<span class="badge badge-prenada">${d} días</span>`;
              return d + ' días';
            } },
          { key: 'origen', label: 'Origen', render: p => {
              const o = origenDe(p);
              return o ? badge(ORIGEN_PRENEZ[o]) : '<span class="muted">por confirmar</span>';
            } },
          { key: 'fechaPreparto', label: 'Preparto', render: p => {
              if (p.fechaPreparto) return '🌾 ' + fmtFecha(p.fechaPreparto);
              const d = diasEntre(hoyISO(), p.fechaProbParto);
              return (d != null && d >= 0 && d <= aj.diasPreparto)
                ? '<span class="badge badge-vencido">falta iniciar</span>' : '';
            } },
          { key: 'observaciones', label: 'Observaciones' },
          { key: '_a', label: '', render: p => `
              <div class="act-cell">
                <button class="btn btn-pink btn-sm" data-parto="${esc(p.chapeta)}">🍼 Parto</button>
                <button class="btn-icon" title="Corregir esta preñez" data-edp="${p.id}">✏️</button>
              </div>` },
        ],
        rows: activas,
        rowAttr: p => `data-vaca="${esc(p.chapeta)}"`,
        emptyMsg: 'No hay preñeces activas en este momento.',
      })}</div>
    </div>

    <div class="card">
      <h2>💉 Servicios <span class="h2-note">los pendientes van primero</span></h2>
      <div class="table-wrap" style="box-shadow:none;">${tablaHTML({
        columns: [
          { key: 'tipo', label: 'Tipo', render: s => badge(s.tipo) },
          { key: 'chapeta', label: 'Vaca', render: s => `<b>${esc(s.chapeta)}</b>` },
          { key: 'fecha', label: 'Fecha', render: s => fmtFecha(s.fecha) },
          { key: 'material', label: 'Toro / semen / embrión', render: s => esc([s.raza, s.material].filter(Boolean).join(' · ')) },
          { key: 'resultado', label: 'Resultado', render: s => badge(s.resultado) },
          { key: 'espera', label: '', render: s => {
              if (s.resultado === 'CERRADO') return `<span class="muted">${esc(s.cierre || '')}</span>`;
              if (s.resultado !== 'PENDIENTE') return s.fechaConfirmacion ? '<span class="muted">conf. ' + fmtFecha(s.fechaConfirmacion) + '</span>' : '';
              const d = diasEntre(s.fecha, hoyISO());
              return d != null && d >= aj.diasPalpar
                ? '<span class="badge badge-vigente">listo para palpar</span>'
                : `<span class="muted">${d != null ? aj.diasPalpar - d + ' días para palpar' : ''}</span>`;
            } },
          { key: '_a', label: '', render: s => `
              <div class="act-cell">
                ${s.resultado === 'PENDIENTE' ? `
                  <button class="btn btn-pink btn-sm" data-conf="PREÑADA" data-id="${s.id}">✅ Preñada</button>
                  <button class="btn btn-ghost btn-sm" data-conf="VACÍA" data-id="${s.id}">❌ Vacía</button>` : ''}
                <button class="btn-icon" title="Corregir este servicio" data-eds="${s.id}">✏️</button>
              </div>` },
        ],
        rows: servicios,
        rowAttr: s => `class="row-click" data-vaca="${esc(s.chapeta)}"`,
        emptyMsg: 'No hay servicios registrados.',
      })}</div>
    </div>
  `;

  el.querySelector('#btn-ia').onclick = () => formServicio('IA', ctx);
  el.querySelector('#btn-te').onclick = () => formServicio('TE', ctx);
  el.querySelector('#btn-mn').onclick = () => formServicio('MN', ctx);
  el.querySelector('#btn-prenez').onclick = () => formPrenez('', ctx);

  el.querySelectorAll('[data-edp]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const p = ctx.state.prenez.find(x => x.id === Number(b.dataset.edp));
    if (p) formEditarPrenez(p, ctx);
  }));
  el.querySelectorAll('[data-eds]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const s = ctx.state.servicios.find(x => x.id === Number(b.dataset.eds));
    if (s) formEditarServicio(s, ctx);
  }));
  el.querySelectorAll('[data-parto]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); formParto(b.dataset.parto, ctx); }));
  el.querySelectorAll('tr[data-vaca]').forEach(tr =>
    tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      abrirFichaVaca(tr.dataset.vaca, ctx);
    }));

  el.querySelectorAll('[data-conf]').forEach(b => b.addEventListener('click', async () => {
    const s = ctx.state.servicios.find(x => x.id === Number(b.dataset.id));
    if (!s) return;
    const resultado = b.dataset.conf;
    const etiqueta = TIPO_SERVICIO[s.tipo] || 'servicio';
    const msg = resultado === 'PREÑADA'
      ? `¿Confirmar que la vaca <b>${esc(s.chapeta)}</b> quedó <b>preñada</b> por la ${etiqueta} del ${fmtFecha(s.fecha)}? Se creará la preñez y se calculará la fecha de parto.`
      : `¿Marcar la ${etiqueta} de la vaca <b>${esc(s.chapeta)}</b> como <b>vacía</b> (no funcionó)?`;
    if (!(await confirmar(msg, { okLabel: resultado === 'PREÑADA' ? 'Sí, preñada' : 'Sí, vacía' }))) return;
    try {
      const r = await confirmarServicio(s, resultado);
      toast(resultado === 'PREÑADA'
        ? `Vaca ${s.chapeta} preñada 🎉 Parto esperado: ${fmtFecha(r.fechaProbParto)}.`
        : `Servicio de la vaca ${s.chapeta} marcado como vacío.`);
    } catch (err) {
      toast(err.message, 'error');
    }
    ctx.refresh();
  }));
}

