const CLIENT_ID = "801527936828-msn86sauln88co5dq9acdiuqa5fkqam0.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
let accessToken = null;

document.getElementById("login").onclick = async () => {
    const isLocalHost = location.pathname === "/index.html" || location.hostname === "127.0.0.1" || location.port === "5500";

    if (isLocalHost) {
        console.log("🛠️ [Debug] Pulando autenticação Google em localhost");
        document.getElementById("login-screen").classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");
        await initApp();
    } else {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: async token => {
                accessToken = token.access_token;
                document.getElementById("login-screen").classList.add("hidden");
                document.getElementById("app").classList.remove("hidden");
                await initApp();
            }
        });
        client.requestAccessToken();
    }
};
