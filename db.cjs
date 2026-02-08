// db.cjs - データベース操作モジュール
const sqlite3 = require('sqlite3').verbose();

let db;

/**
 * データベースを初期化する
 * @param {string} dbPath - データベースファイルのパス
 */
function initialize(dbPath) {
    db = new sqlite3.Database(dbPath);
    db.serialize(() => {
        db.run("PRAGMA journal_mode = WAL;");
        db.run(`CREATE TABLE IF NOT EXISTS videos (
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
    });
}

/** SQL実行（INSERT/UPDATE/DELETE用） */
const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => err ? reject(err) : resolve());
});

/** 単一行取得 */
const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

/** 複数行取得 */
const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

/** データベースを閉じる */
function close() {
    if (db) db.close();
}

module.exports = { initialize, run, get, all, close };
