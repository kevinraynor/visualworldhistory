// Auth module - login/register modal, session management

import { apiGet, apiPost, setCsrfToken } from './api.js';
import { escapeHtml } from './utils.js';

let isRegistering = false;
let currentUser = null;

export async function initAuth() {
    const authBtn = document.getElementById('auth-btn');
    const modal = document.getElementById('auth-modal');
    const form = document.getElementById('auth-form');
    const switchLink = document.getElementById('auth-switch-link');
    const modalClose = modal.querySelector('.modal-close');

    authBtn.addEventListener('click', () => {
        if (currentUser) {
            showUserMenu();
        } else {
            showModal(false);
        }
    });

    modalClose.addEventListener('click', hideModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
    });

    switchLink.addEventListener('click', (e) => {
        e.preventDefault();
        showModal(!isRegistering);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleSubmit();
    });

    // Check existing session
    try {
        const data = await apiGet('/api/auth/me');
        if (data.user) {
            setUser(data.user);
            if (data.csrf_token) setCsrfToken(data.csrf_token);
        }
    } catch (e) {
        // Not logged in
    }
}

function showModal(register) {
    isRegistering = register;
    const modal = document.getElementById('auth-modal');
    const title = document.getElementById('auth-modal-title');
    const emailGroup = document.getElementById('auth-email-group');
    const submitBtn = document.getElementById('auth-submit');
    const switchText = document.getElementById('auth-switch-text');
    const switchLink = document.getElementById('auth-switch-link');
    const errorEl = document.getElementById('auth-error');

    errorEl.textContent = '';
    modal.style.display = 'flex';

    if (register) {
        title.textContent = 'Create Account';
        emailGroup.style.display = 'block';
        submitBtn.textContent = 'Register';
        switchText.textContent = 'Already have an account?';
        switchLink.textContent = 'Sign In';
    } else {
        title.textContent = 'Sign In';
        emailGroup.style.display = 'none';
        submitBtn.textContent = 'Sign In';
        switchText.textContent = "Don't have an account?";
        switchLink.textContent = 'Register';
    }
}

function hideModal() {
    document.getElementById('auth-modal').style.display = 'none';
}

async function handleSubmit() {
    const username = document.getElementById('auth-username').value.trim();
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');

    errorEl.textContent = '';

    try {
        let data;
        if (isRegistering) {
            data = await apiPost('/api/auth/register', { username, email, password });
        } else {
            data = await apiPost('/api/auth/login', { username, password });
        }

        if (data.csrf_token) setCsrfToken(data.csrf_token);
        setUser(data.user);
        hideModal();

        // Clear form
        document.getElementById('auth-form').reset();
    } catch (err) {
        errorEl.textContent = err.message;
    }
}

function setUser(user) {
    currentUser = user;
    document.body.dataset.userId = user ? user.id : '';

    const menuEl = document.getElementById('user-menu');

    if (user) {
        menuEl.innerHTML = `
            <div class="user-info">
                <span class="username">${escapeHtml(user.username)}</span>
                <a href="account.html" class="btn-account">Account</a>
                <button class="btn-logout" id="logout-btn">Sign Out</button>
            </div>
        `;
        document.getElementById('logout-btn').addEventListener('click', handleLogout);
    } else {
        menuEl.innerHTML = '<button id="auth-btn" class="btn-auth">Sign In</button>';
        document.getElementById('auth-btn').addEventListener('click', () => showModal(false));
    }
}

async function handleLogout() {
    try {
        await apiPost('/api/auth/logout');
    } catch (e) {
        // Ignore
    }
    setUser(null);
    setCsrfToken(null);
    document.body.dataset.userId = '';
}

function showUserMenu() {
    // Already shown inline
}

export function getCurrentUser() {
    return currentUser;
}
