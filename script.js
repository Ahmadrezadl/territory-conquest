// --- Constants ---
const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const MIN_CONNECTION_ANGLE = (Math.PI / 180) * 45;

// --- DOM Elements ---
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const settingsModal = document.getElementById('settings-modal');
const gameOverModal = document.getElementById('game-over-modal');
const gameContainer = document.getElementById('game-container');
const winnerMessage = document.getElementById('winner-message');
const playerListDiv = document.getElementById('player-list');
const addPlayerBtn = document.getElementById('add-player-btn');
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
let gameActive = false;

const DEFAULT_PLAYER_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#eab308', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#64748b', '#d946ef'
];

let menuPlayers = [];

function saveMenuPlayers() {
    localStorage.setItem('territoryConquestPlayers', JSON.stringify(menuPlayers));
}

function loadMenuPlayers() {
    const saved = localStorage.getItem('territoryConquestPlayers');
    if (saved) {
        menuPlayers = JSON.parse(saved);
    } else {
        menuPlayers = [
            { name: 'Player 1', color: DEFAULT_PLAYER_COLORS[0], isBot: false },
            { name: 'Bot 1', color: DEFAULT_PLAYER_COLORS[1], isBot: true }
        ];
    }
}

function renderPlayerList() {
    playerListDiv.innerHTML = '';
    menuPlayers.forEach((player, index) => {
        const playerRow = document.createElement('div');
        playerRow.className = 'player-row';
        playerRow.innerHTML = `
            <input type="color" value="${player.color}">
            <input type="text" value="${player.name}" placeholder="Player Name">
            <button class="toggle-bot-btn ${player.isBot ? 'is-bot' : ''}">${player.isBot ? 'Bot' : 'Human'}</button>
            <button class="remove-player-btn">X</button>
        `;

        playerRow.querySelector('input[type="color"]').addEventListener('input', (e) => {
            player.color = e.target.value;
            saveMenuPlayers();
        });
        playerRow.querySelector('input[type="text"]').addEventListener('change', (e) => {
            player.name = e.target.value;
            saveMenuPlayers();
        });
        playerRow.querySelector('.toggle-bot-btn').addEventListener('click', () => {
            player.isBot = !player.isBot;
            saveMenuPlayers();
            renderPlayerList();
        });
        playerRow.querySelector('.remove-player-btn').addEventListener('click', () => {
            if (menuPlayers.length > 2) {
                menuPlayers.splice(index, 1);
                saveMenuPlayers();
                renderPlayerList();
            }
        });

        playerListDiv.appendChild(playerRow);
    });
}

addPlayerBtn.addEventListener('click', () => {
    if (menuPlayers.length < 10) {
        const newPlayerName = `Player ${menuPlayers.length + 1}`;
        const newPlayerColor = DEFAULT_PLAYER_COLORS[menuPlayers.length % DEFAULT_PLAYER_COLORS.length];
        menuPlayers.push({ name: newPlayerName, color: newPlayerColor, isBot: false });
        saveMenuPlayers();
        renderPlayerList();
    }
});

