// sync.js — sincronización entre dispositivos (tablet, celular) vía Supabase.
//
// Cómo funciona, en corto:
//  · La app sigue trabajando SIEMPRE contra los datos del propio aparato, así
//    que en el potrero sin señal no cambia nada.
//  · Cuando hay internet, se suben los cambios propios y se bajan los ajenos.
//  · Si el mismo registro se tocó en dos aparatos, gana el más reciente
//    (se compara updatedAt).
import * as db from './db.js';

const URL_KEY = 'la-piedad-sync-url';
const API_KEY = 'la-piedad-sync-key';
const TABLA = 'registros';

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
 * Se llama ANTES de abrir la base de datos: así el aparato ya sabe que hay
 * nube desde el primer momento.
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

function cabeceras(extra = {}) {
  const { key } = getConfig();
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

// Prueba que la conexión y la tabla existan. Devuelve mensaje entendible.
export async function probarConexion() {
  const { url } = getConfig();
  if (!haySync()) throw new Error('Falta configurar el enlace y la clave.');
  let r;
  try {
    r = await fetch(`${url}/rest/v1/${TABLA}?select=uid&limit=1`, { headers: cabeceras() });
  } catch {
    throw new Error('No se pudo conectar. Revisa el internet y que el enlace esté bien escrito.');
  }
  if (r.status === 401 || r.status === 403) throw new Error('La clave no es válida para ese proyecto.');
  if (r.status === 404) throw new Error('Falta crear la tabla "registros" en Supabase (te paso el texto para hacerlo).');
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}.`);
  return true;
}

/*
 * Momento en milisegundos. NO se pueden comparar las marcas de tiempo como
 * texto: Postgres devuelve '2026-09-27T18:00:00+00:00' y el navegador escribe
 * '2026-09-27T18:00:00.000Z'. Es el mismo instante con distinta forma, y
 * comparado como texto da el resultado equivocado (comprobado contra el
 * proyecto real). Se comparan siempre como fechas.
 */
const instante = t => {
  const n = Date.parse(t || '');
  return Number.isNaN(n) ? 0 : n;
};

// Registro local → fila para la nube
const aFila = (store, r) => ({
  uid: r.uid,
  store,
  datos: (({ id, uid, updatedAt, deletedAt, ...resto }) => resto)(r),
  updated_at: r.updatedAt,
  deleted: !!r.deletedAt,
  deleted_at: r.deletedAt || null,
});

/*
 * Sincroniza en los dos sentidos. Devuelve un resumen:
 *   { subidos, bajados, sinCambios }
 * Si no hay internet o no está configurado, no rompe nada: informa y ya.
 */
export async function sincronizar() {
  if (!haySync()) return { ok: false, motivo: 'sin-configurar' };
  if (!navigator.onLine) return { ok: false, motivo: 'sin-internet' };

  const { url } = getConfig();
  const desde = (await db.metaGet('ultimaSync')) || '1970-01-01T00:00:00.000Z';
  const inicio = db.ahora();

  // ── 1. SUBIR lo que cambió en este aparato desde la última vez ──
  const porSubir = [];
  for (const store of db.STORES) {
    for (const r of await db.allRaw(store)) {
      if (instante(r.updatedAt) > instante(desde)) porSubir.push(aFila(store, r));
    }
  }

  if (porSubir.length) {
    // De a tandas, por si son muchos registros
    for (let i = 0; i < porSubir.length; i += 400) {
      const tanda = porSubir.slice(i, i + 400);
      const r = await fetch(`${url}/rest/v1/${TABLA}?on_conflict=uid`, {
        method: 'POST',
        headers: cabeceras({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(tanda),
      });
      if (!r.ok) throw new Error(`No se pudieron subir los datos (${r.status}). ${await r.text()}`);
    }
  }

  // ── 2. BAJAR lo que cambió en los otros aparatos ──
  const resp = await fetch(
    `${url}/rest/v1/${TABLA}?select=*&updated_at=gt.${encodeURIComponent(desde)}&order=updated_at.asc`,
    { headers: cabeceras() });
  if (!resp.ok) throw new Error(`No se pudieron bajar los datos (${resp.status}).`);
  const remotos = await resp.json();

  // ── 3. FUSIONAR: gana el más reciente ──
  let bajados = 0;
  const locales = {};
  for (const store of db.STORES) {
    locales[store] = new Map((await db.allRaw(store)).map(r => [r.uid, r]));
  }

  for (const fila of remotos) {
    const store = fila.store;
    if (!db.STORES.includes(store)) continue;
    const local = locales[store].get(fila.uid);
    // El propio cambio recién subido vuelve en el pull: no es novedad.
    if (local && instante(local.updatedAt) >= instante(fila.updated_at)) continue;

    const registro = {
      ...(fila.datos || {}),
      uid: fila.uid,
      updatedAt: fila.updated_at,
      ...(fila.deleted ? { deletedAt: fila.deleted_at || fila.updated_at } : {}),
    };
    if (local) registro.id = local.id; // conservar la llave local
    await db.putCrudo(store, registro);
    bajados++;
  }

  await db.metaSet('ultimaSync', inicio);
  await db.metaSet('ultimaSyncOk', db.ahora());
  return { ok: true, subidos: porSubir.length, bajados };
}

export const ultimaSync = () => db.metaGet('ultimaSyncOk');

/*
 * SQL que hay que correr UNA vez en Supabase para crear la tabla.
 * Se puede volver a correr sin romper nada.
 *
 * Ojo con los permisos: se dan lectura, inserción y actualización, pero NO
 * borrado físico. La app nunca borra de verdad (marca deletedAt y el registro
 * se queda), así que no lo necesita; y así, aunque alguien consiga la clave,
 * no puede vaciar la tabla. Probado: un DELETE con la clave responde "listo"
 * pero no borra una sola fila.
 */
export const SQL_TABLA = `create table if not exists registros (
  uid        text primary key,
  store      text not null,
  datos      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted    boolean not null default false,
  deleted_at timestamptz
);
create index if not exists registros_updated_at_idx on registros (updated_at);
alter table registros enable row level security;

drop policy if exists "acceso con clave" on registros;
drop policy if exists "leer con clave" on registros;
drop policy if exists "insertar con clave" on registros;
drop policy if exists "actualizar con clave" on registros;
create policy "leer con clave"       on registros for select using (true);
create policy "insertar con clave"   on registros for insert with check (true);
create policy "actualizar con clave" on registros for update using (true) with check (true);`;
