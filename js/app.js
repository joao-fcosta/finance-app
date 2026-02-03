let db = loadLocalData();
let currentMonth = null;

function initApp() {
  const input = document.getElementById("monthSelector");
  input.value = new Date().toISOString().slice(0, 7);
  changeMonth(input.value);
  input.onchange = e => changeMonth(e.target.value);
}

function changeMonth(month) {
  currentMonth = month;
  if (!db.months[month]) {
    db.months[month] = {
      incomes: [],
      expenses: []
    };
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

  const list = document.getElementById("entries");
  list.innerHTML = "";

  month.incomes.forEach(i =>
    list.innerHTML += `<li>Renda: R$ ${i.value}</li>`
  );
  month.expenses.forEach(e =>
    list.innerHTML += `<li>Conta: R$ ${e.value} ${e.fixed ? "(Fixa)" : ""}</li>`
  );
}

function persist() {
  saveLocalData(db);
  render();
}
