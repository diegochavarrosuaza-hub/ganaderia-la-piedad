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
 * Pregunta con varias salidas, para cuando "sí / no" no alcanza ("¿qué pasó?").
 * opciones: [{ valor, texto, detalle, peligro }]. Devuelve el valor elegido,
 * o null si se cancela o se cierra la ventana.
 */
export function preguntar({ titulo = '¿Qué pasó?', mensaje = '', opciones = [] }) {
  return new Promise(res => {
    let listo = false;
    const fin = v => { if (listo) return; listo = true; closeModal(); res(v); };
    const modal = openModal({
      title: titulo,
      bodyHTML: `
        <div class="pregunta-msg">${mensaje}</div>
        <div class="pregunta-opciones">${opciones.map((o, i) => `
          <button type="button" class="btn ${o.peligro ? 'btn-danger' : (i === 0 ? 'btn-primary' : 'btn-ghost')} pregunta-op" data-i="${i}">
            <span>${esc(o.texto)}</span>${o.detalle ? `<small>${esc(o.detalle)}</small>` : ''}
          </button>`).join('')}
        </div>
        <div class="modal-actions"><button type="button" class="btn btn-ghost" data-r="no">Cancelar</button></div>`,
    });
    modal.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => fin(opciones[Number(b.dataset.i)].valor); });
    modal.querySelector('[data-r="no"]').onclick = () => fin(null);
    modal.querySelector('.modal-close').addEventListener('click', () => fin(null));
    modal.parentElement.addEventListener('click', e => { if (e.target === modal.parentElement) fin(null); });
  });
}

/*
 * Formulario declarativo.
 * fields: [{ name, label, type: 'text'|'number'|'date'|'select'|'textarea',
 *            options: ['A','B'] | [{value,label}], value, required, help,
 *            step, placeholder, readonly, half (media columna) }]
 * onSubmit(values) puede devolver Promise; si lanza/rechaza, el modal sigue abierto.
 * onDelete: { mensaje, label, run() } pinta un botón 🗑️ que pide confirmación
 *           antes de borrar. Sirve para corregir cualquier registro mal metido.
 */
