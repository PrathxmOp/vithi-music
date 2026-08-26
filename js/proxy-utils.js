export const isTidalAudioUrl = () => false;

export const getProxyUrl = (url) => {
    if (!url) return url;
    // /saavn-audio/ is handled by Vite proxy in dev and nginx reverse proxy in production
    if (typeof url === 'string' && url.includes('saavncdn.com')) {
        return url.replace(/^https?:\/\/aac\.saavncdn\.com/, '/saavn-audio');
    }
    return url;
};

export const wrapTidalUrl = (url) => url;