playBtn.addEventListener('click', () => {
    if (menuPlayers.length < 2) {
        alert("You need at least two players to start the game!");
        return;
    }
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

function startGame() {
    resizeCanvas();
    
    players = menuPlayers.map((p, index) => ({
        id: index,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        isAlive: true
    }));
    
    activeAttacks = [];
    interactiveArrows = [];
    selectedTerritory = null;

    generateMap(players.length);
    distributeTerritories(players.length);

    if (unitIntervalId) clearInterval(unitIntervalId);
    if (botIntervalId) clearInterval(botIntervalId);

    gameActive = true;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    gameLoop();
    
    unitIntervalId = setInterval(generateUnits, 1000);
    botIntervalId = setInterval(runBotActions, 1200);
}

function generateMap(numPlayers) {
    territories = [];
    const numTerritories = Math.max(12, numPlayers * 5);
    const mapWidth = LOGICAL_WIDTH;
    const mapHeight = LOGICAL_HEIGHT;
    const margin = 80;

    const points = generatePoissonPoints(mapWidth, mapHeight, numTerritories, margin);
    
    points.forEach(p => {
        const baseRadius = 35;
        territories.push({
            x: p.x,
            y: p.y,
            radius: baseRadius,
            owner: null,
            units: 10,
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
            territories[p1].connections.push(p2);
            territories[p2].connections.push(p1);
        }
    }

    pruneConnectionsByAngle();
    ensureMinimumConnections(2);
    ensureConnectivity();
}

function getAngle(p1, p2, p3) {
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    return Math.acos(dot / (mag1 * mag2));
}

function pruneConnectionsByAngle() {
    territories.forEach((t, tIndex) => {
        if (t.connections.length < 2) return;

        const neighbors = t.connections.map(connIndex => {
            const neighbor = territories[connIndex];
            return {
                index: connIndex,
                angle: Math.atan2(neighbor.y - t.y, neighbor.x - t.x)
            };
        }).sort((a, b) => a.angle - b.angle);

        let toRemove = new Set();
        for (let i = 0; i < neighbors.length; i++) {
            const current = neighbors[i];
            const next = neighbors[(i + 1) % neighbors.length];
            let angleDiff = Math.abs(current.angle - next.angle);
            if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;

            if (angleDiff < MIN_CONNECTION_ANGLE) {
                const dist1 = Math.hypot(t.x - territories[current.index].x, t.y - territories[current.index].y);
                const dist2 = Math.hypot(t.x - territories[next.index].x, t.y - territories[next.index].y);
                if (dist1 > dist2) {
                    toRemove.add(current.index);
                } else {
                    toRemove.add(next.index);
                }
            }
        }
        
        t.connections = t.connections.filter(connIndex => !toRemove.has(connIndex));
        toRemove.forEach(removedIndex => {
            const neighbor = territories[removedIndex];
            neighbor.connections = neighbor.connections.filter(c => c !== tIndex);
        });
    });
}

function ensureMinimumConnections(minCount) {
    territories.forEach((t, tIndex) => {
        while (t.connections.length < minCount) {
            let closestDist = Infinity;
            let closestCandidate = -1;

            territories.forEach((candidate, candIndex) => {
                if (tIndex === candIndex || t.connections.includes(candIndex)) return;
                
                const dist = Math.hypot(t.x - candidate.x, t.y - candidate.y);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestCandidate = candIndex;
                }
            });

            if (closestCandidate !== -1) {
                t.connections.push(closestCandidate);
                territories[closestCandidate].connections.push(tIndex);
            } else {
                break;
            }
        }
    });
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
    const radius = Math.sqrt(((width - margin * 2) * (height - margin * 2)) / (count * Math.PI)) * 1.5;
    const radius2 = radius * radius;
    const R = 3 * radius2;
    const cellSize = radius * Math.SQRT1_2;
    const gridWidth = Math.ceil(width / cellSize);
    const gridHeight = Math.ceil(height / cellSize);
    const grid = new Array(gridWidth * gridHeight);
    const queue = [];
    const points = [];
    function sample(x, y) {
        const p = { x, y };
        queue.push(p);
        const i = Math.floor(x / cellSize);
        const j = Math.floor(y / cellSize);
        grid[j * gridWidth + i] = p;
        points.push(p);
        return p;
    }
    sample(width / 2, height / 2);
    while (queue.length > 0 && points.length < count) {
        const i = Math.floor(Math.random() * queue.length);
        const p = queue[i];
        for (let j = 0; j < k; j++) {
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
            { x: w, y: h },
            { x: 0, y: 0 },
            { x: w, y: 0 },
            { x: 0, y: h },
        ];
        for (let i = 0; i < numPlayers; i++) {
            let bestTerritoryIndex = -1;
            if (i < 4) {
                let closestTerritoryIndex = -1;
                let minCornerDist = Infinity;
                const targetCorner = cornerPoints[i];
                unowned.forEach(terrIndex => {
                    const t = territories[terrIndex];
                    const dist = Math.hypot(t.x - targetCorner.x, t.y - targetCorner.y);
                    if (dist < minCornerDist) {
                        minCornerDist = dist;
                        closestTerritoryIndex = terrIndex;
                    }
                });
                bestTerritoryIndex = closestTerritoryIndex;
            } else {
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
            winnerMessage.textContent = `${winner.name} Wins!`;
            winnerMessage.style.color = winner.color;
        } else {
            winnerMessage.textContent = `It's a Draw!`;
            winnerMessage.style.color = '#333';
        }
    }
}

function runBotActions() {
    if (!gameActive) return;
    players.forEach(player => {
        if (!player.isBot || !player.isAlive) return;
        const myTerritories = territories.filter(t => t.owner === player.id);
        if (myTerritories.length === 0) return;
        const actionRoll = Math.random();
        if (actionRoll < 0.6) {
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
        } else if (actionRoll < 0.9) {
            const vulnerableTerritories = myTerritories.filter(t => {
                return t.connections.some(c => territories[c].owner !== player.id && territories[c].units > t.units);
            }).sort((a, b) => a.units - b.units);
            if (vulnerableTerritories.length > 0) {
                const target = vulnerableTerritories[0];
                const potentialReinforcers = target.connections
                    .map(c => territories[c])
                    .filter(t => t.owner === player.id && t.units > target.units && t.units > 20)
                    .sort((a, b) => b.units - a.units);
                if (potentialReinforcers.length > 0) {
                    launchAttack(potentialReinforcers[0], target);
                }
            }
        } else {
            const backlineTerritories = myTerritories.filter(t =>
                t.units > 25 && t.connections.every(c => territories[c].owner === player.id)
            ).sort((a, b) => b.units - a.units);
            const frontlineTerritories = myTerritories.filter(t =>
                t.connections.some(c => territories[c].owner !== player.id)
            ).sort((a, b) => a.units - b.units);
            if (backlineTerritories.length > 0 && frontlineTerritories.length > 0) {
                launchAttack(backlineTerritories[0], frontlineTerritories[0]);
            }
        }
    });
}

function gameLoop() {
    updateAttacks();
    draw();
    checkWinCondition();
    if (gameActive) {
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
            if (i < connIndex) {
                const neighbor = territories[connIndex];
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
        
        if (t.owner !== null && !players[t.owner].isBot) {
            const glowAmount = (Math.sin(performance.now() / 300) + 1) / 2;
            ctx.shadowColor = 'rgba(255, 255, 255, 0.9)';
            ctx.shadowBlur = 15 + (glowAmount * 15);
            ctx.fillStyle = players[t.owner].color;
            ctx.fill();
            ctx.shadowBlur = 0;
        }

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
    // This part is commented out as it wasn't in the final HTML.
    // You can add a <div id="player-info"></div> back to your HTML to use it.
    /*
    let infoHTML = '';
    players.filter(p => p.isAlive).forEach(p => {
        const territoryCount = territories.filter(t => t.owner === p.id).length;
        const unitCount = territories.filter(t => t.owner === p.id).reduce((sum, t) => sum + t.units, 0);
        infoHTML += `
            <div class="player-info-row">
                <span class="player-color-dot" style="background-color: ${p.color};"></span>
                <span class="player-info-text">${p.name}:</span>
                <span class="player-info-stats">${territoryCount} Terr. / ${Math.floor(unitCount)} Units</span>
            </div>
        `;
    });
    // const playerInfoDiv = document.getElementById('player-info');
    // if (playerInfoDiv) playerInfoDiv.innerHTML = infoHTML;
    */
}

function handleCanvasClick(event) {
    if (!gameActive) return;
    const rect = canvas.getBoundingClientRect();
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

window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleCanvasClick(e.touches[0]);
}, { passive: false });

loadMenuPlayers();
renderPlayerList();
resizeCanvas();