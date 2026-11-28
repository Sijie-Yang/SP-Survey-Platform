/**
 * Preview-only helper for SP-Scheme pages: lets a viewer click through a
 * page screen by screen ("下一页") without answering or waiting.
 *
 * Every SP-Scheme page is its own small app (its own steps, checks and
 * timers), so the platform cannot jump to "page 3". Instead, on each skip
 * request this script, injected only into previews, does what a hurried
 * participant would do on the current screen:
 *   1. answers what is still empty (radio, checkbox, select, slider, text);
 *   2. presses the page's forward button (Next / Continue / Start / Finish …);
 *   3. if the screen is still there, clicks one option in each group of
 *      clickable choices (rating buttons, images to pick);
 *   4. if it is still there, fast-forwards the page's clock (timers, Date,
 *      videos) until the screen changes, so timed views end at once.
 * It stops as soon as the screen changes, so one press = one screen.
 *
 * Never injected into participant links. Pages keep running in real time
 * until a skip is requested.
 */
export const SP_SITE_PREVIEW_TOOLS_SOURCE = String.raw`
(function () {
  if (window.__SP_PREVIEW_TOOLS__) return;
  window.__SP_PREVIEW_TOOLS__ = true;

  // ---- A clock the preview can move forward --------------------------------
  var offset = 0;
  var RealDate = Date;
  var realNow = RealDate.now.bind(RealDate);
  function now() { return realNow() + offset; }
  function PreviewDate() {
    var a = arguments;
    if (!(this instanceof PreviewDate)) return new RealDate(now()).toString();
    if (a.length === 0) return new RealDate(now());
    return new (Function.prototype.bind.apply(RealDate, [null].concat(Array.prototype.slice.call(a))))();
  }
  PreviewDate.prototype = RealDate.prototype;
  PreviewDate.now = now;
  PreviewDate.parse = RealDate.parse;
  PreviewDate.UTC = RealDate.UTC;
  window.Date = PreviewDate;
  if (window.performance && performance.now) {
    var realPerf = performance.now.bind(performance);
    try { performance.now = function () { return realPerf() + offset; }; } catch (e) { /* read-only */ }
  }
  if (window.requestAnimationFrame) {
    var realRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) {
      return realRaf(function () { cb(window.performance ? performance.now() : now()); });
    };
  }

  var realSetTimeout = window.setTimeout.bind(window);
  var realClearTimeout = window.clearTimeout.bind(window);
  var realSetInterval = window.setInterval.bind(window);
  var realClearInterval = window.clearInterval.bind(window);
  var timers = {};
  function invoke(fn, args) {
    if (typeof fn === 'function') fn.apply(window, args);
    else if (typeof fn === 'string') (0, eval)(fn);
  }
  window.setTimeout = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2);
    var delay = Math.max(0, Number(ms) || 0);
    var id = realSetTimeout(function () { delete timers[id]; invoke(fn, args); }, delay);
    timers[id] = { fn: fn, args: args, due: now() + delay, repeat: 0 };
    return id;
  };
  window.clearTimeout = function (id) { delete timers[id]; realClearTimeout(id); };
  window.setInterval = function (fn, ms) {
    var args = Array.prototype.slice.call(arguments, 2);
    var delay = Math.max(1, Number(ms) || 0);
    var id = realSetInterval(function () { if (timers[id]) timers[id].due = now() + delay; invoke(fn, args); }, delay);
    timers[id] = { fn: fn, args: args, due: now() + delay, repeat: delay };
    return id;
  };
  window.clearInterval = function (id) { delete timers[id]; realClearInterval(id); };

  function wait(ms) { return new Promise(function (resolve) { realSetTimeout(resolve, ms); }); }

  // Answers travel to the platform and back; a page usually moves on only
  // after that reply, so count the ones still on their way.
  var inflight = 0;
  function track(name) {
    var original = window.SPSite && window.SPSite[name];
    if (typeof original !== 'function') return;
    window.SPSite[name] = function () {
      inflight += 1;
      var p = original.apply(window.SPSite, arguments);
      var done = function () { inflight = Math.max(0, inflight - 1); };
      if (p && typeof p.then === 'function') p.then(done, done); else done();
      return p;
    };
  }
  track('answer');
  track('complete');
  async function replies() {
    for (var i = 0; i < 60 && inflight > 0; i += 1) await wait(50);
  }

  // ---- What is on screen -----------------------------------------------------
  function visible(el) {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    var s = window.getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(visible); }
  function label(el) {
    return String(el.innerText || el.value || el.getAttribute('aria-label') || el.title || '').replace(/\s+/g, ' ').trim();
  }
  // Trial counters ("Image 3 of 17", "2 / 40") tell trials apart.
  var COUNTER_RE = /(^|[^0-9:.])([0-9]{1,4})\s*(?:of|out of|\/|／)\s*([0-9]{1,4})(?![0-9:])/gi;
  function counters() {
    var text = document.body ? String(document.body.innerText || '') : '';
    var out = [], m;
    COUNTER_RE.lastIndex = 0;
    while ((m = COUNTER_RE.exec(text)) && out.length < 10) out.push(m[2] + '/' + m[3]);
    return out.join(',');
  }
  // Other digits are left out so a running countdown ("12 s") does not count as a new screen.
  function signature() {
    var parts = [];
    all('img,video,audio,canvas').forEach(function (el) { parts.push(el.tagName + ':' + (el.currentSrc || el.src || el.width)); });
    all('input,select,textarea').forEach(function (el) { parts.push((el.name || el.id || el.type) + ':' + el.type); });
    all('h1,h2,h3,h4,legend,button,[role=button]').forEach(function (el) { parts.push(label(el)); });
    // Colour swatches and pictures drawn as backgrounds.
    all('[style*="background"]').forEach(function (el) { parts.push(el.getAttribute('style')); });
    all('.prog,.progress,[class*=prog],[class*=step],[class*=counter]').forEach(function (el) { parts.push(label(el)); });
    // The words on screen (a new stimulus word, a new statement).
    parts.push(document.body ? String(document.body.innerText || '').slice(0, 3000) : '');
    return parts.join('|').replace(/[0-9]+/g, '') + '#' + counters();
  }

  var BACK_RE = /\b(back|previous|prev|undo|again|over|restart|reset|close|pause|cancel|clear|remove|delete|replay)\b|上一|返回|重新|撤销|清除|删除|关闭|暂停|✕|×|‹|&lsaquo;/i;
  var FORWARD_RE = /\b(next|continue|start|begin|submit|finish|finished|done|proceed|go|ok|okay|i agree|agree|enter|confirm|save|send|complete|play|show|ready)\b|下一|继续|开始|提交|完成|确定|确认|进入|同意|保存|›|→|»|▶/i;

  function clickables() {
    return all('button,input[type=submit],input[type=button],a[role=button],[role=button],a[href="#"]').filter(function (el) {
      return !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    });
  }
  function forwardButton() {
    var buttons = clickables().filter(function (b) { var t = label(b); return t && !BACK_RE.test(t); });
    var forward = buttons.filter(function (b) { return FORWARD_RE.test(label(b)); });
    if (forward.length) return forward[forward.length - 1];
    return buttons.length === 1 ? buttons[0] : null;
  }

  // ---- Answering what is empty -----------------------------------------------
  function setValue(el, value) {
    var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function groupKey(el) {
    if (el.name) return el.type + ':' + el.name;
    var box = el.closest('fieldset,[role=radiogroup],tr,li,.row,.item,.q,div');
    return el.type + ':box:' + (box ? Array.prototype.indexOf.call(document.querySelectorAll('*'), box) : 0);
  }
  function fillInputs() {
    var changed = false;
    var groups = {};
    all('input[type=radio],input[type=checkbox]').forEach(function (el) {
      if (el.disabled) return;
      (groups[groupKey(el)] = groups[groupKey(el)] || []).push(el);
    });
    // Radios hidden behind styled labels count too.
    Array.prototype.slice.call(document.querySelectorAll('input[type=radio],input[type=checkbox]')).forEach(function (el) {
      if (el.disabled || visible(el)) return;
      var lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
      if (lab && visible(lab)) (groups[groupKey(el)] = groups[groupKey(el)] || []).push(el);
    });
    Object.keys(groups).forEach(function (k) {
      var list = groups[k];
      if (list.some(function (el) { return el.checked; })) return;
      var pick = list[0];
      var lab = pick.closest('label');
      if (!visible(pick) && lab) lab.click(); else pick.click();
      if (!pick.checked) { pick.checked = true; pick.dispatchEvent(new Event('input', { bubbles: true })); pick.dispatchEvent(new Event('change', { bubbles: true })); }
      changed = true;
    });
    // Lists with the same options (rank 1-6 with one list per item) get
    // different values, so a "use each rank once" check passes.
    var used = {};
    all('select').forEach(function (el) {
      if (el.disabled || (el.value && el.selectedIndex > 0) || (el.value && el.options[0] && el.options[0].value)) return;
      var opts = Array.prototype.filter.call(el.options, function (o) { return o.value && !o.disabled; });
      if (!opts.length) return;
      var key = opts.map(function (o) { return o.value; }).join('|');
      var n = used[key] = (used[key] || 0) + 1;
      setValue(el, opts[(n - 1) % opts.length].value);
      changed = true;
    });
    all('input[type=range]').forEach(function (el) {
      if (el.disabled || el.dataset.spPreviewFilled) return;
      var min = Number(el.min || 0), max = Number(el.max || 100);
      el.dataset.spPreviewFilled = '1';
      ['pointerdown', 'mousedown'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
      setValue(el, String(Math.round((min + max) / 2)));
      ['pointerup', 'mouseup', 'click'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
      changed = true;
    });
    all('input:not([type]),input[type=text],input[type=number],input[type=email],input[type=tel],input[type=url],input[type=date],textarea').forEach(function (el) {
      if (el.disabled || el.readOnly || String(el.value).trim()) return;
      var v = 'preview';
      if (el.type === 'number') {
        var lo = el.min !== '' ? Number(el.min) : NaN, hi = el.max !== '' ? Number(el.max) : NaN;
        v = String(!isNaN(lo) && !isNaN(hi) ? Math.round((lo + hi) / 2) : !isNaN(lo) ? lo : !isNaN(hi) ? Math.min(hi, 30) : 30);
      } else if (el.type === 'email') v = 'preview@example.com';
      else if (el.type === 'tel') v = '12345678';
      else if (el.type === 'url') v = 'https://example.com';
      else if (el.type === 'date') v = new RealDate(realNow()).toISOString().slice(0, 10);
      else if (el.inputMode === 'numeric' || el.inputMode === 'decimal' || /\d|0-9/.test(el.pattern || '')) v = '30';
      else if (el.maxLength > 0 && el.maxLength < 7) v = 'p';
      else if (el.tagName === 'TEXTAREA') {
        // Long enough for pages that ask for "at least five lines".
        v = 'Preview answer, written by the preview so the page can go on.';
        v = [v, v, v, v, v, v].join('\n');
      }
      if (el.minLength > v.length) v = new Array(Math.ceil(el.minLength / v.length) + 1).join(v + ' ');
      if (el.maxLength > 0) v = v.slice(0, el.maxLength);
      setValue(el, v);
      changed = true;
    });
    return changed;
  }

  // Clickable choices the page drew itself: rating buttons, images to pick.
  function optionGroups() {
    var forward = forwardButton();
    var cands = all('button,[role=button],[role=radio],[role=option],[role=slider],[data-v],[data-value],img,figure,.opt,.option,.choice,.card,div,span,li,td').filter(function (el) {
      if (el === forward || el.disabled || BACK_RE.test(label(el))) return false;
      if (el.querySelector('input,select,textarea') || el.closest('label')) return false;
      if (el.closest('a[href]:not([href="#"])')) return false;
      var s = window.getComputedStyle(el);
      return el.tagName === 'BUTTON' || el.getAttribute('role') || s.cursor === 'pointer';
    });
    // Keep the outermost clickable element of each nested pair.
    cands = cands.filter(function (el) { return !cands.some(function (o) { return o !== el && o.contains(el); }); });
    var groups = [];
    cands.forEach(function (el) {
      var g = groups.filter(function (x) { return x.parent === el.parentElement; })[0];
      if (!g) groups.push(g = { parent: el.parentElement, items: [] });
      g.items.push(el);
    });
    function isOn(el) {
      var cls = typeof el.className === 'string' ? el.className : '';
      return /\b(selected|active|on|chosen|picked|checked|sel)\b/.test(cls)
        || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true';
    }
    // Only what is not chosen yet.
    return groups.map(function (g) { return { parent: g.parent, items: g.items.filter(function (el) { return !isOn(el); }) }; })
      .filter(function (g) { return g.items.length; });
  }

  // Sliders, dividers and pictures the page lets you drag; drawing canvases.
  function pointer(el, type, x, y) {
    var o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: type === 'up' ? 0 : 1, button: 0 };
    var names = { down: ['pointerdown', 'mousedown'], move: ['pointermove', 'mousemove'], up: ['pointerup', 'mouseup'] }[type];
    // Sent to the dragged element itself; it bubbles to the page's document listeners.
    try { el.dispatchEvent(new PointerEvent(names[0], o)); } catch (e) { /* old browser */ }
    el.dispatchEvent(new MouseEvent(names[1], o));
    try {
      var touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent({ down: 'touchstart', move: 'touchmove', up: 'touchend' }[type], { bubbles: true, cancelable: true, touches: type === 'up' ? [] : [touch], targetTouches: type === 'up' ? [] : [touch], changedTouches: [touch] }));
    } catch (e) { /* no touch support */ }
  }
  async function dragAll(before) {
    var cands = all('canvas,svg,[draggable=true],img,div,span').filter(function (el) {
      var s = window.getComputedStyle(el);
      if (/grab|move|resize|crosshair/.test(s.cursor) || el.getAttribute('draggable') === 'true' || el.tagName === 'CANVAS') return true;
      if (s.touchAction === 'none') return true;
      // Pictures placed on a drag board.
      var p = el.parentElement;
      return el.tagName === 'IMG' && p && window.getComputedStyle(p).touchAction === 'none' && s.position === 'absolute';
    });
    // The innermost one: the handle, not its track; the pictures, not their board.
    cands = cands.filter(function (el) { return !cands.some(function (o) { return o !== el && el.contains(o); }); }).slice(0, 40);
    for (var i = 0; i < cands.length; i += 1) {
      var r = cands[i].getBoundingClientRect();
      var x = r.left + r.width / 2, y = r.top + r.height / 2;
      var dx = Math.max(20, Math.min(160, r.width * 0.3)), dy = cands[i].tagName === 'CANVAS' ? Math.min(60, r.height * 0.2) : 12 * ((i % 5) - 2);
      pointer(cands[i], 'down', x, y);
      for (var step = 1; step <= 6; step += 1) { pointer(cands[i], 'move', x + (dx * step) / 6, y + (dy * step) / 6); }
      pointer(cands[i], 'up', x + dx, y + dy);
      await wait(15);
      if (signature() !== before && !forwardButton()) return true;
    }
    if (!cands.length) return false;
    var b = forwardButton();
    if (b) { press(b); return settle(before); }
    return signature() !== before;
  }

  // ---- Moving the clock ----------------------------------------------------------
  function endMedia() {
    all('video,audio').forEach(function (el) {
      try {
        if (isFinite(el.duration) && el.duration > 0) el.currentTime = Math.max(0, el.duration - 0.05);
        el.dispatchEvent(new Event('ended'));
      } catch (e) { /* ignore */ }
    });
  }
  var fired = 0;
  async function fastForward(before, limitMs, ready) {
    var target = now() + limitMs;
    endMedia();
    for (var round = 0; round < 4000; round += 1) {
      var next = null, nextId = null;
      Object.keys(timers).forEach(function (id) {
        var t = timers[id];
        if (t.due <= target && (!next || t.due < next.due)) { next = t; nextId = id; }
      });
      if (!next) break;
      if (next.due > now()) offset += next.due - now();
      var oneShot = !next.repeat;
      if (next.repeat) next.due = now() + next.repeat;
      else { delete timers[nextId]; realClearTimeout(Number(nextId)); }
      fired += 1;
      try { invoke(next.fn, next.args); } catch (e) { console.error(e); }
      // Reading the screen is the slow part: do it after a one-off timer, or
      // every few ticks of a repeating one (a clock ticking every 100 ms).
      if (!oneShot && round % 8 !== 7) continue;
      await wait(0);
      if (signature() !== before) return true;
      if (ready != null && controls() !== ready) return true;
    }
    await wait(20);
    return signature() !== before || (ready != null && controls() !== ready);
  }

  // Did the click move the page on? Short delays after it (a fade, a 400 ms
  // pause before the next picture) are run through at once.
  async function settle(before) {
    await replies();
    for (var i = 0; i < 3; i += 1) {
      await wait(30);
      if (signature() !== before) { await wait(30); return true; }
    }
    if (await fastForward(before, 2500)) { await wait(30); return true; }
    await replies();
    await wait(60);
    return signature() !== before;
  }

  // After a choice many pages show a blank pause (fixation cross, 500 ms gap)
  // before the next trial; run past it so one press lands on something to see.
  async function pastShortPause() {
    for (var i = 0; i < 5; i += 1) {
      if (forwardButton() || all('input,select,textarea,img,video,canvas,svg').length) return;
      var soon = Object.keys(timers).some(function (id) { return timers[id].due - now() <= 1500; });
      if (!soon) return;
      var sig = signature();
      var target = now() + 1500;
      await fastForward(sig, Math.max(1, target - now()));
    }
  }

  // What can be pressed right now; a change means the page unlocked something.
  function controls() {
    return clickables().length + ':' + optionGroups().length + ':' + (forwardButton() ? label(forwardButton()) : '');
  }

  // A real press: some pages listen for pointerdown rather than click.
  function press(el) {
    var r = el.getBoundingClientRect();
    var o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };
    var cancelled = false;
    try { cancelled = !el.dispatchEvent(new PointerEvent('pointerdown', o)); } catch (e) { /* old browser */ }
    el.dispatchEvent(new MouseEvent('mousedown', o));
    try { el.dispatchEvent(new PointerEvent('pointerup', o)); } catch (e) { /* old browser */ }
    el.dispatchEvent(new MouseEvent('mouseup', o));
    // A page that handled pointerdown itself (and cancelled it) gets no click.
    if (!cancelled && document.contains(el)) el.click();
  }

  // Try what a participant would do on this screen. Returns how it moved on, or ''.
  async function act(base) {
    var b = forwardButton();
    if (b) { press(b); if (await settle(base)) return 'button'; }
    // Clickable choices: try them one by one until the page moves on or
    // its forward button becomes usable (a tap-to-rank page needs them all).
    var groups = optionGroups();
    for (var g = 0; g < groups.length; g += 1) {
      var items = groups[g].items;
      // Start in the middle, one further along for each row, so rows like
      // "most" and "least" do not get the same answer.
      var from = (Math.floor(items.length / 2) + g) % items.length;
      var order = items.slice(from).concat(items.slice(0, from));
      for (var k = 0; k < order.length && k < 40; k += 1) {
        if (!visible(order[k]) || order[k].disabled) continue;
        var before = forwardButton();
        press(order[k]);
        if (await settle(base)) return 'option';
        // One choice per row when the page already has its forward button
        // (a form); keep tapping only while it has none (tap-to-rank).
        if (before || forwardButton()) break;
      }
    }
    if (await dragAll(base)) return 'drag';
    fillInputs();
    b = forwardButton();
    if (b) { press(b); if (await settle(base)) return 'button'; }
    return '';
  }

  // ---- One skip ----------------------------------------------------------------
  var busy = false;
  async function skip() {
    if (busy) return { moved: false, busy: true };
    busy = true;
    var alert0 = window.alert, confirm0 = window.confirm;
    window.alert = function (m) { console.info('[preview] alert:', m); };
    window.confirm = function () { return true; };
    try {
      // Many pages keep their buttons off until the picture has loaded.
      for (var w = 0; w < 15 && all('img').some(function (im) { return !im.complete; }); w += 1) await wait(100);
      var start = signature();
      for (var pass = 0; pass < 3; pass += 1) {
        for (var i = 0; i < 3 && fillInputs(); i += 1) await wait(30);
        var base = signature();
        if (pass === 0 && base !== start && !forwardButton()) return { moved: true };
        var step = await act(base);
        if (step) return { moved: true, step: step };
        // Nothing to press yet: run the clock until the screen changes or
        // something becomes pressable (buttons that unlock after a few seconds).
        var ready = controls();
        var firedBefore = fired;
        if (await fastForward(base, 15 * 60 * 1000, ready)) {
          if (signature() !== base) return { moved: true, step: 'time' };
        } else if (controls() === ready && fired === firedBefore) break;
        // Timers ran (a choice that unlocks after a few seconds): try again.
      }
      return { moved: false };
    } catch (e) {
      return { moved: false, error: String(e && e.message || e) };
    } finally {
      window.alert = alert0; window.confirm = confirm0;
      busy = false;
    }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.source !== window.parent || !d || d.source !== 'sp-site-host' || d.type !== 'preview-skip') return;
    skip().then(function (r) {
      return r.moved ? pastShortPause().then(function () { return r; }) : r;
    }).then(function (r) {
      window.parent.postMessage(Object.assign({ source: 'sp-site', type: 'preview-skip-done', requestId: d.requestId }, r), '*');
    });
  });
})();
`;
