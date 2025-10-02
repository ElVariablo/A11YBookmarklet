/*
WCAG 1.4.3 Kontrast-Prüfer – Bookmarklet + UI
Autor: ChatGPT (GPT-5 Thinking)
Datum: 2025-10-02

Was es kann:
- Findet Textstellen mit zu geringem Kontrast nach WCAG 1.4.3 (AA)
  • 4.5:1 für normalen Text
  • 3:1 für große Schrift (>= 24px normal ODER >= 18.66px fett)
- UI-Panel mit Liste "Findings": Problem, gemessener Kontrast, Vorschläge, Screenshot-Button, "Zum Fund springen", Kopier-Button (für Word), und (falls ein umschließendes Element die AA-Anforderung erfüllt) Hinweis + Schalter zum Löschen des Findings
- Einzel- und Sammel-Kopieren der Ergebnisse (text/html + text/plain) – für Word-Insert geeignet
- Optionaler Screenshot pro Finding via html2canvas (on-demand nachgeladen)

Einschränkungen/Notes:
- Text auf Bildern/Verläufen kann ungenau sein. Bei Hintergrundbildern wird ein Hinweis angezeigt; Screenshot hilft hier.
- System-/Seiten-spezifische CSS (z.B. sehr komplexe Overlays) kann die Ermittlung der effektiven Hintergrundfarbe erschweren.
- Für Screenshots wird html2canvas per <script>-Tag nachgeladen (CORS kann Fremdbilder blockieren). 

Nutzung (Bookmarklet):
1) Erzeugen Sie aus dem IIFE am Ende ein Bookmarklet – oder verwenden Sie den unten bereitgestellten "BOOKMARKLET"-Block.
2) Lesezeichen-URL: Alles ab "javascript:(()=>{...})();" kopieren und als Lesezeichen-URL einfügen.

*/

