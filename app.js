/**
 * 方眼ボウリング (Grid Bowling Pro)
 * Single-File Blueprint Physics & Authentic 10-Frame Bowling Engine
 */

// --- Web Audio Synthesizer (Zero External Assets) ---
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playLaunch(powerRatio) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.exponentialRampToValueAtTime(220 + powerRatio * 120, now + 0.18);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  playPinHit(intensity = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Wood/plastic clatter tone
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    const baseFreq = 320 + Math.random() * 280;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.11);

    const vol = Math.min(0.3, Math.max(0.05, intensity * 0.18));
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  playFanfare(type) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = type === 'STRIKE' ? [523.25, 659.25, 783.99, 1046.5] :
                  type === 'SPARE'  ? [440, 554.37, 659.25] : [220, 196];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type === 'GUTTER' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);
      gain.gain.setValueAtTime(0.16, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.35);
    });
  }
}

const sfx = new SoundEngine();

// --- Game Constants & Coordinate Space ---
// Virtual Blueprint Coordinate System: 420 x 740
const VW = 420;
const VH = 740;
const LANE_LEFT = 75;
const LANE_RIGHT = 345;
const LANE_WIDTH = LANE_RIGHT - LANE_LEFT; // 270
const GUTTER_WIDTH = 30;
const FOUL_LINE_Y = 565;
const PIN_DECK_TOP = 70;
const HEAD_PIN_Y = 195;
const PIN_ROW_SPACING = 34;
const PIN_COL_SPACING = 39;

// Game State
const STATE = {
  AIMING: 'AIMING',
  ROLLING: 'ROLLING',
  SETTLING: 'SETTLING',
  GAMEOVER: 'GAMEOVER'
};

let gameState = STATE.AIMING;

// Bowling 10-Frame Score Structure
let frames = [];
let currentFrameIdx = 0; // 0 to 9
let stats = { strikes: 0, spares: 0, gutters: 0, maxStreak: 0, curStreak: 0 };

function initScoreboardData() {
  frames = [];
  for (let i = 0; i < 10; i++) {
    frames.push({
      rolls: [],       // numeric pins knocked down per delivery
      symbols: [],     // 'X', '/', '-', or number string
      cumulative: null
    });
  }
  currentFrameIdx = 0;
  stats = { strikes: 0, spares: 0, gutters: 0, maxStreak: 0, curStreak: 0 };
  renderScoreboardDOM();
}

function renderScoreboardDOM() {
  const sb = document.getElementById('scoreboard');
  sb.innerHTML = '';
  frames.forEach((f, idx) => {
    const box = document.createElement('div');
    box.className = 'frame-box' + (idx === currentFrameIdx && gameState !== STATE.GAMEOVER ? ' active' : '');
    const isTenth = idx === 9;
    const s0 = f.symbols[0] || '';
    const s1 = f.symbols[1] || '';
    const s2 = f.symbols[2] || '';

    box.innerHTML = `
      <div class="frame-num">${idx + 1}</div>
      <div class="rolls">
        <div class="roll-cell">${s0}</div>
        <div class="roll-cell">${s1}</div>
        ${isTenth ? `<div class="roll-cell">${s2}</div>` : ''}
      </div>
      <div class="frame-total">${f.cumulative !== null ? f.cumulative : ''}</div>
    `;
    sb.appendChild(box);
  });

  // Update total score display
  let latestTotal = 0;
  for (let i = 9; i >= 0; i--) {
    if (frames[i].cumulative !== null) {
      latestTotal = frames[i].cumulative;
      break;
    }
  }
  document.getElementById('total-score-val').textContent = latestTotal;
}

