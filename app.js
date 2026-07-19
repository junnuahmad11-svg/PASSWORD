/**
 * XIMI Password Manager - Main Application
 * Handles UI, state management, and user interactions
 */

(function () {
    'use strict';

    // ========================================
    // STATE
    // ========================================
    let state = {
        masterPassword: null, // Only kept in memory during session
        entries: [],
        unlockedEntries: new Set(),
        editingEntryId: null,
        deleteEntryId: null,
        unlockEntryId: null,
        autoLockTime: 30,
        autoLockTimer: null,
        inactivityTimer: null,
        inactivityCountdown: null,
        loginAttempts: 0,
        maxLoginAttempts: 5,
        lockoutUntil: null
    };

    // ========================================
    // INITIALIZATION
    // ========================================
    window.addEventListener('DOMContentLoaded', () => {
        initParticles();

        // Show loading screen then determine which screen to show
        setTimeout(() => {
            const loadingScreen = document.getElementById('loadingScreen');
            loadingScreen.style.opacity = '0';
            loadingScreen.style.transition = 'opacity 0.5s ease';
            
            setTimeout(() => {
                loadingScreen.classList.add('hidden');
                initApp();
            }, 500);
        }, 2200);
    });

    function initApp() {
        const masterData = localStorage.getItem('ximi_master');
        
        if (masterData) {
            showScreen('loginScreen');
        } else {
            showScreen('setupScreen');
        }

        // Setup password strength checker for setup screen
        const setupPw = document.getElementById('setupPassword');
        if (setupPw) {
            setupPw.addEventListener('input', () => {
                updateStrengthIndicator('setupStrength', setupPw.value);
            });
        }

        // Load settings
        const savedAutoLock = localStorage.getItem('ximi_autolock');
        if (savedAutoLock) {
            state.autoLockTime = parseInt(savedAutoLock);
            const select = document.getElementById('autoLockTime');
            if (select) select.value = state.autoLockTime;
        }

        // Check lockout
        const lockout = localStorage.getItem('ximi_lockout');
        if (lockout) {
            const lockoutTime = parseInt(lockout);
            if (Date.now() < lockoutTime) {
                state.lockoutUntil = lockoutTime;
            } else {
                localStorage.removeItem('ximi_lockout');
                state.loginAttempts = 0;
            }
        }
    }

    function showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
        const screen = document.getElementById(screenId);
        if (screen) screen.classList.remove('hidden');
    }

    // ========================================
    // MASTER PASSWORD SETUP
    // ========================================
    window.createMasterPassword = function () {
        const password = document.getElementById('setupPassword').value;
        const confirm = document.getElementById('setupPasswordConfirm').value;
        const hint = document.getElementById('setupHint').value.trim();
        const errorEl = document.getElementById('setupError');

        // Validations
        if (!password) {
            showError(errorEl, 'Please enter a master password');
            return;
        }
        if (password.length < 8) {
            showError(errorEl, 'Master password must be at least 8 characters');
            return;
        }
        if (password !== confirm) {
            showError(errorEl, 'Passwords do not match');
            return;
        }

        const strength = XIMICrypto.checkPasswordStrength(password);
        if (strength.label === 'Weak') {
            showError(errorEl, 'Please choose a stronger master password');
            return;
        }

        // Hash and store master password
        const { hash, salt } = XIMICrypto.hashMasterPassword(password);
        
        const masterData = {
            hash: hash,
            salt: salt,
            hint: hint || '',
            createdAt: new Date().toISOString()
        };

        localStorage.setItem('ximi_master', JSON.stringify(masterData));
        localStorage.setItem('ximi_entries', JSON.stringify([]));

        state.masterPassword = password;
        state.entries = [];

        showToast('Vault created successfully!', 'success');
        showScreen('mainApp');
        renderEntries();
        startActivityMonitor();
        updateStats();
    };

    // ========================================
    // LOGIN / UNLOCK VAULT
    // ========================================
    window.unlockVault = function () {
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        const attemptsEl = document.getElementById('loginAttempts');

        if (!password) {
            showError(errorEl, 'Please enter your master password');
            return;
        }

        // Check lockout
        if (state.lockoutUntil && Date.now() < state.lockoutUntil) {
            const remaining = Math.ceil((state.lockoutUntil - Date.now()) / 1000);
            showError(errorEl, `Too many attempts. Try again in ${remaining} seconds.`);
            return;
        }

        const masterData = JSON.parse(localStorage.getItem('ximi_master'));
        
        if (!masterData) {
            showError(errorEl, 'No vault found. Please set up first.');
            return;
        }

        const isValid = XIMICrypto.verifyMasterPassword(password, masterData.hash, masterData.salt);

        if (isValid) {
            state.masterPassword = password;
            state.loginAttempts = 0;
            localStorage.removeItem('ximi_lockout');
            
            // Load entries
            loadEntries();
            
            showScreen('mainApp');
            renderEntries();
            startActivityMonitor();
            updateStats();

            // Clear login field
            document.getElementById('loginPassword').value = '';
            errorEl.classList.add('hidden');
            attemptsEl.classList.add('hidden');

            showToast('Vault unlocked successfully!', 'success');
        } else {
            state.loginAttempts++;
            const remaining = state.maxLoginAttempts - state.loginAttempts;
            
            if (remaining <= 0) {
                // Lock out for 60 seconds
                state.lockoutUntil = Date.now() + 60000;
                localStorage.setItem('ximi_lockout', state.lockoutUntil);
                showError(errorEl, 'Too many failed attempts. Locked for 60 seconds.');
                state.loginAttempts = 0;
            } else {
                showError(errorEl, 'Wrong master password');
                attemptsEl.textContent = `${remaining} attempts remaining`;
                attemptsEl.classList.remove('hidden');
            }
        }
    };

    window.showHint = function () {
        const masterData = JSON.parse(localStorage.getItem('ximi_master'));
        const hintEl = document.getElementById('loginHint');

        if (masterData && masterData.hint) {
            hintEl.textContent = '💡 Hint: ' + masterData.hint;
            hintEl.classList.remove('hidden');
        } else {
            hintEl.textContent = 'No hint was set.';
            hintEl.classList.remove('hidden');
        }
    };

    window.lockVault = function () {
        state.masterPassword = null;
        state.unlockedEntries.clear();
        stopActivityMonitor();
        
        showScreen('loginScreen');
        showToast('Vault locked', 'info');
    };

    // ========================================
    // ENTRIES MANAGEMENT
    // ========================================
    function loadEntries() {
        try {
            const data = localStorage.getItem('ximi_entries');
            state.entries = data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error loading entries:', e);
            state.entries = [];
        }
    }

    function saveEntries() {
        localStorage.setItem('ximi_entries', JSON.stringify(state.entries));
        updateStats();
    }

    function generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }

    // ========================================
    // ADD / EDIT MODAL
    // ========================================
    window.showAddModal = function () {
        state.editingEntryId = null;
        document.getElementById('modalTitle').textContent = 'Add New Password';
        document.getElementById('saveEntryBtn').innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
            </svg>
            Save Entry
        `;
        
        // Clear form
        document.getElementById('entryName').value = '';
        document.getElementById('entryUsername').value = '';
        document.getElementById('entryPassword').value = '';
        document.getElementById('entryUrl').value = '';
        document.getElementById('entryNotes').value = '';
        document.getElementById('entryCategory').value = 'other';
        
        clearStrengthIndicator('modalStrength');
        
        // Hide generator
        const genPanel = document.getElementById('generatorPanel');
        if (genPanel) genPanel.classList.add('hidden');

        document.getElementById('addModal').classList.remove('hidden');
        document.getElementById('entryName').focus();
    };

    window.editEntry = function (id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;

        state.editingEntryId = id;
        document.getElementById('modalTitle').textContent = 'Edit Password';
        document.getElementById('saveEntryBtn').innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
            </svg>
            Update Entry
        `;

        document.getElementById('entryName').value = entry.name;
        document.getElementById('entryUsername').value = entry.username;
        document.getElementById('entryUrl').value = entry.url || '';
        document.getElementById('entryNotes').value = entry.notes || '';
        document.getElementById('entryCategory').value = entry.category || 'other';

        // Decrypt password for editing
        const decrypted = XIMICrypto.decrypt(entry.encryptedPassword, state.masterPassword);
        if (decrypted) {
            document.getElementById('entryPassword').value = decrypted;
            updateModalStrength();
        } else {
            document.getElementById('entryPassword').value = '';
        }

        document.getElementById('addModal').classList.remove('hidden');
    };

    window.saveEntry = function () {
        const name = document.getElementById('entryName').value.trim();
        const username = document.getElementById('entryUsername').value.trim();
        const password = document.getElementById('entryPassword').value;
        const url = document.getElementById('entryUrl').value.trim();
        const notes = document.getElementById('entryNotes').value.trim();
        const category = document.getElementById('entryCategory').value;

        if (!name) {
            showToast('Please enter a service name', 'error');
            document.getElementById('entryName').focus();
            return;
        }
        if (!username) {
            showToast('Please enter a username or email', 'error');
            document.getElementById('entryUsername').focus();
            return;
        }
        if (!password) {
            showToast('Please enter or generate a password', 'error');
            document.getElementById('entryPassword').focus();
            return;
        }

        // Encrypt the password
        const encryptedPassword = XIMICrypto.encrypt(password, state.masterPassword);
        if (!encryptedPassword) {
            showToast('Encryption error. Please try again.', 'error');
            return;
        }

        const strength = XIMICrypto.checkPasswordStrength(password);

        if (state.editingEntryId) {
            // Update existing entry
            const index = state.entries.findIndex(e => e.id === state.editingEntryId);
            if (index !== -1) {
                state.entries[index] = {
                    ...state.entries[index],
                    name,
                    username,
                    encryptedPassword,
                    url,
                    notes,
                    category,
                    strength: strength.label,
                    updatedAt: new Date().toISOString()
                };
                showToast('Password updated successfully!', 'success');
            }
        } else {
            // Create new entry
            const entry = {
                id: generateId(),
                name,
                username,
                encryptedPassword,
                url,
                notes,
                category,
                strength: strength.label,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            state.entries.push(entry);
            showToast('Password saved successfully!', 'success');
        }

        saveEntries();
        renderEntries();
        closeAddModal();
    };

    window.closeAddModal = function () {
        document.getElementById('addModal').classList.add('hidden');
        state.editingEntryId = null;
    };

    // ========================================
    // DELETE ENTRY
    // ========================================
    window.showDeleteConfirm = function (id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;

        state.deleteEntryId = id;
        document.getElementById('deleteEntryName').textContent = entry.name;
        document.getElementById('deleteModal').classList.remove('hidden');
    };

    window.confirmDelete = function () {
        if (state.deleteEntryId) {
            state.entries = state.entries.filter(e => e.id !== state.deleteEntryId);
            state.unlockedEntries.delete(state.deleteEntryId);
            saveEntries();
            renderEntries();
            closeDeleteModal();
            showToast('Password deleted', 'info');
        }
    };

    window.closeDeleteModal = function () {
        document.getElementById('deleteModal').classList.add('hidden');
        state.deleteEntryId = null;
    };

    // ========================================
    // UNLOCK / LOCK PASSWORDS
    // ========================================
    window.requestUnlock = function (id) {
        state.unlockEntryId = id;
        document.getElementById('unlockPassword').value = '';
        document.getElementById('unlockError').classList.add('hidden');
        document.getElementById('unlockModal').classList.remove('hidden');
        
        setTimeout(() => {
            document.getElementById('unlockPassword').focus();
        }, 100);
    };

    window.confirmUnlock = function () {
        const password = document.getElementById('unlockPassword').value;
        const errorEl = document.getElementById('unlockError');

        if (!password) {
            showError(errorEl, 'Please enter your master password');
            return;
        }

        const masterData = JSON.parse(localStorage.getItem('ximi_master'));
        const isValid = XIMICrypto.verifyMasterPassword(password, masterData.hash, masterData.salt);

        if (isValid) {
            state.unlockedEntries.add(state.unlockEntryId);
            closeUnlockModal();
            renderEntries();
            showToast('Password unlocked', 'success');
            resetInactivityTimer();
        } else {
            showError(errorEl, 'Wrong master password');
        }
    };

    window.lockEntry = function (id) {
        state.unlockedEntries.delete(id);
        renderEntries();
    };

    window.lockAllPasswords = function () {
        state.unlockedEntries.clear();
        renderEntries();
        showToast('All passwords locked', 'info');
    };

    window.closeUnlockModal = function () {
        document.getElementById('unlockModal').classList.add('hidden');
        state.unlockEntryId = null;
    };

    // ========================================
    // COPY PASSWORD
    // ========================================
    window.copyPassword = function (id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;

        if (!state.unlockedEntries.has(id)) {
            showToast('Unlock the password first to copy', 'warning');
            return;
        }

        const decrypted = XIMICrypto.decrypt(entry.encryptedPassword, state.masterPassword);
        if (decrypted) {
            navigator.clipboard.writeText(decrypted).then(() => {
                showToast('Password copied to clipboard!', 'success');
                // Auto-clear clipboard after 30 seconds
                setTimeout(() => {
                    navigator.clipboard.writeText('').catch(() => {});
                }, 30000);
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = decrypted;
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('Password copied to clipboard!', 'success');
            });
        } else {
            showToast('Failed to decrypt password', 'error');
        }
    };

    window.copyUsername = function(id) {
        const entry = state.entries.find(e => e.id === id);
        if (!entry) return;

        navigator.clipboard.writeText(entry.username).then(() => {
            showToast('Username copied!', 'success');
        }).catch(() => {
            const textarea = document.createElement('textarea');
            textarea.value = entry.username;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('Username copied!', 'success');
        });
    };

    // ========================================
    // PASSWORD GENERATOR
    // ========================================
    window.toggleGenerator = function () {
        const panel = document.getElementById('generatorPanel');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            generateAndFill();
        }
    };

    window.generateAndFill = function () {
        const length = parseInt(document.getElementById('genLength').value);
        const options = {
            uppercase: document.getElementById('genUpper').checked,
            lowercase: document.getElementById('genLower').checked,
            numbers: document.getElementById('genNumbers').checked,
            symbols: document.getElementById('genSymbols').checked
        };

        const password = XIMICrypto.generatePassword(length, options);
        document.getElementById('generatedPreview').textContent = password;
        document.getElementById('entryPassword').value = password;
        updateModalStrength();
    };

    window.updateLengthDisplay = function () {
        const val = document.getElementById('genLength').value;
        document.getElementById('lengthValue').textContent = val;
    };

    window.updateModalStrength = function () {
        const password = document.getElementById('entryPassword').value;
        updateStrengthIndicator('modalStrength', password);
    };

    // ========================================
    // SEARCH & FILTER
    // ========================================
    window.filterEntries = function () {
        const query = document.getElementById('searchInput').value.toLowerCase().trim();
        const clearBtn = document.getElementById('searchClear');
        
        if (query) {
            clearBtn.classList.remove('hidden');
        } else {
            clearBtn.classList.add('hidden');
        }

        renderEntries(query);
    };

    window.clearSearch = function () {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchClear').classList.add('hidden');
        renderEntries();
    };

    // ========================================
    // BACKUP SYSTEM
    // ========================================
    window.showBackupModal = function () {
        document.getElementById('backupModal').classList.remove('hidden');
    };

    window.closeBackupModal = function () {
        document.getElementById('backupModal').classList.add('hidden');
    };

    window.exportBackup = function () {
        if (state.entries.length === 0) {
            showToast('No passwords to export', 'warning');
            return;
        }

        const backupData = {
            entries: state.entries,
            masterData: JSON.parse(localStorage.getItem('ximi_master'))
        };

        const encrypted = XIMICrypto.encryptBackup(backupData, state.masterPassword);
        if (!encrypted) {
            showToast('Failed to create backup', 'error');
            return;
        }

        const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ximi-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast('Backup exported successfully!', 'success');
        closeBackupModal();
    };

    window.importBackup = function (event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const backupObj = JSON.parse(e.target.result);
                const decrypted = XIMICrypto.decryptBackup(backupObj, state.masterPassword);

                if (!decrypted) {
                    showToast('Failed to decrypt backup. Wrong password or corrupted file.', 'error');
                    return;
                }

                if (decrypted.entries && Array.isArray(decrypted.entries)) {
                    // Merge entries (avoid duplicates by ID)
                    const existingIds = new Set(state.entries.map(e => e.id));
                    let imported = 0;
                    
                    decrypted.entries.forEach(entry => {
                        if (!existingIds.has(entry.id)) {
                            state.entries.push(entry);
                            imported++;
                        }
                    });

                    saveEntries();
                    renderEntries();
                    closeBackupModal();
                    showToast(`Imported ${imported} passwords successfully!`, 'success');
                } else {
                    showToast('Invalid backup format', 'error');
                }
            } catch (err) {
                console.error('Import error:', err);
                showToast('Invalid backup file', 'error');
            }
        };
        reader.readAsText(file);

        // Reset input
        event.target.value = '';
    };

    // ========================================
    // SETTINGS
    // ========================================
    window.showSettingsModal = function () {
        // Load current auto-lock time
        const select = document.getElementById('autoLockTime');
        if (select) select.value = state.autoLockTime;
        
        // Clear password fields
        document.getElementById('currentMasterPw').value = '';
        document.getElementById('newMasterPw').value = '';
        document.getElementById('confirmNewMasterPw').value = '';
        document.getElementById('changePwError').classList.add('hidden');
        
        document.getElementById('settingsModal').classList.remove('hidden');
    };

    window.closeSettingsModal = function () {
        document.getElementById('settingsModal').classList.add('hidden');
    };

    window.updateAutoLockTime = function () {
        const val = parseInt(document.getElementById('autoLockTime').value);
        state.autoLockTime = val;
        localStorage.setItem('ximi_autolock', val);
        showToast(`Auto-lock set to ${val} seconds`, 'info');
    };

    window.changeMasterPassword = function () {
        const current = document.getElementById('currentMasterPw').value;
        const newPw = document.getElementById('newMasterPw').value;
        const confirm = document.getElementById('confirmNewMasterPw').value;
        const errorEl = document.getElementById('changePwError');

        if (!current || !newPw || !confirm) {
            showError(errorEl, 'Please fill in all fields');
            return;
        }

        // Verify current password
        const masterData = JSON.parse(localStorage.getItem('ximi_master'));
        const isValid = XIMICrypto.verifyMasterPassword(current, masterData.hash, masterData.salt);

        if (!isValid) {
            showError(errorEl, 'Current password is incorrect');
            return;
        }

        if (newPw.length < 8) {
            showError(errorEl, 'New password must be at least 8 characters');
            return;
        }

        if (newPw !== confirm) {
            showError(errorEl, 'New passwords do not match');
            return;
        }

        const strength = XIMICrypto.checkPasswordStrength(newPw);
        if (strength.label === 'Weak') {
            showError(errorEl, 'Please choose a stronger password');
            return;
        }

        // Re-encrypt all passwords with new master password
        const reEncryptedEntries = [];
        for (const entry of state.entries) {
            const decrypted = XIMICrypto.decrypt(entry.encryptedPassword, current);
            if (decrypted) {
                const newEncrypted = XIMICrypto.encrypt(decrypted, newPw);
                if (newEncrypted) {
                    reEncryptedEntries.push({
                        ...entry,
                        encryptedPassword: newEncrypted
                    });
                } else {
                    showError(errorEl, 'Failed to re-encrypt passwords');
                    return;
                }
            } else {
                showError(errorEl, 'Failed to decrypt passwords with current key');
                return;
            }
        }

        // Update master password hash
        const { hash, salt } = XIMICrypto.hashMasterPassword(newPw);
        masterData.hash = hash;
        masterData.salt = salt;
        localStorage.setItem('ximi_master', JSON.stringify(masterData));

        // Update entries
        state.entries = reEncryptedEntries;
        state.masterPassword = newPw;
        saveEntries();

        // Clear fields
        document.getElementById('currentMasterPw').value = '';
        document.getElementById('newMasterPw').value = '';
        document.getElementById('confirmNewMasterPw').value = '';
        errorEl.classList.add('hidden');

        showToast('Master password changed successfully!', 'success');
        closeSettingsModal();
    };

    window.deleteAllData = function () {
        if (confirm('⚠️ Are you sure you want to delete ALL data? This cannot be undone!')) {
            if (confirm('This will delete your master password and all saved passwords. Proceed?')) {
                localStorage.removeItem('ximi_master');
                localStorage.removeItem('ximi_entries');
                localStorage.removeItem('ximi_autolock');
                localStorage.removeItem('ximi_lockout');
                
                state.masterPassword = null;
                state.entries = [];
                state.unlockedEntries.clear();
                stopActivityMonitor();

                closeSettingsModal();
                showScreen('setupScreen');
                showToast('All data has been deleted', 'info');
            }
        }
    };

    // ========================================
    // RENDER ENTRIES
    // ========================================
    function renderEntries(filterQuery = '') {
        const grid = document.getElementById('passwordGrid');
        const emptyState = document.getElementById('emptyState');

        let filtered = state.entries;

        if (filterQuery) {
            filtered = state.entries.filter(entry =>
                entry.name.toLowerCase().includes(filterQuery) ||
                entry.username.toLowerCase().includes(filterQuery) ||
                (entry.category && entry.category.toLowerCase().includes(filterQuery))
            );
        }

        if (state.entries.length === 0) {
            emptyState.classList.remove('hidden');
            grid.classList.add('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        grid.classList.remove('hidden');

        if (filtered.length === 0) {
            grid.innerHTML = `
                <div class="empty-state" style="grid-column: 1/-1; padding: 40px 20px;">
                    <h3 style="color: var(--text-secondary);">No results found</h3>
                    <p style="color: var(--text-muted);">Try a different search term</p>
                </div>
            `;
            return;
        }

        // Sort: newest first
        const sorted = [...filtered].sort((a, b) => 
            new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
        );

        grid.innerHTML = sorted.map((entry, index) => {
            const isUnlocked = state.unlockedEntries.has(entry.id);
            let displayPassword = '••••••••••••';
            
            if (isUnlocked) {
                const decrypted = XIMICrypto.decrypt(entry.encryptedPassword, state.masterPassword);
                displayPassword = decrypted || 'Decryption error';
            }

            const initial = entry.name.charAt(0).toUpperCase();
            const category = entry.category || 'other';
            const strengthBadge = getStrengthBadge(entry.strength);
            const notesHtml = entry.notes ? `
                <div class="card-notes">
                    <p class="notes-label">Notes</p>
                    <p>${escapeHtml(entry.notes)}</p>
                </div>
            ` : '';

            return `
                <div class="password-card ${isUnlocked ? 'unlocked' : ''}" style="animation-delay: ${index * 0.05}s">
                    <div class="card-header">
                        <div class="card-info">
                            <div class="card-icon ${category}">${initial}</div>
                            <div class="card-details">
                                <div class="card-name" title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</div>
                                <div class="card-username" title="${escapeHtml(entry.username)}">${escapeHtml(entry.username)}</div>
                                <div class="card-category">${getCategoryLabel(category)}</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card-password-field">
                        <span class="password-display ${isUnlocked ? 'visible' : ''}" id="pw-${entry.id}">
                            ${isUnlocked ? escapeHtml(displayPassword) : displayPassword}
                        </span>
                        ${strengthBadge}
                    </div>
                    
                    <div class="card-actions">
                        ${isUnlocked ? `
                            <button class="btn btn-lock" onclick="lockEntry('${entry.id}')">
                                🔒 Lock
                            </button>
                            <button class="btn btn-copy" onclick="copyPassword('${entry.id}')">
                                📋 Copy
                            </button>
                        ` : `
                            <button class="btn btn-unlock" onclick="requestUnlock('${entry.id}')">
                                🔓 Unlock
                            </button>
                            <button class="btn btn-copy" onclick="copyUsername('${entry.id}')" title="Copy username">
                                👤 Copy
                            </button>
                        `}
                        <button class="btn btn-edit" onclick="editEntry('${entry.id}')">
                            ✏️ Edit
                        </button>
                        <button class="btn btn-delete-card" onclick="showDeleteConfirm('${entry.id}')">
                            🗑️
                        </button>
                    </div>
                    ${notesHtml}
                </div>
            `;
        }).join('');
    }

    function getStrengthBadge(strength) {
        if (!strength) return '';
        const classes = {
            'Weak': 'badge-weak',
            'Medium': 'badge-medium',
            'Strong': 'badge-strong'
        };
        return `<span class="password-strength-badge ${classes[strength] || ''}">${strength}</span>`;
    }

    function getCategoryLabel(category) {
        const labels = {
            social: 'Social',
            email: 'Email',
            finance: 'Finance',
            shopping: 'Shopping',
            gaming: 'Gaming',
            work: 'Work',
            entertainment: 'Entertainment',
            other: 'Other'
        };
        return labels[category] || 'Other';
    }

    function updateStats() {
        const total = state.entries.length;
        let strong = 0, weak = 0;
        
        state.entries.forEach(entry => {
            if (entry.strength === 'Strong') strong++;
            else if (entry.strength === 'Weak') weak++;
        });

        const locked = total - state.unlockedEntries.size;

        document.getElementById('totalEntries').textContent = total;
        document.getElementById('strongCount').textContent = strong;
        document.getElementById('weakCount').textContent = weak;
        document.getElementById('lockedCount').textContent = Math.max(0, locked);
    }

    // ========================================
    // STRENGTH INDICATOR
    // ========================================
    function updateStrengthIndicator(elementId, password) {
        const container = document.getElementById(elementId);
        if (!container) return;

        if (!password) {
            container.innerHTML = '';
            container.className = 'strength-indicator';
            return;
        }

        const result = XIMICrypto.checkPasswordStrength(password);
        container.className = `strength-indicator ${result.class}`;
        container.innerHTML = `
            <div class="strength-fill"></div>
            <div class="strength-label">${result.label}</div>
        `;
    }

    function clearStrengthIndicator(elementId) {
        const container = document.getElementById(elementId);
        if (container) {
            container.innerHTML = '';
            container.className = 'strength-indicator';
        }
    }

    // ========================================
    // INACTIVITY / AUTO-LOCK
    // ========================================
    function startActivityMonitor() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.addEventListener(event, resetInactivityTimer, { passive: true });
        });
        resetInactivityTimer();
    }

    function stopActivityMonitor() {
        const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
        events.forEach(event => {
            document.removeEventListener(event, resetInactivityTimer);
        });
        clearTimeout(state.autoLockTimer);
        clearInterval(state.inactivityCountdown);
        const bar = document.getElementById('inactivityBar');
        if (bar) bar.classList.add('hidden');
    }

    function resetInactivityTimer() {
        clearTimeout(state.autoLockTimer);
        clearInterval(state.inactivityCountdown);
        
        const bar = document.getElementById('inactivityBar');
        const timerEl = document.getElementById('inactivityTimer');
        
        if (state.unlockedEntries.size === 0) {
            if (bar) bar.classList.add('hidden');
            return;
        }

        let remaining = state.autoLockTime;
        if (timerEl) timerEl.textContent = remaining;
        
        // Show warning bar in last 10 seconds
        const showWarningAt = Math.min(10, state.autoLockTime);
        
        if (bar) bar.classList.add('hidden');

        state.inactivityCountdown = setInterval(() => {
            remaining--;
            if (timerEl) timerEl.textContent = remaining;
            
            if (remaining <= showWarningAt && bar) {
                bar.classList.remove('hidden');
            }
        }, 1000);

        state.autoLockTimer = setTimeout(() => {
            clearInterval(state.inactivityCountdown);
            if (bar) bar.classList.add('hidden');
            lockAllPasswords();
            showToast('Passwords auto-locked due to inactivity', 'warning');
        }, state.autoLockTime * 1000);
    }

    // ========================================
    // UI HELPERS
    // ========================================
    window.togglePasswordVisibility = function (inputId, btn) {
        const input = document.getElementById(inputId);
        if (!input) return;

        if (input.type === 'password') {
            input.type = 'text';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
            `;
        } else {
            input.type = 'password';
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                </svg>
            `;
        }
    };

    function showError(element, message) {
        element.textContent = message;
        element.classList.remove('hidden');
        element.style.animation = 'none';
        element.offsetHeight; // Force reflow
        element.style.animation = 'shake 0.5s ease';
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // ========================================
    // TOAST NOTIFICATIONS
    // ========================================
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${message}</span>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 400);
        }, 3000);
    }

    window.showToast = showToast;

    // ========================================
    // PARTICLE BACKGROUND
    // ========================================
    function initParticles() {
        const canvas = document.getElementById('particleCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        let particles = [];
        let animationId;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        function createParticle() {
            return {
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: Math.random() * 2 + 0.5,
                speedX: (Math.random() - 0.5) * 0.3,
                speedY: (Math.random() - 0.5) * 0.3,
                opacity: Math.random() * 0.4 + 0.1,
                hue: Math.random() > 0.5 ? 245 : 190 // Blue or cyan
            };
        }

        function init() {
            resize();
            particles = [];
            const count = Math.min(80, Math.floor((canvas.width * canvas.height) / 15000));
            for (let i = 0; i < count; i++) {
                particles.push(createParticle());
            }
        }

        function animate() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach((p, i) => {
                p.x += p.speedX;
                p.y += p.speedY;

                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `hsla(${p.hue}, 80%, 65%, ${p.opacity})`;
                ctx.fill();

                // Draw connections
                for (let j = i + 1; j < particles.length; j++) {
                    const p2 = particles[j];
                    const dx = p.x - p2.x;
                    const dy = p.y - p2.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(p2.x, p2.y);
                        ctx.strokeStyle = `hsla(${p.hue}, 80%, 65%, ${0.06 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            });

            animationId = requestAnimationFrame(animate);
        }

        window.addEventListener('resize', () => {
            cancelAnimationFrame(animationId);
            init();
            animate();
        });

        init();
        animate();
    }

})();
