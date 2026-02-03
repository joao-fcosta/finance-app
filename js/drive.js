const DRIVE_API = "https://www.googleapis.com/drive/v3";
let fileId = null;

// procura o arquivo no Drive
async function findFile() {
  const res = await fetch(
    `${DRIVE_API}/files?q=name='finance.json' and trashed=false`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  const data = await res.json();
  return data.files?.[0] || null;
}

// cria o arquivo se não existir
async function createFile() {
  const metadata = {
    name: "finance.json",
    mimeType: "application/json"
  };

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(metadata)
    }
  );

  return await res.json();
}

// salva conteúdo no arquivo
async function saveToDrive(content) {
  if (!fileId) {
    const file = await findFile() || await createFile();
    fileId = file.id;
  }

  await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(content)
    }
  );

  console.log("✔ Salvo no Google Drive");
}
