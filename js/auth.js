const CLIENT_ID = "801527936828-msn86sauln88co5dq9acdiuqa5fkqam0.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";

let accessToken = null;

// ─────────────────────────────────────────
// Detecta em qual página estamos
// ─────────────────────────────────────────
const isLoginPage = document.getElementById('login-btn') !== null;
const isAppPage   = document.getElementById('app') !== null;

const isLocalHost = (
    location.hostname === 'localhost'     ||
    location.hostname === '127.0.0.1'    ||
    location.port     === '5500'
);

// ─────────────────────────────────────────
// PÁGINA DE LOGIN (index.html)
// ─────────────────────────────────────────
if (isLoginPage) {
    document.getElementById('login-btn').onclick = async () => {

        if (isLocalHost) {
            console.log('🛠️ [Debug] Pulando autenticação em localhost');
            window.location.href = 'app.html';
            return;
        }

        const client = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async (token) => {
                if (token.error) {
                    console.error('❌ Erro na autenticação:', token.error);
                    return;
                }

                // Salva o token temporariamente para uso no app.html
                sessionStorage.setItem('access_token', token.access_token);
                window.location.href = 'app.html';
            }
        });

        client.requestAccessToken();
    };
}

// ─────────────────────────────────────────
// PÁGINA DO APP (app.html)
// ─────────────────────────────────────────
if (isAppPage) {

    if (isLocalHost) {
        console.log('🛠️ [Debug] Modo local ativo, sem autenticação');
        // Continua normalmente, initApp() será chamado pelo app.js
    } else {
        // Recupera o token salvo pelo login
        accessToken = sessionStorage.getItem('access_token');

        if (!accessToken) {
            console.warn('⚠️ Sem token de acesso, redirecionando para login...');
            window.location.href = 'index.html';
        }
    }
}

