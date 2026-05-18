const DESCRIPTION_HISTORY_KEY = 'pos_desc_history';

const state = {
  token: localStorage.getItem('pos_token') || '',
  user: null,
  users: [],
  categories: [],
  transactions: [],
  descriptionHistory: [],
  suggestedDate: '',
  lastKnownDay: ''
};

const el = {
  loginView: document.getElementById('login-view'),
  appView: document.getElementById('app-view'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  welcomeText: document.getElementById('welcome-text'),
  refreshBtn: document.getElementById('refresh-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  totalIncome: document.getElementById('total-income'),
  totalExpense: document.getElementById('total-expense'),
  totalBalance: document.getElementById('total-balance'),
  archiveCard: document.getElementById('admin-archive-card'),
  archiveToggle: document.getElementById('archive-toggle'),
  filterForm: document.getElementById('filter-form'),
  filterFrom: document.getElementById('filter-from'),
  filterTo: document.getElementById('filter-to'),
  filterType: document.getElementById('filter-type'),
  filterSearch: document.getElementById('filter-search'),
  transactionForm: document.getElementById('transaction-form'),
  txnType: document.getElementById('txn-type'),
  txnItemType: document.getElementById('txn-item-type'),
  txnCategory: document.getElementById('txn-category'),
  txnDate: document.getElementById('txn-date'),
  txnDateHint: document.getElementById('txn-date-hint'),
  txnQty: document.getElementById('txn-qty'),
  txnUnitPrice: document.getElementById('txn-unit-price'),
  txnAmount: document.getElementById('txn-amount'),
  txnReceipt: document.getElementById('txn-receipt'),
  txnDescription: document.getElementById('txn-description'),
  descriptionSuggestions: document.getElementById('description-suggestions'),
  txnFeedback: document.getElementById('txn-feedback'),
  usersCard: document.getElementById('admin-users-card'),
  categoriesCard: document.getElementById('admin-categories-card'),
  userForm: document.getElementById('user-form'),
  userName: document.getElementById('user-name'),
  userUsername: document.getElementById('user-username'),
  userPassword: document.getElementById('user-password'),
  userRole: document.getElementById('user-role'),
  userFeedback: document.getElementById('user-feedback'),
  resetFeedback: document.getElementById('reset-feedback'),
  usersTableBody: document.getElementById('users-table-body'),
  categoryForm: document.getElementById('category-form'),
  categoryName: document.getElementById('category-name'),
  categoryType: document.getElementById('category-type'),
  categoryFeedback: document.getElementById('category-feedback'),
  transactionsTitle: document.getElementById('transactions-title'),
  transactionsTableBody: document.getElementById('transactions-table-body')
};

const tanzaniaCurrency = new Intl.NumberFormat('sw-TZ', {
  style: 'currency',
  currency: 'TZS',
  maximumFractionDigits: 0
});

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isAdmin() {
  return state.user && state.user.role === 'admin';
}

function archiveEnabled() {
  return isAdmin() && !!el.archiveToggle.checked;
}

function currency(value) {
  return tanzaniaCurrency.format(Number(value || 0));
}

function typeLabel(type) {
  return type === 'income' ? 'Mapato' : 'Matumizi';
}

function itemTypeLabel(itemType) {
  const labels = {
    spare: 'Vipuri',
    service: 'Huduma',
    other_income: 'Mapato Mengine',
    other_expense: 'Matumizi Mengine'
  };
  return labels[itemType] || itemType;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadDescriptionHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DESCRIPTION_HISTORY_KEY) || '[]');
    if (Array.isArray(parsed)) {
      state.descriptionHistory = parsed.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 30);
    }
  } catch (_err) {
    state.descriptionHistory = [];
  }
}

function saveDescriptionHistory() {
  localStorage.setItem(DESCRIPTION_HISTORY_KEY, JSON.stringify(state.descriptionHistory.slice(0, 30)));
}

function addDescriptionHistory(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return;

  state.descriptionHistory = [normalized, ...state.descriptionHistory.filter((item) => item !== normalized)].slice(0, 30);
  saveDescriptionHistory();
  renderDescriptionSuggestions();
}

function mergeDescriptionsFromTransactions() {
  for (const tx of state.transactions) {
    if (tx.description) addDescriptionHistory(tx.description);
  }
}

function renderDescriptionSuggestions() {
  el.descriptionSuggestions.innerHTML = state.descriptionHistory
    .map((desc) => `<option value="${escapeHtml(desc)}"></option>`)
    .join('');
}

