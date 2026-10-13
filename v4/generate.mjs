import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "v4", "data");
const WORDS_FILE = path.join(ROOT, "lll.txt");
const LEGACY_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "legacy-spam-cancels.data.js");
const LETTER_ONLY = /^[a-z]+$/;
const PRO_WORD = /^(?=.*[a-z])\S+$/;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
const SPAM_ENDINGS = ["alet", "uror", "zia", "elae", "erio", "vri", "vite", "acan", "dise", "eoli", "coel", "ters", "ller", "ally", "eric", "ses", "tes"];
const MAX_EXAMPLES = 5;
const MAX_SPAM_PATTERN_LENGTH = 9;

function shardKey(value) {
    const code = value.codePointAt(0) ?? 0;
    return `u${code.toString(16).padStart(4, "0")}`;
}

function resetGenerated() {
    fs.rmSync(OUT, { recursive: true, force: true });
    fs.mkdirSync(OUT, { recursive: true });
    for (const folder of ["casual3", "casual4", "pro3", "pro4", "self", "spam", "spamCancels"]) {
        fs.mkdirSync(path.join(OUT, folder), { recursive: true });
    }
}

function readWords() {
    const all = [...new Set(fs.readFileSync(WORDS_FILE, "utf8")
        .split(/\r?\n/)
        .map(word => word.trim().toLowerCase())
        .filter(Boolean))].sort();
    return {
        all,
        casual: all.filter(word => LETTER_ONLY.test(word) && word.length >= 3),
        pro: all.filter(word => PRO_WORD.test(word) && word.length >= 3)
    };
}

function makePrefixMap(words) {
    const maps = { 3: new Map(), 4: new Map() };
    for (const word of words) {
        for (const length of [3, 4]) {
            if (word.length < length) continue;
            const prefix = word.slice(0, length);
            if (!maps[length].has(prefix)) maps[length].set(prefix, []);
            maps[length].get(prefix).push(word);
        }
    }
    return maps;
}

function isEasySolve(trap, solve) {
    if (!solve.startsWith(trap)) return false;
    const extra = solve.slice(trap.length);
    return extra === "e" || extra === "s" || extra === "es";
}

function hasEasyExtension(trap, wordSet) {
    return ["e", "s", "es"].some(ending => wordSet.has(trap + ending));
}

function solveCache(prefixMaps, words, casual) {
    const cache = new Map();
    return (trap, length) => {
        const key = `${length}:${trap}`;
        if (cache.has(key)) return cache.get(key);
        const candidates = prefixMaps[length].get(trap) ?? [];
        const solves = candidates.filter(word => {
            if (word === trap || (casual && isEasySolve(trap, word))) return false;
            // Every counted solve must be at least two letters longer than its trap.
            if (word.length < trap.length + 2) return false;
            return true;
        });
        solves.sort((a, b) => a.length - b.length || a.localeCompare(b));
        const record = { count: solves.length, examples: solves.slice(0, MAX_EXAMPLES) };
        cache.set(key, record);
        return record;
    };
}

function addToShard(shards, word, record) {
    const first = String.fromCodePoint(word.codePointAt(0));
    const key = shardKey(first);
    if (!shards.has(key)) shards.set(key, []);
    shards.get(key).push(record);
}

function writeShards(folder, shards, sortKey = null) {
    const target = path.join(OUT, folder);
    fs.mkdirSync(target, { recursive: true });
    for (const [key, rows] of shards) {
        if (sortKey) rows.sort((a, b) => String(a[sortKey] ?? a.word ?? a.pattern ?? "").localeCompare(String(b[sortKey] ?? b.word ?? b.pattern ?? ""))
            || String(a.word ?? a.pattern ?? "").localeCompare(String(b.word ?? b.pattern ?? "")));
        fs.writeFileSync(path.join(target, `${key}.json`), JSON.stringify(rows));
    }
}

function roundRobin(records) {
    const byTrap = new Map();
    for (const record of records) {
        if (!byTrap.has(record.trap)) byTrap.set(record.trap, []);
        byTrap.get(record.trap).push(record);
    }
    const groups = [...byTrap.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [, group] of groups) {
        group.sort((a, b) => b.difficulty - a.difficulty || a.word.length - b.word.length || a.word.localeCompare(b.word));
    }
    const output = [];
    let round = 0;
    while (groups.some(([, group]) => round < group.length)) {
        for (const [, group] of groups) if (group[round]) output.push(group[round]);
        round++;
    }
    return output;
}

