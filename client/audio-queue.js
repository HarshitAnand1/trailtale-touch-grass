/**
 * Trailtale Audio Queue
 * Manages story segment audio playback.
 * - Keeps at most one finished segment waiting (from the design doc)
 * - Plays when moving, pauses when still
 * - Plays ambient pause sound when queue is empty
 */

class AudioQueue {
  constructor() {
    this.queue = [];       // Array of { audioUrl, text, segmentNumber }
    this.currentAudio = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.onSegmentStart = null; // callback(segment)
    this.onSegmentEnd = null;   // callback(segment)
    this.onQueueEmpty = null;   // callback()

    // Create audio context for ambient sounds
    this._audioCtx = null;
  }

  /**
   * Add a segment to the queue. Max queue size = 1 waiting + 1 playing.
   */
  enqueue(segment) {
    // Keep at most one finished segment waiting
    if (this.queue.length >= 1 && this.currentAudio) {
      this.queue.shift(); // drop the oldest waiting segment
    }
    this.queue.push(segment);
    if (!this.currentAudio && this.isPlaying) {
      this._playNext();
    }
  }

  /**
   * Start playback (called when walk gate says "moving").
   */
  play() {
    this.isPlaying = true;
    if (this.currentAudio) {
      this.currentAudio.play().catch(() => {});
    } else {
      this._playNext();
    }
  }

  /**
   * Pause after the current sentence (called when walk gate says "still").
   */
  pause() {
    this.isPlaying = false;
    if (this.currentAudio) {
      // Fade out over 500ms for a smooth pause
      this._fadeOut(this.currentAudio, 500);
    }
  }

  /**
   * Stop and clear everything.
   */
  stop() {
    this.isPlaying = false;
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.queue = [];
  }

  _playNext() {
    if (this.queue.length === 0) {
      this.currentAudio = null;
      if (this.onQueueEmpty) this.onQueueEmpty();
      // Play ambient pause
      this._playAmbientPause();
      return;
    }

    const segment = this.queue.shift();
    const audio = new Audio(segment.audioUrl || segment.audio_url);
    audio.volume = this.isMuted ? 0 : 1;

    audio.addEventListener('play', () => {
      if (this.onSegmentStart) this.onSegmentStart(segment);
    });

    audio.addEventListener('ended', () => {
      if (this.onSegmentEnd) this.onSegmentEnd(segment);
      this.currentAudio = null;
      if (this.isPlaying) {
        this._playNext();
      }
    });

    audio.addEventListener('error', () => {
      console.warn('Audio error for segment', segment.segmentNumber || segment.segment_number);
      this.currentAudio = null;
      if (this.isPlaying) this._playNext();
    });

    this.currentAudio = audio;
    if (this.isPlaying) {
      audio.play().catch((e) => console.warn('Play failed:', e));
    }
  }

  _fadeOut(audio, ms) {
    const step = 50;
    const volumeStep = audio.volume / (ms / step);
    const interval = setInterval(() => {
      audio.volume = Math.max(0, audio.volume - volumeStep);
      if (audio.volume <= 0) {
        clearInterval(interval);
        audio.pause();
        audio.volume = 1; // reset for resume
      }
    }, step);
  }

  _playAmbientPause() {
    // Generate a soft ambient tone instead of silence
    if (!this._audioCtx) {
      try {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return;
      }
    }
    if (!this.isPlaying) return;

    const ctx = this._audioCtx;
    const duration = 3;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, ctx.currentTime); // soft low tone
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.03, ctx.currentTime + 0.5);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }
}

window.AudioQueue = AudioQueue;
