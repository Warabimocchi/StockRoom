// main.cjs - アプリケーションエントリーポイント
const { app, BrowserWindow } = require('electron');
const path = require('path');
const db = require('./db.cjs');
const ffmpegUtils = require('./ffmpeg-utils.cjs');
const fileUtils = require('./file-utils.cjs');
const ipcHandlers = require('./ipc-handlers.cjs');

// === パス定義 ===
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'database.sqlite');
const cachePath = path.join(userDataPath, 'cache');
const thumbnailPath = path.join(userDataPath, 'thumbnails');
const previewPath = path.join(userDataPath, 'previews');
const presetsPath = path.join(userDataPath, 'presets.json');

// ディレクトリ作成
fileUtils.ensureDirectories([cachePath, thumbnailPath, previewPath]);

let mainWindow;

// === メインウィンドウ作成 ===
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

// === アプリ初期化 ===
app.whenReady().then(() => {
    ffmpegUtils.initialize();
    db.initialize(dbPath);
    createMainWindow();

    // IPCハンドラー登録
    ipcHandlers.registerAll({
        mainWindow,
        cachePath,
        dbPath,
        thumbnailPath,
        previewPath,
        presetsPath
    });
});

// === アプリ終了時の処理（プレビューのみ削除） ===
app.on('before-quit', () => {
    console.log('🧹 プレビューキャッシュをクリーンアップ中...');
    try {
        const deletedCount = fileUtils.clearDirectory(previewPath);
        console.log(`✅ ${deletedCount}件のプレビューファイルを削除`);
    } catch (error) {
        console.error('❌ クリーンアップエラー:', error);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        db.close();
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
    }
});

// === 未処理の例外をキャッチ ===
process.on('uncaughtException', (error) => {
    console.error('未捕捉の例外:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('未処理のPromise拒否:', error);
});