function setSuggestedDate() {
  const today = todayISO();
  state.suggestedDate = today;
  state.lastKnownDay = today;
  el.txnDate.value = today;
  el.txnDateHint.textContent = `Pendekezo la tarehe: ${today}`;
}

function queryForDateFilter() {
  const query = new URLSearchParams();

  if (isAdmin() && archiveEnabled()) {
    query.set('includeArchive', '1');
    if (el.filterFrom.value) query.set('from', el.filterFrom.value);
    if (el.filterTo.value) query.set('to', el.filterTo.value);
    if (el.filterType.value) query.set('type', el.filterType.value);
    if (el.filterSearch.value.trim()) query.set('search', el.filterSearch.value.trim());
  } else {
    const today = todayISO();
    query.set('from', today);
    query.set('to', today);
  }

  return query;
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Ombi limeshindwa');
  return data;
}

function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('pos_token', token);
}

function clearAuth() {
  state.token = '';
  state.user = null;
  localStorage.removeItem('pos_token');
}

function applyRoleView() {
  if (isAdmin()) {
    document.body.classList.remove('staff-mode');
    el.archiveCard.classList.remove('hidden');
    el.usersCard.classList.remove('hidden');
    el.categoriesCard.classList.remove('hidden');
  } else {
    document.body.classList.add('staff-mode');
    el.archiveCard.classList.add('hidden');
    el.usersCard.classList.add('hidden');
    el.categoriesCard.classList.add('hidden');
  }
}

function updateTransactionsTitle() {
  if (archiveEnabled()) {
    el.transactionsTitle.textContent = 'Miamala ya Kumbukumbu';
  } else {
    el.transactionsTitle.textContent = 'Miamala ya Leo';
  }
}

function updateCategoryOptions() {
  const type = el.txnType.value;
  const options = state.categories.filter((cat) => cat.type === type);
  el.txnCategory.innerHTML = options.map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join('');
}

function renderTransactions() {
  const admin = isAdmin();

  el.transactionsTableBody.innerHTML = state.transactions
    .map((tx) => {
      const actions = [
        `<button data-receipt="${tx.id}" class="secondary small-btn">Print</button>`
      ];

      if (admin) {
        actions.push(`<button data-edit-transaction="${tx.id}" class="small-btn">Hariri</button>`);
      }

      return `
      <tr>
        <td>${escapeHtml(tx.transaction_date)}</td>
        <td>${escapeHtml(tx.receipt_no)}</td>
        <td>${typeLabel(tx.type)}</td>
        <td>${itemTypeLabel(tx.item_type)}</td>
        <td>${escapeHtml(tx.category_name)}</td>
        <td>${escapeHtml(tx.description || '')}</td>
        <td>${currency(tx.amount)}</td>
        <td>${escapeHtml(tx.user_name)}</td>
        <td class="row-actions">${actions.join(' ')}</td>
      </tr>
    `;
    })
    .join('');

  el.transactionsTableBody.querySelectorAll('button[data-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tx = state.transactions.find((item) => String(item.id) === String(btn.dataset.receipt));
      if (tx) printReceipt(tx);
    });
  });

  el.transactionsTableBody.querySelectorAll('button[data-edit-transaction]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const tx = state.transactions.find((item) => String(item.id) === String(btn.dataset.editTransaction));
      if (!tx) return;

      const amount = window.prompt('Weka kiasi kipya (TSh):', String(tx.amount));
      if (amount === null) return;
      const description = window.prompt('Weka maelezo mapya:', tx.description || '');
      if (description === null) return;
      const date = window.prompt('Weka tarehe (YYYY-MM-DD):', tx.transaction_date);
      if (date === null) return;

      try {
        await api(`/api/transactions/${tx.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            type: tx.type,
            itemType: tx.item_type,
            categoryId: tx.category_id,
            quantity: tx.quantity,
            unitPrice: tx.unit_price,
            amount,
            receiptNo: tx.receipt_no,
            transactionDate: date.trim() || tx.transaction_date,
            description: description.trim()
          })
        });

        el.txnFeedback.classList.remove('error');
        el.txnFeedback.textContent = 'Muamala umehaririwa.';
        await Promise.all([loadTransactions(), loadSummary()]);
      } catch (error) {
        el.txnFeedback.classList.add('error');
        el.txnFeedback.textContent = error.message;
      }
    });
  });
}

function renderUsers() {
  el.usersTableBody.innerHTML = state.users
    .map((user) => {
      let actions = '<span class="muted">-</span>';

      if (user.role === 'staff') {
        actions = `
          <button class="secondary small-btn" data-reset-user="${user.id}" data-username="${escapeHtml(user.username)}">Nenosiri Jipya</button>
          <button class="small-btn" data-edit-user="${user.id}">Hariri</button>
          <button class="danger small-btn" data-remove-user="${user.id}">Ondoa</button>
        `;
      }

      return `<tr><td>${user.id}</td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.role)}</td><td>Hai</td><td class="row-actions">${actions}</td></tr>`;
    })
    .join('');

  el.usersTableBody.querySelectorAll('button[data-reset-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = Number(btn.dataset.resetUser);
      const username = btn.dataset.username;
      const input = window.prompt(`Weka nenosiri jipya kwa ${username}. Ukiacha wazi, litatengenezwa moja kwa moja.`);
      if (input === null) return;

      try {
        const payload = {};
        if (input.trim()) payload.newPassword = input.trim();

        const data = await api(`/api/users/${userId}/reset-password`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        el.resetFeedback.classList.remove('error');
        el.resetFeedback.textContent = `Nenosiri jipya la ${data.user.username}: ${data.temporaryPassword}`;
      } catch (error) {
        el.resetFeedback.classList.add('error');
        el.resetFeedback.textContent = error.message;
      }
    });
  });

  el.usersTableBody.querySelectorAll('button[data-edit-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = Number(btn.dataset.editUser);
      const user = state.users.find((item) => item.id === userId);
      if (!user) return;

      const newName = window.prompt('Hariri jina la staff:', user.name);
      if (newName === null) return;
      const newUsername = window.prompt('Hariri username ya staff:', user.username);
      if (newUsername === null) return;

      try {
        await api(`/api/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ name: newName.trim(), username: newUsername.trim() })
        });

        el.resetFeedback.classList.remove('error');
        el.resetFeedback.textContent = 'Taarifa za staff zimehaririwa.';
        await loadUsersIfAdmin();
      } catch (error) {
        el.resetFeedback.classList.add('error');
        el.resetFeedback.textContent = error.message;
      }
    });
  });

  el.usersTableBody.querySelectorAll('button[data-remove-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = Number(btn.dataset.removeUser);
      const confirmed = window.confirm('Una uhakika unataka kuondoa staff huyu?');
      if (!confirmed) return;

      try {
        await api(`/api/users/${userId}`, { method: 'DELETE' });
        el.resetFeedback.classList.remove('error');
        el.resetFeedback.textContent = 'Staff ameondolewa kabisa.';
        await loadUsersIfAdmin();
      } catch (error) {
        el.resetFeedback.classList.add('error');
        el.resetFeedback.textContent = error.message;
      }
    });
  });
}

