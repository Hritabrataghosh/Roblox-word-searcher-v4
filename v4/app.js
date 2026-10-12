const SPAM_ENDINGS = ["alet", "uror", "zia", "elae", "erio", "vri", "vite", "acan", "dise", "eoli", "coel", "ters", "ller", "ally", "eric", "ses", "tes"];
const MAX_COLUMN = 50;
const shardCache = new Map();
const trapRotations = new Map();
let database = [];
let chosenCancel = null;
let searchSequence = 0;

const input = document.querySelector("#searchInput");
const status = document.querySelector("#databaseStatus");
const columns = ["normal", "casual3", "casual4", "self", "spam", "pro3", "pro4"];

function shardKey(value) {
    const code = value.codePointAt(0) ?? 0;
    return `u${code.toString(16).padStart(4, "0")}`;
}

function parseQuery(value) {
    if (!value.trim()) return null;
    if (value.startsWith(" ")) return { mode: "suffix", suffix: value.trim().toLowerCase() };
    const parts = value.trim().toLowerCase().split(/\s+/);
    if (parts.length > 1) return { mode: "both", prefix: parts[0], suffix: parts.slice(1).join("") };
    return { mode: "prefix", prefix: parts[0] };
}

function matches(word, query) {
    if (!query) return false;
    if (query.mode === "suffix") return word.endsWith(query.suffix);
    if (query.mode === "both") return word.startsWith(query.prefix) && word.endsWith(query.suffix);
    return word.startsWith(query.prefix);
}

function fetchShard(folder, first) {
    const key = `${folder}:${shardKey(first)}`;
    if (!shardCache.has(key)) {
        const url = `./data/${folder}/${shardKey(first)}.json`;
        shardCache.set(key, fetch(url).then(response => response.ok ? response.json() : []).catch(() => []));
    }
    return shardCache.get(key);
}

async function loadRows(folder, query) {
    if (!query) return [];
    if (query.mode !== "suffix") return fetchShard(folder, query.prefix[Symbol.iterator]().next().value);
    const initial = [...new Set(database.filter(word => word.endsWith(query.suffix)).map(word => [...word][0]).filter(Boolean))];
    const chunks = await Promise.all(initial.map(first => fetchShard(folder, first)));
    return chunks.flat();
}

function sortedWords(words) {
    return words.sort((a, b) => a.length - b.length || a.localeCompare(b));
}

function shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}

function randomSample(items, limit = MAX_COLUMN) {
    if (items.length <= limit) return shuffle([...items]);
    const sample = items.slice(0, limit);
    for (let i = limit; i < items.length; i++) {
        const j = Math.floor(Math.random() * (i + 1));
        if (j < limit) sample[j] = items[i];
    }
    return shuffle(sample);
}

function sampleNormal(query) {
    const sample = [];
    let seen = 0;
    for (const word of database) {
        if (!matches(word, query)) continue;
        seen++;
        if (sample.length < MAX_COLUMN) sample.push(word);
        else {
            const index = Math.floor(Math.random() * seen);
            if (index < MAX_COLUMN) sample[index] = word;
        }
    }
    return shuffle(sample);
}

