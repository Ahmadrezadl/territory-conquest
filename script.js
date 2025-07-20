// --- Constants ---
const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;

// --- DOM Elements ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const settingsModal = document.getElementById('settings-modal');
const gameOverModal = document.getElementById('game-over-modal');
const gameContainer = document.getElementById('game-container');
const winnerMessage = document.getElementById('winner-message');
const playerInfoDiv = document.getElementById('player-info');
const playerCountSlider = document.getElementById('player-count');
const playerCountLabel = document.getElementById('player-count-label');
const botCountSlider = document.getElementById('bot-count');
const botCountLabel = document.getElementById('bot-count-label');
const symmetricalMapBtn = document.getElementById('symmetrical-map-btn');
const unbalancedMapBtn = document.getElementById('unbalanced-map-btn');
const playBtn = document.getElementById('play-btn');
const restartBtn = document.getElementById('restart-btn');

// --- Game State Variables ---
let territories = [];
let players = [];
let activeAttacks = [];
let interactiveArrows = [];
let selectedTerritory = null;
let animationFrameId;
let unitIntervalId;
let botIntervalId;
let mapType = 'symmetrical';
let gameActive = false;

const PLAYER_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#eab308', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#64748b', '#d946ef'
];

// --- Settings Logic ---
playerCountSlider.addEventListener('input', () => {
    playerCountLabel.textContent = playerCountSlider.value;
    botCountSlider.max = playerCountSlider.value - 1;
    if (parseInt(botCountSlider.value) > parseInt(botCountSlider.max)) {
        botCountSlider.value = botCountSlider.max;
    }
    botCountLabel.textContent = botCountSlider.value;
});

botCountSlider.addEventListener('input', () => {
    botCountLabel.textContent = botCountSlider.value;
});

symmetricalMapBtn.addEventListener('click', () => {
    mapType = 'symmetrical';
    symmetricalMapBtn.classList.add('active');
    unbalancedMapBtn.classList.remove('active');
});

unbalancedMapBtn.addEventListener('click', () => {
    mapType = 'unbalanced';
    unbalancedMapBtn.classList.add('active');
    symmetricalMapBtn.classList.remove('active');
});

playBtn.addEventListener('click', () => {
    settingsModal.style.display = 'none';
    gameContainer.classList.remove('hidden');
    document.documentElement.requestFullscreen().catch(err => {
        console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
    });
    startGame();
});

restartBtn.addEventListener('click', () => {
    gameOverModal.classList.add('hidden');
    settingsModal.style.display = 'flex';
    gameContainer.classList.add('hidden');
    cancelAnimationFrame(animationFrameId);
    clearInterval(unitIntervalId);
    clearInterval(botIntervalId);
    gameActive = false;
});

function isMobile() {
    return /Mobi|Android/i.test(navigator.userAgent);
}

// --- Game Initialization ---
function startGame() {
    resizeCanvas();
    const numPlayers = parseInt(playerCountSlider.value);
    const numBots = parseInt(botCountSlider.value);
    
    players = [];
    for (let i = 0; i < numPlayers; i++) {
        players.push({
            id: i,
            color: PLAYER_COLORS[i],
            isBot: i >= (numPlayers - numBots),
            isAlive: true,
        });
    }
    
    activeAttacks = [];
    interactiveArrows = [];
    selectedTerritory = null;

    generateMap(numPlayers);
    distributeTerritories(numPlayers);

    if (unitIntervalId) clearInterval(unitIntervalId);
    if (botIntervalId) clearInterval(botIntervalId);

    gameActive = true;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    gameLoop();
    
    unitIntervalId = setInterval(generateUnits, 1000);
    botIntervalId = setInterval(runBotActions, 1200);
}

