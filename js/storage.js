const STORAGE_KEY = "finance-data";

/**
 * Retorna a estrutura inicial do banco de dados caso não haja nada salvo.
 */
function defaultData() {
    return { 
        months: {},
        lastUpdate: new Date().toISOString(),
        version: "1.0" // Útil para futuras migrações de dados
    };
}

/**
 * Carrega os dados do localStorage com tratamento de erro.
 */
function loadLocalData() {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error("❌ Erro ao ler dados do localStorage:", error);
        return null;
    }
}

/**
 * Salva os dados localmente.
 */
function saveLocalData(data) {
    try {
        if (!data) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error("❌ Erro ao salvar dados no localStorage:", error);
        // O localStorage pode estar cheio ou desativado (modo incôgnito)
        alert("Atenção: Não foi possível salvar os dados localmente.");
    }
}
