// ==========================================
// JLPT SMART HUB PRO - CORE APPLICATION LOGIC
// ==========================================

let currentTab = 'vocab';
let currentLevel = 'N2'; // Mặc định mở N2 nơi có sẵn 664 từ vựng & 94 ngữ pháp
let currentStatus = 'ALL';
let currentTag = 'ALL';

// Phân trang chống nghẽn DOM (60fps)
const PAGE_SIZE = 30;
let currentPage = 1;
let filteredListCache = [];

// Danh sách yêu thích & đã thuộc
let favorites = new Set(JSON.parse(localStorage.getItem('JLPT_FAVORITES') || '[]'));
let mastered = new Set(JSON.parse(localStorage.getItem('JLPT_MASTERED') || '[]'));

// Kho dữ liệu gộp trong RAM
let appData = { vocab: [], grammar: [], reading: [] };

// Đồng bộ lại Set từ localStorage khi GitHubSync.pull() cập nhật
window.syncLocalSetsFromStorage = function() {
    favorites = new Set(JSON.parse(localStorage.getItem('JLPT_FAVORITES') || '[]'));
    mastered = new Set(JSON.parse(localStorage.getItem('JLPT_MASTERED') || '[]'));
};

window.loadAllData = function() {
    const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
    let vList = [], gList = [], rList = [];

    levels.forEach(lvl => {
        const dataObj = window['JLPT_DATA_' + lvl];
        if (dataObj) {
            if (dataObj.vocab) vList.push(...dataObj.vocab);
            if (dataObj.grammar) gList.push(...dataObj.grammar);
            if (dataObj.reading) rList.push(...dataObj.reading);
        }
    });

    // Dữ liệu nạp thêm từ LocalStorage / Cloud Sync
    const extraData = JSON.parse(localStorage.getItem('JLPT_EXTRA_DATA') || '{"vocab":[],"grammar":[],"reading":[]}');
    vList.push(...(extraData.vocab || []));
    gList.push(...(extraData.grammar || []));
    rList.push(...(extraData.reading || []));

    // Lọc trùng ID (Ưu tiên bản cập nhật mới hơn ở cuối)
    const uniqueById = (arr) => {
        const map = new Map();
        arr.forEach(item => {
            if (!item) return;
            const id = item.id || ((item.word || item.structure || item.title) + '_' + item.level);
            map.set(id, item);
        });
        return Array.from(map.values());
    };

    appData.vocab = uniqueById(vList);
    appData.grammar = uniqueById(gList);
    appData.reading = uniqueById(rList);

    updateHeaderCounts();
    renderTagFilters();
};

function updateHeaderCounts() {
    document.getElementById('count-vocab').textContent = appData.vocab.length;
    document.getElementById('count-grammar').textContent = appData.grammar.length;
    document.getElementById('count-reading').textContent = appData.reading.length;

    ['N5', 'N4', 'N3', 'N2', 'N1'].forEach(lvl => {
        const cnt = appData[currentTab]
            ? appData[currentTab].filter(item => item.level === lvl).length
            : appData.vocab.filter(v => v.level === lvl).length;
        const el = document.getElementById('lvl-cnt-' + lvl);
        if (el) el.textContent = cnt;
    });

    document.getElementById('count-starred').textContent = favorites.size;
    document.getElementById('count-mastered').textContent = mastered.size;
}

function renderTagFilters() {
    const container = document.getElementById('tagFilterContainer');
    if (!container) return;
    if (currentTab !== 'vocab') {
        container.innerHTML = '';
        return;
    }

    const tags = new Set();
    appData.vocab.forEach(v => { if (v.tag) tags.add(v.tag); });

    let html = `<span style="font-size:0.8rem; color:var(--text-muted); margin-left:4px; margin-right:4px;">Tag:</span>`;
    html += `<button class="filter-tag ${currentTag === 'ALL' ? 'active' : ''}" onclick="setTagFilter('ALL', this)">Tất cả</button>`;
    tags.forEach(t => {
        html += `<button class="filter-tag ${currentTag === t ? 'active' : ''}" onclick="setTagFilter('${t}', this)">${t}</button>`;
    });
    container.innerHTML = html;
}

// ==========================================
// ĐIỀU HƯỚNG TAB, LEVEL & BỘ LỌC
// ==========================================
function switchTab(tab, btn) {
    currentTab = tab;
    currentPage = 1;
    document.querySelectorAll('.main-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateHeaderCounts();
    renderTagFilters();
    render();
}

function setLevel(lvl, btn) {
    currentLevel = lvl;
    currentPage = 1;
    document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
}

function setStatusFilter(status, btn) {
    currentStatus = status;
    currentPage = 1;
    document.querySelectorAll('.toolbar-top .filter-tag').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
}

function setTagFilter(tag, btn) {
    currentTag = tag;
    currentPage = 1;
    document.querySelectorAll('#tagFilterContainer .filter-tag').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    render();
}

let searchTimer = null;
function handleSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        currentPage = 1;
        render();
    }, 180);
}

