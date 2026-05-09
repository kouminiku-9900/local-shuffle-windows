'use strict';

// ===== Playlist =====
class Playlist {
  constructor(items = []) {
    this.items = items.slice();
    this.order = items.map((_, i) => i);
    this.cursor = 0;
    this.historyStack = [];
    this.isShuffled = false;
  }

  get length() { return this.order.length; }
  get isEmpty() { return this.length === 0; }

  current() {
    if (this.isEmpty) return null;
    return this.items[this.order[this.cursor]];
  }

  setShuffle(on) {
    if (this.isEmpty) {
      this.isShuffled = on;
      return;
    }
    const currentItemIdx = this.order[this.cursor];
    if (on) {
      const arr = this.items.map((_, i) => i);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      this.order = arr;
    } else {
      this.order = this.items.map((_, i) => i);
    }
    this.cursor = this.order.indexOf(currentItemIdx);
    if (this.cursor < 0) this.cursor = 0;
    this.historyStack = [];
    this.isShuffled = on;
  }

  next() {
    if (this.isEmpty) return null;
    this.historyStack.push(this.cursor);
    this.cursor = (this.cursor + 1) % this.order.length;
    return this.current();
  }

  previous() {
    if (this.isEmpty) return null;
    if (this.historyStack.length > 0) {
      this.cursor = this.historyStack.pop();
    } else {
      this.cursor = (this.cursor - 1 + this.order.length) % this.order.length;
    }
    return this.current();
  }
}

// ===== Speed helpers =====
const SPEED_MIN = 0.25;
const SPEED_MAX = 3.0;
const QUARTER = 0.25;
const TENTH = 0.1;

function nextQuarter(rate) {
  // smallest 0.25 multiple strictly greater than rate
  return Math.min(SPEED_MAX, Math.floor(rate / QUARTER + 1e-6) * QUARTER + QUARTER);
}
function prevQuarter(rate) {
  return Math.max(SPEED_MIN, Math.ceil(rate / QUARTER - 1e-6) * QUARTER - QUARTER);
}
function bumpTenth(rate, sign) {
  const next = Math.round((rate + sign * TENTH) * 100) / 100;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, next));
}

// ===== Player =====
class Player {
  constructor() {
    this.video = document.getElementById('video');
    this.playlist = new Playlist([]);
    this.lastFolder = null;

    this.btnOpen = document.getElementById('btn-open');
    this.btnPrev = document.getElementById('btn-prev');
    this.btnPlayPause = document.getElementById('btn-playpause');
    this.btnNext = document.getElementById('btn-next');
    this.btnShuffle = document.getElementById('btn-shuffle');
    this.btnMute = document.getElementById('btn-mute');
    this.btnFullscreen = document.getElementById('btn-fullscreen');
    this.btnProperties = document.getElementById('btn-properties');
    this.volumeSlider = document.getElementById('volume');
    this.seekbar = document.getElementById('seekbar');
    this.timeCurrent = document.getElementById('time-current');
    this.timeTotal = document.getElementById('time-total');
    this.filenameLabel = document.getElementById('filename');
    this.speedLabel = document.getElementById('speed');
    this.emptyOverlay = document.getElementById('empty-overlay');

    this.modal = document.getElementById('properties-modal');
    this.modalBody = document.getElementById('prop-body');
    this.modalCloseBtn = document.getElementById('prop-close');

    this._wireUI();
    this._wireVideoEvents();
    this._initFullscreenAutoHide();
    this._updateSpeedLabel();
  }

  async init() {
    const [vol, muted, shuf] = await Promise.all([
      window.api.getStore('volume'),
      window.api.getStore('isMuted'),
      window.api.getStore('isShuffled')
    ]);
    if (typeof vol === 'number') this.setVolume(vol, false);
    if (typeof muted === 'boolean') {
      this.video.muted = muted;
      this._updateMuteButton();
    }
    if (typeof shuf === 'boolean') {
      this.playlist.setShuffle(shuf);
      this._updateShuffleButton();
    }
  }