// --- Map Generation ---
function generateMap(numPlayers) {
    territories = [];
    const numTerritories = Math.max(12, numPlayers * 4);
    const mapWidth = LOGICAL_WIDTH;
    const mapHeight = LOGICAL_HEIGHT;
    const margin = 60;

    const points = generatePoissonPoints(mapWidth, mapHeight, numTerritories, margin);
    
    points.forEach(p => {
        const baseRadius = mapType === 'symmetrical' ? 35 : 25 + Math.random() * 20;
        territories.push({
            x: p.x,
            y: p.y,
            radius: baseRadius,
            owner: null,
            units: Math.floor(Math.random() * 5) + 10,
            maxUnits: Math.floor(baseRadius * 1.5),
            connections: [],
        });
    });
    
    const delaunay = d3.Delaunay.from(territories.map(t => [t.x, t.y]));
    const { halfedges, triangles } = delaunay;
    for (let i = 0; i < halfedges.length; i++) {
        const j = halfedges[i];
        if (j > i) {
            const p1 = triangles[i];
            const p2 = triangles[j];
            if (!territories[p1].connections.includes(p2)) {
                territories[p1].connections.push(p2);
            }
            if (!territories[p2].connections.includes(p1)) {
                territories[p2].connections.push(p1);
            }
        }
    }

    ensureConnectivity();
}

function ensureConnectivity() {
    if (territories.length < 2) return;

    const visited = new Set();
    const stack = [0];
    visited.add(0);

    while (stack.length > 0) {
        const currentIndex = stack.pop();
        territories[currentIndex].connections.forEach(neighborIndex => {
            if (!visited.has(neighborIndex)) {
                visited.add(neighborIndex);
                stack.push(neighborIndex);
            }
        });
    }

    if (visited.size < territories.length) {
        const mainGroup = Array.from(visited);
        const isolatedGroup = territories.map((_, i) => i).filter(i => !visited.has(i));

        isolatedGroup.forEach(isoIndex => {
            let closestDist = Infinity;
            let closestMainIndex = -1;
            mainGroup.forEach(mainIndex => {
                const dist = Math.hypot(
                    territories[isoIndex].x - territories[mainIndex].x,
                    territories[isoIndex].y - territories[mainIndex].y
                );
                if (dist < closestDist) {
                    closestDist = dist;
                    closestMainIndex = mainIndex;
                }
            });
            if (closestMainIndex !== -1) {
                territories[isoIndex].connections.push(closestMainIndex);
                territories[closestMainIndex].connections.push(isoIndex);
            }
        });
        ensureConnectivity();
    }
}

function generatePoissonPoints(width, height, count, margin) {
    const k = 30; 
    const radius = Math.sqrt(((width - margin*2) * (height - margin*2)) / (count * Math.PI)) * 1.5;
    const radius2 = radius * radius;
    const R = 3 * radius2;
    const cellSize = radius * Math.SQRT1_2;

    const gridWidth = Math.ceil(width / cellSize);
    const gridHeight = Math.ceil(height / cellSize);
    
    const grid = new Array(gridWidth * gridHeight);
    const queue = [];
    const points = [];
    
    function sample(x, y) {
        const p = {x, y};
        queue.push(p);
        const i = Math.floor(x / cellSize);
        const j = Math.floor(y / cellSize);
        grid[j * gridWidth + i] = p;
        points.push(p);
        return p;
    }

    sample(width / 2, height / 2);

    while(queue.length > 0 && points.length < count) {
        const i = Math.floor(Math.random() * queue.length);
        const p = queue[i];

        for(let j = 0; j < k; j++) {
            const a = 2 * Math.PI * Math.random();
            const r = Math.sqrt(Math.random() * R + radius2);
            const x = p.x + r * Math.cos(a);
            const y = p.y + r * Math.sin(a);

            if (x > margin && x < width - margin && y > margin && y < height - margin && isFar(x, y)) {
                sample(x, y);
            }
        }
        
        if (queue.length > 1) {
            queue[i] = queue.pop();
        } else {
            queue.pop();
        }
    }

    function isFar(x, y) {
        const i = Math.floor(x / cellSize);
        const j = Math.floor(y / cellSize);
        const i0 = Math.max(i - 2, 0);
        const j0 = Math.max(j - 2, 0);
        const i1 = Math.min(i + 3, gridWidth);
        const j1 = Math.min(j + 3, gridHeight);

        for (let j_ = j0; j_ < j1; j_++) {
            const o = j_ * gridWidth;
            for (let i_ = i0; i_ < i1; i_++) {
                const s = grid[o + i_];
                if (s) {
                    const dx = s.x - x;
                    const dy = s.y - y;
                    if (dx * dx + dy * dy < radius2) return false;
                }
            }
        }
        return true;
    }
    return points;
}

