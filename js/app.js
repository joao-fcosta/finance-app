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
