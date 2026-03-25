// Güvenlik: window.onerror ile hataları yakala
window.onerror = function() {
    alert("Kritik Hata: Uygulama veriyi korumak için durduruldu.");
    return true; 
};

const viewContainer = document.getElementById("view-container");
const resultPanel = document.getElementById("resultPanel");
let generatedSets = [];

// --- VALIDATOR & DB İŞLEMLERİ (Aynı Kaldı) ---
const Validator = {
    isNumber: (v) => typeof v === 'number' && !isNaN(v),
    isArray: (v) => Array.isArray(v),
    isString: (v) => typeof v === 'string',
    validateSet: (set) => {
        if (!set || typeof set !== 'object') return null;
        return {
            numbers: Validator.isArray(set.numbers) ? set.numbers.filter(Validator.isNumber) : [],
            jokers: Validator.isArray(set.jokers) ? set.jokers.filter(Validator.isNumber) : [],
            max: Validator.isNumber(set.max) ? set.max : 49,
            jokerMax: Validator.isNumber(set.jokerMax) ? set.jokerMax : 0
        };
    },
    validateGroup: (data) => {
        try {
            if (!data || typeof data !== 'object') return null;
            return {
                id: Validator.isString(data.id) ? data.id : String(Date.now()),
                name: Validator.isString(data.name) ? escapeHTML(data.name) : "İsimsiz Liste",
                sets: Validator.isArray(data.sets) ? data.sets.map(Validator.validateSet).filter(Boolean) : [],
                max: Validator.isNumber(data.max) ? data.max : 49,
                jokerMax: Validator.isNumber(data.jokerMax) ? data.jokerMax : 0,
                jokerPerSet: Validator.isNumber(data.jokerPerSet) ? data.jokerPerSet : 0,
                results: (data.results && Validator.isArray(data.results.main)) ? 
                    { main: data.results.main.filter(Validator.isNumber), joker: (data.results.joker || []).filter(Validator.isNumber) } : 
                    { main: [], joker: [] },
                version: Validator.isNumber(data.version) ? data.version : Date.now()
            };
        } catch (e) { return null; }
    }
};

const dbName = "LuckyDB";
const storeName = "savedGroups";
const lockName = "db_write_lock";

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "id" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject("DB hatası");
    });
}

async function getAllGroups() {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction(storeName, "readonly");
        tx.objectStore(storeName).getAll().onsuccess = (e) => {
            resolve((e.target.result || []).map(Validator.validateGroup).filter(Boolean));
        };
    });
}

async function atomicSave(item) {
    const validatedItem = Validator.validateGroup(item);
    if (!validatedItem) throw new Error("Geçersiz veri formatı!");
    return navigator.locks.request(lockName, async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            const getRequest = store.get(validatedItem.id);
            getRequest.onsuccess = () => {
                const existing = getRequest.result;
                if (existing && validatedItem.version !== existing.version) return reject("Çakışma.");
                validatedItem.version = Date.now();
                store.put(validatedItem);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject("İşlem hatası");
        });
    });
}

async function getGroupById(id) {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction(storeName, "readonly");
        tx.objectStore(storeName).get(id).onsuccess = (e) => resolve(Validator.validateGroup(e.target.result));
    });
}

function escapeHTML(str) {
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}

// --- NAVİGASYON VE RENDER ---
function navTo(page, groupId=null) {
    const cleanId = groupId ? String(groupId) : null;
    history.pushState({page, groupId: cleanId}, "");
    renderCurrentState(page, cleanId);
}

async function renderCurrentState(page, groupId) {
    viewContainer.innerHTML = "";
    resultPanel.style.display = "none";
    if (page === "generate") renderGeneratePage();
    else if (page === "mySets") {
        if (groupId) {
            const group = await getGroupById(groupId);
            group ? renderViewGroup(group) : renderMySetsList();
        } else renderMySetsList();
    }
}

