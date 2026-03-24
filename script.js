(function() {
    "use strict";

    window.onerror = function() {
        alert("Kritik Hata: Uygulama veriyi korumak için durduruldu.");
        return true; 
    };

    const viewContainer = document.getElementById("view-container");
    const resultPanel = document.getElementById("resultPanel");
    let generatedSets = [];

    const escapeHTML = (str) => {
        if (!str) return "";
        const p = document.createElement("p");
        p.textContent = str;
        return p.innerHTML;
    };

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

    const openDB = () => {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "id" });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject("DB hatası");
        });
    };

    async function atomicSave(item) {
        const validatedItem = Validator.validateGroup(item);
        if (!validatedItem) throw new Error("Geçersiz veri!");
        return navigator.locks.request(lockName, async () => {
            const db = await openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, "readwrite");
                const store = tx.objectStore(storeName);
                const getReq = store.get(validatedItem.id);
                getReq.onsuccess = () => {
                    const existing = getReq.result;
                    if (existing && validatedItem.version !== existing.version) return reject("Çakışma");
                    validatedItem.version = Date.now();
                    store.put(validatedItem);
                };
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject("Hata");
            });
        });
    }

    const createBalls = (set) => {
        let balls = "<div class='ball-row'>";
        set.numbers.forEach(n => balls += `<div class="ball selected">${n}</div>`);
        set.jokers.forEach(j => balls += `<div class="ball joker">${j}</div>`);
        return balls + "</div>";
    };

    const createBallsWithMatch = (set, results) => {
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
    };

    async function renderCurrentState(page, groupId) {
        viewContainer.innerHTML = "";
        resultPanel.style.display = "none";
        if (page === "generate") {
            renderGeneratePage();
        } else if (page === "mySets") {
            if (groupId) {
                const db = await openDB();
                db.transaction(storeName).objectStore(storeName).get(groupId).onsuccess = e => {
                    const g = Validator.validateGroup(e.target.result);
                    g ? renderViewGroup(g) : renderMySetsList();
                };
            } else {
                renderMySetsList();
            }
        }
    }

    function renderGeneratePage() {
        try {
            const stored = sessionStorage.getItem("tempGeneratedSets");
            generatedSets = stored ? JSON.parse(stored).map(Validator.validateSet).filter(Boolean) : [];
        } catch(e) { generatedSets = []; }

        viewContainer.innerHTML = `
        <div class="container">
            <div class="card">
                <b>Ana Grup Toplam Sayı</b><input type="number" id="maxNumber" value="35">
                Ana Grup Seçilecek Adet<input type="number" id="perSet" value="5">
                <hr>
                <b>Joker Grubu Toplam Sayı</b><input type="number" id="jokerMax" value="31">
                Joker Seçilecek Adet<input type="number" id="jokerCount" value="1">
                <hr>
                Kolon Sayısı<input type="number" id="setCount" value="5">
                <button data-action="doGenerate">Kolonları Üret</button>
            </div>
            <div id="results"></div>
        </div>`;
        updateGeneratedUI();
    }

    function updateGeneratedUI() {
        const resDiv = document.getElementById("results");
        if(!resDiv) return;
        let html = "";
        generatedSets.forEach((set, i) => {
            html += `<div class='card'><b>${i+1}. Kolon</b>${createBalls(set)}</div>`;
        });
        if (generatedSets.length > 0) {
            html += `
            <div class="card">
                <button class="copy-btn" data-action="copyGenerated">Panoya Kopyala</button>
                <label><b>Grup Adı</b></label>
                <input type="text" id="groupNameInput" placeholder="Örn: Pazartesi">
                <button data-action="saveGroup">Grubu Kaydet</button>
            </div>`;
        }
        resDiv.innerHTML = html;
    }

    async function renderMySetsList() {
        const db = await openDB();
        db.transaction(storeName).objectStore(storeName).getAll().onsuccess = (e) => {
            const groups = (e.target.result || []).map(Validator.validateGroup).filter(Boolean);
            let html = `<div class="container"><h3>Kayıtlı Kolonlarım</h3>`;
            if (groups.length === 0) html += "<p>Henüz kayıtlı set yok.</p>";
            viewContainer.innerHTML = html + "</div>";
            const cont = viewContainer.querySelector(".container");
            groups.forEach(g => {
                const card = document.createElement("div");
                card.className = "card";
                card.innerHTML = `<b>${g.name}</b><div>Kolon: ${g.sets.length}</div>
                    <button data-action="nav" data-page="mySets" data-id="${g.id}">Görüntüle</button>
                    <button data-action="deleteGroup" data-id="${g.id}" style="background:#d32f2f;margin-top:5px;">Sil</button>`;
                cont.appendChild(card);
            });
        };
    }

    function renderViewGroup(group) {
        const resText = (group.results.main.length > 0 || group.results.joker.length > 0) 
            ? `Ana: ${group.results.main.join(", ")} | Joker: ${group.results.joker.join(", ")}` : "Henüz girilmedi";
        
        let html = `<div class="container"><h3>${group.name}</h3>
            <button class="copy-btn" data-action="copySpecific" data-id="${group.id}">Panoya Kopyala</button>
            <div class="card">
                <b>Sonuçlar:</b> <span>${resText}</span><br>
                <button data-action="openPanel" data-id="${group.id}" data-max="${group.max}">Sonuç Gir (Kıyasla)</button>
            </div>`;
        
        group.sets.forEach((set, i) => {
            html += `<div class='card'><b>${i+1}.</b>${createBallsWithMatch(set, group.results)}</div>`;
        });
        
        html += `<button data-action="nav" data-page="mySets" style="background:#666;">Listeye Dön</button></div>`;
        viewContainer.innerHTML = html;
    }

    document.addEventListener("click", async (e) => {
        const target = e.target.closest("[data-action]");
        if (!target) return;
        const action = target.getAttribute("data-action");
        const id = target.getAttribute("data-id");

        if (action === "nav") {
            const page = target.getAttribute("data-page");
            history.pushState({page, groupId: id}, "");
            renderCurrentState(page, id);
        }

        if (action === "doGenerate") {
            const max = parseInt(document.getElementById("maxNumber").value);
            const per = parseInt(document.getElementById("perSet").value);
            const jMax = parseInt(document.getElementById("jokerMax").value);
            const jPer = parseInt(document.getElementById("jokerCount").value);
            const count = parseInt(document.getElementById("setCount").value);

            if ([max, per, jMax, jPer, count].some(isNaN) || per > max) return alert("Hata!");
            
            generatedSets = [];
            for (let i = 0; i < count; i++) {
                const getRand = (m, p) => {
                    let a = Array.from({length: m}, (_, i) => i + 1);
                    window.crypto.getRandomValues(new Uint32Array(a.length)).forEach((v, idx) => {
                        const j = v % (idx + 1);
                        [a[idx], a[j]] = [a[j], a[idx]];
                    });
                    return a.slice(0, p).sort((x,y)=>x-y);
                };
                generatedSets.push({numbers: getRand(max, per), jokers: getRand(jMax, jPer), max, jokerMax: jMax});
            }
            sessionStorage.setItem("tempGeneratedSets", JSON.stringify(generatedSets));
            updateGeneratedUI();
        }

        if (action === "saveGroup") {
            const name = document.getElementById("groupNameInput")?.value;
            if(!name?.trim() || generatedSets.length === 0) return alert("Eksik!");
            await atomicSave({
                id: String(Date.now()), name, sets: [...generatedSets],
                max: parseInt(document.getElementById("maxNumber").value),
                jokerMax: parseInt(document.getElementById("jokerMax").value),
                jokerPerSet: parseInt(document.getElementById("jokerCount").value),
                results: {main: [], joker: []}, version: Date.now()
            });
            sessionStorage.removeItem("tempGeneratedSets");
            renderCurrentState("mySets");
        }

        if (action === "deleteGroup" && confirm("Silinsin mi?")) {
            const db = await openDB();
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).delete(id);
            tx.oncomplete = () => renderCurrentState("mySets");
        }

        if (action === "openPanel") {
            const max = parseInt(target.getAttribute("data-max"));
            const db = await openDB();
            db.transaction(storeName).objectStore(storeName).get(id).onsuccess = (ev) => {
                const g = ev.target.result;
                let h = `<h4>Sayılar</h4><div class='ball-row'>`;
                for(let i=1; i<=max; i++) h += `<div class="ball ${g.results.main.includes(i)?'result-selected':''}" data-action="toggleMain" data-id="${id}" data-val="${i}">${i}</div>`;
                h += `</div>`;
                if (g.jokerPerSet > 0) {
                    h += `<h4>Joker</h4><div class='ball-row'>`;
                    for(let i=1; i<=g.jokerMax; i++) h += `<div class="ball joker ${g.results.joker.includes(i)?'result-selected':''}" data-action="toggleJoker" data-id="${id}" data-val="${i}">${i}</div>`;
                    h += `</div>`;
                }
                document.getElementById("resultNumbers").innerHTML = h;
                resultPanel.style.display = "block";
            };
        }

        if (action === "toggleMain" || action === "toggleJoker") {
            const val = parseInt(target.getAttribute("data-val"));
            const db = await openDB();
            const store = db.transaction(storeName, "readwrite").objectStore(storeName);
            store.get(id).onsuccess = async (ev) => {
                const g = ev.target.result;
                const field = action === "toggleMain" ? "main" : "joker";
                const idx = g.results[field].indexOf(val);
                idx > -1 ? g.results[field].splice(idx,1) : g.results[field].push(val);
                await atomicSave(g);
                target.classList.toggle("result-selected");
                renderViewGroup(g);
            };
        }

        if (action === "closePanel" || action === "confirmResult") resultPanel.style.display = "none";

        if (action === "cleanResult") {
            const activeId = document.querySelector("[data-action='toggleMain']")?.getAttribute("data-id");
            if(!activeId) return;
            const db = await openDB();
            const store = db.transaction(storeName, "readwrite").objectStore(storeName);
            store.get(activeId).onsuccess = async (ev) => {
                const g = ev.target.result;
                g.results = {main:[], joker:[]};
                await atomicSave(g);
                resultPanel.style.display = "none";
                renderViewGroup(g);
            };
        }
    });

    window.onpopstate = (e) => renderCurrentState(e.state?.page || "generate", e.state?.groupId);
    renderCurrentState("generate");
})();