function spreadTraps(records, rotationKey, symbolsFirst = false) {
    if (!records.length) return [];
    let rotation = trapRotations.get(rotationKey);
    if (!rotation) {
        const groups = new Map();
        for (const record of records) {
            if (!groups.has(record.trap)) groups.set(record.trap, []);
            groups.get(record.trap).push(record);
        }
        const orderedGroups = shuffle([...groups.values()].map(group => {
            const randomized = shuffle([...group]);
            return symbolsFirst
                ? randomized.sort((a, b) => Number(/[^a-z]/i.test(b.trap) || /[^a-z]/i.test(b.word)) - Number(/[^a-z]/i.test(a.trap) || /[^a-z]/i.test(a.word)))
                : randomized;
        }));
        if (symbolsFirst) {
            orderedGroups.sort((a, b) => {
                const aHasSymbols = a.some(item => /[^a-z]/i.test(item.trap) || /[^a-z]/i.test(item.word));
                const bHasSymbols = b.some(item => /[^a-z]/i.test(item.trap) || /[^a-z]/i.test(item.word));
                return Number(bHasSymbols) - Number(aHasSymbols);
            });
        }
        const sequence = [];
        for (let i = 0; sequence.length < records.length; i++) {
            let added = false;
            for (const group of orderedGroups) {
                if (group[i]) { sequence.push(group[i]); added = true; }
            }
            if (!added) break;
        }
        rotation = { sequence, cursor: 0 };
        trapRotations.set(rotationKey, rotation);
    }
    const count = Math.min(rotation.sequence.length, MAX_COLUMN);
    const output = Array.from({ length: count }, (_, offset) => rotation.sequence[(rotation.cursor + offset) % rotation.sequence.length]);
    rotation.cursor = (rotation.cursor + count) % rotation.sequence.length;
    return output;
}

function createWordCard(item, kind) {
    const word = typeof item === "string" ? item : item.word;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-card";
    button.title = "Tap to copy";
    const main = document.createElement("span");
    main.className = "word-main";
    const name = document.createElement("span");
    name.className = "word-name";
    name.textContent = word;
    main.append(name);
    if (item && typeof item === "object" && item.trap) {
        const meta = document.createElement("span");
        meta.className = "word-meta";
        const solveText = (item.solves ?? []).length ? ` · ${item.solves.join(", ")}` : "";
        meta.textContent = `TRAP: ${item.trap} · ${item.solveCount} SOLVES${solveText}`;
        main.append(meta);
    }
    const badge = document.createElement("span");
    badge.className = `word-badge ${kind.startsWith("pro") ? "pro" : kind === "self" ? "self" : "casual"}`;
    badge.textContent = kind === "self" ? "SELF" : kind.startsWith("pro") ? "PRO" : kind.startsWith("casual") ? "CASUAL" : "COPY";
    button.append(main, badge);
    button.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(word);
            badge.textContent = "COPIED";
            window.setTimeout(() => { badge.textContent = kind === "self" ? "SELF" : kind.startsWith("pro") ? "PRO" : kind.startsWith("casual") ? "CASUAL" : "COPY"; }, 900);
        } catch { /* Clipboard access can be unavailable on insecure origins. */ }
    });
    return button;
}

function renderColumn(name, records, kind = name) {
    const list = document.querySelector(`[data-list="${name}"]`);
    const count = document.querySelector(`[data-count="${name}"]`);
    list.replaceChildren();
    count.textContent = records.length.toLocaleString();
    if (!records.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "Search to see matching words.";
        list.append(empty);
        return;
    }
    for (const item of records.slice(0, MAX_COLUMN)) list.append(createWordCard(item, kind));
}

function renderCancelDetail(record) {
    const detail = document.querySelector("#cancelDetail");
    detail.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = `Cancel ${record.pattern}`;
    const explainer = document.createElement("p");
    explainer.textContent = `${record.groupCount} next-letter groups. Play the shortest listed word in each group; ${record.remainingGroups} groups remain.`;
    const steps = document.createElement("div");
    steps.className = "cancel-steps";
    for (const word of record.solves) {
        const step = document.createElement("div");
        step.className = "cancel-step";
        const group = document.createElement("small");
        group.textContent = `GROUP ${word.slice(record.pattern.length, record.pattern.length + 1) || "—"}`;
        const solve = document.createElement("strong");
        solve.textContent = word;
        step.append(group, solve);
        steps.append(step);
    }
    detail.append(heading, explainer, steps);
}

