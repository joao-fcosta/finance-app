let db = null;
let currentMonth = null;

async function initApp() {
  // tenta carregar do Drive
  const driveData = await loadFromDrive();

  if (driveData) {
    db = driveData;
    console.log("✔ Dados carregados do Drive");
  } else {
    db = loadLocalData() || defaultData();
    console.log("✔ Nenhum arquivo no Drive, usando dados locais");
    await saveToDrive(db);
  }

  saveLocalData(db);

  const input = document.getElementById("monthSelector");
  input.value = new Date().toISOString().slice(0, 7);
  changeMonth(input.value);
  input.onchange = e => changeMonth(e.target.value);
}

function changeMonth(month) {
  currentMonth = month;
  if (!db.months[month]) {
    db.months[month] = { incomes: [], expenses: [] };
  }
  render();
}

function addIncome() {
  const name = prompt("Nome da renda:");
  if (!name) return alert("Nome é obrigatório");

  const value = Number(prompt("Valor:"));
  const fixed = confirm("É renda fixa?");

  db.months[currentMonth].incomes.push({
    id: crypto.randomUUID(),
    name,
    value,
    type: fixed ? "fixed" : "single"
  });

  if (fixed) replicateIncome(name, value);
  persist();
}


function addExpense() {
  const name = prompt("Nome da despesa:");
  if (!name) return alert("Nome é obrigatório");

  const value = Number(prompt("Valor:"));
  const fixed = confirm("É despesa fixa?");

  let expense = {
    id: crypto.randomUUID(),
    name,
    value,
    type: fixed ? "fixed" : "variable"
  };

  if (!fixed) {
    const parcelado = confirm("É parcelado?");
    if (parcelado) {
      const total = Number(prompt("Quantidade de parcelas:"));
      expense.installment = { current: 1, total };
      replicateInstallment(expense);
    }
  }

  db.months[currentMonth].expenses.push(expense);

  if (fixed) replicateExpense(name, value);
  persist();
}

function nextMonths(startMonth) {
  const [y, m] = startMonth.split("-").map(Number);
  let months = [];
  for (let i = m + 1; i <= 12; i++) {
    months.push(`${y}-${String(i).padStart(2, "0")}`);
  }
  return months;
}

function replicateIncome(name, value) {
  nextMonths(currentMonth).forEach(month => {
    if (!db.months[month]) {
      db.months[month] = { incomes: [], expenses: [] };
    }

    db.months[month].incomes.push({
      id: crypto.randomUUID(),
      name,
      value,
      type: "fixed"
    });
  });
}

function replicateExpense(name, value) {
  nextMonths(currentMonth).forEach(month => {
    if (!db.months[month]) {
      db.months[month] = { incomes: [], expenses: [] };
    }

    db.months[month].expenses.push({
      id: crypto.randomUUID(),
      name,
      value,
      type: "fixed"
    });
  });
}

function replicateInstallment(expense) {
  let count = expense.installment.total;
  let months = nextMonths(currentMonth);

  months.slice(0, count - 1).forEach((month, i) => {
    if (!db.months[month]) {
      db.months[month] = { incomes: [], expenses: [] };
    }

    db.months[month].expenses.push({
      ...expense,
      id: crypto.randomUUID(),
      installment: {
        current: i + 2,
        total: expense.installment.total
      }
    });
  });
}

function deleteIncome(id) {
  const month = db.months[currentMonth];
  month.incomes = month.incomes.filter(i => i.id !== id);
  saveToDrive();
  render();
}

function deleteExpense(id) {
  const month = db.months[currentMonth];
  month.expenses = month.expenses.filter(e => e.id !== id);
  saveToDrive();
  render();
}

function editIncome(id) {
  const month = db.months[currentMonth];
  const income = month.incomes.find(i => i.id === id);

  const name = prompt("Nome da renda", income.name);
  const value = Number(prompt("Valor", income.value));

  if (!name || value <= 0) return;

  income.name = name;
  income.value = value;

  saveToDrive();
  render();
}

function editExpense(id) {
  const month = db.months[currentMonth];
  const expense = month.expenses.find(e => e.id === id);

  const name = prompt("Nome da despesa", expense.name);
  const value = Number(prompt("Valor", expense.value));

  if (!name || value <= 0) return;

  expense.name = name;
  expense.value = value;

  saveToDrive();
  render();
}

function render() {
  const month = db.months[currentMonth];

  const incomeList = document.getElementById("incomeList");
  const expenseList = document.getElementById("expenseList");

  incomeList.innerHTML = "";
  expenseList.innerHTML = "";

  let totalIncome = 0;
  let totalExpense = 0;

  month.incomes.forEach((i, index) => {
    totalIncome += i.value;

    incomeList.innerHTML += `
      <li>
        <span>
          ${i.name}
          ${i.type === "fixed" ? "(Fixa)" : "(Única)"}
        </span>
        <strong style="color:#16a34a">
          + R$ ${i.value.toFixed(2)}
        </strong>
        <div class="actions-inline">
          <button onclick="editIncome('${i.id}')">✏️</button>
          <button onclick="deleteIncome('${i.id}')">🗑️</button>
        </div>
      </li>
    `;
  });

  month.expenses.forEach((e, index) => {
    totalExpense += e.value;

    expenseList.innerHTML += `
      <li>
        <span>
          ${e.name}
          ${e.type === "fixed" ? "(Fixa)" : "(Variável)"}
          ${e.installment ? `(${e.installment.current}/${e.installment.total})` : ""}
        </span>
        <strong style="color:#dc2626">
          - R$ ${e.value.toFixed(2)}
        </strong>
        <div class="actions-inline">
          <button onclick="editExpense('${e.id}')">✏️</button>
          <button onclick="deleteExpense('${e.id}')">🗑️</button>
        </div>
      </li>
    `;
  });

  document.getElementById("totalIncome").innerText =
    totalIncome.toFixed(2);

  document.getElementById("totalExpense").innerText =
    totalExpense.toFixed(2);

  document.getElementById("balance").innerText =
    (totalIncome - totalExpense).toFixed(2);
}

function persist() {
  saveLocalData(db);
  saveToDrive(db);
  render();
}
