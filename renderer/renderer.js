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

  upcoming(limit = 50) {
    if (this.isEmpty) return [];
    const out = [];
    const n = this.order.length;
    for (let i = 0; i < Math.min(limit, n); i++) {
      const idx = (this.cursor + i) % n;
      out.push({ rel: i, file: this.items[this.order[idx]] });
    }
    return out;
  }
}

// ===== Loudness normalizer (ReplayGain-style) =====
// Routes the <video> through Web Audio: source → analyser (tap) → gain → destination.
// Continuously measures RMS and adjusts the gain so different videos play at a similar
// perceived loudness. Range clamped to avoid clipping or pumping.
class LoudnessNormalizer {
  constructor(videoEl, onGainUpdate) {
    this.video = videoEl;
    this.onGainUpdate = onGainUpdate || (() => {});
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.gain = null;
    this.buf = null;
    this.timer = null;
    this.enabled = true;
    this.targetRms = 0.126;        // ~ -18 dBFS
    this.minGain = 0.5;
    this.maxGain = 3.0;
    this.attached = false;

    // Re-prime analysis on each new video.
    this.video.addEventListener('loadeddata', () => this._prime());
  }

  _ensureContext() {
    if (this.ctx) return true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      this.ctx = new Ctx();
      this.source = this.ctx.createMediaElementSource(this.video);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.gain = this.ctx.createGain();
      this.gain.gain.value = 1.0;
      this.userVol = this.ctx.createGain();
      // preserve whatever volume the slider set before the context existed
      this.userVol.gain.value = this.video.volume;
      this.video.volume = 1.0; // route volume through Web Audio from now on
      // Tap analyser from the raw source so RMS reflects the file, not our own gain.
      this.source.connect(this.analyser);
      this.source.connect(this.gain);
      this.gain.connect(this.userVol);
      this.userVol.connect(this.ctx.destination);
      this.buf = new Float32Array(this.analyser.fftSize);
      this.attached = true;
      return true;
    } catch (err) {
      console.warn('LoudnessNormalizer init failed', err);
      return false;
    }
  }

  setUserVolume(v) {
    v = Math.max(0, Math.min(1, v));
    if (this.userVol && this.ctx) {
      const t = this.ctx.currentTime;
      try {
        this.userVol.gain.cancelScheduledValues(t);
        this.userVol.gain.setValueAtTime(v, t);
      } catch {}
    } else {
      this.video.volume = v;
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.attached) return;
    if (!this.enabled) this._rampGain(1.0, 0.4);
  }

  _prime() {
    // Force a small re-adapt at the start of a new video.
    if (this.attached && this.enabled) this._rampGain(1.0, 0.05);
  }

  start() {
    if (!this._ensureContext()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), 200);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _tick() {
    if (!this.attached) return;
    if (this.video.paused || this.video.ended || this.video.muted) return;
    if (!this.enabled) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    if (rms < 0.0008) return; // ignore near-silence
    let target = this.targetRms / rms;
    if (target < this.minGain) target = this.minGain;
    if (target > this.maxGain) target = this.maxGain;
    this._rampGain(target, 0.5);
  }

  _rampGain(value, secs) {
    if (!this.gain) return;
    const t = this.ctx.currentTime;
    try {
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(value, t + secs);
      this.onGainUpdate(value);
    } catch {}
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

    this.btnQueue = document.getElementById('btn-queue');
    this.btnSettings = document.getElementById('btn-settings');
    this.queuePanel = document.getElementById('queue-panel');
    this.queueListEl = document.getElementById('queue-list');
    this.queueCountEl = document.getElementById('queue-count');
    this.bossOverlay = document.getElementById('boss-overlay');
    this.settingsModal = document.getElementById('settings-modal');
    this.settingsCloseBtn = document.getElementById('settings-close');

    this.shortcutMode = 'youtube'; // 'youtube' | 'simple'
    this.bossKeyMode = 'toggle';   // 'toggle' | 'hold'
    this.replayGainEnabled = true;
    this.bossActive = false;
    this.bossPrev = null;
    this.queueOpen = false;

    this.rgGainLabel = document.getElementById('rg-gain');
    this.replayGainCheckbox = document.getElementById('setting-replaygain');

    this.normalizer = new LoudnessNormalizer(this.video, (g) => {
      if (this.rgGainLabel) this.rgGainLabel.textContent = `${g.toFixed(2)}x`;
    });

    this._wireUI();
    this._wireVideoEvents();
    this._initFullscreenAutoHide();
    this._updateSpeedLabel();
  }

  async init() {
    const [vol, muted, shuf, mode, rg, bk] = await Promise.all([
      window.api.getStore('volume'),
      window.api.getStore('isMuted'),
      window.api.getStore('isShuffled'),
      window.api.getStore('shortcutMode'),
      window.api.getStore('replayGain'),
      window.api.getStore('bossKeyMode')
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
    if (mode === 'youtube' || mode === 'simple') this.shortcutMode = mode;
    if (bk === 'toggle' || bk === 'hold') this.bossKeyMode = bk;
    if (typeof rg === 'boolean') this.replayGainEnabled = rg;
    this.normalizer.setEnabled(this.replayGainEnabled);
    if (this.replayGainCheckbox) this.replayGainCheckbox.checked = this.replayGainEnabled;
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

    this.btnQueue.addEventListener('click', () => this.toggleQueue());
    this.btnSettings.addEventListener('click', () => this.openSettings());
    this.settingsCloseBtn.addEventListener('click', () => this.closeSettings());
    this.settingsModal.addEventListener('click', (e) => {
      if (e.target === this.settingsModal) this.closeSettings();
    });
    this.settingsModal.addEventListener('cancel', (e) => {
      e.preventDefault();
      this.closeSettings();
    });
    this.settingsModal.querySelectorAll('input[name="shortcutMode"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) this.setShortcutMode(r.value);
      });
    });
    this.settingsModal.querySelectorAll('input[name="bossKeyMode"]').forEach((r) => {
      r.addEventListener('change', () => {
        if (r.checked) this.setBossKeyMode(r.value);
      });
    });

    if (this.replayGainCheckbox) {
      this.replayGainCheckbox.addEventListener('change', () => {
        this.setReplayGain(this.replayGainCheckbox.checked);
      });
    }

    // boss key safety: release on window blur so it doesn't get stuck
    window.addEventListener('blur', () => this.bossOff());
  }

  _wireVideoEvents() {
    this.video.addEventListener('ended', () => this.next());
    this.video.addEventListener('play', () => {
      this.btnPlayPause.textContent = '⏸';
      // Lazy-start the normalizer on first user-triggered play (AudioContext requires gesture)
      this.normalizer.start();
    });
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
    this._renderQueue();
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
    this.userVolume = v;
    this.normalizer.setUserVolume(v);
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
    this._renderQueue();
  }

  // ===== Settings =====
  openSettings() {
    if (!this.settingsModal.open) this.settingsModal.showModal();
    this.settingsModal.querySelectorAll('input[name="shortcutMode"]').forEach((r) => {
      r.checked = (r.value === this.shortcutMode);
    });
    this.settingsModal.querySelectorAll('input[name="bossKeyMode"]').forEach((r) => {
      r.checked = (r.value === this.bossKeyMode);
    });
    if (this.replayGainCheckbox) this.replayGainCheckbox.checked = this.replayGainEnabled;
  }
  closeSettings() {
    if (this.settingsModal.open) this.settingsModal.close();
  }
  setShortcutMode(mode) {
    if (mode !== 'youtube' && mode !== 'simple') return;
    this.shortcutMode = mode;
    window.api.setStore('shortcutMode', mode);
  }
  setBossKeyMode(mode) {
    if (mode !== 'toggle' && mode !== 'hold') return;
    this.bossKeyMode = mode;
    window.api.setStore('bossKeyMode', mode);
    // switching mode: release if currently on so the user isn't surprised
    if (this.bossActive) this.bossOff();
  }
  setReplayGain(on) {
    this.replayGainEnabled = !!on;
    window.api.setStore('replayGain', this.replayGainEnabled);
    this.normalizer.setEnabled(this.replayGainEnabled);
  }

  // ===== Boss key =====
  bossOn() {
    if (this.bossActive) return;
    this.bossActive = true;
    this.bossPrev = { paused: this.video.paused, muted: this.video.muted };
    this.video.pause();
    this.video.muted = true;
    this.bossOverlay.classList.add('active');
    this.bossOverlay.setAttribute('aria-hidden', 'false');
  }
  bossOff() {
    if (!this.bossActive) return;
    this.bossActive = false;
    this.bossOverlay.classList.remove('active');
    this.bossOverlay.setAttribute('aria-hidden', 'true');
    if (this.bossPrev) {
      this.video.muted = this.bossPrev.muted;
      if (!this.bossPrev.paused) this.video.play().catch(() => {});
    }
    this.bossPrev = null;
  }

  // ===== Queue panel =====
  toggleQueue() {
    this.queueOpen = !this.queueOpen;
    this.queuePanel.classList.toggle('open', this.queueOpen);
    this.queuePanel.setAttribute('aria-hidden', this.queueOpen ? 'false' : 'true');
    if (this.queueOpen) this._renderQueue();
  }
  closeQueue() {
    if (!this.queueOpen) return;
    this.queueOpen = false;
    this.queuePanel.classList.remove('open');
    this.queuePanel.setAttribute('aria-hidden', 'true');
  }
  _renderQueue() {
    if (!this.queueListEl) return;
    const items = this.playlist.upcoming(60);
    const total = this.playlist.length;
    if (items.length === 0) {
      this.queueListEl.innerHTML = '<li><span class="qi-idx">—</span><span class="qi-name">empty</span></li>';
      this.queueCountEl.textContent = '';
      return;
    }
    const html = items.map((it) => {
      const name = this._displayPath(it.file);
      const isCurrent = it.rel === 0;
      const idx = isCurrent ? '▶' : String(it.rel).padStart(2, '0');
      return `<li class="${isCurrent ? 'queue-current' : ''}">` +
             `<span class="qi-idx">${idx}</span>` +
             `<span class="qi-name">${escapeHtml(name)}</span></li>`;
    }).join('');
    this.queueListEl.innerHTML = html;
    this.queueCountEl.textContent = `[${total} items${this.playlist.isShuffled ? ' / shuffled' : ''}]`;
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

    // Boss key — behaviour depends on bossKeyMode setting
    if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      if (e.repeat) return;
      if (player.bossKeyMode === 'hold') {
        player.bossOn();              // keyup will release
      } else {
        if (player.bossActive) player.bossOff();
        else player.bossOn();
      }
      return;
    }
    // While the boss screen is up, swallow other keys
    if (player.bossActive) {
      e.preventDefault();
      return;
    }

    // Number keys (no shift) → jump to N×10%
    if (!e.shiftKey && !e.ctrlKey && !e.altKey && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      player.seekToPercent(Number(e.key) / 10);
      return;
    }

    // Speed: Shift+> / Shift+< → ±0.25
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

    // Next / Prev: Shift+N / Shift+B (always available)
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

    // Shuffle: Shift+S (always)
    if (e.shiftKey && (e.key === 'S' || e.key === 's')) {
      e.preventDefault();
      player.toggleShuffle();
      return;
    }

    // Simple-mode bare keys: B / N / , / . without Shift
    if (player.shortcutMode === 'simple' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      switch (e.key) {
        case 'n': case 'N':
          e.preventDefault(); player.next(); return;
        case 'b': case 'B':
          e.preventDefault(); player.previous(); return;
        case '.':
          e.preventDefault(); player.bumpSpeedQuarter(+1); return;
        case ',':
          e.preventDefault(); player.bumpSpeedQuarter(-1); return;
      }
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
        e.preventDefault();
        player.bumpSpeedTenth(-1);
        return;
      case 'q':
      case 'Q':
        e.preventDefault();
        player.toggleQueue();
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
        } else if (player.settingsModal && player.settingsModal.open) {
          e.preventDefault();
          player.closeSettings();
        } else if (player.queueOpen) {
          e.preventDefault();
          player.closeQueue();
        } else if (document.fullscreenElement) {
          e.preventDefault();
          document.exitFullscreen();
        }
        return;
    }
  });

  // Boss key release for hold mode
  window.addEventListener('keyup', (e) => {
    if ((e.key === 'w' || e.key === 'W') && player.bossKeyMode === 'hold') {
      e.preventDefault();
      player.bossOff();
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
