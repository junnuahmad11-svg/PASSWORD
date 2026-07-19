/**
 * XIMI Password Manager — Crypto Module
 * Created by Mohamad Zubair Ahmed
 * AES-256 Encryption, PBKDF2 Hashing
 */
const XIMICrypto = (() => {
    'use strict';

    function generateSalt() {
        return CryptoJS.lib.WordArray.random(128 / 8).toString();
    }

    function deriveKey(password, salt) {
        return CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32, iterations: 10000, hasher: CryptoJS.algo.SHA256
        }).toString();
    }

    function hashMasterPassword(password) {
        const salt = generateSalt();
        const hash = deriveKey(password, salt);
        return { hash, salt };
    }

    function verifyMasterPassword(password, storedHash, storedSalt) {
        return deriveKey(password, storedSalt) === storedHash;
    }

    function encrypt(plaintext, masterPassword) {
        try {
            const iv = CryptoJS.lib.WordArray.random(128 / 8);
            const salt = CryptoJS.lib.WordArray.random(128 / 8);
            const key = CryptoJS.PBKDF2(masterPassword, salt, {
                keySize: 256 / 32, iterations: 5000, hasher: CryptoJS.algo.SHA256
            });
            const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
                iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7
            });
            return salt.toString() + ':' + iv.toString() + ':' + encrypted.ciphertext.toString();
        } catch (e) { console.error('Encryption error:', e); return null; }
    }

    function decrypt(ciphertext, masterPassword) {
        try {
            const parts = ciphertext.split(':');
            if (parts.length !== 3) throw new Error('Invalid format');
            const salt = CryptoJS.enc.Hex.parse(parts[0]);
            const iv = CryptoJS.enc.Hex.parse(parts[1]);
            const key = CryptoJS.PBKDF2(masterPassword, salt, {
                keySize: 256 / 32, iterations: 5000, hasher: CryptoJS.algo.SHA256
            });
            const decrypted = CryptoJS.AES.decrypt(
                { ciphertext: CryptoJS.enc.Hex.parse(parts[2]) }, key,
                { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
            );
            const result = decrypted.toString(CryptoJS.enc.Utf8);
            if (!result) throw new Error('Empty result');
            return result;
        } catch (e) { console.error('Decryption error:', e); return null; }
    }

    function encryptBackup(data, masterPassword) {
        try {
            const json = JSON.stringify(data);
            return {
                version: '1.0', app: 'XIMI Password Manager',
                author: 'Mohamad Zubair Ahmed',
                timestamp: new Date().toISOString(),
                data: CryptoJS.AES.encrypt(json, masterPassword).toString(),
                checksum: CryptoJS.SHA256(json).toString()
            };
        } catch (e) { return null; }
    }

    function decryptBackup(backupObj, masterPassword) {
        try {
            if (!backupObj.data || backupObj.app !== 'XIMI Password Manager') throw new Error('Invalid');
            const decrypted = CryptoJS.AES.decrypt(backupObj.data, masterPassword);
            const json = decrypted.toString(CryptoJS.enc.Utf8);
            if (!json) throw new Error('Wrong password');
            if (backupObj.checksum && CryptoJS.SHA256(json).toString() !== backupObj.checksum)
                throw new Error('Integrity failed');
            return JSON.parse(json);
        } catch (e) { return null; }
    }

    function checkPasswordStrength(password) {
        if (!password) return { score: 0, label: '', class: '' };
        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (password.length >= 16) score++;
        if (password.length >= 20) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score += 2;
        if (/(.)\1{2,}/.test(password)) score--;
        if (/^[a-zA-Z]+$/.test(password)) score--;
        if (/^[0-9]+$/.test(password)) score--;
        const common = ['password','123456','qwerty','abc123','letmein','admin','welcome'];
        if (common.some(p => password.toLowerCase().includes(p))) score -= 2;
        score = Math.max(0, Math.min(score, 9));
        if (score <= 3) return { score, label: 'Weak', class: 'strength-weak' };
        if (score <= 6) return { score, label: 'Medium', class: 'strength-medium' };
        return { score, label: 'Strong', class: 'strength-strong' };
    }

    function generatePassword(length = 16, options = {}) {
        const { uppercase = true, lowercase = true, numbers = true, symbols = true } = options;
        let chars = '', required = [];
        const U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', L = 'abcdefghijklmnopqrstuvwxyz';
        const N = '0123456789', S = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        if (uppercase) { chars += U; required.push(U); }
        if (lowercase) { chars += L; required.push(L); }
        if (numbers) { chars += N; required.push(N); }
        if (symbols) { chars += S; required.push(S); }
        if (!chars) { chars = L + N; required = [L, N]; }
        let pw = '';
        required.forEach(s => { pw += s[getSecureRandom(s.length)]; });
        for (let i = pw.length; i < length; i++) pw += chars[getSecureRandom(chars.length)];
        return shuffleString(pw);
    }

    function getSecureRandom(max) {
        if (window.crypto && window.crypto.getRandomValues) {
            const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % max;
        }
        return Math.floor(Math.random() * max);
    }

    function shuffleString(str) {
        const a = str.split('');
        for (let i = a.length - 1; i > 0; i--) {
            const j = getSecureRandom(i + 1);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a.join('');
    }

    return { hashMasterPassword, verifyMasterPassword, encrypt, decrypt, encryptBackup, decryptBackup, checkPasswordStrength, generatePassword, generateSalt };
})();
