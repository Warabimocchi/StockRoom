// main.cjs
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// モジュール初期化
let sqlite3, ffmpeg, ffmpegStatic;

async function initializeModules() {
    sqlite3 = require('sqlite3').verbose();
    const ffmpegModule = require('fluent-ffmpeg');
    ffmpeg = ffmpegModule;
    const ffmpegStaticModule = require('ffmpeg-static');
    ffmpegStatic = ffmpegStaticModule;

    // ffmpegのパス設定（asar環境での補正）
    if (ffmpegStatic) {
        const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
        ffmpeg.setFfmpegPath(ffmpegPath);
    }
}

// アプリケーション設定
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'database.sqlite');
const cachePath = path.join(userDataPath, 'cache');
const thumbnailPath = path.join(userDataPath, 'thumbnails'); // 👈 サムネイル専用
const previewPath = path.join(userDataPath, 'previews');     // 👈 プレビュー専用

// ディレクトリ作成
[cachePath, thumbnailPath, previewPath].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

let db;
let mainWindow;

// データベース初期化
function initializeDatabase() {
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

// メインウィンドウ作成
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        title: 'StockRoom',
        backgroundColor: '#121212',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    
    mainWindow.setMenu(null);
    mainWindow.loadFile('index.html');
}

// アプリ初期化
app.whenReady().then(async () => {
    await initializeModules();
    initializeDatabase();
    createMainWindow();
});

// データベース操作ヘルパー
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, (err) => err ? reject(err) : resolve());
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

// 軽量動画解析
async function analyzeLightweight(videoPath) {
    return new Promise((resolve, reject) => {
        if (!ffmpeg) {
            return reject(new Error('FFmpeg not initialized'));
        }

        const fileId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const thumbPath = path.join(thumbnailPath, `${fileId}.jpg`); // 👈 thumbnailPathに保存
        
        ffmpeg(videoPath).ffprobe((err, metadata) => {
            if (err) {
                console.error('FFprobe error:', err);
                return reject(err);
            }
            
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (!videoStream) {
                return reject(new Error('No video stream found'));
            }

            // サムネイル生成
            ffmpeg(videoPath)
                .inputOptions('-threads 1')
                .screenshots({
                    timestamps: [1],
                    filename: path.basename(thumbPath),
                    folder: thumbnailPath, // 👈 thumbnailPathに保存
                    size: '320x?'
                })
                .on('end', () => {
                    resolve({
                        path: videoPath,
                        name: path.basename(videoPath),
                        thumbnail: thumbPath,
                        preview: '',
                        codec: videoStream.codec_name || 'unknown',
                        width: videoStream.width || 0,
                        height: videoStream.height || 0,
                        fps: videoStream.r_frame_rate ? eval(videoStream.r_frame_rate).toFixed(2) : '0.00',
                        tags: ''
                    });
                })
                .on('error', (err) => {
                    console.error('Thumbnail generation error:', err);
                    reject(err);
                });
        });
    });
}

// プレビュー生成
ipcMain.handle('generate-preview', async (event, videoPath) => {
    if (!ffmpeg) {
        throw new Error('FFmpeg not initialized');
    }

    const previewFilePath = path.join(previewPath, `temp_${Date.now().toString(36)}.mp4`); // 👈 previewPathに保存
    
    return new Promise((resolve, reject) => {
        ffmpeg(videoPath)
            .inputOptions('-threads 1')
            .setStartTime(1)
            .setDuration(3)
            .size('480x?')
            .noAudio()
            .videoCodec('libx264')
            .outputOptions(['-preset ultrafast', '-crf 28'])
            .output(previewFilePath)
            .on('end', () => resolve(previewFilePath))
            .on('error', reject)
            .run();
    });
});

// プレビュー削除
ipcMain.handle('delete-preview', async (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            return true;
        } catch (e) {
            console.error('Preview deletion error:', e);
            return false;
        }
    }
    return false;
});

