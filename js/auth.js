const CLIENT_ID = "SEU_CLIENT_ID";
const SCOPES = "https://www.googleapis.com/auth/drive.file";
let accessToken = null;

document.getElementById("login").onclick = () => {
  const client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: token => {
      accessToken = token.access_token;
      document.getElementById("login").style.display = "none";
      document.getElementById("app").classList.remove("hidden");
      initApp();
    }
  });
  client.requestAccessToken();
};