function printReceipt(tx) {
  const html = `
    <html>
      <head>
        <title>Risiti ${tx.receipt_no}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h2 { margin-bottom: 8px; }
          p { margin: 4px 0; }
        </style>
      </head>
      <body>
        <h2>Risiti - Jorecla Shop</h2>
        <p><b>Namba ya Risiti:</b> ${escapeHtml(tx.receipt_no)}</p>
        <p><b>Tarehe:</b> ${escapeHtml(tx.transaction_date)}</p>
        <p><b>Aina:</b> ${typeLabel(tx.type)}</p>
        <p><b>Kipengele:</b> ${itemTypeLabel(tx.item_type)}</p>
        <p><b>Kundi:</b> ${escapeHtml(tx.category_name)}</p>
        <p><b>Maelezo:</b> ${escapeHtml(tx.description || '')}</p>
        <p><b>Kiasi:</b> ${currency(tx.amount)}</p>
        <p><b>Aliyeweka:</b> ${escapeHtml(tx.user_name)}</p>
      </body>
    </html>
  `;

  const printWindow = window.open('', '_blank');
  if (!printWindow) return;
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function loadUsersIfAdmin() {
  if (!isAdmin()) return;
  const usersRes = await api('/api/users');
  state.users = usersRes.users;
  renderUsers();
}

async function loadSummary() {
  const query = queryForDateFilter();
  const data = await api(`/api/reports/summary?${query.toString()}`);

  el.totalIncome.textContent = currency(data.totals.income);
  el.totalExpense.textContent = currency(data.totals.expense);
  el.totalBalance.textContent = currency(data.totals.balance);
}

async function loadTransactions() {
  const query = queryForDateFilter();
  const data = await api(`/api/transactions?${query.toString()}`);
  state.transactions = data.transactions;
  mergeDescriptionsFromTransactions();
  renderTransactions();
}

async function loadCategories() {
  const data = await api('/api/categories');
  state.categories = data.categories;
  updateCategoryOptions();
}

async function refreshAll() {
  updateTransactionsTitle();
  await Promise.all([loadTransactions(), loadSummary(), loadUsersIfAdmin()]);
}

function startAutoRefresh() {
  setInterval(async () => {
    const nowDay = todayISO();
    if (state.lastKnownDay !== nowDay) {
      state.lastKnownDay = nowDay;
      if (!archiveEnabled()) {
        setSuggestedDate();
      }
    }

    try {
      await refreshAll();
    } catch (_err) {
      // no-op
    }
  }, 60000);
}

async function bootstrapApp() {
  const me = await api('/api/auth/me');
  state.user = me.user;
  applyRoleView();
  el.welcomeText.textContent = `${state.user.name} (${state.user.role})`;

  setSuggestedDate();
  await Promise.all([loadCategories(), refreshAll()]);

  el.loginView.classList.add('hidden');
  el.appView.classList.remove('hidden');
}

el.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.loginError.textContent = '';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: el.loginUsername.value.trim(),
        password: el.loginPassword.value
      })
    });

    setAuth(data.token, data.user);
    await bootstrapApp();
    el.loginForm.reset();
  } catch (error) {
    el.loginError.textContent = error.message;
  }
});

