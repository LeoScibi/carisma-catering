// Reusable supplier detail/edit modal for any page that shows a supplier name
// (Suppliers itself, Price Lists, ingredient/recipe cards, Menu Builder). Injects its
// own <dialog> into the page on first use and exposes a single entry point:
//   openSupplierModal(supplierId, { onChange: ({action, id}) => {...} })
// onChange fires after a successful save/delete/price-add so the host page can refresh
// whatever it's showing. Requires js/config.js, js/sheets.js, js/units.js and
// js/dialog-guard.js already loaded on the host page.
(function () {
  const SM_RANGE = 'Suppliers!A:D';
  const SM_HEADERS = ['ID', 'NAME', 'CONTACT', 'NOTES'];
  const SM_SI_RANGE = 'SupplierIngredients!A:G';
  const SM_SI_HEADERS = ['ID', 'INGREDIENT ID', 'SUPPLIER ID', 'PACK SIZE', 'PACK UNIT', 'PRICE', 'COST PER BASE UNIT'];
  const SM_ING_RANGE = 'Ingredients!A:K';

  let dialogEl = null;
  let dialogGuard = null;
  let token = null;
  let cachedRows = [SM_HEADERS];
  let ingredients = [];
  let siRows = [SM_SI_HEADERS];
  let current = null; // { idx, id, name }
  let onChangeCb = null;

  function setStatus(id, msg, kind) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status-line' + (kind ? ' ' + kind : '');
  }
  function ingredientById(id) { return ingredients.find(i => i.id === id) || null; }
  function ingredientNameOf(id) { const i = ingredientById(id); return i ? i.name : id; }

  function ensureDialog() {
    if (dialogEl) return dialogEl;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="smDialog">
        <div class="dialog-head">
          <h2 id="sm_title">Supplier details</h2>
          <button type="button" class="dialog-close" id="sm_close" aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <form id="sm_editForm">
            <div class="field-row">
              <div><label style="margin-top:0;">Name *</label><input id="sm_name" required></div>
              <div><label style="margin-top:0;">Contact</label><input id="sm_contact" placeholder="Phone, email, or account manager"></div>
            </div>
            <label>Notes</label>
            <textarea id="sm_notes"></textarea>
            <button type="submit" id="sm_saveBtn">Save changes</button>
            <button type="button" id="sm_deleteBtn" class="secondary danger">Delete supplier</button>
          </form>
          <div id="sm_editStatus" class="status-line"></div>

          <div class="dialog-section">
            <h3>Priced ingredients</h3>
            <table id="sm_pricesTable" style="display:none;">
              <thead><tr><th>Ingredient</th><th>Pack</th><th class="num">Price</th><th class="num">Cost / base unit</th></tr></thead>
              <tbody id="sm_pricesBody"></tbody>
            </table>
            <p class="sub" id="sm_noPrices" style="display:none;">No ingredients priced yet.</p>
            <form id="sm_addPriceForm">
              <label style="margin-top:0;">Ingredient *</label>
              <select id="sm_p_ingredient" required></select>
              <div class="field-row three">
                <div><label>Pack size *</label><input id="sm_p_packsize" type="number" step="0.01" min="0" required></div>
                <div><label>Pack unit *</label><select id="sm_p_packunit" required></select></div>
                <div><label>Price (£) *</label><input id="sm_p_price" type="number" step="0.01" min="0" required></div>
              </div>
              <div class="totals"><div class="line"><span>Cost per base unit</span><span id="sm_p_cost">—</span></div></div>
              <button type="submit" id="sm_p_addBtn">Add price</button>
            </form>
            <div id="sm_priceStatus" class="status-line"></div>
          </div>
        </div>
      </dialog>
    `);
    dialogEl = document.getElementById('smDialog');
    dialogGuard = attachDiscardGuard(dialogEl);
    wireEvents();
    return dialogEl;
  }

  function currentPriceIngredient() {
    const id = document.getElementById('sm_p_ingredient').value;
    return ingredientById(id);
  }

  async function loadIngredientsAndPrices(spreadsheetId) {
    const [ingRows, siRes] = await Promise.all([
      sheetsGet(spreadsheetId, SM_ING_RANGE, token),
      sheetsGet(spreadsheetId, SM_SI_RANGE, token)
    ]);
    ingredients = (ingRows.slice(1) || []).map(r => ({ id: r[0], name: r[1], measureType: r[3], baseUnit: r[4] })).filter(i => i.id);
    siRows = siRes.length ? siRes : [SM_SI_HEADERS];
    const sel = document.getElementById('sm_p_ingredient');
    sel.innerHTML = ingredients.length
      ? ingredients.map(i => `<option value="${i.id}">${i.name} (${i.measureType})</option>`).join('')
      : '<option value="">No ingredients yet — add one on the Ingredients page</option>';
  }

  function refreshPriceUnits() {
    const sel = document.getElementById('sm_p_packunit');
    const ing = currentPriceIngredient();
    sel.innerHTML = ing ? unitsForType(ing.measureType).map(u => `<option value="${u}">${unitLabel(ing.measureType, u)}</option>`).join('') : '';
    recalcPrice();
  }

  function recalcPrice() {
    const box = document.getElementById('sm_p_cost');
    const ing = currentPriceIngredient();
    const packSize = parseFloat(document.getElementById('sm_p_packsize').value);
    const packUnit = document.getElementById('sm_p_packunit').value;
    const price = parseFloat(document.getElementById('sm_p_price').value);
    if (!ing || !packSize || !packUnit || !price) { box.textContent = '—'; return null; }
    const baseAmount = toBaseAmount(ing.measureType, packSize, packUnit);
    if (!baseAmount) { box.textContent = '—'; return null; }
    const costPerBase = price / baseAmount;
    box.textContent = `${fmtMoney2(costPerBase)} per ${ing.baseUnit}`;
    return costPerBase;
  }

  function renderPrices(supplierId) {
    const table = document.getElementById('sm_pricesTable');
    const body = document.getElementById('sm_pricesBody');
    const none = document.getElementById('sm_noPrices');
    const mine = siRows.slice(1).filter(r => r[2] === supplierId);
    if (!mine.length) { table.style.display = 'none'; none.style.display = 'block'; body.innerHTML = ''; return; }
    body.innerHTML = mine.map(r => {
      const ing = ingredientById(r[1]);
      const base = ing ? ing.baseUnit : '';
      return `
      <tr>
        <td><a href="#" class="cell-main" data-role="open-ingredient" data-id="${r[1]}">${ingredientNameOf(r[1])}</a></td>
        <td>${r[3] ?? ''} ${r[4] ?? ''}</td>
        <td class="num"><span class="cell-main">${fmtMoney2(parseFloat(r[5]) || 0)}</span></td>
        <td class="num"><span class="cell-main">${fmtMoney2(parseFloat(r[6]) || 0)}</span>${base ? `<span class="cell-sub">per ${base}</span>` : ''}</td>
      </tr>`;
    }).join('');
    table.style.display = 'table';
    none.style.display = 'none';
  }

  function wireEvents() {
    document.getElementById('sm_close').addEventListener('click', () => dialogGuard.guardedClose());

    document.getElementById('sm_p_ingredient').addEventListener('change', refreshPriceUnits);
    ['sm_p_packsize', 'sm_p_packunit', 'sm_p_price'].forEach(id =>
      document.getElementById(id).addEventListener('input', recalcPrice)
    );

    document.getElementById('sm_pricesBody').addEventListener('click', (e) => {
      const a = e.target.closest('a[data-role="open-ingredient"]');
      if (a) { e.preventDefault(); openIngredientModal(a.dataset.id, { onChange: () => { if (current) renderPrices(current.id); } }); }
    });

    document.getElementById('sm_editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!current) return;
      const cfg = getStoredConfig();
      const name = document.getElementById('sm_name').value.trim();
      if (!name) { setStatus('sm_editStatus', 'Name is required.', 'error'); return; }

      const sheetRow = current.idx + 1;
      const row = [
        current.id, name,
        document.getElementById('sm_contact').value.trim(),
        document.getElementById('sm_notes').value.trim()
      ];
      setStatus('sm_editStatus', 'Saving...');
      try {
        await sheetsUpdateRange(cfg.spreadsheetId, `Suppliers!A${sheetRow}:D${sheetRow}`, [row], token, 'USER_ENTERED');
        current.name = name;
        document.getElementById('sm_title').textContent = `${current.id} · ${name}`;
        setStatus('sm_editStatus', 'Saved.', 'ok');
        dialogGuard.arm();
        onChangeCb && onChangeCb({ action: 'saved', id: current.id });
      } catch (err) {
        setStatus('sm_editStatus', 'Error saving: ' + err.message, 'error');
      }
    });

    document.getElementById('sm_deleteBtn').addEventListener('click', async () => {
      if (!current) return;
      const cfg = getStoredConfig();
      setStatus('sm_editStatus', 'Checking where this supplier is used...');
      try {
        const siFresh = await sheetsGet(cfg.spreadsheetId, SM_SI_RANGE, token);
        const siCount = siFresh.slice(1).filter(r => r[2] === current.id).length;
        if (siCount) {
          setStatus('sm_editStatus', `Can't delete — priced on ${siCount} ingredient(s). Remove those price links first, then try again.`, 'error');
          return;
        }
      } catch (err) {
        setStatus('sm_editStatus', 'Error checking usage: ' + err.message, 'error');
        return;
      }
      if (!confirm(`Delete "${current.name}"? This can't be undone.`)) { setStatus('sm_editStatus', ''); return; }
      setStatus('sm_editStatus', 'Deleting...');
      try {
        const tabs = await sheetsGetTabs(cfg.spreadsheetId, token);
        const sheetId = (tabs.find(t => t.title === 'Suppliers') || {}).sheetId;
        if (sheetId == null) throw new Error('Could not find the Suppliers tab.');
        await sheetsBatchUpdate(cfg.spreadsheetId, [{
          deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: current.idx, endIndex: current.idx + 1 } }
        }], token);
        const deletedId = current.id;
        dialogEl.close();
        current = null;
        onChangeCb && onChangeCb({ action: 'deleted', id: deletedId });
      } catch (err) {
        setStatus('sm_editStatus', 'Error deleting: ' + err.message, 'error');
      }
    });

    document.getElementById('sm_addPriceForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!current) return;
      const cfg = getStoredConfig();
      const ing = currentPriceIngredient();
      const packSize = parseFloat(document.getElementById('sm_p_packsize').value);
      const packUnit = document.getElementById('sm_p_packunit').value;
      const price = parseFloat(document.getElementById('sm_p_price').value);
      if (!ing || !packSize || !packUnit || !price) {
        setStatus('sm_priceStatus', 'All fields are required.', 'error'); return;
      }
      const costPerBase = recalcPrice();
      if (costPerBase === null) { setStatus('sm_priceStatus', 'Could not calculate cost — check the values.', 'error'); return; }
      setStatus('sm_priceStatus', 'Adding price...');
      try {
        const existing = await sheetsGet(cfg.spreadsheetId, SM_SI_RANGE, token);
        const rows = existing.length ? existing : [SM_SI_HEADERS];
        const id = nextId(rows, 'SI');
        const row = [id, ing.id, current.id, packSize, packUnit, price.toFixed(2), costPerBase.toFixed(4)];
        await sheetsAppend(cfg.spreadsheetId, SM_SI_RANGE, row, token);
        siRows = [...rows, row];
        document.getElementById('sm_addPriceForm').reset();
        document.getElementById('sm_p_cost').textContent = '—';
        refreshPriceUnits();
        renderPrices(current.id);
        setStatus('sm_priceStatus', `Added ${ingredientNameOf(ing.id)}.`, 'ok');
        onChangeCb && onChangeCb({ action: 'linked', id: current.id });
      } catch (err) {
        setStatus('sm_priceStatus', 'Error: ' + err.message, 'error');
      }
    });
  }

  // Public entry point.
  window.openSupplierModal = async function (supplierId, opts) {
    const cfg = getStoredConfig();
    token = tryResumeSession();
    if (!token || !cfg.spreadsheetId) { alert('Please sign in on the Dashboard first.'); return; }
    onChangeCb = (opts && opts.onChange) || null;

    ensureDialog();
    setStatus('sm_editStatus', 'Loading...');
    setStatus('sm_priceStatus', '');
    dialogEl.showModal();

    try {
      const rows = await sheetsGet(cfg.spreadsheetId, SM_RANGE, token);
      cachedRows = rows.length ? rows : [SM_HEADERS];
      const idx = cachedRows.findIndex((r, i) => i > 0 && r[0] === supplierId);
      if (idx === -1) { setStatus('sm_editStatus', 'Could not find that supplier — it may have been deleted.', 'error'); return; }
      const r = cachedRows[idx];
      current = { idx, id: r[0], name: r[1] || r[0] };

      document.getElementById('sm_title').textContent = `${r[0]} · ${r[1] || 'Supplier'}`;
      document.getElementById('sm_name').value = r[1] || '';
      document.getElementById('sm_contact').value = r[2] || '';
      document.getElementById('sm_notes').value = r[3] || '';
      setStatus('sm_editStatus', '');
      document.getElementById('sm_addPriceForm').reset();
      dialogGuard.arm();

      setStatus('sm_priceStatus', 'Loading ingredients...');
      await loadIngredientsAndPrices(cfg.spreadsheetId);
      refreshPriceUnits();
      renderPrices(r[0]);
      setStatus('sm_priceStatus', '');
    } catch (err) {
      setStatus('sm_editStatus', 'Error loading: ' + err.message, 'error');
    }
  };
})();