  _wireUI() {
    this.btnOpen.addEventListener('click', () => this.openFolder());
    this.btnPrev.addEventListener('click', () => this.previous());
    this.btnNext.addEventListener('click', () => this.next());
    this.btnPlayPause.addEventListener('click', () => this.togglePlayPause());
    this.btnShuffle.addEventListener('click', () => this.toggleShuffle());
    this.btnMute.addEventListener('click', () => this.toggleMute());
    this.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    this.btnProperties.addEventListener('click', () => this.openProperties());

    this.speedLabel.addEventListener('click', () => this.setSpeed(1.0));

    this.volumeSlider.addEventListener('input', (e) => {
      this.setVolume(Number(e.target.value) / 100, true);
    });

    this.seekbar.addEventListener('input', (e) => {
      const dur = this.video.duration;
      if (Number.isFinite(dur) && dur > 0) {
        this.video.currentTime = (Number(e.target.value) / 1000) * dur;
      }
    });

    this.modalCloseBtn.addEventListener('click', () => this.closeProperties());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeProperties();
    });
    this.modal.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.closeProperties();
    });
  }

  _wireVideoEvents() {
    this.video.addEventListener('ended', () => this.next());
    this.video.addEventListener('play', () => { this.btnPlayPause.textContent = '⏸'; });
    this.video.addEventListener('pause', () => { this.btnPlayPause.textContent = '▶'; });
    this.video.addEventListener('click', () => this.togglePlayPause());
    this.video.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.toggleFullscreen();
    });
    this.video.addEventListener('timeupdate', () => this._updateTimeUI());
    this.video.addEventListener('loadedmetadata', () => this._updateTimeUI());
    this.video.addEventListener('volumechange', () => {
      this._updateMuteButton();
    });
    this.video.addEventListener('ratechange', () => this._updateSpeedLabel());
    this.video.addEventListener('error', () => {
      console.warn('video element error', this.video.error);
    });
  }

  _initFullscreenAutoHide() {
    let timer = null;
    const show = () => {
      document.body.classList.remove('idle');
      if (timer) clearTimeout(timer);
      if (document.body.classList.contains('fullscreen')) {
        timer = setTimeout(() => document.body.classList.add('idle'), 2500);
      }
    };
    document.addEventListener('mousemove', show);
    document.addEventListener('mousedown', show);
    document.addEventListener('keydown', show);
    document.addEventListener('fullscreenchange', () => {
      const fs = !!document.fullscreenElement;
      document.body.classList.toggle('fullscreen', fs);
      if (!fs) document.body.classList.remove('idle');
      show();
    });
  }

  // ===== Folder / playlist =====
  async openFolder() {
    const folder = await window.api.openFolder();
    if (!folder) return;
    await this.loadFolder(folder);
  }

  async loadFolder(folder) {
    const result = await window.api.listVideos(folder);
    if (!Array.isArray(result)) {
      console.warn('listVideos error', result);
      return;
    }
    if (result.length === 0) {
      this._setEmptyState('このフォルダに対応動画が見つかりません');
      return;
    }
    this.playlist = new Playlist(result);
    if (await window.api.getStore('isShuffled')) {
      this.playlist.setShuffle(true);
    }
    this._updateShuffleButton();
    this.lastFolder = folder;
    window.api.setStore('lastFolder', folder);
    this.emptyOverlay.classList.add('hidden');
    this._playCurrent();
  }

  _setEmptyState(msg) {
    this.emptyOverlay.querySelector('p').textContent = msg;
    this.emptyOverlay.classList.remove('hidden');
    this.filenameLabel.textContent = '';
  }

  _playCurrent() {
    const file = this.playlist.current();
    if (!file) return;
    const prevRate = this.video.playbackRate;
    this.video.src = this._toFileURL(file);
    // preserve playback rate across video changes
    this.video.addEventListener('loadedmetadata', () => {
      this.video.playbackRate = prevRate;
    }, { once: true });
    this.video.play().catch((err) => console.warn('play() rejected', err));
    this.filenameLabel.textContent = this._displayPath(file);
  }

  _displayPath(file) {
    const root = this.lastFolder;
    if (root && file.toLowerCase().startsWith(root.toLowerCase())) {
      let rel = file.slice(root.length).replace(/^[\\/]+/, '');
      rel = rel.replace(/\\/g, '/');
      return rel;
    }
    return this._basename(file);
  }

  _toFileURL(p) {
    let normalized = p.replace(/\\/g, '/');
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return 'file://' + normalized.split('/').map((seg, i) => {
      if (i === 0) return '';
      return encodeURIComponent(seg);
    }).join('/');
  }

  _basename(p) {
    const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    return idx >= 0 ? p.slice(idx + 1) : p;
  }

  // ===== Playback =====
  togglePlayPause() {
    if (this.playlist.isEmpty) return;
    if (this.video.paused) this.video.play();
    else this.video.pause();
  }

  next() {
    if (this.playlist.isEmpty) return;
    this.playlist.next();
    this._playCurrent();
  }

  previous() {
    if (this.playlist.isEmpty) return;
    this.playlist.previous();
    this._playCurrent();
  }

  seekBy(seconds) {
    if (!Number.isFinite(this.video.duration)) return;
    const t = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    this.video.currentTime = t;
  }

  seekToPercent(p) {
    if (!Number.isFinite(this.video.duration)) return;
    this.video.currentTime = this.video.duration * p;
  }

  setVolume(v, persist) {
    v = Math.max(0, Math.min(1, v));
    this.video.volume = v;
    this.volumeSlider.value = String(Math.round(v * 100));
    if (persist) window.api.setStore('volume', v);
  }

  bumpVolume(delta) {
    this.setVolume(this.video.volume + delta, true);
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    window.api.setStore('isMuted', this.video.muted);
    this._updateMuteButton();
  }

  _updateMuteButton() {
    this.btnMute.textContent = this.video.muted || this.video.volume === 0 ? '🔇' : '🔊';
  }

  // ===== Speed =====
  setSpeed(rate) {
    rate = Math.min(SPEED_MAX, Math.max(SPEED_MIN, rate));
    this.video.playbackRate = rate;
    this._updateSpeedLabel();
  }
  bumpSpeedQuarter(sign) {
    this.setSpeed(sign > 0 ? nextQuarter(this.video.playbackRate) : prevQuarter(this.video.playbackRate));
  }
  bumpSpeedTenth(sign) {
    this.setSpeed(bumpTenth(this.video.playbackRate, sign));
  }
  _updateSpeedLabel() {
    const r = this.video.playbackRate || 1.0;
    this.speedLabel.textContent = `${r.toFixed(2)}x`;
    this.speedLabel.classList.toggle('warn', Math.abs(r - 1.0) > 0.01);
  }

  toggleShuffle() {
    this.playlist.setShuffle(!this.playlist.isShuffled);
    window.api.setStore('isShuffled', this.playlist.isShuffled);
    this._updateShuffleButton();
  }

  _updateShuffleButton() {
    this.btnShuffle.textContent = '🔀 ' + (this.playlist.isShuffled ? 'On' : 'Off');
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  }

  _updateTimeUI() {
    const cur = this.video.currentTime || 0;
    const dur = this.video.duration;
    this.timeCurrent.textContent = formatTime(cur);
    if (Number.isFinite(dur) && dur > 0) {
      this.timeTotal.textContent = formatTime(dur);
      this.seekbar.value = String(Math.round((cur / dur) * 1000));
    } else {
      this.timeTotal.textContent = '0:00';
      this.seekbar.value = '0';
    }
  }

  // ===== Properties modal =====
  async openProperties() {
    const file = this.playlist.current();
    if (!file) return;
    if (!this.modal.open) this.modal.showModal();
    this.modalBody.innerHTML = '<div class="prop-loading">[ analyzing... ]</div>';
    try {
      const res = await window.api.analyzeMedia(file);
      if (res && res.error) {
        this._renderPropsError(res.error);
      } else if (res && res.ok) {
        this._renderProps(file, res.fileSize, res.result);
      } else {
        this._renderPropsError('unexpected response');
      }
    } catch (err) {
      this._renderPropsError(String(err));
    }
  }

  closeProperties() {
    if (this.modal.open) this.modal.close();
  }

  _renderProps(file, fileSize, info) {
    const tracks = (info && info.media && info.media.track) || [];
    const general = tracks.find((t) => t['@type'] === 'General') || {};
    const video = tracks.find((t) => t['@type'] === 'Video') || null;
    const audio = tracks.find((t) => t['@type'] === 'Audio') || null;

    const sections = [];

    sections.push(this._propSection('FILE', [
      ['name', this._basename(file)],
      ['path', file.replace(/\\/g, '/')],
      ['size', formatBytes(fileSize)],
      ['container', general.Format || general.FileExtension || '—'],
      ['duration', formatDurationSec(general.Duration)],
      ['overall bit rate', formatBitrate(general.OverallBitRate)],
      ['video tracks', tracks.filter((t) => t['@type'] === 'Video').length],
      ['audio tracks', tracks.filter((t) => t['@type'] === 'Audio').length]
    ]));

    if (video) {
      sections.push(this._propSection('VIDEO', [
        ['codec', joinNonEmpty([video.Format, video.Format_Profile, video.Format_Level && 'L' + video.Format_Level])],
        ['codec id', video.CodecID || '—'],
        ['resolution', (video.Width && video.Height) ? `${video.Width}×${video.Height}` : '—'],
        ['display aspect', video.DisplayAspectRatio || '—'],
        ['frame rate', video.FrameRate ? `${Number(video.FrameRate).toFixed(3)} fps` : '—'],
        ['bit rate', formatBitrate(video.BitRate || video.BitRate_Nominal)],
        ['bit depth', video.BitDepth ? `${video.BitDepth} bit` : '—'],
        ['color space', joinNonEmpty([video.ColorSpace, video.ChromaSubsampling])],
        ['scan type', video.ScanType || '—'],
        ['hdr / transfer', joinNonEmpty([video.HDR_Format, video.transfer_characteristics])]
      ]));
    }

    if (audio) {
      sections.push(this._propSection('AUDIO', [
        ['codec', joinNonEmpty([audio.Format, audio.Format_AdditionalFeatures, audio.Format_Profile])],
        ['codec id', audio.CodecID || '—'],
        ['channels', audio.Channels ? `${audio.Channels} ch${audio.ChannelLayout ? ' (' + audio.ChannelLayout + ')' : ''}` : '—'],
        ['sample rate', audio.SamplingRate ? `${(audio.SamplingRate / 1000).toFixed(1)} kHz` : '—'],
        ['bit rate', formatBitrate(audio.BitRate || audio.BitRate_Nominal)],
        ['bit depth', audio.BitDepth ? `${audio.BitDepth} bit` : '—'],
        ['language', audio.Language || '—']
      ]));
    }

    this.modalBody.innerHTML = sections.join('');
  }

  _propSection(title, rows) {
    const inner = rows
      .filter(([_, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `
        <div class="prop-row">
          <span class="prop-key">${escapeHtml(String(k))}</span>
          <span class="prop-val">${escapeHtml(String(v))}</span>
        </div>`)
      .join('');
    return `
      <div class="prop-section">
        <div class="prop-section-head">[ ${escapeHtml(title)} ]</div>
        ${inner}
      </div>`;
  }

  _renderPropsError(msg) {
    this.modalBody.innerHTML =
      `<div class="prop-section"><div class="prop-section-head">[ ERROR ]</div>` +
      `<div class="prop-error">${escapeHtml(msg)}</div></div>`;
  }
}

// ===== utility =====
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}
function formatBytes(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${u[i]}  (${n.toLocaleString()} B)`;
}
function formatDurationSec(d) {
  d = Number(d);
  if (!Number.isFinite(d) || d <= 0) return '—';
  return formatTime(d) + `  (${d.toFixed(3)} s)`;
}
function formatBitrate(b) {
  b = Number(b);
  if (!Number.isFinite(b) || b <= 0) return '—';
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(2)} Mbps`;
  if (b >= 1_000) return `${(b / 1_000).toFixed(0)} kbps`;
  return `${b} bps`;
}
function joinNonEmpty(arr) {
  return arr.filter((x) => x !== undefined && x !== null && x !== '').join(' / ') || '—';
}

