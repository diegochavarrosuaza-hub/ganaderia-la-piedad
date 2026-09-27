// sync.js — sincronización entre dispositivos (tablet, celular) vía Supabase.
//
// Cómo funciona, en corto:
//  · La app trabaja SIEMPRE contra los datos del propio aparato, así que en el
//    potrero sin señal no cambia nada.
//  · Con internet: primero se BAJA lo que cambió en los otros aparatos y se
//    fusiona (gana el más nuevo por updatedAt); después se SUBE lo que este
//    aparato tiene marcado como pendiente.
//  · La "marca de agua" para bajar es una hora que pone el SERVIDOR
//    (synced_at), nunca el reloj del aparato: así lo que otro aparato registró
//    sin señal y subió tarde también llega.
//  · La nube tiene un guardián: una versión vieja nunca pisa una más nueva
//    (trigger en SQL_TABLA). Es la misma regla que aquí, pero aplicada allá.
import * as db from './db.js';

const URL_KEY = 'la-piedad-sync-url';
const API_KEY = 'la-piedad-sync-key';
const TABLA = 'registros';
const PAGINA = 500; // filas por petición al bajar

export const getConfig = () => ({
  url: (localStorage.getItem(URL_KEY) || '').replace(/\/+$/, ''),
  key: localStorage.getItem(API_KEY) || '',
});
export const haySync = () => { const c = getConfig(); return !!(c.url && c.key); };

export function setConfig(url, key) {
  if (url && key) {
    localStorage.setItem(URL_KEY, url.trim().replace(/\/+$/, ''));
    localStorage.setItem(API_KEY, key.trim());
  } else {
    localStorage.removeItem(URL_KEY);
    localStorage.removeItem(API_KEY);
  }
}

/*
 * Enlace para dejar otro aparato configurado de un toque.
 *
 * Teclear una clave de 50 caracteres en la tablet no va a pasar: se genera un
 * enlace que ya la lleva dentro y basta con abrirlo una vez en el aparato.
 * OJO: el enlace ES la llave de los datos. Se manda solo a quien debe tenerlo.
 */
export function crearEnlaceConfig() {
  const { url, key } = getConfig();
  if (!url || !key) throw new Error('Primero configura la sincronización en este dispositivo.');
  const bytes = new TextEncoder().encode(JSON.stringify({ url, key }));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#sync=${b64}`;
}

/*
 * Si la app se abrió con un enlace de esos, lo aplica y limpia la dirección
 * para que la clave no quede a la vista ni en el historial.
 */
export function configDesdeEnlace() {
  const m = (location.hash || '').match(/[#&]sync=([^&]+)/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const { url, key } = JSON.parse(new TextDecoder().decode(bytes));
    if (!url || !key) return null;
    setConfig(url, key);
    return url;
  } catch {
    return null;
  }
}

function cabeceras(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

// Prueba una configuración (la que se va a guardar, no la guardada).
// Devuelve mensaje entendible si algo falla.
export async function probarConexion(url, key) {
  url = (url || '').trim().replace(/\/+$/, '');
  key = (key || '').trim();
  if (!url || !key) throw new Error('Falta configurar el enlace y la clave.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('El enlace no parece de Supabase (debe ser https://xxxx.supabase.co).');
  }
  let r;
  try {
    r = await fetch(`${url}/rest/v1/${TABLA}?select=uid&limit=1`, { headers: cabeceras(key) });
  } catch {
    throw new Error('No se pudo conectar. Revisa el internet y que el enlace esté bien escrito.');
  }
  if (r.status === 401 || r.status === 403) throw new Error('La clave no es válida para ese proyecto.');
  if (r.status === 404) throw new Error('Falta crear la tabla "registros" en Supabase (te paso el texto para hacerlo).');
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}.`);
  return true;
}

// Registro local → fila para la nube
const aFila = (store, r) => ({
  uid: r.uid,
  store,
  datos: (({ id, uid, updatedAt, deletedAt, pendienteSubir, ...resto }) => resto)(r),
  updated_at: r.updatedAt,
  deleted: !!r.deletedAt,
  deleted_at: r.deletedAt || null,
});

// Un solo candado para toda la app: si ya hay una sincronización en curso, las
// demás llamadas se cuelgan de esa misma en vez de arrancar otra a la vez.
let enCurso = null;
export function sincronizar() {
  if (enCurso) return enCurso;
  enCurso = _sincronizar().finally(() => { enCurso = null; });
  return enCurso;
}

/*
 * Sincroniza en los dos sentidos. Devuelve un resumen:
 *   { ok, subidos, bajados, errorSubida }
 * Si no hay internet o no está configurado, no rompe nada: informa y ya.
 */
async function _sincronizar() {
  if (!haySync()) return { ok: false, motivo: 'sin-configurar' };
  if (!navigator.onLine) return { ok: false, motivo: 'sin-internet' };
  const { url, key } = getConfig();

  // ── 1. BAJAR primero: conocer la nube antes de escribirle ──
  // Se pide por páginas, ordenadas por la hora del servidor, y la marca de
  // agua solo avanza cuando TODO llegó y se fusionó.
  let cursor = (await db.metaGet('cursorSync')) || '1970-01-01T00:00:00+00:00';
  let bajados = 0;
  for (;;) {
    const q = `${url}/rest/v1/${TABLA}?select=*&synced_at=gt.${encodeURIComponent(cursor)}`
      + `&order=synced_at.asc,uid.asc&limit=${PAGINA}`;
    const resp = await fetch(q, { headers: cabeceras(key) });
    if (!resp.ok) throw new Error(`No se pudieron bajar los datos (${resp.status}).`);
    const pagina = await resp.json();
    if (!Array.isArray(pagina)) throw new Error('La nube respondió algo raro al bajar.');

    for (const fila of pagina) {
      if (db.STORES.includes(fila.store)) bajados += await fusionar(fila) ? 1 : 0;
      if (fila.synced_at && fila.synced_at > cursor) cursor = fila.synced_at;
    }
    if (pagina.length < PAGINA) break;
  }
  await db.metaSet('cursorSync', cursor);

  // ── 2. SUBIR lo pendiente de este aparato ──
  // Se sube lo marcado, no "lo de después de tal hora": así no depende del
  // reloj. Si falla, lo pendiente sigue pendiente y se reintenta después.
  const porSubir = [];
  for (const store of db.STORES) {
    for (const r of await db.allRaw(store)) {
      if (r.pendienteSubir && r.uid) porSubir.push({ store, r, fila: aFila(store, r) });
    }
  }
  // Nunca dos veces el mismo uid en una tanda (PostgREST lo rechaza entero).
  const unicos = new Map();
  for (const p of porSubir) {
    const prev = unicos.get(p.fila.uid);
    if (!prev || db.instante(p.r.updatedAt) > db.instante(prev.r.updatedAt)) unicos.set(p.fila.uid, p);
  }
  const tandas = [...unicos.values()];

  let subidos = 0, errorSubida = null;
  for (let i = 0; i < tandas.length; i += 400) {
    const tanda = tandas.slice(i, i + 400);
    try {
      const r = await fetch(`${url}/rest/v1/${TABLA}?on_conflict=uid`, {
        method: 'POST',
        headers: cabeceras(key, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(tanda.map(t => t.fila)),
      });
      if (!r.ok) throw new Error(`la nube respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
      for (const t of tanda) await db.marcarSubido(t.store, t.r.uid, t.r.pendienteSubir);
      subidos += tanda.length;
    } catch (err) {
      // Una tanda que falla no detiene las demás ni deja de reintentarse.
      errorSubida = err.message || String(err);
    }
  }

  const fin = db.ahora();
  await db.metaSet('ultimaSyncOk', fin);
  if (errorSubida) await db.metaSet('ultimoErrorSync', { fecha: fin, error: errorSubida });
  else await db.metaDel('ultimoErrorSync');
  return { ok: true, subidos, bajados, pendientes: tandas.length - subidos, errorSubida };
}

