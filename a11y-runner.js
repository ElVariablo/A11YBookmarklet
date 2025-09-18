/* a11y-runner.js
   - Gemeinsames Framework + Overlay
   - Steps registrieren sich via A11Y.registerStep({ id, title, run(doc), meta })
   - A11Y.runAll() führt alle registrierten Steps aus und baut einen Gesamtbericht
*/
(function () {
  if (window.A11Y && window.A11Y.__coreLoaded) return;

  const A11Y = window.A11Y = window.A11Y || {};
  A11Y.__coreLoaded = true;

  // ===== Utils (geteilt) =====
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const getText = (el) => el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
  const getAttr = (el, name) => (el.getAttribute && el.getAttribute(name)) || null;
  const truncate = (str, n = 280) => (str || '').replace(/\s+/g, ' ').trim().slice(0, n) + ((str || '').length > n ? '…' : '');
  const cssPath = (el) => {
    if (!(el instanceof Element)) return '';
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && el !== document.documentElement) {
      let sel = el.nodeName.toLowerCase();
      if (el.id) { sel += '#' + CSS.escape(el.id); parts.unshift(sel); break; }
      if (el.classList.length) sel += '.' + Array.from(el.classList).map(c => CSS.escape(c)).join('.');
      const sibs = el.parentNode ? Array.from(el.parentNode.children).filter(e => e.tagName === el.tagName) : [];
      if (sibs.length > 1) sel += `:nth-of-type(${sibs.indexOf(el) + 1})`;
      parts.unshift(sel);
      el = el.parentElement;
    }
    return parts.join(' > ');
  };
  const overlayId = 'a11y-overlay';

  A11Y.utils = { $$, getText, getAttr, truncate, cssPath };

  // ===== Step-Registry =====
  const steps = new Map();
  A11Y.registerStep = function (step) {
    // step: { id: '1.1.1', title: 'Nicht-Text-Inhalte', run(doc): {findings, summary}, meta: {...} }
    if (!step || !step.id || !step.title || typeof step.run !== 'function') return;
    steps.set(step.id, step);
  };

  // ===== Aggregation =====
  function aggregate(reports) {
    // reports: [{ id, title, findings:[], summary:{bewertung, statistik, verbesserungen} }]
    const out = {
      seite: location.href,
      timestamp: new Date().toISOString(),
      kriterien: reports.map(r => ({ id: r.id, title: r.title, bewertung: r.summary.bewertung })),
      bewertungGesamt: 'erfüllt',
      statistikGesamt: { schritte: reports.length, fehler: 0, anwendbar: 0, bestanden: 0 },
      verbesserungen: [],
      findings: {} // pro Schritt
    };

    const allHints = [];
    let anyApplicable = false;
    let anyFail = false;

    reports.forEach(r => {
      out.findings[r.id] = r.findings;
      out.statistikGesamt.fehler += (r.summary.statistik?.fehler || 0);
      out.statistikGesamt.anwendbar += (r.summary.statistik?.anwendbar || 0);
      out.statistikGesamt.bestanden += (r.summary.statistik?.bestanden || 0);
      (r.summary.verbesserungen || []).forEach(h => allHints.push(h));
      if (r.summary.bewertung !== 'nicht anwendbar') anyApplicable = true;
      if (r.summary.bewertung === 'nicht erfüllt') anyFail = true;
    });

    out.verbesserungen = Array.from(new Set(allHints)).slice(0, 10);
    out.bewertungGesamt = !anyApplicable ? 'nicht anwendbar' : (anyFail ? 'nicht erfüllt' : 'erfüllt');
    return out;
  }

  // ===== Overlay UI (gemeinsam) =====
  function renderOverlay(agg, reports) {
    const old = document.getElementById(overlayId);
    if (old) old.remove();

    const style = document.createElement('style');
    style.textContent = `
      #${overlayId}{position:fixed;top:16px;right:16px;z-index:2147483647;width:min(640px,92vw);max-height:82vh;overflow:auto;background:#111;color:#f4f4f4;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.45);font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
      #${overlayId} header{padding:12px 16px;border-bottom:1px solid #333;display:flex;gap:12px;align-items:center}
      #${overlayId} .badge{padding:4px 8px;border-radius:999px;font-size:12px;text-transform:uppercase;letter-spacing:.02em}
      #${overlayId} .ok{background:#123;color:#9fd} .fail{background:#311;color:#f99} .na{background:#222;color:#aaa}
      #${overlayId} .meta{padding:10px 16px;border-bottom:1px solid #333;display:grid;grid-template-columns:1fr 1fr;gap:8px}
      #${overlayId} .meta div{background:#1a1a1a;padding:8px 10px;border-radius:8px;font-size:12px}
      #${overlayId} .actions{padding:10px 16px;border-bottom:1px solid #333;display:flex;gap:8px;flex-wrap:wrap}
      #${overlayId} button{background:#2a2a2a;color:#fff;border:1px solid #444;border-radius:8px;padding:8px 10px;cursor:pointer}
      #${overlayId} button:hover{background:#333}
      #${overlayId} .section{padding:10px 16px}
      #${overlayId} .step{border:1px solid #2a2a2a;border-radius:10px;margin-bottom:10px;background:#151515}
      #${overla
