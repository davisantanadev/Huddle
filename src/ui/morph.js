// Updates a live DOM tree to match freshly rendered HTML, touching only what
// changed. The app renders whole screens as HTML strings; replacing them with
// innerHTML on every update recreated every element, which restarted GIFs and
// half-loaded images, threw away what was being typed and moved the cursor.
// Here unchanged nodes stay in place, so images keep animating, scroll
// positions hold and the focused text box keeps its text and caret.
//
// Children are matched by key (data-key, data-message-id, or id) when they have
// one, otherwise by position and tag. An element with data-keep-children keeps
// whatever is inside it (e.g. a slot a <video> was moved into).

function keyOf(node) {
  if (node.nodeType !== 1) return null;
  return node.getAttribute("data-key") || node.getAttribute("data-message-id") || node.id || null;
}

function syncAttributes(from, to) {
  // Hover-animated videos get their src set on hover: leave it alone
  const keepSrc = from.hasAttribute("data-morph-keep-src");
  for (const { name } of [...from.attributes]) {
    if (keepSrc && name === "src") continue;
    if (!to.hasAttribute(name)) from.removeAttribute(name);
  }
  for (const { name, value } of [...to.attributes]) {
    if (from.getAttribute(name) !== value) from.setAttribute(name, value);
  }
}

// Form controls show properties, not attributes: keep them in step with the
// new HTML, except for the control the user is typing in right now
function syncFormState(from, to) {
  const tag = from.tagName;
  if (from === document.activeElement && (tag === "INPUT" || tag === "TEXTAREA")) return;
  if (tag === "INPUT") {
    const type = (from.getAttribute("type") || "text").toLowerCase();
    if (type === "file") return;
    if (type === "checkbox" || type === "radio") {
      const checked = to.hasAttribute("checked");
      if (from.checked !== checked) from.checked = checked;
      return;
    }
    const value = to.getAttribute("value") ?? "";
    if (to.hasAttribute("value") && from.value !== value) from.value = value;
  } else if (tag === "TEXTAREA") {
    const value = to.value;
    if (from.value !== value) from.value = value;
  }
}

function syncSelect(from) {
  const chosen = [...from.options].find((o) => o.hasAttribute("selected"));
  if (chosen && !chosen.selected) chosen.selected = true;
}

function sameKind(a, b) {
  return a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName);
}

function morphNode(from, to) {
  if (from.nodeType !== 1) {
    if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
    return;
  }
  syncAttributes(from, to);
  if (from.hasAttribute("data-keep-children") || from.hasAttribute("data-share-video-slot")) return;
  if (from.tagName === "TEXTAREA") {
    syncFormState(from, to);
    return;
  }
  morphChildren(from, to);
  if (from.tagName === "INPUT") syncFormState(from, to);
  else if (from.tagName === "SELECT") syncSelect(from);
}

function morphChildren(fromParent, toParent) {
  const keyed = new Map();
  for (const child of fromParent.childNodes) {
    const key = keyOf(child);
    if (key) keyed.set(key, child);
  }

  let cursor = fromParent.firstChild;
  for (const next of [...toParent.childNodes]) {
    const key = keyOf(next);
    let match = null;
    if (key) {
      const candidate = keyed.get(key);
      if (candidate && sameKind(candidate, next)) {
        match = candidate;
        keyed.delete(key);
      }
    } else if (cursor && !keyOf(cursor) && sameKind(cursor, next)) {
      match = cursor;
    }

    if (match) {
      if (match !== cursor) fromParent.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      morphNode(match, next);
    } else {
      fromParent.insertBefore(next, cursor);
    }
  }

  // Whatever was not reused is gone from the new HTML
  while (cursor) {
    const nextCursor = cursor.nextSibling;
    cursor.remove();
    cursor = nextCursor;
  }
}

const parser = document.createElement("template");

export function morphInnerHTML(root, html) {
  parser.innerHTML = html;
  const fragment = parser.content;
  morphChildren(root, fragment);
  parser.innerHTML = "";
}

// Every render binds its handlers again (bindFormEvents). With elements now
// surviving between renders, the same handler would pile up on them, so while
// binding, a handler whose code matches one bound earlier on the same element
// replaces it instead (the new closure sees the current state).
const boundHandlers = new WeakMap();

export function bindReplacingDuplicates(bind) {
  const proto = EventTarget.prototype;
  const original = proto.addEventListener;
  proto.addEventListener = function (type, listener, options) {
    if (typeof listener === "function") {
      let byKey = boundHandlers.get(this);
      if (!byKey) boundHandlers.set(this, (byKey = new Map()));
      const key = `${type}|${listener.toString()}`;
      const previous = byKey.get(key);
      if (previous) proto.removeEventListener.call(this, type, previous.listener, previous.options);
      byKey.set(key, { listener, options });
    }
    return original.call(this, type, listener, options);
  };
  try {
    bind();
  } finally {
    proto.addEventListener = original;
  }
}
