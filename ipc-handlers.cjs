// ipc-handlers.cjs - IPCハンドラー登録モジュール
const { ipcMain, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db.cjs');
const ffmpegUtils = require('./ffmpeg-utils.cjs');
const fileUtils = require('./file-utils.cjs');

/**
 * 全IPCハンドラーを登録する
 * @param {Object} config - 設定オブジェクト
 * @param {BrowserWindow} config.mainWindow - メインウィンドウ
 * @param {string} config.cachePath - キャッシュディレクトリパス
 * @param {string} config.dbPath - データベースファイルパス
 * @param {string} config.thumbnailPath - サムネイルディレクトリパス
 * @param {string} config.previewPath - プレビューディレクトリパス
 * @param {string} config.presetsPath - プリセットファイルパス
 */
function registerAll(config) {
    const { mainWindow, cachePath, dbPath, thumbnailPath, previewPath, presetsPath } = config;

    // === 動画データ取得 ===
    ipcMain.handle('get-videos', () => db.all("SELECT * FROM videos"));

    // === タグ操作 ===
    ipcMain.handle('update-tags', async (event, { path, tags }) => {
        return db.run("UPDATE videos SET tags = ? WHERE path = ?", [tags, path]);
    });

    ipcMain.handle('get-all-tags', async () => {
        const rows = await db.all("SELECT tags FROM videos WHERE tags IS NOT NULL AND tags != ''");
        const tagSet = new Set();
        rows.forEach(row => {
            row.tags.split(',').forEach(tag => {
                const trimmed = tag.trim();
                if (trimmed) tagSet.add(trimmed);
            });
        });
        return Array.from(tagSet).sort();
    });

    // === 動画解析 ===
    ipcMain.on('analyze-videos', async (event, paths) => {
        const allFiles = fileUtils.getFilesRecursively(paths);
        let current = 0;

        for (const filePath of allFiles) {
            current++;

            try {
                // 既存チェック
                const exists = await db.get("SELECT path FROM videos WHERE path=?", [filePath]);
                if (exists) {
                    mainWindow.webContents.send('progress', {
                        current,
                        total: allFiles.length,
                        file: `Skipped: ${path.basename(filePath)}`,
                        data: null
                    });
                    continue;
                }

                // 解析実行
                const data = await ffmpegUtils.analyzeLightweight(filePath, thumbnailPath);
                await db.run(
                    `INSERT INTO videos VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [data.path, data.name, data.thumbnail, data.preview, data.codec, data.width, data.height, data.fps, data.tags]
                );

                mainWindow.webContents.send('progress', {
                    current,
                    total: allFiles.length,
                    file: data.name,
                    data
                });

                // CPU負荷軽減
                if (current % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 30));
                }
            } catch (error) {
                console.error(`解析エラー ${filePath}:`, error);
                mainWindow.webContents.send('progress', {
                    current,
                    total: allFiles.length,
                    file: `Error: ${path.basename(filePath)}`,
                    data: null
                });
            }
        }
    });

    // === プレビュー生成・削除 ===
    ipcMain.handle('generate-preview', async (event, videoPath) => {
        return ffmpegUtils.generatePreview(videoPath, previewPath);
    });

    ipcMain.handle('delete-preview', async (event, filePath) => {
        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
                return true;
            } catch (e) {
                console.error('プレビュー削除エラー:', e);
                return false;
            }
        }
        return false;
    });

    // === 設定 ===
    ipcMain.handle('get-settings', async () => {
        let size = 0;
        try {
            const files = fs.readdirSync(cachePath);
            files.forEach(file => {
                const fp = path.join(cachePath, file);
                size += fs.statSync(fp).size;
            });
        } catch (error) {
            console.error('キャッシュサイズ計算エラー:', error);
        }

        return {
            cachePath,
            dbPath,
            cacheSize: `${(size / (1024 * 1024)).toFixed(2)} MB`
        };
    });

    ipcMain.on('open-settings', () => {
        const settingsWindow = new BrowserWindow({
            width: 600,
            height: 550,
            parent: mainWindow,
            modal: true,
            backgroundColor: '#1a1a1a',
            webPreferences: {
                preload: path.join(__dirname, 'preload.cjs'),
                contextIsolation: true,
                nodeIntegration: false
            }
        });

        settingsWindow.setMenu(null);
        settingsWindow.loadFile('settings.html');
    });

    // === プリセット管理 ===
    function ensurePresetsFile() {
        try {
            if (!fs.existsSync(presetsPath)) {
                fs.writeFileSync(presetsPath, JSON.stringify({ version: '1.0.0', presets: [] }, null, 2));
            }
        } catch (error) {
            console.error('プリセットファイル作成失敗:', error);
        }
    }

    ipcMain.handle('load-presets', async () => {
        try {
            ensurePresetsFile();
            const data = fs.readFileSync(presetsPath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('プリセット読み込み失敗:', error);
            return { version: '1.0.0', presets: [] };
        }
    });

    ipcMain.handle('save-preset', async (event, preset) => {
        try {
            ensurePresetsFile();
            const data = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));

            const index = data.presets.findIndex(p => p.id === preset.id);
            if (index !== -1) {
                data.presets[index] = preset;
            } else {
                data.presets.push(preset);
            }

            fs.writeFileSync(presetsPath, JSON.stringify(data, null, 2));
            return { success: true };
        } catch (error) {
            console.error('プリセット保存失敗:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-preset', async (event, presetId) => {
        try {
            const data = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
            data.presets = data.presets.filter(p => p.id !== presetId);
            fs.writeFileSync(presetsPath, JSON.stringify(data, null, 2));
            return { success: true };
        } catch (error) {
            console.error('プリセット削除失敗:', error);
            return { success: false, error: error.message };
        }
    });

    // === エクスポート ===
    ipcMain.handle('select-export-directory', async () => {
        const result = await dialog.showOpenDialog({
            properties: ['openDirectory', 'createDirectory'],
            title: 'エクスポート先を選択'
        });

        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });

    ipcMain.handle('export-files', async (event, { files, destinationDir }) => {
        try {
            return fileUtils.exportFiles(files, destinationDir);
        } catch (error) {
            console.error('エクスポート失敗:', error);
            return { success: 0, failed: files.length, errors: [error.message] };
        }
    });
}

module.exports = { registerAll };
