/* agent-annotate — what kind of thing did the user just click?
   Pure lookup over the clicked element: a kind, a few measured facts worth telling
   the agent, and the controls that make sense for that kind. Served ahead of
   annotate.js as part of /__annotate/client.js. */
(function () {
  const TEXT = 'p,span,li,a,blockquote,figcaption,label,strong,em,small,code,pre,td,th,dt,dd,summary,q,cite,time,abbr';
  const FIELD = 'input,textarea,select,option,fieldset,legend';
  const BOX = 'div,section,article,main,aside,header,footer,nav,form,figure,details,dialog';

  const is = (el, sel) => el.matches && el.matches(sel);
  const px = n => Math.round(n) + 'px';

  function styleOf(el) {
    try { return (el.ownerDocument.defaultView || window).getComputedStyle(el); }
    catch { return null; }
  }
  function boxOf(el) {
    try { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }
    catch { return { w: 0, h: 0 }; }
  }

  /* ---- kinds ---- */
  function classify(el, tag, cs) {
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img' || tag === 'picture') return 'image';
    if (tag === 'svg' || tag === 'use' || tag === 'path') {
      const b = boxOf(el);
      return (b.w && b.w <= 48 && b.h <= 48) ? 'icon' : 'graphic';
    }
    if (tag === 'video' || tag === 'audio' || tag === 'canvas' || tag === 'iframe') return 'media';
    if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tr') return 'table';
    if (tag === 'ul' || tag === 'ol' || tag === 'dl') return 'list';
    if (tag === 'button' || is(el, '[role="button"]') || is(el, 'input[type="submit"],input[type="button"]')) return 'action';
    if (tag === 'a' && el.getAttribute && el.getAttribute('href') != null) return 'action';
    if (is(el, FIELD)) return 'field';
    if (tag === 'body' || tag === 'html') return 'page';
    if (is(el, TEXT)) return 'text';
    if (is(el, BOX)) {
      // a box holding nothing but words is really a piece of copy
      const kids = el.children ? el.children.length : 0;
      const words = (el.textContent || '').trim();
      if (!kids && words) return 'text';
      return 'layout';
    }
    return 'element';
  }

  const KIND_LABEL = {
    heading: 'heading', text: 'copy', image: 'image', icon: 'icon', graphic: 'graphic',
    media: 'media', table: 'table', list: 'list', action: 'button / link',
    field: 'form field', layout: 'layout', page: 'page', element: 'element'
  };

  /* ---- controls offered per kind ----
     select → one choice at a time; chip → toggles on and off. Both write an intent
     line into the note, so the agent gets a verb, not just a coordinate. */
  const wording = [
    { type: 'select', id: 'tone', label: 'tone', primary: true, options: [
      'plainer', 'warmer', 'more formal', 'punchier', 'calmer', 'more playful'] },
    { type: 'select', id: 'length', label: 'length', primary: true, options: [
      'shorter', 'much shorter', 'longer', 'split into two'] },
    { type: 'chip', id: 'jargon', label: 'drop the jargon' },
    { type: 'chip', id: 'grammar', label: 'fix grammar' },
    { type: 'chip', id: 'sentence-case', label: 'sentence case' },
    { type: 'chip', id: 'repetition', label: 'stop repeating' }
  ];

  const CONTROLS = {
    heading: [
      ...wording,
      { type: 'chip', id: 'more-specific', label: 'be more specific' },
      { type: 'chip', id: 'level', label: 'wrong heading level' }
    ],
    text: [
      ...wording,
      { type: 'chip', id: 'measure', label: 'line length too wide' },
      { type: 'chip', id: 'contrast', label: 'hard to read' }
    ],
    layout: [
      { type: 'select', id: 'flow', label: 'flow', primary: true, options: [
        'stack vertically', 'side by side', 'two columns', 'three columns', 'wrap to a grid'] },
      { type: 'select', id: 'align', label: 'align', primary: true, options: [
        'centre both ways', 'left-align', 'right-align', 'space between', 'top-align', 'baseline'] },
      { type: 'select', id: 'space', label: 'space', primary: true, options: [
        'tighter', 'roomier', 'even gaps', 'no gap'] },
      { type: 'chip', id: 'max-width', label: 'constrain width' },
      { type: 'chip', id: 'full-bleed', label: 'full bleed' },
      { type: 'chip', id: 'reorder', label: 'reorder children' },
      { type: 'chip', id: 'mobile', label: 'breaks on mobile' }
    ],
    action: [
      { type: 'select', id: 'emphasis', label: 'emphasis', primary: true, options: [
        'primary', 'secondary', 'quiet', 'destructive'] },
      { type: 'select', id: 'size', label: 'size', primary: true, options: ['smaller', 'larger', 'full width'] },
      { type: 'chip', id: 'label', label: 'change the label', primary: true },
      { type: 'chip', id: 'icon', label: 'wants an icon' },
      { type: 'chip', id: 'states', label: 'hover / focus state' },
      { type: 'chip', id: 'target', label: 'tap target too small' },
      { type: 'chip', id: 'destination', label: 'goes to the wrong place' }
    ],
    field: [
      { type: 'chip', id: 'label', label: 'label wording', primary: true },
      { type: 'chip', id: 'placeholder', label: 'placeholder', primary: true },
      { type: 'chip', id: 'help', label: 'needs help text' },
      { type: 'chip', id: 'validation', label: 'validation message', primary: true },
      { type: 'chip', id: 'width', label: 'wrong width' },
      { type: 'chip', id: 'required', label: 'required / optional' }
    ],
    list: [
      { type: 'select', id: 'marker', label: 'marker', primary: true, options: ['bullets', 'numbers', 'none', 'custom'] },
      { type: 'select', id: 'space', label: 'space', options: ['tighter', 'roomier'] },
      { type: 'chip', id: 'order', label: 'reorder items', primary: true },
      { type: 'chip', id: 'trim', label: 'too many items' },
      { type: 'chip', id: 'columns', label: 'split into columns' }
    ],
    table: [
      { type: 'chip', id: 'widths', label: 'column widths', primary: true },
      { type: 'chip', id: 'numeric', label: 'right-align numbers' },
      { type: 'chip', id: 'columns', label: 'too many columns', primary: true },
      { type: 'chip', id: 'sticky', label: 'sticky header' },
      { type: 'chip', id: 'scroll', label: 'scroll on mobile' }
    ],
    image: [
      { type: 'select', id: 'fit', label: 'fit', primary: true, options: ['cover', 'contain', 'different crop'] },
      { type: 'select', id: 'size', label: 'size', options: ['smaller', 'larger', 'full width'] },
      { type: 'chip', id: 'replace', label: 'replace it', primary: true },
      { type: 'chip', id: 'alt', label: 'alt text', primary: true },
      { type: 'chip', id: 'radius', label: 'rounded corners' },
      { type: 'chip', id: 'aspect', label: 'aspect ratio' }
    ],
    icon: [
      { type: 'select', id: 'size', label: 'size', primary: true, options: ['smaller', 'larger'] },
      { type: 'chip', id: 'swap', label: 'wrong icon', primary: true },
      { type: 'chip', id: 'colour', label: 'colour' },
      { type: 'chip', id: 'weight', label: 'stroke weight' },
      { type: 'chip', id: 'align', label: 'misaligned' }
    ],
    graphic: [
      { type: 'select', id: 'size', label: 'size', primary: true, options: ['smaller', 'larger', 'full width'] },
      { type: 'chip', id: 'colour', label: 'colour', primary: true },
      { type: 'chip', id: 'detail', label: 'too busy' },
      { type: 'chip', id: 'motion', label: 'animate it' }
    ],
    media: [
      { type: 'select', id: 'size', label: 'size', primary: true, options: ['smaller', 'larger', 'full width'] },
      { type: 'chip', id: 'poster', label: 'poster frame' },
      { type: 'chip', id: 'controls', label: 'controls', primary: true },
      { type: 'chip', id: 'autoplay', label: 'autoplay / loop' },
      { type: 'chip', id: 'aspect', label: 'aspect ratio' }
    ],
    page: [
      { type: 'select', id: 'space', label: 'rhythm', primary: true, options: ['tighter', 'roomier'] },
      { type: 'chip', id: 'width', label: 'page max width', primary: true },
      { type: 'chip', id: 'background', label: 'background' },
      { type: 'chip', id: 'theme', label: 'dark mode' },
      { type: 'chip', id: 'order', label: 'section order' }
    ],
    element: [
      { type: 'chip', id: 'spacing', label: 'spacing', primary: true },
      { type: 'chip', id: 'colour', label: 'colour', primary: true },
      { type: 'chip', id: 'size', label: 'size', primary: true },
      { type: 'chip', id: 'remove', label: 'remove it' }
    ]
  };

  /* ---- measured facts, the things the agent would otherwise have to guess ---- */
  function facts(el, tag, kind, cs) {
    const out = [], b = boxOf(el);
    if (b.w) out.push(Math.round(b.w) + '×' + Math.round(b.h));
    if (cs) {
      if (kind === 'layout' || kind === 'page') {
        let flow = cs.display;
        if (/flex|grid/.test(cs.display)) {
          const dir = cs.display.includes('grid')
            ? (cs.gridTemplateColumns || '').split(' ').filter(Boolean).length + ' cols'
            : cs.flexDirection;
          flow += ' ' + dir;
          if (cs.gap && cs.gap !== 'normal') flow += ' gap ' + cs.gap;
        }
        out.push(flow);
        const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft];
        if (pad.some(p => parseFloat(p) > 0)) out.push('pad ' + [...new Set(pad)].join(' '));
      }
      if (kind === 'text' || kind === 'heading' || kind === 'action') {
        out.push(cs.fontSize + '/' + cs.lineHeight + ' ' + (cs.fontWeight || ''));
        out.push(cs.color);
      }
    }
    const words = (el.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    if (words && (kind === 'text' || kind === 'heading')) out.push(words + ' words');
    if (tag === 'img') out.push(el.getAttribute('alt') ? 'has alt' : 'no alt');
    if (tag === 'a' && el.getAttribute('href')) out.push('→ ' + el.getAttribute('href'));
    if (kind === 'field') out.push((el.getAttribute && el.getAttribute('type')) || tag);
    return out.filter(Boolean);
  }

  function describe(el) {
    const tag = (el.tagName || '').toLowerCase();
    const cs = styleOf(el);
    const kind = classify(el, tag, cs);
    const ctx = {
      kind, tag, label: KIND_LABEL[kind] || kind,
      facts: facts(el, tag, kind, cs),
      // primaries first: the popup shows those and folds the rest away
      controls: (CONTROLS[kind] || CONTROLS.element)
        .slice().sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0))
    };
    const role = el.getAttribute && el.getAttribute('role');
    if (role) ctx.role = role;
    return ctx;
  }

  const api = { describe, classify, CONTROLS, KIND_LABEL };
  if (typeof window !== 'undefined') window.__ANNOTATE_CONTEXT = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
