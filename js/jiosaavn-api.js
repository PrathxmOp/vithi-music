// js/jiosaavn-api.js

import forge from 'node-forge';
import { APICache } from './cache.js';
import { getProxyUrl } from './proxy-utils.js';
import {
    Track,
    Album,
    Artist,
    TrackAlbum,
    PreparedTrack,
    PreparedAlbum,
} from './container-classes.js';

export function decryptSaavnMediaUrl(encryptedMediaUrl) {
    if (!encryptedMediaUrl) return null;
    try {
        const key = '38346591';
        const iv = '00000000';
        const encrypted = forge.util.decode64(encryptedMediaUrl);
        const decipher = forge.cipher.createDecipher('DES-ECB', forge.util.createBuffer(key));
        decipher.start({ iv: forge.util.createBuffer(iv) });
        decipher.update(forge.util.createBuffer(encrypted));
        decipher.finish();
        const decryptedLink = decipher.output.getBytes();
        if (!decryptedLink || !decryptedLink.startsWith('http')) return null;

        return {
            '96_KBPS': decryptedLink.replace(/_\d+\.mp4/, '_96.mp4').replace('_96', '_96'),
            '160_KBPS': decryptedLink.replace(/_\d+\.mp4/, '_160.mp4').replace('_96', '_160'),
            '320_KBPS': decryptedLink.replace(/_\d+\.mp4/, '_320.mp4').replace('_96', '_320'),
        };
    } catch (e) {
        console.error('Failed to decrypt JioSaavn media URL:', e);
        return null;
    }
}

export class JioSaavnAPI {
    constructor(settings) {
        this.settings = settings;
        this.saavnApiUrl = 'https://www.jiosaavn.com/api.php';
        this.cache = new APICache({
            maxSize: 200,
            ttl: 1000 * 60 * 30,
        });
        this.streamCache = new Map();
    }

