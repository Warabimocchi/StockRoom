// db.cjs - データベース操作モジュール
// ネイティブモジュールはasar外に展開されるため、パスを補正
const path = require('path');
let betterSqlitePath;
try {
    betterSqlitePath = require.resolve('better-sqlite3');
} catch {
    // asar環境ではapp.asar内のパスが解決できないため、app.asar.unpackedを参照
    betterSqlitePath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'node_modules', 'better-sqlite3');
}
const Database = require(betterSqlitePath);

let db;

/**
 * データベースを初期化する
 * @param {string} dbPath - データベースファイルのパス
 */
function initialize(dbPath) {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS videos (
        path TEXT PRIMARY KEY,
        name TEXT,
        thumbnail TEXT,
        preview TEXT,
        codec TEXT,
        width INTEGER,
        height INTEGER,
        fps TEXT,
        tags TEXT
    )`);
}

/** SQL実行（INSERT/UPDATE/DELETE用） */
const run = (sql, params = []) => {
    return db.prepare(sql).run(...params);
};

/** 単一行取得 */
const get = (sql, params = []) => {
    return db.prepare(sql).get(...params);
};

/** 複数行取得 */
const all = (sql, params = []) => {
    return db.prepare(sql).all(...params);
};

/** データベースを閉じる */
function close() {
    if (db) db.close();
}

module.exports = { initialize, run, get, all, close };
