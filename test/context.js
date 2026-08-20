/* Unit test for the element-context table: the clicked tag has to land on the right
   kind, since that is what decides which controls the popup offers. */
const assert = require('assert');
const { describe } = require('../client/context.js');

/* enough of a DOM element for context.js: it only reads tagName, attributes,
   children, text, a bounding box and computed style */
function el(tag, o = {}) {
  return {
    tagName: tag.toUpperCase(),
    children: o.children || [],
    textContent: o.text || '',
    getAttribute(n) { return o.attrs && n in o.attrs ? o.attrs[n] : null; },
    getBoundingClientRect() { return o.rect || { width: 200, height: 40 }; },
    ownerDocument: { defaultView: { getComputedStyle: () => o.style || null } },
    matches(sel) {
      return sel.split(',').some(s => {
        const m = s.trim().match(/^([a-z]*)(?:\[([a-z-]+)(?:="([^"]*)")?\])?$/);
        if (!m || (!m[1] && !m[2])) return false;
        if (m[1] && m[1] !== tag) return false;
        return m[2] ? this.getAttribute(m[2]) === m[3] : true;
      });
    }
  };
}

let pass = 0;
const ok = (name, cond) => { assert.ok(cond, name); console.log('  ok  ' + name); pass++; };
const kindOf = (tag, o) => describe(el(tag, o)).kind;

ok('a heading is a heading', kindOf('h2') === 'heading');
ok('a paragraph is copy', kindOf('p') === 'text');
ok('a div of elements is layout', kindOf('div', { children: [el('p')] }) === 'layout');
ok('a div of only words is copy', kindOf('div', { text: 'just words' }) === 'text');
ok('a linked anchor is an action', kindOf('a', { attrs: { href: '/x' } }) === 'action');
ok('an anchor with no href is not', kindOf('a') !== 'action');
ok('a button is an action', kindOf('button') === 'action');
ok('a submit input is an action', kindOf('input', { attrs: { type: 'submit' } }) === 'action');
ok('a text input is a field', kindOf('input', { attrs: { type: 'text' } }) === 'field');
ok('an image is an image', kindOf('img') === 'image');
ok('a small svg is an icon', kindOf('svg', { rect: { width: 20, height: 20 } }) === 'icon');
ok('a large svg is a graphic', kindOf('svg', { rect: { width: 600, height: 400 } }) === 'graphic');
ok('a list is a list', kindOf('ul') === 'list');
ok('a table is a table', kindOf('table') === 'table');
ok('the body is the page', kindOf('body') === 'page');
ok('anything else still gets controls', describe(el('marquee')).controls.length > 0);

const copy = describe(el('p', {
  text: 'one two three',
  style: { fontSize: '16px', lineHeight: '1.5', fontWeight: '400', color: 'rgb(0,0,0)' }
}));
ok('copy offers language controls',
  copy.controls.some(c => c.id === 'tone' && c.type === 'select') &&
  copy.controls.some(c => c.id === 'length'));
ok('copy reports its typography and length',
  copy.facts.join(' ').includes('16px/1.5') && copy.facts.includes('3 words'));

const box = describe(el('section', {
  children: [el('div'), el('div')],
  style: { display: 'flex', flexDirection: 'row', gap: '12px', gridTemplateColumns: '',
           paddingTop: '0px', paddingRight: '0px', paddingBottom: '0px', paddingLeft: '0px' }
}));
ok('layout offers flow, alignment and spacing',
  ['flow', 'align', 'space'].every(id => box.controls.some(c => c.id === id && c.type === 'select')));
ok('layout reports how it is laid out', box.facts.some(f => f.includes('flex row') && f.includes('gap 12px')));

const img = describe(el('img', { attrs: { alt: '' } }));
ok('a missing alt is called out', img.facts.includes('no alt'));

console.log(`\n  ${pass} passed\n`);