// Una fila de la nube contra la local: gana la más nueva. Devuelve true si
// se escribió algo. Se lee el local justo antes de escribir (no de una foto
// vieja) para no pisar lo que la usuaria guardó mientras se bajaba.
async function fusionar(fila) {
  const local = await db.getPorUid(fila.store, fila.uid);
  if (local && db.instante(local.updatedAt) >= db.instante(fila.updated_at)) return false;
  const registro = {
    ...(fila.datos || {}),
    uid: fila.uid,
    updatedAt: fila.updated_at,
    ...(fila.deleted ? { deletedAt: fila.deleted_at || fila.updated_at } : {}),
  };
  if (local) registro.id = local.id; // conservar la llave local
  await db.putCrudo(fila.store, registro);
  return true;
}

export const ultimaSync = () => db.metaGet('ultimaSyncOk');
export const ultimoError = () => db.metaGet('ultimoErrorSync');
export async function pendientesDeSubir() {
  let n = 0;
  for (const s of db.STORES) n += (await db.allRaw(s)).filter(r => r.pendienteSubir).length;
  return n;
}

/*
 * SQL que hay que correr UNA vez en Supabase para crear la tabla.
 * Se puede volver a correr sin romper nada.
 *
 * · synced_at: la hora del SERVIDOR en que llegó cada versión. Es la marca de
 *   agua para bajar cambios; el reloj de los aparatos no cuenta para eso.
 * · Guardián: una versión con updated_at igual o más viejo que la guardada se
 *   descarta. Un aparato que estuvo días sin señal no puede pisar lo nuevo.
 * · Permisos: lectura, inserción y actualización, pero NO borrado físico.
 *   La app nunca borra de verdad (marca deletedAt), así que no lo necesita; y
 *   aunque alguien consiga la clave, no puede vaciar la tabla.
 */
export const SQL_TABLA = `create table if not exists registros (
  uid        text primary key,
  store      text not null,
  datos      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted    boolean not null default false,
  deleted_at timestamptz,
  synced_at  timestamptz not null default now()
);
alter table registros add column if not exists synced_at timestamptz not null default now();
create index if not exists registros_synced_at_idx on registros (synced_at, uid);
alter table registros enable row level security;

create or replace function registros_guardia() returns trigger language plpgsql as $$
begin
  -- Solo gana lo más nuevo: una versión vieja no puede pisar una nueva.
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.synced_at := now();
  return new;
end $$;
drop trigger if exists registros_guardia_t on registros;
create trigger registros_guardia_t before insert or update on registros
  for each row execute function registros_guardia();

drop policy if exists "acceso con clave" on registros;
drop policy if exists "leer con clave" on registros;
drop policy if exists "insertar con clave" on registros;
drop policy if exists "actualizar con clave" on registros;
create policy "leer con clave"       on registros for select using (true);
create policy "insertar con clave"   on registros for insert with check (true);
create policy "actualizar con clave" on registros for update using (true) with check (true);`;
