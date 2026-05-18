const DESCRIPTION_HISTORY_KEY = 'pos_desc_history';

const state = {
  token: localStorage.getItem('pos_token') || '',
  user: null,
  users: [],
  categories: [],
  transactions: [],
  descriptionHistory: [],
  suggestedDate: ''
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
  filtersSection: document.getElementById('filters-section'),
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
  transactionsTableBody: document.getElementById('transactions-table-body')
};

const tanzaniaCurrency = new Intl.NumberFormat('en-TZ', {
  style: 'currency',
  currency: 'TZS',
  maximumFractionDigits: 0
});

function currency(value) {
  return tanzaniaCurrency.format(Number(value || 0));
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
    .map((desc) => `<option value="${desc.replace(/"/g, '&quot;')}"></option>`)
    .join('');
}

function setSuggestedDate() {
  const today = new Date().toISOString().slice(0, 10);
  const latest = state.transactions.length > 0 ? state.transactions[0].transaction_date : '';

  state.suggestedDate = today;
  if (!el.txnDate.value) {
    el.txnDate.value = state.suggestedDate;
  }

  if (latest && latest !== today) {
    el.txnDateHint.textContent = `Suggested date: ${today} (latest saved: ${latest})`;
  } else {
    el.txnDateHint.textContent = `Suggested date: ${today}`;
  }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }
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
  const isAdmin = state.user && state.user.role === 'admin';

  if (isAdmin) {
    el.filtersSection.classList.remove('hidden');
    el.usersCard.classList.remove('hidden');
    el.categoriesCard.classList.remove('hidden');
    document.body.classList.remove('staff-mode');
  } else {
    el.filtersSection.classList.add('hidden');
    el.usersCard.classList.add('hidden');
    el.categoriesCard.classList.add('hidden');
    document.body.classList.add('staff-mode');
  }
}

function updateCategoryOptions() {
  const type = el.txnType.value;
  const options = state.categories.filter((cat) => cat.type === type);
  el.txnCategory.innerHTML = options.map((cat) => `<option value="${cat.id}">${cat.name}</option>`).join('');
}

function renderTransactions() {
  el.transactionsTableBody.innerHTML = state.transactions
    .map(
      (tx) => `
      <tr>
        <td>${tx.transaction_date}</td>
        <td>${tx.receipt_no}</td>
        <td>${tx.type}</td>
        <td>${tx.item_type}</td>
        <td>${tx.category_name}</td>
        <td>${tx.description || ''}</td>
        <td>${currency(tx.amount)}</td>
        <td>${tx.user_name}</td>
        <td><button data-receipt="${tx.id}" class="secondary">Print</button></td>
      </tr>
    `
    )
    .join('');

  el.transactionsTableBody.querySelectorAll('button[data-receipt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tx = state.transactions.find((item) => String(item.id) === String(btn.dataset.receipt));
      if (tx) printReceipt(tx);
    });
  });
}

function renderUsers() {
  el.usersTableBody.innerHTML = state.users
    .map((user) => {
      const action =
        user.role === 'staff'
          ? `<button class="secondary small-btn" data-reset-user="${user.id}" data-username="${user.username}">Reset Password</button>`
          : '<span class="muted">-</span>';

      return `<tr><td>${user.id}</td><td>${user.name}</td><td>${user.username}</td><td>${user.role}</td><td>${action}</td></tr>`;
    })
    .join('');

  el.usersTableBody.querySelectorAll('button[data-reset-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const userId = Number(btn.dataset.resetUser);
      const username = btn.dataset.username;
      const input = window.prompt(`Set new password for ${username}. Leave empty to auto-generate a secure one.`);
      if (input === null) return;

      try {
        const payload = {};
        if (input.trim()) payload.newPassword = input.trim();

        const data = await api(`/api/users/${userId}/reset-password`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        el.resetFeedback.classList.remove('error');
        el.resetFeedback.textContent = `New password for ${data.user.username}: ${data.temporaryPassword}`;
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
        <title>Receipt ${tx.receipt_no}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          h2 { margin-bottom: 8px; }
          p { margin: 4px 0; }
        </style>
      </head>
      <body>
        <h2>Jorecla Shop Receipt</h2>
        <p><b>Receipt No:</b> ${tx.receipt_no}</p>
        <p><b>Date:</b> ${tx.transaction_date}</p>
        <p><b>Type:</b> ${tx.type}</p>
        <p><b>Item:</b> ${tx.item_type}</p>
        <p><b>Category:</b> ${tx.category_name}</p>
        <p><b>Description:</b> ${tx.description || ''}</p>
        <p><b>Amount:</b> ${currency(tx.amount)}</p>
        <p><b>Recorded By:</b> ${tx.user_name}</p>
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
  if (state.user.role !== 'admin') return;

  const usersRes = await api('/api/users');
  state.users = usersRes.users;
  renderUsers();
}

async function loadSummary() {
  const query = new URLSearchParams();

  if (state.user.role === 'admin') {
    if (el.filterFrom.value) query.set('from', el.filterFrom.value);
    if (el.filterTo.value) query.set('to', el.filterTo.value);
  }

  const data = await api(`/api/reports/summary?${query.toString()}`);

  el.totalIncome.textContent = currency(data.totals.income);
  el.totalExpense.textContent = currency(data.totals.expense);
  el.totalBalance.textContent = currency(data.totals.balance);
}

async function loadTransactions() {
  const query = new URLSearchParams();

  if (state.user.role === 'admin') {
    if (el.filterFrom.value) query.set('from', el.filterFrom.value);
    if (el.filterTo.value) query.set('to', el.filterTo.value);
    if (el.filterType.value) query.set('type', el.filterType.value);
    if (el.filterSearch.value.trim()) query.set('search', el.filterSearch.value.trim());
  }

  const data = await api(`/api/transactions?${query.toString()}`);
  state.transactions = data.transactions;
  mergeDescriptionsFromTransactions();
  setSuggestedDate();
  renderTransactions();
}

async function loadCategories() {
  const data = await api('/api/categories');
  state.categories = data.categories;
  updateCategoryOptions();
}

async function bootstrapApp() {
  const me = await api('/api/auth/me');
  state.user = me.user;
  applyRoleView();
  el.welcomeText.textContent = `${state.user.name} (${state.user.role})`;

  el.txnDate.value = new Date().toISOString().slice(0, 10);

  await Promise.all([loadCategories(), loadTransactions(), loadSummary(), loadUsersIfAdmin()]);

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
  await Promise.all([loadTransactions(), loadSummary(), loadUsersIfAdmin()]);
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
    el.txnFeedback.textContent = 'Transaction saved successfully.';
    el.transactionForm.reset();
    el.txnType.value = 'income';
    el.txnDate.value = state.suggestedDate || new Date().toISOString().slice(0, 10);
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
    el.userFeedback.textContent = 'User created successfully.';
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

    el.categoryFeedback.textContent = 'Category added successfully.';
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

  if (!state.token) return;

  bootstrapApp().catch(() => {
    clearAuth();
  });
})();
