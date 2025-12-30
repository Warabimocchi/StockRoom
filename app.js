/**
 * HAP & DXV Manager - Frontend Logic (Part 1/2)
 * Core, Initialization, Rendering, Sidebar
 */

// =========================================
// 1. アプリケーション状態管理
// =========================================
class VideoManager {
    constructor() {
        this.videos = [];
        this.filters = { and: [], or: [], not: [] };
        this.activeVideo = null;
        this.currentPreviewPath = null;
        this.showUntaggedOnly = false;
    }

    // フィルター判定ロジック
    matchFilters(video) {
        // Untaggedフィルター
        if (this.showUntaggedOnly) {
            const hasUserTags = video.tags && video.tags.trim().length > 0;
            if (hasUserTags) return false;
        }

        const resolution = this.getResolutionCategory(video.height);
        const searchTerms = [
            ...(video.tags ? video.tags.split(',').map(t => t.trim().toLowerCase()) : []),
            video.codec.toLowerCase(),
            resolution
        ];

        // AND 検索
        if (this.filters.and.length > 0) {
            if (!this.filters.and.every(filter => searchTerms.includes(filter))) return false;
        }

        // OR 検索
        if (this.filters.or.length > 0) {
            if (!this.filters.or.some(filter => searchTerms.includes(filter))) return false;
        }

        // NOT 検索
        if (this.filters.not.length > 0) {
            if (this.filters.not.some(filter => searchTerms.includes(filter))) return false;
        }

        return true;
    }

    getResolutionCategory(height) {
        if (height >= 2160) return "4k";
        if (height >= 1080) return "1080p";
        if (height >= 720) return "720p";
        return "sd";
    }

    // 現在のフィルター条件に一致する動画リストを取得
    getFilteredVideos() {
        return this.videos.filter(video => this.matchFilters(video));
    }
}

// グローバルインスタンス
const videoManager = new VideoManager();
let sidebarTimeout = null;

// =========================================
// 2. 初期化処理
// =========================================
window.onload = async () => {
    try {
        // 動画データの読み込み
        videoManager.videos = await window.api.getVideos();
        
        // 初期描画
        render(true);
        
        // イベントリスナー設定
        if (typeof setupDragDropHandlers === 'function') {
            setupDragDropHandlers();
        }
        
        document.getElementById('grid').focus();
        showNotification('✅ Application loaded successfully', 'success');
    } catch (error) {
        showError('Failed to load application: ' + error.message);
    }
};

// =========================================
// 3. 描画システム
// =========================================
function render(forceRebuild = false) {
    try {
        const grid = document.getElementById('grid');
        const filteredVideos = videoManager.getFilteredVideos();
        
        // グリッドの再構築
        grid.innerHTML = '';
        
        filteredVideos.forEach((video) => {
            const originalIndex = videoManager.videos.indexOf(video);
            const card = createVideoCard(video, originalIndex);
            grid.appendChild(card);
        });
        
        // アクティブカードのハイライト復元
        if (videoManager.activeVideo) {
            const activeCard = Array.from(grid.children).find(card => {
                const index = parseInt(card.dataset.index);
                return videoManager.videos[index].path === videoManager.activeVideo.path;
            });
            if (activeCard) activeCard.classList.add('active');
        }
        
        // 関連情報の更新
        updateFilteredCount(filteredVideos.length);
        
        if (sidebarTimeout) clearTimeout(sidebarTimeout);
        sidebarTimeout = setTimeout(updateSidebar, 300);

    } catch (error) {
        showError('Rendering error: ' + error.message);
    }
}

function createVideoCard(video, index) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.index = index;
    card.onclick = () => showDetail(video);
    
    const imageSrc = video.thumbnail ? `file://${video.thumbnail}` : '';
    const videoSrc = video.path ? `file://${video.path}` : '';
    
    card.innerHTML = `
        <div class="media">
            <img src="${imageSrc}" alt="${video.name}" loading="lazy" />
            <video src="${videoSrc}" loop muted preload="none"></video>
            <div class="card-overlay">
                <span class="codec-badge">${video.codec}</span>
                <span class="resolution-badge">${videoManager.getResolutionCategory(video.height)}</span>
            </div>
        </div>
        <p title="${video.name}">${video.name}</p>
    `;
    return card;
}

function updateFilteredCount(count) {
    const countEl = document.getElementById('filtered-count');
    if (countEl) countEl.textContent = count;
}

