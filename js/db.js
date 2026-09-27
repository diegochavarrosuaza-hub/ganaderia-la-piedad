// db.js — almacenamiento local (IndexedDB) con carga inicial desde seed-data.js
//
// Cada registro lleva campos de control para poder sincronizarse entre
// dispositivos (tablet, celular) sin perder nada:
//   uid            → identidad global: el MISMO registro tiene el mismo uid en
//                    todos los aparatos (el 'id' de IndexedDB es local y no sirve).
//   updatedAt      → cuándo se tocó por última vez; ante un choque gana el más nuevo.
//   deletedAt      → borrado "lógico": el registro se marca en vez de desaparecer,
//                    para que el borrado también llegue a los otros aparatos.
//   pendienteSubir → este aparato lo cambió y todavía no lo ha subido a la nube.
//                    Es una marca, no una fecha: así la subida no depende del
//                    reloj del aparato (si alguien cambia la hora, no se pierde nada).
import { SEED, SEED_VERSION } from './seed-data.js';

// Queda en true si al abrir la app se actualizaron los datos del hato.
export let datosActualizados = false;

const DB_NAME = 'ganaderia-la-piedad';
const DB_VERSION = 4; // v3: 'tratamientos' (sanidad) · v4: 'ajustes' + índice por uid
// Las facturas se manejan fuera de la app (Google Sheets + Claude); aquí solo el hato.
// 'ajustes' guarda un solo registro con los parámetros de la finca; al estar en
// la lista, viaja entre dispositivos con la sincronización igual que lo demás.
export const STORES = ['vacas', 'terneros', 'servicios', 'prenez', 'pesajes', 'tratamientos', 'eventos', 'ajustes'];

// Los registros que existían antes de la sincronización se sellan con esta
// fecha (y no con "ahora"): son, por definición, más viejos que cualquier
// corrección posterior, y así nunca le ganan a la nube ni a la semilla.
const SELLO_LEGADO = '2026-01-01T00:00:00.000Z';

let _db = null;