// Standard 10-Pin Bowling Score Calculation
function recalculateScores() {
  // Flatten all rolls with frame tracking
  let flatRolls = [];
  frames.forEach((f) => {
    f.rolls.forEach(r => flatRolls.push(r));
  });

  let rollIndex = 0;
  let runningTotal = 0;

  for (let fIdx = 0; fIdx < 10; fIdx++) {
    const frame = frames[fIdx];
    if (frame.rolls.length === 0) {
      frame.cumulative = null;
      continue;
    }

    if (fIdx < 9) {
      // Frames 1 - 9
      const first = frame.rolls[0];
      if (first === 10) {
        // Strike: needs next 2 rolls in flatRolls
        if (rollIndex + 2 < flatRolls.length) {
          runningTotal += 10 + flatRolls[rollIndex + 1] + flatRolls[rollIndex + 2];
          frame.cumulative = runningTotal;
        } else {
          frame.cumulative = null;
        }
        rollIndex += 1;
      } else if (frame.rolls.length === 2) {
        const second = frame.rolls[1];
        if (first + second === 10) {
          // Spare: needs next 1 roll
          if (rollIndex + 2 < flatRolls.length) {
            runningTotal += 10 + flatRolls[rollIndex + 2];
            frame.cumulative = runningTotal;
          } else {
            frame.cumulative = null;
          }
        } else {
          // Open frame
          runningTotal += first + second;
          frame.cumulative = runningTotal;
        }
        rollIndex += 2;
      } else {
        frame.cumulative = null;
        rollIndex += frame.rolls.length;
      }
    } else {
      // 10th Frame
      const r = frame.rolls;
      const isStrikeOrSpare = (r[0] === 10) || (r.length >= 2 && r[0] + r[1] === 10);
      if ((isStrikeOrSpare && r.length === 3) || (!isStrikeOrSpare && r.length === 2)) {
        runningTotal += r.reduce((a, b) => a + b, 0);
        frame.cumulative = runningTotal;
      } else {
        frame.cumulative = null;
      }
    }
  }
}

// --- Physics Entities ---
let ball = {
  x: VW / 2,
  y: FOUL_LINE_Y + 35,
  vx: 0,
  vy: 0,
  radius: 17,
  spin: 0,        // lateral hook acceleration
  rotation: 0,    // visual roll angle
  inGutter: false,
  trail: []
};

let pins = [];
let particles = [];
let screenShake = 0;

function setupPins() {
  pins = [];
  let pinNumber = 1;
  const centerX = VW / 2;
  for (let row = 0; row < 4; row++) {
    const rowY = HEAD_PIN_Y - row * PIN_ROW_SPACING;
    const startX = centerX - (row * PIN_COL_SPACING) / 2;
    for (let col = 0; col <= row; col++) {
      pins.push({
        id: pinNumber++,
        homeX: startX + col * PIN_COL_SPACING,
        homeY: rowY,
        x: startX + col * PIN_COL_SPACING,
        y: rowY,
        vx: 0,
        vy: 0,
        radius: 11.5,
        knocked: false,
        angle: 0,
        vAngle: 0,
        alpha: 1
      });
    }
  }
}

function resetBallForNextThrow() {
  const sliderVal = parseFloat(document.getElementById('pos-slider').value) || 0;
  ball.x = (VW / 2) + sliderVal;
  ball.y = FOUL_LINE_Y + 35;
  ball.vx = 0;
  ball.vy = 0;
  ball.spin = 0;
  ball.inGutter = false;
  ball.trail = [];
  gameState = STATE.AIMING;
  document.getElementById('pos-control-row').style.opacity = '1';
  document.getElementById('pos-control-row').style.pointerEvents = 'auto';
}

// --- Slingshot Drag Input ---
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragCurrent = { x: 0, y: 0 };
const MAX_PULL_Y = 140;
const MAX_PULL_X = 110;

const canvas = document.getElementById('lane-canvas');
const ctx = canvas.getContext('2d');

function getVirtualCoords(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = VW / rect.width;
  const scaleY = VH / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY
  };
}

function onPointerDown(e) {
  if (gameState !== STATE.AIMING) return;
  sfx.init();
  const pt = e.touches ? e.touches[0] : e;
  const vPos = getVirtualCoords(pt.clientX, pt.clientY);

  // Allow grabbing anywhere in the lower half of the lane
  if (vPos.y > FOUL_LINE_Y - 80) {
    isDragging = true;
    dragStart = { x: vPos.x, y: vPos.y };
    dragCurrent = { x: vPos.x, y: vPos.y };
  }
}

function onPointerMove(e) {
  if (!isDragging) return;
  const pt = e.touches ? e.touches[0] : e;
  dragCurrent = getVirtualCoords(pt.clientX, pt.clientY);
}

function onPointerUp() {
  if (!isDragging) return;
  isDragging = false;

  const pullY = Math.min(MAX_PULL_Y, Math.max(0, dragCurrent.y - dragStart.y));
  const pullX = Math.max(-MAX_PULL_X, Math.min(MAX_PULL_X, dragCurrent.x - dragStart.x));

  if (pullY < 18) return; // Cancel weak tap

  const powerRatio = pullY / MAX_PULL_Y; // 0.13 to 1.0
  const baseSpeed = 9.5 + powerRatio * 10.5;

  // Slight launch angle + spin hook effect from horizontal offset
  // Pulling right -> curves left; pulling left -> curves right (authentic slingshot feel)
  // Or direct lateral curve: let's make pulling left/right curve toward the opposite side like a hook shot,
  // and clearly visualize the trajectory arc on the blueprint!
  const curveStrength = -pullX * 0.0024;
  const initialSideVel = -pullX * 0.032;

  ball.vy = -baseSpeed;
  ball.vx = initialSideVel;
  ball.spin = curveStrength;

  gameState = STATE.ROLLING;
  document.getElementById('pos-control-row').style.opacity = '0.3';
  document.getElementById('pos-control-row').style.pointerEvents = 'none';
  sfx.playLaunch(powerRatio);
}

