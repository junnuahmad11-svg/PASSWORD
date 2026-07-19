/**
 * XIMI Password Manager — Main Application
 * Created by Mohamad Zubair Ahmed
 */
(function () {
    'use strict';

    // ==================== STATE ====================
    let state = {
        masterPassword: null,
        entries: [],
        unlockedEntries: new Set(),
        editingEntryId: null,
        deleteEntryId: null,
        unlockEntryId: null,
        unlockAction: null, // 'view', 'edit', 'delete', 'copy'
        autoLockTime: 30,
        autoLockTimer: null,
        inactivityCountdown: null,
        loginAttempts: 0,
        maxLoginAttempts: 5,
        lockoutUntil: null
    };

    // ==================== INIT ====================
    window.addEventListener('DOMContentLoaded', () => {
        initParticles();
        setTimeout(() => {
            const ls = document.getElementById('loadingScreen');
            ls.style.opacity = '0'; ls.style.transition = 'opacity 0.5s ease';
            setTimeout(() => { ls.classList.add('hidden'); initApp(); }, 500);
        }, 3500);
    });

    function initApp() {
        const masterData = localStorage.getItem('ximi_master');
        showScreen(masterData ? 'loginScreen' : 'setupScreen');
        const sp = document.getElementById('setupPassword');
        if (sp) sp.addEventListener('input', () => updateStrengthIndicator('setupStrength', sp.value));
        const savedAL = localStorage.getItem('ximi_autolock');
        if (savedAL) { state.autoLockTime = parseInt(savedAL); const s = document.getElementById('autoLockTime'); if (s) s.value = state.autoLockTime; }
        const lockout = localStorage.getItem('ximi_lockout');
        if (lockout) { const t = parseInt(lockout); if (Date.now() < t) state.lockoutUntil = t; else { localStorage.removeItem('ximi_lockout'); state.loginAttempts = 0; } }
    }

    function showScreen(id) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    }

    // ==================== SIDEBAR ====================
    window.toggleSidebar = function () {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        sidebar.classList.toggle('open');
        overlay.classList.toggle('hidden');
    };

    window.closeSidebar = function () {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('sidebarOverlay').classList.add('hidden');
    };

    window.navigateTo = function (view) {
        closeSidebar();
        // Update active nav
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        event.currentTarget.classList.add('active');

        const views = ['dashboardView', 'generatorView', 'strengthCheckerView', 'aboutView'];
        views.forEach(v => { const el = document.getElementById(v); if (el) el.classList.add('hidden'); });

        switch (view) {
            case 'dashboard':
                document.getElementById('dashboardView').classList.remove('hidden');
                break;
            case 'addPassword':
                document.getElementById('dashboardView').classList.remove('hidden');
                showAddModal();
                break;
            case 'generator':
                document.getElementById('generatorView').classList.remove('hidden');
                break;
            case 'strengthChecker':
                document.getElementById('strengthCheckerView').classList.remove('hidden');
                break;
            case 'backup':
                document.getElementById('dashboardView').classList.remove('hidden');
                showBackupModal();
                break;
            case 'settings':
                document.getElementById('dashboardView').classList.remove('hidden');
                showSettingsModal();
                break;
            case 'about':
                document.getElementById('aboutView').classList.remove('hidden');
                break;
        }
    };

    // ==================== MASTER PASSWORD SETUP ====================
    window.createMasterPassword = function () {
        const pw = document.getElementById('setupPassword').value;
        const cf = document.getElementById('setupPasswordConfirm').value;
        const hint = document.getElementById('setupHint').value.trim();
        const err = document.getElementById('setupError');

        if (!pw) { showError(err, 'Please enter a master password'); return; }
        if (pw.length < 8) { showError(err, 'Master password must be at least 8 characters'); return; }
        if (pw !== cf) { showError(err, 'Passwords do not match'); return; }
        if (XIMICrypto.checkPasswordStrength(pw).label === 'Weak') { showError(err, 'Please choose a stronger password'); return; }

        const { hash, salt } = XIMICrypto.hashMasterPassword(pw);
        localStorage.setItem('ximi_master', JSON.stringify({ hash, salt, hint: hint || '', createdAt: new Date().toISOString() }));
        localStorage.setItem('ximi_entries', JSON.stringify([]));
        state.masterPassword = pw;
        state.entries = [];
        showToast('Vault created successfully!', 'success');
        showScreen('mainApp');
        renderEntries();
        startActivityMonitor();
        updateStats();
    };

    // ==================== LOGIN ====================
    window.unlockVault = function () {
        const pw = document.getElementById('loginPassword').value;
        const err = document.getElementById('loginError');
        const att = document.getElementById('loginAttempts');

        if (!pw) { showError(err, 'Please enter your master password'); return; }
        if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
            showError(err, `Too many attempts. Try again in ${Math.ceil((state.lockoutUntil - Date.now()) / 1000)}s.`);
            return;
        }

        const md = JSON.parse(localStorage.getItem('ximi_master'));
        if (!md) { showError(err, 'No vault found.'); return; }

        if (XIMICrypto.verifyMasterPassword(pw, md.hash, md.salt)) {
            state.masterPassword = pw; state.loginAttempts = 0;
            localStorage.removeItem('ximi_lockout');
            loadEntries(); showScreen('mainApp'); renderEntries();
            startActivityMonitor(); updateStats();
            document.getElementById('loginPassword').value = '';
            err.classList.add('hidden'); att.classList.add('hidden');
            showToast('Vault unlocked!', 'success');
        } else {
            state.loginAttempts++;
            const rem = state.maxLoginAttempts - state.loginAttempts;
            if (rem <= 0) {
                state.lockoutUntil = Date.now() + 60000;
                localStorage.setItem('ximi_lockout', state.lockoutUntil);
                showError(err, 'Too many attempts. Locked for 60 seconds.');
                state.loginAttempts = 0;
            } else { showError(err, 'Wrong master password'); att.textContent = `${rem} attempts remaining`; att.classList.remove('hidden'); }
        }
    };

    window.showHint = function () {
        const md = JSON.parse(localStorage.getItem('ximi_master'));
        const el = document.getElementById('loginHint');
        el.textContent = md && md.hint ? '💡 Hint: ' + md.hint : 'No hint was set.';
        el.classList.remove('hidden');
    };

    window.lockVault = function () {
        state.masterPassword = null; state.unlockedEntries.clear();
        stopActivityMonitor(); showScreen('loginScreen');
        showToast('Vault locked', 'info');
    };

    // ==================== ENTRIES ====================
    function loadEntries() {
        try { state.entries = JSON.parse(localStorage.getItem('ximi_entries') || '[]'); } catch { state.entries = []; }
    }

    function saveEntries() { localStorage.setItem('ximi_entries', JSON.stringify(state.entries)); updateStats(); }
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); }

    // ==================== ADD/EDIT MODAL ====================
    window.showAddModal = function () {
        state.editingEntryId = null;
        document.getElementById('modalTitle').textContent = 'Add New Password';
        document.getElementById('saveEntryBtn').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save Entry';
        ['entryName', 'entryUsername', 'entryPassword', 'entryUrl', 'entryNotes'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('entryCategory').value = 'other';
        clearStrengthIndicator('modalStrength');
        const gp = document.getElementById('generatorPanel'); if (gp) gp.classList.add('hidden');
        document.getElementById('addModal').classList.remove('hidden');
        document.getElementById('entryName').focus();
    };

    window.editEntry = function (id) {
        // Require master password for editing
        state.unlockAction = 'edit';
        state.unlockEntryId = id;
        document.getElementById('unlockPassword').value = '';
        document.getElementById('unlockError').classList.add('hidden');
        document.getElementById('unlockDesc').textContent = 'Enter your master password to edit this entry.';
        document.getElementById('unlockModal').classList.remove('hidden');
        setTimeout(() => document.getElementById('unlockPassword').focus(), 100);
    };

    function performEdit(id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;
        state.editingEntryId = id;
        document.getElementById('modalTitle').textContent = 'Edit Password';
        document.getElementById('saveEntryBtn').innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Update Entry';
        document.getElementById('entryName').value = entry.name;
        document.getElementById('entryUsername').value = entry.username;
        document.getElementById('entryUrl').value = entry.url || '';
        document.getElementById('entryNotes').value = entry.notes || '';
        document.getElementById('entryCategory').value = entry.category || 'other';
        const dec = XIMICrypto.decrypt(entry.encryptedPassword, state.masterPassword);
        document.getElementById('entryPassword').value = dec || '';
        if (dec) updateModalStrength();
        document.getElementById('addModal').classList.remove('hidden');
    }

    window.saveEntry = function () {
        const name = document.getElementById('entryName').value.trim();
        const username = document.getElementById('entryUsername').value.trim();
        const password = document.getElementById('entryPassword').value;
        const url = document.getElementById('entryUrl').value.trim();
        const notes = document.getElementById('entryNotes').value.trim();
        const category = document.getElementById('entryCategory').value;

        if (!name) { showToast('Enter a service name', 'error'); return; }
        if (!username) { showToast('Enter a username/email', 'error'); return; }
        if (!password) { showToast('Enter or generate a password', 'error'); return; }

        const enc = XIMICrypto.encrypt(password, state.masterPassword);
        if (!enc) { showToast('Encryption error', 'error'); return; }
        const strength = XIMICrypto.checkPasswordStrength(password);

        if (state.editingEntryId) {
            const i = state.entries.findIndex(e => e.id === state.editingEntryId);
            if (i !== -1) {
                state.entries[i] = { ...state.entries[i], name, username, encryptedPassword: enc, url, notes, category, strength: strength.label, updatedAt: new Date().toISOString() };
                showToast('Password updated!', 'success');
            }
        } else {
            state.entries.push({ id: generateId(), name, username, encryptedPassword: enc, url, notes, category, strength: strength.label, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            showToast('Password saved!', 'success');
        }
        saveEntries(); renderEntries(); closeAddModal();
    };

    window.closeAddModal = function () { document.getElementById('addModal').classList.add('hidden'); state.editingEntryId = null; };

    // ==================== DELETE ====================
    window.showDeleteConfirm = function (id) {
        // Require master password for deleting
        state.unlockAction = 'delete';
        state.unlockEntryId = id;
        document.getElementById('unlockPassword').value = '';
        document.getElementById('unlockError').classList.add('hidden');
        document.getElementById('unlockDesc').textContent = 'Enter your master password to delete this entry.';
        document.getElementById('unlockModal').classList.remove('hidden');
        setTimeout(() => document.getElementById('unlockPassword').focus(), 100);
    };

    function performDeleteConfirm(id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;
        state.deleteEntryId = id;
        document.getElementById('deleteEntryName').textContent = entry.name;
        document.getElementById('deleteModal').classList.remove('hidden');
    }

    window.confirmDelete = function () {
        if (state.deleteEntryId) {
            state.entries = state.entries.filter(e => e.id !== state.deleteEntryId);
            state.unlockedEntries.delete(state.deleteEntryId);
            saveEntries(); renderEntries(); closeDeleteModal();
            showToast('Password deleted', 'info');
        }
    };

    window.closeDeleteModal = function () { document.getElementById('deleteModal').classList.add('hidden'); state.deleteEntryId = null; };

    // ==================== UNLOCK / LOCK ====================
    window.requestUnlock = function (id) {
        state.unlockAction = 'view';
        state.unlockEntryId = id;
        document.getElementById('unlockPassword').value = '';
        document.getElementById('unlockError').classList.add('hidden');
        document.getElementById('unlockDesc').textContent = 'Enter your master password to view this password.';
        document.getElementById('unlockModal').classList.remove('hidden');
        setTimeout(() => document.getElementById('unlockPassword').focus(), 100);
    };

    window.confirmUnlock = function () {
        const pw = document.getElementById('unlockPassword').value;
        const err = document.getElementById('unlockError');
        if (!pw) { showError(err, 'Enter your master password'); return; }

        const md = JSON.parse(localStorage.getItem('ximi_master'));
        if (!XIMICrypto.verifyMasterPassword(pw, md.hash, md.salt)) {
            showError(err, 'Wrong master password');
            return;
        }

        const action = state.unlockAction;
        const id = state.unlockEntryId;
        closeUnlockModal();

        switch (action) {
            case 'view':
                state.unlockedEntries.add(id);
                renderEntries();
                showToast('Password unlocked', 'success');
                resetInactivityTimer();
                break;
            case 'edit':
                performEdit(id);
                break;
            case 'delete':
                performDeleteConfirm(id);
                break;
            case 'copy':
                performCopy(id);
                break;
        }
    };

    window.lockEntry = function (id) { state.unlockedEntries.delete(id); renderEntries(); };

    window.lockAllPasswords = function () { state.unlockedEntries.clear(); renderEntries(); showToast('All passwords locked', 'info'); };

    window.closeUnlockModal = function () {
        document.getElementById('unlockModal').classList.add('hidden');
        state.unlockEntryId = null; state.unlockAction = null;
    };

    // ==================== COPY ====================
    window.copyPassword = function (id) {
        if (!state.unlockedEntries.has(id)) {
            // Need master password to copy
            state.unlockAction = 'copy';
            state.unlockEntryId = id;
            document.getElementById('unlockPassword').value = '';
            document.getElementById('unlockError').classList.add('hidden');
            document.getElementById('unlockDesc').textContent = 'Enter your master password to copy this password.';
            document.getElementById('unlockModal').classList.remove('hidden');
            setTimeout(() => document.getElementById('unlockPassword').focus(), 100);
            return;
        }
        performCopy(id);
    };

    function performCopy(id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;
        const dec = XIMICrypto.decrypt(entry.encryptedPassword, state.masterPassword);
        if (dec) {
            navigator.clipboard.writeText(dec).then(() => {
                showToast('Password copied!', 'success');
                setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
            }).catch(() => {
                const ta = document.createElement('textarea'); ta.value = dec;
                ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select(); document.execCommand('copy');
                document.body.removeChild(ta);
                showToast('Password copied!', 'success');
            });
        } else { showToast('Decryption failed', 'error'); }
    }

    window.copyUsername = function (id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;
        navigator.clipboard.writeText(entry.username).then(() => showToast('Username copied!', 'success')).catch(() => {
            const ta = document.createElement('textarea'); ta.value = entry.username;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta); showToast('Username copied!', 'success');
        });
    };

    // ==================== GENERATOR (MODAL) ====================
    window.toggleGenerator = function () { document.getElementById('generatorPanel').classList.toggle('hidden'); };

    window.generateAndFill = function () {
        const len = parseInt(document.getElementById('genLength').value);
        const opts = {
            uppercase: document.getElementById('genUpper').checked,
            lowercase: document.getElementById('genLower').checked,
            numbers: document.getElementById('genNumbers').checked,
            symbols: document.getElementById('genSymbols').checked
        };
        const pw = XIMICrypto.generatePassword(len, opts);
        document.getElementById('generatedPreview').textContent = pw;
        document.getElementById('entryPassword').value = pw;
        updateModalStrength();
    };

    window.updateLengthDisplay = function () { document.getElementById('lengthValue').textContent = document.getElementById('genLength').value; };
    window.updateModalStrength = function () { updateStrengthIndicator('modalStrength', document.getElementById('entryPassword').value); };

    // ==================== GENERATOR (FULL PAGE) ====================
    window.regenerateFullPassword = function () {
        const len = parseInt(document.getElementById('genFullLength').value);
        const opts = {
            uppercase: document.getElementById('genFullUpper').checked,
            lowercase: document.getElementById('genFullLower').checked,
            numbers: document.getElementById('genFullNumbers').checked,
            symbols: document.getElementById('genFullSymbols').checked
        };
        const pw = XIMICrypto.generatePassword(len, opts);
        document.getElementById('genFullPreview').textContent = pw;
        updateStrengthIndicator('genFullStrength', pw);
    };

    window.copyGeneratedPassword = function () {
        const pw = document.getElementById('genFullPreview').textContent;
        if (!pw || pw.includes('Click Generate')) { showToast('Generate a password first', 'warning'); return; }
        navigator.clipboard.writeText(pw).then(() => showToast('Password copied!', 'success')).catch(() => {
            const ta = document.createElement('textarea'); ta.value = pw;
            ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.appendChild(ta); ta.select(); document.execCommand('copy');
            document.body.removeChild(ta); showToast('Password copied!', 'success');
        });
    };

    // ==================== STRENGTH CHECKER ====================
    window.checkStrengthLive = function () {
        const pw = document.getElementById('checkerPassword').value;
        const result = document.getElementById('checkerResult');
        const meter = document.getElementById('checkerMeterFill');
        const label = document.getElementById('checkerLabel');
        const details = document.getElementById('checkerDetails');

        if (!pw) { result.classList.add('hidden'); return; }
        result.classList.remove('hidden');

        const s = XIMICrypto.checkPasswordStrength(pw);
        const pct = Math.min(100, (s.score / 9) * 100);

        const colors = { Weak: '#ef4444', Medium: '#f59e0b', Strong: '#22c55e' };
        meter.style.width = pct + '%';
        meter.style.background = colors[s.label] || '#555';
        label.textContent = s.label;
        label.style.color = colors[s.label] || '#555';

        const hasLower = /[a-z]/.test(pw);
        const hasUpper = /[A-Z]/.test(pw);
        const hasNum = /[0-9]/.test(pw);
        const hasSym = /[^a-zA-Z0-9]/.test(pw);
        const hasLen = pw.length >= 12;
        const hasLong = pw.length >= 16;

        details.innerHTML = `
            <div class="checker-detail-item"><span class="${hasLen ? 'check' : 'cross'}">${hasLen ? '✅' : '❌'}</span> 12+ characters</div>
            <div class="checker-detail-item"><span class="${hasLong ? 'check' : 'cross'}">${hasLong ? '✅' : '❌'}</span> 16+ characters</div>
            <div class="checker-detail-item"><span class="${hasLower ? 'check' : 'cross'}">${hasLower ? '✅' : '❌'}</span> Lowercase</div>
            <div class="checker-detail-item"><span class="${hasUpper ? 'check' : 'cross'}">${hasUpper ? '✅' : '❌'}</span> Uppercase</div>
            <div class="checker-detail-item"><span class="${hasNum ? 'check' : 'cross'}">${hasNum ? '✅' : '❌'}</span> Numbers</div>
            <div class="checker-detail-item"><span class="${hasSym ? 'check' : 'cross'}">${hasSym ? '✅' : '❌'}</span> Symbols</div>
        `;
    };

    // ==================== SEARCH ====================
    window.filterEntries = function () {
        const q = document.getElementById('searchInput').value.toLowerCase().trim();
        document.getElementById('searchClear').classList.toggle('hidden', !q);
        renderEntries(q);
    };

    window.clearSearch = function () {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.add('hidden');
        renderEntries();
    };

    // ==================== BACKUP ====================
    window.showBackupModal = function () { document.getElementById('backupModal').classList.remove('hidden'); };
    window.closeBackupModal = function () { document.getElementById('backupModal').classList.add('hidden'); };

    window.exportBackup = function () {
        if (!state.entries.length) { showToast('No passwords to export', 'warning'); return; }
        const enc = XIMICrypto.encryptBackup({ entries: state.entries, masterData: JSON.parse(localStorage.getItem('ximi_master')) }, state.masterPassword);
        if (!enc) { showToast('Backup failed', 'error'); return; }
        const blob = new Blob([JSON.stringify(enc, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `ximi-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        showToast('Backup exported!', 'success'); closeBackupModal();
    };

    window.importBackup = function (e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) {
            try {
                const obj = JSON.parse(ev.target.result);
                const dec = XIMICrypto.decryptBackup(obj, state.masterPassword);
                if (!dec) { showToast('Decryption failed', 'error'); return; }
                if (dec.entries && Array.isArray(dec.entries)) {
                    const existing = new Set(state.entries.map(e => e.id));
                    let count = 0;
                    dec.entries.forEach(entry => { if (!existing.has(entry.id)) { state.entries.push(entry); count++; } });
                    saveEntries(); renderEntries(); closeBackupModal();
                    showToast(`Imported ${count} passwords!`, 'success');
                } else showToast('Invalid backup', 'error');
            } catch { showToast('Invalid file', 'error'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // ==================== SETTINGS ====================
    window.showSettingsModal = function () {
        const s = document.getElementById('autoLockTime'); if (s) s.value = state.autoLockTime;
        ['currentMasterPw', 'newMasterPw', 'confirmNewMasterPw'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('changePwError').classList.add('hidden');
        document.getElementById('settingsModal').classList.remove('hidden');
    };
    window.closeSettingsModal = function () { document.getElementById('settingsModal').classList.add('hidden'); };

    window.updateAutoLockTime = function () {
        state.autoLockTime = parseInt(document.getElementById('autoLockTime').value);
        localStorage.setItem('ximi_autolock', state.autoLockTime);
        showToast(`Auto-lock: ${state.autoLockTime}s`, 'info');
    };

    window.changeMasterPassword = function () {
        const cur = document.getElementById('currentMasterPw').value;
        const np = document.getElementById('newMasterPw').value;
        const cf = document.getElementById('confirmNewMasterPw').value;
        const err = document.getElementById('changePwError');

        if (!cur || !np || !cf) { showError(err, 'Fill all fields'); return; }
        const md = JSON.parse(localStorage.getItem('ximi_master'));
        if (!XIMICrypto.verifyMasterPassword(cur, md.hash, md.salt)) { showError(err, 'Current password incorrect'); return; }
        if (np.length < 8) { showError(err, 'Min 8 characters'); return; }
        if (np !== cf) { showError(err, 'Passwords don\'t match'); return; }
        if (XIMICrypto.checkPasswordStrength(np).label === 'Weak') { showError(err, 'Choose stronger password'); return; }

        const reEnc = [];
        for (const entry of state.entries) {
            const dec = XIMICrypto.decrypt(entry.encryptedPassword, cur);
            if (!dec) { showError(err, 'Decryption failed'); return; }
            const enc = XIMICrypto.encrypt(dec, np);
            if (!enc) { showError(err, 'Re-encryption failed'); return; }
            reEnc.push({ ...entry, encryptedPassword: enc });
        }

        const { hash, salt } = XIMICrypto.hashMasterPassword(np);
        md.hash = hash; md.salt = salt;
        localStorage.setItem('ximi_master', JSON.stringify(md));
        state.entries = reEnc; state.masterPassword = np; saveEntries();
        ['currentMasterPw', 'newMasterPw', 'confirmNewMasterPw'].forEach(id => document.getElementById(id).value = '');
        err.classList.add('hidden');
        showToast('Master password changed!', 'success'); closeSettingsModal();
    };

    window.deleteAllData = function () {
        if (!confirm('⚠️ Delete ALL data? Cannot be undone!')) return;
        if (!confirm('This deletes EVERYTHING. Proceed?')) return;
        ['ximi_master', 'ximi_entries', 'ximi_autolock', 'ximi_lockout'].forEach(k => localStorage.removeItem(k));
        state.masterPassword = null; state.entries = []; state.unlockedEntries.clear();
        stopActivityMonitor(); closeSettingsModal(); showScreen('setupScreen');
        showToast('All data deleted', 'info');
    };

    // ==================== RENDER ====================
    function renderEntries(filterQuery = '') {
        const grid = document.getElementById('passwordGrid');
        const empty = document.getElementById('emptyState');

        let filtered = state.entries;
        if (filterQuery) {
            filtered = state.entries.filter(e =>
                e.name.toLowerCase().includes(filterQuery) ||
                e.username.toLowerCase().includes(filterQuery) ||
                (e.category && e.category.toLowerCase().includes(filterQuery))
            );
        }

        if (!state.entries.length) { empty.classList.remove('hidden'); grid.classList.add('hidden'); return; }
        empty.classList.add('hidden'); grid.classList.remove('hidden');

        if (!filtered.length) {
            grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;padding:40px 20px"><h3 style="color:var(--text-secondary)">No results found</h3><p style="color:var(--text-muted)">Try a different search</p></div>';
            return;
        }

        const sorted = [...filtered].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

        grid.innerHTML = sorted.map((entry, i) => {
            const unlocked = state.unlockedEntries.has(entry.id);
            let displayPw = '••••••••••••';
            if (unlocked) { displayPw = XIMICrypto.decrypt(entry.encryptedPassword, state.masterPassword) || 'Error'; }
            const initial = entry.name.charAt(0).toUpperCase();
            const cat = entry.category || 'other';
            const badge = getStrengthBadge(entry.strength);
            const notesHtml = entry.notes ? `<div class="card-notes"><p class="notes-label">Notes</p><p>${escapeHtml(entry.notes)}</p></div>` : '';

            return `
            <div class="password-card ${unlocked ? 'unlocked' : ''}" style="animation-delay:${i * 0.04}s">
                <div class="card-header">
                    <div class="card-info">
                        <div class="card-icon ${cat}">${initial}</div>
                        <div class="card-details">
                            <div class="card-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</div>
                            <div class="card-username" title="${escapeHtml(entry.username)}">${escapeHtml(entry.username)}</div>
                            <div class="card-category">${getCategoryLabel(cat)}</div>
                        </div>
                    </div>
                </div>
                <div class="card-password-field">
                    <span class="password-display ${unlocked ? 'visible' : ''}">${unlocked ? escapeHtml(displayPw) : displayPw}</span>
                    ${badge}
                </div>
                <div class="card-actions">
                    ${unlocked ? `
                        <button class="btn btn-lock" onclick="lockEntry('${entry.id}')">🔒 Lock</button>
                        <button class="btn btn-copy" onclick="copyPassword('${entry.id}')">📋 Copy</button>
                    ` : `
                        <button class="btn btn-unlock" onclick="requestUnlock('${entry.id}')">🔓 Unlock</button>
                        <button class="btn btn-copy" onclick="copyUsername('${entry.id}')" title="Copy username">👤 Copy</button>
                    `}
                    <button class="btn btn-edit" onclick="editEntry('${entry.id}')">✏️ Edit</button>
                    <button class="btn btn-delete-card" onclick="showDeleteConfirm('${entry.id}')">🗑️</button>
                </div>
                ${notesHtml}
            </div>`;
        }).join('');
    }

    function getStrengthBadge(s) {
        if (!s) return '';
        const c = { Weak: 'badge-weak', Medium: 'badge-medium', Strong: 'badge-strong' };
        return `<span class="password-strength-badge ${c[s] || ''}">${s}</span>`;
    }

    function getCategoryLabel(c) {
        return { social: 'Social', email: 'Email', finance: 'Finance', shopping: 'Shopping', gaming: 'Gaming', work: 'Work', entertainment: 'Entertainment', other: 'Other' }[c] || 'Other';
    }

    function updateStats() {
        const t = state.entries.length;
        let strong = 0, weak = 0;
        state.entries.forEach(e => { if (e.strength === 'Strong') strong++; else if (e.strength === 'Weak') weak++; });
        document.getElementById('totalEntries').textContent = t;
        document.getElementById('strongCount').textContent = strong;
        document.getElementById('weakCount').textContent = weak;
        document.getElementById('lockedCount').textContent = Math.max(0, t - state.unlockedEntries.size);
    }

    // ==================== STRENGTH UI ====================
    function updateStrengthIndicator(elId, pw) {
        const c = document.getElementById(elId); if (!c) return;
        if (!pw) { c.innerHTML = ''; c.className = 'strength-indicator'; return; }
        const r = XIMICrypto.checkPasswordStrength(pw);
        c.className = `strength-indicator ${r.class}`;
        c.innerHTML = `<div class="strength-fill"></div><div class="strength-label">${r.label}</div>`;
    }

    function clearStrengthIndicator(elId) {
        const c = document.getElementById(elId); if (c) { c.innerHTML = ''; c.className = 'strength-indicator'; }
    }

    // ==================== INACTIVITY ====================
    function startActivityMonitor() {
        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(ev =>
            document.addEventListener(ev, resetInactivityTimer, { passive: true })
        );
        resetInactivityTimer();
    }

    function stopActivityMonitor() {
        ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'].forEach(ev =>
            document.removeEventListener(ev, resetInactivityTimer)
        );
        clearTimeout(state.autoLockTimer); clearInterval(state.inactivityCountdown);
        const bar = document.getElementById('inactivityBar'); if (bar) bar.classList.add('hidden');
    }

    function resetInactivityTimer() {
        clearTimeout(state.autoLockTimer); clearInterval(state.inactivityCountdown);
        const bar = document.getElementById('inactivityBar');
        const timerEl = document.getElementById('inactivityTimer');

        if (!state.unlockedEntries.size) { if (bar) bar.classList.add('hidden'); return; }

        let rem = state.autoLockTime;
        if (timerEl) timerEl.textContent = rem;
        const warn = Math.min(10, state.autoLockTime);
        if (bar) bar.classList.add('hidden');

        state.inactivityCountdown = setInterval(() => {
            rem--;
            if (timerEl) timerEl.textContent = rem;
            if (rem <= warn && bar) bar.classList.remove('hidden');
        }, 1000);

        state.autoLockTimer = setTimeout(() => {
            clearInterval(state.inactivityCountdown);
            if (bar) bar.classList.add('hidden');
            lockAllPasswords();
            showToast('Auto-locked due to inactivity', 'warning');
        }, state.autoLockTime * 1000);
    }

    // ==================== UI HELPERS ====================
    window.togglePasswordVisibility = function (inputId, btn) {
        const inp = document.getElementById(inputId); if (!inp) return;
        if (inp.type === 'password') {
            inp.type = 'text';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
        } else {
            inp.type = 'password';
            btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        }
    };

    function showError(el, msg) {
        el.textContent = msg; el.classList.remove('hidden');
        el.style.animation = 'none'; el.offsetHeight; el.style.animation = 'shake 0.5s ease';
    }

    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    // ==================== TOASTS ====================
    function showToast(msg, type = 'info') {
        const c = document.getElementById('toastContainer');
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const t = document.createElement('div');
        t.className = `toast toast-${type}`;
        t.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-message">${msg}</span>`;
        c.appendChild(t);
        setTimeout(() => { t.classList.add('toast-out'); setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, 400); }, 3000);
    }

    window.showToast = showToast;

    // ==================== PARTICLES ====================
    function initParticles() {
        const canvas = document.getElementById('particleCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let particles = [], animId;

        function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }

        function create() {
            return {
                x: Math.random() * canvas.width, y: Math.random() * canvas.height,
                size: Math.random() * 1.8 + 0.4,
                speedX: (Math.random() - 0.5) * 0.25, speedY: (Math.random() - 0.5) * 0.25,
                opacity: Math.random() * 0.35 + 0.08,
                hue: Math.random() > 0.5 ? 250 : 192
            };
        }

        function init() {
            resize(); particles = [];
            const count = Math.min(70, Math.floor((canvas.width * canvas.height) / 18000));
            for (let i = 0; i < count; i++) particles.push(create());
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach((p, i) => {
                p.x += p.speedX; p.y += p.speedY;
                if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
                ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue},80%,65%,${p.opacity})`; ctx.fill();
                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const d = Math.sqrt((p.x - p2.x) ** 2 + (p.y - p2.y) ** 2);
                    if (d < 110) {
                        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p2.x, p2.y);
                        ctx.strokeStyle = `hsla(${p.hue},80%,65%,${0.05 * (1 - d / 110)})`;
                        ctx.lineWidth = 0.5; ctx.stroke();
                    }
                }
            });
            animId = requestAnimationFrame(animate);
        }

        window.addEventListener('resize', () => { cancelAnimationFrame(animId); init(); animate(); });
        init(); animate();
    }
})();