function distributeTerritories(numPlayers) {
    let unowned = [...territories.keys()];
    let startingTerritories = [];

    if (numPlayers > 0) {
        const w = LOGICAL_WIDTH;
        const h = LOGICAL_HEIGHT;
        const cornerPoints = [
            {x: w, y: h}, // bottom-right
            {x: 0, y: 0}, // top-left
            {x: w, y: 0}, // top-right
            {x: 0, y: h}, // bottom-left
        ];
        
        let assignedCorners = new Set();

        for(let i=0; i < numPlayers; i++) {
            let bestCornerIndex = -1;
            let bestTerritoryIndex = -1;
            let maxDist = -1;

            if (i < 4) { // Assign to corners first
                let closestTerritoryIndex = -1;
                let minCornerDist = Infinity;
                const targetCorner = cornerPoints[i];

                unowned.forEach(terrIndex => {
                    const t = territories[terrIndex];
                    const dist = Math.hypot(t.x - targetCorner.x, t.y - targetCorner.y);
                    if(dist < minCornerDist) {
                        minCornerDist = dist;
                        closestTerritoryIndex = terrIndex;
                    }
                });
                bestTerritoryIndex = closestTerritoryIndex;

            } else { // Assign other players to random unowned territories
                const randIndex = Math.floor(Math.random() * unowned.length);
                bestTerritoryIndex = unowned[randIndex];
            }
            
            if (bestTerritoryIndex !== -1) {
                 startingTerritories[i] = bestTerritoryIndex;
                 unowned = unowned.filter(idx => idx !== bestTerritoryIndex);
            }
        }
    }
    
    startingTerritories.forEach((terrIndex, playerIndex) => {
        if (terrIndex !== undefined) {
            const territory = territories[terrIndex];
            territory.owner = playerIndex;
            territory.units = 25;
        }
    });
}

// --- Game Logic ---
function generateUnits() {
    if (!gameActive) return;
    territories.forEach(t => {
        if (t.owner !== null && t.units < t.maxUnits) {
            t.units++;
        }
    });
}

function launchAttack(from, to) {
    if (from.owner === null || from.units <= 1 || from === to) return;
    const attackingUnits = Math.ceil(from.units / 2);
    from.units -= attackingUnits;

    activeAttacks.push({
        from: territories.indexOf(from),
        to: territories.indexOf(to),
        owner: from.owner,
        units: attackingUnits,
        progress: 0,
        startTime: performance.now()
    });
}

function updateAttacks() {
    const duration = 1000;
    const now = performance.now();
    
    for (let i = activeAttacks.length - 1; i >= 0; i--) {
        const attack = activeAttacks[i];
        const elapsed = now - attack.startTime;
        attack.progress = Math.min(elapsed / duration, 1);

        if (attack.progress >= 1) {
            const targetTerritory = territories[attack.to];
            if (targetTerritory.owner === attack.owner) {
                targetTerritory.units = Math.min(targetTerritory.maxUnits, targetTerritory.units + attack.units);
            } else {
                targetTerritory.units -= attack.units;
                if (targetTerritory.units < 0) {
                    targetTerritory.owner = attack.owner;
                    targetTerritory.units = Math.abs(targetTerritory.units);
                }
            }
            activeAttacks.splice(i, 1);
        }
    }
}