canvas.addEventListener('mousedown', onPointerDown);
window.addEventListener('mousemove', onPointerMove);
window.addEventListener('mouseup', onPointerUp);

canvas.addEventListener('touchstart', (e) => { e.preventDefault(); onPointerDown(e); }, { passive: false });
window.addEventListener('touchmove', (e) => { if (isDragging) e.preventDefault(); onPointerMove(e); }, { passive: false });
window.addEventListener('touchend', onPointerUp);

// Position Slider Listener
document.getElementById('pos-slider').addEventListener('input', (e) => {
  if (gameState === STATE.AIMING) {
    ball.x = (VW / 2) + parseFloat(e.target.value);
  }
});

// Header Buttons
document.getElementById('sound-toggle').addEventListener('click', (e) => {
  sfx.init();
  sfx.enabled = !sfx.enabled;
  e.target.textContent = sfx.enabled ? '🔊 ON' : '🔇 OFF';
});

document.getElementById('reset-btn').addEventListener('click', () => {
  startNewGame();
});

document.getElementById('play-again-btn').addEventListener('click', () => {
  document.getElementById('result-modal').classList.remove('active');
  startNewGame();
});

// --- Banner Notification ---
let bannerTimer = null;
function showBanner(title, sub, color = '#00f0ff') {
  const overlay = document.getElementById('banner-overlay');
  const mainEl = document.getElementById('banner-main');
  const subEl = document.getElementById('banner-sub');

  mainEl.textContent = title;
  mainEl.style.borderColor = color;
  mainEl.style.textShadow = `0 0 15px ${color}, 0 0 30px ${color}`;
  subEl.textContent = sub;

  overlay.classList.add('show');
  if (bannerTimer) clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    overlay.classList.remove('show');
  }, 1650);
}

// --- Particle Burst ---
function spawnParticles(x, y, color, count = 18) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.5 + Math.random() * 5.5;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 2 + Math.random() * 3.5,
      color,
      alpha: 1,
      decay: 0.02 + Math.random() * 0.025
    });
  }
}

// --- Physics Step ---
let settleTimer = 0;
let StandingBeforeRoll = 10;

