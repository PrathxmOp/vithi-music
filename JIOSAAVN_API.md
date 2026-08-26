# JioSaavn API Documentation & Implementation Reference

This document outlines all JioSaavn API endpoints, media URL decryption algorithms, audio stream proxy configurations, and data transformation mechanisms implemented in **Vithi**.

---

## 1. Overview & Base Configuration

JioSaavn operates a public endpoint (`api.php`) that returns JSON metadata.

- **Base Endpoint**: `https://www.jiosaavn.com/api.php`
- **Default Query Parameters**:
    - `_format`: `json`
    - `_marker`: `0`
    - `api_version`: `4`

### Proxy & CORS Architecture

To bypass browser CORS policies and support regional streaming:

1. **Local Development Proxy (`vite.config.ts`)**:
    - `/saavn-api/*` -> Proxies to `https://www.jiosaavn.com/*`
    - `/saavn-audio/*` -> Proxies to `https://aac.saavncdn.com/*` (Supports HTTP `Range` headers for seeking)
2. **Production Proxy Fallback (`js/jiosaavn-api.js`)**:
    - Requests are routed through `https://api.allorigins.win/raw?url=...` when running on remote domains without a custom server proxy.

---

## 2. Media URL Decryption (DES-ECB)

JioSaavn returns an `encrypted_media_url` in track metadata. Vithi decrypts this string into direct MP4 AAC stream URLs.

### Decryption Details

- **Cipher**: `DES-ECB`
- **Secret Key**: `38346591`
- **IV**: `00000000`
- **Input**: Base64 encoded string from `more_info.encrypted_media_url`

### Code Example (`decryptSaavnMediaUrl`)

```javascript
import forge from 'node-forge';

export function decryptSaavnMediaUrl(encryptedMediaUrl) {
    if (!encryptedMediaUrl) return null;
    const key = '38346591';
    const iv = '00000000';
    const encrypted = forge.util.decode64(encryptedMediaUrl);
    const decipher = forge.cipher.createDecipher('DES-ECB', forge.util.createBuffer(key));
    decipher.start({ iv: forge.util.createBuffer(iv) });
    decipher.update(forge.util.createBuffer(encrypted));
    decipher.finish();
    const decryptedLink = decipher.output.getBytes();

    return {
        '96_KBPS': decryptedLink.replace(/_\d+\.mp4/, '_96.mp4'),
        '160_KBPS': decryptedLink.replace(/_\d+\.mp4/, '_160.mp4'),
        '320_KBPS': decryptedLink.replace(/_\d+\.mp4/, '_320.mp4'),
    };
}
```

---

## 3. API Endpoints Reference

### 3.1 Search Endpoints

#### Search Tracks

- **Call**: `__call=search.getResults`
- **Parameters**: `q={query}&p={page}&n={limit}`
- **Example**: `__call=search.getResults&q=Arijit+Singh&p=1&n=30`
- **Response**: `{ results: [...tracks], total: number }`

#### Search Albums

- **Call**: `__call=search.getAlbumResults`
- **Parameters**: `q={query}&p={page}&n={limit}`
- **Example**: `__call=search.getAlbumResults&q=Rockstar&p=1&n=30`
- **Response**: `{ results: [...albums], total: number }`

#### Search Artists

- **Call**: `__call=search.getArtistResults`
- **Parameters**: `q={query}&p={page}&n={limit}`
- **Example**: `__call=search.getArtistResults&q=Pritam&p=1&n=15`
- **Response**: `{ results: [...artists] }`

---

### 3.2 Detail Endpoints

#### Track Details

- **Call**: `__call=song.getDetails`
- **Parameters**: `pids={track_id}`
- **Example**: `__call=song.getDetails&pids=oG_0_3K1`
- **Response**: Map keyed by track ID containing full metadata, `encrypted_media_url`, artists, album info, and duration.

#### Album Details

- **Call**: `__call=content.getAlbumDetails`
- **Parameters**: `albumid={album_id}`
- **Fallback (Token)**: `token={album_token}&type=album`
- **Example**: `__call=content.getAlbumDetails&albumid=73778144`
- **Response**: Album object containing metadata and `list` array of tracks.

#### Playlist Details

- **Call**: `__call=playlist.getDetails`
- **Parameters**: `listid={playlist_id}`
- **Fallback (Token)**: `token={playlist_token}&type=playlist`
- **Example**: `__call=playlist.getDetails&listid=10738491`
- **Response**: Playlist object containing metadata and `list` array of tracks.

#### Artist Page Details

- **Call**: `__call=artist.getArtistPageDetails`
- **Parameters**: `artistId={artist_id}`
- **Example**: `__call=artist.getArtistPageDetails&artistId=456269`
- **Response**: Artist details, popular tracks, and top albums.

---

### 3.3 Recommendations & Radio Endpoints

#### Track Recommendations

- **Call**: `__call=reco.getreco`
- **Parameters**: `pid={track_id}`
- **Example**: `__call=reco.getreco&pid=oG_0_3K1`
- **Response**: Array or object containing recommended tracks based on the seed track.

#### Album Recommendations

- **Call**: `__call=reco.getAlbumReco`
- **Parameters**: `albumid={album_id}`
- **Example**: `__call=reco.getAlbumReco&albumid=73778144`
- **Response**: Array of similar album recommendations.

---

### 3.4 Lyrics Endpoint

#### Get Track Lyrics

- **Call**: `__call=lyrics.getLyrics`
- **Parameters**: `lyrics_id={track_id}`
- **Example**: `__call=lyrics.getLyrics&lyrics_id=oG_0_3K1`
- **Response**: `{ lyrics: "Plain text lyrics string..." }`

---

## 4. Audio Proxy & Seeking (HTTP Range Support)

For HTML5 `<audio>` element seeking/scrubbing to function correctly without restarting playback:

1. **Request Headers**: Forward `Range` header (`req.headers.range`) from the browser to `https://aac.saavncdn.com`.
2. **Response Headers Required**:
    - `Accept-Ranges: bytes`
    - `Content-Range: bytes START-END/TOTAL`
    - `Content-Length: BYTES`
    - Status Code `206 Partial Content` (when Range header is present).

---

## 5. File Mapping in Codebase

- **`js/jiosaavn-api.js`**: Core class `JioSaavnAPI` handling requests, decryption, caching, and fallback resolution.
- **`js/music-api.js`**: Singleton wrapper routing queries to `JioSaavnAPI`.
- **`js/proxy-utils.js`**: Replaces `aac.saavncdn.com` URLs with local/proxy URLs (`/saavn-audio`).
- **`vite.config.ts`**: Contains dev-server proxy middleware for `/saavn-api` and `/saavn-audio`.
