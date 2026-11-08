// Audio synthesizer using Web Audio API for crisp order notifications & alert chimes

class SoundService {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = true;
  private audioBlocked: boolean = false;
  private listeners: Set<(blocked: boolean) => void> = new Set();

  constructor() {
    // AudioContext will be initialized on first user interaction or alert to comply with browser autoplay policy
    if (typeof window !== 'undefined') {
      const unlockOnGesture = () => {
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx
            .resume()
            .then(() => {
              if (this.ctx && this.ctx.state === 'running') {
                this.setAudioBlocked(false);
              }
            })
            .catch(() => {});
        }
      };
      window.addEventListener('pointerdown', unlockOnGesture, { passive: true });
      window.addEventListener('keydown', unlockOnGesture, { passive: true });
    }
  }

  private setAudioBlocked(blocked: boolean) {
    if (this.audioBlocked !== blocked) {
      this.audioBlocked = blocked;
      this.listeners.forEach((cb) => {
        try {
          cb(this.audioBlocked);
        } catch {
          // ignore listener error
        }
      });
    }
  }

  public isAudioBlocked(): boolean {
    return this.audioBlocked;
  }

  public onBlockedChange(cb: (blocked: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.ctx.onstatechange = () => {
          if (this.ctx?.state === 'running') {
            this.setAudioBlocked(false);
          }
        };
      }
    }
  }

  public async unlockAudio(): Promise<boolean> {
    try {
      this.initContext();
      if (!this.ctx) return false;
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      const running = this.ctx.state === 'running';
      this.setAudioBlocked(!running);
      return running;
    } catch {
      this.setAudioBlocked(true);
      return false;
    }
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    if (!enabled) {
      this.setAudioBlocked(false);
    }
  }

  public isEnabled() {
    return this.soundEnabled;
  }

  // Dual-tone classic store bell / cash register chime for new orders
  public async playNewOrderSound(): Promise<boolean> {
    if (!this.soundEnabled) return false;
    try {
      this.initContext();
      if (!this.ctx) return false;

      if (this.ctx.state === 'suspended') {
        try {
          await Promise.race([
            this.ctx.resume(),
            new Promise((resolve) => setTimeout(resolve, 250)),
          ]);
        } catch {
          // ignore resume error
        }
      }

      if (this.ctx.state !== 'running') {
        this.setAudioBlocked(true);
        return false;
      }

      this.setAudioBlocked(false);
      const now = this.ctx.currentTime;

      // Note 1: High crisp ding (G5 ~ 784Hz)
      const osc1 = this.ctx.createOscillator();
      const gain1 = this.ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(783.99, now);
      osc1.frequency.exponentialRampToValueAtTime(783.99, now + 0.3);

      gain1.gain.setValueAtTime(0.01, now);
      gain1.gain.exponentialRampToValueAtTime(0.35, now + 0.04);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc1.connect(gain1);
      gain1.connect(this.ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      // Note 2: Cheerful higher resolution ping (C6 ~ 1046.5Hz) after 150ms
      const osc2 = this.ctx.createOscillator();
      const gain2 = this.ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.5, now + 0.15);

      gain2.gain.setValueAtTime(0.01, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.4, now + 0.18);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

      osc2.connect(gain2);
      gain2.connect(this.ctx.destination);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.9);

      // Note 3: Sub harmonic warmth (E6 ~ 1318.5Hz) after 280ms
      const osc3 = this.ctx.createOscillator();
      const gain3 = this.ctx.createGain();
      osc3.type = 'sine';
      osc3.frequency.setValueAtTime(1318.51, now + 0.28);

      gain3.gain.setValueAtTime(0.01, now + 0.28);
      gain3.gain.exponentialRampToValueAtTime(0.35, now + 0.32);
      gain3.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

      osc3.connect(gain3);
      gain3.connect(this.ctx.destination);
      osc3.start(now + 0.28);
      osc3.stop(now + 1.2);

      return true;
    } catch (e) {
      console.warn('Audio playback error:', e);
      this.setAudioBlocked(true);
      return false;
    }
  }

  // Quick subtle tap
  public playClickSound() {
    if (!this.soundEnabled) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.01, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // Ignored
    }
  }

  // Quick positive chime for completing order / adding item
  public playSuccessSound() {
    if (!this.soundEnabled) return;
    try {
      this.initContext();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      console.warn('Audio error:', e);
    }
  }
}

export const soundService = new SoundService();

