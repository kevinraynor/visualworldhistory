// API helper module
let csrfToken = null;

export function setCsrfToken(token) {
    csrfToken = token;
}

export async function apiGet(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
}

export async function apiPost(url, body = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export async function apiPut(url, body = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const res = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers,
        body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export async function apiDelete(url) {
    const headers = {};
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const res = await fetch(url, {
        method: 'DELETE',
        credentials: 'include',
        headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}
