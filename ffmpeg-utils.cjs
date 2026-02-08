// ffmpeg-utils.cjs - FFmpeg関連ユーティリティ
const path = require('path');

let ffmpeg;

/**
 * FFmpegモジュールを初期化する
 * ffmpeg-staticのパスを設定（asar環境での補正含む）
 */
function initialize() {
    ffmpeg = require('fluent-ffmpeg');
    const ffmpegStatic = require('ffmpeg-static');

    if (ffmpegStatic) {
        const ffmpegPath = ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
        ffmpeg.setFfmpegPath(ffmpegPath);
    }
}

/**
 * フレームレート文字列を安全にパースする
 * 例: "30000/1001" → "29.97", "30" → "30.00"
 * @param {string} rFrameRate - ffprobeから取得したr_frame_rate
 * @returns {string} 小数点2桁のFPS文字列
 */
function parseFrameRate(rFrameRate) {
    if (!rFrameRate) return '0.00';

    const parts = rFrameRate.split('/');
    if (parts.length === 2) {
        const numerator = parseFloat(parts[0]);
        const denominator = parseFloat(parts[1]);
        if (denominator !== 0 && !isNaN(numerator) && !isNaN(denominator)) {
            return (numerator / denominator).toFixed(2);
        }
    }

    const num = parseFloat(rFrameRate);
    return isNaN(num) ? '0.00' : num.toFixed(2);
}

/**
 * 動画を軽量解析してサムネイルを生成する
 * @param {string} videoPath - 動画ファイルパス
 * @param {string} thumbnailDir - サムネイル保存ディレクトリ
 * @returns {Promise<Object>} 動画メタデータ
 */
function analyzeLightweight(videoPath, thumbnailDir) {
    return new Promise((resolve, reject) => {
        if (!ffmpeg) {
            return reject(new Error('FFmpegが初期化されていません'));
        }

        const fileId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const thumbPath = path.join(thumbnailDir, `${fileId}.jpg`);

        ffmpeg(videoPath).ffprobe((err, metadata) => {
            if (err) {
                console.error('FFprobeエラー:', err);
                return reject(err);
            }

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            if (!videoStream) {
                return reject(new Error('動画ストリームが見つかりません'));
            }

            // サムネイル生成
            ffmpeg(videoPath)
                .inputOptions('-threads 1')
                .screenshots({
                    timestamps: [1],
                    filename: path.basename(thumbPath),
                    folder: thumbnailDir,
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
                        fps: parseFrameRate(videoStream.r_frame_rate),
                        tags: ''
                    });
                })
                .on('error', (err) => {
                    console.error('サムネイル生成エラー:', err);
                    reject(err);
                });
        });
    });
}

/**
 * プレビュー動画を生成する
 * @param {string} videoPath - 元動画ファイルパス
 * @param {string} previewDir - プレビュー保存ディレクトリ
 * @returns {Promise<string>} 生成されたプレビューファイルパス
 */
function generatePreview(videoPath, previewDir) {
    if (!ffmpeg) {
        return Promise.reject(new Error('FFmpegが初期化されていません'));
    }

    const previewFilePath = path.join(previewDir, `temp_${Date.now().toString(36)}.mp4`);

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
}

module.exports = { initialize, parseFrameRate, analyzeLightweight, generatePreview };
