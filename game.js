const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const mCanvas = document.getElementById('minimap');
const mCtx = mCanvas.getContext('2d');

const ZOOM = 0.8;
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    mCanvas.width = 150; mCanvas.height = 150;
}
window.addEventListener('resize', resize);
resize();

const WORLD_RADIUS = 2000;
const FRICTION = 0.92;

let player = {
    worldX: 0, worldY: 0, velX: 0, velY: 0,
    radius: 20, bladeRadius: 75, baseBladeRadius: 75,
    maxBladeRadius: 180, minBladeRadius: 40,
    angle: 0, accel: 0.7, health: 100, maxHealth: 100,
    isShifting: false, isSpacing: false, slipTimer: 0, slipDir: 0,
    webSlowTimer: 0
};

let mouse = { x: 0, y: 0 };
let camera = { x: 0, y: 0, shake: 0 };
let enemies = [];
let bullets = [];
let puddles = [];
let particles = [];
let webs = [];   // mecha-spider webs: { x, y, r }
let wave = 1;
let score = 0;
let timeLeft = 0;
let totalWaveTime = 0;
let gameOver = false;
let timerInterval;

window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('keydown', e => {
    if(e.key === "Shift") player.isShifting = true;
    if(e.code === "Space") player.isSpacing = true;
});
window.addEventListener('keyup', e => {
    if(e.key === "Shift") player.isShifting = false;
    if(e.code === "Space") player.isSpacing = false;
});

function announce(text, color = "#fff") {
    const el = document.getElementById('announcement');
    el.innerText = text;
    el.style.textShadow = `0 0 10px ${color}, 0 0 20px ${color}`;
    el.classList.remove('hidden-ui');
    setTimeout(() => el.classList.add('hidden-ui'), 2000);
}

function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y, vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
            r: Math.random() * 4 + 1, color, life: 1.0, decay: Math.random() * 0.05 + 0.02
        });
    }
}

function getSafeCircularSpawn() {
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * (WORLD_RADIUS - 350);
    return { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist };
}

function createEnemy(x, y, type) {
    let e = { x, y, type, angle: 0, lastShot: Date.now(), lastHit: Date.now(), seed: Math.random() * 100, isBoss: false, sharkState: 'orbit', stateTimer: 0 };
    // Speeds increased by 20%
    if(type === 'wasp') { e.hp = 50; e.maxHp = 50; e.speed = 4.2; e.r = 35; e.color = '#f1c40f'; }
    if(type === 'crab') { e.hp = 180; e.maxHp = 180; e.speed = 2.2; e.r = 75; e.color = '#e67e22'; }
    if(type === 'tank') { e.hp = 130; e.maxHp = 130; e.speed = 1.2; e.r = 60; e.color = '#7f8c8d'; }
    if(type === 'assembler') { e.hp = 700; e.maxHp = 700; e.speed = 0; e.r = 100; e.color = '#34495e'; e.lastSpawn = Date.now(); e.armAngle = 0; }
    if(type === 'mecha-saw') { e.hp = 100; e.maxHp = 100; e.speed = 3.1; e.r = 18; e.color = '#c0392b'; e.bladeAngle = 0; }
    if(type === 'mecha-shark') { e.hp = 220; e.maxHp = 220; e.speed = 5.4; e.r = 50; e.color = '#3498db'; e.swimAngle = 0; }

    // --- MECHA-SPIDER ---
    if(type === 'mecha-spider') {
        e.hp = 140; e.maxHp = 140;
        e.speed = 4.6;          // slightly slower than wasp but still fast
        e.r = 45;               // medium-large radius
        e.color = '#8e44ad';    // deep purple

        e.spiderAngle = 0;                  // smooth facing angle
        e.spinRate = 0.06;                  // base rotation speed
        e.attackState = 'chase';            // 'chase' | 'circle' | 'windup'
        e.lastAttack = Date.now();          // cooldown tracker
        e.attackCooldown = 10000;           // 10 seconds between attacks
        e.windupTimer = 0;                  // frames of wind-up before firing
        e.windupDuration = 60;             // 60 frames (~1 second) of spin charge
        e.corePulse = 0;                   // glow pulse phase

        // circling attack approach
        e.circleTimer = 0;                  // frames spent circling
        e.circleDuration = 90;             // ~1.5 seconds of circling
        e.circleOrbitAngle = 0;            // current angle around pivot
        e.circlePivotX = 0;               // pivot point set when circling starts
        e.circlePivotY = 0;

        // animated legs
        e.legPhase = 0;                    // increments each frame while moving
    }

    if(type === 'mini-boss') { e.hp = 200; e.maxHp = 200; e.speed = 1.8; e.r = 100; e.color = '#e74c3c'; e.isBoss = true; }
    if(type === 'mega-boss') { e.hp = 1200; e.maxHp = 1200; e.speed = 1.2; e.r = 180; e.color = '#8e44ad'; e.isBoss = true; }
    return e;
}

