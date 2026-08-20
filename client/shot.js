/* agent-annotate — region capture.

   A page cannot read its own pixels: canvas rasterising of live DOM is a lie (no
   iframes, no shadow content, fonts and filters drift), and nothing else in the
   platform will hand you the rendered result. getDisplayMedia is the honest route —
   the browser captures the tab, we crop the dragged rectangle out of that frame.

   Consequences worth knowing, since they shape the UX:
   - It needs a user gesture, and the first call raises a picker. We keep the track
     alive afterwards so a run of captures asks once, and drop it when the toolbar
     goes idle.
   - It captures the *viewport*, so a selection is clipped to what is on screen.
   - Our own chrome would be in the frame, so it is hidden for the capture. */
(function () {
  const NS = 'an-shot';
  let track = null, video = null;

  // why it cannot capture, when it cannot: the three causes want different answers
  function unsupported() {
    if (!window.isSecureContext) return 'the page is not a secure context — serve it over localhost or https';
    if (!navigator.mediaDevices) return 'this browser exposes no mediaDevices here';
    if (!navigator.mediaDevices.getDisplayMedia) return 'this browser cannot capture a tab';
    return null;
  }
  const supported = () => !unsupported();

  async function stream() {
    if (track && track.readyState === 'live') return track;
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true,
      // @ts-ignore — Chromium only, and harmless elsewhere
      selfBrowserSurface: 'include', surfaceSwitching: 'exclude'
    });
    track = s.getVideoTracks()[0];
    track.addEventListener('ended', () => { track = null; });
    video = document.createElement('video');
    video.srcObject = s; video.muted = true; video.playsInline = true;
    await video.play();
    return track;
  }

  function release() {
    if (track) { track.stop(); track = null; }
    if (video) { video.srcObject = null; video = null; }
  }

  /* one frame, cropped to a viewport-space rectangle */
  async function grab(rect) {
    await stream();
    // let the browser paint a frame with our chrome hidden
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) throw new Error('no frame from the capture');
    // the captured surface is the viewport at some scale
    const sx = vw / innerWidth, sy = vh / innerHeight;
    const w = Math.max(1, Math.round(rect.w * sx)), h = Math.max(1, Math.round(rect.h * sy));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(video,
      Math.round(rect.x * sx), Math.round(rect.y * sy), Math.round(rect.w * sx), Math.round(rect.h * sy),
      0, 0, w, h);
    return { dataURL: c.toDataURL('image/png'), width: w, height: h };
  }

  /* drag a rectangle; resolves with it in viewport space, or null if cancelled */
  function select() {
    return new Promise(resolve => {
      const dim = document.createElement('div');
      dim.className = NS + '-dim';
      const box = document.createElement('div');
      box.className = NS + '-box';
      const tip = document.createElement('div');
      tip.className = NS + '-tip';
      tip.textContent = 'drag the area to capture · Esc to cancel';
      document.body.append(dim, box, tip);

      let x0 = 0, y0 = 0, drawing = false;
      const done = r => {
        dim.remove(); box.remove(); tip.remove();
        removeEventListener('mousedown', down, true);
        removeEventListener('mousemove', move, true);
        removeEventListener('mouseup', up, true);
        removeEventListener('keydown', key, true);
        resolve(r);
      };
      const paint = (x, y) => {
        const r = { x: Math.min(x, x0), y: Math.min(y, y0), w: Math.abs(x - x0), h: Math.abs(y - y0) };
        box.style.cssText += `;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;display:block`;
        tip.textContent = `${Math.round(r.w)} × ${Math.round(r.h)}`;
        return r;
      };
      const down = e => {
        e.preventDefault(); e.stopPropagation();
        drawing = true; x0 = e.clientX; y0 = e.clientY; paint(e.clientX, e.clientY);
      };
      const move = e => { if (drawing) { e.preventDefault(); paint(e.clientX, e.clientY); } };
      const up = e => {
        if (!drawing) return;
        e.preventDefault(); e.stopPropagation();
        const r = paint(e.clientX, e.clientY);
        // a click rather than a drag means they changed their mind
        done(r.w > 8 && r.h > 8 ? r : null);
      };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      addEventListener('mousedown', down, true);
      addEventListener('mousemove', move, true);
      addEventListener('mouseup', up, true);
      addEventListener('keydown', key, true);
    });
  }

  window.__ANNOTATE_SHOT = { supported, unsupported, select, grab, release };
})();