// =========================================
// 4. サイドバー & フィルターUI
// =========================================
function updateSidebar() {
    const formats = new Set();
    const resolutions = new Set();
    const userTags = new Set();
    
    for (const video of videoManager.videos) {
        if (video.codec) formats.add(video.codec.toLowerCase());
        resolutions.add(videoManager.getResolutionCategory(video.height));
        if (video.tags) {
            video.tags.split(',').forEach(tag => {
                const trimmed = tag.trim().toLowerCase();
                if (trimmed) userTags.add(trimmed);
            });
        }
    }

    drawTagList('sys-format', formats, true);
    drawTagList('sys-res', resolutions, true);
    drawTagList('user-tags', userTags, false);
}

function drawTagList(elementId, tagSet, isSystem) {
    const container = document.getElementById(elementId);
    const tags = Array.from(tagSet).sort();
    
    if (container.dataset.tags === tags.join(',')) return;
    
    container.dataset.tags = tags.join(',');
    container.innerHTML = '';
    
    tags.forEach(tag => {
        const btn = document.createElement('div');
        btn.className = 'tag-item' + (isSystem ? ' sys' : '');
        btn.textContent = tag;
        btn.draggable = true;
        
        btn.onclick = () => {
            if (!videoManager.filters.and.includes(tag)) {
                videoManager.filters.and.push(tag);
                updateFilterUI();
            }
        };
        
        btn.ondragstart = (e) => e.dataTransfer.setData('text', tag);
        container.appendChild(btn);
    });
}

function toggleUntaggedFilter() {
    videoManager.showUntaggedOnly = !videoManager.showUntaggedOnly;
    const btn = document.getElementById('untagged-toggle');
    btn.classList.toggle('active', videoManager.showUntaggedOnly);
    btn.textContent = videoManager.showUntaggedOnly ? 'Showing Untagged' : 'Show Untagged Only';
    if (videoManager.showUntaggedOnly) showNotification('Filtering: Untagged videos only', 'info');
    render();
}

function updateFilterUI() {
    ['and', 'or', 'not'].forEach(type => {
        const zone = document.getElementById(`zone-${type}`);
        zone.innerHTML = videoManager.filters[type]
            .map(tag => `<span class="f-tag">${tag}<i onclick="removeFilter('${type}','${tag}')">&times;</i></span>`)
            .join('');
    });
    render();
}

function removeFilter(type, tag) {
    videoManager.filters[type] = videoManager.filters[type].filter(t => t !== tag);
    updateFilterUI();
}

function clearFilters() {
    videoManager.filters = { and: [], or: [], not: [] };
    updateFilterUI();
}
/**
 * HAP & DXV Manager - Frontend Logic (Part 2/2)
 * Detail Panel, Tagging, Export, Events
 */

// =========================================
// 5. 詳細パネル & プレビュー
// =========================================
async function showDetail(video) {
    videoManager.activeVideo = video;
    const panel = document.getElementById('info-panel');
    const videoArea = document.getElementById('panel-video');
    
    await cleanupPreview();
    
    panel.classList.add('open');
    document.getElementById('panel-name').textContent = video.name;
    document.getElementById('panel-specs').innerHTML = `
        <strong>Codec:</strong> ${video.codec}<br>
        <strong>Resolution:</strong> ${video.width}x${video.height}<br>
        <strong>FPS:</strong> ${video.fps}<br>
        <strong>Path:</strong> ${video.path}
    `;
    
    videoArea.innerHTML = '<div style="color:var(--accent); padding:20px; text-align:center;">Loading...</div>';

    try {
        const codec = video.codec.toLowerCase();
        const needsPreview = codec.includes('hap') || 
                            codec.includes('dxv') || 
                            video.path.toLowerCase().endsWith('.mov') ||
                            video.path.toLowerCase().endsWith('.mkv');

        let videoSrc = "";
        if (needsPreview) {
            videoArea.innerHTML = '<div style="color:var(--accent); padding:20px; text-align:center;">Generating Preview...</div>';
            videoManager.currentPreviewPath = await window.api.generatePreview(video.path);
            videoSrc = `file://${videoManager.currentPreviewPath}`;
        } else {
            videoSrc = `file://${video.path}`;
        }
        videoArea.innerHTML = `<video src="${videoSrc}" autoplay loop muted controls style="width:100%; height:100%; object-fit: contain;"></video>`;
    } catch (error) {
        videoArea.innerHTML = '<div style="color:#e74c3c; padding:20px; text-align:center;">Preview Error</div>';
        showError('Preview generation failed: ' + error.message);
    }

    renderTags(video);
    render();
}

