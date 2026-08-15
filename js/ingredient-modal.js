// Reusable ingredient detail/edit modal for pages that show ingredient names but
// aren't the Ingredients page itself (Recipes, Price Lists, Menu Builder). Injects
// its own <dialog> into the page on first use and exposes a single entry point:
//   openIngredientModal(ingredientId, { onChange: ({action, id}) => {...} })
// onChange fires after a successful save or delete so the host page can refresh
// whatever it's showing (ingredient names, costs, etc).
(function () {
  const IM_RANGE = 'Ingredients!A:K';
  const IM_HEADERS = ['ID', 'NAME', 'CATEGORY', 'MEASURE TYPE', 'BASE UNIT', 'DESCRIPTION', 'STORAGE', 'SHELF LIFE', 'VEGAN', 'VEGETARIAN', 'GLUTEN FREE'];
  const IM_SI_RANGE = 'SupplierIngredients!A:G';
  const IM_SI_HEADERS = ['ID', 'INGREDIENT ID', 'SUPPLIER ID', 'PACK SIZE', 'PACK UNIT', 'PRICE', 'COST PER BASE UNIT'];
  const IM_SUP_RANGE = 'Suppliers!A:D';

  let dialogEl = null;
  let token = null;
  let cachedRows = [IM_HEADERS];
  let suppliers = [];
  let siRows = [IM_SI_HEADERS];
  let current = null; // { idx, id, name }
  let onChangeCb = null;

  function flagChecked(v) { return ['yes', 'checked', 'true', 'x', '1', 'y'].includes((v || '').toString().trim().toLowerCase()); }
  function flagValue(b) { return b ? 'Yes' : ''; }
  function setStatus(id, msg, kind) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status-line' + (kind ? ' ' + kind : '');
  }
  function supplierNameOf(id) { const s = suppliers.find(x => x.id === id); return s ? s.name : id; }

  function ensureDialog() {
    if (dialogEl) return dialogEl;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="imDialog">
        <div class="dialog-head">
          <h2 id="im_title">Ingredient details</h2>
          <button type="button" class="dialog-close" id="im_close" aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <form id="im_editForm">
            <div class="field-row">
              <div><label style="margin-top:0;">Name *</label><input id="im_name" required></div>
              <div>
                <label style="margin-top:0;">Category</label>
                <input id="im_category" list="im_categoryOptions" placeholder="Choose or type a new one" autocomplete="off">
                <datalist id="im_categoryOptions"></datalist>
              </div>
            </div>
            <div class="field-row">
              <div>
                <label>Measure type *</label>
                <select id="im_measuretype" required>
                  <option value="Weight">Weight</option>
                  <option value="Volume">Volume</option>
                  <option value="Unit">Unit</option>
                </select>
              </div>
              <div><label>Base unit</label><input id="im_baseunit" disabled placeholder="Set automatically"></div>
            </div>
            <div class="field-row">
              <div><label>Storage</label><input id="im_storage" placeholder="e.g. Chilled, Ambient, Frozen"></div>
              <div><label>Shelf life</label><input id="im_shelflife"></div>
            </div>
            <label>Dietary</label>
            <div class="checks">
              <label><input type="checkbox" id="im_vegan"> Vegan</label>
              <label><input type="checkbox" id="im_vegetarian"> Vegetarian</label>
              <label><input type="checkbox" id="im_glutenfree"> Gluten-free</label>
            </div>
            <button type="submit" id="im_saveBtn">Save changes</button>
            <button type="button" id="im_deleteBtn" class="secondary danger">Delete ingredient</button>
          </form>
          <div id="im_editStatus" class="status-line"></div>

          <div class="dialog-section">
            <h3>Linked suppliers</h3>
            <table id="im_linksTable" style="display:none;">
              <thead><tr><th>Supplier</th><th>Pack</th><th>Price</th><th>Cost / base unit</th></tr></thead>
              <tbody id="im_linksBody"></tbody>
            </table>
            <p class="sub" id="im_noLinks" style="display:none;">No suppliers linked yet.</p>
            <form id="im_linkForm">
              <div class="field-row">
                <div><label style="margin-top:0;">Supplier *</label><select id="im_l_supplier" required></select></div>
                <div></div>
              </div>
              <div class="field-row three">
                <div><label>Pack size *</label><input id="im_l_packsize" type="number" step="0.01" min="0" required></div>
                <div><label>Pack unit *</label><select id="im_l_packunit" required></select></div>
                <div><label>Price (£) *</label><input id="im_l_price" type="number" step="0.01" min="0" required></div>
              </div>
              <div class="totals"><div class="line"><span>Cost per base unit</span><span id="im_l_cost">—</span></div></div>
              <button type="submit" id="im_linkBtn">Link supplier</button>
            </form>
            <div id="im_linkStatus" class="status-line"></div>
          </div>
        </div>
      </dialog>
    `);
    dialogEl = document.getElementById('imDialog');
    wireEvents();
    return dialogEl;
  }

  function editMeasureType() { return document.getElementById('im_measuretype').value; }

  function populateCategories() {
    const seen = new Set();
    for (let i = 1; i < cachedRows.length; i++) {
      const cat = (cachedRows[i][2] || '').toString().trim();
      if (cat) seen.add(cat);
    }
    const options = [...seen].sort((a, b) => a.localeCompare(b));
    document.getElementById('im_categoryOptions').innerHTML =
      options.map(c => `<option value="${c.replace(/"/g, '&quot;')}"></option>`).join('');
  }

  async function loadSuppliersAndLinks(spreadsheetId) {
    const [supRows, links] = await Promise.all([
      sheetsGet(spreadsheetId, IM_SUP_RANGE, token),
      sheetsGet(spreadsheetId, IM_SI_RANGE, token)
    ]);
    suppliers = (supRows.slice(1) || []).map(r => ({ id: r[0], name: r[1] })).filter(s => s.id);
    siRows = links.length ? links : [IM_SI_HEADERS];
    const sel = document.getElementById('im_l_supplier');
    sel.innerHTML = suppliers.length
      ? suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')
      : '<option value="">No suppliers yet — add one on the Suppliers page</option>';
  }

  function refreshLinkPackUnits() {
    const sel = document.getElementById('im_l_packunit');
    const mt = editMeasureType();
    sel.innerHTML = unitsForType(mt).map(u => `<option value="${u}">${unitLabel(mt, u)}</option>`).join('');
    recalcLink();
  }

  function recalcLink() {
    const box = document.getElementById('im_l_cost');
    const packSize = parseFloat(document.getElementById('im_l_packsize').value);
    const packUnit = document.getElementById('im_l_packunit').value;
    const price = parseFloat(document.getElementById('im_l_price').value);
    const mt = editMeasureType();
    if (!mt || !packSize || !packUnit || !price) { box.textContent = '—'; return null; }
    const baseAmount = toBaseAmount(mt, packSize, packUnit);
    if (!baseAmount) { box.textContent = '—'; return null; }
    const costPerBase = price / baseAmount;
    box.textContent = `${fmtMoney2(costPerBase)} per ${baseUnitFor(mt)}`;
    return costPerBase;
  }

  function renderLinks(ingId) {
    const table = document.getElementById('im_linksTable');
    const body = document.getElementById('im_linksBody');
    const none = document.getElementById('im_noLinks');
    const mine = siRows.slice(1).filter(r => r[1] === ingId);
    if (!mine.length) { table.style.display = 'none'; none.style.display = 'block'; body.innerHTML = ''; return; }
    const base = baseUnitFor(editMeasureType());
    body.innerHTML = mine.map(r => `
      <tr>
        <td>${supplierNameOf(r[2])}</td>
        <td>${r[3] ?? ''} ${r[4] ?? ''}</td>
        <td>${fmtMoney2(parseFloat(r[5]) || 0)}</td>
        <td>${fmtMoney2(parseFloat(r[6]) || 0)} / ${base}</td>
      </tr>
    `).join('');
    table.style.display = 'table';
    none.style.display = 'none';
  }

  function wireEvents() {
    document.getElementById('im_close').addEventListener('click', () => dialogEl.close());

    document.getElementById('im_measuretype').addEventListener('change', () => {
      document.getElementById('im_baseunit').value = baseUnitFor(editMeasureType());
      refreshLinkPackUnits();
      if (current) renderLinks(current.id);
    });
    ['im_l_packsize', 'im_l_packunit', 'im_l_price'].forEach(id =>
      document.getElementById(id).addEventListener('input', recalcLink)
    );

    document.getElementById('im_editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!current) return;
      const cfg = getStoredConfig();
      const name = document.getElementById('im_name').value.trim();
      const measureType = editMeasureType();
      if (!name) { setStatus('im_editStatus', 'Name is required.', 'error'); return; }
      if (!measureType) { setStatus('im_editStatus', 'Measure type is required.', 'error'); return; }

      const sheetRow = current.idx + 1;
      const original = cachedRows[current.idx] || [];
      const row = [
        current.id, name,
        document.getElementById('im_category').value.trim(),
        measureType, baseUnitFor(measureType),
        original[5] || '', // preserve DESCRIPTION
        document.getElementById('im_storage').value.trim(),
        document.getElementById('im_shelflife').value.trim(),
        flagValue(document.getElementById('im_vegan').checked),
        flagValue(document.getElementById('im_vegetarian').checked),
        flagValue(document.getElementById('im_glutenfree').checked)
      ];
      setStatus('im_editStatus', 'Saving...');
      try {
        await sheetsUpdateRange(cfg.spreadsheetId, `Ingredients!A${sheetRow}:K${sheetRow}`, [row], token, 'USER_ENTERED');
        current.name = name;
        document.getElementById('im_title').textContent = `${current.id} · ${name}`;
        setStatus('im_editStatus', 'Saved.', 'ok');
        onChangeCb && onChangeCb({ action: 'saved', id: current.id });
      } catch (err) {
        setStatus('im_editStatus', 'Error saving: ' + err.message, 'error');
      }
    });

    document.getElementById('im_deleteBtn').addEventListener('click', async () => {
      if (!current) return;
      const cfg = getStoredConfig();
      setStatus('im_editStatus', 'Checking where this ingredient is used...');
      try {
        const [siFresh, rlFresh] = await Promise.all([
          sheetsGet(cfg.spreadsheetId, IM_SI_RANGE, token),
          sheetsGet(cfg.spreadsheetId, 'RecipeLines!A:H', token)
        ]);
        const siCount = siFresh.slice(1).filter(r => r[1] === current.id).length;
        const rlCount = rlFresh.slice(1).filter(r => r[2] === 'Ingredient' && r[3] === current.id).length;
        if (siCount || rlCount) {
          const parts = [];
          if (rlCount) parts.push(`${rlCount} recipe line(s)`);
          if (siCount) parts.push(`${siCount} supplier price(s)`);
          setStatus('im_editStatus', `Can't delete — used in ${parts.join(' and ')}. Remove those first, then try again.`, 'error');
          return;
        }
      } catch (err) {
        setStatus('im_editStatus', 'Error checking usage: ' + err.message, 'error');
        return;
      }
      if (!confirm(`Delete "${current.name}"? This can't be undone.`)) { setStatus('im_editStatus', ''); return; }
      setStatus('im_editStatus', 'Deleting...');
      try {
        const tabs = await sheetsGetTabs(cfg.spreadsheetId, token);
        const sheetId = (tabs.find(t => t.title === 'Ingredients') || {}).sheetId;
        if (sheetId == null) throw new Error('Could not find the Ingredients tab.');
        await sheetsBatchUpdate(cfg.spreadsheetId, [{
          deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: current.idx, endIndex: current.idx + 1 } }
        }], token);
        const deletedId = current.id;
        dialogEl.close();
        current = null;
        onChangeCb && onChangeCb({ action: 'deleted', id: deletedId });
      } catch (err) {
        setStatus('im_editStatus', 'Error deleting: ' + err.message, 'error');
      }
    });

    document.getElementById('im_linkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!current) return;
      const cfg = getStoredConfig();
      const supplierId = document.getElementById('im_l_supplier').value;
      const packSize = parseFloat(document.getElementById('im_l_packsize').value);
      const packUnit = document.getElementById('im_l_packunit').value;
      const price = parseFloat(document.getElementById('im_l_price').value);
      if (!supplierId || !packSize || !packUnit || !price) {
        setStatus('im_linkStatus', 'All supplier fields are required.', 'error'); return;
      }
      const costPerBase = recalcLink();
      if (costPerBase === null) { setStatus('im_linkStatus', 'Could not calculate cost — check the values.', 'error'); return; }
      setStatus('im_linkStatus', 'Linking supplier...');
      try {
        const existing = await sheetsGet(cfg.spreadsheetId, IM_SI_RANGE, token);
        const rows = existing.length ? existing : [IM_SI_HEADERS];
        const id = nextId(rows, 'SI');
        const row = [id, current.id, supplierId, packSize, packUnit, price.toFixed(2), costPerBase.toFixed(4)];
        await sheetsAppend(cfg.spreadsheetId, IM_SI_RANGE, row, token);
        siRows = [...rows, row];
        document.getElementById('im_linkForm').reset();
        document.getElementById('im_l_cost').textContent = '—';
        refreshLinkPackUnits();
        renderLinks(current.id);
        setStatus('im_linkStatus', `Linked to ${supplierNameOf(supplierId)}.`, 'ok');
        onChangeCb && onChangeCb({ action: 'linked', id: current.id });
      } catch (err) {
        setStatus('im_linkStatus', 'Error: ' + err.message, 'error');
      }
    });
  }

  // Public entry point.
  window.openIngredientModal = async function (ingredientId, opts) {
    const cfg = getStoredConfig();
    token = tryResumeSession();
    if (!token || !cfg.spreadsheetId) { alert('Please sign in on the Dashboard first.'); return; }
    onChangeCb = (opts && opts.onChange) || null;

    ensureDialog();
    setStatus('im_editStatus', 'Loading...');
    setStatus('im_linkStatus', '');
    dialogEl.showModal();

    try {
      const rows = await sheetsGet(cfg.spreadsheetId, IM_RANGE, token);
      cachedRows = rows.length ? rows : [IM_HEADERS];
      const idx = cachedRows.findIndex((r, i) => i > 0 && r[0] === ingredientId);
      if (idx === -1) { setStatus('im_editStatus', 'Could not find that ingredient — it may have been deleted.', 'error'); return; }
      const r = cachedRows[idx];
      current = { idx, id: r[0], name: r[1] || r[0] };

      document.getElementById('im_title').textContent = `${r[0]} · ${r[1] || 'Ingredient'}`;
      populateCategories();
      document.getElementById('im_name').value = r[1] || '';
      document.getElementById('im_category').value = r[2] || '';
      document.getElementById('im_measuretype').value = r[3] || 'Weight';
      document.getElementById('im_baseunit').value = baseUnitFor(editMeasureType());
      document.getElementById('im_storage').value = r[6] || '';
      document.getElementById('im_shelflife').value = r[7] || '';
      document.getElementById('im_vegan').checked = flagChecked(r[8]);
      document.getElementById('im_vegetarian').checked = flagChecked(r[9]);
      document.getElementById('im_glutenfree').checked = flagChecked(r[10]);
      setStatus('im_editStatus', '');
      document.getElementById('im_linkForm').reset();
      refreshLinkPackUnits();
      renderLinks(r[0]);

      setStatus('im_linkStatus', 'Loading suppliers...');
      await loadSuppliersAndLinks(cfg.spreadsheetId);
      refreshLinkPackUnits();
      renderLinks(r[0]);
      setStatus('im_linkStatus', '');
    } catch (err) {
      setStatus('im_editStatus', 'Error loading: ' + err.message, 'error');
    }
  };
})();