// --- EVENT DELEGATION (Statik butonlar için dinleyiciler) ---
document.getElementById("nav-generate").addEventListener("click", () => navTo("generate"));
document.getElementById("nav-mySets").addEventListener("click", () => navTo("mySets"));
document.getElementById("close-panel").addEventListener("click", () => closeResultPanel(true));
document.getElementById("confirm-result").addEventListener("click", () => closeResultPanel(true));
document.getElementById("clean-result").addEventListener("click", cleanResult);

// --- DİNAMİK TIKLAMALARI YÖNET (Event Delegation) ---
document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.id === "btn-generate-sets") generateSets();
    if (t.id === "btn-save-group") saveGroup();
    if (t.id === "btn-copy-generated") copyCurrentGenerated();
    if (t.classList.contains("btn-view-group")) navTo("mySets", t.dataset.id);
    if (t.classList.contains("btn-delete-group")) {
        if(confirm("Emin misiniz?")) {
            const db = await openDB();
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).delete(t.dataset.id);
            tx.oncomplete = () => renderMySetsList();
        }
    }
    if (t.classList.contains("btn-open-panel")) {
        openResultPanel(t.dataset.max, t.dataset.id);
    }
    if (t.classList.contains("btn-copy-specific")) {
        const group = await getGroupById(t.dataset.id);
        copyToClipboard(formatGroupForCopy(group));
    }
    if (t.id === "btn-list-back") navTo("mySets");
});

// Sayı seçimleri (Sonuç girme panelindeki toplar)
document.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.classList.contains("ball-toggle-main")) {
        await toggleResult(t, t.dataset.id, parseInt(t.dataset.val), "main");
    }
    if (t.classList.contains("ball-toggle-joker")) {
        await toggleResult(t, t.dataset.id, parseInt(t.dataset.val), "joker");
    }
});

// --- DİĞER FONKSİYONLAR (Geliştirildi) ---
function renderGeneratePage() {
    viewContainer.innerHTML = `
    <div class="container">
        <div class="card">
            <b>Ana Grup Toplam</b> <input type="number" id="maxNumber" value="35">
            Ana Seçilecek <input type="number" id="perSet" value="5">
            <hr>
            <b>Joker Toplam</b> <input type="number" id="jokerMax" value="31">
            Joker Seçilecek <input type="number" id="jokerCount" value="1">
            <hr>
            Kolon Sayısı <input type="number" id="setCount" value="5">
            <button id="btn-generate-sets">Kolonları Üret</button>
        </div>
        <div id="results"></div>
    </div>`;
}

function generateSets() {
    const max = parseInt(document.getElementById("maxNumber").value);
    const per = parseInt(document.getElementById("perSet").value);
    const jMax = parseInt(document.getElementById("jokerMax").value);
    const jPer = parseInt(document.getElementById("jokerCount").value);
    const count = parseInt(document.getElementById("setCount").value);
    
    generatedSets = [];
    for (let i = 0; i < count; i++) {
        let nArr = Array.from({length: max}, (_, i) => i + 1);
        let numbers = nArr.sort(() => Math.random() - 0.5).slice(0, per).sort((a,b)=>a-b);
        let jArr = Array.from({length: jMax}, (_, i) => i + 1);
        let jokers = jArr.sort(() => Math.random() - 0.5).slice(0, jPer).sort((a,b)=>a-b);
        generatedSets.push({numbers, jokers, max, jokerMax: jMax});
    }
    
    let html = "";
    generatedSets.forEach((s, i) => {
        html += `<div class="card"><b>${i+1}. Kolon</b><div class="ball-row">`;
        s.numbers.forEach(n => html += `<div class="ball selected">${n}</div>`);
        s.jokers.forEach(j => html += `<div class="ball joker">${j}</div>`);
        html += `</div></div>`;
    });
    html += `<div class="card">
        <button id="btn-copy-generated">Kopyala</button>
        <input type="text" id="groupNameInput" placeholder="Liste Adı">
        <button id="btn-save-group">Kaydet</button>
    </div>`;
    document.getElementById("results").innerHTML = html;
}