function spawnWave() {
    enemies = enemies.filter(e => e.isBoss);
    bullets = []; puddles = [];
    webs = [];   // clear webs on new wave
    totalWaveTime = wave === 1 ? 8 : 15 + (wave * 2);
    timeLeft = totalWaveTime;
    announce("WAVE " + wave);
    startTimer();
   
    for(let i=0; i<8+wave; i++) {
        let p = getSafeCircularSpawn();
        puddles.push({x: p.x, y: p.y, r: 50 + Math.random()*70});
    }

    if (wave % 10 === 0) {
        announce("MEGA BOSS!", "#8e44ad");
        let p = getSafeCircularSpawn(); enemies.push(createEnemy(p.x, p.y, 'mega-boss'));
    } else if (wave % 4 === 0) {
        announce("MINI BOSS!", "#e74c3c");
        let p = getSafeCircularSpawn(); enemies.push(createEnemy(p.x, p.y, 'mini-boss'));
    }

    const assemblerCount = Math.ceil(wave / 2);
    for(let i=0; i<assemblerCount; i++) {
        let p = getSafeCircularSpawn(); enemies.push(createEnemy(p.x, p.y, 'assembler'));
    }

    const initialMobs = 6 + wave;
    for (let i = 0; i < initialMobs; i++) {
        let p = getSafeCircularSpawn();
        const types = ['wasp', 'crab', 'mecha-saw', 'mecha-shark', 'mecha-spider'];
        enemies.push(createEnemy(p.x, p.y, types[Math.floor(Math.random()*types.length)]));
    }
}

function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!gameOver) {
            timeLeft--;
            if (timeLeft <= 0) { wave++; spawnWave(); }
        }
    }, 1000);
}

function fireSpiderWebs(e) {
    // Fire 3 webs spaced 120 degrees apart, each placed at spider body edge + a bit
    const webRadius = e.r + 45;   // slightly larger than spider body
    for (let i = 0; i < 3; i++) {
        const ang = e.spiderAngle + (i * Math.PI * 2 / 3);
        const dist = e.r * 7.5;   // place web a short distance from spider
        webs.push({
            x: e.x + Math.cos(ang) * dist,
            y: e.y + Math.sin(ang) * dist,
            r: webRadius,
            pulse: 0
        });
    }
    camera.shake = 5;
    spawnParticles(e.x, e.y, '#a29bfe', 12);
}