function updatePhysics() {
  // Update Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) particles.splice(i, 1);
  }

  if (screenShake > 0) screenShake *= 0.85;

  if (gameState !== STATE.ROLLING && gameState !== STATE.SETTLING) return;

  // Ball movement
  if (gameState === STATE.ROLLING) {
    ball.trail.push({ x: ball.x, y: ball.y, inGutter: ball.inGutter });
    if (ball.trail.length > 26) ball.trail.shift();

    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.rotation += Math.hypot(ball.vx, ball.vy) * 0.05;

    // Apply spin curve only while on lane hardwood (Dry backend hooks harder!)
    if (!ball.inGutter && ball.y < FOUL_LINE_Y) {
      const laneProgress = Math.max(0, (FOUL_LINE_Y - ball.y) / (FOUL_LINE_Y - PIN_DECK_TOP));
      const backendMultiplier = 0.65 + laneProgress * 0.85;
      ball.vx += ball.spin * backendMultiplier;
      ball.vy *= 0.9965; // Slight lane friction
    }

    // Check Gutter Drop
    if (!ball.inGutter && ball.y < FOUL_LINE_Y - 10 && ball.y > PIN_DECK_TOP) {
      if (ball.x - ball.radius * 0.65 < LANE_LEFT) {
        ball.inGutter = true;
        ball.x = LANE_LEFT - GUTTER_WIDTH / 2;
        ball.vx = 0;
        ball.spin = 0;
        sfx.playFanfare('GUTTER');
      } else if (ball.x + ball.radius * 0.65 > LANE_RIGHT) {
        ball.inGutter = true;
        ball.x = LANE_RIGHT + GUTTER_WIDTH / 2;
        ball.vx = 0;
        ball.spin = 0;
        sfx.playFanfare('GUTTER');
      }
    }

    // Keep ball guided inside gutter channel
    if (ball.inGutter) {
      ball.vx = 0;
      ball.x = ball.x < VW / 2 ? LANE_LEFT - GUTTER_WIDTH / 2 : LANE_RIGHT + GUTTER_WIDTH / 2;
    }

    // Ball-to-Pin Collisions (Only if not in gutter)
    if (!ball.inGutter) {
      pins.forEach(pin => {
        const dx = pin.x - ball.x;
        const dy = pin.y - ball.y;
        const dist = Math.hypot(dx, dy);
        const minDist = ball.radius + pin.radius;

        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;

          pin.x += nx * overlap * 0.85;
          pin.y += ny * overlap * 0.85;
          ball.x -= nx * overlap * 0.15;

          const impactSpeed = Math.hypot(ball.vx, ball.vy);
          pin.vx = nx * impactSpeed * 0.92 + (Math.random() - 0.5) * 1.8;
          pin.vy = ny * impactSpeed * 0.92 - 1.2;
          pin.vAngle = (Math.random() - 0.5) * 0.35;

          // Slightly deflect and slow ball
          ball.vx -= nx * impactSpeed * 0.09;
          ball.vy *= 0.94;

          if (!pin.knocked) {
            pin.knocked = true;
            screenShake = Math.min(9, screenShake + 2.5);
            spawnParticles(pin.x, pin.y, '#00f0ff', 10);
            sfx.playPinHit(impactSpeed / 14);
          }
        }
      });
    }

    // Transition to SETTLING once ball passes behind pin deck
    if (ball.y < PIN_DECK_TOP - 45) {
      gameState = STATE.SETTLING;
      settleTimer = 52; // frames to let flying pins finish colliding
    }
  }

  // Pin-to-Pin Collisions & Motion
  for (let i = 0; i < pins.length; i++) {
    const p1 = pins[i];
    if (Math.hypot(p1.vx, p1.vy) > 0.05) {
      p1.x += p1.vx;
      p1.y += p1.vy;
      p1.vx *= 0.95;
      p1.vy *= 0.95;
      p1.angle += p1.vAngle;
      p1.vAngle *= 0.95;

      // Check displacement from home spot
      if (!p1.knocked && Math.hypot(p1.x - p1.homeX, p1.y - p1.homeY) > 8) {
        p1.knocked = true;
        spawnParticles(p1.x, p1.y, '#ffaa00', 8);
      }
    }

    // Pin vs Pin Domino Collisions
    for (let j = i + 1; j < pins.length; j++) {
      const p2 = pins[j];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      const minDist = p1.radius + p2.radius;

      if (dist < minDist && dist > 0.001) {
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        p1.x -= nx * overlap * 0.5;
        p1.y -= ny * overlap * 0.5;
        p2.x += nx * overlap * 0.5;
        p2.y += ny * overlap * 0.5;

        const rvx = p1.vx - p2.vx;
        const rvy = p1.vy - p2.vy;
        const velAlongNormal = rvx * nx + rvy * ny;

        if (velAlongNormal > 0) {
          const impulse = velAlongNormal * 0.88;
          p1.vx -= nx * impulse * 0.6;
          p1.vy -= ny * impulse * 0.6;
          p2.vx += nx * impulse * 0.95 + (Math.random() - 0.5) * 0.9;
          p2.vy += ny * impulse * 0.95;

          if (!p2.knocked && Math.hypot(p2.vx, p2.vy) > 0.9) {
            p2.knocked = true;
            p2.vAngle = (Math.random() - 0.5) * 0.3;
            spawnParticles(p2.x, p2.y, '#ffaa00', 8);
            sfx.playPinHit(0.6);
          }
          if (!p1.knocked && Math.hypot(p1.vx, p1.vy) > 0.9) {
            p1.knocked = true;
          }
        }
      }
    }
  }

  // Handle Settling Countdown
  if (gameState === STATE.SETTLING) {
    settleTimer--;
    if (settleTimer <= 0) {
      evaluateRollOutcome();
    }
  }
}

