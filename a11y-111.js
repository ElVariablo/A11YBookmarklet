/* a11y-111.js – WCAG 1.1.1 Nicht-Text-Inhalte (Modul) */
(function(){
  if (!window.A11Y || !window.A11Y.registerStep) return;

  const { $$, getText, getAttr, truncate, cssPath } = window.A11Y.utils;

  function accessibleName(el) {
    if (!el) return '';
    const ariaLabel = getAttr(el, 'aria-label'); if (ariaLabel) return ariaLabel.trim();
    const labelledby = getAttr(el, 'aria-labelledby');
    if (labelledby) {
      const txt = labelledby.split(/\s+/).map(id => document.getElementById(id)).filter(Boolean).map(n => n.textContent.trim()).join(' ').trim();
      if (txt) return txt;
    }
    if (el.matches && el.matches('svg, svg *')) {
      const svg = el.closest('svg');
      if (svg) {
        const t = svg.querySelector(':scope > title'); if (t && t.textContent.trim()) return t.textContent.trim();
        const d = svg.querySelector(':scope > desc');  if (d && d.textContent.trim()) return d.textContent.trim();
      }
    }
    const control = el.closest('a,button,[role="button"],[role="link"]');
    if (control) { const txt = control.textContent.trim().replace(/\s+/g,' '); if (txt) return txt; }
    return '';
  }
  function filenameFromSrc(src) {
    try { const u = new URL(src, location.href); const name = (u.pathname.split('/').pop()||'').replace(/\.[a-z0-9]+$/i,''); return name.replace(/[-_]+/g,' '); }
    catch { return ''; }
  }
  function isDecorativeByRole(el) {
    const role = (getAttr(el, 'role') || '').toLowerCase();
    if (role === 'presentation' || role === 'none') return true;
    if (getAttr(el, 'aria-hidden') === 'true') return true;
    return false;
  }
  function hasBGImage(el) { return /\burl\(/i.test(getComputedStyle(el).backgroundImage || ''); }

  function collectCandidates() {
    const items = [];
    $$('img').forEach(img => items.push({ type: 'img', el: img }));
    $$('input[type="image"]').forEach(el => items.push({ type: 'input-image', el }));
    $$('area').forEach(el => items.push({ type: 'area', el }));
    $$('svg[role="img"], svg[aria-label], svg[aria-labelledby], svg title, svg desc').forEach(n => { const svg = n.closest('svg'); if (svg) items.push({ type: 'svg', el: svg }); });
    $$('object, embed').forEach(el => { const t=(getAttr(el,'type')||'').toLowerCase(); if (t.startsWith('image/')) items.push({ type: el.tagName.toLowerCase(), el }); });
    $$('a, button, [role="button"], [role="link"], figure, .icon, .logo, [class*="icon"], [class*="logo"]').forEach(el => { if (hasBGImage(el)) items.push({ type: 'css-bg', el }); });
    const seen = new Set(); return items.filter(i => { if (seen.has(i.el)) return false; seen.add(i.el); return true; });
  }

  function evaluate(item) {
    const { el, type } = item;
    const tag = el.tagName.toLowerCase();
    const src = (tag === 'img' && (el.currentSrc || el.src)) || getAttr(el,'src') || getAttr(el,'data-src') || '';
    const rect = el.getBoundingClientRect();
    const box = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
    const selector = cssPath(el);
    const outer = (el.outerHTML || '').slice(0, 4000);
    const isHidden = (el.offsetParent === null && !el.matches('area')) || getComputedStyle(el).visibility === 'hidden';
    const isDecor = isDecorativeByRole(el);

    let alt = null, name = '', issues = [], hints = [];

    if (type === 'img') {
      alt = getAttr(el,'alt'); name = accessibleName(el);
      if (isHidden || isDecor) {
        if (alt !== '') { issues.push('Dekoratives/ausgeblendetes Bild sollte alt="" haben.'); hints.push('Setze alt="" und ggf. role="presentation" oder aria-hidden="true".'); }
      } else {
        if (alt == null) { issues.push('Fehlendes alt-Attribut.'); hints.push('Füge ein aussagekräftiges alt hinzu, das den Bildzweck beschreibt.'); }
        else if (alt.trim() === '') { issues.push('Leeres alt, vermutlich nicht dekorativ.'); hints.push('Nutze einen sinnvollen Alternativtext.'); }
        else {
          const fileGuess = filenameFromSrc(src);
          if (fileGuess && alt.trim().toLowerCase() === fileGuess.trim().toLowerCase()) { issues.push('Alt entspricht dem Dateinamen.'); hints.push('Beschreibe Sinn/Zweck statt Dateiname.'); }
          if (/\.(jpg|jpeg|png|gif|webp|svg)\b/i.test(alt)) { issues.push('Alt enthält Dateiendung.'); hints.push('Entferne Dateiendungen aus alt.'); }
        }
      }
    } else if (type === 'input-image') {
      alt = getAttr(el,'alt'); if (!alt || !alt.trim()) { issues.push('<input type="image"> benötigt beschreibendes alt.'); hints.push('Alt sollte die Funktion (z. B. „Suchen“) beschreiben.'); }
    } else if (type === 'area') {
      alt = getAttr(el,'alt'); if (!alt || !alt.trim()) { issues.push('<area> benötigt alt.'); hints.push('Beschreibe Ziel/Zweck der Fläche.'); }
    } else if (type === 'svg') {
      name = accessibleName(el); if (!isDecor && !name) { issues.push('SVG ohne zugänglichen Namen.'); hints.push('Füge aria-label/aria-labelledby oder <title> hinzu oder markiere dekorativ.'); }
    } else if (type === 'object' || type === 'embed') {
      name = accessibleName(el); if (!isDecor && !name) { issues.push(`<${type}> mit Bildinhalt ohne zugänglichen Namen.`); hints.push('Setze title/aria-label oder gleichwertigen Text im Kontext.'); }
    } else if (type === 'css-bg') {
      name = accessibleName(el); const hasText = getText(el).length > 0;
      if (!isDecor && !hasText && !name) { issues.push('CSS-Hintergrundbild könnte Information ohne Alt transportieren.'); hints.push('Füge sichtbaren/visually hidden Text oder aria-label hinzu.'); }
    }

    if (type === 'img' && !isDecor) {
      if (/(logo)/i.test(src) && alt && !/logo/i.test(alt)) hints.push('Ist es ein Logo? Alt kann den Organisationsnamen enthalten.');
      if (el.closest('a')) hints.push('Bei verlinkten Bildern muss der Linkzweck über Alt/Linktext klar werden.');
    }

    return { kind: '1.1.1', type, tag, selector, src: src || null, alt: alt ?? null, name: name || null,
      hidden: !!isHidden, decorative: !!isDecor, box, outer, status: issues.length ? 'fail' : 'pass', issues, hints: Array.from(new Set(hints)) };
  }

  function summarize(results) {
    const fails = results.filter(r => r.status === 'fail');
    const applicable = results.filter(r => !(r.decorative || r.hidden) || r.type === 'input-image' || r.type === 'area');
    const bewertung = applicable.length === 0 ? 'nicht anwendbar' : (fails.length ? 'nicht erfüllt' : 'erfüllt');
    const allHints = []; results.forEach(r => r.hints.forEach(h => allHints.push(h)));
    return {
      bewertung,
      statistik: {
        gesamtGefunden: results.length,
        anwendbar: applicable.length,
        fehler: fails.length,
        bestanden: results.filter(r => r.status === 'pass').length
      },
      verbesserungen: Array.from(new Set(allHints)).slice(0, 6)
    };
  }

  window.A11Y.registerStep({
    id: '1.1.1',
    title: 'Nicht-Text-Inhalte',
    async run(doc) {
      const candidates = collectCandidates();
      const results = candidates.map(evaluate);
      return { findings: results, summary: summarize(results) };
    }
  });
})();