async function saveGroup() {
    const name = document.getElementById("groupNameInput").value;
    if(!name) return alert("İsim verin!");
    const group = {
        id: String(Date.now()), name: escapeHTML(name), sets: [...generatedSets],
        max: parseInt(document.getElementById("maxNumber").value),
        jokerMax: parseInt(document.getElementById("jokerMax").value),
        jokerPerSet: parseInt(document.getElementById("jokerCount").value),
        results: {main: [], joker: []}, version: Date.now()
    };
    await atomicSave(group);
    navTo("mySets", group.id);
}

async function renderMySetsList() {
    const groups = await getAllGroups();
    let html = `<div class="container"><h3>Kayıtlılarım</h3>`;
    groups.forEach(g => {
        html += `<div class="card"><b>${g.name}</b>
            <button class="btn-view-group" data-id="${g.id}">Görüntüle</button>
            <button class="btn-delete-group" data-id="${g.id}" style="background:#d32f2f; margin-top:5px;">Sil</button>
        </div>`;
    });
    viewContainer.innerHTML = html + "</div>";
}

async function renderViewGroup(group) {
    let resText = `Ana: ${group.results.main.join(",")} | Joker: ${group.results.joker.join(",")}`;
    let html = `<div class="container"><h3>${group.name}</h3>
        <button class="btn-copy-specific" data-id="${group.id}">Kopyala</button>
        <div class="card"><b>Sonuçlar:</b> <span>${resText}</span><br>
        <button class="btn-open-panel" data-id="${group.id}" data-max="${group.max}">Sonuç Gir</button></div>`;
    
    group.sets.forEach((set, i) => {
        html += `<div class="card"><b>${i+1}.</b><div class="ball-row">`;
        set.numbers.forEach(n => {
            let m = group.results.main.includes(n) ? "result-selected" : "";
            html += `<div class="ball selected ${m}">${n}</div>`;
        });
        set.jokers.forEach(j => {
            let m = group.results.joker.includes(j) ? "result-selected" : "";
            html += `<div class="ball joker ${m}">${j}</div>`;
        });
        html += `</div></div>`;
    });
    viewContainer.innerHTML = html + `<button id="btn-list-back" style="background:#666">Geri</button></div>`;
}

async function openResultPanel(max, groupId) {
    const group = await getGroupById(groupId);
    let html = `<h4>Ana Sayı</h4><div class="ball-row">`;
    for(let i=1; i<=max; i++) {
        let sel = group.results.main.includes(i) ? "result-selected" : "";
        html += `<div class="ball ball-toggle-main ${sel}" data-id="${groupId}" data-val="${i}">${i}</div>`;
    }
    html += `</div><h4>Joker</h4><div class="ball-row">`;
    for(let i=1; i<=group.jokerMax; i++) {
        let sel = group.results.joker.includes(i) ? "result-selected" : "";
        html += `<div class="ball joker ball-toggle-joker ${sel}" data-id="${groupId}" data-val="${i}">${i}</div>`;
    }
    document.getElementById("resultNumbers").innerHTML = html + "</div>";
    resultPanel.style.display = "block";
}

async function toggleResult(el, id, val, type) {
    const group = await getGroupById(id);
    const arr = type === "main" ? group.results.main : group.results.joker;
    const idx = arr.indexOf(val);
    if(idx > -1) arr.splice(idx, 1); else arr.push(val);
    await atomicSave(group);
    el.classList.toggle("result-selected");
    renderViewGroup(group);
}

function closeResultPanel() { resultPanel.style.display = "none"; }

async function cleanResult() {
    const id = document.querySelector(".ball-toggle-main")?.dataset.id;
    if(!id) return;
    const group = await getGroupById(id);
    group.results = {main: [], joker: []};
    await atomicSave(group);
    renderViewGroup(group);
    closeResultPanel();
}

function copyToClipboard(text) { navigator.clipboard.writeText(text).then(() => alert("Kopyalandı!")); }

function formatGroupForCopy(group) {
    let t = `${group.name}\n`;
    group.sets.forEach((s, i) => t += `${i+1}. Kolon: ${s.numbers.join(", ")} + J:${s.jokers.join(",")}\n`);
    return t;
}

function copyCurrentGenerated() { copyToClipboard(formatGroupForCopy({name:"Geçici", sets:generatedSets})); }

window.onload = () => renderCurrentState("generate");