function checkWinCondition() {
    const activePlayerIds = new Set(territories.filter(t => t.owner !== null).map(t => t.owner));
    players.forEach(p => {
        if (p.isAlive && !activePlayerIds.has(p.id)) {
            const hasAttacks = activeAttacks.some(attack => attack.owner === p.id);
            if (!hasAttacks) {
               p.isAlive = false;
            }
        }
    });

    const livingPlayers = players.filter(p => p.isAlive);

    if (livingPlayers.length <= 1 && gameActive) {
        gameActive = false;
        const winner = livingPlayers[0];
        gameOverModal.classList.remove('hidden');
        if (winner) {
            winnerMessage.textContent = `${winner.isBot ? 'Bot' : 'Player'} ${winner.id + 1} Wins!`;
            winnerMessage.style.color = winner.color;
        } else {
             winnerMessage.textContent = `It's a Draw!`;
             winnerMessage.style.color = '#333';
        }
    }
}

// --- Bot AI ---
function runBotActions() {
    if (!gameActive) return;
    players.forEach(player => {
        if (!player.isBot || !player.isAlive) return;

        const myTerritories = territories.filter(t => t.owner === player.id);
        if (myTerritories.length === 0) return;

        const actionRoll = Math.random();
        
        if (actionRoll < 0.6) { // ATTACK
            const possibleAttacks = [];
            myTerritories.forEach(from => {
                if (from.units > 10) {
                    from.connections.forEach(toIndex => {
                        const to = territories[toIndex];
                        if (to.owner !== player.id && from.units > to.units + 5) {
                            const score = (from.units - to.units) / (to.units + 1);
                            possibleAttacks.push({ from, to, score });
                        }
                    });
                }
            });

            if (possibleAttacks.length > 0) {
                possibleAttacks.sort((a, b) => b.score - a.score); 
                launchAttack(possibleAttacks[0].from, possibleAttacks[0].to);
            }

        } else if (actionRoll < 0.9) { // REINFORCE
            const vulnerableTerritories = myTerritories.filter(t => {
                return t.connections.some(c => territories[c].owner !== player.id && territories[c].units > t.units);
            }).sort((a,b) => a.units - b.units);

            if (vulnerableTerritories.length > 0) {
                const target = vulnerableTerritories[0];
                const potentialReinforcers = target.connections
                    .map(c => territories[c])
                    .filter(t => t.owner === player.id && t.units > target.units && t.units > 20)
                    .sort((a,b) => b.units - a.units);
                
                if (potentialReinforcers.length > 0) {
                    launchAttack(potentialReinforcers[0], target);
                }
            }

        } else { // CONSOLIDATE
            const backlineTerritories = myTerritories.filter(t => 
                t.units > 25 && t.connections.every(c => territories[c].owner === player.id)
            ).sort((a,b) => b.units - a.units);

            const frontlineTerritories = myTerritories.filter(t => 
                t.connections.some(c => territories[c].owner !== player.id)
            ).sort((a,b) => a.units - b.units);

            if (backlineTerritories.length > 0 && frontlineTerritories.length > 0) {
                launchAttack(backlineTerritories[0], frontlineTerritories[0]);
            }
        }
    });
}