export function formModal({ title, fields, submitLabel = 'Guardar', onSubmit, afterRender, onDelete }) {
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
    } else if (f.type === 'checks' && f.grupos) {
      // Selector de animales por grupos (vacas, toros, terneros), con filtro y
      // "Todos / Ninguno" por grupo. Para marcar a quiénes se aplicó algo.
      const marcados = new Set((Array.isArray(f.value) ? f.value : []).map(String));
      const chip = o => `<label class="f-check" data-texto="${esc(sinTildesUI(o.label))}"><input type="checkbox" name="${esc(f.name)}" value="${esc(o.value)}"${marcados.has(String(o.value)) ? ' checked' : ''}><span>${esc(o.label)}</span></label>`;
      input = `<div class="sel-animales">
        <input type="search" class="search sel-filtro" placeholder="🔍 Filtrar por número o nombre…" autocomplete="off">
        ${f.grupos.filter(g => g.opciones.length).map(g => `<div class="sel-grupo">
          <div class="sel-grupo-head"><b>${esc(g.titulo)}</b><span class="sel-cuenta muted"></span>
            <button type="button" class="btn btn-ghost btn-sm" data-todos>Todos</button>
            <button type="button" class="btn btn-ghost btn-sm" data-ninguno>Ninguno</button></div>
          <div class="f-checks">${g.opciones.map(chip).join('')}</div>
        </div>`).join('')}
      </div>`;
    } else if (f.type === 'checks') {
      // Varias casillas grandes: en el celular es mucho mejor que un
      // <select multiple>, que nadie sabe usar.
      const marcados = new Set(Array.isArray(f.value) ? f.value.map(String) : []);
      input = `<div class="f-checks">${(f.options || []).map(o => {
        const v = typeof o === 'object' ? o.value : o;
        const l = typeof o === 'object' ? o.label : o;
        return `<label class="f-check"><input type="checkbox" name="${esc(f.name)}" value="${esc(v)}"${marcados.has(String(v)) ? ' checked' : ''}><span>${esc(l)}</span></label>`;
      }).join('')}</div>`;
    } else if (f.type === 'textarea') {
      input = `<textarea ${common} rows="2" placeholder="${esc(f.placeholder || '')}">${esc(f.value ?? '')}</textarea>`;
    } else {
      input = `<input type="${f.type || 'text'}" ${common} value="${esc(f.value ?? '')}"
               placeholder="${esc(f.placeholder || '')}" ${f.step ? `step="${f.step}"` : ''}
               ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
    }
    return `<div class="f-row" ${f.half ? 'data-half' : ''} ${f.grupo ? `data-grupo="${esc(f.grupo)}"` : ''}>
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
          ${onDelete ? `<button type="button" class="btn btn-danger" data-r="del">🗑️ Eliminar</button>
                        <span class="ma-sep"></span>` : ''}
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

  const btnDel = modal.querySelector('[data-r="del"]');
  if (btnDel) btnDel.onclick = async () => {
    // confirmar() reemplaza este modal; si dice que sí, ya no hay a qué volver.
    if (!(await confirmar(onDelete.mensaje, { peligro: true, okLabel: onDelete.label || 'Sí, eliminar' }))) return;
    try { await onDelete.run(); } catch (err) { toast(err.message || String(err), 'error'); }
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      if (f.type === 'checks') {
        values[f.name] = [...form.querySelectorAll(`input[name="${f.name}"]:checked`)].map(e => e.value);
        continue;
      }
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
  modal.querySelectorAll('.sel-animales').forEach(conectarSelector);
  if (afterRender) afterRender(form);
  const first = form.querySelector('input:not([readonly]), select, textarea');
  if (first) first.focus();
  return modal;
}

// Tabla HTML a partir de columnas y filas.
// columns: [{ key, label, num, render(fila) }] · rowAttr(fila) para atributos del <tr>
// En el celular la tabla se vuelve tarjetas (una por fila): cada celda lleva
// su etiqueta en data-label y el CSS hace el resto. Las celdas vacías se
// ocultan para no llenar la tarjeta de rayas.
export function tablaHTML({ columns, rows, rowAttr, emptyMsg = 'No hay registros.', cards = true }) {
  if (!rows.length) return `<div class="empty-note" style="padding:18px;">${esc(emptyMsg)}</div>`;
  const head = columns.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`).join('');
  const body = rows.map(r => {
    const tds = columns.map(c => {
      const v = c.render ? c.render(r) : esc(r[c.key] ?? '');
      const vacio = v === '' || v == null;
      return `<td${c.num ? ' class="num"' : ''}${vacio ? ' data-vacio' : ''} data-label="${esc(c.label)}">${vacio ? '<span class="muted">—</span>' : v}</td>`;
    }).join('');
    return `<tr ${rowAttr ? rowAttr(r) : ''}>${tds}</tr>`;
  }).join('');
  return `<table${cards ? ' class="t-cards"' : ''}><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// Al escribir en un buscador NO se puede redibujar la vista entera: en el
// celular eso reemplaza el campo y cierra el teclado a cada letra. Se dibuja
// la vista en un contenedor aparte y se cambia solo la tabla (y el contador).
export function redibujarSoloTabla(el, render) {
  const tmp = document.createElement('div');
  render(tmp);
  const nuevas = tmp.querySelectorAll('.table-wrap'), viejas = el.querySelectorAll('.table-wrap');
  viejas.forEach((v, i) => { if (nuevas[i]) v.replaceWith(nuevas[i]); });
  const cNuevo = tmp.querySelector('.toolbar .muted'), cViejo = el.querySelector('.toolbar .muted');
  if (cNuevo && cViejo) cViejo.textContent = cNuevo.textContent;
  const kNuevos = tmp.querySelectorAll('[data-cuenta]'), kViejos = el.querySelectorAll('[data-cuenta]');
  kViejos.forEach((k, i) => { if (kNuevos[i]) k.textContent = kNuevos[i].textContent; });
}

const sinTildesUI = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

// Comportamiento del selector de animales: contar, filtrar, todos/ninguno.
function conectarSelector(sel) {
  const contar = () => sel.querySelectorAll('.sel-grupo').forEach(g => {
    const cajas = [...g.querySelectorAll('input[type=checkbox]')];
    g.querySelector('.sel-cuenta').textContent = `${cajas.filter(c => c.checked).length} de ${cajas.length}`;
  });
  sel.addEventListener('change', contar);
  sel.querySelectorAll('[data-todos],[data-ninguno]').forEach(b => {
    b.onclick = () => {
      const marcar = b.hasAttribute('data-todos');
      b.closest('.sel-grupo').querySelectorAll('.f-check').forEach(ch => {
        if (!ch.hidden) ch.querySelector('input').checked = marcar;
      });
      contar();
    };
  });
  const filtro = sel.querySelector('.sel-filtro');
  filtro.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
  filtro.addEventListener('input', () => {
    const t = sinTildesUI(filtro.value);
    const num = /^\d+$/.test(t) ? t.replace(/^0+(?=\d)/, '') : null;
    sel.querySelectorAll('.f-check').forEach(ch => {
      const txt = ch.dataset.texto;
      ch.hidden = !!t && !txt.includes(t) && !(num && txt.replace(/^0+(?=\d)/, '').startsWith(num));
    });
  });
  contar();
}

export function badge(texto) {
  const t = String(texto || '').trim();
  if (!t) return '<span class="muted">—</span>';
  const cls = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return `<span class="badge badge-${cls}">${esc(t)}</span>`;
}
