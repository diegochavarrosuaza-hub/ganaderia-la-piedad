// fotos.js — fotos de los animales: tomar, reducir, guardar, mostrar, y la
// "ronda de fotos" para fotografiar el hato de una sentada.
//
// Cada foto se guarda en dos tamaños, en dos stores que viajan con la
// sincronización igual que lo demás:
//   fotos        → miniatura (160 px, ~8 KB). Va en el estado en memoria y se
//                  usa en listas y fichas: tiene que ser liviana.
//   fotosGrandes → la foto para ver en grande y para el PDF (720 px, ~60 KB).
//                  Se lee solo cuando se necesita.
// El uid es 'foto:<uid del animal>': una foto vigente por animal. Tomar otra
// la reemplaza, y si dos aparatos fotografían la misma vaca gana la más nueva.
import * as db from './db.js';
import { esc, hoyISO, edadTexto } from './util.js';
import { openModal, closeModal, toast, confirmar, formModal } from './ui.js';
import * as logic from './logic.js';

const LADO_GRANDE = 720;
const LADO_MINI = 160;
const CALIDAD = 0.72;
const ICONO = { vaca: '🐄', toro: '🐂', ternero: '🐮' };

export const fotoUid = animal => 'foto:' + animal.uid;
// La foto grande lleva OTRO uid: en la nube el uid es único para toda la
// tabla, y si compartiera el de la miniatura una de las dos se perdería.
export const fotoGrandeUid = animal => 'fotoG:' + animal.uid;
export const tipoAnimal = a => (a.chapeta != null ? (logic.esToro(a) ? 'toro' : 'vaca') : 'ternero');

export function etiqueta(a) {
  const t = tipoAnimal(a);
  if (t === 'ternero') return a.nombre;
  return (t === 'toro' ? 'Toro ' : 'Vaca ') + a.chapeta + (a.nombre && t === 'vaca' ? ' · ' + a.nombre : '');
}

// Mapa uid-de-foto → miniatura, armado una sola vez por cada estado cargado.
const cache = new WeakMap();
export function miniDe(state, animal) {
  if (!animal || !animal.uid || !state || !state.fotos) return null;
  let m = cache.get(state.fotos);
  if (!m) {
    m = new Map(state.fotos.map(f => [f.uid, f.mini]));
    cache.set(state.fotos, m);
  }
  return m.get(fotoUid(animal)) || null;
}

/*
 * El circulito con la foto del animal. Sin foto muestra su ícono; con
 * editable:true lleva el lápiz y al tocarlo se abre la foto para cambiarla.
 * tam: 'sm' (listas), 'md' (ficha), 'lg' (ronda de fotos).
 */
export function avatarHTML(state, animal, { tam = 'md', editable = false } = {}) {
  const mini = miniDe(state, animal);
  const attrs = editable
    ? ` data-foto="${esc(animal.uid)}" role="button" title="${mini ? 'Ver o cambiar la foto' : 'Agregar foto'}"`
    : '';
  return `<span class="avatar avatar-${tam}${mini ? '' : ' avatar-vacio'}"${attrs}>`
    + (mini ? `<img src="${mini}" alt="">` : `<span class="avatar-ico">${ICONO[tipoAnimal(animal)]}</span>`)
    + (editable ? '<span class="avatar-lapiz">✏️</span>' : '')
    + '</span>';
}

export function buscarAnimal(state, uid) {
  return state.vacas.find(v => v.uid === uid) || state.terneros.find(t => t.uid === uid) || null;
}

// ── Procesar la imagen ────────────────────────────────────────────
async function decodificar(file) {
  if ('createImageBitmap' in window) {
    try {
      const b = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { fuente: b, liberar: () => b.close && b.close() };
    } catch { /* algunos navegadores no aceptan la opción: se usa <img> */ }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { fuente: img, liberar: () => URL.revokeObjectURL(url) };
}

const lienzo = (w, h) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
};

// Reduce por mitades: un solo salto de 4000 a 700 px deja la foto "picada".
function reducir(src, lado, cuadrado) {
  const w0 = src.width, h0 = src.height;
  let sx = 0, sy = 0, sw = w0, sh = h0;
  if (cuadrado) {
    const m = Math.min(w0, h0);
    sx = (w0 - m) / 2; sy = (h0 - m) / 2; sw = sh = m;
  }
  const escala = Math.min(1, lado / Math.max(sw, sh));
  const w = Math.round(sw * escala), h = Math.round(sh * escala);
  let cur = src, cx = sx, cy = sy, cW = sw, cH = sh;
  while (cW / 2 >= w * 1.5) {
    const c = lienzo(Math.round(cW / 2), Math.round(cH / 2));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, cx, cy, cW, cH, 0, 0, c.width, c.height);
    cur = c; cx = 0; cy = 0; cW = c.width; cH = c.height;
  }
  const fin = lienzo(w, h);
  const g = fin.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, cx, cy, cW, cH, 0, 0, w, h);
  return fin.toDataURL('image/jpeg', CALIDAD);
}

