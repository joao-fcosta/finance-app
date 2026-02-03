const STORAGE_KEY = "finance-data";

function defaultData() {
  return { months: {} };
}

function loadLocalData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY));
}

function saveLocalData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