// --- Scoring & Frame Progression Logic ---
function evaluateRollOutcome() {
  const standingNow = pins.filter(p => !p.knocked).length;
  const knockedThisRoll = StandingBeforeRoll - standingNow;

  if (ball.inGutter && knockedThisRoll === 0) {
    stats.gutters++;
  }

  const frame = frames[currentFrameIdx];
  frame.rolls.push(knockedThisRoll);

  const isTenth = currentFrameIdx === 9;
  const rollNum = frame.rolls.length; // 1, 2, or 3

  if (!isTenth) {
    // Frames 1 - 9
    if (rollNum === 1) {
      if (knockedThisRoll === 10) {
        // STRIKE!
        frame.symbols.push('X');
        stats.strikes++;
        stats.curStreak++;
        stats.maxStreak = Math.max(stats.maxStreak, stats.curStreak);
        celebrateStrike();
        advanceFrame();
      } else {
        stats.curStreak = 0;
        frame.symbols.push(knockedThisRoll === 0 ? '-' : String(knockedThisRoll));
        if (ball.inGutter) {
          showBanner('GUTTER', '0 PINS', '#ff2a85');
        } else {
          showBanner(`${knockedThisRoll} PINS`, 'SECOND BALL READY', '#38bdf8');
        }
        prepareSecondBall(standingNow);
      }
    } else if (rollNum === 2) {
      if (frame.rolls[0] + knockedThisRoll === 10) {
        // SPARE!
        frame.symbols.push('/');
        stats.spares++;
        celebrateSpare();
      } else {
        frame.symbols.push(knockedThisRoll === 0 ? '-' : String(knockedThisRoll));
        const totalFrame = frame.rolls[0] + knockedThisRoll;
        showBanner(`${totalFrame} PTS`, 'OPEN FRAME', '#94a3b8');
      }
      advanceFrame();
    }
  } else {
    // 10th Frame Special Rules
    if (rollNum === 1) {
      if (knockedThisRoll === 10) {
        frame.symbols.push('X');
        stats.strikes++;
        stats.curStreak++;
        stats.maxStreak = Math.max(stats.maxStreak, stats.curStreak);
        celebrateStrike();
        // Reset full rack for 2nd roll in 10th frame
        StandingBeforeRoll = 10;
        setupPins();
        resetBallForNextThrow();
      } else {
        stats.curStreak = 0;
        frame.symbols.push(knockedThisRoll === 0 ? '-' : String(knockedThisRoll));
        prepareSecondBall(standingNow);
      }
    } else if (rollNum === 2) {
      const firstWasStrike = frame.rolls[0] === 10;
      if (firstWasStrike) {
        if (knockedThisRoll === 10) {
          frame.symbols.push('X');
          stats.strikes++;
          stats.curStreak++;
          stats.maxStreak = Math.max(stats.maxStreak, stats.curStreak);
          celebrateStrike();
          StandingBeforeRoll = 10;
          setupPins();
          resetBallForNextThrow();
        } else {
          stats.curStreak = 0;
          frame.symbols.push(knockedThisRoll === 0 ? '-' : String(knockedThisRoll));
          prepareSecondBall(standingNow);
        }
      } else {
        // First roll was not a strike
        if (frame.rolls[0] + knockedThisRoll === 10) {
          frame.symbols.push('/');
          stats.spares++;
          celebrateSpare();
          // Bonus 3rd roll on fresh rack!
          StandingBeforeRoll = 10;
          setupPins();
          resetBallForNextThrow();
        } else {
          frame.symbols.push(knockedThisRoll === 0 ? '-' : String(knockedThisRoll));
          finishGame();
        }
      }
    } else if (rollNum === 3) {
      if (knockedThisRoll === 10) {
        frame.symbols.push('X');
        stats.strikes++;
        stats.curStreak++;
        stats.maxStreak = Math.max(stats.maxStreak, stats.curStreak);
        celebrateStrike();
      } else if (frame.rolls[1] !== 10 && frame.rolls[0] === 10 && (frame.rolls[1] + knockedThisRoll === 10)) {
        frame.symbols.push('/');
        stats.spares++;
        celebrateSpare();
      } else {
        frame.symbols.push(knockedThisRoll === 0 ? '-' : String(knockedThisRoll));
      }
      finishGame();
    }
  }

  recalculateScores();
  renderScoreboardDOM();
}

function celebrateStrike() {
  const streakLabel = stats.curStreak >= 3 ? `${stats.curStreak}x TURKEY STREAK!!` :
                      stats.curStreak === 2 ? 'DOUBLE STRIKE!' : 'PERFECT POCKET HIT!';
  showBanner('STRIKE!!', streakLabel, '#ffaa00');
  sfx.playFanfare('STRIKE');
  spawnParticles(VW / 2, HEAD_PIN_Y - 30, '#ffaa00', 35);
  spawnParticles(VW / 2, HEAD_PIN_Y - 30, '#00f0ff', 25);
}