function renderTags(video) {
    const tagArea = document.getElementById('panel-tags');
    tagArea.innerHTML = '';
    
    if (video.tags) {
        video.tags.split(',').forEach(tag => {
            const trimmed = tag.trim();
            if (!trimmed) return;
            
            const badge = document.createElement('span');
            badge.className = 'badge';
            badge.innerHTML = `${trimmed} <i onclick="removeTagFromVideo('${trimmed}')">&times;</i>`;
            tagArea.appendChild(badge);
        });
    }
}

async function cleanupPreview() {
    if (videoManager.currentPreviewPath) {
        await window.api.deletePreview(videoManager.currentPreviewPath);
        videoManager.currentPreviewPath = null;
    }
}

function togglePanel() {
    document.getElementById('info-panel').classList.remove('open');
    cleanupPreview();
    videoManager.activeVideo = null;
    render();
}

// =========================================
// 6. タグ操作
// =========================================
async function addNewTag(e) {
    if (e.key === 'Enter' && videoManager.activeVideo) {
        const newTag = e.target.value.trim();
        if (!newTag) return;
        await addTagToVideo(videoManager.activeVideo, newTag);
        e.target.value = '';
    }
}

async function addTagToVideo(video, tag) {
    try {
        let tagArray = video.tags ? video.tags.split(',').map(t => t.trim()) : [];
        if (tagArray.includes(tag)) {
            showNotification(`⚠️ Tag "${tag}" already exists`, 'warning');
            return;
        }
        tagArray.push(tag);
        const newTagsStr = tagArray.join(',');
        
        await window.api.updateTags({ path: video.path, tags: newTagsStr });
        video.tags = newTagsStr;
        
        if (videoManager.activeVideo && videoManager.activeVideo.path === video.path) {
            renderTags(video);
        }
        updateSidebar();
        showNotification(`✅ Tag "${tag}" added`, 'success');
    } catch (error) {
        showError('Failed to add tag: ' + error.message);
    }
}

async function removeTagFromVideo(tag) {
    if (!videoManager.activeVideo) return;
    try {
        let tagArray = videoManager.activeVideo.tags.split(',').map(t => t.trim()).filter(t => t !== tag);
        const newTagsStr = tagArray.join(',');
        
        await window.api.updateTags({ path: videoManager.activeVideo.path, tags: newTagsStr });
        videoManager.activeVideo.tags = newTagsStr;
        renderTags(videoManager.activeVideo);
        showNotification('✅ Tag removed', 'success');
    } catch (error) {
        showError('Failed to remove tag: ' + error.message);
    }
}

// =========================================
// 7. エクスポート機能
// =========================================
async function exportFilteredFiles() {
    const filteredVideos = videoManager.getFilteredVideos();
    if (filteredVideos.length === 0) {
        showNotification('No files to export', 'warning');
        return;
    }
    
    const filePaths = filteredVideos.map(v => v.path);
    const destinationDir = await window.api.selectExportDirectory();
    if (!destinationDir) return;
    
    showNotification(`Exporting ${filePaths.length} files...`, 'info');
    
    try {
        const result = await window.api.exportFiles({
            files: filePaths,
            destinationDir: destinationDir
        });
        
        const totalSizeMB = (result.totalSize / (1024 * 1024)).toFixed(2);
        if (result.success > 0) {
            showNotification(
                `✅ Exported ${result.success} files (${totalSizeMB} MB)` +
                (result.failed > 0 ? ` | ❌ Failed: ${result.failed}` : ''),
                result.failed > 0 ? 'warning' : 'success'
            );
        } else {
            showNotification('❌ Export failed', 'error');
        }
    } catch (error) {
        console.error('Export error:', error);
        showNotification('❌ Export failed: ' + error.message, 'error');
    }
}

// =========================================
// 8. イベント & ユーティリティ
// =========================================

