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
      #${overlayId} .step > .head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #2a2a2a}
      #${overlayId} details{padding:8px 12px}
      #${overlayId} code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:#0f0f0f;padding:2px 4px;border-radius:4px}
      #${overlayId} .item{border:1px solid #292929;border-radius:8px;padding:10px;margin:8px 0;background:#161616}
      #${overlayId} .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      #${overlayId} .close{margin-left:auto}
    `;
    document.head.appendChild(style);

    const badgeClass = agg.bewertungGesamt === 'erfüllt' ? 'ok' : (agg.bewertungGesamt === 'nicht erfüllt' ? 'fail' : 'na');

    const el = document.createElement('section');
    el.id = overlayId;
    el.innerHTML = `
      <header>
        <strong>WCAG Bericht</strong>
        <span class="badge ${badgeClass}">${agg.bewertungGesamt}</span>
        <button class="close">✕</button>
      </header>
      <div class="meta">
        <div><strong>Seite</strong><br><small>${A11Y.utils.truncate(agg.seite, 80)}</small></div>
        <div><strong>Zeit</strong><br><small>${new Date(agg.timestamp).toLocaleString()}</small></div>
        <div><strong>Anwendbar</strong><br><small>${agg.statistikGesamt.anwendbar}</small></div>
        <div><strong>Fehler</strong><br><small>${agg.statistikGesamt.fehler}</small></div>
      </div>
      <div class="actions">
        <button data-act="copy">Als JSON kopieren</button>
        <button data-act="hl-fails">Fehler hervorheben</button>
        <button data-act="hl-clear">Hervorhebung entfernen</button>
      </div>
      <div class="section">
        <h4 style="margin:0 0 6px">Prüfschritte</h4>
        ${reports.map(r => {
          const b = r.summary.bewertung === 'erfüllt' ? 'ok' : (r.summary.bewertung === 'nicht erfüllt' ? 'fail' : 'na');
          return `
            <div class="step" data-step="${r.id}">
              <div class="head">
                <div><span class="badge ${b}">${r.summary.bewertung}</span> <strong>${r.id}</strong> – ${r.title}</div>
                <small>anwendbar: ${r.summary.statistik?.anwendbar || 0} &nbsp; fehler: ${r.summary.statistik?.fehler || 0}</small>
              </div>
              <details>
                <summary>Details & Findings</summary>
                ${r.findings.length ? r.findings.map((f,i) => {
                  const b2 = f.status === 'pass' ? 'ok' : 'fail';
                  return `
                    <div class="item">
                      <div class="grid2">
                        <div><span class="badge ${b2}">${f.status === 'pass' ? 'OK' : 'Fehler'}</span> <strong>${f.kind || f.type || '-'}</strong></div>
                        <div><small>${f.box ? `${f.box.w||0}×${f.box.h||0}` : ''} ${f.selector ? '@ ' + A11Y.utils.truncate(f.selector, 80) : ''}</small></div>
                      </div>
                      ${f.selector ? `<div><strong>Selektor:</strong> <code>${f.selector}</code></div>` : ''}
                      ${f.src ? `<div><strong>Quelle:</strong> <code>${A11Y.utils.truncate(f.src, 160)}</code></div>` : ''}
                      ${typeof f.alt !== 'undefined' ? `<div><strong>alt:</strong> <code>${String(f.alt)}</code></div>` : ''}
                      ${f.name ? `<div><strong>Name/Label:</strong> <code>${A11Y.utils.truncate(f.name, 160)}</code></div>` : ''}
                      ${f.issues?.length ? `<div><strong>Probleme:</strong><ul>${f.issues.map(x=>`<li>${x}</li>`).join('')}</ul></div>` : `<div><strong>Probleme:</strong> –</div>`}
                      ${f.hints?.length ? `<div><strong>Verbesserungen:</strong><ul>${f.hints.map(x=>`<li>${x}</li>`).join('')}</ul></div>` : ''}
                      ${f.outer ? `<details><summary>HTML-Auszug</summary><pre><code>${(f.outer||'').replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]))}</code></pre></details>` : ''}
                    </div>
                  `;
                }).join('') : '<div class="item"><em>Keine Findings.</em></div>'}
              </details>
            </div>
          `;
        }).join('')}
        ${agg.verbesserungen.length ? `<div style="margin-top:10px"><strong>Top-Verbesserungen:</strong><ul>${agg.verbesserungen.map(h=>`<li>${h}</li>`).join('')}</ul></div>` : ''}
      </div>
    `;
    document.body.appendChild(el);

    el.querySelector('.close').addEventListener('click', () => el.remove());
    el.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(JSON.stringify({ aggregate: agg, reports }, null, 2)); alert('Bericht kopiert.'); }
      catch { prompt('Kopieren fehlgeschlagen – manuell kopieren:', JSON.stringify({ aggregate: agg, reports })); }
    });

    // Highlighting
    let highlights = [];
    el.querySelector('[data-act="hl-fails"]').addEventListener('click', () => {
      highlights.forEach(h => h.remove()); highlights = [];
      reports.forEach(r => r.findings.filter(f => f.status === 'fail' && f.selector).forEach(f => {
        const node = document.querySelector(f.selector);
        if (!node) return;
        const rect = node.getBoundingClientRect();
        const hi = document.createElement('div');
        hi.style.position = 'fixed';
        hi.style.left = rect.left + 'px';
        hi.style.top = rect.top + 'px';
        hi.style.width = rect.width + 'px';
        hi.style.height = rect.height + 'px';
        hi.style.border = '2px solid #ff6666';
        hi.style.background = 'rgba(255,0,0,.07)';
        hi.style.pointerEvents = 'none';
        hi.style.zIndex = 2147483646;
        document.body.appendChild(hi);
        highlights.push(hi);
      }));
    });
    el.querySelector('[data-act="hl-clear"]').addEventListener('click', () => { highlights.forEach(h => h.remove()); highlights = []; });
  }

  // ===== Runner =====
  A11Y.runAll = async function () {
    const all = Array.from(steps.values());
    if (!all.length) { alert('Keine Prüfschritte registriert.'); return; }

    const reports = [];
    for (const s of all) {
      try {
        const r = await s.run(document);
        reports.push({ id: s.id, title: s.title, findings: r.findings || [], summary: r.summary || { bewertung: 'nicht anwendbar', statistik: {} } });
      } catch (e) {
        reports.push({ id: s.id, title: s.title, findings: [], summary: { bewertung: 'nicht anwendbar', statistik: {}, fehler: 0, error: String(e) } });
        console.error('Fehler im Prüfschritt', s.id, e);
      }
    }
    const agg = aggregate(reports);
    renderOverlay(agg, reports);
    console.groupCollapsed('%cWCAG Gesamtbericht', 'color:#0ff'); console.log({ aggregate: agg, reports }); console.groupEnd();
    return { aggregate: agg, reports };
  };
})();