(function WCAG143Auditor(){
  const STATE = { findings: [], panel: null, shadow: null, idSeed: 0, html2canvasReady: false };
  const MIN_RATIO_NORMAL = 4.5;
  const MIN_RATIO_LARGE = 3.0;

  // ——— Utilities ———
  const toHex = (n)=>("0"+n.toString(16)).slice(-2);
  function rgbToHex({r,g,b}){ return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase(); }
  function clamp01(x){ return Math.min(1, Math.max(0, x)); }
  function parseColor(str){
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = str; // lets the browser parse it
    const m = ctx.fillStyle.match(/^#([0-9a-f]{6})$/i);
    if(!m){
      // handle rgba()/rgb()
      const s = ctx.fillStyle; // normalized color
      const rgba = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/i);
      if(rgba){
        return {r:parseInt(rgba[1]), g:parseInt(rgba[2]), b:parseInt(rgba[3]), a: rgba[4]!==undefined? parseFloat(rgba[4]):1};
      }
      return {r:0,g:0,b:0,a:1};
    }
    const hex = m[1];
    return {r:parseInt(hex.substr(0,2),16), g:parseInt(hex.substr(2,2),16), b:parseInt(hex.substr(4,2),16), a:1};
  }
  function relLuminance({r,g,b}){
    const srgb = [r/255, g/255, b/255].map(v=> v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055, 2.4));
    return 0.2126*srgb[0] + 0.7152*srgb[1] + 0.0722*srgb[2];
  }
  function contrastRatio(fg, bg){
    const L1 = relLuminance(fg);
    const L2 = relLuminance(bg);
    const lighter = Math.max(L1,L2); const darker = Math.min(L1,L2);
    return (lighter + 0.05) / (darker + 0.05);
  }
  function mix(a,b,t){ // mix colors a->b by t
    return {r:Math.round(a.r+(b.r-a.r)*t), g:Math.round(a.g+(b.g-a.g)*t), b:Math.round(a.b+(b.b-a.b)*t), a:1};
  }
  function isVisible(el){
    const style = getComputedStyle(el);
    if(style.display==='none' || style.visibility==='hidden' || parseFloat(style.opacity)===0) return false;
    const rect = el.getBoundingClientRect();
    return (rect.width>0 && rect.height>0);
  }
  function getPx(el, prop){
    const v = getComputedStyle(el)[prop];
    return v? parseFloat(v) : 0;
  }
  function isLargeText(el){
    const sizePx = getPx(el,'fontSize');
    const weight = getComputedStyle(el).fontWeight;
    const isBold = parseInt(weight,10)>=700; // conservative
    const largeForBold = sizePx >= 18.66; // ~14pt bold
    const largeNormal = sizePx >= 24;     // 18pt normal
    return isBold ? largeForBold : largeNormal;
  }
  function getEffectiveTextColor(el){
    const c = getComputedStyle(el).color;
    return parseColor(c);
  }
  function getEffectiveBackground(el){
    // Walk up ancestors to find a non-transparent background-color; flag bg-image if present
    let node = el;
    let sawImage = false;
    while(node && node !== document.documentElement){
      const cs = getComputedStyle(node);
      if(cs.backgroundImage && cs.backgroundImage!=='none') sawImage = true;
      const bgc = cs.backgroundColor;
      const col = parseColor(bgc);
      if(col.a>0 && !(col.r===0&&col.g===0&&col.b===0&&bgc==='transparent')){
        return { color: col, via: node, hadImage: sawImage };
      }
      node = node.parentElement;
    }
    // fallback: body or white
    const bodyCol = parseColor(getComputedStyle(document.body).backgroundColor);
    if(bodyCol.a>0) return {color: bodyCol, via: document.body, hadImage: sawImage};
    return {color: {r:255,g:255,b:255,a:1}, via: null, hadImage: sawImage};
  }
  function nearestAccessibleForeground(fg, bg, targetRatio){
    // Try black or white first; if one works, suggest it
    const black = {r:0,g:0,b:0,a:1};
    const white = {r:255,g:255,b:255,a:1};
    if(contrastRatio(black,bg)>=targetRatio) return {color:black, label:'schwarz'};
    if(contrastRatio(white,bg)>=targetRatio) return {color:white, label:'weiß'};
    // Binary search toward black
    let lo=0, hi=1, best=null, steps=24;
    for(let i=0;i<steps;i++){
      const t=(lo+hi)/2; const cand = mix(fg, black, t);
      const cr = contrastRatio(cand,bg);
      if(cr>=targetRatio){ best=cand; hi=t; } else { lo=t; }
    }
    if(best) return {color:best, label:'dunkler'};
    // Toward white
    lo=0; hi=1; best=null;
    for(let i=0;i<steps;i++){
      const t=(lo+hi)/2; const cand = mix(fg, white, t);
      const cr = contrastRatio(cand,bg);
      if(cr>=targetRatio){ best=cand; hi=t; } else { lo=t; }
    }
    if(best) return {color:best, label:'heller'};
    // If still not possible (extreme bg), return higher-contrast of black/white
    const crB = contrastRatio(black,bg), crW = contrastRatio(white,bg);
    return crB>crW? {color:black,label:'max. (schwarz)'} : {color:white,label:'max. (weiß)'};
  }
  function elementPath(el){
    const parts=[]; let node=el; let guard=0;
    while(node && node.nodeType===1 && guard<10){
      const name=node.tagName.toLowerCase();
      let sel=name;
      if(node.id) sel+="#"+node.id;
      else if(node.className && typeof node.className==='string'){
        const cls = node.className.trim().split(/\s+/).slice(0,2).join('.');
        if(cls) sel+= '.'+cls;
      }
      parts.unshift(sel); node=node.parentElement; guard++;
    }
    return parts.join(' > ');
  }

  // Check ancestors for alternative background that passes
  function findPassingAncestor(el, textColor, targetRatio){
    let node = el.parentElement;
    while(node){
      const {color:bg} = getEffectiveBackground(node);
      const cr = contrastRatio(textColor, bg);
      if(cr>=targetRatio){
        return {node, bg, ratio: cr};
      }
      node = node.parentElement;
    }
    return null;
  }

  // ——— Scan document ———
  function scan(){
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(n){
        if(!n.nodeValue) return NodeFilter.FILTER_REJECT;
        const text = n.nodeValue.replace(/\s+/g,' ').trim();
        if(!text) return NodeFilter.FILTER_REJECT;
        const el = n.parentElement;
        if(!el || !isVisible(el)) return NodeFilter.FILTER_REJECT;
        const cs = getComputedStyle(el);
        if(cs.visibility==='hidden' || cs.display==='none') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const results=[];
    let node;
    while((node = tw.nextNode())){
      const el = node.parentElement;
      const fg = getEffectiveTextColor(el);
      const bgInfo = getEffectiveBackground(el);
      const bg = bgInfo.color;
      const ratio = contrastRatio(fg,bg);
      const large = isLargeText(el);
      const min = large? MIN_RATIO_LARGE : MIN_RATIO_NORMAL;
      if(ratio < min){
        const ancestorPass = findPassingAncestor(el, fg, min);
        results.push({
          id: 'fnd_'+(STATE.idSeed++),
          el, node, snippet: node.nodeValue.trim().slice(0,140),
          path: elementPath(el),
          fg, bg, ratio, large, min, hadImage: bgInfo.hadImage,
          ancestorPass,
        });
      }
    }
    return results;
  }

  // ——— UI ———
  function ensurePanel(){
    if(STATE.panel){ STATE.panel.remove(); STATE.panel=null; }
    const host = document.createElement('div');
    host.id='wcag143-auditor-panel';
    host.style.position='fixed'; host.style.top='16px'; host.style.right='16px'; host.style.zIndex='2147483647';
    host.style.width='420px'; host.style.maxHeight='80vh'; host.style.boxShadow='0 10px 30px rgba(0,0,0,.2)'; host.style.borderRadius='16px'; host.style.overflow='hidden';
    document.body.appendChild(host);
    const shadow = host.attachShadow({mode:'open'});
    STATE.panel = host; STATE.shadow=shadow;

    const style = document.createElement('style');
    style.textContent = `
      :host{ all: initial; }
      *{ box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, Helvetica, sans-serif; }
      .card{ background:#fff; color:#111; border:1px solid #e5e7eb; border-radius:14px; padding:12px; margin:10px 0; }
      .hdr{ display:flex; align-items:center; gap:8px; background:#111; color:#fff; padding:10px 12px; cursor:move; }
      .hdr h1{ margin:0; font-size:14px; font-weight:600; letter-spacing:.2px; }
      .hdr .btn{ margin-left:auto; background:transparent; border:1px solid rgba(255,255,255,.3); color:#fff; padding:4px 8px; border-radius:10px; font-size:12px; }
      .wrap{ background:#f8fafc; padding:10px; overflow:auto; max-height:calc(80vh - 46px); }
      .meta{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-top:8px; font-size:12px; color:#334155; }
      .btnrow{ display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
      button{ border:1px solid #e5e7eb; background:#fff; padding:6px 10px; border-radius:10px; font-size:12px; cursor:pointer; }
      button.primary{ background:#111; color:#fff; border-color:#111; }
      .ratio.bad{ color:#b91c1c; font-weight:700; }
      .ratio.good{ color:#0f766e; font-weight:700; }
      .hint{ background:#fffbeb; border:1px solid #fde68a; color:#92400e; padding:6px 8px; border-radius:8px; font-size:12px; margin-top:8px; }
      .thumb{ width:100%; border:1px solid #e5e7eb; border-radius:8px; margin-top:8px; }
      .small{ font-size:11px; color:#475569; }
      .badge{ display:inline-block; padding:2px 6px; border-radius:999px; border:1px solid #e5e7eb; font-size:11px; }
      .hl{ outline: 3px dashed #f59e0b; outline-offset: 3px; animation: blink 1s ease-in-out 2; }
      @keyframes blink{ 50%{ outline-color: transparent; } }
    `;
    shadow.appendChild(style);

    const header = document.createElement('div'); header.className='hdr';
    header.innerHTML = `<h1>WCAG 1.4.3 – Kontrast-Prüfung</h1>
      <button class="btn" id="copy-all">Alle kopieren</button>
      <button class="btn" id="close">Schließen</button>`;

    const wrap = document.createElement('div'); wrap.className='wrap';

    shadow.appendChild(header); shadow.appendChild(wrap);

    // Drag to move
    (function makeDraggable(){
      let sx=0, sy=0, ox=0, oy=0, dragging=false;
      header.addEventListener('mousedown', e=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=host.getBoundingClientRect(); ox=r.left; oy=r.top; e.preventDefault(); });
      window.addEventListener('mousemove', e=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; host.style.top=(oy+dy)+"px"; host.style.left=(ox+dx)+"px"; host.style.right='auto'; });
      window.addEventListener('mouseup', ()=> dragging=false);
    })();

    shadow.getElementById('close').onclick=()=>{ host.remove(); };
    shadow.getElementById('copy-all').onclick=()=> copyAllFindings();

    return {wrap};
  }

  function colorSwatch(hex){
    return `<span class="badge" style="background:${hex}; color:${contrastRatio(parseColor('#000'), parseColor(hex))>3? '#111':'#fff'}">${hex}</span>`;
  }

  function render(findings){
    const {wrap} = ensurePanel();
    wrap.innerHTML = '';
    if(findings.length===0){
      wrap.innerHTML = '<div class="card">Keine Probleme gefunden. \u2705</div>';
      return;
    }
    findings.forEach(f=>{
      const cr = f.ratio.toFixed(2);
      const hexFg = rgbToHex(f.fg); const hexBg = rgbToHex(f.bg);
      const target = f.min.toFixed(1);
      const suggestion = nearestAccessibleForeground(f.fg, f.bg, f.min);
      const passAnc = f.ancestorPass;

      const card = document.createElement('div'); card.className='card'; card.id=f.id;
      card.innerHTML = `
        <div><strong>Problem:</strong> Kontrast zu niedrig (${cr}:1 < ${target}:1) – ${f.large? 'Große Schrift':'Normaler Text'}</div>
        <div class="meta">
          <div>Text: ${colorSwatch(hexFg)}</div>
          <div>Hintergrund: ${colorSwatch(hexBg)} ${f.hadImage? '<span class="small">(Hintergrundbild erkannt)</span>':''}</div>
          <div>Pfad: <span class="small">${escapeHtml(f.path)}</span></div>
          <div>Snippet: <span class="small">${escapeHtml(f.snippet)}</span></div>
        </div>
        <div class="hint">Vorschlag: Textfarbe ${suggestion.label} anpassen – z.B. ${colorSwatch(rgbToHex(suggestion.color))}. (Ziel: ≥ ${target}:1)</div>
        ${passAnc? `<div class="hint">Hinweis: Ein umschließendes Element erfüllt die Anforderung bereits (Kontrast ${passAnc.ratio.toFixed(2)}:1). Vorgehen: Prüfen, ob dieses Element als effektiver Hintergrund gilt (z.B. eigenes Background, Padding). Wenn ja, kann dieses Finding verworfen werden. <button data-act="dismiss" class="primary" style="margin-left:6px" data-id="${f.id}">Finding löschen</button></div>`:''}
        <div class="btnrow">
          <button data-act="jump" data-id="${f.id}">Zum Fund springen</button>
          <button data-act="shot" data-id="${f.id}">Screenshot</button>
          <button data-act="copy" data-id="${f.id}" class="primary">Ergebnis kopieren</button>
          <button data-act="remove" data-id="${f.id}">Aus Liste entfernen</button>
        </div>
        <img class="thumb" style="display:none" />
      `;
      STATE.shadow.querySelector('.wrap').appendChild(card);
    });

    // delegate actions
    STATE.shadow.querySelector('.wrap').addEventListener('click', async (e)=>{
      const btn = e.target.closest('button'); if(!btn) return;
      const id = btn.getAttribute('data-id');
      const act = btn.getAttribute('data-act');
      const f = STATE.findings.find(x=>x.id===id);
      if(!f) return;
      if(act==='jump') jumpTo(f);
      else if(act==='copy') copyFinding(f);
      else if(act==='remove' || act==='dismiss') removeCard(id);
      else if(act==='shot') await makeScreenshot(f);
    }, {once:false});
  }

  function escapeHtml(s){ return s.replace(/[&<>"']/g, c=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }

  function jumpTo(f){
    f.el.scrollIntoView({behavior:'smooth', block:'center', inline:'nearest'});
    f.el.classList.add('wcag143-hl');
    // apply outline via a temporary injected style on the page (outside shadow)
    injectHighlightCSS();
    setTimeout(()=> f.el.classList.remove('wcag143-hl'), 2000);
  }
  function injectHighlightCSS(){
    if(document.getElementById('wcag143-hl-style')) return;
    const s = document.createElement('style'); s.id='wcag143-hl-style';
    s.textContent = `.wcag143-hl{ outline: 3px dashed #f59e0b !important; outline-offset: 3px !important; animation: wcag143blink 1s ease-in-out 2; }
      @keyframes wcag143blink{ 50%{ outline-color: transparent; } }`;
    document.head.appendChild(s);
  }

  function removeCard(id){
    const idx = STATE.findings.findIndex(x=>x.id===id);
    if(idx>=0) STATE.findings.splice(idx,1);
    const el = STATE.shadow.getElementById(id); if(el) el.remove();
    if(STATE.findings.length===0){
      STATE.shadow.querySelector('.wrap').innerHTML = '<div class="card">Keine Probleme mehr. \u2705</div>';
    }
  }

  async function ensureHtml2Canvas(){
    if(STATE.html2canvasReady) return true;
    return new Promise((resolve)=>{
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.onload = ()=>{ STATE.html2canvasReady = true; resolve(true); };
      s.onerror = ()=>{ alert('html2canvas konnte nicht geladen werden.'); resolve(false); };
      document.head.appendChild(s);
    });
  }

  async function makeScreenshot(f){
    const ok = await ensureHtml2Canvas(); if(!ok) return;
    try{
      const target = f.el;
      const rect = target.getBoundingClientRect();
      const canvas = await window.html2canvas(target, {useCORS:true, backgroundColor:null, scale: window.devicePixelRatio||1});
      const data = canvas.toDataURL('image/png');
      const card = STATE.shadow.getElementById(f.id);
      const img = card.querySelector('img.thumb'); img.src=data; img.style.display='block';
    }catch(err){ alert('Screenshot fehlgeschlagen: '+err); }
  }

  function copyFinding(f){
    const hexFg = rgbToHex(f.fg); const hexBg = rgbToHex(f.bg);
    const cr = f.ratio.toFixed(2); const target = f.min.toFixed(1);
    const suggestion = nearestAccessibleForeground(f.fg, f.bg, f.min);
    const title = `WCAG 1.4.3 Verstoß – Kontrast (${cr}:1 < ${target}:1)`;
    const html = `
      <div>
        <h3>${title}</h3>
        <ul>
          <li><strong>Snippet:</strong> ${escapeHtml(f.snippet)}</li>
          <li><strong>Pfad:</strong> ${escapeHtml(f.path)}</li>
          <li><strong>Textfarbe:</strong> ${hexFg}</li>
          <li><strong>Hintergrund:</strong> ${hexBg}${f.hadImage? ' (Hintergrundbild erkannt)':''}</li>
          <li><strong>Gemessen:</strong> ${cr}:1 (erforderlich ≥ ${target}:1; ${f.large? 'groß':'normal'})</li>
          <li><strong>Vorschlag:</strong> Text ${suggestion.label} – z.B. ${rgbToHex(suggestion.color)}</li>
          ${f.ancestorPass? `<li><strong>Hinweis:</strong> Umschließendes Element erfüllt bereits (${f.ancestorPass.ratio.toFixed(2)}:1).` : ''}
        </ul>
      </div>`;
    const text = title+"\n"+
      `Snippet: ${f.snippet}\nPfad: ${f.path}\nText: ${hexFg}\nHintergrund: ${hexBg}${f.hadImage? ' (BG-Bild)':''}\nGemessen: ${cr}:1 (erf. ≥ ${target}:1; ${f.large? 'groß':'normal'})\nVorschlag: ${rgbToHex(suggestion.color)} (${suggestion.label})` + (f.ancestorPass? `\nHinweis: Parent erfüllt (${f.ancestorPass.ratio.toFixed(2)}:1)`:'');

    writeClipboard(html, text);
  }

  function copyAllFindings(){
    if(!STATE.findings.length){ alert('Keine Findings zum Kopieren.'); return; }
    const blocks = STATE.findings.map(f=>{
      const hexFg = rgbToHex(f.fg); const hexBg = rgbToHex(f.bg);
      const cr = f.ratio.toFixed(2); const target = f.min.toFixed(1);
      const suggestion = nearestAccessibleForeground(f.fg, f.bg, f.min);
      return `
        <div style="margin-bottom:12px;">
          <h3>WCAG 1.4.3 Verstoß – Kontrast (${cr}:1 &lt; ${target}:1)</h3>
          <ul>
            <li><strong>Snippet:</strong> ${escapeHtml(f.snippet)}</li>
            <li><strong>Pfad:</strong> ${escapeHtml(f.path)}</li>
            <li><strong>Textfarbe:</strong> ${hexFg}</li>
            <li><strong>Hintergrund:</strong> ${hexBg}${f.hadImage? ' (Hintergrundbild erkannt)':''}</li>
            <li><strong>Gemessen:</strong> ${cr}:1 (erforderlich ≥ ${target}:1; ${f.large? 'groß':'normal'})</li>
            <li><strong>Vorschlag:</strong> Text ${suggestion.label} – z.B. ${rgbToHex(suggestion.color)}</li>
            ${f.ancestorPass? `<li><strong>Hinweis:</strong> Umschließendes Element erfüllt bereits (${f.ancestorPass.ratio.toFixed(2)}:1).</li>`:''}
          </ul>
        </div>`;
    }).join('');
    const html = `<div>${blocks}</div>`;
    const text = STATE.findings.map((f,i)=>{
      const hexFg = rgbToHex(f.fg); const hexBg = rgbToHex(f.bg);
      const cr = f.ratio.toFixed(2); const target = f.min.toFixed(1);
      const suggestion = nearestAccessibleForeground(f.fg, f.bg, f.min);
      return `#${i+1} WCAG 1.4.3 – ${cr}:1 < ${target}:1\nSnippet: ${f.snippet}\nPfad: ${f.path}\nText: ${hexFg}\nHintergrund: ${hexBg}${f.hadImage? ' (BG-Bild)':''}\nGemessen: ${cr}:1 (erf. ≥ ${target}:1; ${f.large? 'groß':'normal'})\nVorschlag: ${rgbToHex(suggestion.color)} (${suggestion.label})` + (f.ancestorPass? `\nHinweis: Parent erfüllt (${f.ancestorPass.ratio.toFixed(2)}:1)`:'');
    }).join('\n\n');
    writeClipboard(html, text);
  }

  async function writeClipboard(html, text){
    try{
      if(navigator.clipboard && window.ClipboardItem){
        const item = new ClipboardItem({
          'text/html': new Blob([html], {type:'text/html'}),
          'text/plain': new Blob([text], {type:'text/plain'})
        });
        await navigator.clipboard.write([item]);
        alert('Kopiert! In Word einfügen (Strg/Cmd+V).');
      } else if(navigator.clipboard){
        await navigator.clipboard.writeText(text);
        alert('Als Text kopiert (Fallback).');
      } else {
        // Ultimate fallback: hidden textarea
        const ta = document.createElement('textarea'); ta.value=text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        alert('Als Text kopiert (Legacy-Fallback).');
      }
    }catch(err){ alert('Kopieren fehlgeschlagen: '+err); }
  }

  // ——— Run ———
  STATE.findings = scan();
  render(STATE.findings);

})();

/*
BOOKMARKLET (kompakt – als Lesezeichen-URL verwenden):

javascript:(()=>{${encodeURIComponent(`
  /* WCAG 1.4.3 Auditor – siehe Quelltext für Kommentare */
  (${WCAG143Auditor? WCAG143Auditor.toString(): function(){/* placeholder when static */}.toString()})();
`).replace(/%20/g,' ')}})();

Hinweis: Einige Browser limitieren die maximale URL-Länge. Wenn das Bookmarklet nicht speicherbar ist, nutzen Sie den oberen Quelltext in einem Bookmarklet-Builder (oder hosten Sie das Script und erstellen Sie ein kurzes Loader-Bookmarklet).
*/