// ===== Shortcuts =====
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function installShortcuts(player) {
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;

    // Number keys (no shift) → jump to N×10%
    if (!e.shiftKey && !e.ctrlKey && !e.altKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      player.seekToPercent(Number(e.key) / 10);
      return;
    }

    // Speed: > / < (Shift+. / Shift+,) → ±0.25
    if (e.shiftKey && (e.key === '>' || e.key === '.')) {
      e.preventDefault();
      player.bumpSpeedQuarter(+1);
      return;
    }
    if (e.shiftKey && (e.key === '<' || e.key === ',')) {
      e.preventDefault();
      player.bumpSpeedQuarter(-1);
      return;
    }

    // Next / Prev: Shift+N / Shift+B
    if (e.shiftKey && (e.key === 'N' || e.key === 'n')) {
      e.preventDefault();
      player.next();
      return;
    }
    if (e.shiftKey && (e.key === 'B' || e.key === 'b')) {
      e.preventDefault();
      player.previous();
      return;
    }

    // Shuffle: Shift+S
    if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      player.toggleShuffle();
      return;
    }

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        player.togglePlayPause();
        return;
      case 'ArrowLeft':
        e.preventDefault();
        player.seekBy(-5);
        return;
      case 'ArrowRight':
        e.preventDefault();
        player.seekBy(5);
        return;
      case 'j':
      case 'J':
        e.preventDefault();
        player.seekBy(-10);
        return;
      case 'l':
      case 'L':
        e.preventDefault();
        player.seekBy(10);
        return;
      case 'ArrowUp':
        e.preventDefault();
        player.bumpVolume(0.05);
        return;
      case 'ArrowDown':
        e.preventDefault();
        player.bumpVolume(-0.05);
        return;
      case 'm':
      case 'M':
        e.preventDefault();
        player.toggleMute();
        return;
      case 'f':
      case 'F':
        e.preventDefault();
        player.toggleFullscreen();
        return;
      case 'd':
      case 'D':
        e.preventDefault();
        player.bumpSpeedTenth(+1);
        return;
      case 's':
        // bare 's' (no shift) = speed -0.1
        e.preventDefault();
        player.bumpSpeedTenth(-1);
        return;
      case 'i':
      case 'I':
        e.preventDefault();
        player.openProperties();
        return;
      case 'o':
      case 'O':
        e.preventDefault();
        player.openFolder();
        return;
      case 'Escape':
        if (player.modal && player.modal.open) {
          e.preventDefault();
          player.closeProperties();
        } else if (document.fullscreenElement) {
          e.preventDefault();
          document.exitFullscreen();
        }
        return;
    }
  });
}

// ===== Bootstrap =====
window.addEventListener('DOMContentLoaded', async () => {
  const player = new Player();
  await player.init();
  installShortcuts(player);

  window.api.onRestoreFolder((folder) => {
    player.loadFolder(folder).catch((err) => console.warn(err));
  });
});