function req2p(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export const ahora = () => new Date().toISOString();

// Momento en milisegundos, tolerante a formatos distintos ('...Z' vs '+00:00').
export const instante = t => {
  const n = Date.parse(t || '');
  return Number.isNaN(n) ? 0 : n;
};

// ── Identidad de este aparato ────────────────────────────────────
// Los registros nuevos llevan un sufijo con el aparato que los creó y un
// contador: así dos aparatos NUNCA le ponen el mismo uid a dos hechos
// distintos (dos pesajes del mismo ternero el mismo día, por ejemplo).
const DEV_KEY = 'la-piedad-dispositivo';
const SEQ_KEY = 'la-piedad-secuencia';
function idDispositivo() {
  let d = localStorage.getItem(DEV_KEY);
  if (!d) {
    d = Math.random().toString(36).slice(2, 7);
    localStorage.setItem(DEV_KEY, d);
  }
  return d;
}
function sufijoUnico() {
  const n = (Number(localStorage.getItem(SEQ_KEY)) || 0) + 1;
  localStorage.setItem(SEQ_KEY, String(n));
  return `~${idDispositivo()}${n.toString(36)}`;
}

export async function initDB() {
  if (_db) return _db;
  _db = await new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const tx = req.transaction;
      for (const s of STORES) {
        const os = db.objectStoreNames.contains(s)
          ? tx.objectStore(s)
          : db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        // Índice por uid: la fusión con la nube busca por uid, no por id local.
        if (!os.indexNames.contains('uid')) os.createIndex('uid', 'uid', { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await completarUids();
  await aplicarSeed();
  return _db;
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}

// Todo lo guardado, incluidos los borrados (lo usa la sincronización).
export function allRaw(store) { return req2p(tx(store).getAll()); }

// Lo que la app ve: sin los registros borrados.
export async function all(store) {
  return (await allRaw(store)).filter(r => !r.deletedAt);
}

export function get(store, id) { return req2p(tx(store).get(id)); }

// Busca por identidad global. Si por algún error hubiera dos filas con el
// mismo uid, devuelve la más nueva (y así la fusión no crea una tercera).
export async function getPorUid(store, uid) {
  if (!uid) return undefined;
  const filas = await req2p(tx(store).index('uid').getAll(uid));
  if (!filas.length) return undefined;
  return filas.sort((a, b) => instante(b.updatedAt) - instante(a.updatedAt))[0];
}

export async function add(store, obj) {
  const r = { ...obj };
  // Identidad: legible (qué es) + única por aparato (quién y cuándo la creó).
  if (!r.uid) r.uid = store === 'ajustes' ? claveEstable(store, r) : claveEstable(store, r) + sufijoUnico();
  r.updatedAt = ahora();
  r.pendienteSubir = r.updatedAt;
  delete r.deletedAt;
  const id = await req2p(tx(store, 'readwrite').add(r));
  Object.assign(obj, { id, uid: r.uid, updatedAt: r.updatedAt });
  return id;
}

/*
 * Guarda un registro editado. Dos protecciones:
 *  · Si el registro cambió en otro aparato después de abrir el formulario, no
 *    se pisa a ciegas: se avisa para que se vuelva a abrir con lo nuevo.
 *  · Si otro aparato lo borró mientras tanto, no se resucita.
 */
export async function put(store, obj) {
  const r = { ...obj };
  if (r.id != null) {
    const prev = await get(store, r.id);
    if (prev) {
      if (prev.deletedAt) {
        throw new Error('Este registro se eliminó desde otro dispositivo. Cierra y vuelve a abrirlo.');
      }
      if (obj.updatedAt && instante(prev.updatedAt) > instante(obj.updatedAt)) {
        throw new Error('Este registro cambió en otro dispositivo. Cierra el formulario y vuelve a abrirlo.');
      }
      if (!r.uid) r.uid = prev.uid;
    }
  }
  if (!r.uid) r.uid = claveEstable(store, r) + sufijoUnico();
  r.updatedAt = ahora();
  r.pendienteSubir = r.updatedAt;
  const id = await req2p(tx(store, 'readwrite').put(r));
  // El objeto que nos dieron sigue vivo en la pantalla: que sepa que ya se guardó.
  Object.assign(obj, { id, uid: r.uid, updatedAt: r.updatedAt });
  return id;
}

// Borrado lógico: se marca para que el otro dispositivo también lo borre.
export async function del(store, id) {
  const r = await get(store, id);
  if (!r) return;
  r.deletedAt = ahora();
  r.updatedAt = r.deletedAt;
  r.pendienteSubir = r.updatedAt;
  return req2p(tx(store, 'readwrite').put(r));
}

// Guarda tal cual, sin tocar updatedAt ni marcar pendiente (lo usa la
// sincronización al bajar: lo que viene de la nube ya está en la nube).
export function putCrudo(store, obj) {
  return req2p(tx(store, 'readwrite').put(obj));
}

// Quita la marca de "pendiente" SOLO si el registro no cambió después de
// subirse (si cambió, la marca nueva es otra y se queda para la próxima).
export async function marcarSubido(store, uid, versionSubida) {
  const r = await getPorUid(store, uid);
  if (!r || r.pendienteSubir !== versionSubida) return;
  delete r.pendienteSubir;
  await putCrudo(store, r);
}

// Carga en bloque. Nunca inventa identidad al azar: si una fila no trae uid,
// se le calcula por contenido con desempate estable (mismo resultado en todos
// los aparatos para los mismos datos).
export function bulkAdd(store, objs, { sello = null, pendiente = true } = {}) {
  return new Promise((res, rej) => {
    const t = _db.transaction(store, 'readwrite');
    const os = t.objectStore(store);
    const usados = new Set();
    for (const o of objs) {
      const r = { ...o };
      delete r.id;
      if (!r.uid) {
        const base = claveEstable(store, r);
        let uid = base, n = 0;
        while (usados.has(uid)) uid = `${base}#${++n}`;
        r.uid = uid;
      }
      usados.add(r.uid);
      if (sello) r.updatedAt = sello;
      if (!r.updatedAt) r.updatedAt = SELLO_LEGADO;
      if (pendiente) r.pendienteSubir = r.updatedAt;
      os.add(r);
    }
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export function clear(store) { return req2p(tx(store, 'readwrite').clear()); }

export async function metaGet(key) {
  const r = await req2p(tx('meta').get(key));
  return r ? r.value : undefined;
}
export function metaSet(key, value) { return req2p(tx('meta', 'readwrite').put({ key, value })); }
export function metaDel(key) { return req2p(tx('meta', 'readwrite').delete(key)); }

// Identidad CALCULADA a partir del contenido del registro. Es la base del uid:
// legible, y determinística para la semilla y para los datos de antes de la
// sincronización (que deben llegar al mismo uid en todos los aparatos).
// Los registros nuevos le agregan además un sufijo único por aparato.
const norm = v => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

export function claveEstable(store, r) {
  switch (store) {
    case 'vacas':        return `vaca:${norm(r.chapeta)}`;
    case 'terneros':     return `ternero:${norm(r.nombre)}`;
    case 'prenez':       return `prenez:${norm(r.chapeta)}:${r.fechaPrenez || ''}`;
    case 'servicios':    return `serv:${norm(r.chapeta)}:${r.fecha || ''}:${r.tipo || ''}`;
    case 'pesajes':      return `pesaje:${norm(r.nombre)}:${r.fecha || ''}`;
    case 'tratamientos': return `trat:${r.fecha || ''}:${norm(r.producto)}:${norm(r.aplicadoA)}`;
    case 'eventos':      return `evt:${r.timestamp || ''}:${norm(r.refId)}:${norm(r.tipo)}:${r.fecha || ''}`;
    case 'ajustes':      return 'ajustes:finca'; // un solo registro para toda la finca
    default:             return `${store}:?`;
  }
}

// Los datos guardados antes de la sincronización no tienen uid. Se les calcula
// uno estable (por contenido, mismo resultado en todos los aparatos) y se
// sellan como "legado": más viejos que cualquier corrección posterior.
async function completarUids() {
  for (const s of STORES) {
    const filas = await allRaw(s);
    const usados = new Set(filas.map(r => r.uid).filter(Boolean));
    // Orden estable (por id) para que el desempate sea igual en todos lados.
    for (const r of filas.sort((a, b) => (a.id || 0) - (b.id || 0))) {
      if (r.uid && r.updatedAt) continue;
      if (!r.uid) {
        const base = claveEstable(s, r);
        let uid = base, n = 0;
        while (usados.has(uid)) uid = `${base}#${++n}`;
        usados.add(uid);
        r.uid = uid;
      }
      if (!r.updatedAt) r.updatedAt = SELLO_LEGADO;
      r.pendienteSubir = r.updatedAt;
      await putCrudo(s, r);
    }
  }
}

/*
 * Semilla: los datos del hato que vienen con la app.
 * Se FUSIONA, nunca reemplaza: cada fila de la semilla entra solo si el
 * aparato no la tiene o si la suya es más vieja (gana el más nuevo, igual
 * que con la nube). Así una versión nueva de la app trae las correcciones sin
 * borrar lo que se registró después, y no importa el orden en que lleguen la
 * semilla, la nube y los registros propios.
 * Antes de aplicar una semilla nueva se guarda una copia de lo que había.
 */
async function aplicarSeed() {
  const versionLocal = await metaGet('seedVersion');
  const primeraVez = !(await metaGet('seeded'));
  if (!primeraVez && versionLocal === SEED_VERSION) return;

  if (!primeraVez) {
    try {
      const copia = {};
      for (const s of STORES) copia[s] = await allRaw(s);
      const lista = (await metaGet('respaldosPrevios')) || [];
      lista.unshift({ fecha: ahora(), versionAnterior: versionLocal || '(inicial)', datos: copia });
      await metaSet('respaldosPrevios', lista.slice(0, 3)); // las últimas 3 copias
    } catch { /* si falla la copia, seguimos: la semilla es la fuente buena */ }
  }

  let cambios = 0;
  for (const s of STORES) {
    for (const fila of (SEED[s] || [])) {
      const local = await getPorUid(s, fila.uid);
      if (local && instante(fila.updatedAt) <= instante(local.updatedAt)) continue;
      const r = { ...fila, pendienteSubir: fila.updatedAt };
      if (local) r.id = local.id;
      await putCrudo(s, r);
      cambios++;
    }
  }
  if (primeraVez) await metaSet('seeded', ahora());
  await metaSet('seedVersion', SEED_VERSION);
  datosActualizados = !primeraVez && cambios > 0;
}

// Copias de seguridad guardadas antes de cada actualización de datos (máx. 3).
export async function respaldosPrevios() {
  const lista = (await metaGet('respaldosPrevios')) || [];
  const viejo = await metaGet('respaldoPrevio'); // formato anterior, una sola copia
  return viejo ? [...lista, viejo] : lista;
}

// Estado completo en memoria (la finca es pequeña: leer todo es instantáneo)
export async function loadState() {
  const listas = await Promise.all(STORES.map(s => all(s)));
  return Object.fromEntries(STORES.map((s, i) => [s, listas[i]]));
}

// ── Respaldo ──────────────────────────────────────────────────────
// Incluye los borrados (con su marca) para que, al restaurar, un borrado no
// vuelva a la vida.
export async function exportarTodo() {
  const datos = {};
  for (const s of STORES) datos[s] = (await allRaw(s)).map(({ pendienteSubir, ...r }) => r);
  return { app: 'ganaderia-la-piedad', version: DB_VERSION, exportado: ahora(), datos };
}

/*
 * Restaurar es un acto deliberado del dueño: lo restaurado se sella como lo
 * más nuevo, gana sobre lo que haya en la nube y se sube todo. Lo que la nube
 * tenga y el respaldo no, vuelve a bajar en la siguiente sincronización.
 */
export async function importarTodo(respaldo) {
  if (!respaldo || respaldo.app !== 'ganaderia-la-piedad' || !respaldo.datos) {
    throw new Error('El archivo no es un respaldo válido de esta app.');
  }
  const sello = ahora();
  for (const s of STORES) {
    await clear(s);
    const filas = (respaldo.datos[s] || []).map(({ id, pendienteSubir, ...resto }) => resto);
    if (filas.length) await bulkAdd(s, filas, { sello, pendiente: true });
  }
  await metaSet('seeded', 'import:' + sello);
  await metaDel('cursorSync'); // que la próxima sincronización baje todo de nuevo
}