el.logoutBtn.addEventListener('click', () => {
  clearAuth();
  document.body.classList.remove('staff-mode');
  el.appView.classList.add('hidden');
  el.loginView.classList.remove('hidden');
});

el.refreshBtn.addEventListener('click', async () => {
  await refreshAll();
});

el.archiveToggle.addEventListener('change', async () => {
  if (!archiveEnabled()) {
    el.filterFrom.value = '';
    el.filterTo.value = '';
    el.filterType.value = '';
    el.filterSearch.value = '';
  }

  await refreshAll();
});

el.txnType.addEventListener('change', () => {
  updateCategoryOptions();
});

function autoAmountFromQtyPrice() {
  const qty = Number(el.txnQty.value || 0);
  const unit = Number(el.txnUnitPrice.value || 0);
  if (qty > 0 && unit > 0) {
    el.txnAmount.value = (qty * unit).toFixed(2);
  }
}

el.txnQty.addEventListener('input', autoAmountFromQtyPrice);
el.txnUnitPrice.addEventListener('input', autoAmountFromQtyPrice);

el.transactionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.txnFeedback.textContent = '';
  el.txnFeedback.classList.remove('error');

  try {
    const description = el.txnDescription.value.trim();

    await api('/api/transactions', {
      method: 'POST',
      body: JSON.stringify({
        type: el.txnType.value,
        itemType: el.txnItemType.value,
        categoryId: Number(el.txnCategory.value),
        description,
        quantity: el.txnQty.value,
        unitPrice: el.txnUnitPrice.value,
        amount: el.txnAmount.value,
        receiptNo: el.txnReceipt.value.trim(),
        transactionDate: el.txnDate.value || state.suggestedDate
      })
    });

    addDescriptionHistory(description);
    el.txnFeedback.textContent = 'Muamala umehifadhiwa.';

    el.transactionForm.reset();
    el.txnType.value = 'income';
    setSuggestedDate();
    updateCategoryOptions();

    await Promise.all([loadTransactions(), loadSummary()]);
  } catch (error) {
    el.txnFeedback.textContent = error.message;
    el.txnFeedback.classList.add('error');
  }
});

el.filterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await Promise.all([loadTransactions(), loadSummary()]);
});

el.userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.userFeedback.textContent = '';
  el.userFeedback.classList.remove('error');

  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        name: el.userName.value.trim(),
        username: el.userUsername.value.trim(),
        password: el.userPassword.value,
        role: el.userRole.value
      })
    });

    el.userFeedback.textContent = 'Mtumiaji ametengenezwa.';
    el.userForm.reset();
    await loadUsersIfAdmin();
  } catch (error) {
    el.userFeedback.textContent = error.message;
    el.userFeedback.classList.add('error');
  }
});

el.categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  el.categoryFeedback.textContent = '';
  el.categoryFeedback.classList.remove('error');

  try {
    await api('/api/categories', {
      method: 'POST',
      body: JSON.stringify({
        name: el.categoryName.value.trim(),
        type: el.categoryType.value
      })
    });

    el.categoryFeedback.textContent = 'Kundi limeongezwa.';
    el.categoryForm.reset();
    await loadCategories();
  } catch (error) {
    el.categoryFeedback.textContent = error.message;
    el.categoryFeedback.classList.add('error');
  }
});

(function init() {
  loadDescriptionHistory();
  renderDescriptionSuggestions();
  startAutoRefresh();

  if (!state.token) return;

  bootstrapApp().catch(() => {
    clearAuth();
  });
})();
