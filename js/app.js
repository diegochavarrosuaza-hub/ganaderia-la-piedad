// app.js — arranque, navegación entre pestañas y estado global
import { initDB, loadState } from './db.js';
import * as dashboard from './views/dashboard.js';
import * as vacas from './views/vacas.js';
import * as terneros from './views/terneros.js';
import * as reproduccion from './views/reproduccion.js';
import * as pesajes from './views/pesajes.js';
import * as eventos from './views/eventos.js';
import * as respaldo from './views/respaldo.js';

const VISTAS = { inicio: dashboard, vacas, terneros, reproduccion, pesajes, eventos, respaldo };

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

function irA(nombre) {
  if (!VISTAS[nombre]) return;
  ctx.vistaActual = nombre;
  document.querySelectorAll('.tabs .tab').forEach(t =>
    t.classList.toggle('active', t.dataset.nav === nombre));
  renderVista();
}

async function main() {
  try {
    await initDB();
    ctx.state = await loadState();
    renderVista();
  } catch (err) {
    document.getElementById('view').innerHTML =
      `<div class="card"><h2>😕 Algo falló al abrir la app</h2>
       <p style="font-size:14px;">${err.message}</p></div>`;
    return;
  }

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
    navigator.serviceWorker.register('sw.js').catch(() => { /* opcional */ });
  }
}

main();
