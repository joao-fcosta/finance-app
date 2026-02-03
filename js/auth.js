const CLIENT_ID = "801527936828-msn86sauln88co5dq9acdiuqa5fkqam0.apps.googleusercontent.com";
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
