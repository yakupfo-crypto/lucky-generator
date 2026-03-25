window.onerror = function(message, source, lineno, colno, error) {
    alert("Kritik Hata: Uygulama veriyi korumak için durduruldu.");
    return true; 
};

const viewContainer = document.getElementById("view-container");
const resultPanel = document.getElementById("resultPanel");
let generatedSets = [];

// --- CSP UYUMLU OLAY DİNLEYİCİLER ---
document.getElementById('nav-gen')?.addEventListener('click', () => navTo('generate'));
document.getElementById('nav-sets')?.addEventListener('click', () => navTo('mySets'));
document.getElementById('close-panel')?.addEventListener('click', () => closeResultPanel(true));
document.getElementById('confirm-res')?.addEventListener('click', () => confirmResult());
document.getElementById('clean-res')?.addEventListener('click', () => cleanResult());

// Dinamik butonlar için global event delegation
document.addEventListener('click', function(e) {
    if(e.target && e.target.id === 'btn-generate-action') generateSets();
    if(e.target && e.target.id === 'btn-save-group') saveGroup();
    if(e.target && e.target.className === 'copy-btn-gen') copyCurrentGenerated();
});

// --- FONKSİYONLAR (DEĞİŞİKLİK YAPILMADI) ---
function escapeHTML(str) {
    if (!str) return "";
    const p = document.createElement("p");
    p.textContent = str;
    return p.innerHTML;
}

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
                if (existing && validatedItem.version !== existing.version) {
                    return reject("Çakışma: Veri başka bir sekmede güncellenmiş.");
                }
                validatedItem.version = Date.now();
                store.put(validatedItem);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject("İşlem hatası");
        });
    });
}

async function deleteFromDB(id) {
    return navigator.locks.request(lockName, async () => {
        const db = await openDB();
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).delete(id);
        return new Promise(resolve => tx.oncomplete = resolve);
    });
}

async function getGroupById(id) {
    const db = await openDB();
    return new Promise(resolve => {
        const tx = db.transaction(storeName, "readonly");
        tx.objectStore(storeName).get(id).onsuccess = (e) => {
            resolve(Validator.validateGroup(e.target.result));
        };
    });
}

function secureRandomInt(max) {
    const array = new Uint32Array(1);
    window.crypto.getRandomValues(array);
    return array[0] % max;
}

function secureShuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = secureRandomInt(i + 1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

window.onload = () => {
    const s = history.state || {page:"generate", groupId:null};
    renderCurrentState(s.page, s.groupId);
}

window.onpopstate = (event) => {
    const state = event.state || {page:"generate", groupId:null};
    renderCurrentState(state.page, state.groupId);
}

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
            group ? renderViewGroup(groupId) : renderMySetsList();
        } else renderMySetsList();
    } else if (page === "panel") {
        const group = await getGroupById(groupId);
        if(group) {
            await renderViewGroup(groupId);
            openResultPanel(group.max, group.id, false);
        } else navTo("mySets");
    }
}

function renderGeneratePage() {
    let storedInputs = {max:35, per:5, jMax:31, jPer:1, count:5};
    try {
        const stored = sessionStorage.getItem("tempGeneratedSets");
        const inputs = sessionStorage.getItem("tempInputs");
        const parsedSets = stored ? JSON.parse(stored) : [];
        generatedSets = Array.isArray(parsedSets) ? parsedSets.map(Validator.validateSet).filter(Boolean) : [];
        if(inputs) {
            const pInputs = JSON.parse(inputs);
            if(Validator.isNumber(pInputs.max)) storedInputs = pInputs;
        }
    } catch(e) { generatedSets = []; }

    viewContainer.innerHTML = `
    <div class="container">
        <div class="card">
            <label><b>Ana Grup Toplam Sayı</b></label>
            <input type="number" id="maxNumber" value="${storedInputs.max}">
            <label>Ana Grup Seçilecek Adet</label>
            <input type="number" id="perSet" value="${storedInputs.per}">
            <hr>
            <label><b>Joker Grubu Toplam Sayı</b></label>
            <input type="number" id="jokerMax" value="${storedInputs.jMax}">
            <label>Joker Seçilecek Adet</label>
            <input type="number" id="jokerCount" value="${storedInputs.jPer}">
            <hr>
            <label>Kolon Sayısı</label>
            <input type="number" id="setCount" value="${storedInputs.count}">
            <button id="btn-generate-action">Kolonları Üret</button>
        </div>
        <div id="results">${getGeneratedSetsHtml()}</div>
    </div>`;
}

