const STORAGE_KEY = "finance-data";

function loadLocalData() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
    months: {}
  };
}

function saveLocalData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
