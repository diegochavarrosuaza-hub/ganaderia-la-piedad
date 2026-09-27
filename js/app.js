// app.js — arranque, navegación entre pestañas y estado global
import * as db from './db.js';
import { initDB, loadState } from './db.js';
import { toast } from './ui.js';
import * as sync from './sync.js';
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
};

async function refresh() {
  ctx.state = await loadState();
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
    await initDB();
    ctx.state = await loadState();
    renderVista();
    if (db.datosActualizados) {
      toast('✅ Datos del hato actualizados a la última versión.', 'info');
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
  window.addEventListener('online', () => sincronizar({ silencioso: true }));
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
let sincronizando = false;
export async function sincronizar({ silencioso = false } = {}) {
  if (sincronizando || !sync.haySync()) return null;
  sincronizando = true;
  try {
    const r = await sync.sincronizar();
    if (r && r.ok) {
      if (r.bajados > 0) {
        await refresh();
        toast(`🔄 Llegaron ${r.bajados} cambio(s) de otro dispositivo.`, 'info');
      } else if (!silencioso) {
        toast('🔄 Todo está al día.', 'info');
      }
    } else if (!silencioso && r) {
      toast(r.motivo === 'sin-internet'
        ? 'Sin internet: se sincronizará cuando vuelva la señal.'
        : 'La sincronización no está configurada.', 'info');
    }
    return r;
  } catch (err) {
    if (!silencioso) toast('No se pudo sincronizar: ' + err.message, 'error');
    return null;
  } finally {
    sincronizando = false;
  }
}

main();
