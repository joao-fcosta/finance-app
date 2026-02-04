let db = null;
let currentMonth = null;

// --- INICIALIZAÇÃO ---
async function initApp() {
    const isLocalHost = location.pathname === "/index.html" || location.hostname === "127.0.0.1" || location.port === "5500";
    console.log(location.host);
    let driveData = null;

    if (isLocalHost) {
        try {
            const res = await fetch("finance.json");
            if (res.ok) {
                driveData = await res.json();
                console.log("🛠️ [Debug] Dados de finance.json");
            }
        } catch (err) { console.info("💡 Sem finance.json local."); }
    } else {
        try {
            driveData = await loadFromDrive();
        } catch (err) { console.error("❌ Erro Drive:", err); }
    }

    db = driveData || loadLocalData() || { months: {} };
    
    // Configuração inicial da data
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

// --- ADICIONAR DADOS ---
function addIncome() {
    const name = prompt("Nome da renda:");
    if (!name) return;
    const value = parseFloat(prompt("Valor:").replace(',', '.'));
    if (isNaN(value)) return;
    
    const fixed = confirm("É renda fixa?");

    const income = { id: crypto.randomUUID(), name, value, type: fixed ? "fixed" : "single" };
    db.months[currentMonth].incomes.push(income);

    if (fixed) replicateData(income, 'incomes');
    persist();
}

function addExpense() {
    const name = prompt("Nome da despesa:");
    if (!name) return;
    const value = parseFloat(prompt("Valor:").replace(',', '.'));
    if (isNaN(value)) return;

    const fixed = confirm("É despesa fixa?");
    let expense = { id: crypto.randomUUID(), name, value, type: fixed ? "fixed" : "variable" };

    if (!fixed) {
        const parcelado = confirm("É parcelado?");
        if (parcelado) {
            const total = parseInt(prompt("Quantidade de parcelas:"));
            if (isNaN(total)) return;
            expense.installment = { current: 1, total };
            replicateInstallments(expense);
        }
    }

    db.months[currentMonth].expenses.push(expense);
    if (fixed) replicateData(expense, 'expenses');
    persist();
}

// --- LÓGICA DE REPLICAÇÃO (Melhorada para virada de ano) ---
function replicateData(item, category) {
    let [year, month] = currentMonth.split("-").map(Number);
    
    // Replica para os próximos 11 meses (totalizando 1 ano)
    for (let i = 1; i < 12; i++) {
        month++;
        if (month > 12) { month = 1; year++; }
        
        const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
        if (!db.months[targetMonth]) db.months[targetMonth] = { incomes: [], expenses: [] };
        
        db.months[targetMonth][category].push({ ...item, id: crypto.randomUUID() });
    }
}

function replicateInstallments(expense) {
    let [year, month] = currentMonth.split("-").map(Number);
    const total = expense.installment.total;

    for (let i = 2; i <= total; i++) {
        month++;
        if (month > 12) { month = 1; year++; }
        
        const targetMonth = `${year}-${String(month).padStart(2, "0")}`;
        if (!db.months[targetMonth]) db.months[targetMonth] = { incomes: [], expenses: [] };
        
        db.months[targetMonth].expenses.push({
            ...expense,
            id: crypto.randomUUID(),
            installment: { current: i, total: total }
        });
    }
}

// --- AÇÕES ---
function deleteIncome(id) {
    db.months[currentMonth].incomes = db.months[currentMonth].incomes.filter(i => i.id !== id);
    persist();
}

function deleteExpense(id) {
    db.months[currentMonth].expenses = db.months[currentMonth].expenses.filter(e => e.id !== id);
    persist();
}

function editIncome(id) {
    const item = db.months[currentMonth].incomes.find(i => i.id === id);
    const newName = prompt("Nome:", item.name);
    const newValue = parseFloat(prompt("Valor:", item.value));
    if (newName && !isNaN(newValue)) {
        item.name = newName;
        item.value = newValue;
        persist();
    }
}

function editExpense(id) {
    const item = db.months[currentMonth].expenses.find(e => e.id === id);
    const newName = prompt("Nome:", item.name);
    const newValue = parseFloat(prompt("Valor:", item.value));
    if (newName && !isNaN(newValue)) {
        item.name = newName;
        item.value = newValue;
        persist();
    }
}

// --- RENDERIZAÇÃO ---
function formatCurrency(val) {
    return val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function render() {
    const month = db.months[currentMonth] || { incomes: [], expenses: [] };
    const incomeList = document.getElementById("incomeList");
    const expenseList = document.getElementById("expenseList");

    incomeList.innerHTML = "";
    expenseList.innerHTML = "";

    let totalIn = 0, totalOut = 0;

    month.incomes.forEach(i => {
        totalIn += i.value;
        incomeList.innerHTML += `
            <li onclick="openActionMenu('${i.id}', 'income', '${i.name}')">
                <div class="info">
                    <strong>${i.name}</strong>
                    <span class="type">${i.type === "fixed" ? "Fixa" : "Única"}</span>
                </div>
                <strong style="color:var(--success)">+ R$ ${formatCurrency(i.value)}</strong>
            </li>`;
    });

    month.expenses.forEach(e => {
        totalOut += e.value;
        expenseList.innerHTML += `
            <li onclick="openActionMenu('${e.id}', 'expense', '${e.name}')">
                <div class="info">
                    <strong>${e.name}</strong>
                    <span class="type">
                        ${e.type === "fixed" ? "Fixa" : "Variável"}
                        ${e.installment ? `<span class="badge-parcela">• ${e.installment.current}/${e.installment.total}</span>` : ""}
                    </span>
                </div>
                <strong style="color:var(--danger)">- R$ ${formatCurrency(e.value)}</strong>
            </li>`;
    });

    document.getElementById("totalIncome").innerText = formatCurrency(totalIn);
    document.getElementById("totalExpense").innerText = formatCurrency(totalOut);
    document.getElementById("balance").innerText = formatCurrency(totalIn - totalOut);
}

// --- UI / AUXILIARES ---
function openActionMenu(id, type, name) {
    const sheet = document.getElementById('bottom-sheet');
    const overlay = document.getElementById('overlay');
    
    document.getElementById('sheet-title').innerText = name;
    document.getElementById('sheet-subtitle').innerText = type === 'income' ? 'Renda' : 'Conta';

    document.getElementById('btn-edit').onclick = () => {
        type === 'income' ? editIncome(id) : editExpense(id);
        closeBottomSheet();
    };
    
    document.getElementById('btn-delete').onclick = () => {
        if(confirm(`Excluir "${name}"?`)) {
            type === 'income' ? deleteIncome(id) : deleteExpense(id);
        }
        closeBottomSheet();
    };

    sheet.classList.remove('hidden');
    overlay.classList.remove('hidden');
}

function closeBottomSheet() {
    document.getElementById('bottom-sheet').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
}

function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-theme');
    document.getElementById('theme-btn').innerText = isDark ? '☀️' : '🌙';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function persist() {
    saveLocalData(db);
    saveToDrive(db);
    render();
}