    getApiUrl(paramsStr) {
        const fullUrl = `https://www.jiosaavn.com/api.php?_format=json&_marker=0&api_version=4&${paramsStr}`;
        if (
            typeof window !== 'undefined' &&
            (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ) {
            return `/saavn-api/api.php?_format=json&_marker=0&api_version=4&${paramsStr}`;
        }
        return `https://api.allorigins.win/raw?url=${encodeURIComponent(fullUrl)}`;
    }

    async fetchJioSaavn(paramsStr) {
        const url = this.getApiUrl(paramsStr);
        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`JioSaavn API request failed: ${res.status}`);
        }
        return await res.json();
    }

    parseDuration(durationStr) {
        if (!durationStr) return 0;
        if (typeof durationStr === 'number') return durationStr;
        const parts = String(durationStr).split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        return Number(durationStr) || 0;
    }

    getImageUrl(imagesObj, defaultUrl) {
        const isDefaultJioSaavnImage = (url) => typeof url === 'string' && (
            url.includes('artist-default') ||
            url.includes('default-music') ||
            url.includes('default-film') ||
            url.includes('www.jiosaavn.com/_i/')
        );

        if (imagesObj && typeof imagesObj === 'object') {
            const candidate = imagesObj['500x500'] || imagesObj['150x150'] || imagesObj['50x50'];
            if (candidate && !isDefaultJioSaavnImage(candidate)) return candidate;
        }
        if (defaultUrl && typeof defaultUrl === 'string') {
            if (isDefaultJioSaavnImage(defaultUrl)) {
                return 'images/monochrome_logo.svg';
            }
            return defaultUrl.replace(/150x150/, '500x500').replace(/50x50/, '500x500');
        }
        return defaultUrl || '';
    }

    parseArtists(primaryArtistsStr, singersStr, artistMapObj) {
        let artists = [];
        if (artistMapObj && Array.isArray(artistMapObj.primary_artists) && artistMapObj.primary_artists.length > 0) {
            artists = artistMapObj.primary_artists.map((a) => {
                const cleanName = (a.name || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
                const picture = this.getImageUrl(a.images, a.image || a.picture);
                return new Artist({
                    id: `saavn-artist-${encodeURIComponent(cleanName)}`,
                    name: cleanName,
                    picture: picture || null,
                    type: 'ARTIST',
                });
            });
        } else {
            const rawStr = primaryArtistsStr || singersStr || 'Unknown Artist';
            const names = rawStr.split(/,\s*|\s*&\s*/).filter(Boolean);
            artists = names.map((name) => {
                const cleanName = name.replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
                return new Artist({
                    id: `saavn-artist-${encodeURIComponent(cleanName)}`,
                    name: cleanName,
                    picture: null,
                    type: 'ARTIST',
                });
            });
        }

        const fallback = new Artist({ id: 'saavn-unknown', name: 'Unknown Artist', type: 'ARTIST' });
        return {
            artist: artists[0] || fallback,
            artists: artists.length ? artists : [fallback],
        };
    }

    prepareTrack(item) {
        if (!item) return null;

        const id = String(item.id);
        const title = (item.title || item.song || 'Unknown Title').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
        const moreInfo = item.more_info || {};
        const albumName = (moreInfo.album || item.album || title).replace(/&quot;/g, '"').replace(/&#039;/g, "'");
        const albumId = moreInfo.album_id || item.albumid || `saavn-album-${id}`;
        const coverUrl = this.getImageUrl(item.images, item.image);

        const { artist, artists } = this.parseArtists(
            moreInfo.primary_artists || item.primary_artists,
            moreInfo.singers || item.singers,
            moreInfo.artistMap
        );

        const duration = this.parseDuration(moreInfo.duration || item.duration);
        const mediaUrls = decryptSaavnMediaUrl(moreInfo.encrypted_media_url || item.encrypted_media_url);

        const trackAlbum = new TrackAlbum({
            id: albumId,
            title: albumName,
            cover: coverUrl,
            vibrantColor: null,
        });

        const trackData = {
            id: id,
            title: title,
            duration: duration,
            artist: artist,
            artists: artists,
            album: trackAlbum,
            explicit: item.explicit_content === '1',
            audioQuality: 'HIGH',
            isrc: '',
            trackNumber: 1,
            volumeNumber: 1,
            type: 'track',
            url: item.perma_url || '',
            releaseDate: moreInfo.release_date || item.release_date || (item.year ? `${item.year}-01-01` : null),
            media_urls: mediaUrls,
            encrypted_media_url: moreInfo.encrypted_media_url || item.encrypted_media_url,
            copyright: moreInfo.copyright_text || item.copyright_text || moreInfo.label || item.label || '',
        };

        return new PreparedTrack(trackData);
    }

    prepareAlbum(item) {
        if (!item) return null;
        const id = String(item.id || item.albumid);
        const title = (item.title || item.name || 'Unknown Album').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
        const coverUrl = this.getImageUrl(item.images, item.image);
        const moreInfo = item.more_info || {};
        const { artist, artists } = this.parseArtists(moreInfo.music || item.primary_artists, null, moreInfo.artistMap);

        return new PreparedAlbum({
            id: id,
            title: title,
            cover: coverUrl,
            artist: artist,
            artists: artists,
            numberOfTracks: Array.isArray(item.list) ? item.list.length : Number(moreInfo.song_count || 0),
            releaseDate: moreInfo.release_date || item.release_date || (item.year ? `${item.year}-01-01` : null),
            type: 'ALBUM',
        });
    }

    async search(query, options = {}) {
        const cached = await this.cache.get('search_all', query);
        if (cached) return cached;

        const [tracksRes, albumsRes] = await Promise.all([
            this.searchTracks(query, options).catch(() => ({ items: [], limit: 0, offset: 0, totalNumberOfItems: 0 })),
            this.searchAlbums(query, options).catch(() => ({ items: [], limit: 0, offset: 0, totalNumberOfItems: 0 })),
        ]);

        const artistMap = new Map();
        tracksRes.items.forEach((t) => {
            if (t.artists) {
                t.artists.forEach((a) => {
                    if (!artistMap.has(a.id)) {
                        artistMap.set(a.id, a);
                    }
                });
            }
        });

        const artistsList = Array.from(artistMap.values());

        const results = {
            tracks: tracksRes,
            albums: albumsRes,
            artists: { items: artistsList, limit: artistsList.length, offset: 0, totalNumberOfItems: artistsList.length },
            playlists: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
            videos: { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 },
        };

        await this.cache.set('search_all', query, results);
        return results;
    }

    async searchTracks(query, options = {}) {
        const cached = await this.cache.get('search_tracks', query);
        if (cached) return cached;

        try {
            const data = await this.fetchJioSaavn(`__call=search.getResults&q=${encodeURIComponent(query)}&p=1&n=30`);
            const rawItems = data.results || [];
            const preparedTracks = rawItems.map((item) => this.prepareTrack(item));

            const result = {
                items: preparedTracks,
                limit: preparedTracks.length,
                offset: 0,
                totalNumberOfItems: Number(data.total || preparedTracks.length),
            };

            await this.cache.set('search_tracks', query, result);
            return result;
        } catch (error) {
            console.error('JioSaavn Track search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchAlbums(query, options = {}) {
        const cached = await this.cache.get('search_albums', query);
        if (cached) return cached;

        try {
            const data = await this.fetchJioSaavn(`__call=search.getAlbumResults&q=${encodeURIComponent(query)}&p=1&n=30`);
            const rawItems = data.results || [];
            const preparedAlbums = rawItems.map((item) => this.prepareAlbum(item));

            const result = {
                items: preparedAlbums,
                limit: preparedAlbums.length,
                offset: 0,
                totalNumberOfItems: Number(data.total || preparedAlbums.length),
            };

            await this.cache.set('search_albums', query, result);
            return result;
        } catch (error) {
            console.error('JioSaavn Album search failed:', error);
            return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
        }
    }

    async searchArtists(query, options = {}) {
        const cached = await this.cache.get('search_artists_v2', query);
        if (cached) return cached;

        const tracks = await this.searchTracks(query, options);
        const artistMap = new Map();
        (tracks.items || []).forEach((t) => {
            if (t.artists) {
                t.artists.forEach((a) => {
                    if (a && a.id && a.name && a.name !== 'Unknown Artist' && !artistMap.has(a.id)) {
                        artistMap.set(a.id, a);
                    }
                });
            }
        });
        let items = Array.from(artistMap.values());
        items = await this.enrichArtistsWithPicture(items);

        const result = { items: items, limit: items.length, offset: 0, totalNumberOfItems: items.length };
        await this.cache.set('search_artists_v2', query, result);
        return result;
    }

    async searchPlaylists() {
        return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
    }

    async searchVideos() {
        return { items: [], limit: 0, offset: 0, totalNumberOfItems: 0 };
    }

    async getTrack(id) {
        const cached = await this.cache.get('track', id);
        if (cached) return cached;

        const data = await this.fetchJioSaavn(`__call=song.getDetails&pids=${encodeURIComponent(id)}`);
        const item = data[id] || Object.values(data)[0];
        if (!item || !item.id) throw new Error('Track not found');

        const track = this.prepareTrack(item);
        await this.cache.set('track', id, track);
        return track;
    }

    async getTrackMetadata(id) {
        return this.getTrack(id);
    }

    async getAlbum(id) {
        const cached = await this.cache.get('album', id);
        if (cached) return cached;

        const data = await this.fetchJioSaavn(`__call=content.getAlbumDetails&albumid=${encodeURIComponent(id)}`);
        if (!data || !data.id) throw new Error('Album not found');

        const album = this.prepareAlbum(data);
        const tracks = (data.list || []).map((s, idx) => {
            const prepared = this.prepareTrack(s);
            if (prepared) prepared.trackNumber = idx + 1;
            return new Track(prepared);
        });

        const result = { album, tracks };
        await this.cache.set('album', id, result);
        return result;
    }

    async getArtist(artistId) {
        const cached = await this.cache.get('artist_v2', artistId);
        if (cached) return cached;

        const rawParam = decodeURIComponent(String(artistId).replace(/^saavn-artist-/, ''));
        let artistName = rawParam;
        let artistPicture = null;

        if (/^\d+$/.test(rawParam)) {
            try {
                const details = await this.fetchJioSaavn(`__call=artist.getArtistPageDetails&artistId=${rawParam}`);
                if (details && details.name) {
                    artistName = details.name;
                    artistPicture = this.getImageUrl(details.images, details.image);
                }
            } catch (e) {
                console.warn('Failed to resolve numerical artist ID:', rawParam, e);
            }
        }

        const searchRes = await this.searchTracks(artistName);

        if (!artistPicture && searchRes.items[0]?.artists) {
            const found = searchRes.items[0].artists.find((a) => a.name.toLowerCase() === artistName.toLowerCase());
            if (found && found.picture) {
                artistPicture = found.picture;
            }
        }

        const artist = new Artist({
            id: `saavn-artist-${encodeURIComponent(artistName)}`,
            name: artistName,
            picture: artistPicture || searchRes.items[0]?.album?.cover || null,
            popularity: 85,
            type: 'ARTIST',
        });

        const tracks = searchRes.items.slice(0, 15);
        const albumMap = new Map();
        tracks.forEach((t) => {
            if (t.album && t.album.id) {
                albumMap.set(
                    t.album.id,
                    new Album({
                        id: t.album.id,
                        title: t.album.title,
                        cover: t.album.cover,
                        artist: artist,
                        artists: [artist],
                        type: 'ALBUM',
                    })
                );
            }
        });

        const result = {
            ...artist,
            albums: Array.from(albumMap.values()),
            eps: [],
            tracks: tracks,
            videos: [],
        };

        await this.cache.set('artist_v2', artistId, result);
        return result;
    }

    async getPlaylist() {
        return { items: [], tracks: [] };
    }

    async getMix() {
        return { items: [], tracks: [] };
    }

    async getArtistSocials() {
        return [];
    }

    async getArtistTopTracks(artistId) {
        const artist = await this.getArtist(artistId);
        return { tracks: artist.tracks || [], offset: 0, limit: 15, hasMore: false };
    }

    async getSimilarArtists(artistId) {
        const cached = await this.cache.get('artist_reco', artistId);
        if (cached) return cached;

        try {
            const artistName = decodeURIComponent(String(artistId).replace(/^saavn-artist-/, ''));
            const searchRes = await this.fetchJioSaavn(`__call=search.getArtistResults&q=${encodeURIComponent(artistName)}&p=1&n=12`);
            const items = searchRes.results || [];
            const artists = items.map((item) => {
                return new Artist({
                    id: item.id || `saavn-artist-${encodeURIComponent(item.name)}`,
                    name: item.name,
                    picture: this.getImageUrl(item.images, item.image),
                    type: 'ARTIST',
                });
            });

            await this.cache.set('artist_reco', artistId, artists);
            return artists;
        } catch (e) {
            console.error('Failed to get similar artists:', e);
            return [];
        }
    }

    async getArtistBiography() {
        return null;
    }

    async getSimilarAlbums(albumId) {
        if (!albumId) return [];
        const cached = await this.cache.get('album_reco', albumId);
        if (cached) return cached;

        try {
            const data = await this.fetchJioSaavn(`__call=reco.getAlbumReco&albumid=${encodeURIComponent(albumId)}`);
            const items = Array.isArray(data) ? data : data.results || [];
            const albums = items.map((item) => this.prepareAlbum(item)).filter(Boolean);
            await this.cache.set('album_reco', albumId, albums);
            return albums;
        } catch (e) {
            console.error('Failed to get album recommendations:', e);
            return [];
        }
    }

    async getRecommendedTracksForPlaylist(tracks, limit = 10) {
        if (!tracks || tracks.length === 0) return [];
        const seedTrack = tracks[0];
        const recos = await this.getTrackRecommendations(seedTrack.id);
        return recos.slice(0, limit);
    }

    async getTrackRecommendations(id) {
        if (!id) return [];
        const cached = await this.cache.get('track_reco', id);
        if (cached) return cached;

        try {
            const data = await this.fetchJioSaavn(`__call=reco.getreco&pid=${encodeURIComponent(id)}`);
            const items = data[id] || data.results || (Array.isArray(data) ? data : Object.values(data)[0]) || [];
            if (!Array.isArray(items)) return [];

            const tracks = items.map((item) => this.prepareTrack(item)).filter(Boolean);
            await this.cache.set('track_reco', id, tracks);
            return tracks;
        } catch (e) {
            console.error('Failed to get track recommendations:', e);
            return [];
        }
    }

    async getVideo() {
        throw new Error('Videos not supported on JioSaavn provider');
    }

    async getVideoStreamUrl() {
        throw new Error('Videos not supported on JioSaavn provider');
    }

    async getStreamUrl(id, quality = 'LOSSLESS') {
        const cacheKey = `stream_info_${id}_${quality}`;
        if (this.streamCache.has(cacheKey)) {
            return this.streamCache.get(cacheKey);
        }

        const track = await this.getTrack(id);
        let mediaUrls = track.media_urls;

        if (!mediaUrls && track.encrypted_media_url) {
            mediaUrls = decryptSaavnMediaUrl(track.encrypted_media_url);
        }

        let rawUrl = null;
        if (mediaUrls) {
            if (quality === 'LOW' || quality === 'NORMAL') {
                rawUrl = mediaUrls['96_KBPS'] || mediaUrls['160_KBPS'] || mediaUrls['320_KBPS'];
            } else if (quality === 'HIGH') {
                rawUrl = mediaUrls['160_KBPS'] || mediaUrls['320_KBPS'] || mediaUrls['96_KBPS'];
            } else {
                // LOSSLESS / HI_RES_LOSSLESS (320kbps MP4)
                rawUrl = mediaUrls['320_KBPS'] || mediaUrls['160_KBPS'] || mediaUrls['96_KBPS'];
            }
        }

        if (!rawUrl) {
            throw new Error(`Stream URL not found for track ID: ${id}`);
        }

        const result = {
            url: getProxyUrl(rawUrl),
            rgInfo: null,
            provider: 'jiosaavn',
        };

        this.streamCache.set(cacheKey, result);
        return result;
    }

    async getLyrics(id) {
        try {
            const data = await this.fetchJioSaavn(`__call=lyrics.getLyrics&lyrics_id=${encodeURIComponent(id)}`);
            if (data && data.lyrics) {
                return data.lyrics;
            }
            return null;
        } catch {
            return null;
        }
    }

    async enrichTrack(input, { downloadQuality = 'LOSSLESS' } = {}) {
        const id = typeof input === 'object' ? input.id : input;
        const track = await this.getTrack(id);
        const streamInfo = await this.getStreamUrl(id, downloadQuality);
        return {
            lookup: { info: { audioQuality: 'LOSSLESS' } },
            enrichedTrack: track,
            isVideo: false,
            externalStreamUrl: streamInfo.url,
        };
    }

    async enrichArtistsWithPicture(artists) {
        if (!Array.isArray(artists) || artists.length === 0) return artists;
        await Promise.all(
            artists.map(async (artist) => {
                if (artist && (!artist.picture || artist.picture === 'images/monochrome_logo.svg')) {
                    try {
                        const searchRes = await this.fetchJioSaavn(`__call=search.getArtistResults&q=${encodeURIComponent(artist.name)}&p=1&n=5`);
                        const rawItems = searchRes.results || [];
                        const matched = rawItems.find((i) => (i.name || '').toLowerCase() === (artist.name || '').toLowerCase()) || rawItems[0];
                        if (matched) {
                            artist.picture = this.getImageUrl(matched.images, matched.image);
                        }
                    } catch (e) {}
                }
            })
        );
        return artists;
    }

    async enrichTracksWithAlbumCover(tracks) {
        return tracks;
    }

    async downloadTrack(id, quality = 'LOSSLESS', filename, options = {}) {
        const streamInfo = await this.getStreamUrl(id, quality);
        const response = await fetch(streamInfo.url, { signal: options.signal });
        if (!response.ok) {
            throw new Error(`Failed to download audio: ${response.status}`);
        }
        const blob = await response.blob();

        try {
            const metadataModule = await import('./metadata.js');
            const track = await this.getTrack(id);
            const taggedBlob = await metadataModule.addMetadataToAudio(blob, track, this, options.onProgress);
            return taggedBlob || blob;
        } catch (e) {
            console.warn('Metadata tagging failed, returning raw audio blob:', e);
            return blob;
        }
    }

    getCoverUrl(id) {
        if (!id) return 'images/monochrome_logo.svg';
        if (typeof id === 'string') {
            if (id.includes('artist-default') || id.includes('default-music') || id.includes('default-film') || id.includes('www.jiosaavn.com/_i/')) {
                return 'images/monochrome_logo.svg';
            }
            return id;
        }
        return id || 'images/monochrome_logo.svg';
    }

    getCoverSrcset(id) {
        if (!id || typeof id !== 'string' || !id.startsWith('http')) return '';
        return `${id} 500w`;
    }

    getArtistPictureUrl(id) {
        if (!id) return 'images/monochrome_logo.svg';
        if (typeof id === 'string') {
            if (id.includes('artist-default') || id.includes('default-music') || id.includes('default-film') || id.includes('www.jiosaavn.com/_i/')) {
                return 'images/monochrome_logo.svg';
            }
            return id;
        }
        return id || 'images/monochrome_logo.svg';
    }

    getArtistPictureSrcset(id) {
        if (!id || typeof id !== 'string' || !id.startsWith('http')) return '';
        return `${id} 500w`;
    }

    getVideoCoverUrl() {
        return null;
    }

    extractStreamUrlFromManifest(manifest) {
        return manifest;
    }

    usesSingleUsePlaybackUrls() {
        return false;
    }

    async canPlayAmazonMusicStream() {
        return false;
    }

    async getUnifiedTurnstileJwt() {
        return null;
    }

    async clearCache() {
        await this.cache.clear();
        this.streamCache.clear();
    }

    getCacheStats() {
        return {
            ...this.cache.getCacheStats(),
            streamUrls: this.streamCache.size,
        };
    }
}