export async function procesarFoto(file) {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Ese archivo no es una foto.');
  const { fuente, liberar } = await decodificar(file);
  try {
    return { imagen: reducir(fuente, LADO_GRANDE, false), mini: reducir(fuente, LADO_MINI, true) };
  } finally {
    liberar();
  }
}

// ── Guardar / quitar / leer ───────────────────────────────────────
export async function guardarFoto(animal, file) {
  const { mini, imagen } = await procesarFoto(file);
  const fecha = hoyISO();
  // Primero la grande: si algo falla a mitad, no queda una miniatura sin foto.
  await db.upsertPorUid('fotosGrandes', fotoGrandeUid(animal), { animal: animal.uid, imagen, fecha });
  await db.upsertPorUid('fotos', fotoUid(animal), { animal: animal.uid, mini, fecha });
  return mini;
}

export async function quitarFoto(animal) {
  await db.borrarPorUid('fotos', fotoUid(animal));
  await db.borrarPorUid('fotosGrandes', fotoGrandeUid(animal));
}

export async function fotoGrande(animal) {
  const r = await db.getPorUid('fotosGrandes', fotoGrandeUid(animal));
  return r && !r.deletedAt ? r.imagen : null;
}

// Abre la cámara (o la galería) y devuelve el archivo elegido, o null.
// Tiene que llamarse directo desde un toque: el navegador no deja abrir la
// cámara si no viene de una acción de la persona.
function pedirArchivo({ camara }) {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (camara) inp.setAttribute('capture', 'environment');
    inp.onchange = () => res(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.addEventListener('cancel', () => res(null));
    inp.click();
  });
}

// ── Ver / cambiar la foto de un animal ────────────────────────────
export async function abrirFoto(animal, ctx, { volver = null } = {}) {
  const grande = await fotoGrande(animal);
  const modal = openModal({
    title: `📷 ${esc(etiqueta(animal))}`,
    bodyHTML: `
      <div class="foto-grande">${grande
        ? `<img src="${grande}" alt="Foto de ${esc(etiqueta(animal))}">`
        : `<div class="foto-vacia">${ICONO[tipoAnimal(animal)]}<div>Todavía no tiene foto</div></div>`}</div>
      <div class="fab-row foto-acciones">
        <button class="btn btn-primary" data-a="camara">📷 ${grande ? 'Tomar otra' : 'Tomar foto'}</button>
        <button class="btn btn-ghost" data-a="galeria">🖼️ De la galería</button>
        ${grande ? '<button class="btn btn-ghost" data-a="quitar">🗑️ Quitar</button>' : ''}
      </div>
      ${volver ? '<div class="foto-volver"><button class="btn btn-ghost btn-sm" data-a="volver">← Volver a la hoja de vida</button></div>' : ''}
      <div id="foto-estado" class="muted foto-estado"></div>`,
  });

  const seguir = async () => { await ctx.refresh(); if (volver) volver(); else abrirFoto(animal, ctx); };
  const tomar = camara => async () => {
    const archivo = await pedirArchivo({ camara });
    if (!archivo) return;
    modal.querySelectorAll('button').forEach(b => { b.disabled = true; });
    modal.querySelector('#foto-estado').textContent = '⏳ Guardando la foto…';
    try {
      await guardarFoto(animal, archivo);
      toast(`📷 Foto de ${etiqueta(animal)} guardada.`);
      await seguir();
    } catch (err) {
      toast(err.message || String(err), 'error');
      modal.querySelectorAll('button').forEach(b => { b.disabled = false; });
      modal.querySelector('#foto-estado').textContent = '';
    }
  };
  modal.querySelector('[data-a="camara"]').onclick = tomar(true);
  modal.querySelector('[data-a="galeria"]').onclick = tomar(false);
  const q = modal.querySelector('[data-a="quitar"]');
  if (q) q.onclick = async () => {
    if (!(await confirmar(`¿Quitar la foto de <b>${esc(etiqueta(animal))}</b>?`, { peligro: true, okLabel: 'Quitar' }))) {
      return abrirFoto(animal, ctx, { volver });
    }
    await quitarFoto(animal);
    toast('Foto quitada.', 'info');
    await seguir();
  };
  const v = modal.querySelector('[data-a="volver"]');
  if (v) v.onclick = () => { closeModal(); volver(); };
}

