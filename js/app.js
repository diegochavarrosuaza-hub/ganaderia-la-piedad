// app.js — arranque, navegación entre pestañas y estado global
import * as db from './db.js';
import { initDB, loadState } from './db.js';
import { toast } from './ui.js';
import * as sync from './sync.js';
import * as logic from './logic.js';
import { abrirBuscador } from './buscar.js';
import * as dashboard from './views/dashboard.js';
import * as vacas from './views/vacas.js';
import * as toros from './views/toros.js';
import * as terneros from './views/terneros.js';
import * as reproduccion from './views/reproduccion.js';
import * as sanidad from './views/sanidad.js';
import * as pesajes from './views/pesajes.js';
import * as eventos from './views/eventos.js';
import * as respaldo from './views/respaldo.js';

const VISTAS = { inicio: dashboard, vacas, toros, terneros, reproduccion, sanidad, pesajes, eventos, respaldo };

const ctx = {
  state: null,
  vistaActual: 'inicio',
  nav: irA,
  refresh,
  sincronizar: opciones => sincronizar(opciones),
};

async function refresh() {
  ctx.state = await loadState();
  // El nombre de la finca se puede cambiar en Ajustes.
  const h1 = document.querySelector('.topbar h1');
  if (h1) h1.textContent = '🐄 ' + logic.ajustes(ctx.state).finca;
  renderVista();
}

function renderVista() {
  const el = document.getElementById('view');
  const vista = VISTAS[ctx.vistaActual] || dashboard;
  el.innerHTML = '';
  vista.render(el, ctx);
  window.scrollTo({ top: 0 });
}

function irA(nombre, opciones) {
  if (!VISTAS[nombre]) return;
  ctx.vistaActual = nombre;
  ctx.opciones = opciones || null; // p. ej. { filtro: 'SIN_SERVICIO' }
  document.querySelectorAll('.tabs .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.nav === nombre));
  renderVista();
}

async function main() {
  try {
    // Antes de initDB: si llegó por enlace, el aparato ya arranca sabiendo
    // que hay nube, y no siembra datos viejos encima de los buenos.
    const porEnlace = sync.configDesdeEnlace();
    await initDB();
    await refresh();
    if (db.datosActualizados) {
      toast('✅ Datos del hato actualizados a la última versión.', 'info');
    }
    if (porEnlace) {
      toast('🔗 Este dispositivo quedó conectado. Sincronizando…', 'info');
    }
    sincronizar({ silencioso: true });
  } catch (err) {
    document.getElementById('view').innerHTML =
      `<div class="card"><h2>😕 Algo falló al abrir la app</h2>
       <p style="font-size:14px;">${err.message}</p></div>`;
    return;
  }

  // ── Sincronización entre dispositivos ──────────────────────────
  // Al volver el internet y cada 5 minutos, para que la tablet y el celular
  // se mantengan al día solos.
  // Si la app YA estaba abierta, tocar el enlace de configuración solo cambia
  // el # y el navegador no recarga: sin esto no pasaría nada y la clave se
  // quedaría a la vista en la dirección.
  window.addEventListener('hashchange', () => {
    if (sync.configDesdeEnlace()) location.reload();
  });

  window.addEventListener('online', () => sincronizar({ silencioso: true }));
  window.addEventListener('offline', () => pintarEstadoSync());
  setInterval(() => sincronizar({ silencioso: true }), 5 * 60 * 1000);

  // La barra de pestañas se pega justo debajo del encabezado, mida lo que mida
  const ajustarTopbar = () => {
    const h = document.querySelector('.topbar').offsetHeight;
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
  };
  ajustarTopbar();
  window.addEventListener('resize', ajustarTopbar);

  // Al rotar el celular o cambiar el tamaño, re-dibujar la vista para que las
  // gráficas recalculen su geometría al nuevo ancho (con un pequeño respiro).
  let reflowT;
  const reflow = () => { clearTimeout(reflowT); reflowT = setTimeout(renderVista, 180); };
  window.addEventListener('resize', reflow);
  window.addEventListener('orientationchange', reflow);

  // Navegación (pestañas y botones con data-nav)
  document.getElementById('tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-nav]');
    if (tab) irA(tab.dataset.nav);
  });
  // Lupa de la cabecera: buscar cualquier animal desde cualquier pantalla.
  document.getElementById('btn-buscar').addEventListener('click', () => abrirBuscador(ctx));
  document.querySelector('.topbar').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]');
    if (b) irA(b.dataset.nav);
  });

  // Service worker para funcionar sin internet
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Cuando entra una versión nueva de la app, recargar una sola vez para que
    // el usuario la vea de inmediato (sin tener que abrirla dos veces).
    let recargando = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (recargando) return;
      recargando = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => { /* opcional */ });
  }
}

// Sincroniza y refresca la pantalla si llegaron datos nuevos de otro aparato.
// (El candado contra dos corridas a la vez vive en sync.js.)
export async function sincronizar({ silencioso = false } = {}) {
  if (!sync.haySync()) { pintarEstadoSync(); return null; }
  pintarEstadoSync('trabajando');
  try {
    const r = await sync.sincronizar();
    if (r && r.ok) {
      if (r.bajados > 0) {
        await refresh();
        toast(`🔄 Llegaron ${r.bajados} cambio(s) de otro dispositivo.`, 'info');
      } else if (!silencioso) {
        toast(r.errorSubida ? 'Se bajó lo nuevo, pero no se pudo subir lo de aquí: ' + r.errorSubida
          : '🔄 Todo está al día.', r.errorSubida ? 'error' : 'info');
      }
    } else if (!silencioso && r) {
      toast(r.motivo === 'sin-internet'
        ? 'Sin internet: se sincronizará cuando vuelva la señal.'
        : 'La sincronización no está configurada.', 'info');
    }
    pintarEstadoSync();
    return r;
  } catch (err) {
    if (!silencioso) toast('No se pudo sincronizar: ' + err.message, 'error');
    pintarEstadoSync('error');
    return null;
  }
}

// Pastilla en la cabecera: que se vea de un vistazo si los aparatos están al
// día. Un problema silencioso de semanas es peor que un aviso feo.
async function pintarEstadoSync(modo) {
  const pill = document.getElementById('sync-pill');
  if (!pill) return;
  if (!sync.haySync()) { pill.hidden = true; return; }
  pill.hidden = false;
  pill.className = 'sync-pill';
  if (modo === 'trabajando') { pill.textContent = '🔄 sincronizando…'; return; }
  if (!navigator.onLine) { pill.textContent = '📴 sin señal'; pill.classList.add('off'); return; }
  const [ok, err, pend] = await Promise.all([sync.ultimaSync(), sync.ultimoError(), sync.pendientesDeSubir()]);
  const horas = ok ? (Date.now() - Date.parse(ok)) / 36e5 : Infinity;
  if (modo === 'error' || err || horas > 24) {
    pill.classList.add('mal');
    pill.textContent = ok ? `⚠️ sin sincronizar desde ${new Date(ok).toLocaleDateString('es-CO')}` : '⚠️ no sincroniza';
    pill.title = err ? err.error : 'Revisa el internet o la configuración en Respaldo';
  } else {
    pill.textContent = pend ? `☁️ ${pend} por subir` : '☁️ al día';
    pill.title = 'Última sincronización: ' + new Date(ok).toLocaleString('es-CO');
  }
}

main();