function getGeneratedSetsHtml() {
    let html = "";
    generatedSets.forEach((set, i) => {
        html += `<div class='card'><b>${i+1}. Kolon</b>${createBalls(set)}</div>`;
    });
    if (generatedSets.length > 0) {
        html += `
        <div class="card">
            <button class="copy-btn-gen">Panoya Kopyala</button>
            <label><b>Grup Adı</b></label>
            <input type="text" id="groupNameInput" placeholder="Örn: Pazartesi">
            <button id="btn-save-group">Grubu Kaydet</button>
        </div>`;
    }
    return html;
}

async function renderMySetsList() {
    const currentGroups = await getAllGroups();
    const container = document.createElement("div");
    container.className = "container";
    container.innerHTML = `<h3>Kayıtlı Kolonlarım</h3>`;
    if (currentGroups.length === 0) container.innerHTML += "<p>Henüz kayıtlı set yok.</p>";
    currentGroups.forEach(group => {
        const card = document.createElement("div");
        card.className = "card";
        const b = document.createElement("b");
        b.textContent = group.name;
        const info = document.createElement("div");
        info.style.marginTop = "5px";
        info.innerHTML = `Kolon Sayısı: ${group.sets.length}<br>`;
        const btnView = document.createElement("button");
        btnView.textContent = "Görüntüle";
        btnView.onclick = () => navTo("mySets", group.id);
        const btnDel = document.createElement("button");
        btnDel.textContent = "Sil";
        btnDel.style.background = "#d32f2f";
        btnDel.style.marginTop = "5px";
        btnDel.onclick = () => deleteGroup(group.id);
        card.append(b, info, btnView, btnDel);
        container.appendChild(card);
    });
    viewContainer.appendChild(container);
}

async function renderViewGroup(id) {
    const group = await getGroupById(id);
    if (!group) return renderMySetsList();
    let resText = (group.results.main.length > 0 || group.results.joker.length > 0) 
        ? `Ana: ${group.results.main.join(",")} | Joker: ${group.results.joker.join(",")}` 
        : "Henüz girilmedi";
    const container = document.createElement("div");
    container.className = "container";
    const h3 = document.createElement("h3");
    h3.textContent = group.name;
    container.appendChild(h3);
    
    const btnCopy = document.createElement("button");
    btnCopy.className = "copy-btn";
    btnCopy.textContent = "Panoya Kopyala";
    btnCopy.onclick = () => copySpecificGroup(id);

    const resultCard = document.createElement("div");
    resultCard.className = "card";
    resultCard.innerHTML = `<b>Sonuçlar:</b> <span id="resultText-${group.id}">${resText}</span><br>`;
    const btnRes = document.createElement("button");
    btnRes.textContent = "Sonuç Gir (Kıyasla)";
    btnRes.onclick = () => openResultPanel(group.max, group.id);
    resultCard.appendChild(btnRes);

    container.append(btnCopy, resultCard);

    group.sets.forEach((set, i) => {
        const div = document.createElement("div");
        div.className = "card";
        div.innerHTML = `<b>${i+1}.</b>${createBallsWithMatch(set, group.results)}`;
        container.appendChild(div);
    });

    const backBtn = document.createElement("button");
    backBtn.textContent = "Listeye Dön";
    backBtn.style.background = "#666";
    backBtn.onclick = () => navTo("mySets");
    container.appendChild(backBtn);
    viewContainer.appendChild(container);
}

function createBalls(set) {
    let balls = "<div class='ball-row'>";
    set.numbers.forEach(n => balls += `<div class="ball selected">${n}</div>`);
    set.jokers.forEach(j => balls += `<div class="ball joker">${j}</div>`);
    return balls + "</div>";
}

function createBallsWithMatch(set, results) {
    let balls = "<div class='ball-row'>";
    set.numbers.forEach(n => {
        const isMatch = results.main.includes(n) ? "result-selected" : "";
        balls += `<div class="ball selected ${isMatch}">${n}</div>`;
    });
    set.jokers.forEach(j => {
        const isMatch = results.joker.includes(j) ? "result-selected" : "";
        balls += `<div class="ball joker ${isMatch}">${j}</div>`;
    });
    return balls + "</div>";
}

function generateSets() {
    const max = parseInt(document.getElementById("maxNumber").value);
    const per = parseInt(document.getElementById("perSet").value);
    const jMax = parseInt(document.getElementById("jokerMax").value);
    const jPer = parseInt(document.getElementById("jokerCount").value);
    const count = parseInt(document.getElementById("setCount").value);
    if ([max, per, jMax, jPer, count].some(isNaN) || per > max || jPer > jMax) {
        alert("Lütfen geçerli değerler girin!"); return;
    }
    generatedSets = [];
    for (let i = 0; i < count; i++) {
        let nArr = Array.from({length: max}, (_, i) => i + 1);
        let numbers = secureShuffle(nArr).slice(0, per).sort((a,b)=>a-b);
        let jArr = Array.from({length: jMax}, (_, i) => i + 1);
        let jokers = secureShuffle(jArr).slice(0, jPer).sort((a,b)=>a-b);
        generatedSets.push({numbers, jokers, max, jokerMax: jMax});
    }
    sessionStorage.setItem("tempGeneratedSets", JSON.stringify(generatedSets));
    sessionStorage.setItem("tempInputs", JSON.stringify({max, per, jMax, jPer, count}));
    document.getElementById("results").innerHTML = getGeneratedSetsHtml();
}