function setupDragDropHandlers() {
    // フィルターゾーン
    document.querySelectorAll('.zone').forEach(zone => {
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('over');
            const tag = e.dataTransfer.getData('text');
            const type = zone.id.replace('zone-', '');
            if (tag && !videoManager.filters[type].includes(tag)) {
                videoManager.filters[type].push(tag);
                updateFilterUI();
            }
        });
    });

    // タグ付け（詳細パネル）
    const panelTags = document.getElementById('panel-tags');
    panelTags.addEventListener('dragover', (e) => { e.preventDefault(); panelTags.style.background = 'rgba(255,255,255,0.1)'; });
    panelTags.addEventListener('dragleave', () => { panelTags.style.background = ''; });
    panelTags.addEventListener('drop', async (e) => {
        e.preventDefault();
        panelTags.style.background = '';
        const tag = e.dataTransfer.getData('text');
        if (tag && videoManager.activeVideo) await addTagToVideo(videoManager.activeVideo, tag);
    });

    // ファイルドロップ（インポート）
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes('Files')) document.getElementById('drop-overlay').style.display = 'flex';
    });
    document.addEventListener('dragleave', (e) => {
        if (!e.relatedTarget) document.getElementById('drop-overlay').style.display = 'none';
    });
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        document.getElementById('drop-overlay').style.display = 'none';
        if (e.dataTransfer.types.includes('Files')) {
            const paths = Array.from(e.dataTransfer.files).map(file => window.api.getPathForFile(file));
            if (paths.length > 0) window.api.analyze(paths);
        }
    });
}

// =========================================
// キーボードショートカット (修正版)
// =========================================
document.addEventListener('keydown', (e) => {
    // 入力フォーム使用中は無効化
    if (document.activeElement.tagName === 'INPUT') return;
    
    // カードナビゲーション
    if (['ArrowRight', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault(); // スクロール防止
        
        const visibleCards = Array.from(document.querySelectorAll('.card'));
        if (visibleCards.length === 0) return;
        
        const currentIndex = visibleCards.findIndex(c => c.classList.contains('active'));
        let nextIndex;
        
        if (currentIndex === -1) {
            // 何も選択されていない場合は先頭を選択
            nextIndex = 0;
        } else {
            if (e.key === 'ArrowRight') {
                // 右: (現在 + 1) % 全数 でループ
                nextIndex = (currentIndex + 1) % visibleCards.length;
            } else {
                // 左: (現在 - 1 + 全数) % 全数 でループ（負の数対策）
                nextIndex = (currentIndex - 1 + visibleCards.length) % visibleCards.length;
            }
        }
        
        // カードをクリックして選択状態にし、視界にスクロール
        const targetCard = visibleCards[nextIndex];
        targetCard.click();
        targetCard.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    
    // エスケープキー
    if (e.key === 'Escape') {
        togglePanel();
        hideShortcuts();
    }
});


// プログレス表示
window.api.onProgress(data => {
    const progressDiv = document.getElementById('progress');
    progressDiv.classList.remove('hidden');
    
    const percentage = Math.round((data.current / data.total) * 100);
    document.getElementById('progress-fill').style.width = percentage + '%';
    document.getElementById('progress-percent').textContent = percentage + '%';
    document.getElementById('progress-status').textContent = `${data.current}/${data.total}`;
    document.getElementById('progress-file').textContent = data.file;
    
    if (data.data) {
        const existingIndex = videoManager.videos.findIndex(v => v.path === data.data.path);
        if (existingIndex !== -1) {
            videoManager.videos[existingIndex] = data.data;
        } else {
            videoManager.videos.unshift(data.data);
        }
        render();
    }
    
    if (data.current === data.total) {
        setTimeout(() => {
            progressDiv.classList.add('hidden');
            showNotification('✅ All videos processed', 'success');
        }, 2000);
    }
});

// 通知システム
function showNotification(message, type = 'info') {
    const notification = document.getElementById('error-notification');
    const messageEl = document.getElementById('error-message');
    if (notification && messageEl) {
        messageEl.textContent = message;
        notification.className = 'error-notification';
        const colors = { success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' };
        notification.style.background = colors[type] || colors.info;
        notification.classList.remove('hidden');
        setTimeout(() => notification.classList.add('hidden'), 3000);
    }
}
function showError(message) { showNotification(message, 'error'); }
function hideError() { document.getElementById('error-notification').classList.add('hidden'); }
function showShortcuts() { document.getElementById('shortcuts-modal').classList.remove('hidden'); }
function hideShortcuts() { document.getElementById('shortcuts-modal').classList.add('hidden'); }
