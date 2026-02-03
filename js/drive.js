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

// cria o arquivo inicial
async function createFile(initialContent) {
  const metadata = {
    name: "finance.json",
    mimeType: "application/json"
  };

  const boundary = "foo_bar_baz";
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify(initialContent) +
    `\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  return await res.json();
}

// carrega o conteúdo do arquivo
async function loadFromDrive() {
  const file = await findFile();
  if (!file) return null;

  fileId = file.id;

  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  );

  return await res.json();
}

// salva conteúdo no Drive
async function saveToDrive(content) {
  if (!fileId) {
    const created = await createFile(content);
    fileId = created.id;
    console.log("✔ Arquivo criado no Drive");
    return;
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

  console.log("✔ Atualizado no Google Drive");
}