async function saveGroup() {
    const rawName = document.getElementById("groupNameInput")?.value;
    if (!rawName?.trim()) { alert("İsim girin!"); return; }
    const group = {
        id: String(Date.now()), name: escapeHTML(rawName), sets: [...generatedSets],
        max: parseInt(document.getElementById("maxNumber").value),
        jokerMax: parseInt(document.getElementById("jokerMax").value),
        jokerPerSet: parseInt(document.getElementById("jokerCount").value),
        results: {main: [], joker: []}, version: Date.now()
    };
    try {
        await atomicSave(group);
        sessionStorage.removeItem("tempGeneratedSets");
        navTo('mySets', group.id);
    } catch(err) { alert(err); }
}

async function deleteGroup(id) {
    if (confirm("Emin misiniz?")) {
        await deleteFromDB(id); renderMySetsList();
    }
}

async function openResultPanel(max, groupId, shouldPushState = true) {
    const group = await getGroupById(groupId);
    if(!group) return;
    const resultDiv = document.getElementById("resultNumbers");
    resultDiv.innerHTML = "";
    
    const h4Main = document.createElement("h4"); h4Main.textContent = `Ana Sayı (1-${max})`;
    resultDiv.appendChild(h4Main);
    const mainRow = document.createElement("div"); mainRow.className = "ball-row";
    for(let i=1; i<=max; i++) {
        const b = document.createElement("div");
        b.className = "ball " + (group.results.main.includes(i) ? "result-selected" : "");
        b.textContent = i;
        b.onclick = () => toggleMainResult(b, groupId, i);
        mainRow.appendChild(b);
    }
    resultDiv.appendChild(mainRow);

    if (group.jokerPerSet > 0) {
        const h4Jok = document.createElement("h4"); h4Jok.textContent = `Joker (1-${group.jokerMax})`;
        resultDiv.appendChild(h4Jok);
        const jokRow = document.createElement("div"); jokRow.className = "ball-row";
        for(let i=1; i<=group.jokerMax; i++) {
            const b = document.createElement("div");
            b.className = "ball joker " + (group.results.joker.includes(i) ? "result-selected" : "");
            b.textContent = i;
            b.onclick = () => toggleJokerResult(b, groupId, i);
            jokRow.appendChild(b);
        }
        resultDiv.appendChild(jokRow);
    }
    if (shouldPushState) history.pushState({page: "panel", groupId: String(groupId)}, "");
    resultPanel.style.display = "block";
}

async function toggleMainResult(el, id, val) {
    try {
        const group = await getGroupById(id);
        const idx = group.results.main.indexOf(val);
        if (idx > -1) group.results.main.splice(idx, 1);
        else if (group.results.main.length < 10) group.results.main.push(val); 
        await atomicSave(group);
        el.classList.toggle("result-selected");
        renderViewGroup(id);
    } catch(err) { alert(err); }
}

async function toggleJokerResult(el, id, val) {
    try {
        const group = await getGroupById(id);
        const idx = group.results.joker.indexOf(val);
        if (idx > -1) group.results.joker.splice(idx, 1);
        else if (group.results.joker.length < group.jokerPerSet) group.results.joker.push(val);
        await atomicSave(group);
        el.classList.toggle("result-selected");
        renderViewGroup(id);
    } catch(err) { alert(err); }
}

function closeResultPanel(back = false) {
    if (back && history.state?.page === "panel") history.back();
    else resultPanel.style.display = "none";
}

function confirmResult() { closeResultPanel(true); }

async function cleanResult() {
    const id = history.state?.groupId;
    if (!id) return;
    try {
        const group = await getGroupById(id);
        if(group) {
            group.results = {main: [], joker: []};
            await atomicSave(group); renderCurrentState("mySets", id);
        }
    } catch(err) { alert(err); }
}

async function copySpecificGroup(id) {
    const group = await getGroupById(id);
    copyToClipboard(formatGroupForCopy(group));
}

function copyCurrentGenerated() {
    copyToClipboard(formatGroupForCopy({name: "Geçici Liste", sets: generatedSets}));
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => alert("Kopyalandı!"));
}

function formatGroupForCopy(group) {
    if (!group) return "";
    let t = `${group.name}\n`;
    group.sets.forEach((s, i) => {
        t += `${i+1}. Kolon: ${s.numbers.join(", ")} ${s.jokers.length ? '+ J:'+s.jokers.join(',') : ''}\n`;
    });
    return t;
}
