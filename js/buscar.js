// buscar.js — encontrar cualquier animal rápido, desde cualquier pantalla:
// por chapeta ("43" encuentra la 043), por nombre ("mariposa"), por código,
// por la cría o, en los terneros, por el número de la madre.
import { esc, fmtFecha, edadTexto } from './util.js';
import { openModal, closeModal, badge } from './ui.js';
import * as logic from './logic.js';
import { avatarHTML } from './fotos.js';
import { abrirFichaVaca, abrirFichaTernero } from './fichas.js';

const plano = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const sinCeros = s => String(s ?? '').replace(/^0+(?=\d)/, '');

// ¿Este animal sirve para lo que se escribió en el buscador?
export function coincide(animal, q) {
  const t = plano(q);
  if (!t) return true;
  if (/^\d+$/.test(t)) {
    // Un número busca por chapeta sin importar los ceros: 43 = 043.
    if (animal.chapeta != null && (sinCeros(animal.chapeta) === sinCeros(t) || String(animal.chapeta).includes(t))) return true;
    if (animal.codigoMadre && sinCeros(animal.codigoMadre) === sinCeros(t)) return true;
    // El código de registro solo con 3 cifras o más: "12" es la chapeta 012,
    // no cualquier vaca cuyo código tenga un 12 en medio.
    return t.length >= 3 && plano(animal.codigo).includes(t);
  }
  return [animal.chapeta, animal.nombre, animal.codigo, animal.genetica, animal.criaActual, animal.procedencia]
    .some(x => plano(x).includes(t));
}

// Los que empatan exacto con el número van primero (43 → la 043 antes que la 143).
const exacto = (a, q) => (a.chapeta != null && sinCeros(plano(a.chapeta)) === sinCeros(plano(q))) ? 0 : 1;

function filaVaca(state, v) {
  const toro = logic.esToro(v);
  const p = logic.prenezActivaDe(state, v.chapeta);
  const detalle = v.estado !== 'ACTIVA' ? badge(v.estado)
    : toro ? '<span class="muted">toro</span>'
      : p ? `🤰 parto ${fmtFecha(p.fechaProbParto)}`
        : (v.criaActual ? `<span class="muted">cría: ${esc(v.criaActual)}</span>` : '');
  return `<button type="button" class="buscador-item" data-tipo="vaca" data-id="${esc(v.chapeta)}">
    ${avatarHTML(state, v, { tam: 'sm' })}
    <span class="buscador-txt"><span><b>${toro ? '🐂 ' : 'Vaca '}${esc(v.chapeta)}</b>${v.nombre ? ' · ' + esc(v.nombre) : ''}</span>
      <small>${detalle}${v.codigo ? ` <span class="muted">· código ${esc(v.codigo)}</span>` : ''}</small></span>
  </button>`;
}

function filaTernero(state, t) {
  const origen = t.origen === 'COMPRADO' ? 'llegó de afuera' : (t.codigoMadre ? 'cría de la ' + esc(t.codigoMadre) : '');
  return `<button type="button" class="buscador-item" data-tipo="ternero" data-id="${esc(t.nombre)}">
    ${avatarHTML(state, t, { tam: 'sm' })}
    <span class="buscador-txt"><b>🐮 ${esc(t.nombre)}</b>
      <small>${[origen, t.fechaNac ? edadTexto(t.fechaNac) : ''].filter(Boolean).join(' · ')}
      ${t.activo ? '' : ' ' + badge(t.tipoSalida || 'NO')}</small></span>
  </button>`;
}

export function abrirBuscador(ctx) {
  const modal = openModal({
    title: '🔍 Buscar un animal',
    bodyHTML: `
      <input type="search" class="search buscador-q" id="bq" placeholder="Número de chapeta, nombre, código…"
             autocomplete="off" enterkeyhint="search" inputmode="search">
      <div class="buscador-res" id="bres"></div>`,
  });
  const q = modal.querySelector('#bq');
  const res = modal.querySelector('#bres');

  const pintar = () => {
    const { state } = ctx;
    const texto = q.value;
    if (!texto.trim()) {
      res.innerHTML = '<div class="empty-note">Escribe el número de la chapeta (por ejemplo <b>43</b>) o un nombre.</div>';
      return;
    }
    const vacas = state.vacas.filter(v => coincide(v, texto)).sort((a, b) =>
      exacto(a, texto) - exacto(b, texto)
      || (a.estado === 'ACTIVA' ? 0 : 1) - (b.estado === 'ACTIVA' ? 0 : 1)
      || String(a.chapeta).localeCompare(String(b.chapeta), 'es', { numeric: true }));
    const terneros = state.terneros.filter(t => coincide(t, texto)).sort((a, b) =>
      (a.activo ? 0 : 1) - (b.activo ? 0 : 1) || a.nombre.localeCompare(b.nombre, 'es'));
    const filas = [...vacas.map(v => filaVaca(state, v)), ...terneros.map(t => filaTernero(state, t))];
    res.innerHTML = filas.length
      ? filas.slice(0, 40).join('') + (filas.length > 40 ? `<div class="empty-note">…y ${filas.length - 40} más: escribe algo más exacto.</div>` : '')
      : '<div class="empty-note">No encontré ningún animal con eso.</div>';
  };

  res.addEventListener('click', e => {
    const it = e.target.closest('[data-tipo]');
    if (!it) return;
    closeModal();
    if (it.dataset.tipo === 'ternero') abrirFichaTernero(it.dataset.id, ctx);
    else abrirFichaVaca(it.dataset.id, ctx);
  });
  q.addEventListener('input', pintar);
  // Enter abre el primero de la lista: escribir "43" + Enter y listo.
  q.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const primero = res.querySelector('[data-tipo]');
    if (primero) primero.click();
  });
  pintar();
  setTimeout(() => q.focus(), 60);
}