function celebrateSpare() {
  showBanner('SPARE!', 'NICE COVER SHOT', '#00f0ff');
  sfx.playFanfare('SPARE');
  spawnParticles(VW / 2, HEAD_PIN_Y - 30, '#00f0ff', 28);
}

function prepareSecondBall(standingCount) {
  // Remove knocked pins and tidy standing pins back to exact home coordinates
  pins = pins.filter(p => !p.knocked);
  pins.forEach(p => {
    p.x = p.homeX;
    p.y = p.homeY;
    p.vx = 0;
    p.vy = 0;
    p.angle = 0;
    p.vAngle = 0;
  });
  StandingBeforeRoll = standingCount;
  resetBallForNextThrow();
}

function advanceFrame() {
  if (currentFrameIdx < 9) {
    currentFrameIdx++;
    StandingBeforeRoll = 10;
    setupPins();
    resetBallForNextThrow();
  } else {
    finishGame();
  }
}

function finishGame() {
  gameState = STATE.GAMEOVER;
  recalculateScores();
  renderScoreboardDOM();

  const finalScore = frames[9].cumulative || 0;
  let rank = 'C (BEGINNER)';
  if (finalScore === 300) rank = 'SSS (PERFECT MASTER)';
  else if (finalScore >= 240) rank = 'SS (PRO BOWLER)';
  else if (finalScore >= 200) rank = 'S (EXPERT)';
  else if (finalScore >= 160) rank = 'A (ADVANCED)';
  else if (finalScore >= 120) rank = 'B (REGULAR)';

  setTimeout(() => {
    document.getElementById('modal-score').textContent = finalScore;
    document.getElementById('modal-rank').textContent = `RANK: ${rank}`;
    document.getElementById('stat-strikes').textContent = stats.strikes;
    document.getElementById('stat-spares').textContent = stats.spares;
    document.getElementById('stat-gutters').textContent = stats.gutters;
    document.getElementById('stat-streak').textContent = stats.maxStreak;
    document.getElementById('result-modal').classList.add('active');
  }, 900);
}

function startNewGame() {
  initScoreboardData();
  StandingBeforeRoll = 10;
  setupPins();
  document.getElementById('pos-slider').value = 0;
  resetBallForNextThrow();
}

// --- Blueprint Canvas Rendering ---
function resizeCanvas() {
  const stage = document.getElementById('game-stage');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = stage.clientWidth * dpr;
  canvas.height = stage.clientHeight * dpr;
}
window.addEventListener('resize', resizeCanvas);

function drawScene() {
  const dpr = window.devicePixelRatio || 1;
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Fit virtual 420x740 cleanly inside canvas while filling background grid
  const scaleX = canvas.width / VW;
  const scaleY = canvas.height / VH;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (canvas.width - VW * scale) / 2;
  const offsetY = (canvas.height - VH * scale) / 2;

  // Screen shake on pin impact
  const shakeX = (Math.random() - 0.5) * screenShake * dpr;
  const shakeY = (Math.random() - 0.5) * screenShake * dpr;

  ctx.translate(offsetX + shakeX, offsetY + shakeY);
  ctx.scale(scale, scale);

  // 1. Draw Graph Paper (方眼紙) Background Grid
  drawBlueprintGrid();

  // 2. Draw Bowling Lane & Gutters
  drawLaneArchitecture();

  // 3. Draw Aiming Trajectory & Slingshot Vector (when aiming)
  if (gameState === STATE.AIMING) {
    drawAimingGuide();
  }

  // 4. Draw Ball Motion Trail
  drawBallTrail();

  // 5. Draw Bowling Pins
  drawPins();

  // 6. Draw Bowling Ball
  drawBall();

  // 7. Draw Particles
  drawParticles();

  ctx.restore();
}

function drawBlueprintGrid() {
  const minorStep = 15;
  const majorStep = 75;

  // Minor grid lines
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= VW; x += minorStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, VH);
  }
  for (let y = 0; y <= VH; y += minorStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(VW, y);
  }
  ctx.stroke();

  // Major grid lines
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let x = 0; x <= VW; x += majorStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, VH);
  }
  for (let y = 0; y <= VH; y += majorStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(VW, y);
  }
  ctx.stroke();

  // Blueprint Coordinate Rulers along left margin
  ctx.fillStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.font = '9px monospace';
  for (let y = 75; y < VH; y += 75) {
    ctx.fillText(`Y:${y}`, 8, y - 3);
  }
}

