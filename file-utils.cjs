// file-utils.cjs - ファイル操作ユーティリティ
const fs = require('fs');
const path = require('path');

/** 対応する動画拡張子 */
const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm'];

/**
 * パスリストから動画ファイルを再帰的に取得する
 * @param {string[]} paths - ファイル/ディレクトリパスの配列
 * @returns {string[]} 動画ファイルパスの配列
 */
function getFilesRecursively(paths) {
    let results = [];

    paths.forEach(p => {
        if (!fs.existsSync(p)) return;

        if (fs.statSync(p).isDirectory()) {
            const subFiles = fs.readdirSync(p).map(f => path.join(p, f));
            results = results.concat(getFilesRecursively(subFiles));
        } else if (VIDEO_EXTS.includes(path.extname(p).toLowerCase())) {
            results.push(p);
        }
    });

    return results;
}

/**
 * ディレクトリを作成する（存在しない場合のみ）
 * @param {string[]} dirs - 作成するディレクトリパスの配列
 */
function ensureDirectories(dirs) {
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });
}

/**
 * ディレクトリ内の全ファイルを削除する
 * @param {string} dirPath - 対象ディレクトリパス
 * @returns {number} 削除したファイル数
 */
function clearDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;

    const files = fs.readdirSync(dirPath);
    let deletedCount = 0;

    for (const file of files) {
        try {
            fs.unlinkSync(path.join(dirPath, file));
            deletedCount++;
        } catch (err) {
            console.error(`ファイル削除失敗 ${file}:`, err);
        }
    }

    return deletedCount;
}

/**
 * ファイルをエクスポート（コピー）する
 * 同名ファイルが存在する場合はリネームして保存
 * @param {string[]} files - コピー元ファイルパスの配列
 * @param {string} destinationDir - コピー先ディレクトリ
 * @returns {Object} エクスポート結果
 */
function exportFiles(files, destinationDir) {
    const results = {
        success: 0,
        failed: 0,
        totalSize: 0,
        errors: []
    };

    for (const filePath of files) {
        try {
            const fileName = path.basename(filePath);
            let destPath = path.join(destinationDir, fileName);

            // 重複ファイルの処理：別名保存
            if (fs.existsSync(destPath)) {
                const parsed = path.parse(fileName);
                let counter = 1;
                while (fs.existsSync(destPath)) {
                    const newName = `${parsed.name}_${counter}${parsed.ext}`;
                    destPath = path.join(destinationDir, newName);
                    counter++;
                }
            }

            fs.copyFileSync(filePath, destPath);
            const stats = fs.statSync(filePath);
            results.totalSize += stats.size;
            results.success++;
        } catch (error) {
            results.failed++;
            results.errors.push({
                file: path.basename(filePath),
                error: error.message
            });
        }
    }

    return results;
}

module.exports = { VIDEO_EXTS, getFilesRecursively, ensureDirectories, clearDirectory, exportFiles };