// ファイル再帰取得
function getFilesRecursively(paths) {
    let results = [];
    const videoExts = ['.mp4', '.mov', '.m4v', '.avi', '.mkv'];
    
    paths.forEach(p => {
        if (!fs.existsSync(p)) return;
        
        if (fs.statSync(p).isDirectory()) {
            const subFiles = fs.readdirSync(p).map(f => path.join(p, f));
            results = results.concat(getFilesRecursively(subFiles));
        } else if (videoExts.includes(path.extname(p).toLowerCase())) {
            results.push(p);
        }
    });
    
    return results;
}

// 動画解析
ipcMain.on('analyze-videos', async (event, paths) => {
    const allFiles = getFilesRecursively(paths);
    let current = 0;
    
    for (const filePath of allFiles) {
        current++;
        
        try {
            // 既存チェック
            const exists = await dbGet("SELECT path FROM videos WHERE path=?", [filePath]);
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
            const data = await analyzeLightweight(filePath);
            await dbRun(
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
            console.error(`Analysis error for ${filePath}:`, error);
            mainWindow.webContents.send('progress', {
                current,
                total: allFiles.length,
                file: `Error: ${path.basename(filePath)}`,
                data: null
            });
        }
    }
});

// IPC ハンドラー
ipcMain.handle('get-videos', () => dbAll("SELECT * FROM videos"));

ipcMain.handle('update-tags', async (event, { path, tags }) => {
    return dbRun("UPDATE videos SET tags = ? WHERE path = ?", [tags, path]);
});

ipcMain.handle('get-all-tags', async () => {
    const rows = await dbAll("SELECT tags FROM videos WHERE tags IS NOT NULL AND tags != ''");
    const tagSet = new Set();
    rows.forEach(row => {
        row.tags.split(',').forEach(tag => {
            const trimmed = tag.trim();
            if (trimmed) tagSet.add(trimmed);
        });
    });
    return Array.from(tagSet).sort();
});

ipcMain.handle('get-settings', async () => {
    let size = 0;
    try {
        const files = fs.readdirSync(cachePath);
        files.forEach(file => {
            const filePath = path.join(cachePath, file);
            size += fs.statSync(filePath).size;
        });
    } catch (error) {
        console.error('Cache size calculation error:', error);
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

// =========================================
// 👇 アプリ終了時の処理（プレビューのみ削除）
// =========================================
app.on('before-quit', async () => {
    console.log('🧹 Cleaning up preview cache...');
    
    try {
        // プレビュー動画のみ削除（サムネイルは残す）
        if (fs.existsSync(previewPath)) {
            const files = fs.readdirSync(previewPath);
            let deletedCount = 0;
            
            for (const file of files) {
                try {
                    fs.unlinkSync(path.join(previewPath, file));
                    deletedCount++;
                } catch (err) {
                    console.error(`Failed to delete ${file}:`, err);
                }
            }
            
            console.log(`✅ Deleted ${deletedCount} preview files`);
        }
    } catch (error) {
        console.error('❌ Cleanup error:', error);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (db) db.close();
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

// 未処理の例外をキャッチ
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled Rejection:', error);
});

// =========================================
// プリセット管理
// =========================================
const presetsPath = path.join(app.getPath('userData'), 'presets.json');

function ensurePresetsFile() {
    try {
        if (!fs.existsSync(presetsPath)) {
            fs.writeFileSync(presetsPath, JSON.stringify({ version: '1.0.0', presets: [] }, null, 2));
        }
    } catch (error) {
        console.error('Failed to create presets file:', error);
    }
}

ipcMain.handle('load-presets', async () => {
    try {
        ensurePresetsFile();
        const data = fs.readFileSync(presetsPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Failed to load presets:', error);
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
        console.error('Failed to save preset:', error);
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
        console.error('Failed to delete preset:', error);
        return { success: false, error: error.message };
    }
});

// =========================================
// Export機能
// =========================================
ipcMain.handle('select-export-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Export Destination'
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('export-files', async (event, { files, destinationDir }) => {
    try {
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
    } catch (error) {
        console.error('Export failed:', error);
        return { success: 0, failed: files.length, errors: [error.message] };
    }
});