function drawLaneArchitecture() {
  // Left & Right Gutters
  ctx.fillStyle = 'rgba(4, 9, 18, 0.78)';
  ctx.fillRect(LANE_LEFT - GUTTER_WIDTH, PIN_DECK_TOP, GUTTER_WIDTH, FOUL_LINE_Y - PIN_DECK_TOP);
  ctx.fillRect(LANE_RIGHT, PIN_DECK_TOP, GUTTER_WIDTH, FOUL_LINE_Y - PIN_DECK_TOP);

  // Gutter hatching lines
  ctx.strokeStyle = 'rgba(255, 42, 133, 0.22)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(LANE_LEFT - GUTTER_WIDTH, PIN_DECK_TOP, GUTTER_WIDTH, FOUL_LINE_Y - PIN_DECK_TOP);
  ctx.strokeRect(LANE_RIGHT, PIN_DECK_TOP, GUTTER_WIDTH, FOUL_LINE_Y - PIN_DECK_TOP);
  ctx.setLineDash([]);

  // Main Lane Surface Tint
  const laneGrad = ctx.createLinearGradient(0, PIN_DECK_TOP, 0, FOUL_LINE_Y);
  laneGrad.addColorStop(0, 'rgba(0, 240, 255, 0.09)');
  laneGrad.addColorStop(0.7, 'rgba(0, 240, 255, 0.04)');
  laneGrad.addColorStop(1, 'rgba(0, 240, 255, 0.10)');
  ctx.fillStyle = laneGrad;
  ctx.fillRect(LANE_LEFT, PIN_DECK_TOP, LANE_WIDTH, FOUL_LINE_Y - PIN_DECK_TOP);

  // Lane Outer Glowing Rails
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(LANE_LEFT, PIN_DECK_TOP);
  ctx.lineTo(LANE_LEFT, VH - 40);
  ctx.moveTo(LANE_RIGHT, PIN_DECK_TOP);
  ctx.lineTo(LANE_RIGHT, VH - 40);
  ctx.stroke();

  // Pin Deck Pit Top Border
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(LANE_LEFT, PIN_DECK_TOP, LANE_WIDTH, 150);

  // Target Arrows (スパット) on Lane
  const arrowCenterY = 390;
  const arrowSpacing = 28;
  ctx.fillStyle = 'rgba(0, 240, 255, 0.45)';
  for (let i = -2; i <= 2; i++) {
    const ax = (VW / 2) + i * arrowSpacing;
    const ay = arrowCenterY + Math.abs(i) * 14;
    ctx.beginPath();
    ctx.moveTo(ax, ay - 8);
    ctx.lineTo(ax - 4, ay + 5);
    ctx.lineTo(ax + 4, ay + 5);
    ctx.closePath();
    ctx.fill();
  }

  // Approach Dots
  ctx.fillStyle = 'rgba(0, 240, 255, 0.35)';
  for (let i = -3; i <= 3; i++) {
    const dx = (VW / 2) + i * 28;
    ctx.beginPath();
    ctx.arc(dx, FOUL_LINE_Y + 14, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Foul Line
  ctx.strokeStyle = '#ff2a85';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(LANE_LEFT - GUTTER_WIDTH, FOUL_LINE_Y);
  ctx.lineTo(LANE_RIGHT + GUTTER_WIDTH, FOUL_LINE_Y);
  ctx.stroke();

  ctx.fillStyle = '#ff2a85';
  ctx.font = 'bold 9px monospace';
  ctx.fillText('FOUL LINE', LANE_RIGHT - 56, FOUL_LINE_Y - 5);
}

function drawAimingGuide() {
  // Subtle pulse circle around ball to invite drag
  if (!isDragging) {
    const pulse = 4 + Math.sin(Date.now() * 0.006) * 3;
    ctx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Hint text
    ctx.fillStyle = 'rgba(226, 241, 255, 0.75)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('▼ 下に引っ張って投球 (左右でカーブ)', ball.x, ball.y + 42);
    ctx.textAlign = 'left';
    return;
  }

  const pullY = Math.min(MAX_PULL_Y, Math.max(0, dragCurrent.y - dragStart.y));
  const pullX = Math.max(-MAX_PULL_X, Math.min(MAX_PULL_X, dragCurrent.x - dragStart.x));

  if (pullY < 10) return;

  const powerRatio = pullY / MAX_PULL_Y;
  const baseSpeed = 9.5 + powerRatio * 10.5;
  const curveStrength = -pullX * 0.0024;
  const initialSideVel = -pullX * 0.032;

  // Simulate trajectory curve preview on the blueprint grid
  let simX = ball.x;
  let simY = ball.y;
  let simVx = initialSideVel;
  let simVy = -baseSpeed;

  ctx.strokeStyle = '#ffaa00';
  ctx.lineWidth = 2.2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(simX, simY);

  for (let step = 0; step < 34; step++) {
    simX += simVx;
    simY += simVy;
    if (simY < FOUL_LINE_Y) {
      const laneProgress = Math.max(0, (FOUL_LINE_Y - simY) / (FOUL_LINE_Y - PIN_DECK_TOP));
      const backendMultiplier = 0.65 + laneProgress * 0.85;
      simVx += curveStrength * backendMultiplier;
      simVy *= 0.9965;
    }
    ctx.lineTo(simX, simY);
    if (simY < HEAD_PIN_Y - 20) break;
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw Slingshot Tension Band behind ball
  const handleX = ball.x + pullX * 0.75;
  const handleY = ball.y + pullY * 0.75;

  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ball.x - 10, ball.y);
  ctx.lineTo(handleX, handleY);
  ctx.lineTo(ball.x + 10, ball.y);
  ctx.stroke();

  ctx.fillStyle = '#ffaa00';
  ctx.beginPath();
  ctx.arc(handleX, handleY, 7, 0, Math.PI * 2);
  ctx.fill();

  // Telemetry HUD readout near ball
  const pwrPct = Math.round(powerRatio * 100);
  const spinDeg = Math.round(-pullX / 2.2);
  const spinDir = spinDeg > 2 ? `R+${spinDeg}°` : spinDeg < -2 ? `L${spinDeg}°` : 'STRAIGHT';

  ctx.fillStyle = 'rgba(7, 16, 30, 0.88)';
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 1;
  ctx.fillRect(ball.x - 62, ball.y - 54, 124, 24);
  ctx.strokeRect(ball.x - 62, ball.y - 54, 124, 24);

  ctx.fillStyle = '#00f0ff';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`PWR:${pwrPct}% | ${spinDir}`, ball.x, ball.y - 38);
  ctx.textAlign = 'left';
}

function drawBallTrail() {
  for (let i = 0; i < ball.trail.length; i++) {
    const t = ball.trail[i];
    const ratio = (i + 1) / ball.trail.length;
    ctx.fillStyle = t.inGutter
      ? `rgba(255, 42, 133, ${ratio * 0.35})`
      : `rgba(0, 240, 255, ${ratio * 0.38})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, ball.radius * ratio * 0.75, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPins() {
  // First draw pin spot markers on the deck
  pins.forEach(pin => {
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(pin.homeX, pin.homeY, 4, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Draw actual pins
  pins.forEach(pin => {
    ctx.save();
    ctx.translate(pin.x, pin.y);
    ctx.rotate(pin.angle);

    if (pin.knocked) {
      // Knocked down pin appearance (tilted blueprint silhouette)
      ctx.fillStyle = 'rgba(255, 42, 133, 0.25)';
      ctx.strokeStyle = '#ff2a85';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, pin.radius * 1.25, pin.radius * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Standing Pin CAD Top-Down Contour
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#00f0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, pin.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Inner Red Crown Ring
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, pin.radius * 0.62, 0, Math.PI * 2);
      ctx.stroke();

      // Pin ID Number
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pin.id, 0, 0.5);
    }
    ctx.restore();
  });
}

function drawBall() {
  if (ball.y < PIN_DECK_TOP - 40) return;

  ctx.save();
  ctx.translate(ball.x, ball.y);

  // Outer blueprint glow
  const grad = ctx.createRadialGradient(-4, -4, 3, 0, 0, ball.radius);
  grad.addColorStop(0, '#67e8f9');
  grad.addColorStop(0.55, '#0284c7');
  grad.addColorStop(1, '#0f172a');

  ctx.fillStyle = grad;
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Finger holes rotating to visualize spin & roll
  ctx.rotate(ball.rotation);
  ctx.fillStyle = '#050b14';
  const holeOffset = 5 + Math.sin(ball.rotation * 2) * 2;
  ctx.beginPath();
  ctx.arc(-4, -holeOffset, 2.3, 0, Math.PI * 2);
  ctx.arc(4, -holeOffset, 2.3, 0, Math.PI * 2);
  ctx.arc(0, -holeOffset + 6, 2.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.restore();
  });
}

// --- Main Loop ---
function loop() {
  updatePhysics();
  drawScene();
  requestAnimationFrame(loop);
}

// Initialize & Start
resizeCanvas();
startNewGame();
requestAnimationFrame(loop);

