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
  const value = Number(prompt("Valor da renda:"));
  db.months[currentMonth].incomes.push({ value });
  persist();
}

function addExpense() {
  const value = Number(prompt("Valor da conta:"));
  const fixed = confirm("É conta fixa?");
  db.months[currentMonth].expenses.push({ value, fixed });
  persist();
}

function render() {
  const month = db.months[currentMonth];
  const income = month.incomes.reduce((a, b) => a + b.value, 0);
  const expense = month.expenses.reduce((a, b) => a + b.value, 0);

  document.getElementById("totalIncome").innerText = income.toFixed(2);
  document.getElementById("totalExpense").innerText = expense.toFixed(2);
  document.getElementById("balance").innerText = (income - expense).toFixed(2);
}

function persist() {
  saveLocalData(db);
  saveToDrive(db);
  render();
}