function update() {
    if (gameOver) return;

    // Oil Puddle Check (Actual working collision)
    puddles.forEach(p => {
        const d = Math.sqrt((player.worldX-p.x)**2 + (player.worldY-p.y)**2);
        if (d < p.r && player.slipTimer <= 0) {
            player.slipTimer = 40;
            player.slipDir = Math.random() * Math.PI * 2;
        }
    });

    // Web slow/damage check
    let inWeb = false;
    webs.forEach(w => {
        const d = Math.sqrt((player.worldX - w.x)**2 + (player.worldY - w.y)**2);
        if (d < w.r + player.radius) {
            inWeb = true;
            player.health -= 0.05;     // small continuous damage
            camera.shake = Math.max(camera.shake, 2);   // slight shake while inside
        }
        w.pulse += 0.05;   // advance pulse phase for visual
    });
    player.webSlowTimer = inWeb ? 10 : Math.max(0, player.webSlowTimer - 1);

    if (player.isSpacing) { player.bladeRadius = Math.min(player.maxBladeRadius, player.bladeRadius + 4); }
    else if (player.isShifting) {
        player.bladeRadius = Math.max(player.minBladeRadius, player.bladeRadius - 4);
        if(player.health < player.maxHealth) player.health += 0.09;
    } else {
        if (player.bladeRadius > player.baseBladeRadius) player.bladeRadius -= 2;
        if (player.bladeRadius < player.baseBladeRadius) player.bladeRadius += 2;
    }

    // Movement (web slow applied here)
    const webSlowFactor = player.webSlowTimer > 0 ? 0.3 : 1.0;

    if (player.slipTimer > 0) {
        player.worldX += Math.cos(player.slipDir) * 6 * webSlowFactor;
        player.worldY += Math.sin(player.slipDir) * 6 * webSlowFactor;
        player.slipTimer--;
    } else {
        const tx = (mouse.x - canvas.width/2) / ZOOM; const ty = (mouse.y - canvas.height/2) / ZOOM;
        if (Math.sqrt(tx**2 + ty**2) > 25) {
            const ang = Math.atan2(ty, tx);
            player.velX += Math.cos(ang) * player.accel * webSlowFactor;
            player.velY += Math.sin(ang) * player.accel * webSlowFactor;
        }
    }
   
    player.velX *= FRICTION; player.velY *= FRICTION;
    player.worldX += player.velX; player.worldY += player.velY;

    const dC = Math.sqrt(player.worldX**2 + player.worldY**2);
    if (dC > WORLD_RADIUS - player.radius) {
        const a = Math.atan2(player.worldY, player.worldX);
        player.worldX = Math.cos(a) * (WORLD_RADIUS - player.radius);
        player.worldY = Math.sin(a) * (WORLD_RADIUS - player.radius);
        player.velX = -Math.cos(a) * 5; player.velY = -Math.sin(a) * 5; camera.shake = 8;
    }

    camera.x = player.worldX - (canvas.width / 2) / ZOOM;
    camera.y = player.worldY - (canvas.height / 2) / ZOOM;
    if (camera.shake > 0) camera.shake *= 0.9;
    player.angle += 0.25;

    for (let i = 0; i < enemies.length; i++) {
        let e = enemies[i];
        const dx = player.worldX - e.x; const dy = player.worldY - e.y;
        const d = Math.sqrt(dx*dx + dy*dy);
        let moveAngle = Math.atan2(dy, dx);
       
        if(e.type === 'mecha-shark') {
            if(e.sharkState === 'orbit') {
                e.swimAngle += 0.05; moveAngle += 1.4;
                e.x += Math.cos(moveAngle) * (e.speed * 0.7); e.y += Math.sin(moveAngle) * (e.speed * 0.7);
                if(d < 450 && Math.random() < 0.015) { e.sharkState = 'dive'; e.stateTimer = Date.now(); }
            } else {
                e.x += Math.cos(moveAngle) * (e.speed * 2.5); e.y += Math.sin(moveAngle) * (e.speed * 2.5);
                if(d < 40 || Date.now() - e.stateTimer > 1500) e.sharkState = 'orbit';
            }
        } else if(e.type === 'assembler') {
            e.armAngle += 0.05;
            if(Date.now() - e.lastSpawn > 4500) {
                enemies.push(createEnemy(e.x + Math.cos(e.armAngle)*80, e.y + Math.sin(e.armAngle)*80, 'tank'));
                e.lastSpawn = Date.now();
            }
        } else if(e.type === 'mecha-spider') {
            // --- MECHA-SPIDER AI ---
            e.corePulse += 0.07;

            if(e.attackState === 'chase') {
                // Smoothly rotate toward player
                const targetAngle = Math.atan2(dy, dx);
                const angleDiff = targetAngle - e.spiderAngle;
                // Normalize angle diff to [-PI, PI]
                const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
                e.spiderAngle += normalizedDiff * 0.08;

                // Chase player
                e.x += Math.cos(e.spiderAngle) * e.speed;
                e.y += Math.sin(e.spiderAngle) * e.speed;

                // Trigger attack when cooldown expires
                if(Date.now() - e.lastAttack > e.attackCooldown) {
                    e.attackState = 'windup';
                    e.windupTimer = 0;
                }

            } else if(e.attackState === 'windup') {
                // Stop moving, spin fast
                e.windupTimer++;
                e.spiderAngle += 0.25;   // fast spin during charge-up

                if(e.windupTimer >= e.windupDuration) {
                    // Fire webs and return to chase
                    fireSpiderWebs(e);
                    e.attackState = 'chase';
                    e.lastAttack = Date.now();
                }
            }

            e.angle = e.spiderAngle;

        } else {
            e.x += Math.cos(moveAngle) * e.speed; e.y += Math.sin(moveAngle) * e.speed;
        }

        if(e.type !== 'mecha-spider') e.angle = moveAngle;

        // TANK SHOOTING (YELLOW MARKED BOLTS)
        if((e.type === 'tank' || e.isBoss) && Date.now() - e.lastShot > 2200 && d < 800) {
            bullets.push({ x: e.x, y: e.y, vx: (dx/d)*8, vy: (dy/d)*8, bounces: 1 });
            e.lastShot = Date.now();
        }

        if (d < player.bladeRadius + e.r) {
            e.hp -= (e.isBoss ? 0.4 : 5);
            if (Math.random() < 0.3) spawnParticles(e.x, e.y, e.color || '#fff', 3);
            if(e.hp <= 0) {
                camera.shake = e.isBoss ? 40 : 10;
                spawnParticles(e.x, e.y, e.color || '#fff', 20);
                score += e.isBoss ? 1000 : 100; enemies.splice(i, 1); i--;
            }
        }
        if (d < player.radius + e.r) { player.health -= (e.isBoss ? 0.3 : 0.4); camera.shake = 5; }
    }

    bullets.forEach((b, i) => {
        b.x += b.vx; b.y += b.vy;
        const distFromCenter = Math.sqrt(b.x**2 + b.y**2);
       
        // WALL BOUNCING FOR BULLETS
        if(distFromCenter > WORLD_RADIUS) {
            if(b.bounces > 0) {
                const angle = Math.atan2(b.y, b.x);
                const normalX = Math.cos(angle);
                const normalY = Math.sin(angle);
                const dot = b.vx * normalX + b.vy * normalY;
                b.vx -= 2 * dot * normalX;
                b.vy -= 2 * dot * normalY;
                b.bounces--;
            } else {
                bullets.splice(i, 1);
            }
        }

        if(Math.sqrt((player.worldX-b.x)**2 + (player.worldY-b.y)**2) < player.radius) {
            player.health -= 6; bullets.splice(i, 1); camera.shake = 8;
            spawnParticles(player.worldX, player.worldY, '#7ed6df', 5);
        }
    });

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i]; p.x += p.vx; p.y += p.vy; p.vx *= 0.95; p.vy *= 0.95; p.life -= p.decay;
        if (p.life <= 0) particles.splice(i, 1);
    }

    if(player.health <= 0) endGame();

    document.getElementById('wave-progress-bar').style.width = (timeLeft/totalWaveTime*100)+'%';
    document.getElementById('health-bar').style.width = (player.health/player.maxHealth*100)+'%';
    document.getElementById('wave-display').innerText = wave;
    document.getElementById('timer-display').innerText = Math.max(0, timeLeft);
    document.getElementById('score-display').innerText = score;
}

