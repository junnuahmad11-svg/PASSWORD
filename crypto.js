/**
 * XIMI Password Manager - Crypto Module
 * Handles all encryption, decryption, and hashing operations
 * Uses CryptoJS AES for encryption and SHA-256/PBKDF2 for hashing
 */

const XIMICrypto = (() => {
    'use strict';

    // Generate a random salt
    function generateSalt() {
        return CryptoJS.lib.WordArray.random(128 / 8).toString();
    }

    // Derive key from password using PBKDF2
    function deriveKey(password, salt) {
        return CryptoJS.PBKDF2(password, salt, {
            keySize: 256 / 32,
            iterations: 10000,
            hasher: CryptoJS.algo.SHA256
        }).toString();
    }

    // Hash the master password with salt for storage verification
    function hashMasterPassword(password) {
        const salt = generateSalt();
        const hash = deriveKey(password, salt);
        return {
            hash: hash,
            salt: salt
        };
    }

    // Verify master password against stored hash
    function verifyMasterPassword(password, storedHash, storedSalt) {
        const hash = deriveKey(password, storedSalt);
        return hash === storedHash;
    }

    // Encrypt data using AES with the master password
    function encrypt(plaintext, masterPassword) {
        try {
            // Generate a random IV for each encryption
            const iv = CryptoJS.lib.WordArray.random(128 / 8);
            // Derive an encryption key from the master password
            const salt = CryptoJS.lib.WordArray.random(128 / 8);
            const key = CryptoJS.PBKDF2(masterPassword, salt, {
                keySize: 256 / 32,
                iterations: 5000,
                hasher: CryptoJS.algo.SHA256
            });

            const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
                iv: iv,
                mode: CryptoJS.mode.CBC,
                padding: CryptoJS.pad.Pkcs7
            });

            // Combine salt + iv + ciphertext for storage
            return salt.toString() + ':' + iv.toString() + ':' + encrypted.ciphertext.toString();
        } catch (e) {
            console.error('Encryption error:', e);
            return null;
        }
    }

    // Decrypt data using AES with the master password
    function decrypt(ciphertext, masterPassword) {
        try {
            const parts = ciphertext.split(':');
            if (parts.length !== 3) {
                throw new Error('Invalid ciphertext format');
            }

            const salt = CryptoJS.enc.Hex.parse(parts[0]);
            const iv = CryptoJS.enc.Hex.parse(parts[1]);
            const encrypted = parts[2];

            const key = CryptoJS.PBKDF2(masterPassword, salt, {
                keySize: 256 / 32,
                iterations: 5000,
                hasher: CryptoJS.algo.SHA256
            });

            const decrypted = CryptoJS.AES.decrypt(
                { ciphertext: CryptoJS.enc.Hex.parse(encrypted) },
                key,
                {
                    iv: iv,
                    mode: CryptoJS.mode.CBC,
                    padding: CryptoJS.pad.Pkcs7
                }
            );

            const result = decrypted.toString(CryptoJS.enc.Utf8);
            if (!result) {
                throw new Error('Decryption produced empty result');
            }
            return result;
        } catch (e) {
            console.error('Decryption error:', e);
            return null;
        }
    }

    // Encrypt entire backup data
    function encryptBackup(data, masterPassword) {
        try {
            const jsonString = JSON.stringify(data);
            const encrypted = CryptoJS.AES.encrypt(jsonString, masterPassword).toString();
            return {
                version: '1.0',
                app: 'XIMI Password Manager',
                timestamp: new Date().toISOString(),
                data: encrypted,
                checksum: CryptoJS.SHA256(jsonString).toString()
            };
        } catch (e) {
            console.error('Backup encryption error:', e);
            return null;
        }
    }

    // Decrypt backup data
    function decryptBackup(backupObj, masterPassword) {
        try {
            if (!backupObj.data || backupObj.app !== 'XIMI Password Manager') {
                throw new Error('Invalid backup file');
            }

            const decrypted = CryptoJS.AES.decrypt(backupObj.data, masterPassword);
            const jsonString = decrypted.toString(CryptoJS.enc.Utf8);
            
            if (!jsonString) {
                throw new Error('Decryption failed - wrong password');
            }

            // Verify checksum if present
            if (backupObj.checksum) {
                const checksum = CryptoJS.SHA256(jsonString).toString();
                if (checksum !== backupObj.checksum) {
                    throw new Error('Backup integrity check failed');
                }
            }

            return JSON.parse(jsonString);
        } catch (e) {
            console.error('Backup decryption error:', e);
            return null;
        }
    }

    // Check password strength
    function checkPasswordStrength(password) {
        if (!password) return { score: 0, label: '', class: '' };

        let score = 0;
        const length = password.length;

        // Length scoring
        if (length >= 8) score += 1;
        if (length >= 12) score += 1;
        if (length >= 16) score += 1;
        if (length >= 20) score += 1;

        // Character variety
        if (/[a-z]/.test(password)) score += 1;
        if (/[A-Z]/.test(password)) score += 1;
        if (/[0-9]/.test(password)) score += 1;
        if (/[^a-zA-Z0-9]/.test(password)) score += 2;

        // Patterns (reduce score)
        if (/(.)\1{2,}/.test(password)) score -= 1; // Repeated characters
        if (/^[a-zA-Z]+$/.test(password)) score -= 1; // Only letters
        if (/^[0-9]+$/.test(password)) score -= 1; // Only numbers

        // Common patterns
        const commonPatterns = ['password', '123456', 'qwerty', 'abc123', 'letmein', 'admin', 'welcome'];
        if (commonPatterns.some(p => password.toLowerCase().includes(p))) score -= 2;

        score = Math.max(0, Math.min(score, 9));

        if (score <= 3) {
            return { score, label: 'Weak', class: 'strength-weak' };
        } else if (score <= 6) {
            return { score, label: 'Medium', class: 'strength-medium' };
        } else {
            return { score, label: 'Strong', class: 'strength-strong' };
        }
    }

    // Generate random password
    function generatePassword(length = 16, options = {}) {
        const {
            uppercase = true,
            lowercase = true,
            numbers = true,
            symbols = true
        } = options;

        let chars = '';
        let required = [];

        const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
        const numberChars = '0123456789';
        const symbolChars = '!@#$%^&*()_+-=[]{}|;:,.<>?';

        if (uppercase) { chars += upperChars; required.push(upperChars); }
        if (lowercase) { chars += lowerChars; required.push(lowerChars); }
        if (numbers) { chars += numberChars; required.push(numberChars); }
        if (symbols) { chars += symbolChars; required.push(symbolChars); }

        if (chars.length === 0) {
            chars = lowerChars + numberChars;
            required = [lowerChars, numberChars];
        }

        let password = '';

        // Ensure at least one character from each required set
        required.forEach(set => {
            const randomIndex = getSecureRandom(set.length);
            password += set[randomIndex];
        });

        // Fill the rest
        for (let i = password.length; i < length; i++) {
            const randomIndex = getSecureRandom(chars.length);
            password += chars[randomIndex];
        }

        // Shuffle the password
        password = shuffleString(password);

        return password;
    }

    // Get cryptographically secure random number
    function getSecureRandom(max) {
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(1);
            window.crypto.getRandomValues(array);
            return array[0] % max;
        }
        // Fallback (less secure)
        return Math.floor(Math.random() * max);
    }

    // Shuffle string characters
    function shuffleString(str) {
        const arr = str.split('');
        for (let i = arr.length - 1; i > 0; i--) {
            const j = getSecureRandom(i + 1);
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr.join('');
    }

    // Public API
    return {
        hashMasterPassword,
        verifyMasterPassword,
        encrypt,
        decrypt,
        encryptBackup,
        decryptBackup,
        checkPasswordStrength,
        generatePassword,
        generateSalt
    };
})();