// ═══════════════ RONDA DE FOTOS ═══════════════
// Para fotografiar el hato de una sentada: la app va mostrando un animal tras
// otro, con su chapeta en grande, y basta tocar "Tomar foto" en cada uno.
// El avance se guarda en el aparato: si la tablet cierra la app al abrir la
// cámara (pasa en tablets con poca memoria), la ronda se retoma donde iba.
const RONDA_KEY = 'la-piedad-ronda';
const GRUPOS = {
  vacas: '🐄 Vacas activas',
  terneros: '🐮 Terneros vivos',
  toros: '🐂 Toros',
  todos: '🌳 Todos los animales',
};

function leerRonda() {
  try { return JSON.parse(localStorage.getItem(RONDA_KEY) || 'null'); } catch { return null; }
}
function guardarRonda(r) { localStorage.setItem(RONDA_KEY, JSON.stringify(r)); }
function borrarRonda() { localStorage.removeItem(RONDA_KEY); }

function animalesDe(state, grupo) {
  const porChapeta = (a, b) => String(a.chapeta).localeCompare(String(b.chapeta), 'es', { numeric: true });
  const vacas = state.vacas.filter(v => v.estado === 'ACTIVA' && !logic.esToro(v)).sort(porChapeta);
  const toros = state.vacas.filter(v => v.estado === 'ACTIVA' && logic.esToro(v)).sort(porChapeta);
  const terneros = state.terneros.filter(t => t.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  return { vacas, toros, terneros, todos: [...vacas, ...toros, ...terneros] }[grupo] || [];
}

export async function iniciarRonda(ctx, grupoInicial = 'vacas') {
  const guardada = leerRonda();
  if (guardada && guardada.idx < guardada.uids.length) {
    const seguirla = await confirmar(
      `Tienes una ronda de fotos a medias: <b>${esc(GRUPOS[guardada.grupo] || '')}</b>, `
      + `va en <b>${guardada.idx + 1} de ${guardada.uids.length}</b> (${guardada.hechas} fotos tomadas).<br><br>¿Seguir donde ibas?`,
      { okLabel: 'Sí, seguir' });
    if (seguirla) return pasoRonda(ctx, guardada);
    borrarRonda();
  }
  const conFoto = g => animalesDe(ctx.state, g).filter(a => miniDe(ctx.state, a)).length;
  formModal({
    title: '📷 Ronda de fotos',
    submitLabel: 'Empezar',
    fields: [
      { name: 'grupo', label: '¿A quiénes les vas a tomar foto?', type: 'select', value: grupoInicial,
        options: Object.entries(GRUPOS).map(([value, label]) => {
          const n = animalesDe(ctx.state, value).length;
          return { value, label: `${label} (${conFoto(value)} de ${n} con foto)` };
        }) },
      { name: 'solo', label: 'Cuáles', type: 'checks', value: ['sin'],
        options: [{ value: 'sin', label: 'Solo los que todavía no tienen foto' }] },
    ],
    async onSubmit(v) {
      const soloSinFoto = v.solo.includes('sin');
      const lista = animalesDe(ctx.state, v.grupo).filter(a => !soloSinFoto || !miniDe(ctx.state, a));
      if (!lista.length) {
        throw new Error(soloSinFoto ? '¡Todos los de ese grupo ya tienen foto! 🎉' : 'No hay animales en ese grupo.');
      }
      const r = { grupo: v.grupo, uids: lista.map(a => a.uid), idx: 0, hechas: 0 };
      guardarRonda(r);
      // formModal cierra su ventana al terminar: la ronda se abre justo después.
      setTimeout(() => pasoRonda(ctx, r), 0);
    },
  });
}

function detallesDe(a) {
  const t = tipoAnimal(a);
  const partes = t === 'ternero'
    ? [a.sexo, a.codigoMadre && 'Madre: vaca ' + a.codigoMadre, a.fechaNac && edadTexto(a.fechaNac)]
    : t === 'toro'
      ? [a.genetica, a.fechaNac && edadTexto(a.fechaNac)]
      : [a.codigo && 'Código ' + a.codigo, a.genetica, a.criaActual && 'Cría: ' + a.criaActual];
  return partes.filter(Boolean).map(esc).join(' · ');
}

function pasoRonda(ctx, r) {
  const { state } = ctx;
  // Los animales que ya no existen (vendidos a mitad de la ronda) se saltan.
  const lista = r.uids.map(u => buscarAnimal(state, u)).filter(Boolean);
  r.uids = lista.map(a => a.uid);
  if (r.idx >= lista.length) return finRonda(ctx, r);
  r.idx = Math.max(0, r.idx);
  guardarRonda(r);

  const a = lista[r.idx];
  const tieneFoto = !!miniDe(state, a);
  const pct = Math.round((r.idx / lista.length) * 100);
  const modal = openModal({
    title: `📷 Ronda de fotos · ${r.idx + 1} de ${lista.length}`,
    bodyHTML: `
      <div class="ronda-barra"><div style="width:${pct}%"></div></div>
      <div class="ronda-animal">
        ${avatarHTML(state, a, { tam: 'lg' })}
        <div class="ronda-nombre">${esc(etiqueta(a))}</div>
        <div class="muted">${detallesDe(a)}</div>
        ${tieneFoto ? '<div class="ronda-nota">Ya tiene foto: si tomas otra, la reemplaza.</div>' : ''}
      </div>
      <button class="btn btn-primary btn-grande" data-a="camara">📷 Tomar foto</button>
      <div class="fab-row ronda-nav">
        <button class="btn btn-ghost" data-a="atras"${r.idx === 0 ? ' disabled' : ''}>⬅️ Anterior</button>
        <button class="btn btn-ghost" data-a="galeria">🖼️ Galería</button>
        <button class="btn btn-ghost" data-a="saltar">Saltar ➡️</button>
      </div>
      <div class="f-row ronda-ir">
        <label>¿El que tienes enfrente es otro? Salta a él:</label>
        <select data-a="ir">${lista.map((x, i) =>
          `<option value="${i}"${i === r.idx ? ' selected' : ''}>${esc(etiqueta(x))}${miniDe(state, x) ? ' ✓' : ''}</option>`).join('')}</select>
      </div>
      <div id="ronda-estado" class="muted foto-estado"></div>
      <div class="foto-volver">
        <button class="btn btn-ghost btn-sm" data-a="terminar">Terminar ronda · ${r.hechas} foto${r.hechas === 1 ? '' : 's'} tomada${r.hechas === 1 ? '' : 's'}</button>
      </div>`,
  });

  const ir = i => { r.idx = i; pasoRonda(ctx, r); };
  const tomar = camara => async () => {
    const archivo = await pedirArchivo({ camara });
    if (!archivo) return;
    modal.querySelectorAll('button, select').forEach(b => { b.disabled = true; });
    modal.querySelector('#ronda-estado').textContent = '⏳ Guardando…';
    try {
      await guardarFoto(a, archivo);
      r.hechas++;
      toast(`✓ ${etiqueta(a)}`);
      await ctx.refresh();
      ir(r.idx + 1);
    } catch (err) {
      toast(err.message || String(err), 'error');
      modal.querySelectorAll('button, select').forEach(b => { b.disabled = false; });
      modal.querySelector('#ronda-estado').textContent = '';
    }
  };
  modal.querySelector('[data-a="camara"]').onclick = tomar(true);
  modal.querySelector('[data-a="galeria"]').onclick = tomar(false);
  modal.querySelector('[data-a="atras"]').onclick = () => ir(r.idx - 1);
  modal.querySelector('[data-a="saltar"]').onclick = () => ir(r.idx + 1);
  modal.querySelector('[data-a="ir"]').onchange = e => ir(Number(e.target.value));
  modal.querySelector('[data-a="terminar"]').onclick = () => finRonda(ctx, r);
}

function finRonda(ctx, r) {
  borrarRonda();
  const faltan = animalesDe(ctx.state, r.grupo).filter(a => !miniDe(ctx.state, a)).length;
  const modal = openModal({
    title: '📷 Ronda terminada',
    bodyHTML: `
      <div class="ronda-animal">
        <div class="ronda-nombre">${r.hechas} foto${r.hechas === 1 ? '' : 's'} nueva${r.hechas === 1 ? '' : 's'} 🎉</div>
        <div class="muted" style="margin-top:6px;">${faltan
          ? `En ${esc(GRUPOS[r.grupo] || 'ese grupo')} quedan <b>${faltan}</b> sin foto.`
          : `Todos los de ${esc(GRUPOS[r.grupo] || 'ese grupo')} tienen foto.`}</div>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" data-a="ok">Listo</button></div>`,
  });
  modal.querySelector('[data-a="ok"]').onclick = closeModal;
}