function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);

    if (e.type === 'assembler') {

        ctx.fillStyle = '#2c3e50';
        ctx.fillRect(-80, -80, 160, 160);

        ctx.strokeStyle = '#95a5a6';
        ctx.lineWidth = 8;
        ctx.strokeRect(-80, -80, 160, 160);

        ctx.fillStyle = '#1a252f';
        ctx.beginPath();
        ctx.arc(0, 0, 50, 0, Math.PI * 2);
        ctx.fill();

        ctx.rotate(e.armAngle);

        ctx.fillStyle = '#7f8c8d';
        ctx.fillRect(40, -10, 60, 20);

        ctx.fillStyle = '#c0392b';
        ctx.beginPath();
        ctx.arc(100, 0, 15, 0, Math.PI * 2);
        ctx.fill();

    } else if (e.isBoss) {

        ctx.rotate(e.angle);

        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.moveTo(e.r, 0);
        ctx.lineTo(-e.r, e.r);
        ctx.lineTo(-e.r, -e.r);
        ctx.closePath();
        ctx.fill();

    } else if (e.type === 'mecha-spider') {

        // --- DRAW MECHA-SPIDER ---
        ctx.rotate(e.spiderAngle);

        const bodyR = e.r * 0.6;   // inner body circle radius
        const isWindup = e.attackState === 'windup';

        // Draw 6 legs (3 on each side), radiating from body
        ctx.strokeStyle = '#6c3483';
        ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
            // Legs spaced evenly, offset from front/back
            const legAng = (i / 6) * Math.PI * 2 + Math.PI / 6;
            const legStartX = Math.cos(legAng) * bodyR * 0.8;
            const legStartY = Math.sin(legAng) * bodyR * 0.8;
            // Legs extend outward with a bent mid-point
            const midX = Math.cos(legAng) * bodyR * 1.5;
            const midY = Math.sin(legAng) * bodyR * 1.5;
            const tipX = Math.cos(legAng + 0.45) * (e.r * 1.2);
            const tipY = Math.sin(legAng + 0.45) * (e.r * 1.2);

            ctx.beginPath();
            ctx.moveTo(legStartX, legStartY);
            ctx.lineTo(midX, midY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
        }

        // Outer ring (metal shell)
        ctx.fillStyle = '#2d1b4e';
        ctx.beginPath();
        ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = isWindup ? '#e056fd' : '#8e44ad';
        ctx.lineWidth = isWindup ? 4 : 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, bodyR, 0, Math.PI * 2);
        ctx.stroke();

        // Glow core (pulsing)
        const glowIntensity = 0.55 + Math.sin(e.corePulse) * 0.35;
        const coreR = bodyR * 0.4;

        // Outer glow
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, coreR * 2.2);
        gradient.addColorStop(0, `rgba(200,130,255,${glowIntensity})`);
        gradient.addColorStop(0.4, `rgba(142,68,173,${glowIntensity * 0.6})`);
        gradient.addColorStop(1, 'rgba(142,68,173,0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, coreR * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Bright inner core
        ctx.fillStyle = isWindup ? '#f8f8ff' : `rgba(230,210,255,${glowIntensity})`;
        ctx.beginPath();
        ctx.arc(0, 0, coreR, 0, Math.PI * 2);
        ctx.fill();

        // Tiny detail ring around core
        ctx.strokeStyle = 'rgba(200,180,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, coreR * 1.4, 0, Math.PI * 2);
        ctx.stroke();

    } else {

        ctx.rotate(e.angle);

        if (e.type === 'wasp') {

            ctx.fillStyle = '#f1c40f';

            ctx.beginPath();
            ctx.moveTo(e.r, 0);
            ctx.lineTo(-e.r / 2, e.r / 1.5);
            ctx.lineTo(-e.r / 2, -e.r / 1.5);
            ctx.closePath();
            ctx.fill();

        } else if (e.type === 'crab') {

            ctx.fillStyle = '#e67e22';
            ctx.fillRect(-60, -50, 120, 100);

            ctx.strokeStyle = '#c0392b';
            ctx.lineWidth = 6;

            const lm = Math.sin(Date.now() / 150) * 20;

            for (let i = 0; i < 4; i++) {

                ctx.beginPath();
                ctx.moveTo(-20 + i * 15, 50);
                ctx.lineTo(-30 + i * 15 + lm, 75);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(-20 + i * 15, -50);
                ctx.lineTo(-30 + i * 15 + lm, -75);
                ctx.stroke();
            }

        } else if (e.type === 'mecha-shark') {

            ctx.fillStyle = (e.sharkState === 'dive') ? '#e74c3c' : '#3498db';

            ctx.beginPath();
            ctx.ellipse(0, 0, 75, 35, 0, 0, Math.PI * 2);
            ctx.fill();

        } else if (e.type === 'tank') {

            ctx.fillStyle = '#7f8c8d';
            ctx.fillRect(-50, -50, 100, 100);

            ctx.fillStyle = '#222';
            ctx.fillRect(0, -12, 60, 24);

        } else if (e.type === 'mecha-saw') {

            ctx.fillStyle = '#333';
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.rotate(e.bladeAngle);

            ctx.strokeStyle = '#c0392b';
            ctx.lineWidth = 4;

            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const a = (i * Math.PI * 2) / 10;

                ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
                ctx.lineTo(Math.cos(a + 0.2) * 35, Math.sin(a + 0.2) * 35);
            }
            ctx.closePath();
            ctx.stroke();
        }
    }

    ctx.restore();

    ctx.fillStyle = '#222';
    ctx.fillRect(e.x - e.r, e.y - e.r - 25, e.r * 2, 8);

    ctx.fillStyle = '#ff4757';
    ctx.fillRect(
        e.x - e.r,
        e.y - e.r - 25,
        (e.hp / e.maxHp) * e.r * 2,
        8
    );
}


