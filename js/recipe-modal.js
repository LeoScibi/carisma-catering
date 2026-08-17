// Reusable recipe detail/edit modal for any page that shows a recipe or sub-recipe by
// name (Recipes itself, Menu Builder, and anywhere else that references one). Injects
// its own <dialog> into the page on first use and exposes a single entry point:
//   openRecipeModal(recipeId, { onChange: ({action, id}) => {...} })
// onChange fires after a successful save/delete so the host page can refresh whatever
// it's showing (recipe names, costs, totals, etc). Requires js/config.js, js/sheets.js,
// js/units.js, js/dialog-guard.js and js/ingredient-modal.js already loaded on the host
// page (ingredient names inside a recipe's lines open the shared ingredient modal).
(function () {
  const ING_RANGE = 'Ingredients!A:K';
  const ING_HEADERS = ['ID', 'NAME', 'CATEGORY', 'MEASURE TYPE', 'BASE UNIT', 'DESCRIPTION', 'STORAGE', 'SHELF LIFE', 'VEGAN', 'VEGETARIAN', 'GLUTEN FREE'];
  const SUP_RANGE = 'Suppliers!A:D';
  const SI_RANGE = 'SupplierIngredients!A:G';
  const SI_HEADERS = ['ID', 'INGREDIENT ID', 'SUPPLIER ID', 'PACK SIZE', 'PACK UNIT', 'PRICE', 'COST PER BASE UNIT'];
  const REC_RANGE = 'Recipes!A:H';
  const RL_RANGE = 'RecipeLines!A:I';
  const RL_HEADERS = ['ID', 'RECIPE ID', 'COMPONENT TYPE', 'COMPONENT ID', 'QUANTITY', 'UNIT', 'SELECTED SUPPLIER ID', 'LINE COST', 'SORT ORDER'];

  let token = null;
  let dialogEl = null, pasteDialogEl = null, linkDialogEl = null;
  let pasteDialogGuard = null, linkDialogGuard = null;
  let onChangeCb = null;

  let ingredients = [];
  let suppliers = [];
  let supplierIngredients = [];
  let recipesAll = [];
  let currentRecipe = null;
  let currentLines = [];
  let editingSupplierLineId = null;
  let editingQtyLineId = null;
  let editingComponentLineId = null;
  let swapQuery = '';
  let draggingLineId = null;
  let editingName = false;
  let newLine = { query: '', pick: null, qty: '', unit: '', supplierId: '' };
  let parsedRows = [];
  let currentScaleFactor = 1;
  let linkIdx = -1;

  function setStatus(id, msg, kind) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'status-line' + (kind ? ' ' + kind : '');
  }
  function fmtQty(n) { return isFinite(n) ? +n.toFixed(2) : 0; }
  function escapeAttr(s) { return (s || '').toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  function supplierName(id) { const s = suppliers.find(x => x.id === id); return s ? s.name : id; }
  function ingredientById(id) { return ingredients.find(i => i.id === id) || null; }
  function cheapestSupplierFor(ingredientId) {
    const opts = supplierIngredients.filter(s => s.ingredientId === ingredientId);
    if (!opts.length) return null;
    return opts.reduce((a, b) => (b.costPerBase < a.costPerBase ? b : a));
  }
  function supplierCostPerBase(siId) { const s = supplierIngredients.find(x => x.id === siId); return s ? s.costPerBase : null; }

  // ---------- Dialog injection ----------
  function ensureDialogs() {
    if (dialogEl) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="rmDialog">
        <div class="dialog-head">
          <div id="rm_titleWrap"></div>
          <button type="button" class="dialog-close" id="rm_close" aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body recipe-detail">
          <div class="recipe-detail-main">
            <div class="pill-row">
              <span class="badge muted" id="rm_type"></span>
              <span class="badge muted" id="rm_yield"></span>
            </div>
            <div class="totals">
              <div class="line grand"><span>Total cost</span><span id="rm_totalcost">£0.00</span></div>
              <div class="line" id="rm_costperbaseLine"><span>Cost per base unit</span><span id="rm_costperbase">£0.00</span></div>
            </div>

            <div class="dialog-section" id="rm_scaleSection">
              <h3 style="margin-top:0;">Scale this recipe</h3>
              <div class="field-row">
                <div>
                  <label style="margin-top:0;">Scale to yield</label>
                  <input id="rm_sc_target" type="number" step="0.01" min="0">
                </div>
                <div>
                  <label style="margin-top:0;">Unit</label>
                  <input id="rm_sc_unit" disabled>
                </div>
              </div>
              <p class="hint" id="rm_sc_factor"></p>
            </div>

            <div class="dialog-section">
              <h3 style="margin-top:0;">Recipe lines</h3>
              <div id="rm_refreshCostsStatus" class="status-line"></div>
              <table id="rm_linesTable">
                <thead><tr><th></th><th>Component</th><th>Quantity</th><th>Supplier</th><th class="num">Line cost</th><th></th></tr></thead>
                <tbody id="rm_linesBody"></tbody>
              </table>
              <div id="rm_ln_status" class="status-line"></div>
            </div>
          </div>

          <div class="recipe-detail-actions">
            <button type="button" id="rm_refreshCostsBtn" class="secondary">Refresh costs</button>
            <button type="button" id="rm_openPasteBtn" class="secondary">Paste recipe text</button>
            <button type="button" id="rm_deleteRecipeBtn" class="secondary danger">Delete recipe</button>
          </div>
        </div>
      </dialog>

      <dialog id="rmPasteDialog">
        <div class="dialog-head">
          <h2>Paste a recipe</h2>
          <button type="button" class="dialog-close" id="rmp_close" aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <p class="sub">Paste an ingredient list — one item per line. We match each to your ingredients, let you create the missing ones, set quantities (cooking units auto-convert to metric), and pick a supplier price. Review, then add them all.</p>
          <textarea id="rmp_text" style="min-height:120px; font-family:ui-monospace, Menlo, monospace; font-size:12px;" placeholder="200g plain flour&#10;2 cloves garlic&#10;1 tbsp olive oil&#10;3 eggs"></textarea>
          <button type="button" id="rmp_parseBtn">Parse</button>
          <div id="rmp_summary" class="sub" style="margin-top:10px;"></div>
          <datalist id="rmp_ingredientNames"></datalist>
          <div style="overflow-x:auto;">
            <table id="rmp_reviewTable" style="display:none;">
              <thead><tr>
                <th>Use</th><th>Pasted</th><th>Ingredient</th><th>Measure</th>
                <th>Qty</th><th>Unit</th><th>Supplier / price</th><th>Line cost</th>
              </tr></thead>
              <tbody id="rmp_reviewBody"></tbody>
            </table>
          </div>
          <button type="button" id="rmp_addParsedBtn" style="display:none;">Add lines to recipe</button>
          <div id="rmp_status" class="status-line"></div>
        </div>
      </dialog>

      <dialog id="rmLinkDialog">
        <div class="dialog-head">
          <h2 id="rml_title">Link supplier</h2>
          <button type="button" class="dialog-close" id="rml_close" aria-label="Close">&times;</button>
        </div>
        <div class="dialog-body">
          <form id="rml_form">
            <label style="margin-top:0;">Supplier *</label>
            <select id="rml_supplier" required></select>
            <div class="field-row three">
              <div><label>Pack size *</label><input id="rml_packsize" type="number" step="0.01" min="0" required></div>
              <div><label>Pack unit *</label><select id="rml_packunit" required></select></div>
              <div><label>Price (£) *</label><input id="rml_price" type="number" step="0.01" min="0" required></div>
            </div>
            <div class="totals"><div class="line"><span>Cost per base unit</span><span id="rml_cost">—</span></div></div>
            <button type="submit" id="rml_addBtn">Save price</button>
            <button type="button" id="rml_cancelBtn" class="secondary">Cancel</button>
          </form>
          <div id="rml_status" class="status-line"></div>
        </div>
      </dialog>
    `);
    dialogEl = document.getElementById('rmDialog');
    pasteDialogEl = document.getElementById('rmPasteDialog');
    linkDialogEl = document.getElementById('rmLinkDialog');
    pasteDialogGuard = attachDiscardGuard(pasteDialogEl, {
      isDirtyOverride: () => document.getElementById('rmp_text').value.trim() !== '' || parsedRows.length > 0
    });
    linkDialogGuard = attachDiscardGuard(linkDialogEl);
    wireEvents();
  }

  // ---------- Lookups ----------
  async function loadAllLookups(spreadsheetId) {
    const [ingRows, supRows, siRows, recRows] = await Promise.all([
      sheetsGet(spreadsheetId, ING_RANGE, token),
      sheetsGet(spreadsheetId, SUP_RANGE, token),
      sheetsGet(spreadsheetId, SI_RANGE, token),
      sheetsGet(spreadsheetId, REC_RANGE, token)
    ]);
    ingredients = (ingRows.slice(1) || []).map(r => ({ id: r[0], name: r[1], measureType: r[3], baseUnit: r[4] })).filter(i => i.id);
    suppliers = (supRows.slice(1) || []).map(r => ({ id: r[0], name: r[1] })).filter(s => s.id);
    supplierIngredients = (siRows.slice(1) || []).map(r => ({
      id: r[0], ingredientId: r[1], supplierId: r[2],
      packSize: parseFloat(r[3]) || 0, packUnit: r[4],
      price: parseFloat(r[5]) || 0, costPerBase: parseFloat(r[6]) || 0
    })).filter(s => s.id);
    recipesAll = (recRows.slice(1) || []).map(r => ({
      id: r[0], name: r[1], type: r[2], yieldMeasureType: r[3],
      yieldAmount: parseFloat(r[4]) || 0, yieldUnit: r[5],
      totalCost: parseFloat(r[6]) || 0, costPerBase: parseFloat(r[7]) || 0
    })).filter(r => r.id);
  }
  async function loadRecipesOnly(spreadsheetId) {
    const rows = await sheetsGet(spreadsheetId, REC_RANGE, token);
    recipesAll = (rows.slice(1) || []).map(r => ({
      id: r[0], name: r[1], type: r[2], yieldMeasureType: r[3],
      yieldAmount: parseFloat(r[4]) || 0, yieldUnit: r[5],
      totalCost: parseFloat(r[6]) || 0, costPerBase: parseFloat(r[7]) || 0
    })).filter(r => r.id);
  }

  // ---------- Recipe detail ----------
  // A Menu's yield is a fixed 1pc placeholder (it's a container of dishes, not
  // something with a real portion size) — the yield badge, cost-per-base line
  // and scale section are all meaningless for it, so they're hidden.
  function renderTitle() {
    const wrap = document.getElementById('rm_titleWrap');
    if (editingName) {
      wrap.innerHTML = `
        <span style="display:flex; align-items:center; gap:6px;">
          <input type="text" id="rm_name_input" value="${escapeAttr(currentRecipe.name)}" style="font-family:var(--serif); font-size:19px; padding:4px 8px; margin:0; width:auto; min-width:220px;">
          <button type="button" id="rm_name_save" title="Save" style="margin:0; padding:6px 11px; height:auto;">&#10003;</button>
          <button type="button" class="secondary" id="rm_name_cancel" title="Cancel" style="margin:0; padding:6px 11px; height:auto;">&times;</button>
        </span>`;
      const input = document.getElementById('rm_name_input');
      input.focus();
      input.select();
    } else {
      wrap.innerHTML = `<h2 id="rm_title" style="cursor:pointer;" title="Click to rename">${currentRecipe.name}</h2>`;
    }
  }

  async function commitRename() {
    const input = document.getElementById('rm_name_input');
    if (!input || !currentRecipe) return;
    const newName = input.value.trim();
    if (!newName) { setStatus('rm_ln_status', 'Name cannot be empty.', 'error'); return; }
    if (newName === currentRecipe.name) { editingName = false; renderTitle(); return; }
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Renaming...');
    try {
      const recRows = await sheetsGet(cfg.spreadsheetId, REC_RANGE, token);
      const rowIndex = recRows.findIndex((r, i) => i > 0 && r[0] === currentRecipe.id);
      if (rowIndex === -1) throw new Error('Could not find this recipe\'s row to update.');
      await sheetsUpdateRange(cfg.spreadsheetId, `Recipes!B${rowIndex + 1}:B${rowIndex + 1}`, [[newName]], token, 'USER_ENTERED');
      editingName = false;
      await refreshCurrentRecipe();
      setStatus('rm_ln_status', 'Renamed.', 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      setStatus('rm_ln_status', 'Error renaming: ' + err.message, 'error');
    }
  }

  function renderRecipeDetail() {
    renderTitle();
    document.getElementById('rm_type').textContent = currentRecipe.type;
    const isMenu = currentRecipe.type === 'Menu';
    document.getElementById('rm_yield').style.display = isMenu ? 'none' : 'inline-block';
    document.getElementById('rm_costperbaseLine').style.display = isMenu ? 'none' : 'flex';
    document.getElementById('rm_scaleSection').style.display = isMenu ? 'none' : 'block';
    if (!isMenu) {
      document.getElementById('rm_yield').textContent = `Yields ${currentRecipe.yieldAmount} ${portionUnit(currentRecipe.yieldMeasureType, currentRecipe.yieldUnit, currentRecipe.yieldAmount)}`;
      document.getElementById('rm_costperbase').textContent = `${fmtMoney2(currentRecipe.costPerBase)} per ${portionRateUnit(currentRecipe.yieldMeasureType)}`;
      document.getElementById('rm_sc_target').value = currentRecipe.yieldAmount;
      document.getElementById('rm_sc_unit').value = portionUnit(currentRecipe.yieldMeasureType, currentRecipe.yieldUnit);
    }
    renderScale();
  }

  function renderScale() {
    if (!currentRecipe) return;
    const factorNote = document.getElementById('rm_sc_factor');
    const target = parseFloat(document.getElementById('rm_sc_target').value);
    if (!target || !currentRecipe.yieldAmount || target === currentRecipe.yieldAmount) {
      currentScaleFactor = 1;
      factorNote.textContent = '';
    } else {
      currentScaleFactor = target / currentRecipe.yieldAmount;
      factorNote.textContent = `×${fmtQty(currentScaleFactor)}`;
    }
    document.getElementById('rm_totalcost').textContent = fmtMoney2(currentRecipe.totalCost * currentScaleFactor);
    renderLinesTable();
  }

  // ---------- Component search (shared by the trailing add-row and swap) ----------
  function searchableComponents() {
    const ingredientItems = ingredients.map(i => ({ type: 'Ingredient', id: i.id, name: i.name, measureType: i.measureType }));
    // Menus are a container above the recipe layer, not a component — never
    // addable as a line inside another recipe (or another menu).
    const recipeItems = recipesAll
      .filter(r => (!currentRecipe || r.id !== currentRecipe.id) && r.type !== 'Menu')
      .map(r => ({ type: 'Recipe', id: r.id, name: r.name, measureType: r.yieldMeasureType }));
    return ingredientItems.concat(recipeItems);
  }
  function filterComponents(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return searchableComponents().filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
  }
  function searchOptionsHTML(results) {
    if (!results.length) return '<div class="search-empty">No matches</div>';
    return results.map((r, i) => `<div class="search-option" data-idx="${i}"><span class="name">${r.name}</span><span class="tag">${r.type === 'Ingredient' ? 'Ingredient' : 'Sub-recipe'}</span></div>`).join('');
  }

  function costPerBaseForComponent(comp, supplierId) {
    if (!comp) return null;
    if (comp.type === 'Ingredient') {
      const chosen = supplierId ? supplierIngredients.find(s => s.id === supplierId) : null;
      return chosen ? chosen.costPerBase : 0;
    }
    const ref = recipesAll.find(r => r.id === comp.id);
    return ref ? (ref.costPerBase || 0) : 0;
  }
  function computeLineCost(comp, qty, unit, supplierId) {
    if (!comp || !qty || !unit) return null;
    const costPerBase = costPerBaseForComponent(comp, supplierId);
    if (costPerBase === null) return null;
    return toBaseAmount(comp.measureType, qty, unit) * costPerBase;
  }

  function componentDisplayName(type, id) {
    if (type === 'Ingredient') return (ingredientById(id) || {}).name || id;
    return (recipesAll.find(r => r.id === id) || {}).name || id;
  }
  function componentLink(type, id) {
    const name = componentDisplayName(type, id);
    const role = type === 'Ingredient' ? 'open-ingredient' : 'open-recipe';
    return `<a href="#" class="cell-main" data-role="${role}" data-id="${id}">${name}</a>`;
  }
  function onIngredientChanged() {
    (async () => {
      const cfg = getStoredConfig();
      const rows = await sheetsGet(cfg.spreadsheetId, ING_RANGE, token);
      ingredients = (rows.slice(1) || []).map(r => ({ id: r[0], name: r[1], measureType: r[3], baseUnit: r[4] })).filter(i => i.id);
      if (currentRecipe) renderScale();
    })();
  }
  function bindComponentLinks(container) {
    container.addEventListener('click', (e) => {
      const recipeLink = e.target.closest('a[data-role="open-recipe"]');
      if (recipeLink) { e.preventDefault(); openRecipeModalInternal(recipeLink.dataset.id); return; }
      const ingLink = e.target.closest('a[data-role="open-ingredient"]');
      if (ingLink) { e.preventDefault(); openIngredientModal(ingLink.dataset.id, { onChange: onIngredientChanged }); }
    });
  }

  function componentCellHTML(l) {
    if (editingComponentLineId === l.id) {
      return `<span class="search-wrap">
          <input type="text" class="row-input" data-role="swap-search" data-id="${l.id}" placeholder="Search replacement…" autocomplete="off" value="${escapeAttr(swapQuery)}">
          <div class="search-dropdown" data-role="swap-dropdown" data-id="${l.id}" hidden></div>
        </span>
        <button type="button" class="secondary" data-role="cancel-swap" data-id="${l.id}" title="Cancel" style="margin:4px 0 0; padding:2px 6px;">&times;</button>`;
    }
    return `${componentLink(l.componentType, l.componentId)}<span class="cell-sub">${l.componentType}</span>`;
  }

  function newRowHTML() {
    const pick = newLine.pick;
    const nameCell = pick
      ? `<span class="cell-main">${pick.name}</span><span class="cell-sub">${pick.type === 'Ingredient' ? 'Ingredient' : 'Sub-recipe'}</span>`
      : `<span class="search-wrap">
          <input type="text" class="row-input" data-role="new-line-search" placeholder="Add ingredient or sub-recipe…" autocomplete="off" value="${escapeAttr(newLine.query)}">
          <div class="search-dropdown" data-role="new-line-dropdown" hidden></div>
        </span>`;

    let qtyCell = '', supCell = '';
    if (pick) {
      const unitLabelFor = pick.type === 'Recipe' ? (u => portionUnit(pick.measureType, u)) : (u => unitLabel(pick.measureType, u));
      const unitOpts = unitsForType(pick.measureType).map(u => `<option value="${u}" ${u === newLine.unit ? 'selected' : ''}>${unitLabelFor(u)}</option>`).join('');
      qtyCell = `<span class="qty-cell">
        <input type="number" step="0.01" min="0" class="row-input" data-role="new-line-qty" value="${newLine.qty}" placeholder="Qty">
        <select class="row-select" data-role="new-line-unit">${unitOpts}</select>
      </span>`;
      if (pick.type === 'Ingredient') {
        const opts = supplierIngredients.filter(s => s.ingredientId === pick.id);
        const cheap = cheapestSupplierFor(pick.id);
        supCell = opts.length
          ? `<select class="row-select" data-role="new-line-supplier">` + opts.map(o =>
              `<option value="${o.id}" ${o.id === newLine.supplierId ? 'selected' : ''}>${supplierName(o.supplierId)} — ${fmtMoney2(o.costPerBase)}${cheap && o.id === cheap.id ? ' (cheapest)' : ''}</option>`
            ).join('') + '</select>'
          : '<span style="color:var(--muted); font-size:12px;">No price yet</span>';
      } else {
        supCell = '<span style="color:var(--muted);">—</span>';
      }
    }

    const preview = pick ? computeLineCost(pick, parseFloat(newLine.qty) || 0, newLine.unit, newLine.supplierId) : null;
    const clearBtn = pick ? `<button type="button" class="secondary" data-role="new-line-clear" title="Clear" style="margin:0; padding:4px 8px;">&times;</button>` : '';

    return `<tr class="new-row">
      <td></td>
      <td>${nameCell}</td>
      <td>${qtyCell}</td>
      <td>${supCell}</td>
      <td class="num">${preview === null ? '—' : fmtMoney2(preview)}</td>
      <td>${clearBtn}</td>
    </tr>`;
  }
  function updateNewLinePreview() {
    const row = document.querySelector('#rm_linesBody tr.new-row');
    if (!row) return;
    const preview = newLine.pick ? computeLineCost(newLine.pick, parseFloat(newLine.qty) || 0, newLine.unit, newLine.supplierId) : null;
    row.children[4].textContent = preview === null ? '—' : fmtMoney2(preview);
  }

  async function loadLines(spreadsheetId) {
    const rows = await sheetsGet(spreadsheetId, RL_RANGE, token);
    const headerLen = (rows[0] || []).filter(c => (c || '').trim() !== '').length;
    if (headerLen < RL_HEADERS.length) {
      await sheetsUpdateRange(spreadsheetId, 'RecipeLines!A1:I1', [RL_HEADERS], token, 'USER_ENTERED');
    }
    currentLines = rows
      .map((r, i) => ({ r, rowIndex: i }))
      .filter(({ r, rowIndex }) => rowIndex > 0 && r[0] && r[1] === currentRecipe.id)
      .map(({ r, rowIndex }) => {
        const parsedOrder = parseFloat(r[8]);
        return {
          rowIndex, id: r[0], recipeId: r[1], componentType: r[2], componentId: r[3],
          quantity: parseFloat(r[4]) || 0, unit: r[5], supplierId: r[6] || '', lineCost: parseFloat(r[7]) || 0,
          sortOrder: isNaN(parsedOrder) ? rowIndex : parsedOrder
        };
      });
    currentLines.sort((a, b) => a.sortOrder - b.sortOrder);
    renderScale();
  }
  function nextSortOrder() {
    return currentLines.length ? Math.max(...currentLines.map(l => l.sortOrder)) + 1 : 1;
  }

  function supplierCellHTML(l) {
    if (l.componentType !== 'Ingredient') return '<span style="color:var(--muted);">—</span>';
    if (editingSupplierLineId === l.id) {
      const options = supplierIngredients.filter(s => s.ingredientId === l.componentId);
      const optHtml = ['<option value="">Unlinked (no price)</option>']
        .concat(options.map(o => `<option value="${o.id}" ${o.id === l.supplierId ? 'selected' : ''}>${supplierName(o.supplierId)} — ${fmtMoney2(o.costPerBase)}</option>`))
        .join('');
      return `<span style="display:flex; align-items:center; gap:4px;">
        <select data-role="supplier-edit-select" data-id="${l.id}" style="max-width:200px;">${optHtml}</select>
        <button type="button" class="secondary" data-role="cancel-edit-supplier" data-id="${l.id}" title="Cancel" style="margin:0; padding:2px 6px;">&times;</button>
      </span>`;
    }
    const entry = supplierIngredients.find(s => s.id === l.supplierId);
    if (entry) {
      return `<button type="button" data-role="edit-supplier" data-id="${l.id}" title="Linked to ${supplierName(entry.supplierId)} — click to change" style="background:none; border:none; cursor:pointer; font-size:16px; color:var(--good); padding:0;">&#10003;</button>`;
    }
    return `<button type="button" data-role="edit-supplier" data-id="${l.id}" title="No supplier price linked — click to link" style="background:none; border:none; cursor:pointer; font-size:16px; color:var(--muted); padding:0;">&#43;</button>`;
  }

  function componentMeasureType(l) {
    if (l.componentType === 'Ingredient') { const ing = ingredientById(l.componentId); return ing ? ing.measureType : ''; }
    const ref = recipesAll.find(r => r.id === l.componentId);
    return ref ? ref.yieldMeasureType : '';
  }
  function lineCostPerBase(l) {
    if (l.componentType === 'Ingredient') {
      const chosen = l.supplierId ? supplierIngredients.find(s => s.id === l.supplierId) : null;
      return chosen ? chosen.costPerBase : 0;
    }
    const ref = recipesAll.find(r => r.id === l.componentId);
    return ref ? (ref.costPerBase || 0) : 0;
  }

  function quantityCellHTML(l, factor) {
    const measureType = componentMeasureType(l);
    const unitFor = (u, amount) => l.componentType === 'Recipe' ? portionUnit(measureType, u, amount) : unitLabel(measureType, u);
    if (editingQtyLineId === l.id) {
      const unitOpts = unitsForType(measureType).map(u => `<option value="${u}" ${u === l.unit ? 'selected' : ''}>${unitFor(u)}</option>`).join('');
      return `<span style="display:flex; flex-direction:column; gap:2px;">
        <span style="display:flex; align-items:center; gap:4px;">
          <input type="number" step="0.01" min="0" data-role="qty-edit-input" data-id="${l.id}" value="${l.quantity}" style="width:70px;">
          <select data-role="qty-edit-unit" data-id="${l.id}">${unitOpts}</select>
          <button type="button" data-role="save-qty" data-id="${l.id}" title="Save" style="margin:0; padding:2px 6px;">&#10003;</button>
          <button type="button" class="secondary" data-role="cancel-edit-qty" data-id="${l.id}" title="Cancel" style="margin:0; padding:2px 6px;">&times;</button>
        </span>
        ${factor !== 1 ? '<span style="font-size:11px; color:var(--muted);">Editing the base amount, not the scaled view</span>' : ''}
      </span>`;
    }
    const shownQty = fmtQty(l.quantity * factor);
    return `<button type="button" data-role="edit-qty" data-id="${l.id}" title="Click to change quantity or unit" style="background:none; border:none; cursor:pointer; padding:0; font:inherit; text-decoration:underline dotted; color:inherit;">${shownQty} ${unitFor(l.unit, shownQty)}</button>`;
  }

  function renderLinesTable() {
    const table = document.getElementById('rm_linesTable');
    const body = document.getElementById('rm_linesBody');
    const factor = currentScaleFactor;
    const rowsHtml = currentLines.map((l) => {
      const rateUnit = l.componentType === 'Recipe' ? portionRateUnit(componentMeasureType(l)) : baseUnitFor(componentMeasureType(l));
      const unlinked = l.componentType === 'Ingredient' && !supplierIngredients.find(s => s.id === l.supplierId);
      const draggable = editingComponentLineId === l.id ? 'false' : 'true';
      return `
      <tr class="${unlinked ? 'line-unlinked' : ''}" draggable="${draggable}" data-id="${l.id}">
        <td class="drag-col"><span class="drag-handle" title="Drag to reorder">&#8942;&#8942;</span></td>
        <td>${componentCellHTML(l)}</td>
        <td>${quantityCellHTML(l, factor)}</td>
        <td>${supplierCellHTML(l)}</td>
        <td class="num"><span class="cell-main">${fmtMoney2(l.lineCost * factor)}</span>${rateUnit ? `<span class="cell-sub">${fmtMoney2(lineCostPerBase(l))} per ${rateUnit}</span>` : ''}</td>
        <td style="white-space:nowrap;">
          <button type="button" class="secondary" data-role="swap-line" data-id="${l.id}" title="Swap component" style="margin:0; padding:4px 8px;">&#8646;</button>
          <button type="button" class="secondary danger" data-role="remove-line" data-id="${l.id}" title="Remove" style="margin:0; padding:4px 8px;">&times;</button>
        </td>
      </tr>`;
    }).join('');
    body.innerHTML = rowsHtml + newRowHTML();
    table.style.display = 'table';
  }

  async function reorderLine(sourceId, targetId, before) {
    if (sourceId === targetId) return;
    const order = currentLines.map(l => l.id).filter(id => id !== sourceId);
    const targetIdx = order.indexOf(targetId);
    if (targetIdx === -1) return;
    order.splice(before ? targetIdx : targetIdx + 1, 0, sourceId);
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Reordering...');
    try {
      const updates = [];
      order.forEach((id, i) => {
        const line = currentLines.find(l => l.id === id);
        const newOrder = i + 1;
        if (line && line.sortOrder !== newOrder) {
          updates.push(sheetsUpdateRange(cfg.spreadsheetId, `RecipeLines!I${line.rowIndex + 1}:I${line.rowIndex + 1}`, [[newOrder]], token, 'RAW'));
        }
      });
      await Promise.all(updates);
      await loadLines(cfg.spreadsheetId);
      setStatus('rm_ln_status', '');
    } catch (err) {
      setStatus('rm_ln_status', 'Error reordering: ' + err.message, 'error');
    }
  }

  async function removeLine(lineId) {
    const line = currentLines.find(l => l.id === lineId);
    if (!line || !currentRecipe) return;
    if (!confirm('Remove this line from the recipe?')) return;
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Removing...');
    try {
      const tabs = await sheetsGetTabs(cfg.spreadsheetId, token);
      const rlSheetId = (tabs.find(t => t.title === 'RecipeLines') || {}).sheetId;
      if (rlSheetId == null) throw new Error('Could not find the RecipeLines tab.');
      await sheetsBatchUpdate(cfg.spreadsheetId, [{
        deleteDimension: { range: { sheetId: rlSheetId, dimension: 'ROWS', startIndex: line.rowIndex, endIndex: line.rowIndex + 1 } }
      }], token);
      await recalcAndSaveRecipeCost(cfg);
      await refreshCurrentRecipe();
      setStatus('rm_ln_status', 'Line removed.', 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      setStatus('rm_ln_status', 'Error removing: ' + err.message, 'error');
    }
  }

  async function setLineSupplier(lineId, newSiId) {
    const line = currentLines.find(l => l.id === lineId);
    if (!line || !currentRecipe) return;
    const ing = ingredientById(line.componentId);
    const chosen = newSiId ? supplierIngredients.find(s => s.id === newSiId) : null;
    const costPerBase = chosen ? chosen.costPerBase : 0;
    const newLineCost = ing ? toBaseAmount(ing.measureType, line.quantity, line.unit) * costPerBase : 0;
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Saving...');
    try {
      await sheetsUpdateRange(
        cfg.spreadsheetId, `RecipeLines!G${line.rowIndex + 1}:H${line.rowIndex + 1}`,
        [[newSiId || '', newLineCost.toFixed(4)]], token, 'USER_ENTERED'
      );
      await recalcAndSaveRecipeCost(cfg);
      editingSupplierLineId = null;
      await refreshCurrentRecipe();
      setStatus('rm_ln_status', 'Supplier updated.', 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      setStatus('rm_ln_status', 'Error updating supplier: ' + err.message, 'error');
    }
  }

  async function setLineQuantity(lineId, newQty, newUnit) {
    const line = currentLines.find(l => l.id === lineId);
    if (!line || !currentRecipe) return;
    if (!newQty || newQty <= 0 || !newUnit) { setStatus('rm_ln_status', 'Enter a valid quantity and unit.', 'error'); return; }
    const measureType = componentMeasureType(line);
    const newLineCost = measureType ? toBaseAmount(measureType, newQty, newUnit) * lineCostPerBase(line) : 0;
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Saving...');
    try {
      await sheetsUpdateRange(
        cfg.spreadsheetId, `RecipeLines!E${line.rowIndex + 1}:H${line.rowIndex + 1}`,
        [[newQty, newUnit, line.supplierId || '', newLineCost.toFixed(4)]], token, 'USER_ENTERED'
      );
      await recalcAndSaveRecipeCost(cfg);
      editingQtyLineId = null;
      await refreshCurrentRecipe();
      setStatus('rm_ln_status', 'Quantity updated.', 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      setStatus('rm_ln_status', 'Error updating quantity: ' + err.message, 'error');
    }
  }

  function saveQtyFromInputs(lineId) {
    const input = document.querySelector(`input[data-role="qty-edit-input"][data-id="${lineId}"]`);
    const unitSel = document.querySelector(`select[data-role="qty-edit-unit"][data-id="${lineId}"]`);
    if (input && unitSel) setLineQuantity(lineId, parseFloat(input.value), unitSel.value);
  }

  function pickNewLineComponent(result) {
    if (!result) return;
    newLine.pick = result;
    newLine.query = result.name;
    newLine.unit = unitsForType(result.measureType)[0] || '';
    newLine.qty = '';
    newLine.supplierId = result.type === 'Ingredient' ? ((cheapestSupplierFor(result.id) || {}).id || '') : '';
    renderLinesTable();
    const qtyInput = document.querySelector('#rm_linesBody tr.new-row input[data-role="new-line-qty"]');
    if (qtyInput) qtyInput.focus();
  }

  function attemptCommitNewLine() {
    if (!newLine.pick) return;
    const qty = parseFloat(newLine.qty);
    if (!qty || qty <= 0 || !newLine.unit) return;
    commitNewLine();
  }

  async function commitNewLine() {
    if (!currentRecipe) return;
    const { pick, unit, supplierId } = newLine;
    const qty = parseFloat(newLine.qty);
    const lineCost = computeLineCost(pick, qty, unit, supplierId) || 0;
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Adding line...');
    try {
      const existingRL = await sheetsGet(cfg.spreadsheetId, RL_RANGE, token);
      const rlRows = existingRL.length ? existingRL : [RL_HEADERS];
      const lineId = nextId(rlRows, 'RL');
      const row = [lineId, currentRecipe.id, pick.type, pick.id, qty, unit, supplierId || '', lineCost.toFixed(4), nextSortOrder()];
      await sheetsAppend(cfg.spreadsheetId, RL_RANGE, row, token);
      await recalcAndSaveRecipeCost(cfg);
      newLine = { query: '', pick: null, qty: '', unit: '', supplierId: '' };
      await refreshCurrentRecipe();
      setStatus('rm_ln_status', 'Line added.', 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
      const freshInput = document.querySelector('#rm_linesBody tr.new-row input[data-role="new-line-search"]');
      if (freshInput) freshInput.focus();
    } catch (err) {
      setStatus('rm_ln_status', 'Error: ' + err.message, 'error');
    }
  }

  async function commitSwap(lineId, result) {
    if (!result) return;
    const line = currentLines.find(l => l.id === lineId);
    if (!line || !currentRecipe) return;
    const newUnit = unitsForType(result.measureType).includes(line.unit) ? line.unit : (unitsForType(result.measureType)[0] || '');
    const newSupplierId = result.type === 'Ingredient' ? ((cheapestSupplierFor(result.id) || {}).id || '') : '';
    const newLineCost = computeLineCost(result, line.quantity, newUnit, newSupplierId) || 0;
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Swapping...');
    try {
      await sheetsUpdateRange(
        cfg.spreadsheetId, `RecipeLines!C${line.rowIndex + 1}:H${line.rowIndex + 1}`,
        [[result.type, result.id, line.quantity, newUnit, newSupplierId, newLineCost.toFixed(4)]], token, 'USER_ENTERED'
      );
      await recalcAndSaveRecipeCost(cfg);
      editingComponentLineId = null;
      await refreshCurrentRecipe();
      setStatus('rm_ln_status', 'Component swapped.', 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      setStatus('rm_ln_status', 'Error swapping: ' + err.message, 'error');
    }
  }

  async function recalcAndSaveRecipeCost(cfg) {
    const rlRows = await sheetsGet(cfg.spreadsheetId, RL_RANGE, token);
    const lines = (rlRows.slice(1) || []).filter(r => r[1] === currentRecipe.id);
    const totalCost = lines.reduce((sum, r) => sum + (parseFloat(r[7]) || 0), 0);
    const recRows = await sheetsGet(cfg.spreadsheetId, REC_RANGE, token);
    const rowIndex = recRows.findIndex((r, i) => i > 0 && r[0] === currentRecipe.id);
    if (rowIndex === -1) throw new Error('Could not find this recipe\'s row to update.');
    const yieldBaseAmount = toBaseAmount(currentRecipe.yieldMeasureType, currentRecipe.yieldAmount, currentRecipe.yieldUnit);
    const costPerBase = yieldBaseAmount ? totalCost / yieldBaseAmount : 0;
    const sheetRow = rowIndex + 1;
    await sheetsUpdateRange(cfg.spreadsheetId, `Recipes!G${sheetRow}:H${sheetRow}`, [[totalCost.toFixed(2), costPerBase.toFixed(4)]], token, 'USER_ENTERED');
  }

  async function refreshLineCosts() {
    if (!currentRecipe) return;
    const status = document.getElementById('rm_refreshCostsStatus');
    status.textContent = 'Refreshing...'; status.className = 'status-line';
    const btn = document.getElementById('rm_refreshCostsBtn');
    btn.disabled = true;
    try {
      const cfg = getStoredConfig();
      const [siRows, recRows] = await Promise.all([
        sheetsGet(cfg.spreadsheetId, SI_RANGE, token),
        sheetsGet(cfg.spreadsheetId, REC_RANGE, token)
      ]);
      supplierIngredients = (siRows.slice(1) || []).map(r => ({
        id: r[0], ingredientId: r[1], supplierId: r[2],
        packSize: parseFloat(r[3]) || 0, packUnit: r[4],
        price: parseFloat(r[5]) || 0, costPerBase: parseFloat(r[6]) || 0
      })).filter(s => s.id);
      recipesAll = (recRows.slice(1) || []).map(r => ({
        id: r[0], name: r[1], type: r[2], yieldMeasureType: r[3],
        yieldAmount: parseFloat(r[4]) || 0, yieldUnit: r[5],
        totalCost: parseFloat(r[6]) || 0, costPerBase: parseFloat(r[7]) || 0
      })).filter(r => r.id);
      const updates = [];
      let changed = 0;
      for (const line of currentLines) {
        let measureType, costPerBase, newSupplierId = line.supplierId;
        if (line.componentType === 'Ingredient') {
          const ing = ingredientById(line.componentId);
          measureType = ing ? ing.measureType : '';
          let chosen = line.supplierId ? supplierIngredients.find(s => s.id === line.supplierId) : null;
          if (!chosen) chosen = cheapestSupplierFor(line.componentId);
          costPerBase = chosen ? chosen.costPerBase : 0;
          newSupplierId = chosen ? chosen.id : '';
        } else {
          const ref = recipesAll.find(r => r.id === line.componentId);
          measureType = ref ? ref.yieldMeasureType : '';
          costPerBase = ref ? (ref.costPerBase || 0) : 0;
        }
        const newLineCost = measureType ? toBaseAmount(measureType, line.quantity, line.unit) * costPerBase : 0;
        if (Math.abs(newLineCost - line.lineCost) > 0.0001 || newSupplierId !== line.supplierId) {
          changed++;
          updates.push(sheetsUpdateRange(
            cfg.spreadsheetId, `RecipeLines!G${line.rowIndex + 1}:H${line.rowIndex + 1}`,
            [[newSupplierId, newLineCost.toFixed(4)]], token, 'USER_ENTERED'
          ));
        }
      }
      await Promise.all(updates);
      if (changed) await recalcAndSaveRecipeCost(cfg);
      await refreshCurrentRecipe();
      status.textContent = changed ? `Updated ${changed} line(s).` : 'All line costs already up to date.';
      status.className = 'status-line ok';
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      status.textContent = 'Error refreshing costs: ' + err.message;
      status.className = 'status-line error';
    } finally {
      btn.disabled = false;
    }
  }

  async function refreshCurrentRecipe() {
    const cfg = getStoredConfig();
    await loadRecipesOnly(cfg.spreadsheetId);
    currentRecipe = recipesAll.find(r => r.id === currentRecipe.id) || null;
    if (currentRecipe) { renderRecipeDetail(); await loadLines(cfg.spreadsheetId); }
    else { dialogEl.close(); }
  }

  // ---------- Delete ----------
  async function deleteRecipe() {
    if (!currentRecipe) return;
    const cfg = getStoredConfig();
    setStatus('rm_ln_status', 'Checking where this recipe is used...');
    let rlAll;
    try {
      rlAll = await sheetsGet(cfg.spreadsheetId, RL_RANGE, token);
    } catch (err) {
      setStatus('rm_ln_status', 'Error checking usage: ' + err.message, 'error');
      return;
    }
    const usedElsewhere = rlAll.slice(1).filter(r => r[2] === 'Recipe' && r[3] === currentRecipe.id).length;
    if (usedElsewhere) {
      setStatus('rm_ln_status', `Can't delete — used as a sub-recipe in ${usedElsewhere} recipe line(s). Remove those lines first, then try again.`, 'error');
      return;
    }
    const ownLineCount = rlAll.slice(1).filter(r => r[1] === currentRecipe.id).length;
    const msg = ownLineCount
      ? `Delete "${currentRecipe.name}" and its ${ownLineCount} line(s)? This can't be undone.`
      : `Delete "${currentRecipe.name}"? This can't be undone.`;
    if (!confirm(msg)) { setStatus('rm_ln_status', ''); return; }

    setStatus('rm_ln_status', 'Deleting...');
    try {
      const tabs = await sheetsGetTabs(cfg.spreadsheetId, token);
      const recSheetId = (tabs.find(t => t.title === 'Recipes') || {}).sheetId;
      const rlSheetId = (tabs.find(t => t.title === 'RecipeLines') || {}).sheetId;
      if (recSheetId == null || rlSheetId == null) throw new Error('Could not find the Recipes or RecipeLines tab.');

      const ownLineIndices = [];
      rlAll.forEach((r, i) => { if (i > 0 && r[1] === currentRecipe.id) ownLineIndices.push(i); });
      ownLineIndices.sort((a, b) => b - a);
      const requests = ownLineIndices.map(idx => ({
        deleteDimension: { range: { sheetId: rlSheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 } }
      }));

      const recRows = await sheetsGet(cfg.spreadsheetId, REC_RANGE, token);
      const recIdx = recRows.findIndex((r, i) => i > 0 && r[0] === currentRecipe.id);
      if (recIdx === -1) throw new Error('Could not find this recipe\'s row.');
      requests.push({ deleteDimension: { range: { sheetId: recSheetId, dimension: 'ROWS', startIndex: recIdx, endIndex: recIdx + 1 } } });

      await sheetsBatchUpdate(cfg.spreadsheetId, requests, token);
      const deletedId = currentRecipe.id;
      dialogEl.close();
      currentRecipe = null;
      onChangeCb && onChangeCb({ action: 'deleted', id: deletedId });
    } catch (err) {
      setStatus('rm_ln_status', 'Error deleting: ' + err.message, 'error');
    }
  }

  // ================= Paste importer =================
  const COOK_UNITS = {
    g: ['Weight', 'g', 1], gram: ['Weight', 'g', 1], grams: ['Weight', 'g', 1], gr: ['Weight', 'g', 1],
    kg: ['Weight', 'kg', 1], kilo: ['Weight', 'kg', 1], kilos: ['Weight', 'kg', 1], kilogram: ['Weight', 'kg', 1], kilograms: ['Weight', 'kg', 1],
    oz: ['Weight', 'g', 28.35], ounce: ['Weight', 'g', 28.35], ounces: ['Weight', 'g', 28.35],
    lb: ['Weight', 'g', 453.6], lbs: ['Weight', 'g', 453.6], pound: ['Weight', 'g', 453.6], pounds: ['Weight', 'g', 453.6],
    ml: ['Volume', 'ml', 1], milliliter: ['Volume', 'ml', 1], millilitre: ['Volume', 'ml', 1], milliliters: ['Volume', 'ml', 1], millilitres: ['Volume', 'ml', 1],
    l: ['Volume', 'L', 1], litre: ['Volume', 'L', 1], litres: ['Volume', 'L', 1], liter: ['Volume', 'L', 1], liters: ['Volume', 'L', 1],
    tbsp: ['Weight|Volume', 'tbsp', 1], tbs: ['Weight|Volume', 'tbsp', 1], tablespoon: ['Weight|Volume', 'tbsp', 1], tablespoons: ['Weight|Volume', 'tbsp', 1],
    tsp: ['Weight|Volume', 'tsp', 1], teaspoon: ['Weight|Volume', 'tsp', 1], teaspoons: ['Weight|Volume', 'tsp', 1],
    cup: ['Volume', 'ml', 240], cups: ['Volume', 'ml', 240],
    pc: ['Unit', 'pc', 1], piece: ['Unit', 'pc', 1], pieces: ['Unit', 'pc', 1],
    clove: ['Unit', 'pc', 1], cloves: ['Unit', 'pc', 1], slice: ['Unit', 'pc', 1], slices: ['Unit', 'pc', 1],
    egg: ['Unit', 'pc', 1], eggs: ['Unit', 'pc', 1], can: ['Unit', 'pc', 1], cans: ['Unit', 'pc', 1], tin: ['Unit', 'pc', 1], tins: ['Unit', 'pc', 1],
    bunch: ['Unit', 'pc', 1], bunches: ['Unit', 'pc', 1], sprig: ['Unit', 'pc', 1], sprigs: ['Unit', 'pc', 1],
    dozen: ['Unit', 'pc', 12], pinch: ['Weight', 'g', 1], pinches: ['Weight', 'g', 1]
  };
  const UNI_FRAC = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875, '⅕': .2, '⅖': .4, '⅗': .6 };
  const NOISE = /\b(fresh|dried|chopped|minced|diced|sliced|grated|shredded|ground|finely|roughly|large|small|medium|ripe|to taste|for garnish|optional|softened|melted|beaten|peeled|crushed|plus extra.*)\b/gi;

  function normName(s) { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function singular(w) { return (w.endsWith('es') && w.length > 4) ? w.slice(0, -2) : ((w.endsWith('s') && !w.endsWith('ss') && w.length > 3) ? w.slice(0, -1) : w); }
  function nameTokens(s) { return normName(s).split(' ').filter(Boolean).map(singular); }

  function matchIngredient(name) {
    const nt = nameTokens(name);
    if (!nt.length) return null;
    let best = null, bestScore = 0;
    for (const ing of ingredients) {
      const it = nameTokens(ing.name);
      if (!it.length) continue;
      const overlap = nt.filter(t => it.includes(t)).length;
      if (!overlap) continue;
      const score = overlap / it.length + overlap / nt.length + (normName(ing.name) === normName(name) ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = ing; }
    }
    return bestScore >= 0.9 ? best : null;
  }

  function cleanName(s) {
    return s.replace(/\(.*?\)/g, ' ').split(',')[0].replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  }

  function peelUnit(s) {
    const m = s.match(/^([a-zA-Z]+)\.?\s*/);
    if (m) {
      const t0 = m[1].toLowerCase();
      const hit = COOK_UNITS[t0] || COOK_UNITS[singular(t0)];
      if (hit) return { cook: hit, unitRaw: m[1], rest: s.slice(m[0].length) };
    }
    return { cook: null, unitRaw: '', rest: s };
  }

  function extractLeading(s) {
    let m, qty = null;
    if (m = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*/)) qty = parseInt(m[1]) + parseInt(m[2]) / parseInt(m[3]);
    else if (m = s.match(/^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗])\s*/)) qty = parseInt(m[1]) + UNI_FRAC[m[2]];
    else if (m = s.match(/^(\d+)\/(\d+)\s*/)) qty = parseInt(m[1]) / parseInt(m[2]);
    else if (m = s.match(/^([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗])\s*/)) qty = UNI_FRAC[m[1]];
    else if (m = s.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*/)) qty = parseFloat(m[1]);
    else if (m = s.match(/^(\d+(?:\.\d+)?)\s*/)) qty = parseFloat(m[1]);
    else return null;
    const after = s.slice(m[0].length);
    const { cook, unitRaw, rest } = peelUnit(after);
    if (cook && rest.trim()) return { qty, cook, unitRaw, name: rest };
    return { qty, cook: null, unitRaw: '', name: after };
  }

  function extractEmbedded(s) {
    let m, qty = null, start = -1, end = -1;
    if (m = s.match(/(\d+)\s+(\d+)\/(\d+)/)) { qty = parseInt(m[1]) + parseInt(m[2]) / parseInt(m[3]); start = m.index; end = start + m[0].length; }
    else if (m = s.match(/(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗])/)) { qty = parseInt(m[1]) + UNI_FRAC[m[2]]; start = m.index; end = start + m[0].length; }
    else if (m = s.match(/(\d+)\/(\d+)/)) { qty = parseInt(m[1]) / parseInt(m[2]); start = m.index; end = start + m[0].length; }
    else if (m = s.match(/[½¼¾⅓⅔⅛⅜⅝⅞⅕⅖⅗]/)) { qty = UNI_FRAC[m[0]]; start = m.index; end = start + m[0].length; }
    else if (m = s.match(/\d+(?:\.\d+)?/)) { qty = parseFloat(m[0]); start = m.index; end = start + m[0].length; }
    else return null;
    const before = s.slice(0, start);
    const { cook, unitRaw, rest } = peelUnit(s.slice(end).replace(/^\s+/, ''));
    const name = (before + ' ' + rest).replace(/\s+/g, ' ').trim();
    return { qty, cook, unitRaw, name };
  }

  function parseQtyUnit(raw) {
    let s = raw.trim().replace(/^[\-\*•–—▪●·]\s*/, '');
    let metricQty = null, metricCook = null, metricUnitRaw = '';
    const mp = s.match(/\((\d+(?:\.\d+)?)\s*(kg|kilograms?|g|grams?|ml|milliliters?|millilitres?|l|litres?|liters?)\)/i);
    if (mp) {
      metricQty = parseFloat(mp[1]);
      const u0 = mp[2].toLowerCase();
      metricCook = COOK_UNITS[u0] || COOK_UNITS[singular(u0)];
      metricUnitRaw = mp[2];
    }
    s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+-\s+.*$/, '').replace(/\s+/g, ' ').trim();
    const leading = extractLeading(s);
    const found = leading || extractEmbedded(s) || { qty: null, cook: null, unitRaw: '', name: s };
    const name = cleanName(found.name.replace(/^of\s+/i, ''));
    const leadingQty = !!leading;
    if (metricCook) return { qty: metricQty, cook: metricCook, unitRaw: metricUnitRaw, name, raw, leadingQty };
    return { qty: found.qty, cook: found.cook, unitRaw: found.unitRaw, name, raw, leadingQty };
  }

  function looksLikeIngredient(p, raw) {
    if (p.leadingQty) return true;
    const t = raw.trim();
    if (!t || t.length > 45) return false;
    if (/[.!?]$/.test(t)) return false;
    if (/^(step|method|instructions?|directions?|preheat|heat|cook|bake|stir|serve|mix|add|combine|season|for the)/i.test(t)) return false;
    return true;
  }

  function buildParsed(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    parsedRows = lines.map(raw => {
      const p = parseQtyUnit(raw);
      const match = p.name ? matchIngredient(p.name) : null;
      let measureType = '', unit = '', qty = p.qty, note = '';
      if (match) measureType = match.measureType;
      else if (p.cook) measureType = p.cook[0].split('|')[0];
      else measureType = 'Unit';

      if (p.cook) {
        if (p.cook[0].split('|').includes(measureType)) { unit = p.cook[1]; qty = (p.qty != null ? +(p.qty * p.cook[2]).toFixed(2) : null); }
        else { unit = baseUnitFor(measureType); note = `“${p.unitRaw}” doesn’t fit ${measureType} — check qty/unit`; }
      } else {
        unit = (measureType === 'Unit') ? 'pc' : baseUnitFor(measureType);
      }

      const cheap = match ? cheapestSupplierFor(match.id) : null;
      return {
        raw, name: p.name || raw, note,
        ingredientId: match ? match.id : '__new__',
        measureType, unit, qty,
        supplierId: cheap ? cheap.id : '',
        include: looksLikeIngredient(p, raw)
      };
    });
  }

  function rowCostText(m) {
    if (m.ingredientId === '__new__') return '—';
    const cpb = supplierCostPerBase(m.supplierId);
    if (cpb == null || m.qty == null || !m.unit || !m.measureType) return '—';
    return fmtMoney2(toBaseAmount(m.measureType, m.qty, m.unit) * cpb);
  }

  function renderIngredientDatalist() {
    document.getElementById('rmp_ingredientNames').innerHTML =
      ingredients.map(i => `<option value="${escapeAttr(i.name)}">`).join('');
  }

  function ingredientCell(m, idx) {
    const current = m.ingredientId === '__new__' ? m.name : ((ingredientById(m.ingredientId) || {}).name || m.name);
    const note = m.ingredientId === '__new__'
      ? `<div style="font-size:11px; color:var(--accent);">＋ will create new</div>`
      : `<div style="font-size:11px; color:var(--good);">✓ matched</div>`;
    return `<input type="text" data-role="ingredient" data-idx="${idx}" list="rmp_ingredientNames"
      value="${escapeAttr(current)}" placeholder="Search ingredients…" style="min-width:170px;">${note}`;
  }
  function measureOptions(m) {
    const dis = m.ingredientId === '__new__' ? '' : 'disabled';
    return `<select data-role="measure" data-idx="__IDX__" ${dis}>` +
      ['Weight', 'Volume', 'Unit'].map(t => `<option value="${t}" ${m.measureType === t ? 'selected' : ''}>${t}</option>`).join('') + '</select>';
  }
  function unitOptions(m) {
    const units = unitsForType(m.measureType) || [];
    return units.map(u => `<option value="${u}" ${m.unit === u ? 'selected' : ''}>${unitLabel(m.measureType, u)}</option>`).join('');
  }
  function supplierCell(m, idx) {
    if (m.ingredientId === '__new__') return '<span style="color:var(--muted); font-size:12px;">create first</span>';
    const opts = supplierIngredients.filter(s => s.ingredientId === m.ingredientId);
    if (!opts.length) return `<button type="button" class="secondary" data-role="link" data-idx="${idx}" style="margin:0; padding:5px 10px;">Link supplier</button>`;
    const cheap = cheapestSupplierFor(m.ingredientId);
    return `<select data-role="supplier" data-idx="${idx}">` + opts.map(o =>
      `<option value="${o.id}" ${m.supplierId === o.id ? 'selected' : ''}>${supplierName(o.supplierId)} — ${fmtMoney2(o.costPerBase)}${cheap && o.id === cheap.id ? ' (cheapest)' : ''}</option>`
    ).join('') + '</select>';
  }

  function renderReview() {
    const table = document.getElementById('rmp_reviewTable');
    const body = document.getElementById('rmp_reviewBody');
    const addBtn = document.getElementById('rmp_addParsedBtn');
    if (!parsedRows.length) { table.style.display = 'none'; addBtn.style.display = 'none'; return; }

    body.innerHTML = parsedRows.map((m, idx) => `
      <tr>
        <td><input type="checkbox" data-role="include" data-idx="${idx}" ${m.include ? 'checked' : ''}></td>
        <td style="font-size:12px;">${m.raw}${m.note ? `<div style="color:var(--warn); font-size:11px;">${m.note}</div>` : ''}</td>
        <td>${ingredientCell(m, idx)}</td>
        <td>${measureOptions(m).replace('__IDX__', idx)}</td>
        <td><input type="number" step="0.01" min="0" data-role="qty" data-idx="${idx}" value="${m.qty != null ? m.qty : ''}" style="width:70px;"></td>
        <td><select data-role="unit" data-idx="${idx}">${unitOptions(m)}</select></td>
        <td>${supplierCell(m, idx)}</td>
        <td id="rmp_rcost_${idx}">${rowCostText(m)}</td>
      </tr>
    `).join('');
    table.style.display = 'table';

    const n = parsedRows.filter(r => r.include).length;
    const created = parsedRows.filter(r => r.include && r.ingredientId === '__new__').length;
    document.getElementById('rmp_summary').innerHTML =
      `${parsedRows.length} line(s) parsed · <strong>${n}</strong> selected` + (created ? ` · <strong>${created}</strong> new ingredient(s) will be created` : '');
    addBtn.style.display = 'inline-block';
    addBtn.textContent = n ? `Add ${n} line${n === 1 ? '' : 's'} to recipe` : 'Nothing selected';
    addBtn.disabled = n === 0;
  }

  async function doAddParsedLines() {
    if (!currentRecipe) return;
    const included = parsedRows.filter(r => r.include && r.qty != null && r.unit);
    if (!included.length) { setStatus('rmp_status', 'Nothing to add — select rows and set quantities.', 'error'); return; }
    const cfg = getStoredConfig();
    document.getElementById('rmp_addParsedBtn').disabled = true;
    setStatus('rmp_status', `Adding ${included.length} line(s)...`);
    try {
      const newRows = included.filter(r => r.ingredientId === '__new__' && r.name);
      if (newRows.length) {
        const existingIng = await sheetsGet(cfg.spreadsheetId, ING_RANGE, token);
        const irows = existingIng.length ? existingIng : [ING_HEADERS];
        let n = 0;
        for (let i = 1; i < irows.length; i++) { const c = (irows[i][0] || '').toString(); if (c.startsWith('ING')) { const v = parseInt(c.slice(3), 10); if (!isNaN(v) && v > n) n = v; } }
        const toAppend = newRows.map(r => {
          n += 1; const id = 'ING' + String(n).padStart(3, '0');
          r.ingredientId = id;
          ingredients.push({ id, name: r.name, measureType: r.measureType, baseUnit: baseUnitFor(r.measureType) });
          return [id, r.name, '', r.measureType, baseUnitFor(r.measureType), '', '', '', '', '', ''];
        });
        await sheetsAppendRows(cfg.spreadsheetId, ING_RANGE, toAppend, token);
      }

      const existingRL = await sheetsGet(cfg.spreadsheetId, RL_RANGE, token);
      const rlRows = existingRL.length ? existingRL : [RL_HEADERS];
      let rl = 0;
      for (let i = 1; i < rlRows.length; i++) { const c = (rlRows[i][0] || '').toString(); if (c.startsWith('RL')) { const v = parseInt(c.slice(2), 10); if (!isNaN(v) && v > rl) rl = v; } }
      let order = nextSortOrder();
      const appendLines = included.map(r => {
        rl += 1; const id = 'RL' + String(rl).padStart(3, '0');
        const cpb = supplierCostPerBase(r.supplierId);
        const lineCost = (cpb != null) ? toBaseAmount(r.measureType, r.qty, r.unit) * cpb : 0;
        return [id, currentRecipe.id, 'Ingredient', r.ingredientId, r.qty, r.unit, r.supplierId || '', lineCost.toFixed(4), order++];
      });
      await sheetsAppendRows(cfg.spreadsheetId, RL_RANGE, appendLines, token);

      const siRows2 = await sheetsGet(cfg.spreadsheetId, SI_RANGE, token);
      supplierIngredients = (siRows2.slice(1) || []).map(r => ({
        id: r[0], ingredientId: r[1], supplierId: r[2],
        packSize: parseFloat(r[3]) || 0, packUnit: r[4],
        price: parseFloat(r[5]) || 0, costPerBase: parseFloat(r[6]) || 0
      })).filter(s => s.id);
      await recalcAndSaveRecipeCost(cfg);
      await refreshCurrentRecipe();
      const noPrice = included.filter(r => supplierCostPerBase(r.supplierId) == null).length;
      pasteDialogEl.close();
      setStatus('rm_ln_status', `Added ${appendLines.length} line(s)${noPrice ? ` — ${noPrice} had no supplier price (counted as £0; link a supplier and re-add to cost them)` : ''}.`, noPrice ? '' : 'ok');
      onChangeCb && onChangeCb({ action: 'saved', id: currentRecipe ? currentRecipe.id : null });
    } catch (err) {
      setStatus('rmp_status', 'Error: ' + err.message, 'error');
      document.getElementById('rmp_addParsedBtn').disabled = false;
    }
  }

  function openLinkDialog(idx) {
    linkIdx = idx;
    const m = parsedRows[idx];
    const ing = ingredientById(m.ingredientId);
    if (!ing) return;
    document.getElementById('rml_title').textContent = `Link a supplier to ${ing.name}`;
    document.getElementById('rml_supplier').innerHTML = suppliers.length
      ? suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')
      : '<option value="">No suppliers — add one on the Suppliers page</option>';
    document.getElementById('rml_packunit').innerHTML = unitsForType(ing.measureType).map(u => `<option value="${u}">${unitLabel(ing.measureType, u)}</option>`).join('');
    document.getElementById('rml_form').reset();
    document.getElementById('rml_cost').textContent = '—';
    document.getElementById('rml_status').textContent = '';
    linkDialogEl.showModal();
    linkDialogGuard.arm();
  }

  function recalcLinkCost() {
    const m = parsedRows[linkIdx]; const ing = m ? ingredientById(m.ingredientId) : null;
    const box = document.getElementById('rml_cost');
    const ps = parseFloat(document.getElementById('rml_packsize').value);
    const pu = document.getElementById('rml_packunit').value;
    const pr = parseFloat(document.getElementById('rml_price').value);
    if (!ing || !ps || !pu || !pr) { box.textContent = '—'; return null; }
    const base = toBaseAmount(ing.measureType, ps, pu);
    if (!base) { box.textContent = '—'; return null; }
    const cpb = pr / base; box.textContent = `${fmtMoney2(cpb)} per ${ing.baseUnit}`; return cpb;
  }

  // Opens another recipe's own detail in place of this one (sub-recipe click-through).
  function openRecipeModalInternal(recipeId) {
    openRecipeModal(recipeId, { onChange: onChangeCb });
  }

  // ---------- Event wiring (once, at dialog creation) ----------
  function wireEvents() {
    document.getElementById('rm_close').addEventListener('click', () => dialogEl.close());
    dialogEl.addEventListener('click', (e) => { if (e.target === dialogEl) dialogEl.close(); });

    const titleWrap = document.getElementById('rm_titleWrap');
    titleWrap.addEventListener('click', (e) => {
      if (e.target.closest('#rm_title')) { editingName = true; renderTitle(); }
      else if (e.target.closest('#rm_name_save')) { commitRename(); }
      else if (e.target.closest('#rm_name_cancel')) { editingName = false; renderTitle(); }
    });
    titleWrap.addEventListener('keydown', (e) => {
      if (e.target.id !== 'rm_name_input') return;
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { editingName = false; renderTitle(); }
    });

    document.getElementById('rm_sc_target').addEventListener('input', renderScale);
    document.getElementById('rm_refreshCostsBtn').addEventListener('click', refreshLineCosts);
    document.getElementById('rm_deleteRecipeBtn').addEventListener('click', deleteRecipe);

    const linesBody = document.getElementById('rm_linesBody');
    linesBody.addEventListener('click', (e) => {
      const rm = e.target.closest('button[data-role="remove-line"]');
      const editSup = e.target.closest('button[data-role="edit-supplier"]');
      const cancelSup = e.target.closest('button[data-role="cancel-edit-supplier"]');
      const editQty = e.target.closest('button[data-role="edit-qty"]');
      const cancelQty = e.target.closest('button[data-role="cancel-edit-qty"]');
      const saveQty = e.target.closest('button[data-role="save-qty"]');
      const swapBtn = e.target.closest('button[data-role="swap-line"]');
      const cancelSwap = e.target.closest('button[data-role="cancel-swap"]');
      const swapOpt = e.target.closest('.search-dropdown[data-role="swap-dropdown"] .search-option');
      const newOpt = e.target.closest('.search-dropdown[data-role="new-line-dropdown"] .search-option');
      const clearNew = e.target.closest('button[data-role="new-line-clear"]');
      if (rm) removeLine(rm.dataset.id);
      else if (editSup) { editingSupplierLineId = editSup.dataset.id; renderLinesTable(); }
      else if (cancelSup) { editingSupplierLineId = null; renderLinesTable(); }
      else if (editQty) { editingQtyLineId = editQty.dataset.id; renderLinesTable(); }
      else if (cancelQty) { editingQtyLineId = null; renderLinesTable(); }
      else if (saveQty) saveQtyFromInputs(saveQty.dataset.id);
      else if (swapBtn) {
        editingComponentLineId = swapBtn.dataset.id;
        swapQuery = '';
        renderLinesTable();
        const input = document.querySelector(`input[data-role="swap-search"][data-id="${swapBtn.dataset.id}"]`);
        if (input) input.focus();
      }
      else if (cancelSwap) { editingComponentLineId = null; renderLinesTable(); }
      else if (swapOpt) {
        const lineId = swapOpt.closest('[data-role="swap-dropdown"]').dataset.id;
        const results = filterComponents(swapQuery);
        commitSwap(lineId, results[parseInt(swapOpt.dataset.idx, 10)]);
      }
      else if (newOpt) {
        const results = filterComponents(newLine.query);
        pickNewLineComponent(results[parseInt(newOpt.dataset.idx, 10)]);
      }
      else if (clearNew) { newLine = { query: '', pick: null, qty: '', unit: '', supplierId: '' }; renderLinesTable(); }
    });
    linesBody.addEventListener('change', (e) => {
      const sel = e.target.closest('select[data-role="supplier-edit-select"]');
      if (sel) { setLineSupplier(sel.dataset.id, sel.value); return; }
      const newUnitSel = e.target.closest('select[data-role="new-line-unit"]');
      if (newUnitSel) { newLine.unit = newUnitSel.value; updateNewLinePreview(); return; }
      const newSupSel = e.target.closest('select[data-role="new-line-supplier"]');
      if (newSupSel) { newLine.supplierId = newSupSel.value; updateNewLinePreview(); }
    });
    linesBody.addEventListener('input', (e) => {
      const swapInput = e.target.closest('input[data-role="swap-search"]');
      if (swapInput) {
        swapQuery = swapInput.value;
        const dropdown = swapInput.parentElement.querySelector('[data-role="swap-dropdown"]');
        dropdown.innerHTML = searchOptionsHTML(filterComponents(swapQuery));
        dropdown.hidden = false;
        return;
      }
      const newInput = e.target.closest('input[data-role="new-line-search"]');
      if (newInput) {
        newLine.query = newInput.value;
        const dropdown = newInput.parentElement.querySelector('[data-role="new-line-dropdown"]');
        dropdown.innerHTML = searchOptionsHTML(filterComponents(newLine.query));
        dropdown.hidden = false;
        return;
      }
      const qtyDraft = e.target.closest('input[data-role="new-line-qty"]');
      if (qtyDraft) { newLine.qty = qtyDraft.value === '' ? '' : parseFloat(qtyDraft.value); updateNewLinePreview(); }
    });
    linesBody.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches('input[data-role="qty-edit-input"]')) {
        e.preventDefault();
        saveQtyFromInputs(e.target.dataset.id);
        return;
      }
      if (e.key === 'Enter' && e.target.matches('input[data-role="new-line-qty"]')) {
        e.preventDefault();
        attemptCommitNewLine();
        return;
      }
      if (e.target.matches('input[data-role="new-line-search"], input[data-role="swap-search"]')) {
        const dropdown = e.target.parentElement.querySelector('.search-dropdown');
        if (!dropdown || dropdown.hidden) return;
        const options = Array.from(dropdown.querySelectorAll('.search-option'));
        let idx = options.findIndex(o => o.classList.contains('active'));
        if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, options.length - 1); options.forEach(o => o.classList.remove('active')); if (options[idx]) options[idx].classList.add('active'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); options.forEach(o => o.classList.remove('active')); if (options[idx]) options[idx].classList.add('active'); }
        else if (e.key === 'Escape') { dropdown.hidden = true; }
        else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); options[idx].click(); }
      }
    });
    linesBody.addEventListener('focusout', (e) => {
      const row = e.target.closest('tr.new-row');
      if (!row) return;
      setTimeout(() => { if (!row.contains(document.activeElement)) attemptCommitNewLine(); }, 0);
    });
    bindComponentLinks(linesBody);

    linesBody.addEventListener('dragstart', (e) => {
      const tr = e.target.closest('tr[draggable="true"]');
      if (!tr) return;
      draggingLineId = tr.dataset.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggingLineId);
      tr.classList.add('dragging');
    });
    linesBody.addEventListener('dragend', (e) => {
      const tr = e.target.closest('tr[draggable="true"]');
      if (tr) tr.classList.remove('dragging');
      document.querySelectorAll('#rm_linesBody tr.drop-above, #rm_linesBody tr.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
      draggingLineId = null;
    });
    linesBody.addEventListener('dragover', (e) => {
      const tr = e.target.closest('tr[draggable="true"]');
      if (!tr || !draggingLineId || tr.dataset.id === draggingLineId) return;
      e.preventDefault();
      const rect = tr.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      document.querySelectorAll('#rm_linesBody tr.drop-above, #rm_linesBody tr.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
      tr.classList.add(before ? 'drop-above' : 'drop-below');
    });
    linesBody.addEventListener('drop', (e) => {
      const tr = e.target.closest('tr[draggable="true"]');
      if (!tr || !draggingLineId || tr.dataset.id === draggingLineId) return;
      e.preventDefault();
      const before = tr.classList.contains('drop-above');
      document.querySelectorAll('#rm_linesBody tr.drop-above, #rm_linesBody tr.drop-below').forEach(el => el.classList.remove('drop-above', 'drop-below'));
      reorderLine(draggingLineId, tr.dataset.id, before);
    });

    // ---- Paste importer ----
    document.getElementById('rm_openPasteBtn').addEventListener('click', () => {
      if (!currentRecipe) return;
      document.getElementById('rmp_text').value = '';
      parsedRows = [];
      document.getElementById('rmp_reviewTable').style.display = 'none';
      document.getElementById('rmp_addParsedBtn').style.display = 'none';
      document.getElementById('rmp_summary').textContent = '';
      setStatus('rmp_status', '');
      renderIngredientDatalist();
      pasteDialogEl.showModal();
      pasteDialogGuard.arm();
    });
    document.getElementById('rmp_close').addEventListener('click', () => pasteDialogGuard.guardedClose());

    document.getElementById('rmp_parseBtn').addEventListener('click', () => {
      const text = document.getElementById('rmp_text').value;
      if (!text.trim()) { setStatus('rmp_status', 'Paste a recipe first.', 'error'); return; }
      buildParsed(text);
      setStatus('rmp_status', '');
      renderReview();
    });
    document.getElementById('rmp_addParsedBtn').addEventListener('click', doAddParsedLines);

    const reviewBody = document.getElementById('rmp_reviewBody');
    reviewBody.addEventListener('change', (e) => {
      const el = e.target; const idx = parseInt(el.dataset.idx, 10);
      if (isNaN(idx)) return;
      const m = parsedRows[idx];
      const role = el.dataset.role;
      if (role === 'include') { m.include = el.checked; renderReview(); return; }
      if (role === 'ingredient') {
        const typed = el.value.trim();
        const exact = ingredients.find(i => normName(i.name) === normName(typed));
        if (exact) {
          m.ingredientId = exact.id; m.name = exact.name; m.measureType = exact.measureType;
          if (!unitsForType(m.measureType).includes(m.unit)) m.unit = baseUnitFor(m.measureType);
          const cheap = cheapestSupplierFor(exact.id);
          m.supplierId = cheap ? cheap.id : '';
        } else {
          m.ingredientId = '__new__';
          m.name = typed || m.name;
        }
        renderReview(); return;
      }
      if (role === 'measure') { m.measureType = el.value; if (!unitsForType(m.measureType).includes(m.unit)) m.unit = baseUnitFor(m.measureType); renderReview(); return; }
      if (role === 'unit') { m.unit = el.value; document.getElementById('rmp_rcost_' + idx).textContent = rowCostText(m); return; }
      if (role === 'supplier') { m.supplierId = el.value; document.getElementById('rmp_rcost_' + idx).textContent = rowCostText(m); return; }
    });
    reviewBody.addEventListener('input', (e) => {
      if (e.target.dataset.role !== 'qty') return;
      const idx = parseInt(e.target.dataset.idx, 10);
      parsedRows[idx].qty = e.target.value === '' ? null : parseFloat(e.target.value);
      document.getElementById('rmp_rcost_' + idx).textContent = rowCostText(parsedRows[idx]);
    });
    reviewBody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-role="link"]');
      if (btn) openLinkDialog(parseInt(btn.dataset.idx, 10));
    });

    document.getElementById('rml_close').addEventListener('click', () => linkDialogGuard.guardedClose());
    document.getElementById('rml_cancelBtn').addEventListener('click', () => linkDialogGuard.guardedClose());
    ['rml_packsize', 'rml_packunit', 'rml_price'].forEach(id => document.getElementById(id).addEventListener('input', recalcLinkCost));

    document.getElementById('rml_form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const m = parsedRows[linkIdx]; const ing = m ? ingredientById(m.ingredientId) : null;
      if (!ing) return;
      const supplierId = document.getElementById('rml_supplier').value;
      const ps = parseFloat(document.getElementById('rml_packsize').value);
      const pu = document.getElementById('rml_packunit').value;
      const pr = parseFloat(document.getElementById('rml_price').value);
      if (!supplierId || !ps || !pu || !pr) { setStatus('rml_status', 'All fields are required.', 'error'); return; }
      const cpb = recalcLinkCost();
      if (cpb == null) { setStatus('rml_status', 'Could not calculate cost.', 'error'); return; }
      const cfg = getStoredConfig();
      setStatus('rml_status', 'Saving...');
      try {
        const existing = await sheetsGet(cfg.spreadsheetId, SI_RANGE, token);
        const rows = existing.length ? existing : [SI_HEADERS];
        const id = nextId(rows, 'SI');
        await sheetsAppend(cfg.spreadsheetId, SI_RANGE, [id, ing.id, supplierId, ps, pu, pr.toFixed(2), cpb.toFixed(4)], token);
        const siRows2 = await sheetsGet(cfg.spreadsheetId, SI_RANGE, token);
        supplierIngredients = (siRows2.slice(1) || []).map(r => ({
          id: r[0], ingredientId: r[1], supplierId: r[2],
          packSize: parseFloat(r[3]) || 0, packUnit: r[4],
          price: parseFloat(r[5]) || 0, costPerBase: parseFloat(r[6]) || 0
        })).filter(s => s.id);
        m.supplierId = id;
        linkDialogEl.close();
        renderReview();
      } catch (err) {
        setStatus('rml_status', 'Error: ' + err.message, 'error');
      }
    });
  }

  // Public entry point.
  window.openRecipeModal = async function (recipeId, opts) {
    const cfg = getStoredConfig();
    token = tryResumeSession();
    if (!token || !cfg.spreadsheetId) { alert('Please sign in on the Dashboard first.'); return; }
    onChangeCb = (opts && opts.onChange) || null;

    ensureDialogs();
    editingComponentLineId = null;
    editingSupplierLineId = null;
    editingQtyLineId = null;
    editingName = false;
    newLine = { query: '', pick: null, qty: '', unit: '', supplierId: '' };
    setStatus('rm_ln_status', 'Loading...');
    if (!dialogEl.open) dialogEl.showModal();

    try {
      await loadAllLookups(cfg.spreadsheetId);
      currentRecipe = recipesAll.find(r => r.id === recipeId) || null;
      if (!currentRecipe) { setStatus('rm_ln_status', 'Could not find that recipe — it may have been deleted.', 'error'); return; }
      renderRecipeDetail();
      await loadLines(cfg.spreadsheetId);
      setStatus('rm_ln_status', '');
    } catch (err) {
      setStatus('rm_ln_status', 'Error loading: ' + err.message, 'error');
    }
  };
})();
