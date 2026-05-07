let db = null;
let currentMonth = null;

document.addEventListener('DOMContentLoaded', initApp);

// --- INICIALIZAÇÃO ---
async function initApp() {
    const host = location.hostname;
    const isLocalHost = host === "" || host === "127.0.0.1" || host === "localhost" || location.port === "5500";
    
    let driveData = null;

    if (isLocalHost) {
        try {
            const res = await fetch("finance.json");
            if (res.ok) driveData = await res.json();
        } catch { console.info("💡 Sem finance.json local."); }
    } else {
        try { 
            driveData = await loadFromDrive(); 
        } 
        catch (err) { console.error("❌ Erro Drive:", err); }
    }

    db = driveData || loadLocalData() || { months: {} };
    
    const input = document.getElementById("monthSelector");
    input.value = new Date().toISOString().slice(0, 7);
    
    changeMonth(input.value);
    input.onchange = e => changeMonth(e.target.value);
}

function changeMonth(month) {
    currentMonth = month;
    // Operador de coalescência nula (??=) para criar o mês se não existir
    db.months[month] ??= { incomes: [], expenses: [] };
    render();
}

// --- ADICIONAR DADOS ---
// Helper para evitar repetição do replace e parseFloat
function promptValue(msg, defaultValue = "") {
    const val = prompt(msg, defaultValue);
    return val ? parseFloat(val.replace(',', '.')) : NaN;
}

function addIncome() { openTransactionModal('incomes'); }
function addExpense() { openTransactionModal('expenses'); }
function editItem(id, category) { openTransactionModal(category, id); }

// Variável para guardar temporariamente se estamos editando ou adicionando
let currentTransactionContext = { type: null, isEditing: false, id: null };

function openTransactionModal(type, itemId = null) {
    const dialog = document.getElementById('transactionModal');
    const form = document.getElementById('transactionForm');
    const isIncome = type === 'incomes';
    
    // Reseta o form e ajusta o layout
    form.reset();
    document.getElementById('modalTitle').innerText = isIncome ? 'Nova Renda' : 'Nova Despesa';
    document.getElementById('installmentContainer').style.display = isIncome ? 'none' : 'block';
    document.getElementById('transTotalInstallments').style.display = 'none';

    currentTransactionContext = { type, isEditing: !!itemId, id: itemId };

    // Se for edição, preenche os dados
    if (itemId) {
        const item = db.months[currentMonth][type].find(i => i.id === itemId);
        document.getElementById('transName').value = item.name;
        document.getElementById('transValue').value = item.value;
        document.getElementById('transFixed').checked = (item.type === 'fixed');
        // (A lógica de edição de parcelas exigiria um pouco mais de cuidado, 
        // mas o básico já carrega aqui)
    }

    dialog.showModal();
}

// Lógica de exibição do campo de parcelas dinâmico
document.getElementById('transFixed').addEventListener('change', (e) => {
    if(currentTransactionContext.type === 'expenses') {
        document.getElementById('installmentContainer').style.display = e.target.checked ? 'none' : 'block';
    }
});

document.getElementById('transIsInstallment').addEventListener('change', (e) => {
    document.getElementById('transTotalInstallments').style.display = e.target.checked ? 'block' : 'none';
    if(e.target.checked) document.getElementById('transTotalInstallments').setAttribute('required', 'true');
    else document.getElementById('transTotalInstallments').removeAttribute('required');
});

// Captura o submit do form
document.getElementById('transactionForm').addEventListener('submit', (e) => {
    e.preventDefault(); // Evita recarregar a página
    
    const { type, isEditing, id } = currentTransactionContext;
    const name = document.getElementById('transName').value;
    const value = parseFloat(document.getElementById('transValue').value);
    const fixed = document.getElementById('transFixed').checked;
    const isIncome = type === 'incomes';
    
    let item;

    if (isEditing) {
        item = db.months[currentMonth][type].find(i => i.id === id);
        item.name = name;
        item.value = value;
        item.type = fixed ? "fixed" : (isIncome ? "single" : "variable");
    } else {
        item = { id: crypto.randomUUID(), name, value, type: fixed ? "fixed" : (isIncome ? "single" : "variable") };
        
        // Lida com parcelas apenas em novas despesas
        if (!isIncome && !fixed && document.getElementById('transIsInstallment').checked) {
            const total = parseInt(document.getElementById('transTotalInstallments').value, 10);
            item.installment = { current: 1, total };
            replicateInstallments(item);
        }

        db.months[currentMonth][type].push(item);
        if (fixed) replicateData(item, type);
    }

    document.getElementById('transactionModal').close();
    persist();
});