function buildTrapLists({ all, casual, pro }) {
    const casualSet = new Set(casual);

    const casualSolves = solveCache(makePrefixMap(casual), casual, true);
    const proSolves = solveCache(makePrefixMap(pro), pro, false);
    const buckets = Object.fromEntries(["casual3", "casual4", "pro3", "pro4", "self"].map(key => [key, new Map()]));

    for (const word of casual) {
        if (word.length === 3 || word.length === 4) {
            const selfSolves = casualSolves(word, word.length);
            if (selfSolves.count >= 3 && !hasEasyExtension(word, casualSet)) {
                addToShard(buckets.self, word, {
                    word, trap: word, type: "self", solveCount: selfSolves.count, solves: selfSolves.examples,
                    difficulty: selfSolves.examples[0]?.length - word.length
                });
            }
        }
        for (const length of [3, 4]) {
            if (word.length <= length) continue;
            const trap = word.slice(-length);
            if (casualSet.has(trap)) continue;
            const solves = casualSolves(trap, length);
            if (solves.count < 3) continue;
            addToShard(buckets[`casual${length}`], word, {
                word, trap, solveCount: solves.count, solves: solves.examples,
                difficulty: solves.examples[0]?.length - length
            });
        }
    }

    for (const word of pro) {
        for (const length of [3, 4]) {
            if (word.length <= length) continue;
            const trap = word.slice(-length);
            const solves = proSolves(trap, length);
            if (solves.count < 1 || solves.count > 5) continue;
            addToShard(buckets[`pro${length}`], word, {
                word, trap, solveCount: solves.count, solves: solves.examples,
                difficulty: solves.examples[0]?.length - length
            });
        }
    }

    for (const name of ["casual3", "casual4", "pro3", "pro4"]) {
        for (const [key, rows] of buckets[name]) buckets[name].set(key, roundRobin(rows));
    }
    writeShards("casual3", buckets.casual3);
    writeShards("casual4", buckets.casual4);
    writeShards("pro3", buckets.pro3);
    writeShards("pro4", buckets.pro4);
    writeShards("self", buckets.self, "word");
    return Object.fromEntries(Object.entries(buckets).map(([key, shards]) => [key, [...shards.values()].reduce((sum, rows) => sum + rows.length, 0)]));
}

function buildSpamLists(casual) {
    const spam = new Map();
    const spamCancels = new Map();
    for (const word of casual) {
        for (const ending of SPAM_ENDINGS) {
            if (word.endsWith(ending)) {
                const key = shardKey(String.fromCodePoint(word.codePointAt(0)));
                if (!spam.has(key)) spam.set(key, []);
                spam.get(key).push(word);
            }
        }
    }

    const groupsByPattern = new Map();
    for (const word of casual) {
        for (let length = 3; length <= Math.min(MAX_SPAM_PATTERN_LENGTH, word.length - 1); length++) {
            const pattern = word.slice(0, length);
            const group = word[length];
            if (!groupsByPattern.has(pattern)) groupsByPattern.set(pattern, new Map());
            const groups = groupsByPattern.get(pattern);
            const current = groups.get(group);
            if (!current || word.length < current.length || (word.length === current.length && word < current)) groups.set(group, word);
        }
    }

    const legacyPatterns = new Set();

    if (fs.existsSync(LEGACY_FILE)) {
        const source = fs.readFileSync(LEGACY_FILE, "utf8");
        const legacy = JSON.parse(source.slice(source.indexOf("=") + 1).trim().replace(/;\s*$/, ""));
        for (const item of legacy) {
            const pattern = String(item.pattern ?? "").toLowerCase();
            if (/^[a-z]{3,}$/.test(pattern)) legacyPatterns.add(pattern);
        }
    }

    const cancelRecords = new Map();
    for (const pattern of legacyPatterns) {
        if (!groupsByPattern.has(pattern)) groupsByPattern.set(pattern, new Map());
    }
    for (const [pattern, groups] of groupsByPattern) {
        if (groups.size < 3) continue;
        const shortest = [...groups.entries()].map(([group, word]) => ({ group, word }))
            .sort((a, b) => a.word.length - b.word.length || a.word.localeCompare(b.word));
        const solves = shortest.slice(0, groups.size - 2).map(item => item.word);
        cancelRecords.set(pattern, {
            pattern, groupCount: groups.size, solves,
            remainingGroups: groups.size - new Set(solves.map(word => word[pattern.length])).size,
            source: "generated"
        });
    }

    for (const record of cancelRecords.values()) {
        record.solves.sort((a, b) => a.length - b.length || a.localeCompare(b));
        addToShard(spamCancels, record.pattern, record);
    }
    for (const rows of spam.values()) rows.sort((a, b) => a.length - b.length || a.localeCompare(b));
    writeShards("spam", spam);
    writeShards("spamCancels", spamCancels, "pattern");
    return { spamWords: [...spam.values()].reduce((n, rows) => n + rows.length, 0), spamCancelPatterns: [...spamCancels.values()].reduce((n, rows) => n + rows.length, 0) };
}

resetGenerated();
const database = readWords();
console.log(`Loaded ${database.all.length.toLocaleString()} unique words (${database.casual.length.toLocaleString()} letters-only; ${database.pro.length.toLocaleString()} pro-compatible).`);
const traps = buildTrapLists(database);
const spam = buildSpamLists(database.casual);
fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify({ source: "../lll.txt", sourceWords: database.all.length, casualWords: database.casual.length, proWords: database.pro.length, spamEndings: SPAM_ENDINGS, traps, ...spam }, null, 2));
console.log("Generated V4 data:", JSON.stringify({ traps, ...spam }));
