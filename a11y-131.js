/* a11y-131.js – WCAG 1.3.1 Info und Beziehungen (Modul) */
(function(){
  if (!window.A11Y || !window.A11Y.registerStep) return;

  const { $$, getText, getAttr, cssPath } = window.A11Y.utils;

  function boxOf(el){ try{ const r=el.getBoundingClientRect(); return {x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height)} }catch{return {x:0,y:0,w:0,h:0}} }
  const outerHTML = (el) => (el && el.outerHTML ? el.outerHTML.slice(0, 4000) : '');

  // === Checks ===

  function checkHeadings(doc){
    const hs = $$('h1,h2,h3,h4,h5,h6', doc);
    const findings = [];
    if (!hs.length) {
      findings.push({ kind:'1.3.1/headings', status:'fail', issues:['Keine Überschriftenstruktur gefunden.'], hints:['Nutze h1–h6 zur inhaltlichen Gliederung.'], selector:'', outer:'' });
      return findings;
    }
    // optional: warnen, wenn mehrere h1 ohne sinnvolle Struktur
    const levels = hs.map(h => ({ el:h, level: parseInt(h.tagName.substring(1),10) }));
    let prev = 0;
    levels.forEach((h, idx) => {
      const jump = prev ? (h.level - prev) : 0;
      if (prev && jump > 1) {
        findings.push({
          kind:'1.3.1/headings',
          status:'fail',
          issues:[`Übersprungene Hierarchie: von h${prev} zu h${h.level}.`],
          hints:['Überschriften-Hierarchie maximal um 1 Ebene springen (z. B. h2 → h3).'],
          selector: cssPath(h.el), outer: outerHTML(h.el), box: boxOf(h.el)
        });
      }
      prev = h.level;
    });

    // Mehrere h1 – nur Hinweis (kein Fail, je nach Design okay)
    const h1s = hs.filter(h=>h.tagName.toLowerCase()==='h1');
    if (h1s.length > 1) {
      findings.push({
        kind:'1.3.1/headings',
        status:'pass',
        issues:[],
        hints:['Mehrere h1 gefunden – prüfe, ob dies beabsichtigt ist (HTML5 erlaubt mehrere, aber sinnvoll strukturieren).'],
        selector: cssPath(h1s[0]), outer: outerHTML(h1s[0]), box: boxOf(h1s[0])
      });
    }

    // Wenn keine Fehler gemeldet wurden:
    if (!findings.some(f=>f.status==='fail')) {
      findings.push({ kind:'1.3.1/headings', status:'pass', issues:[], hints:['Überschriften-Hierarchie ohne grobe Sprünge.'], selector: cssPath(hs[0]), outer: outerHTML(hs[0]), box: boxOf(hs[0]) });
    }
    return findings;
  }

  function checkLists(doc){
    const findings = [];
    // ul/ol: nur li-Kinder?
    $$('ul,ol', doc).forEach(list => {
      const bad = Array.from(list.children).filter(c => c.tagName.toLowerCase() !== 'li');
      if (bad.length) {
        findings.push({
          kind: '1.3.1/lists',
          status: 'fail',
          issues: ['Liste enthält andere direkte Kindelemente als <li>.'],
          hints: ['Verwende ausschließlich <li> innerhalb von <ul>/<ol>.'],
          selector: cssPath(list), outer: outerHTML(list), box: boxOf(list)
        });
      }
    });
    // "Fake-Listen": viele <br> + Bullet-Zeichen
    $$('p,div', doc).forEach(el => {
      const txt = getText(el);
      const brs = el.querySelectorAll('br').length;
      if (brs >= 2 && /(^|\n|•|\*|-)\s*\S+/.test(txt)) {
        findings.push({
          kind: '1.3.1/lists',
          status: 'fail',
          issues: ['Mögliche Pseudo-Liste mit <br> und Zeichen-Bullets.'],
          hints: ['Nutze semantische Listen (<ul>/<ol> + <li>).'],
          selector: cssPath(el), outer: outerHTML(el), box: boxOf(el)
        });
      }
    });
    if (!findings.length) findings.push({ kind:'1.3.1/lists', status:'pass', issues:[], hints:['Listen-Semantik unauffällig.'], selector:'', outer:'' });
    return findings;
  }

  function isLayoutTable(table){
    // Heuristiken: viele Inline-Styles/width, keine th, role=none/presentation
    const role = (getAttr(table,'role')||'').toLowerCase();
    if (role === 'none' || role === 'presentation') return true;
    const hasTH = !!table.querySelector('th');
    const hasHeadersAttrs = !!table.querySelector('[headers],[scope]');
    const styled = /width|height|border|cellpadding|cellspacing/i.test(table.outerHTML);
    return !hasTH && !hasHeadersAttrs && styled;
  }

  function checkTables(doc){
    const findings = [];
    $$('table', doc).forEach(table => {
      const selector = cssPath(table);
      if (isLayoutTable(table)) {
        findings.push({
          kind:'1.3.1/tables',
          status:'pass',
          issues:[],
          hints:['Tabelle wirkt wie Layout-Tabelle – stelle sicher, dass keine Datenbeziehungen verloren gehen.'],
          selector, outer: outerHTML(table), box: boxOf(table)
        });
        return;
      }
      // Datentabelle erwartet: th existiert
      const ths = table.querySelectorAll('th');
      if (!ths.length) {
        findings.push({
          kind:'1.3.1/tables',
          status:'fail',
          issues:['Datentabelle ohne <th>.'],
          hints:['Kennzeichne Kopfzellen mit <th> und nutze scope="col"/"row" oder headers/id.'],
          selector, outer: outerHTML(table), box: boxOf(table)
        });
      } else {
        // th sollte scope/headers haben (nicht zwingend, aber guter Indikator)
        const missingScope = Array.from(ths).filter(th => !getAttr(th,'scope') && !getAttr(th,'id'));
        if (missingScope.length) {
          findings.push({
            kind:'1.3.1/tables',
            status:'fail',
            issues:[`${missingScope.length} <th> ohne scope/id.`],
            hints:['Setze scope="col"/"row" oder headers/id bei komplexen Tabellen.'],
            selector, outer: outerHTML(table), box: boxOf(table)
          });
        }
      }
      // caption empfehlenswert
      const caption = table.querySelector('caption');
      if (!caption) {
        findings.push({
          kind:'1.3.1/tables',
          status:'pass',
          issues:[],
          hints:['Erwäge <caption>, um den Tabellenzweck zu beschreiben.'],
          selector, outer: outerHTML(table), box: boxOf(table)
        });
      }
    });
    if (!findings.length) findings.push({ kind:'1.3.1/tables', status:'na', issues:[], hints:['Keine Tabellen gefunden.'], selector:'', outer:'' });
    return findings;
  }

  function isFormControl(el){
    const t = el.tagName.toLowerCase();
    if (t === 'input') return (getAttr(el,'type')||'text').toLowerCase() !== 'hidden';
    return ['select','textarea'].includes(t);
  }

  function checkForms(doc){
    const findings = [];
    const controls = $$('input,select,textarea', doc).filter(isFormControl);
    if (!controls.length) {
      findings.push({ kind:'1.3.1/forms', status:'na', issues:[], hints:['Keine Formularfelder gefunden.'], selector:'', outer:'' });
      return findings;
    }
    controls.forEach(ctrl => {
      const id = getAttr(ctrl,'id');
      const ariaLabel = getAttr(ctrl,'aria-label');
      const labelledby = getAttr(ctrl,'aria-labelledby');
      let hasLabel = false;
      if (id && doc.querySelector(`label[for="${CSS.escape(id)}"]`)) hasLabel = true;
      if (ctrl.closest('label')) hasLabel = true;
      if (ariaLabel && ariaLabel.trim()) hasLabel = true;
      if (labelledby && labelledby.trim()) hasLabel = true;

      const issues = [], hints = [];
      if (!hasLabel) {
        issues.push('Formularfeld ohne programmatisch zugeordnetes Label.');
        hints.push('Nutze <label for="…">, um den Zweck des Feldes zu verbinden (oder aria-label/aria-labelledby).');
      }

      // Gruppierung (fieldset/legend) – Heuristik: mehrere Checkboxen mit gleichem name
      if (ctrl.type === 'checkbox' || ctrl.type === 'radio') {
        const name = getAttr(ctrl,'name');
        if (name) {
          const group = $$(`input[type="${ctrl.type}"][name="${CSS.escape(name)}"]`, ctrl.ownerDocument);
          if (group.length >= 2) {
            const fs = ctrl.closest('fieldset');
            if (!fs || !fs.querySelector('legend')) {
              hints.push('Bei Gruppen von Checkboxen/Radios: <fieldset> mit <legend> für Gruppentitel verwenden.');
            }
          }
        }
      }

      findings.push({
        kind:'1.3.1/forms',
        status: issues.length ? 'fail' : 'pass',
        issues, hints,
        selector: cssPath(ctrl), outer: outerHTML(ctrl), box: boxOf(ctrl)
      });
    });
    return findings;
  }

  function checkDefinitionLists(doc){
    const findings = [];
    $$('dl', doc).forEach(dl => {
      const children = Array.from(dl.children).map(c => c.tagName.toLowerCase());
      const invalid = children.some(t => t !== 'dt' && t !== 'dd');
      const hasPair = dl.querySelector('dt') && dl.querySelector('dd');
      if (invalid || !hasPair) {
        findings.push({
          kind:'1.3.1/definitions',
          status:'fail',
          issues:[invalid ? 'DL enthält andere Elemente als dt/dd.' : 'DL ohne dt/dd-Paare.'],
          hints:['Struktur einer Definitionsliste: dt (Term) + dd (Beschreibung).'],
          selector: cssPath(dl), outer: outerHTML(dl), box: boxOf(dl)
        });
      }
    });
    if (!findings.length) findings.push({ kind:'1.3.1/definitions', status:'na', issues:[], hints:['Keine Definitionslisten gefunden.'], selector:'', outer:'' });
    return findings;
  }

  function checkLandmarks(doc){
    const findings = [];
    const landmarks = $$('main,nav,aside,header,footer,[role="main"],[role="navigation"],[role="complementary"],[role="banner"],[role="contentinfo"]', doc);
    if (!landmarks.length) {
      findings.push({ kind:'1.3.1/landmarks', status:'pass', issues:[], hints:['Erwäge ARIA-Landmarks (main/nav/footer …) für bessere Struktur.'], selector:'', outer:'' });
    } else {
      // redundantes role auf nativem Landmark
      landmarks.forEach(el => {
        const t = el.tagName.toLowerCase();
        const role = (getAttr(el,'role')||'').toLowerCase();
        const redundant = (t==='main' && role==='main') || (t==='nav' && role==='navigation') || (t==='aside' && role==='complementary') || (t==='header' && role==='banner') || (t==='footer' && role==='contentinfo');
        if (redundant) {
          findings.push({ kind:'1.3.1/landmarks', status:'pass', issues:[], hints:[`Redundantes role="${role}" auf <${t}> – kann entfernt werden.`], selector: cssPath(el), outer: outerHTML(el), box: boxOf(el) });
        }
      });
    }
    return findings;
  }

  function checkInteractiveNesting(doc){
    const findings = [];
    $$('button a, button button, a button, a a, [role="button"] a, button [role="button"]', doc).forEach(el => {
      findings.push({
        kind:'1.3.1/interactive',
        status:'fail',
        issues:['Verschachtelte interaktive Elemente (z. B. Link in Button) – Beziehungen/Fokus werden unklar.'],
        hints:['Interaktive Elemente nicht ineinander schachteln. Verwende ein einziges interaktives Element.'],
        selector: cssPath(el), outer: outerHTML(el), box: boxOf(el)
      });
    });
    return findings.length ? findings : [{ kind:'1.3.1/interactive', status:'pass', issues:[], hints:['Keine problematischen Verschachtelungen erkannt.'], selector:'', outer:'' }];
  }

  function checkAriaOveruse(doc){
    const findings = [];
    $$('[role]', doc).forEach(el => {
      const role = (getAttr(el,'role')||'').toLowerCase();
      const t = el.tagName.toLowerCase();
      // Beispiele: role="list" auf <ul>, role="img" auf <img>, role="link" auf <a>
      const redundant = (t==='ul' && role==='list') || (t==='ol' && role==='list') || (t==='li' && role==='listitem')
                     || (t==='img' && role==='img') || (t==='a' && role==='link') || (t==='button' && role==='button');
      if (redundant) {
        findings.push({
          kind:'1.3.1/aria',
          status:'pass',
          issues:[],
          hints:[`Redundantes role="${role}" auf <${t}> – native Semantik reicht.`],
          selector: cssPath(el), outer: outerHTML(el), box: boxOf(el)
        });
      }
    });
    return findings.length ? findings : [{ kind:'1.3.1/aria', status:'pass', issues:[], hints:['Kein übermäßiger ARIA-Gebrauch aufgefallen.'], selector:'', outer:'' }];
  }

  function summarize(allFindings){
    const flat = allFindings.flat();
    const applicable = flat.filter(f => f.status !== 'na');
    const fails = flat.filter(f => f.status === 'fail');
    const bewertung = applicable.length === 0 ? 'nicht anwendbar' : (fails.length ? 'nicht erfüllt' : 'erfüllt');
    const hints = Array.from(new Set(flat.flatMap(f => f.hints || []))).slice(0, 8);
    return {
      bewertung,
      statistik: {
        gesamtGefunden: flat.length,
        anwendbar: applicable.length,
        fehler: fails.length,
        bestanden: flat.filter(f => f.status === 'pass').length
      },
      verbesserungen: hints
    };
  }

  window.A11Y.registerStep({
    id: '1.3.1',
    title: 'Info und Beziehungen',
    async run(doc){
      const groups = [
        checkHeadings(doc),
        checkLists(doc),
        checkTables(doc),
        checkForms(doc),
        checkDefinitionLists(doc),
        checkLandmarks(doc),
        checkInteractiveNesting(doc),
        checkAriaOveruse(doc)
      ];
      const findings = groups.flat();
      return { findings, summary: summarize(groups) };
    }
  });
})();