// Botão de cancelar do modal de transação
document.getElementById('btnTransCancel').addEventListener('click', () => {
    document.getElementById('transactionModal').close();
});

// --- LÓGICA DE REPLICAÇÃO ---
// Helper matemático para calcular o mês alvo sem loops
function getTargetMonth(baseMonth, offset) {
    let [year, month] = baseMonth.split("-").map(Number);
    month += offset;
    year += Math.floor((month - 1) / 12);
    month = ((month - 1) % 12) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
}

function replicateData(item, category) {
    for (let i = 1; i <= 11; i++) {
        const targetMonth = getTargetMonth(currentMonth, i);
        db.months[targetMonth] ??= { incomes: [], expenses: [] };
        db.months[targetMonth][category].push({ ...item, id: crypto.randomUUID() });
    }
}

function replicateInstallments(expense) {
    const total = expense.installment.total;
    for (let i = 2; i <= total; i++) {
        const targetMonth = getTargetMonth(currentMonth, i - 1);
        db.months[targetMonth] ??= { incomes: [], expenses: [] };
        db.months[targetMonth].expenses.push({
            ...expense,
            id: crypto.randomUUID(),
            installment: { current: i, total }
        });
    }
}

// --- AÇÕES ---
// Funções unificadas de exclusão e edição
async function deleteItem(id, category) {
    const item = db.months[currentMonth][category].find(i => i.id === id);
    if (!item) return;

    const confirmed = await customConfirm(`Deseja realmente excluir "${item.name}"?`);
    if (confirmed) {
        db.months[currentMonth][category] = db.months[currentMonth][category].filter(i => i.id !== id);
        persist();
    }
}

// --- RENDERIZAÇÃO ---
const formatCurrency = val => val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function render() {
    const month = db.months[currentMonth] || { incomes: [], expenses: [] };
    let totalIn = 0, totalOut = 0;

    // Função única para construir o HTML evita repetição e melhora performance
    const buildHTML = (items, category) => items.map(item => {
        const isIncome = category === 'incomes';
        isIncome ? totalIn += item.value : totalOut += item.value;
        
        const color = isIncome ? 'var(--success)' : 'var(--danger)';
        const sign = isIncome ? '+' : '-';
        const typeLabel = item.type === "fixed" ? "Fixa" : (isIncome ? "Única" : "Variável");
        const badge = item.installment ? `<span class="badge-parcela">• ${item.installment.current}/${item.installment.total}</span>` : "";

        return `
            <li onclick="openActionMenu('${item.id}', '${category}', '${item.name}')">
                <div class="info">
                    <strong>${item.name}</strong>
                    <span class="type">${typeLabel} ${badge}</span>
                </div>
                <strong style="color:${color}">${sign} R$ ${formatCurrency(item.value)}</strong>
            </li>`;
    }).join(''); // Junta a array em uma string só de uma vez

    // Evita reflows múltiplos atualizando o DOM apenas uma vez
    document.getElementById("incomeList").innerHTML = buildHTML(month.incomes, 'incomes');
    document.getElementById("expenseList").innerHTML = buildHTML(month.expenses, 'expenses');

    document.getElementById("totalIncome").innerText = formatCurrency(totalIn);
    document.getElementById("totalExpense").innerText = formatCurrency(totalOut);
    document.getElementById("balance").innerText = formatCurrency(totalIn - totalOut);
}

// --- UI / AUXILIARES ---
function openActionMenu(id, category, name) {
    document.getElementById('sheet-title').innerText = name;
    document.getElementById('sheet-subtitle').innerText = category === 'incomes' ? 'Renda' : 'Conta';

    document.getElementById('btn-edit').onclick = () => { editItem(id, category); closeBottomSheet(); };
    document.getElementById('btn-delete').onclick = () => {
        if(confirm(`Excluir "${name}"?`)) deleteItem(id, category);
        closeBottomSheet();
    };

    document.getElementById('bottom-sheet').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
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

// Utilitário de Confirmação Customizado
function customConfirm(message) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirmModal');
        document.getElementById('confirmTitle').innerText = message;

        const btnOk = document.getElementById('btnConfirmOk');
        const btnCancel = document.getElementById('btnConfirmCancel');

        const cleanup = () => {
            btnOk.onclick = null;
            btnCancel.onclick = null;
            dialog.close();
        };

        btnOk.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };

        dialog.showModal(); // Abre o modal nativamente
    });
}