// ui.js — modales, formularios declarativos, toasts y confirmaciones
import { esc } from './util.js';

const modalRoot = () => document.getElementById('modal-root');

export function toast(msg, tipo = 'success') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast toast-' + tipo;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3200);
  setTimeout(() => el.remove(), 3700);
}

export function closeModal() {
  const back = modalRoot().querySelector('.modal-back');
  if (back) back.remove();
}

// Modal genérico con HTML libre. Devuelve el elemento .modal.
export function openModal({ title, bodyHTML, lg = false }) {
  closeModal();
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal${lg ? ' modal-lg' : ''}">
      <div class="modal-header">
        <h2>${title}</h2>
        <button class="modal-close" type="button">✕</button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
    </div>`;
  back.addEventListener('click', e => { if (e.target === back) closeModal(); });
  back.querySelector('.modal-close').addEventListener('click', closeModal);
  modalRoot().appendChild(back);
  return back.querySelector('.modal');
}

export function confirmar(msg, { peligro = false, okLabel = 'Sí, continuar' } = {}) {
  return new Promise(res => {
    const modal = openModal({
      title: peligro ? '⚠️ Confirmar' : '¿Confirmar?',
      bodyHTML: `
        <p style="font-size:15px; line-height:1.5;">${msg}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-r="no">Cancelar</button>
          <button class="btn ${peligro ? 'btn-danger' : 'btn-primary'}" data-r="si">${esc(okLabel)}</button>
        </div>`,
    });
    modal.querySelector('[data-r="no"]').onclick = () => { closeModal(); res(false); };
    modal.querySelector('[data-r="si"]').onclick = () => { closeModal(); res(true); };
  });
}

/*
 * Formulario declarativo.
 * fields: [{ name, label, type: 'text'|'number'|'date'|'select'|'textarea',
 *            options: ['A','B'] | [{value,label}], value, required, help,
 *            step, placeholder, readonly, half (media columna) }]
 * onSubmit(values) puede devolver Promise; si lanza/rechaza, el modal sigue abierto.
 */
export function formModal({ title, fields, submitLabel = 'Guardar', onSubmit, afterRender }) {
  const fhtml = fields.map(f => {
    const req = f.required ? ' <span class="req">*</span>' : '';
    let input;
    const common = `name="${esc(f.name)}" id="ff-${esc(f.name)}" ${f.required ? 'required' : ''} ${f.readonly ? 'readonly' : ''}`;
    if (f.type === 'select') {
      const opts = (f.options || []).map(o => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        const sel = String(f.value ?? '') === String(v) ? ' selected' : '';
        return `<option value="${esc(v)}"${sel}>${esc(l)}</option>`;
      }).join('');
      input = `<select ${common}>${opts}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea ${common} rows="2" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`;
    } else {
      input = `<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}"
               placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''}
               ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
    }
    return `<div class="f-row" ${f.half ? 'data-half' : ''}>
      <label for="ff-${esc(f.name)}">${esc(f.label)}${req}</label>
      ${input}
      ${f.help ? `<div class="f-help">${esc(f.help)}</div>` : ''}
    </div>`;
  }).join('');

  const modal = openModal({
    title,
    bodyHTML: `
      <form id="fm">
        <div class="f-grid-auto">${fhtml}</div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" data-r="cancel">Cancelar</button>
          <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
        </div>
      </form>`,
  });

  // Campos "half" se agrupan en parejas de dos columnas
  const cont = modal.querySelector('.f-grid-auto');
  const rows = [...cont.children];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].hasAttribute('data-half') && rows[i + 1] && rows[i + 1].hasAttribute('data-half')) {
      const g = document.createElement('div');
      g.className = 'f-grid';
      cont.insertBefore(g, rows[i]);
      g.appendChild(rows[i]); g.appendChild(rows[i + 1]);
      i++;
    }
  }

  const form = modal.querySelector('#fm');
  modal.querySelector('[data-r="cancel"]').onclick = closeModal;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const el = form.querySelector(`[name="${f.name}"]`);
      values[f.name] = el ? el.value.trim() : '';
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await onSubmit(values, form);
      closeModal();
    } catch (err) {
      toast(err.message || String(err), 'error');
      btn.disabled = false;
    }
  });
  if (afterRender) afterRender(form);
  const first = form.querySelector('input:not([readonly]), select, textarea');
  if (first) first.focus();
  return modal;
}

// Tabla HTML a partir de columnas y filas.
// columns: [{ key, label, num, render(fila) }] · rowAttr(fila) para atributos del <tr>
export function tablaHTML({ columns, rows, rowAttr, emptyMsg = 'No hay registros.' }) {
  if (!rows.length) return `<div class="empty-note" style="padding:18px;">${esc(emptyMsg)}</div>`;
  const head = columns.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map(r => {
    const tds = columns.map(c => {
      const v = c.render ? c.render(r) : esc(r[c.key] ?? '');
      return `<td${c.num ? ' class="num"' : ''}>${v === '' || v == null ? '<span class="muted">—</span>' : v}</td>`;
    }).join('');
    return `<tr ${rowAttr ? rowAttr(r) : ''}>${tds}</tr>`;
  }).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function badge(texto) {
  const t = String(texto || '').trim();
  if (!t) return '<span class="muted">—</span>';
  const cls = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return `<span class="badge badge-${cls}">${esc(t)}</span>`;
}