// --- Rendering ---
function gameLoop() {
    updateAttacks();
    draw();
    checkWinCondition();
    if(gameActive) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save(); 

    const scale = Math.min(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);
    const offsetX = (canvas.width - LOGICAL_WIDTH * scale) / 2;
    const offsetY = (canvas.height - LOGICAL_HEIGHT * scale) / 2;

    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);


    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';

    ctx.lineWidth = 3;
    territories.forEach((t, i) => {
        t.connections.forEach(connIndex => {
            const neighbor = territories[connIndex];
            if (i < connIndex) {
                ctx.beginPath();
                ctx.moveTo(t.x, t.y);
                ctx.lineTo(neighbor.x, neighbor.y);
                ctx.stroke();
            }
        });
    });

    territories.forEach(t => {
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
        ctx.fillStyle = t.owner !== null ? players[t.owner].color : '#6b7280';
        ctx.fill();

        if (t === selectedTerritory) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 5;
            ctx.stroke();
        }

        ctx.fillStyle = 'white';
        ctx.font = `bold ${t.radius / 1.8}px Poppins`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 5;
        ctx.fillText(Math.floor(t.units), t.x, t.y);
        ctx.shadowBlur = 0;
    });
    
    drawInteractiveArrows();

    activeAttacks.forEach(attack => {
        const from = territories[attack.from];
        const to = territories[attack.to];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        
        const currentX = from.x + dx * attack.progress;
        const currentY = from.y + dy * attack.progress;

        ctx.beginPath();
        ctx.arc(currentX, currentY, 12, 0, Math.PI * 2);
        ctx.fillStyle = players[attack.owner].color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = 'white';
        ctx.font = 'bold 14px Poppins';
        ctx.fillText(attack.units, currentX, currentY);
    });
    
    ctx.restore();

    updatePlayerInfo();
}

function drawInteractiveArrows() {
    if (!selectedTerritory) return;
    
    interactiveArrows.forEach(arrow => {
        const { x, y, angle } = arrow;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(25, 0);
        ctx.lineTo(0, 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    });
}

function updatePlayerInfo() {
    let infoHTML = '';
    players.filter(p => p.isAlive).forEach(p => {
        const territoryCount = territories.filter(t => t.owner === p.id).length;
        const unitCount = territories.filter(t => t.owner === p.id).reduce((sum, t) => sum + t.units, 0);
        infoHTML += `
            <div class="player-info-row">
                <span class="player-color-dot" style="background-color: ${p.color};"></span>
                <span class="player-info-text">${p.isBot ? 'Bot' : 'Player'} ${p.id + 1}:</span>
                <span class="player-info-stats">${territoryCount} Terr. / ${Math.floor(unitCount)} Units</span>
            </div>
        `;
    });
    // playerInfoDiv.innerHTML = infoHTML;
}

// --- Event Handling ---
function handleCanvasClick(event) {
    if (!gameActive) return;

    const rect = canvas.getBoundingClientRect();

    // --- Translate physical click coordinates to logical game coordinates ---
    const scale = Math.min(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);
    const offsetX = (canvas.width - LOGICAL_WIDTH * scale) / 2;
    const offsetY = (canvas.height - LOGICAL_HEIGHT * scale) / 2;

    const x = (event.clientX - rect.left - offsetX) / scale;
    const y = (event.clientY - rect.top - offsetY) / scale;

    for (const arrow of interactiveArrows) {
        if (Math.hypot(x - arrow.x, y - arrow.y) < 25) {
            launchAttack(selectedTerritory, territories[arrow.targetIndex]);
            selectedTerritory = null;
            interactiveArrows = [];
            return;
        }
    }

    const clickedTerritory = territories.find(t => Math.hypot(t.x - x, t.y - y) < t.radius);
    selectedTerritory = null;
    interactiveArrows = [];

    if (clickedTerritory && clickedTerritory.owner !== null && !players[clickedTerritory.owner].isBot) {
        selectedTerritory = clickedTerritory;
        selectedTerritory.connections.forEach(connIndex => {
            const neighbor = territories[connIndex];
            const from = selectedTerritory;
            const angle = Math.atan2(neighbor.y - from.y, neighbor.x - from.x);
            
            const arrowOffset = from.radius + 25;
            const posX = from.x + arrowOffset * Math.cos(angle);
            const posY = from.y + arrowOffset * Math.sin(angle);
            
            interactiveArrows.push({ x: posX, y: posY, angle: angle, targetIndex: connIndex });
        });
    }
}

function resizeCanvas() {
    canvas.width = gameContainer.clientWidth;
    canvas.height = gameContainer.clientHeight;
}

// --- Initial Setup ---
window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleCanvasClick(e.touches[0]);
}, { passive: false });


resizeCanvas();