function toggleBlur() {
    document.body.classList.toggle('hide-meaning');
    const isHidden = document.body.classList.contains('hide-meaning');
    const btn = document.getElementById('flashcardBtn');
    const mobileIcon = document.getElementById('mobileBlurIcon');
    const mobileLabel = document.getElementById('mobileBlurLabel');

    if (btn) {
        btn.textContent = isHidden ? '👀 Hiện nghĩa' : '🙈 Che nghĩa';
        if (isHidden) btn.classList.add('btn-primary');
        else btn.classList.remove('btn-primary');
    }
    if (mobileIcon) mobileIcon.textContent = isHidden ? '👀' : '🙈';
    if (mobileLabel) mobileLabel.textContent = isHidden ? 'Hiện nghĩa' : 'Che nghĩa';
}

function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleNavHome(e) {
    scrollToTop();
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (e && e.currentTarget) e.currentTarget.classList.add('active');
}

// ==========================================
// RENDER SIÊU TỐC (ZERO-LAG DOM)
// ==========================================
window.render = function() {
    const query = (document.getElementById('searchInput').value || '').toLowerCase().trim();
    const container = document.getElementById('contentArea');
    const loadMoreArea = document.getElementById('loadMoreArea');

    let rawSource = appData[currentTab] || [];

    filteredListCache = rawSource.filter(item => {
        if (currentLevel !== 'ALL' && item.level !== currentLevel) return false;

        if (currentTab === 'vocab') {
            const isStar = favorites.has(item.id);
            const isMast = mastered.has(item.id);
            if (currentStatus === 'STARRED' && !isStar) return false;
            if (currentStatus === 'MASTERED' && !isMast) return false;
            if (currentStatus === 'LEARNING' && isMast) return false;
            if (currentTag !== 'ALL' && item.tag !== currentTag) return false;
        }

        if (query) {
            if (currentTab === 'vocab') {
                const str = `${item.word} ${item.reading || ''} ${item.hanviet || ''} ${item.meaning || ''} ${item.exJ || ''} ${item.exV || ''} ${item.note || ''} ${item.source || ''}`.toLowerCase();
                if (!str.includes(query)) return false;
            } else if (currentTab === 'grammar') {
                const str = `${item.structure || ''} ${item.meaning || ''} ${item.formation || ''} ${item.note || ''} ${item.exJ || ''}`.toLowerCase();
                if (!str.includes(query)) return false;
            } else if (currentTab === 'reading') {
                const str = `${item.title || ''} ${item.passage || ''} ${item.translation || ''}`.toLowerCase();
                if (!str.includes(query)) return false;
            }
        }
        return true;
    });

    const total = filteredListCache.length;
    const visibleItems = filteredListCache.slice(0, currentPage * PAGE_SIZE);

    const tabNames = { vocab: 'từ vựng', grammar: 'cấu trúc', reading: 'bài đọc' };
    document.getElementById('displayCountInfo').textContent =
        `Hiển thị ${visibleItems.length} / ${total} ${tabNames[currentTab]} (${currentLevel})`;

    if (total > visibleItems.length) {
        loadMoreArea.style.display = 'block';
        document.getElementById('remainingCount').textContent = `${total - visibleItems.length} ${tabNames[currentTab]}`;
    } else {
        loadMoreArea.style.display = 'none';
    }

    if (currentTab === 'vocab') {
        if (visibleItems.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-muted);">Không tìm thấy từ vựng nào phù hợp với bộ lọc.</div>`;
            return;
        }

        const cardsHtml = visibleItems.map(item => {
            const isStar = favorites.has(item.id);
            const isMast = mastered.has(item.id);
            return `
                <div class="card ${isMast ? 'mastered' : ''}" id="card-${item.id}">
                    <div>
                        <div class="card-header">
                            <div class="card-title-group">
                                <span class="title-jp" onclick="speakText('${escapeQuotes(item.word)}')">${item.word}</span>
                                <span class="reading">${item.reading || ''}</span>
                                ${item.hanviet ? `<span class="hanviet">${item.hanviet}</span>` : ''}
                            </div>
                            <div class="card-badges">
                                <span class="badge level">${item.level}</span>
                                ${item.tag ? `<span class="badge">${item.tag}</span>` : ''}
                            </div>
                        </div>
                        <div class="meaning">${item.meaning}</div>
                        <div class="box-sub">
                            <div class="ex-jp">
                                <span>${item.exJ || ''}</span>
                                <button class="icon-btn" onclick="speakText('${escapeQuotes(item.exJ || '')}', event)" title="Nghe câu ví dụ">🔊</button>
                            </div>
                            <div class="ex-vi">${item.exV || ''}</div>
                        </div>
                        ${item.note ? `<div class="note-box"><strong>💡 Ghi chú:</strong> ${item.note}</div>` : ''}
                    </div>
                    <div class="card-footer">
                        <span>Nguồn: ${item.source || 'Tự học'}</span>
                        <div class="card-actions">
                            <button class="icon-btn" onclick="lookupMazii('${escapeQuotes(item.word)}')" title="Tra Mazii">🔍 Mazii</button>
                            <button class="icon-btn ${isStar ? 'active-star' : ''}" onclick="toggleFavorite('${item.id}', event)" title="Đánh dấu cần ôn">
                                ${isStar ? '⭐ Đã lưu' : '☆ Lưu'}
                            </button>
                            <button class="icon-btn ${isMast ? 'active-check' : ''}" onclick="toggleMastered('${item.id}', event)" title="Đánh dấu đã thuộc">
                                ${isMast ? '✅ Đã thuộc' : '○ Thuộc'}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `<div class="grid">${cardsHtml}</div>`;
    } else if (currentTab === 'grammar') {
        if (visibleItems.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-muted);">Không có cấu trúc ngữ pháp nào trong cấp độ này.</div>`;
            return;
        }

        const cardsHtml = visibleItems.map(item => `
            <div class="card">
                <div>
                    <div class="card-header">
                        <span class="title-jp" style="color: var(--accent); font-size:1.35rem;">${item.structure}</span>
                        <span class="badge level">${item.level}</span>
                    </div>
                    <div class="meaning">${item.meaning}</div>
                    <div class="box-sub" style="border-left-color: var(--accent-amber);">
                        <strong>🔗 Cách nối:</strong> ${item.formation || ''}
                    </div>
                    <div class="box-sub">
                        <div class="ex-jp">
                            <span>${item.exJ || ''}</span>
                            <button class="icon-btn" onclick="speakText('${escapeQuotes(item.exJ || '')}', event)">🔊</button>
                        </div>
                        <div class="ex-vi">${item.exV || ''}</div>
                    </div>
                    ${item.note ? `<div class="note-box"><strong>💡 Lưu ý:</strong> ${item.note}</div>` : ''}
                </div>
                <div class="card-footer">
                    <span>Nguồn: ${item.source || 'JLPT'}</span>
                </div>
            </div>
        `).join('');

        container.innerHTML = `<div class="grid">${cardsHtml}</div>`;
    } else if (currentTab === 'reading') {
        if (visibleItems.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:50px; color:var(--text-muted);">Chưa có bài đọc hiểu nào trong cấp độ này. Hãy nhắn Agent tạo bài đọc!</div>`;
            return;
        }

        const readingsHtml = visibleItems.map((item, rIdx) => {
            let qHtml = (item.questions || []).map((qObj, qIdx) => {
                let optsHtml = (qObj.options || []).map((opt, oIdx) => `
                    <label class="option-label" id="opt-${rIdx}-${qIdx}-${oIdx}">
                        <input type="radio" name="q-${rIdx}-${qIdx}" value="${oIdx}" style="margin-right:8px;">
                        ${opt}
                    </label>
                `).join('');

                return `
                    <div class="question-block">
                        <p style="font-weight:bold; margin-bottom:10px;">❓ Câu hỏi ${qIdx + 1}: ${qObj.q}</p>
                        ${optsHtml}
                        <div id="exp-${rIdx}-${qIdx}" style="display:none; margin-top:10px; padding:12px; background:rgba(56,189,248,0.1); border-radius:8px; font-size:0.9rem; border-left:3px solid var(--accent);">
                            <strong>📌 Giải thích:</strong> ${qObj.explanation}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="reading-card">
                    <div class="card-header">
                        <h3 style="color:#fff;">📰 ${item.title}</h3>
                        <div>
                            <span class="badge level">${item.level}</span>
                            <span class="badge">${item.source || 'Dokkai'}</span>
                        </div>
                    </div>
                    <div class="passage-box">${item.passage}</div>
                    ${qHtml}
                    <div style="margin-top: 20px;">
                        <button class="btn btn-success" onclick="checkReading(${rIdx})">
                            ✅ Nộp bài & Xem giải thích chi tiết
                        </button>
                    </div>
                    <div class="solution-box" id="sol-${rIdx}">
                        <h4 style="color: var(--accent-green); margin-bottom:8px;">🇻🇳 Bản dịch toàn bài:</h4>
                        <p style="white-space: pre-line; margin-bottom: 15px; color:#cbd5e1;">${item.translation}</p>
                        ${item.vocabHints && item.vocabHints.length ? `
                            <h4 style="color: var(--accent); margin-bottom:8px;">📌 Từ vựng quan trọng:</h4>
                            <ul style="padding-left: 20px; color:#bae6fd;">
                                ${item.vocabHints.map(v => `<li>${v}</li>`).join('')}
                            </ul>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = readingsHtml;
    }
};

function loadMore() {
    currentPage++;
    render();
}

// ==========================================
// TÍNH NĂNG HỌC TẬP & AUTO-SYNC
// ==========================================
function escapeQuotes(str) {
    return (str || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

function speakText(text, event) {
    if (event) event.stopPropagation();
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
}

function lookupMazii(word) {
    window.open(`https://mazii.net/search/word/ja/${encodeURIComponent(word)}`, '_blank');
}

function toggleFavorite(id, event) {
    if (event) event.stopPropagation();
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    localStorage.setItem('JLPT_FAVORITES', JSON.stringify([...favorites]));
    updateHeaderCounts();
    render();
    GitHubSync.markLocalChanged();
}

function toggleMastered(id, event) {
    if (event) event.stopPropagation();
    if (mastered.has(id)) mastered.delete(id);
    else mastered.add(id);
    localStorage.setItem('JLPT_MASTERED', JSON.stringify([...mastered]));
    updateHeaderCounts();
    render();
    GitHubSync.markLocalChanged();
}

window.checkReading = function(rIdx) {
    const readingItem = (filteredListCache || appData.reading)[rIdx];
    if (!readingItem || !readingItem.questions) return;

    readingItem.questions.forEach((qObj, qIdx) => {
        const selected = document.querySelector(`input[name="q-${rIdx}-${qIdx}"]:checked`);
        qObj.options.forEach((_, oIdx) => {
            const label = document.getElementById(`opt-${rIdx}-${qIdx}-${oIdx}`);
            if (!label) return;
            label.classList.remove('correct', 'wrong');
            if (oIdx === qObj.answer) {
                label.classList.add('correct');
            } else if (selected && parseInt(selected.value) === oIdx) {
                label.classList.add('wrong');
            }
        });
        const exp = document.getElementById(`exp-${rIdx}-${qIdx}`);
        if (exp) exp.style.display = 'block';
    });
    const sol = document.getElementById(`sol-${rIdx}`);
    if (sol) sol.style.display = 'block';
};

// ==========================================
// CHẾ ĐỘ FLASHCARD CHUYÊN SÂU
// ==========================================
let flashcardList = [];
let fcIndex = 0;

function openFlashcardModal() {
    flashcardList = (filteredListCache && filteredListCache.length > 0 && currentTab === 'vocab')
        ? [...filteredListCache]
        : [...appData.vocab];
    if (flashcardList.length === 0) {
        alert('Không có từ vựng nào trong danh sách hiện tại để luyện flashcard!');
        return;
    }
    fcIndex = 0;
    document.getElementById('flashcardModal').style.display = 'flex';
    showCurrentCard();
}

function closeFlashcardModal() {
    document.getElementById('flashcardModal').style.display = 'none';
    document.getElementById('fcInner').classList.remove('flipped');
}

function showCurrentCard() {
    const card = flashcardList[fcIndex];
    if (!card) return;

    document.getElementById('fcInner').classList.remove('flipped');
    document.getElementById('fcWord').textContent = card.word || '';
    document.getElementById('fcHanviet').textContent = card.hanviet ? `[ ${card.hanviet} ]` : '';
    document.getElementById('fcLevel').textContent = card.level || 'JLPT';
    document.getElementById('fcReading').textContent = card.reading || '';
    document.getElementById('fcMeaning').textContent = card.meaning || '';
    document.getElementById('fcExample').textContent = card.exJ ? `${card.exJ} - ${card.exV || ''}` : '';
    document.getElementById('fcNote').textContent = card.note ? `💡 ${card.note}` : '';
    document.getElementById('fcProgress').textContent = `${fcIndex + 1} / ${flashcardList.length}`;
}

function flipCurrentCard() {
    document.getElementById('fcInner').classList.toggle('flipped');
}

function nextCard() {
    if (fcIndex < flashcardList.length - 1) {
        fcIndex++;
        showCurrentCard();
    }
}

function prevCard() {
    if (fcIndex > 0) {
        fcIndex--;
        showCurrentCard();
    }
}

function shuffleCards() {
    for (let i = flashcardList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [flashcardList[i], flashcardList[j]] = [flashcardList[j], flashcardList[i]];
    }
    fcIndex = 0;
    showCurrentCard();
}

function speakCurrentCard(e) {
    if (e) e.stopPropagation();
    const card = flashcardList[fcIndex];
    if (card) speakText(card.word);
}

function toggleStarCurrentCard() {
    const card = flashcardList[fcIndex];
    if (card) toggleFavorite(card.id);
}

// ==========================================
// MINI QUIZ PRO (DUOLINGO STYLE STEP-BY-STEP)
// ==========================================
let quizState = {
    questions: [],
    currentIndex: 0,
    score: 0,
    streak: 0,
    maxStreak: 0,
    history: [],
    failedItems: []
};

function openQuizModal(customList = null) {
    let pool = customList;
    if (!pool) {
        pool = (filteredListCache && filteredListCache.length >= 4 && currentTab === 'vocab')
            ? filteredListCache
            : appData.vocab;
    }
    if (pool.length < 4) {
        alert('Cần ít nhất 4 từ vựng để tạo bài trắc nghiệm!');
        return;
    }

    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(10, shuffled.length));
    const distractorPool = appData.vocab.length >= 4 ? appData.vocab : pool;

    quizState.questions = selected.map(item => {
        const others = distractorPool.filter(x => x.id !== item.id && x.meaning !== item.meaning);
        const shuffledOthers = others.sort(() => 0.5 - Math.random()).slice(0, 3);
        const options = [
            { text: item.meaning, correct: true },
            { text: (shuffledOthers[0] && shuffledOthers[0].meaning) || 'Nghĩa khác A', correct: false },
            { text: (shuffledOthers[1] && shuffledOthers[1].meaning) || 'Nghĩa khác B', correct: false },
            { text: (shuffledOthers[2] && shuffledOthers[2].meaning) || 'Nghĩa khác C', correct: false }
        ].sort(() => 0.5 - Math.random());

        return { item, options, answered: false, selectedIdx: null };
    });

    quizState.currentIndex = 0;
    quizState.score = 0;
    quizState.streak = 0;
    quizState.maxStreak = 0;
    quizState.history = [];
    quizState.failedItems = [];

    document.getElementById('quizModal').style.display = 'flex';
    document.getElementById('quizQuestionScreen').style.display = 'block';
    document.getElementById('quizSummaryScreen').style.display = 'none';

    renderQuizStep();
}

function closeQuizModal() {
    document.getElementById('quizModal').style.display = 'none';
}

function renderQuizStep() {
    const q = quizState.questions[quizState.currentIndex];
    const total = quizState.questions.length;
    const currentNum = quizState.currentIndex + 1;

    document.getElementById('quizStepText').textContent = `Câu ${currentNum}/${total}`;
    document.getElementById('quizStreakText').textContent = quizState.streak;
    document.getElementById('quizScoreText').textContent = quizState.score;

    const progressPercent = ((currentNum - 1) / total) * 100;
    document.getElementById('quizProgressBar').style.width = `${progressPercent}%`;

    document.getElementById('quizCardLevel').textContent = q.item.level || 'JLPT';
    document.getElementById('quizCardSource').textContent = q.item.source || 'JLPT';
    document.getElementById('quizCardWord').textContent = q.item.word || '';
    document.getElementById('quizCardHanviet').textContent = q.item.hanviet ? `[ ${q.item.hanviet} ]` : (q.item.reading || '');

    const isStar = favorites.has(q.item.id);
    const starBtn = document.getElementById('quizStarBtn');
    starBtn.textContent = isStar ? '⭐ Đã lưu' : '☆ Lưu từ này';
    starBtn.className = isStar ? 'btn btn-amber' : 'btn';

    document.getElementById('quizFeedbackBox').style.display = 'none';
    document.getElementById('quizNextBtn').style.display = 'none';

    speakText(q.item.word);

    const container = document.getElementById('quizOptionsContainer');
    const keys = ['A', 'B', 'C', 'D'];
    container.innerHTML = q.options.map((opt, oIdx) => `
        <button class="quiz-opt-btn" id="qbtn-${oIdx}" onclick="selectQuizAnswer(${oIdx})">
            <span class="quiz-opt-key">${keys[oIdx]}</span>
            <span style="flex:1;">${opt.text}</span>
        </button>
    `).join('');
}

function selectQuizAnswer(optIdx) {
    const q = quizState.questions[quizState.currentIndex];
    if (q.answered) return;
    q.answered = true;
    q.selectedIdx = optIdx;

    const isCorrect = q.options[optIdx].correct;
    const correctOpt = q.options.find(o => o.correct);

    q.options.forEach((opt, idx) => {
        const btn = document.getElementById(`qbtn-${idx}`);
        if (!btn) return;
        btn.disabled = true;
        if (opt.correct) {
            btn.classList.add('correct');
        } else if (idx === optIdx) {
            btn.classList.add('wrong');
        }
    });

    if (isCorrect) {
        quizState.score++;
        quizState.streak++;
        if (quizState.streak > quizState.maxStreak) quizState.maxStreak = quizState.streak;
    } else {
        quizState.streak = 0;
        quizState.failedItems.push(q.item);
    }

    quizState.history.push({
        item: q.item,
        userText: q.options[optIdx].text,
        correctText: correctOpt.text,
        isCorrect
    });

    document.getElementById('quizStreakText').textContent = quizState.streak;
    document.getElementById('quizScoreText').textContent = quizState.score;

    const fbBox = document.getElementById('quizFeedbackBox');
    const fbStatus = document.getElementById('quizFeedbackStatus');
    const fbDetails = document.getElementById('quizFeedbackDetails');

    if (isCorrect) {
        fbStatus.innerHTML = `<span style="color:var(--accent-green);">🎉 Chính xác! Tuyệt vời!</span>`;
        fbBox.style.borderColor = 'var(--accent-green)';
    } else {
        fbStatus.innerHTML = `<span style="color:#f87171;">❌ Tiếc quá, chưa chính xác!</span>`;
        fbBox.style.borderColor = '#ef4444';
    }

    fbDetails.innerHTML = `
        <div style="font-size:0.95rem; font-weight:700; color:#fff; margin-bottom:4px;">
            ${q.item.word} ${q.item.reading ? `<span style="color:var(--accent); font-weight:normal;">(${q.item.reading})</span>` : ''}: 
            <span style="color:#4ade80;">${q.item.meaning}</span>
        </div>
        ${q.item.exJ ? `<div style="color:#bae6fd; margin-top:4px;"><strong>Ví dụ:</strong> ${q.item.exJ}</div>` : ''}
        ${q.item.exV ? `<div style="color:var(--text-muted); font-size:0.84rem;">${q.item.exV}</div>` : ''}
        ${q.item.note ? `<div style="color:#93c5fd; font-size:0.82rem; margin-top:4px;">💡 ${q.item.note}</div>` : ''}
    `;
    fbBox.style.display = 'block';

    const nextBtn = document.getElementById('quizNextBtn');
    const isLast = quizState.currentIndex === quizState.questions.length - 1;
    nextBtn.textContent = isLast ? 'Xem tổng kết 🏆' : 'Câu tiếp theo ➔';
    nextBtn.style.display = 'inline-flex';
}

function nextQuizQuestion() {
    if (quizState.currentIndex < quizState.questions.length - 1) {
        quizState.currentIndex++;
        renderQuizStep();
    } else {
        showQuizSummary();
    }
}

function speakQuizWord() {
    const q = quizState.questions[quizState.currentIndex];
    if (q && q.item) speakText(q.item.word);
}

function starQuizWord() {
    const q = quizState.questions[quizState.currentIndex];
    if (!q || !q.item) return;
    toggleFavorite(q.item.id);
    const isStar = favorites.has(q.item.id);
    const starBtn = document.getElementById('quizStarBtn');
    starBtn.textContent = isStar ? '⭐ Đã lưu' : '☆ Lưu từ này';
    starBtn.className = isStar ? 'btn btn-amber' : 'btn';
}

function showQuizSummary() {
    document.getElementById('quizQuestionScreen').style.display = 'none';
    const summary = document.getElementById('quizSummaryScreen');
    summary.style.display = 'block';

    const total = quizState.questions.length;
    const score = quizState.score;
    const percent = Math.round((score / total) * 100);

    document.getElementById('quizProgressBar').style.width = '100%';
    document.getElementById('quizFinalPercent').textContent = `${percent}%`;
    document.getElementById('quizFinalRatio').textContent = `${score}/${total} câu đúng`;

    const titleEl = document.getElementById('quizTitleEvaluation');
    const descEl = document.getElementById('quizDescEvaluation');
    const retryFailedBtn = document.getElementById('quizRetryFailedBtn');

    if (percent === 100) {
        titleEl.textContent = '🌟 Xuất sắc tuyệt đối (100%)!';
        descEl.textContent = `Bạn đã trả lời đúng toàn bộ ${total} câu hỏi! Chuỗi cao nhất đạt: 🔥 ${quizState.maxStreak}`;
        retryFailedBtn.style.display = 'none';
    } else if (percent >= 80) {
        titleEl.textContent = '🎉 Rất tốt!';
        descEl.textContent = `Bạn nắm rất vững các từ vựng này. Hãy tiếp tục duy trì phong độ!`;
        retryFailedBtn.style.display = 'inline-flex';
    } else if (percent >= 50) {
        titleEl.textContent = '👍 Khá tốt!';
        descEl.textContent = `Bạn đã trả lời đúng ${score}/${total} câu. Hãy luyện lại những câu sai để nhớ sâu hơn nhé!`;
        retryFailedBtn.style.display = 'inline-flex';
    } else {
        titleEl.textContent = '💪 Cố lên nhé!';
        descEl.textContent = `Đừng nản lòng, từ vựng cần ôn luyện lặp lại nhiều lần. Hãy bấm "Luyện lại các câu sai" bên dưới!`;
        retryFailedBtn.style.display = 'inline-flex';
    }

    const reviewList = document.getElementById('quizReviewList');
    reviewList.innerHTML = quizState.history.map(h => `
        <div class="quiz-review-item ${h.isCorrect ? 'is-correct' : 'is-wrong'}">
            <div>
                <span style="font-weight:700; color:#fff; font-size:1rem; cursor:pointer;" onclick="speakText('${escapeQuotes(h.item.word)}')">
                    ${h.item.word} ${h.item.reading ? `<span style="font-size:0.85rem; color:var(--accent);">(${h.item.reading})</span>` : ''}
                </span>
                <div style="font-size:0.82rem; color:var(--text-muted); margin-top:2px;">
                    ${h.isCorrect ? `<span style="color:var(--accent-green);">✓ ${h.correctText}</span>` : `<span style="color:#f87171;">✕ Chọn: ${h.userText}</span> ➔ <strong style="color:var(--accent-green);">${h.correctText}</strong>`}
                </div>
            </div>
            <button class="icon-btn" onclick="toggleFavorite('${h.item.id}', event)" title="Lưu từ này">
                ${favorites.has(h.item.id) ? '⭐' : '☆'}
            </button>
        </div>
    `).join('');
}

function restartQuizWithFailedWords() {
    if (!quizState.failedItems || quizState.failedItems.length < 4) {
        const pool = (filteredListCache && filteredListCache.length >= 4) ? filteredListCache : appData.vocab;
        const extra = pool.filter(x => !quizState.failedItems.some(f => f.id === x.id)).slice(0, 4 - quizState.failedItems.length);
        openQuizModal([...quizState.failedItems, ...extra]);
    } else {
        openQuizModal([...quizState.failedItems]);
    }
}

// ==========================================
// QUẢN LÝ DỮ LIỆU: IMPORT, EXPORT & CLOUD SYNC MODAL
// ==========================================
function openModal() { document.getElementById('importModal').style.display = 'flex'; }
function closeModal() { document.getElementById('importModal').style.display = 'none'; }

function importJSON() {
    try {
        const raw = document.getElementById('jsonInput').value.trim();
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const currentExtra = JSON.parse(localStorage.getItem('JLPT_EXTRA_DATA') || '{"vocab":[],"grammar":[],"reading":[]}');

        if (parsed.vocab && Array.isArray(parsed.vocab)) currentExtra.vocab.push(...parsed.vocab);
        if (parsed.grammar && Array.isArray(parsed.grammar)) currentExtra.grammar.push(...parsed.grammar);
        if (parsed.reading && Array.isArray(parsed.reading)) currentExtra.reading.push(...parsed.reading);

        localStorage.setItem('JLPT_EXTRA_DATA', JSON.stringify(currentExtra));
        loadAllData();
        render();
        closeModal();
        document.getElementById('jsonInput').value = '';

        // Tự động đẩy dữ liệu vừa dán lên GitHub Cloud Sync
        GitHubSync.markLocalChanged();
        alert('🎉 Đã nạp thêm dữ liệu thành công! Hệ thống đang tự động đồng bộ lên GitHub.');
    } catch (e) {
        alert('Lỗi định dạng JSON! Hãy copy đúng khối JSON do JLPT Data Agent xuất ra.');
    }
}

function exportDataBackup() {
    const fullBackup = {
        vocab: appData.vocab,
        grammar: appData.grammar,
        reading: appData.reading,
        favorites: [...favorites],
        mastered: [...mastered]
    };
    const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `JLPT_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

// GitHub Sync Modal
function openSyncModal() {
    closeUtilsModal();
    const cfg = GitHubSync.getConfig();
    document.getElementById('ghOwnerInput').value = cfg.owner || '';
    document.getElementById('ghRepoInput').value = cfg.repo || '';
    document.getElementById('ghBranchInput').value = cfg.branch || 'main';
    document.getElementById('ghTokenInput').value = cfg.token || '';
    GitHubSync.updateUIStatus();
    document.getElementById('syncModal').style.display = 'flex';
}

function closeSyncModal() {
    document.getElementById('syncModal').style.display = 'none';
}

async function saveSyncSettings() {
    const owner = document.getElementById('ghOwnerInput').value.trim();
    const repo = document.getElementById('ghRepoInput').value.trim();
    const branch = document.getElementById('ghBranchInput').value.trim() || 'main';
    const token = document.getElementById('ghTokenInput').value.trim();

    if (!owner || !repo) {
        alert('Vui lòng nhập GitHub Username và Tên Repository!');
        return;
    }

    GitHubSync.saveConfig({ owner, repo, branch, token, autoSync: true });
    if (token) {
        await GitHubSync.pull(false);
    } else {
        alert('✅ Đã lưu thông tin Repo! Hãy nhập thêm Personal Access Token để bật đồng bộ 2 chiều.');
    }
}

// Tiện ích & Cài đặt PWA
function openUtilsModal() { document.getElementById('utilsModal').style.display = 'flex'; }
function closeUtilsModal() { document.getElementById('utilsModal').style.display = 'none'; }
function openInstallGuide() { document.getElementById('installGuideModal').style.display = 'flex'; }
function closeInstallGuide() { document.getElementById('installGuideModal').style.display = 'none'; }

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const btn = document.getElementById('installAppBtn');
    if (btn) btn.style.display = 'inline-flex';
});

function installAppPrompt() {
    closeUtilsModal();
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                const btn = document.getElementById('installAppBtn');
                if (btn) btn.style.display = 'none';
            }
            deferredPrompt = null;
        });
    } else {
        openInstallGuide();
    }
}

function clearAppCache() {
    if (confirm('Bạn có muốn xóa bộ nhớ cache và tải lại phiên bản mới nhất từ GitHub không?')) {
        if ('caches' in window) {
            caches.keys().then((names) => Promise.all(names.map(name => caches.delete(name))))
                .then(() => window.location.reload());
        } else {
            window.location.reload();
        }
    }
}

// Điều khiển bằng bàn phím trên PC
window.addEventListener('keydown', (e) => {
    const fcModal = document.getElementById('flashcardModal');
    if (fcModal && fcModal.style.display === 'flex') {
        if (e.code === 'Space') { e.preventDefault(); flipCurrentCard(); }
        else if (e.code === 'ArrowRight') { nextCard(); }
        else if (e.code === 'ArrowLeft') { prevCard(); }
        else if (e.code === 'Escape') { closeFlashcardModal(); }
        return;
    }

    const qModal = document.getElementById('quizModal');
    if (qModal && qModal.style.display === 'flex') {
        const nextBtn = document.getElementById('quizNextBtn');
        const isNextVisible = nextBtn && nextBtn.style.display !== 'none';

        if (isNextVisible && (e.code === 'Enter' || e.code === 'Space')) {
            e.preventDefault();
            nextQuizQuestion();
        } else if (!isNextVisible) {
            if (e.key === '1' || e.key.toLowerCase() === 'a') selectQuizAnswer(0);
            else if (e.key === '2' || e.key.toLowerCase() === 'b') selectQuizAnswer(1);
            else if (e.key === '3' || e.key.toLowerCase() === 'c') selectQuizAnswer(2);
            else if (e.key === '4' || e.key.toLowerCase() === 'd') selectQuizAnswer(3);
        }
        if (e.code === 'Escape') closeQuizModal();
    }
});

// Cử chỉ vuốt (Swipe) thẻ Flashcard trên điện thoại
(function setupFlashcardSwipe() {
    let touchStartX = 0;
    let touchStartY = 0;
    const fcBox = document.querySelector('.fc-box');
    if (!fcBox) return;

    fcBox.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    fcBox.addEventListener('touchend', (e) => {
        const diffX = e.changedTouches[0].screenX - touchStartX;
        const diffY = e.changedTouches[0].screenY - touchStartY;
        if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX < 0) nextCard();
            else prevCard();
        }
    }, { passive: true });
})();

// Đăng ký Service Worker & Khởi chạy hệ thống
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

// Boot tức thì 0ms + Tự động kiểm tra đồng bộ ngầm từ GitHub
loadAllData();
render();
GitHubSync.updateUIStatus();
setTimeout(() => {
    GitHubSync.pull(true);
}, 400);
