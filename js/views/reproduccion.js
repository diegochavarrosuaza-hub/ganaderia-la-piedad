// Vista Reproducción — servicios (IA/TE), confirmaciones y preñeces activas
import { fmtFecha, esc, diasEntre, hoyISO } from '../util.js';
import { tablaHTML, badge, toast, confirmar } from '../ui.js';
import { kpisReproduccion, confirmarServicio } from '../logic.js';
import { formServicio, formPrenez, formParto } from '../forms.js';
import { abrirFichaVaca } from '../fichas.js';

export function render(el, ctx) {
  const { state } = ctx;
  const k = kpisReproduccion(state);

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
      <div class="kpi-card blue"><div class="kpi-val">${k.tasaIA != null ? k.tasaIA + '%' : '—'}</div>
        <div class="kpi-label">💉 Éxito inseminación</div>
        <div class="kpi-sub">${k.tasaIA == null ? 'aún sin confirmaciones' : 'de los servicios confirmados'}</div></div>
      <div class="kpi-card blue"><div class="kpi-val">${k.tasaTE != null ? k.tasaTE + '%' : '—'}</div>
        <div class="kpi-label">🔬 Éxito transferencias</div>
        <div class="kpi-sub">${k.tasaTE == null ? 'aún sin confirmaciones' : 'de los servicios confirmados'}</div></div>
    </div>

    <div class="fab-row">
      <button class="btn btn-primary" id="btn-ia">💉 Nueva inseminación</button>
      <button class="btn btn-blue" id="btn-te">🔬 Nueva transferencia</button>
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
          { key: 'observaciones', label: 'Observaciones' },
          { key: '_a', label: '', render: p =>
              `<button class="btn btn-pink btn-sm" data-parto="${esc(p.chapeta)}">🍼 Registrar parto</button>` },
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
          { key: 'material', label: 'Semen / Embrión', render: s => esc([s.material, s.raza].filter(Boolean).join(' · ')) },
          { key: 'resultado', label: 'Resultado', render: s => badge(s.resultado) },
          { key: 'espera', label: '', render: s => {
              if (s.resultado !== 'PENDIENTE') return s.fechaConfirmacion ? '<span class="muted">conf. ' + fmtFecha(s.fechaConfirmacion) + '</span>' : '';
              const d = diasEntre(s.fecha, hoyISO());
              return d != null && d >= 45
                ? '<span class="badge badge-vigente">listo para palpar</span>'
                : `<span class="muted">${d != null ? 45 - d + ' días para palpar' : ''}</span>`;
            } },
          { key: '_a', label: '', render: s => s.resultado === 'PENDIENTE' ? `
              <div class="act-cell">
                <button class="btn btn-pink btn-sm" data-conf="PREÑADA" data-id="${s.id}">✅ Preñada</button>
                <button class="btn btn-ghost btn-sm" data-conf="VACÍA" data-id="${s.id}">❌ Vacía</button>
              </div>` : '' },
        ],
        rows: servicios,
        emptyMsg: 'No hay servicios registrados.',
      })}</div>
    </div>
  `;

  el.querySelector('#btn-ia').onclick = () => formServicio('IA', ctx);
  el.querySelector('#btn-te').onclick = () => formServicio('TE', ctx);
  el.querySelector('#btn-prenez').onclick = () => {
    const activasV = ctx.state.vacas.filter(v => v.estado === 'ACTIVA');
    if (!activasV.length) return toast('No hay vacas activas.', 'error');
    formPrenezSelector(ctx);
  };
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
    const etiqueta = s.tipo === 'TE' ? 'transferencia' : 'inseminación';
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

// Selector rápido de vaca para preñez directa
function formPrenezSelector(ctx) {
  const sinPrenez = ctx.state.vacas.filter(v => v.estado === 'ACTIVA'
    && !ctx.state.prenez.some(p => p.chapeta === v.chapeta && p.estado === 'PREÑADA'));
  if (!sinPrenez.length) return toast('Todas las vacas activas ya tienen preñez registrada.', 'info');
  // Reutilizamos formPrenez pidiendo primero la chapeta
  import('../ui.js').then(({ formModal }) => {
    formModal({
      title: '🤰 Registrar preñez directa',
      fields: [
        { name: 'chapeta', label: 'Vaca (chapeta)', type: 'select', required: true,
          options: sinPrenez.map(v => v.chapeta) },
        { name: 'fechaPrenez', label: 'Fecha de preñez', type: 'date', required: true, value: hoyISO() },
        { name: 'observaciones', label: 'Observaciones', placeholder: 'Monta natural, toro…' },
      ],
      async onSubmit(v) {
        const { crearPrenez } = await import('../logic.js');
        const fpp = await crearPrenez({ chapeta: v.chapeta, fechaPrenez: v.fechaPrenez, observaciones: v.observaciones });
        toast(`Preñez registrada. Parto esperado: ${fmtFecha(fpp)}.`);
        ctx.refresh();
      },
    });
  });
}
