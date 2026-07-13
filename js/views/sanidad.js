// Vista Sanidad — tratamientos y recordatorios de reaplicación
import * as db from '../db.js';
import { fmtFecha, esc, hoyISO, diasEntre } from '../util.js';
import { tablaHTML, badge, toast, confirmar, formModal } from '../ui.js';
import { registrarTratamiento, reaplicarTratamiento } from '../logic.js';

export function render(el, ctx) {
  const { state } = ctx;
  const filas = [...(state.tratamientos || [])].sort((a, b) =>
    (b.fecha || '').localeCompare(a.fecha || '') || (b.id - a.id));

  el.innerHTML = `
    <div class="hint">💡 <span>Anota aquí las vacunas y tratamientos. Si escribes “reaplicar en X días”,
      la app te <b>avisa en el tablero</b> cuando toque volver a aplicar.</span></div>
    <div class="fab-row">
      <button class="btn btn-primary" id="btn-nuevo">➕ Registrar tratamiento</button>
    </div>
    <div class="table-wrap">${tablaHTML({
      columns: [
        { key: 'fecha', label: 'Fecha', render: t => fmtFecha(t.fecha) },
        { key: 'producto', label: 'Producto / vacuna', render: t => `<b>${esc(t.producto)}</b>` },
        { key: 'aplicadoA', label: 'Aplicado a' },
        { key: 'reaplicar', label: 'Reaplicar', render: t => {
            if (!t.fechaReaplicar) return '<span class="muted">no</span>';
            if (t.estado === 'HECHO') return `<span class="muted">${fmtFecha(t.fechaReaplicar)} ✓</span>`;
            const d = diasEntre(hoyISO(), t.fechaReaplicar);
            const cls = d < 0 ? 'badge-vencido' : (d <= 15 ? 'badge-vigente' : '');
            const txt = d < 0 ? `atrasado ${-d} d` : (d === 0 ? 'hoy' : `en ${d} d`);
            return `${fmtFecha(t.fechaReaplicar)} <span class="badge ${cls}">${txt}</span>`;
          } },
        { key: 'estado', label: 'Estado', render: t => badge(t.estado === 'HECHO' ? 'REAPLICADO' : (t.fechaReaplicar ? 'PENDIENTE' : 'VIGENTE')) },
        { key: '_a', label: '', render: t => (t.estado !== 'HECHO' && t.fechaReaplicar)
            ? `<button class="btn btn-primary btn-sm" data-reap="${t.id}">✅ Ya reapliqué</button>` : '' },
      ],
      rows: filas,
      emptyMsg: 'Aún no hay tratamientos registrados.',
    })}</div>
  `;

  el.querySelector('#btn-nuevo').onclick = () => formNuevo(ctx);
  el.querySelectorAll('[data-reap]').forEach(b => b.addEventListener('click', async () => {
    const t = ctx.state.tratamientos.find(x => x.id === Number(b.dataset.reap));
    if (!t) return;
    if (!(await confirmar(`¿Registrar que <b>${esc(t.producto)}</b> ya se reaplicó hoy? Se agenda el siguiente ciclo en ${t.diasReaplicar} días.`, { okLabel: 'Sí, reapliqué' }))) return;
    await reaplicarTratamiento(t);
    toast('Reaplicación registrada. Próximo ciclo agendado.');
    ctx.refresh();
  }));
}

function formNuevo(ctx) {
  formModal({
    title: '🩺 Registrar tratamiento',
    submitLabel: 'Registrar',
    fields: [
      { name: 'fecha', label: 'Fecha de aplicación', type: 'date', required: true, value: hoyISO(), half: true },
      { name: 'diasReaplicar', label: 'Reaplicar en (días)', type: 'number', half: true,
        placeholder: '45', help: 'Déjalo vacío si no se reaplica.' },
      { name: 'producto', label: 'Producto / vacuna', required: true, placeholder: 'Hemopar, Impulsor FE…' },
      { name: 'aplicadoA', label: 'Aplicado a', value: 'Toda la lechería',
        help: 'Un grupo (“Toda la lechería”) o una vaca por chapeta.' },
      { name: 'notas', label: 'Notas', type: 'textarea' },
    ],
    async onSubmit(v) {
      await registrarTratamiento(v);
      toast('Tratamiento registrado.');
      ctx.refresh();
    },
  });
}
