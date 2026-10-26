// ==========================================
// GITHUB CLOUD SYNC ENGINE (2-WAY REALTIME SYNC)
// ==========================================
// Đồng bộ tự động 2 chiều giữa Web (PC) và App (Android/iOS)
// thông qua GitHub REST API hoàn toàn miễn phí & an toàn.

const GitHubSync = (() => {
    const STORAGE_KEY_CONFIG = 'JLPT_GITHUB_CONFIG';
    const STORAGE_KEY_META = 'JLPT_SYNC_META';
    const FILE_PATH = 'data/cloud_sync.json';

    let pushTimer = null;
    let isSyncing = false;

    // 1. Mã hóa / Giải mã UTF-8 <-> Base64 chuẩn xác cho tiếng Nhật & tiếng Việt
    function utf8ToBase64(str) {
        const bytes = new TextEncoder().encode(str);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    function base64ToUtf8(base64) {
        const clean = base64.replace(/\s/g, '');
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder('utf-8').decode(bytes);
    }

    // 2. Lấy cấu hình GitHub (Tự động nhận diện nếu chạy trên github.io)
    function getConfig() {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_CONFIG) || '{}');
        let defaultOwner = 'Huy-21522145';
        let defaultRepo = 'JLPT-Hub';

        if (window.location.hostname.endsWith('.github.io')) {
            defaultOwner = window.location.hostname.replace('.github.io', '');
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            if (pathParts.length > 0) defaultRepo = pathParts[0];
        }

        return {
            owner: saved.owner || defaultOwner,
            repo: saved.repo || defaultRepo,
            branch: saved.branch || 'main',
            token: saved.token || '',
            autoSync: saved.autoSync !== false
        };
    }

    function saveConfig(newConfig) {
        localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(newConfig));
        updateUIStatus();
    }

    function getMeta() {
        return JSON.parse(localStorage.getItem(STORAGE_KEY_META) || '{"updatedAt":0,"lastSyncedAt":0,"pendingPush":false,"sha":""}');
    }

    function saveMeta(metaUpdate) {
        const current = getMeta();
        const next = { ...current, ...metaUpdate };
        localStorage.setItem(STORAGE_KEY_META, JSON.stringify(next));
        updateUIStatus();
        return next;
    }

    // 3. Cập nhật nút trạng thái Sync trên thanh Header
    function updateUIStatus(customState = null, customMessage = null) {
        const pill = document.getElementById('syncStatusPill');
        const text = document.getElementById('syncStatusText');
        const detailBox = document.getElementById('syncModalStatusText');
        if (!pill || !text) return;

        const cfg = getConfig();
        const meta = getMeta();

        pill.className = 'sync-pill';

        if (customState === 'syncing' || isSyncing) {
            pill.classList.add('syncing');
            text.textContent = customMessage || 'Đang đồng bộ...';
        } else if (customState === 'error') {
            pill.classList.add('error');
            text.textContent = customMessage || 'Lỗi Sync';
        } else if (!cfg.token) {
            text.textContent = '☁️ Cấu hình Sync';
        } else if (meta.pendingPush) {
            pill.classList.add('pending');
            text.textContent = navigator.onLine ? '⏳ Chờ đồng bộ' : '⚠️ Offline (Đã lưu máy)';
        } else if (meta.lastSyncedAt > 0) {
            pill.classList.add('synced');
            text.textContent = '☁️ Đã đồng bộ';
        } else {
            text.textContent = '☁️ Sẵn sàng Sync';
        }

        if (detailBox) {
            const lastTime = meta.lastSyncedAt ? new Date(meta.lastSyncedAt).toLocaleString('vi-VN') : 'Chưa đồng bộ lần nào';
            detailBox.innerHTML = `
                <div>📌 <strong>Kho lưu trữ:</strong> <code>${cfg.owner}/${cfg.repo}</code> (${cfg.branch})</div>
                <div>🕒 <strong>Lần đồng bộ cuối:</strong> ${lastTime}</div>
                <div>🔄 <strong>Trạng thái:</strong> ${meta.pendingPush ? '<span style="color:var(--accent-amber)">Có thay đổi trên máy chưa đẩy lên Cloud</span>' : '<span style="color:var(--accent-green)">Đã khớp 100% với GitHub</span>'}</div>
            `;
        }
    }

    // 4. Hợp nhất danh sách không trùng lặp theo ID
    function mergeArraysById(arr1 = [], arr2 = []) {
        const map = new Map();
        [...arr1, ...arr2].forEach(item => {
            if (!item) return;
            const id = item.id || `${item.word || item.structure || item.title}_${item.level}`;
            map.set(id, item);
        });
        return Array.from(map.values());
    }

    // 5. Đánh dấu có thay đổi ở máy và tự động đẩy ngầm lên GitHub
    function markLocalChanged() {
        saveMeta({ updatedAt: Date.now(), pendingPush: true });
        const cfg = getConfig();
        if (!cfg.token || !cfg.autoSync) return;

        clearTimeout(pushTimer);
        pushTimer = setTimeout(() => {
            if (navigator.onLine) {
                pushToGitHub(true);
            }
        }, 1200);
    }

    // 6. PULL: Tải dữ liệu từ GitHub về máy (Hỗ trợ cả API có Token và Public Raw)
    async function pullFromGitHub(silent = false) {
        const cfg = getConfig();
        if (!navigator.onLine) {
            if (!silent) alert('⚠️ Thiết bị đang Offline. Ứng dụng sẽ dùng dữ liệu đã lưu trong máy.');
            return false;
        }

        isSyncing = true;
        updateUIStatus('syncing', 'Đang tải Cloud...');

        try {
            let remoteData = null;
            let remoteSha = '';

            if (cfg.token && cfg.owner && cfg.repo) {
                const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${FILE_PATH}?ref=${cfg.branch}&t=${Date.now()}`;
                const res = await fetch(apiUrl, {
                    headers: {
                        'Authorization': `Bearer ${cfg.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    cache: 'no-store'
                });

                if (res.status === 200) {
                    const json = await res.json();
                    remoteSha = json.sha;
                    remoteData = JSON.parse(base64ToUtf8(json.content));
                } else if (res.status === 404) {
                    // File chưa tồn tại trên repo -> Đẩy bản hiện tại lên tạo mới
                    isSyncing = false;
                    return await pushToGitHub(silent);
                } else {
                    throw new Error(`GitHub API HTTP ${res.status}`);
                }
            } else {
                // Fallback đọc file tĩnh nếu chưa nhập Token
                const res = await fetch(`./${FILE_PATH}?t=${Date.now()}`, { cache: 'no-store' });
                if (res.ok) {
                    remoteData = await res.json();
                }
            }

            if (remoteData) {
                const meta = getMeta();
                const remoteUpdated = remoteData.updatedAt || 0;

                // Luôn gộp kho từ vựng nạp thêm (extraData) để không bao giờ mất từ mới
                const localExtra = JSON.parse(localStorage.getItem('JLPT_EXTRA_DATA') || '{"vocab":[],"grammar":[],"reading":[]}');
                const remoteExtra = remoteData.extraData || { vocab: [], grammar: [], reading: [] };

                const mergedExtra = {
                    vocab: mergeArraysById(localExtra.vocab, remoteExtra.vocab),
                    grammar: mergeArraysById(localExtra.grammar, remoteExtra.grammar),
                    reading: mergeArraysById(localExtra.reading, remoteExtra.reading)
                };
                localStorage.setItem('JLPT_EXTRA_DATA', JSON.stringify(mergedExtra));

                // Nếu bản trên Cloud mới hơn bản trên máy (hoặc máy chưa từng đồng bộ) -> cập nhật Favorites & Mastered
                if (remoteUpdated >= meta.updatedAt || !meta.pendingPush) {
                    if (Array.isArray(remoteData.favorites)) {
                        localStorage.setItem('JLPT_FAVORITES', JSON.stringify(remoteData.favorites));
                        if (typeof window.syncLocalSetsFromStorage === 'function') {
                            window.syncLocalSetsFromStorage();
                        }
                    }
                    if (Array.isArray(remoteData.mastered)) {
                        localStorage.setItem('JLPT_MASTERED', JSON.stringify(remoteData.mastered));
                        if (typeof window.syncLocalSetsFromStorage === 'function') {
                            window.syncLocalSetsFromStorage();
                        }
                    }
                    saveMeta({
                        updatedAt: Math.max(meta.updatedAt, remoteUpdated),
                        lastSyncedAt: Date.now(),
                        pendingPush: false,
                        sha: remoteSha || meta.sha
                    });
                } else if (meta.pendingPush && cfg.token) {
                    // Máy có thay đổi mới hơn Cloud -> Đẩy bản gộp lên Cloud
                    isSyncing = false;
                    await pushToGitHub(true);
                    return true;
                }

                // Render lại giao diện với dữ liệu mới
                if (typeof window.loadAllData === 'function' && typeof window.render === 'function') {
                    window.loadAllData();
                    window.render();
                }
            }

            isSyncing = false;
            updateUIStatus('synced');
            if (!silent) alert('✅ Đã đồng bộ dữ liệu mới nhất từ GitHub thành công!');
            return true;
        } catch (err) {
            console.warn('GitHub Pull Error:', err);
            isSyncing = false;
            updateUIStatus('error', 'Lỗi tải Cloud');
            if (!silent) alert('❌ Không thể tải dữ liệu từ GitHub. Vui lòng kiểm tra lại Tên Repo hoặc Token!\nChi tiết: ' + err.message);
            return false;
        }
    }

    // 7. PUSH: Đẩy toàn bộ dữ liệu nạp thêm & tiến độ học lên GitHub
    async function pushToGitHub(silent = false) {
        const cfg = getConfig();
        if (!cfg.token || !cfg.owner || !cfg.repo) {
            if (!silent) alert('⚠️ Vui lòng nhập GitHub Personal Access Token trong mục Cấu hình Sync trước!');
            return false;
        }
        if (!navigator.onLine) {
            updateUIStatus();
            if (!silent) alert('⚠️ Thiết bị đang Offline. Thay đổi đã được lưu vào máy và sẽ tự đẩy lên khi có mạng.');
            return false;
        }

        isSyncing = true;
        updateUIStatus('syncing', 'Đang lưu Cloud...');

        try {
            const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${FILE_PATH}`;
            let currentSha = getMeta().sha;

            // Lấy SHA mới nhất từ GitHub để tránh lỗi 409 Conflict
            const getRes = await fetch(`${apiUrl}?ref=${cfg.branch}&t=${Date.now()}`, {
                headers: {
                    'Authorization': `Bearer ${cfg.token}`,
                    'Accept': 'application/vnd.github.v3+json'
                },
                cache: 'no-store'
            });

            let remoteExtra = { vocab: [], grammar: [], reading: [] };
            if (getRes.status === 200) {
                const fileInfo = await getRes.json();
                currentSha = fileInfo.sha;
                try {
                    const parsedRemote = JSON.parse(base64ToUtf8(fileInfo.content));
                    if (parsedRemote.extraData) remoteExtra = parsedRemote.extraData;
                } catch (e) {}
            }

            // Gộp dữ liệu extraData giữa máy và Cloud
            const localExtra = JSON.parse(localStorage.getItem('JLPT_EXTRA_DATA') || '{"vocab":[],"grammar":[],"reading":[]}');
            const mergedExtra = {
                vocab: mergeArraysById(remoteExtra.vocab, localExtra.vocab),
                grammar: mergeArraysById(remoteExtra.grammar, localExtra.grammar),
                reading: mergeArraysById(remoteExtra.reading, localExtra.reading)
            };
            localStorage.setItem('JLPT_EXTRA_DATA', JSON.stringify(mergedExtra));

            const now = Date.now();
            const payloadObj = {
                version: '1.0.0',
                updatedAt: now,
                favorites: JSON.parse(localStorage.getItem('JLPT_FAVORITES') || '[]'),
                mastered: JSON.parse(localStorage.getItem('JLPT_MASTERED') || '[]'),
                extraData: mergedExtra
            };

            const contentBase64 = utf8ToBase64(JSON.stringify(payloadObj, null, 2));

            const body = {
                message: `🔄 Auto-sync JLPT Hub (${new Date(now).toLocaleString('vi-VN')})`,
                content: contentBase64,
                branch: cfg.branch
            };
            if (currentSha) body.sha = currentSha;

            const putRes = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${cfg.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });

            if (!putRes.ok) {
                const errData = await putRes.json().catch(() => ({}));
                throw new Error(errData.message || `HTTP ${putRes.status}`);
            }

            const putJson = await putRes.json();
            saveMeta({
                updatedAt: now,
                lastSyncedAt: now,
                pendingPush: false,
                sha: putJson.content?.sha || currentSha
            });

            isSyncing = false;
            updateUIStatus('synced');
            if (!silent) alert('🎉 Đã đẩy dữ liệu đồng bộ lên GitHub thành công!');
            return true;
        } catch (err) {
            console.warn('GitHub Push Error:', err);
            isSyncing = false;
            updateUIStatus('error', 'Lỗi lưu Cloud');
            if (!silent) alert('❌ Lỗi khi đẩy dữ liệu lên GitHub:\n' + err.message);
            return false;
        }
    }

    // Tự động đẩy dữ liệu tồn đọng ngay khi có mạng trở lại
    window.addEventListener('online', () => {
        updateUIStatus();
        const meta = getMeta();
        const cfg = getConfig();
        if (meta.pendingPush && cfg.token && cfg.autoSync) {
            pushToGitHub(true);
        } else {
            pullFromGitHub(true);
        }
    });

    window.addEventListener('offline', () => {
        updateUIStatus();
    });

    return {
        getConfig,
        saveConfig,
        getMeta,
        updateUIStatus,
        markLocalChanged,
        pull: pullFromGitHub,
        push: pushToGitHub
    };
})();
