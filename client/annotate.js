/* agent-annotate toolbar — inspect an element on the page, say what should change,
   and the note lands in annotations.json for the agent.
   Injected automatically by the dev server; only ever loads on localhost.
   Press A to arm the picker, Esc to cancel. */
(function(){
  if(!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;

  const API='/__annotations';
  const CFG=window.__ANNOTATE_CONFIG||{};
  const CTX=window.__ANNOTATE_CONTEXT;
  // classes the host app adds at runtime and that would only add noise to a selector
  const IGNORE=new RegExp('^('+(CFG.ignoreClasses||[]).concat(['an-armed']).join('|')+')$');
  const OURS='.an-bar,.an-pop,.an-list,.an-pin,.an-hl,.an-hltag';
  let armed=false, pins=[], sel=null;

  /* ---- a readable path to whatever was clicked ---- */
  const classesOf=el=>(typeof el.className==='string'?el.className:'').trim().split(/\s+/)
    .filter(Boolean).filter(c=>!IGNORE.test(c));
  function nameOf(el){
    let s=el.tagName.toLowerCase();
    if(el.id) return s+'#'+el.id;
    const cls=classesOf(el).slice(0,2);
    return cls.length ? s+'.'+cls.join('.') : s;
  }
  function pathOf(el){
    const out=[];
    while(el && el.nodeType===1 && out.length<4){
      out.unshift(nameOf(el));
      if(el.id) break;
      el=el.parentElement;
    }
    return out.join(' > ');
  }
  // the ancestor chain, so a mis-aimed click can be walked up like a devtools breadcrumb
  function chainOf(el){
    const out=[];
    while(el && el.nodeType===1 && el!==document.documentElement && out.length<6){
      out.unshift(el); el=el.parentElement;
    }
    return out;
  }
  // which page a note belongs to; '/' and '/index.html' must agree
  const pageId=()=>location.pathname.replace(/^\//,'')||'index.html';
  const snippet=el=>(el.innerText||el.getAttribute?.('alt')||'').trim().replace(/\s+/g,' ').slice(0,60);
  const esc=s=>String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));

  /* ---- icons ---- */
  const I={
    inspect:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><path d="m10 9.5 6 2.6-2.4.9-.9 2.4z" fill="currentColor" stroke-width="1.2"/></svg>',
    notes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15.5A1.5 1.5 0 0 1 18.5 17H8l-4 3.5V5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5Z"/><path d="M8 8.5h8M8 12h5"/></svg>',
    send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 3.5 11 13"/><path d="M20.5 3.5 14.2 20.5l-3.2-7.4-7.5-3.1z"/></svg>',
    edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M14.5 6.5 17.5 9.5"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h16M9.5 6.5V4.8a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.7"/><path d="M6.5 6.5 7.4 19a1.2 1.2 0 0 0 1.2 1.1h6.8a1.2 1.2 0 0 0 1.2-1.1l.9-12.5"/><path d="M10.3 10v6.3M13.7 10v6.3"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
    x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  /* ---- ui ----
     Liquid glass: a lit rim, an inner glow, a specular streak and the refraction
     below do the work that a heavy fill would otherwise have to do. The fill is
     still the thing that makes small type legible over an unknown page, though,
     so it is set as low as readability allows and no lower — and the labels that
     sit directly on page content carry more of it than the big panels. */
  const css=document.createElement('style');
  /* Dark is three-state: the page can say `data-theme` on <html>, and when it does
     not, the OS decides. The same overrides serve both. */
  const dark=p=>`
  ${p} .an-bar,${p} .an-pop,${p} .an-list,${p} .an-hltag{--an-ink:#f3f4f7; --an-dim:rgba(243,244,247,.62); --an-hair:rgba(255,255,255,.16);
      --an-accent:#FF7A52;
      --an-frost:rgba(16,18,24,.86);
      --an-rim:inset 0 0 2px 1px rgba(255,255,255,.28),inset 0 0 10px 4px rgba(255,255,255,.07),
               inset 0 6px 32px rgba(0,0,0,.16);
      --an-cast:0 10px 34px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.35);
      border-color:rgba(255,255,255,.2);text-shadow:0 1px 0 rgba(0,0,0,.3)}
  ${p} .an-bar button:hover{background:rgba(255,255,255,.16)}
  ${p} .an-bar .an-count{background:rgba(255,255,255,.14);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.16)}
  ${p} .an-hltag{--an-frost:rgba(16,18,24,.9)}
  ${p} .an-pop .an-crumb:hover{background:rgba(255,255,255,.16)}
  ${p} .an-pop .an-sel,${p} .an-pop .an-chip{border-color:rgba(255,255,255,.18);
    background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.05));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
  ${p} .an-pop select option{background:#1b1d23;color:#f3f4f7}
  ${p} .an-pop textarea{background:rgba(0,0,0,.24);
    border-color:rgba(255,255,255,.18)}
  ${p} .an-pop .btns button{border-color:rgba(255,255,255,.18);
    background:linear-gradient(160deg,rgba(255,255,255,.14),rgba(255,255,255,.05))}
  ${p} .an-list li:not(.an-send-all):not(.an-empty):hover{background:rgba(255,255,255,.12)}
  ${p} .an-list .an-acts .ic:hover{background:rgba(255,255,255,.14)}
  ${p} .an-list .an-tag{background:rgba(255,255,255,.14)}`;
  css.textContent=`
  .an-bar,.an-pop,.an-list,.an-hltag{
    --an-ink:#12141a; --an-dim:rgba(18,20,26,.62); --an-hair:rgba(18,20,26,.14);
    --an-accent:#C4442A;
    --an-frost:rgba(255,255,255,.86); --an-sat:1.8; --an-soft:blur(13px);
    /* the lit rim, in layers: hairline, inner glow, then depth */
    --an-rim:inset 0 0 2px 1px rgba(255,255,255,.5),inset 0 0 10px 4px rgba(255,255,255,.16),
             inset 0 4px 16px rgba(17,17,26,.05),inset 0 8px 24px rgba(17,17,26,.05),
             inset 0 6px 56px rgba(17,17,26,.05);
    --an-cast:0 10px 34px rgba(24,28,48,.18),0 2px 8px rgba(24,28,48,.1);
    position:relative;isolation:isolate;
    background:var(--an-frost);border:1px solid rgba(255,255,255,.35);
    -webkit-backdrop-filter:var(--an-glass,) var(--an-soft) saturate(var(--an-sat));
    backdrop-filter:var(--an-glass,) var(--an-soft) saturate(var(--an-sat));
    box-shadow:var(--an-rim),var(--an-cast);
    color:var(--an-ink);text-shadow:0 1px 0 rgba(255,255,255,.35);
    font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.02em}
  

  /* specular sweep across the top-left, the way light catches a curved edge */
  .an-bar::after,.an-pop::after{content:'';position:absolute;inset:0;border-radius:inherit;
    pointer-events:none;z-index:-1;
    background:linear-gradient(104deg,rgba(255,255,255,.6) 0 9%,transparent 30% 72%,
      rgba(255,255,255,.3) 94% 100%);mix-blend-mode:overlay}

  .an-bar{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;gap:4px;
    align-items:center;padding:4px;border-radius:999px}
  .an-bar button{all:unset;display:grid;place-items:center;width:34px;height:34px;border-radius:999px;
    color:var(--an-ink);cursor:pointer;transition:background .18s,color .18s,transform .18s}
  .an-bar button svg{width:17px;height:17px;display:block}
  .an-bar button:hover{background:rgba(255,255,255,.45)}
  
  .an-bar button:active{transform:scale(.94)}
  .an-bar button.on{background:linear-gradient(160deg,#e0613e,var(--an-accent));color:#fff;
    text-shadow:none;box-shadow:0 3px 14px rgba(196,68,42,.5),inset 0 1px 0 rgba(255,255,255,.45)}
  .an-bar .an-count{min-width:22px;height:22px;margin:0 3px 0 7px;border-radius:999px;padding:0 6px;
    display:grid;place-items:center;font-size:10px;font-weight:600;
    background:rgba(255,255,255,.5);color:var(--an-dim);box-shadow:inset 0 1px 0 rgba(255,255,255,.7)}
  
  .an-bar .an-count.has{background:linear-gradient(160deg,#e0613e,var(--an-accent));color:#fff;text-shadow:none}
  .an-armed, .an-armed *{cursor:crosshair !important}
  /* while probing for the element under a pin, our own chrome must not answer */
  html.an-probe .an-bar,html.an-probe .an-list,html.an-probe .an-pin{pointer-events:none!important}

  /* the inspect overlay: box on the element, label pinned to its top-left */
  .an-hl{position:fixed;z-index:2147482500;pointer-events:none;border-radius:3px;
    background:rgba(196,68,42,.14);outline:1.5px solid rgba(196,68,42,.85);
    box-shadow:0 0 0 1px rgba(255,255,255,.5),0 6px 24px rgba(196,68,42,.18);
    transition:all .07s linear;display:none}
  .an-hltag{position:fixed;z-index:2147482600;pointer-events:none;display:none;
    --an-frost:rgba(255,255,255,.9);--an-soft:blur(14px);
    padding:3px 8px;border-radius:8px;white-space:nowrap;font-size:10px}
  
  .an-hltag b{color:var(--an-accent);font-weight:600}
  .an-hltag span{color:var(--an-dim);margin-left:6px}

  .an-pin{position:absolute;z-index:2147482000;width:24px;height:24px;margin:-12px 0 0 -12px;
    border-radius:50%;background:linear-gradient(160deg,#ef7050,#C4442A);color:#fff;
    font:600 11px/24px ui-monospace,monospace;text-align:center;cursor:pointer;
    border:1.5px solid rgba(255,255,255,.9);
    box-shadow:0 4px 14px rgba(196,68,42,.45),inset 0 1px 0 rgba(255,255,255,.55);
    transition:transform .18s}
  .an-pin:hover{transform:scale(1.14)}
  .an-pin.done,.an-pin.ready{background:linear-gradient(160deg,#5b9a85,#3F6B5C);
    box-shadow:0 4px 14px rgba(63,107,92,.45)}
  .an-pin.stale{background:linear-gradient(160deg,#a8a8a8,#7a7a7a);box-shadow:0 4px 14px rgba(0,0,0,.28)}

  .an-pop{position:absolute;z-index:2147483001;width:330px;padding:11px;border-radius:17px}
  .an-pop .an-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:2px;margin-bottom:7px;font-size:10px}
  .an-pop .an-crumb{all:unset;cursor:pointer;padding:2px 5px;border-radius:6px;color:var(--an-dim);
    max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .an-pop .an-crumb:hover{background:rgba(255,255,255,.5);color:var(--an-ink)}
  
  .an-pop .an-crumb.on{background:linear-gradient(160deg,#e0613e,var(--an-accent));color:#fff;
    font-weight:600;text-shadow:none}
  .an-pop .an-sep{color:var(--an-dim);opacity:.5}
  .an-pop .an-facts{font-size:10px;color:var(--an-dim);margin-bottom:8px;word-break:break-word}
  .an-pop .an-kind{color:var(--an-accent);text-transform:uppercase;letter-spacing:.08em;font-weight:600}
  .an-pop .an-ctl{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}
  .an-pop .an-sel,.an-pop .an-chip{border:1px solid rgba(255,255,255,.6);
    background:linear-gradient(160deg,rgba(255,255,255,.55),rgba(255,255,255,.22));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.75),0 1px 3px rgba(24,28,48,.1)}
  
  .an-pop .an-sel{display:flex;align-items:center;gap:4px;padding:3px 4px 3px 8px;border-radius:999px;
    font-size:10px;color:var(--an-dim)}
  .an-pop .an-sel.on{border-color:var(--an-accent);color:var(--an-ink);
    background:linear-gradient(160deg,rgba(196,68,42,.3),rgba(196,68,42,.14))}
  .an-pop select{all:unset;font:inherit;font-size:10px;color:var(--an-ink);cursor:pointer;padding:2px 3px}
  .an-pop select option{background:#fff;color:#12141a}
  
  .an-pop .an-chip{all:unset;padding:4px 9px;border-radius:999px;cursor:pointer;font-size:10px;
    color:var(--an-dim);transition:transform .16s,color .16s,border-color .16s;
    border:1px solid var(--an-hair)}
  .an-pop .an-chip:hover{color:var(--an-ink);transform:translateY(-1px)}
  .an-pop .an-chip.on{background:linear-gradient(160deg,#e0613e,var(--an-accent));
    border-color:transparent;color:#fff;font-weight:600;text-shadow:none;
    box-shadow:0 2px 10px rgba(196,68,42,.4),inset 0 1px 0 rgba(255,255,255,.4)}
  .an-pop .an-chip.an-more{border-style:dashed}
  .an-pop .an-rest{display:none;flex-wrap:wrap;gap:5px;width:100%}
  .an-pop .an-rest.show{display:flex}
  .an-pop textarea{width:100%;box-sizing:border-box;height:70px;font:inherit;padding:8px;resize:vertical;
    border:1px solid rgba(255,255,255,.6);border-radius:11px;color:var(--an-ink);text-shadow:none;
    background:rgba(255,255,255,.42);outline:none;
    box-shadow:inset 0 1px 3px rgba(24,28,48,.08)}
  
  .an-pop textarea::placeholder{color:var(--an-dim);opacity:.75}
  .an-pop textarea:focus{border-color:var(--an-accent);box-shadow:0 0 0 3px rgba(196,68,42,.2)}
  .an-pop .btns{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}
  .an-pop .btns button{all:unset;display:grid;place-items:center;width:31px;height:31px;border-radius:999px;
    cursor:pointer;color:var(--an-ink);border:1px solid rgba(255,255,255,.6);
    background:linear-gradient(160deg,rgba(255,255,255,.55),rgba(255,255,255,.22));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.75),0 1px 3px rgba(24,28,48,.1);
    transition:transform .18s}
  
  .an-pop .btns button svg{width:15px;height:15px}
  .an-pop .btns button:active{transform:scale(.93)}
  .an-pop .btns button.primary{background:linear-gradient(160deg,#e0613e,var(--an-accent));
    border-color:transparent;color:#fff;box-shadow:0 3px 14px rgba(196,68,42,.45),
    inset 0 1px 0 rgba(255,255,255,.45)}
  .an-toast{width:auto;max-width:300px;padding:10px 14px;border-radius:13px;
    transition:opacity .3s;pointer-events:none;z-index:2147483002}
  .an-toast.bad{border-color:var(--an-accent);
    box-shadow:0 0 0 1px var(--an-accent),var(--an-rim),var(--an-cast)}
  .an-pop .an-read{white-space:pre-wrap;word-break:break-word;color:var(--an-ink)}

  .an-report{position:fixed;right:16px;bottom:66px;z-index:2147483002;width:min(560px,calc(100vw - 32px));
    max-height:min(70vh,620px);display:flex;flex-direction:column;padding:0;border-radius:17px}
  .an-report .an-rhead{display:flex;align-items:center;gap:8px;padding:11px 12px;
    border-bottom:1px solid var(--an-hair);flex:none}
  .an-report .an-rhead .an-kind{color:var(--an-accent);text-transform:uppercase;
    letter-spacing:.08em;font-weight:600;font-size:10px}
  .an-report .an-rhead .met{color:var(--an-dim);font-size:10px}
  .an-report .an-rhead button{all:unset;margin-left:auto;cursor:pointer;opacity:.5;
    display:grid;place-items:center;width:22px;height:22px;border-radius:6px}
  .an-report .an-rhead button:hover{opacity:1;color:var(--an-accent)}
  .an-report .an-rhead button svg{width:12px;height:12px}
  .an-report pre{margin:0;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;
    font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--an-ink)}
  .an-report .an-spin{width:9px;height:9px;border-radius:50%;background:var(--an-accent);
    animation:an-pulse 1.1s ease-in-out infinite}
  @keyframes an-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
  .an-list{position:fixed;right:16px;bottom:66px;z-index:2147483000;width:320px;max-height:min(52vh,420px);
    overflow:auto;padding:4px;border-radius:17px;display:none;margin:0}
  .an-list.show{display:block}
  .an-list li{list-style:none;padding:8px 9px;border-bottom:1px solid var(--an-hair);display:flex;gap:8px;
    align-items:flex-start;cursor:pointer;border-radius:11px}
  .an-list li:last-child{border-bottom:0}
  .an-list li:not(.an-send-all):not(.an-empty):hover{background:rgba(255,255,255,.42)}
  
  .an-list li.an-empty{cursor:default;color:var(--an-dim);justify-content:center;padding:16px 12px;
    text-align:center;line-height:1.6}
  .an-list b{color:var(--an-accent);font-weight:600;flex:none}
  .an-list .an-send-all{position:sticky;top:0;z-index:1;display:flex;gap:7px;align-items:center;
    justify-content:center;padding:9px;margin:0 0 2px;border-radius:12px;cursor:pointer;
    border-bottom:0;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;
    color:#fff;text-shadow:none;background:linear-gradient(160deg,#e0613e,var(--an-accent));
    box-shadow:0 3px 14px rgba(196,68,42,.4),inset 0 1px 0 rgba(255,255,255,.4)}
  .an-list .an-send-all:hover{filter:brightness(1.07)}
  .an-list .an-send-all svg{width:13px;height:13px}
  .an-list .an-acts{margin-left:auto;flex:none;display:flex;gap:2px}
  .an-list .an-acts .ic{opacity:.45;display:grid;place-items:center;width:20px;height:20px;
    border-radius:6px;cursor:pointer}
  .an-list .an-acts .ic svg{width:12px;height:12px}
  .an-list .an-acts .ic:hover{opacity:1;color:var(--an-accent);background:rgba(255,255,255,.5)}
  
  .an-list li.sent b{color:var(--an-dim)}
  .an-list .an-tag.sent{background:linear-gradient(160deg,#5b9a85,#3F6B5C);color:#fff;text-shadow:none}
  .an-list .an-tag{flex:none;font-size:9px;padding:1px 6px;border-radius:999px;
    background:rgba(255,255,255,.5);color:var(--an-dim);letter-spacing:.06em;text-transform:uppercase}
  
  .an-list .x{margin-left:auto;flex:none;opacity:.45;display:grid;place-items:center}
  .an-list .x svg{width:12px;height:12px}
  .an-list .x:hover{opacity:1;color:var(--an-accent)}
  @media print{.an-bar,.an-list,.an-pin,.an-pop,.an-hl,.an-hltag{display:none!important}}`
    +`@media (prefers-color-scheme:dark){${dark('html:not([data-theme="light"])')}}`
    +dark('html[data-theme="dark"]');
  document.head.appendChild(css);

  /* ---- liquid glass ----
     What makes glass read as glass is refraction, not opacity. For each panel we
     draw a displacement map whose red and green channels carry the surface normal
     of a rounded-rect rim, so the page behind bends where the glass curves and
     stays undistorted through the middle. Three displaced copies at slightly
     different scales, screened back together, give the chromatic fringe a real
     lens has. backdrop-filter:url() is Chromium-only; everywhere else the panels
     fall back to plain frosted blur, which still looks like glass. */
  const GLASS=!!(window.CSS&&CSS.supports&&CSS.supports('backdrop-filter','url(#a)'));
  let glassDefs;
  if(GLASS){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('aria-hidden','true');
    svg.style.cssText='position:fixed;width:0;height:0;opacity:0;pointer-events:none';
    svg.innerHTML='<defs></defs>';
    document.body.appendChild(svg);
    glassDefs=svg.firstChild;
  }

  // normal map of a rounded-rect rim, `t` px deep, as a data URI
  function glassMap(w,h,r,t){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const g=c.getContext('2d'), img=g.createImageData(w,h), d=img.data;
    const bw=w/2-r, bh=h/2-r;
    const sdf=(x,y)=>{                       // negative inside, 0 on the edge
      const qx=Math.abs(x-w/2)-bw, qy=Math.abs(y-h/2)-bh;
      return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-r;
    };
    for(let y=0,i=0;y<h;y++) for(let x=0;x<w;x++,i+=4){
      const depth=-sdf(x+.5,y+.5);
      let k=1-Math.min(Math.max(depth,0)/t,1);
      k=k*k*(3-2*k);                         // smooth, so the rim has no hard step
      const nx=sdf(x+1.5,y+.5)-sdf(x-.5,y+.5), ny=sdf(x+.5,y+1.5)-sdf(x+.5,y-.5);
      const len=Math.hypot(nx,ny)||1;
      d[i]  =128+(nx/len)*k*127;
      d[i+1]=128+(ny/len)*k*127;
      d[i+2]=128; d[i+3]=255;
    }
    g.putImageData(img,0,0);
    return c.toDataURL();
  }

  const NS='http://www.w3.org/2000/svg';
  // (re)build one panel's filter and hand back the value for --an-glass
  function glassFor(el,id,radius){
    if(!GLASS) return;
    const w=Math.round(el.offsetWidth), h=Math.round(el.offsetHeight);
    if(!w||!h) return;
    if(el.__anGlass===w+'x'+h) return;      // same size, same map
    el.__anGlass=w+'x'+h;
    const r=Math.min(radius===999?h/2:radius,Math.min(w,h)/2);
    const map=glassMap(w,h,r,Math.max(6,Math.min(26,Math.min(w,h)/2.4)));
    let f=glassDefs.querySelector('#'+id);
    if(!f){
      f=document.createElementNS(NS,'filter');
      f.id=id;
      f.setAttribute('color-interpolation-filters','sRGB');
      ['x','y'].forEach(a=>f.setAttribute(a,'0%'));
      ['width','height'].forEach(a=>f.setAttribute(a,'100%'));
      f.innerHTML=
        '<feImage x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>'+
        [['R',-17,'1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
         ['G',-21,'0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
         ['B',-25,'0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']].map(([ch,sc,mx])=>
          `<feDisplacementMap in="SourceGraphic" in2="map" scale="${sc}" result="d${ch}"
             xChannelSelector="R" yChannelSelector="G"/>
           <feColorMatrix in="d${ch}" type="matrix" values="${mx}" result="c${ch}"/>`).join('')+
        '<feBlend in="cR" in2="cG" mode="screen" result="rg"/>'+
        '<feBlend in="rg" in2="cB" mode="screen" result="rgb"/>'+
        '<feGaussianBlur in="rgb" stdDeviation="1.2"/>';
      glassDefs.appendChild(f);
    }
    f.querySelector('feImage').setAttributeNS('http://www.w3.org/1999/xlink','href',map);
    f.querySelector('feImage').setAttribute('href',map);
    el.style.setProperty('--an-glass','url(#'+id+')');
  }

  const bar=document.createElement('div');
  bar.className='an-bar';
  bar.innerHTML=`<span class="an-count" id="anCount">0</span>
    <button id="anList" title="Notes on this page" aria-label="Notes">${I.notes}</button>
    <button id="anTog" title="Inspect and annotate — press A" aria-label="Inspect">${I.inspect}</button>`;
  document.body.appendChild(bar);
  const list=document.createElement('ul'); list.className='an-list'; document.body.appendChild(list);
  glassFor(bar,'anGlassBar',999);
  const hl=document.createElement('div'); hl.className='an-hl'; document.body.appendChild(hl);
  const hlTag=document.createElement('div'); hlTag.className='an-hltag'; document.body.appendChild(hlTag);

  const layer=document.createElement('div');
  layer.style.cssText='position:absolute;inset:0;pointer-events:none;z-index:2147482000';
  document.body.appendChild(layer);

  /* ---- the inspect overlay ---- */
  function highlight(el){
    if(!el||!el.getBoundingClientRect){ return unhighlight(); }
    const r=el.getBoundingClientRect();
    hl.style.display='block';
    hl.style.left=r.left+'px'; hl.style.top=r.top+'px';
    hl.style.width=r.width+'px'; hl.style.height=r.height+'px';
    hlTag.style.display='block';
    hlTag.innerHTML=`<b>${esc(nameOf(el))}</b><span>${Math.round(r.width)}×${Math.round(r.height)}</span>`;
    const th=hlTag.offsetHeight||20, tw=hlTag.offsetWidth||80;
    // above the box when there is room, otherwise just inside it — never off-screen
    let ty=r.top-th-4; if(ty<4) ty=Math.min(r.top+4,innerHeight-th-4);
    hlTag.style.top=Math.max(4,ty)+'px';
    hlTag.style.left=Math.max(4,Math.min(r.left,innerWidth-tw-4))+'px';
  }
  const unhighlight=()=>{ hl.style.display='none'; hlTag.style.display='none'; };
  addEventListener('scroll',()=>{ if(sel) highlight(sel); },true);
  addEventListener('resize',()=>{ if(sel) highlight(sel); });

  function render(){
    const c=document.getElementById('anCount');
    c.textContent=pins.length; c.classList.toggle('has',pins.length>0);
    [...layer.children].forEach(n=>n.remove());
    list.innerHTML='';
    if(!pins.length){
      const li=document.createElement('li'); li.className='an-empty';
      li.textContent='No notes on this page yet. Press A, then click the thing you want changed.';
      list.appendChild(li);
      return;
    }
    if(lastReport){
      const back=document.createElement('li'); back.className='an-empty';
      back.style.cursor='pointer';
      back.textContent='↩ last agent report ('+lastReport.meta+')';
      back.onclick=()=>report(lastReport.text,lastReport.meta,false);
      list.appendChild(back);
    }
    if(pins.some(p=>p.status!=='ready')){
      const head=document.createElement('li'); head.className='an-send-all';
      head.innerHTML=I.send+'<span>send all to agent</span>';
      head.onclick=()=>handoff(pins.filter(p=>p.status!=='ready').map(p=>p.id));
      list.appendChild(head);
    }
    // measure the page with no pins in it, so stale coordinates can't inflate it
    const docH=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
    pins.forEach((p,i)=>{
      // clamp a pin whose page got shorter back inside the document
      p.stale = p.y > docH-8;
      if(p.stale) p.y = Math.min(p.y, docH-24);
      const el=document.createElement('div');
      el.className='an-pin'+(p.status==='done'?' done':'')+(p.stale?' stale':'');
      el.style.left=p.x+'px'; el.style.top=p.y+'px'; el.style.pointerEvents='auto';
      el.textContent=i+1; el.title=(p.stale?'[position stale] ':'')+p.text;
      el.onclick=e=>{e.stopPropagation();view(p,i);};
      layer.appendChild(el);
      const kind=p.context&&p.context.label, ready=p.status==='ready';
      const li=document.createElement('li');
      if(ready) li.className='sent';
      li.innerHTML=`<b>${i+1}</b>`+
        (ready?'<span class="an-tag sent">sent</span>'
              :kind?`<span class="an-tag">${esc(kind)}</span>`:'')+
        `<span>${esc(p.text)}</span><span class="an-acts">
          <span class="ic" data-a="del" title="Delete this note">${I.trash}</span></span>`;
      li.querySelector('.ic').onclick=async e=>{
        e.stopPropagation();
        await fetch(API+'?id='+encodeURIComponent(p.id),{method:'DELETE'});
        pins=pins.filter(q=>q.id!==p.id); render();
      };
      li.onclick=()=>window.scrollTo({top:Math.max(0,p.y-200),behavior:'smooth'});
      list.appendChild(li);
    });
  }

  /* hand a batch over: the notes flip to 'ready', which is what an agent waits for,
     and the server runs whatever --on-handoff was given */
  async function handoff(ids){
    if(!ids.length) return;
    const r=await fetch(API+'/handoff',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ids})}).then(r=>r.json()).catch(()=>null);
    if(!r||!r.ok) return toast('could not reach the server — nothing was sent',true);
    pins.forEach(p=>{ if(ids.includes(p.id)) p.status='ready'; });
    render();
    const n=ids.length+(ids.length===1?' note':' notes');
    // never claim work started when nothing is wired up to start it
    if(!r.configured) return toast(n+' marked ready — but no --on-handoff is configured, '+
      'so nothing was started',true);
    toast(n+' sent — agent working'+(r.queued?' (queued behind '+r.queued+')':''));
    watchRun(ids);
  }

  let lastReport=null;
  function report(text,meta,live){
    let pop=document.querySelector('.an-report');
    if(!pop){
      pop=document.createElement('div'); pop.className='an-pop an-report';
      pop.innerHTML=`<div class="an-rhead">${live?'<span class="an-spin"></span>':''}
        <span class="an-kind">agent</span><span class="met"></span>
        <button title="Close">${I.x}</button></div><pre></pre>`;
      document.body.appendChild(pop);
      pop.querySelector('button').onclick=()=>pop.remove();
      glassFor(pop,'anGlassReport',17);
    }
    const spin=pop.querySelector('.an-spin');
    if(spin&&!live) spin.remove();
    pop.querySelector('.met').textContent=meta;
    const pre=pop.querySelector('pre');
    const atEnd=pre.scrollTop+pre.clientHeight>=pre.scrollHeight-30;
    pre.textContent=text;
    if(live&&atEnd) pre.scrollTop=pre.scrollHeight;
  }

  // the press has to mean something, so follow the run to its end and say how it went
  async function watchRun(ids){
    const until=Date.now()+600000, t0=Date.now();
    report('waiting for the agent…','starting',true);
    while(Date.now()<until){
      await new Promise(r=>setTimeout(r,1200));
      const st=await fetch(API+'/handoff').then(r=>r.json()).catch(()=>null);
      if(!st) continue;
      const secs=Math.round((Date.now()-t0)/1000);
      const last=st.last;
      if(last&&ids.every(id=>last.ids.includes(id))){
        lastReport={text:last.report||'(the command printed nothing)',
          meta:Math.round(last.ms/1000)+'s'+(last.code?' · exit '+last.code:'')};
        report(lastReport.text,lastReport.meta,false);
        if(last.code===0&&!last.error) refresh();
        else toast('the handoff command '+(last.error?'could not start: '+last.error
          :'exited '+last.code),true);
        return;
      }
      if(st.running) report(st.partial||'waiting for the agent…',secs+'s',true);
    }
    report('the agent is still going after ten minutes — see the terminal','timed out',false);
  }

  // in auto mode the agent edits the store as it resolves notes; pick that up
  async function refresh(){
    const d=await fetch(API).then(r=>r.json()).catch(()=>null);
    if(!d) return;
    pins=d.filter(a=>a.page===pageId());
    render();
  }

  function toast(msg,bad){
    document.querySelectorAll('.an-toast').forEach(n=>n.remove());
    const t=document.createElement('div');
    t.className='an-pop an-toast'+(bad?' bad':''); t.textContent=msg;
    document.body.appendChild(t);
    t.style.left=(scrollX+innerWidth-t.offsetWidth-16)+'px';
    t.style.top=(scrollY+innerHeight-t.offsetHeight-70)+'px';
    setTimeout(()=>{ t.style.opacity='0'; setTimeout(()=>t.remove(),300); },bad?6000:2600);
  }

  /* Find the element a saved note points at: the pin's own coordinates first,
     since those are exact, then the recorded path as a selector. */
  function elementFor(p){
    const probe=()=>{
      document.documentElement.classList.add('an-probe');
      const el=document.elementFromPoint(p.x-scrollX,p.y-scrollY);
      document.documentElement.classList.remove('an-probe');
      return el&&!el.closest(OURS)?el:null;
    };
    let el=probe();
    if(el&&pathOf(el)===p.target) return el;
    try{ const byPath=document.querySelector(p.target); if(byPath) return byPath; }catch{}
    return el;
  }

  /* edit a saved note: the same picker it was written in, prefilled */
  function edit(p,i){
    closePops();
    const y=Math.max(0,p.y-innerHeight/2);
    if(p.y<scrollY||p.y>scrollY+innerHeight) window.scrollTo({top:y});
    requestAnimationFrame(()=>{
      const el=elementFor(p);
      if(el) inspect(el,p.x,p.y,p);
      else editText(p,i);          // the element is gone; the words are still editable
    });
  }

  /* fallback when the element a note pointed at no longer exists */
  function editText(p,i){
    closePops();
    const pop=document.createElement('div'); pop.className='an-pop'; pop.dataset.glass='anGlassEdit';
    pop.innerHTML=`<div class="an-facts"><span class="an-kind">edit #${i+1}</span> ${
        esc(p.target||'')} · element not on the page any more</div>
      <textarea></textarea>
      <div class="btns"><button data-a="cancel" title="Cancel (Esc)">${I.x}</button>
      <button class="primary" data-a="save" title="Save (Cmd/Ctrl+Enter)">${I.check}</button></div>`;
    document.body.appendChild(pop);
    const ta=pop.querySelector('textarea'); ta.value=p.text;
    place(pop,Math.min(p.x,scrollX+innerWidth-40),Math.max(p.y,scrollY+20));
    ta.focus(); ta.setSelectionRange(ta.value.length,ta.value.length);
    const save=async()=>{
      const text=ta.value.trim();
      if(!text||text===p.text) return pop.remove();
      const r=await fetch(API+'?id='+encodeURIComponent(p.id),{method:'PATCH',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({text,intents:p.intents})}).then(r=>r.json()).catch(()=>null);
      if(r&&r.ok){ p.text=text; render(); }
      pop.remove();
    };
    pop.querySelector('[data-a="cancel"]').onclick=()=>pop.remove();
    pop.querySelector('[data-a="save"]').onclick=save;
    ta.onkeydown=e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) save();
                      if(e.key==='Escape'){ e.stopPropagation(); pop.remove(); } };
  }

  /* keep a panel fully inside the viewport: clamp both axes, flip above if it would
     hang off the bottom */
  function place(pop,px,py){
    glassFor(pop,pop.dataset.glass||'anGlassPop',17);
    const w=pop.offsetWidth, h=pop.offsetHeight, m=10;
    let top=py+18;
    if(top+h > scrollY+innerHeight-m) top=py-h-14;
    pop.style.left=Math.max(scrollX+m,Math.min(px,scrollX+innerWidth-w-m))+'px';
    pop.style.top =Math.max(scrollY+m,Math.min(top,scrollY+innerHeight-h-m))+'px';
  }
  const closePops=()=>document.querySelectorAll('.an-pop').forEach(n=>n.remove());

  /* read-only view of a saved note; a dialog would block the page, so this is a card */
  function view(p,i){
    closePops();
    const pop=document.createElement('div'); pop.className='an-pop';
    const bits=(p.intents||[]).map(t=>`<span class="an-chip on">${esc(t.label)}</span>`).join('');
    pop.innerHTML=`<div class="an-facts"><span class="an-kind">#${i+1}${
        p.context?' '+esc(p.context.label):''}</span> ${esc(p.target||'')}</div>
      <div class="an-read">${esc(p.text)}</div>
      ${bits?`<div class="an-ctl" style="margin-top:8px">${bits}</div>`:''}
      <div class="btns">
        <button data-a="edit" title="Edit">${I.edit}</button>
        ${p.status==='ready'?'':`<button data-a="send" title="Send to agent">${I.send}</button>`}
        <button data-a="close" title="Close">${I.x}</button></div>`;
    document.body.appendChild(pop);
    place(pop,Math.min(p.x,scrollX+innerWidth-40),Math.max(p.y,scrollY+20));
    pop.querySelector('[data-a="close"]').onclick=()=>pop.remove();
    pop.querySelector('[data-a="edit"]').onclick=()=>edit(p,i);
    const sendBtn=pop.querySelector('[data-a="send"]');
    if(sendBtn) sendBtn.onclick=()=>{ pop.remove(); handoff([p.id]); };
  }

  /* ---- the annotate popup ---- */
  function inspect(el,x,y,note){
    closePops();
    sel=el;
    const pop=document.createElement('div'); pop.className='an-pop';
    document.body.appendChild(pop);
    if(note) pop.dataset.glass='anGlassEdit';
    // a note saved from chips alone has synthesised text; leave the box empty so it
    // re-synthesises rather than freezing yesterday's wording into the record
    const synth=(note&&note.intents||[]).map(t=>t.label).join('; ');
    let text=note?(note.text===synth?'':note.text):'';

    function paint(){
      highlight(sel);
      const ctx=CTX?CTX.describe(sel):null;
      const controls=(ctx&&ctx.controls)||[];
      const shown=controls.filter(c=>c.primary), rest=controls.filter(c=>!c.primary);
      const one=c=>c.type==='select'
        ? `<label class="an-sel" data-id="${c.id}"><span>${esc(c.label)}</span><select data-id="${c.id}">
             <option value="">—</option>${c.options.map(o=>`<option>${esc(o)}</option>`).join('')}</select></label>`
        : `<button class="an-chip" data-id="${c.id}">${esc(c.label)}</button>`;
      const chain=chainOf(sel);
      const snip=snippet(sel);
      pop.innerHTML=`${note?`<div class="an-facts" style="margin-bottom:5px">
          <span class="an-kind">editing</span> was “${esc(note.text)}”</div>`:''}
        <div class="an-crumbs">${chain.map((n,i)=>
          `${i?'<span class="an-sep">›</span>':''}<button class="an-crumb${
            n===sel?' on':''}" data-i="${i}" title="${esc(nameOf(n))}">${esc(nameOf(n))}</button>`).join('')}</div>
        <div class="an-facts"><span class="an-kind">${esc(ctx?ctx.label:'element')}</span> ${
          esc((ctx&&ctx.facts||[]).join(' · '))}${snip?' · “'+esc(snip)+'”':''}</div>
        ${shown.length?`<div class="an-ctl">${shown.map(one).join('')}${
          rest.length?`<button class="an-chip an-more">+${rest.length}</button>
            <div class="an-rest">${rest.map(one).join('')}</div>`:''}</div>`:''}
        <textarea placeholder="What should change here?"></textarea>
        <div class="btns"><button data-a="cancel" title="Cancel (Esc)">${I.x}</button>
        <button class="primary" data-a="save" title="Save (Cmd/Ctrl+Enter)">${I.check}</button></div>`;

      const ta=pop.querySelector('textarea');
      ta.value=text; ta.oninput=()=>{ text=ta.value; };
      ta.onkeydown=e=>{ if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) save();
                        if(e.key==='Escape'){ e.stopPropagation(); done(); } };

      pop.querySelectorAll('.an-crumb').forEach(b=>{
        b.onmouseenter=()=>highlight(chain[+b.dataset.i]);
        b.onmouseleave=()=>highlight(sel);
        b.onclick=()=>{ intents.clear(); sel=chain[+b.dataset.i]; paint(); };
      });
      const more=pop.querySelector('.an-more');
      if(more) more.onclick=()=>{
        pop.querySelector('.an-rest').classList.toggle('show');
        more.classList.toggle('on');
        place(pop,x,y);
      };
      pop.querySelectorAll('.an-chip:not(.an-more)').forEach(b=>{
        if(intents.has(b.dataset.id)) b.classList.add('on');
        b.onclick=()=>{
          const on=b.classList.toggle('on');
          if(on) intents.set(b.dataset.id,{id:b.dataset.id,label:b.textContent});
          else intents.delete(b.dataset.id);
        };
      });
      pop.querySelectorAll('select').forEach(s=>{
        const cur=intents.get(s.dataset.id);
        if(cur){ s.value=cur.label.split(': ').pop(); s.closest('.an-sel').classList.add('on'); }
        s.onchange=()=>{
          const id=s.dataset.id, wrap=s.closest('.an-sel');
          if(s.value) intents.set(id,{id,label:wrap.querySelector('span').textContent+': '+s.value});
          else intents.delete(id);
          wrap.classList.toggle('on',!!s.value);
        };
      });
      pop.querySelector('[data-a="cancel"]').onclick=done;
      pop.querySelector('[data-a="save"]').onclick=save;
      place(pop,x,y);
      ta.focus();
    }

    // what the user picked, in the order they picked it — saved beside the free text
    const intents=new Map((note&&note.intents||[]).map(t=>[t.id,t]));
    function done(){ pop.remove(); sel=null; unhighlight(); }

    async function save(){
      const picked=[...intents.values()];
      // chips alone are a complete note; spell them out so the file still reads plainly
      const body=text.trim()||picked.map(t=>t.label).join('; ');
      if(!body) return done();
      const ctx=CTX?CTX.describe(sel):null;
      const rec={text:body,x,y,target:pathOf(sel),page:pageId(),
        viewport:innerWidth+'x'+innerHeight,
        theme:document.documentElement.getAttribute('data-theme')||
          (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light')};
      if(ctx) rec.context={kind:ctx.kind,label:ctx.label,tag:ctx.tag,role:ctx.role,facts:ctx.facts};
      if(picked.length) rec.intents=picked;
      if(note){
        const r=await fetch(API+'?id='+encodeURIComponent(note.id),{method:'PATCH',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({text:body,intents:picked,target:rec.target,context:rec.context})
        }).then(r=>r.json()).catch(()=>null);
        if(r&&r.ok) Object.assign(note,{text:body,intents:picked,target:rec.target,context:rec.context});
      } else {
        const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(rec)}).then(r=>r.json()).catch(()=>null);
        if(r&&r.ok){ rec.id=r.id; pins.push(rec); }
      }
      render();
      done();
    }

    paint();
  }

  /* ---- arming ---- */
  function arm(on){
    armed=on;
    document.body.classList.toggle('an-armed',on);
    const b=document.getElementById('anTog');
    b.classList.toggle('on',on);
    b.title=on?'Click an element — Esc to cancel':'Inspect and annotate — press A';
    if(!on && !document.querySelector('.an-pop')) unhighlight();
  }
  document.getElementById('anTog').onclick=()=>arm(!armed);
  document.getElementById('anList').onclick=()=>{
    list.classList.toggle('show');
    if(list.classList.contains('show')) glassFor(list,'anGlassList',17);
  };

  addEventListener('mousemove',e=>{
    if(!armed) return;
    const t=e.target;
    if(!t||t.closest&&t.closest(OURS)) return unhighlight();
    highlight(t);
  },true);
  addEventListener('keydown',e=>{
    if(e.target.matches&&e.target.matches('textarea,input,select')) return;
    if(e.key==='a'||e.key==='A') arm(!armed);
    if(e.key==='Escape'){ arm(false); closePops(); sel=null; unhighlight(); }
  });
  addEventListener('click',e=>{
    if(!armed) return;
    if(e.target.closest(OURS)) return;
    e.preventDefault(); e.stopPropagation();
    arm(false);
    inspect(e.target,e.pageX,e.pageY);
  },true);

  fetch(API).then(r=>r.json()).then(d=>{
    pins=(d||[]).filter(a=>a.page===pageId());
    render();
  }).catch(()=>render());
})();