function renderCancelChoices(records) {
    const choices = document.querySelector("#cancelChoices");
    const count = document.querySelector('[data-count="spamCancels"]');
    choices.replaceChildren();
    count.textContent = Math.min(records.length, MAX_COLUMN).toLocaleString();
    if (!records.length) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = "No cancel needed here, or no matching combo. Type a combo with three or more next-letter groups.";
        choices.append(empty);
        chosenCancel = null;
        return;
    }
    const limit = randomSample(records);
    for (const record of limit) {
        const button = document.createElement("button");
        button.className = "cancel-choice";
        button.type = "button";
        button.setAttribute("aria-pressed", String(chosenCancel?.pattern === record.pattern));
        const pattern = document.createElement("strong");
        pattern.textContent = record.pattern;
        const info = document.createElement("span");
        info.textContent = `${record.groupCount} groups → ${record.remainingGroups}`;
        button.append(pattern, info);
        button.addEventListener("click", () => {
            chosenCancel = record;
            for (const option of choices.querySelectorAll(".cancel-choice")) option.setAttribute("aria-pressed", String(option === button));
            renderCancelDetail(record);
        });
        choices.append(button);
    }
    const selected = limit.find(record => record.pattern === chosenCancel?.pattern) ?? limit[0];
    chosenCancel = selected;
    for (const option of choices.querySelectorAll(".cancel-choice")) option.setAttribute("aria-pressed", String(option.querySelector("strong")?.textContent === selected.pattern));
    renderCancelDetail(selected);
}

async function update() {
    const sequence = ++searchSequence;
    const query = parseQuery(input.value);
    const normal = query ? sampleNormal(query) : [];
    renderColumn("normal", normal, "normal");
    if (!query) {
        for (const name of columns.slice(1)) renderColumn(name, [], name);
        renderCancelChoices([]);
        return;
    }
    const names = ["casual3", "casual4", "self", "spam", "pro3", "pro4", "spamCancels"];
    const results = await Promise.all(names.map(name => loadRows(name, query)));
    if (sequence !== searchSequence) return;
    const rows = Object.fromEntries(names.map((name, index) => [name, results[index]]));
    const queryKey = `${query.mode}:${query.prefix ?? ""}:${query.suffix ?? ""}`;
    for (const name of ["casual3", "casual4", "pro3", "pro4"]) {
        const matching = rows[name].filter(item => matches(item.word, query));
        renderColumn(name, spreadTraps(matching, `${name}:${queryKey}`, name.startsWith("pro")), name);
    }
    const self = rows.self.filter(item => matches(item.word, query));
    renderColumn("self", spreadTraps(self, `self:${queryKey}`), "self");
    const spam = rows.spam.filter(word => matches(word, query) && SPAM_ENDINGS.some(ending => word.endsWith(ending)));
    renderColumn("spam", randomSample(spam), "spam");
    const cancelMatches = rows.spamCancels.filter(item => matches(item.pattern, query));
    renderCancelChoices(cancelMatches);
}

input.addEventListener("input", () => { chosenCancel = null; update(); });
function clearSearch() { input.value = ""; chosenCancel = null; input.focus(); update(); }
document.querySelector("#clearSearch").addEventListener("click", clearSearch);
input.addEventListener("dblclick", clearSearch);
let lastTouchTap = 0;
input.addEventListener("pointerdown", event => {
    if (event.pointerType !== "touch") return;
    const now = Date.now();
    if (now - lastTouchTap < 350) { event.preventDefault(); clearSearch(); lastTouchTap = 0; }
    else lastTouchTap = now;
});
input.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); chosenCancel = null; update(); }
    if (event.key === "Escape") clearSearch();
});
document.addEventListener("keydown", event => { if (event.key === "Escape" && event.target !== input) clearSearch(); });

try {
    const response = await fetch("../lll.txt", { cache: "no-store" });
    if (!response.ok) throw new Error(`Word list request failed (${response.status})`);
    database = [...new Set((await response.text()).split(/\r?\n/).map(word => word.trim().toLowerCase()).filter(Boolean))];
    status.textContent = `${database.length.toLocaleString()} words loaded`;
    await update();
} catch (error) {
    status.textContent = "Word list could not load";
    document.querySelector(".search-hint").textContent = `${error.message}. Start V4 with npm run v4 from the project folder.`;
}
