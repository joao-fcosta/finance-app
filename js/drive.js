const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
let fileId = null;

// Procura o arquivo no Drive ou retorna o cache local
async function findFile() {
    if (fileId) return { id: fileId }; // Otimização para não buscar toda vez

    try {
        const res = await fetch(
            `${DRIVE_API}/files?q=name='finance.json' and trashed=false`,
            {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        );
        const data = await res.json();
        return data.files?.[0] || null;
    } catch (err) {
        console.error("Erro ao buscar arquivo no Drive:", err);
        return null;
    }
}

// Cria o arquivo inicial com multipart/related
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
        `${DRIVE_UPLOAD_API}/files?uploadType=multipart`,
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

// Carrega o conteúdo do arquivo
async function loadFromDrive() {
    if (!accessToken) return null;

    const file = await findFile();
    if (!file) return null;

    fileId = file.id;

    try {
        const res = await fetch(
            `${DRIVE_API}/files/${fileId}?alt=media`,
            {
                headers: { Authorization: `Bearer ${accessToken}` }
            }
        );
        return await res.json();
    } catch (err) {
        console.error("Erro ao baixar conteúdo do Drive:", err);
        return null;
    }
}

// Salva conteúdo no Drive (PATCH)
async function saveToDrive(content) {
    if (!accessToken) return;

    // Se não temos o ID, tentamos buscar ou criar
    if (!fileId) {
        const file = await findFile();
        if (!file) {
            const created = await createFile(content);
            fileId = created.id;
            console.log("✔ Arquivo criado no Drive");
            return;
        }
        fileId = file.id;
    }

    try {
        const res = await fetch(
            `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`,
            {
                method: "PATCH",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(content)
            }
        );

        if (res.ok) {
            console.log("✔ Sincronizado com Google Drive");
        } else {
            console.warn("⚠️ Falha na sincronização:", res.status);
        }
    } catch (err) {
        console.error("Erro ao salvar no Drive:", err);
    }
}