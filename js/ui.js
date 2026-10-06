// Shared UI helpers: escaping, formatting, toasts and the form dialog.

import { AuthError } from './auth.js';

let reconnect = null;
/** main.js registers how to re-authenticate, so dialogs can offer it inline. */
export const setReconnectHandler = fn => { reconnect = fn; };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

export function money(v) {
  return v === '' || v == null || isNaN(v) ? '—' : gbp.format(v);
}

export const splitList = v => String(v ?? '').split(/[,;]/).map(s => s.trim()).filter(Boolean);

export const byName = (a, b) => String(a.NAME).localeCompare(String(b.NAME), 'en-GB', { sensitivity: 'base' });

export const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Every whitespace-separated term in `q` must appear somewhere in `haystack`. */
export function matches(q, ...haystack) {
  const text = haystack.join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => text.includes(t));
}

export function option(value, label, selected) {
  return `<option value="${esc(value)}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`;
}

/**
 * Keep the toast stack in the top-most open dialog: a modal dialog sits in the browser's
 * top layer, so anything outside it (including fixed toasts) would be hidden behind it.
 */
export function parkToasts() {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    box.setAttribute('aria-live', 'polite');
  }
  const top = [...document.querySelectorAll('dialog[open]')].pop();
  const home = top || document.body;
  if (box.parentElement !== home) home.append(box);
  return box;
}

export function toast(message, type = 'ok', action = null) {
  const box = parkToasts();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-action';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { el.remove(); action.onClick(); });
    el.append(btn);
  }
  box.append(el);
  setTimeout(() => el.remove(), type === 'error' ? 8000 : 3500);
}

/** Show an error from a failed action; offers Reconnect when the Google session has expired. */
export function reportError(err) {
  console.error(err);
  if (err instanceof AuthError && reconnect) {
    toast(err.message, 'error', { label: 'Reconnect', onClick: () => reconnect() });
  } else {
    toast(err?.message || String(err), 'error');
  }
}

let uid = 0;

function fieldHtml(f, value) {
  const id = `f${++uid}`;
  const cls = `field${f.wide ? ' wide' : ''}${f.half ? ' half' : ''}`;
  const label = `${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}`;
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  const v = value ?? f.default ?? '';
  const name = esc(f.name);
  const req = f.required ? ' required' : '';

  switch (f.type) {
    case 'select':
      return `<label class="${cls}"><span>${label}</span><select name="${name}"${req}>${
        f.options.map(o => (Array.isArray(o) ? option(o[0], o[1], v) : option(o, o, v))).join('')
      }</select>${hint}</label>`;
    case 'textarea':
      return `<label class="${cls}"><span>${label}</span><textarea name="${name}" rows="${f.rows || 3}"${req}>${esc(v)}</textarea>${hint}</label>`;
    case 'checkbox':
      return `<label class="${cls} check"><input type="checkbox" name="${name}"${v === true ? ' checked' : ''}><span>${label}</span>${hint}</label>`;
    case 'chips': {
      // Match stored values case-insensitively; keep any unrecognised values so saving never drops them.
      const stored = splitList(v);
      const canon = s => f.options.find(o => o.toLowerCase() === s.toLowerCase()) || s;
      const selected = new Set(stored.map(canon));
      const all = [...f.options, ...[...selected].filter(s => !f.options.includes(s))];
      return `<fieldset class="${cls} chips"><legend>${label}</legend><div class="chip-row">${
        all.map(o => `<label class="chip"><input type="checkbox" name="${name}" value="${esc(o)}"${selected.has(o) ? ' checked' : ''}><span>${esc(o)}</span></label>`).join('')
      }</div>${hint}</fieldset>`;
    }
    default: {
      const attrs = ['min', 'max', 'step', 'placeholder', 'inputmode', 'autocomplete']
        .filter(a => f[a] != null).map(a => ` ${a}="${esc(f[a])}"`).join('');
      const list = f.suggestions ? ` list="${id}-dl"` : '';
      const dl = f.suggestions ? `<datalist id="${id}-dl">${f.suggestions.map(s => `<option value="${esc(s)}">`).join('')}</datalist>` : '';
      return `<label class="${cls}"><span>${label}</span><input type="${f.type || 'text'}" name="${name}" value="${esc(v)}"${attrs}${list}${req}>${dl}${hint}</label>`;
    }
  }
}

function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'chips') {
      out[f.name] = [...form.querySelectorAll(`input[name="${CSS.escape(f.name)}"]:checked`)].map(i => i.value).join(', ');
    } else if (f.type === 'checkbox') {
      out[f.name] = form.elements[f.name].checked;
    } else {
      const raw = form.elements[f.name].value.trim();
      out[f.name] = f.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
    }
  }
  return out;
}

/**
 * Modal form. `onSubmit(data)` may throw to show an error and keep the dialog open
 * (e.g. validation or an expired session, so nothing typed is lost).
 * `onChange(data, dialog)` runs on every edit, for live previews.
 */
export function formDialog({ title, fields, values = {}, submitLabel = 'Save', extraHtml = '', onSubmit, onChange, onOpen, onDelete, deleteLabel = 'Delete' }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <form class="modal-form">
      <header class="modal-head">
        <h2>${esc(title)}</h2>
        <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
      </header>
      <div class="modal-body">
        <div class="form-grid">${fields.map(f => fieldHtml(f, values[f.name])).join('')}</div>
        ${extraHtml}
      </div>
      <p class="form-error" role="alert" hidden></p>
      <footer class="modal-foot">
        ${onDelete ? `<button type="button" class="btn danger foot-left" data-delete>${esc(deleteLabel)}</button>` : ''}
        <button type="button" class="btn" data-close>Cancel</button>
        <button type="submit" class="btn primary">${esc(submitLabel)}</button>
      </footer>
    </form>`;
  document.body.append(dlg);

  const form = dlg.querySelector('form');
  const errEl = dlg.querySelector('.form-error');
  const submit = form.querySelector('[type=submit]');
  let busy = false;

  dlg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { if (!busy) dlg.close(); }));
  dlg.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
  dlg.addEventListener('close', () => { parkToasts(); dlg.remove(); });

  const changed = () => onChange?.(readForm(form, fields), dlg);
  form.addEventListener('input', changed);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errEl.hidden = true;
    busy = true;
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Saving…';
    try {
      await onSubmit(readForm(form, fields));
      busy = false;
      dlg.close();
    } catch (err) {
      console.error(err);
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
      // The page behind a modal is inert, so offer reconnect here, then retry the save.
      if (err instanceof AuthError && reconnect) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn primary sm';
        btn.textContent = 'Reconnect and save';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          if (await reconnect()) form.requestSubmit();
          else btn.disabled = false;
        });
        errEl.append(' ', btn);
      }
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = label;
    }
  });

  // onDelete runs like a submit: throw to show an error, return false to keep the dialog open.
  dlg.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    errEl.hidden = true;
    try {
      if ((await onDelete()) !== false) { busy = false; dlg.close(); }
    } catch (err) {
      console.error(err);
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
    } finally {
      busy = false;
    }
  });

  dlg.showModal();
  parkToasts();
  onOpen?.(dlg);
  changed();
  form.querySelector('input:not([type=checkbox]), select, textarea')?.focus();
  return dlg;
}