function drawWebs() {
    webs.forEach(w => {
        // Pulsing opacity
        const pulse = 0.28 + Math.sin(w.pulse) * 0.1;

        // Outer web fill
        ctx.fillStyle = `rgba(138,43,226,${pulse})`;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.fill();

        // Web ring
        ctx.strokeStyle = `rgba(180,100,255,${pulse + 0.15})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r, 0, Math.PI * 2);
        ctx.stroke();

        // Inner glow ring
        ctx.strokeStyle = `rgba(220,160,255,${pulse * 0.7})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(w.x, w.y, w.r * 0.55, 0, Math.PI * 2);
        ctx.stroke();

        // Radial web lines (like a spider's web)
        ctx.strokeStyle = `rgba(200,140,255,${pulse * 0.6})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(w.x, w.y);
            ctx.lineTo(w.x + Math.cos(a) * w.r, w.y + Math.sin(a) * w.r);
            ctx.stroke();
        }
    });
}


function loop() {
    update();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    if (camera.shake > 0) {
        ctx.translate(
            (Math.random() - 0.5) * camera.shake,
            (Math.random() - 0.5) * camera.shake
        );
    }

    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-camera.x, -camera.y);

    // background
    ctx.fillStyle = '#34495e';
    ctx.fillRect(-WORLD_RADIUS, -WORLD_RADIUS, WORLD_RADIUS * 2, WORLD_RADIUS * 2);

    // grid
    ctx.strokeStyle = '#2c3e50';
    ctx.lineWidth = 2;

    for (let i = -WORLD_RADIUS; i <= WORLD_RADIUS; i += 100) {

        ctx.beginPath();
        ctx.moveTo(i, -WORLD_RADIUS);
        ctx.lineTo(i, WORLD_RADIUS);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(-WORLD_RADIUS, i);
        ctx.lineTo(WORLD_RADIUS, i);
        ctx.stroke();
    }

    // puddles
    puddles.forEach(p => {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    });

    // webs (drawn below enemies so they appear on the floor)
    drawWebs();

    // border
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // particles
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    });

    ctx.globalAlpha = 1.0;

    // bullets
    bullets.forEach(b => {
        ctx.fillStyle = '#f1c40f';

        ctx.beginPath();
        ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    enemies.forEach(e => drawEnemy(e));

    // player
    ctx.fillStyle = (player.slipTimer > 0) ? '#ff9f43' : (player.webSlowTimer > 0 ? '#a29bfe' : '#7ed6df');

    ctx.beginPath();
    ctx.arc(player.worldX, player.worldY, player.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(player.worldX, player.worldY);
    ctx.rotate(player.angle);

    ctx.strokeStyle = '#bdc3c7';
    ctx.lineWidth = 6;

    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = (i * Math.PI * 2) / 10;

        ctx.lineTo(Math.cos(a) * player.bladeRadius, Math.sin(a) * player.bladeRadius);
        ctx.lineTo(
            Math.cos(a + 0.2) * (player.bladeRadius + 20),
            Math.sin(a + 0.2) * (player.bladeRadius + 20)
        );
    }
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
    ctx.restore();

    drawMinimap();
    requestAnimationFrame(loop);
}


function drawMinimap() {
    mCtx.clearRect(0, 0, 150, 150);

    const s = 150 / (WORLD_RADIUS * 2);

    mCtx.fillStyle = '#7ed6df';
    mCtx.beginPath();
    mCtx.arc(75 + player.worldX * s, 75 + player.worldY * s, 4, 0, Math.PI * 2);
    mCtx.fill();

    mCtx.fillStyle = '#ff4757';
    enemies.forEach(e => {
        mCtx.beginPath();
        mCtx.arc(
            75 + e.x * s,
            75 + e.y * s,
            e.isBoss ? 6 : 2,
            0,
            Math.PI * 2
        );
        mCtx.fill();
    });
}


function endGame() {
    gameOver = true;
    clearInterval(timerInterval);

    document.getElementById('game-over').classList.remove('hidden');
    document.getElementById('final-wave').innerText = wave;
}

spawnWave();
loop();