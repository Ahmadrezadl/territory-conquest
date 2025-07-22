// --- Constants ---
// Logical game dimensions (always landscape)
const LOGICAL_WIDTH = 1920;
const LOGICAL_HEIGHT = 1080;
const MIN_CONNECTION_ANGLE = (Math.PI / 180) * 45;
const MIN_NODE_DISTANCE = 140; // <-- NEW: Minimum pixel distance between node centers

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
const quitBtn = document.getElementById('quit-btn');

// --- Game State Variables ---
let territories = [];
let players = [];
let activeAttacks = [];
let playerSelections = [];
let animationFrameId;
let unitIntervalId;
let botIntervalId;
let gameActive = false;
let isPortrait = false; // Flag for screen orientation

const DEFAULT_PLAYER_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#eab308', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#64748b', '#d946ef'
];

let menuPlayers = [];

// --- Local Storage Functions ---
function saveMenuPlayers() {
    localStorage.setItem('territoryConquestPlayers', JSON.stringify(menuPlayers));
}

function loadMenuPlayers() {
    const saved = localStorage.getItem('territoryConquestPlayers');
    if (saved) {
        menuPlayers = JSON.parse(saved);
    } else {
        // Default players for first-time load
        menuPlayers = [
            { name: 'Player 1', color: DEFAULT_PLAYER_COLORS[0], isBot: false },
            { name: 'Bot 1', color: DEFAULT_PLAYER_COLORS[1], isBot: true }
        ];
    }
}

// --- Player List Rendering ---
function renderPlayerList() {
    playerListDiv.innerHTML = '';
    menuPlayers.forEach((player, index) => {
        const playerRow = document.createElement('div');
        playerRow.className = 'player-row';
        playerRow.style.animationDelay = `${index * 50}ms`;
        playerRow.innerHTML = `
            <input type="color" value="${player.color}" title="Player Color">
            <input type="text" value="${player.name}" placeholder="Player Name">
            <div class="toggle-container">
                <span>Human</span>
                <label class="toggle-switch">
                    <input type="checkbox" ${player.isBot ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
                <span>Bot</span>
            </div>
            <button class="remove-player-btn" title="Remove Player">X</button>
        `;

        playerRow.querySelector('input[type="color"]').addEventListener('input', (e) => {
            player.color = e.target.value;
            saveMenuPlayers();
        });
        playerRow.querySelector('input[type="text"]').addEventListener('change', (e) => {
            player.name = e.target.value;
            saveMenuPlayers();
        });
        playerRow.querySelector('.toggle-switch input').addEventListener('change', (e) => {
            player.isBot = e.target.checked;
            saveMenuPlayers();
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

// --- Event Listeners for Buttons ---
addPlayerBtn.addEventListener('click', () => {
    if (menuPlayers.length < 10) {
        const newPlayerName = `Player ${menuPlayers.length + 1}`;
        const newPlayerColor = DEFAULT_PLAYER_COLORS[menuPlayers.length % DEFAULT_PLAYER_COLORS.length];
        menuPlayers.push({ name: newPlayerName, color: newPlayerColor, isBot: false });
        saveMenuPlayers();
        renderPlayerList();
    }
});

function stopGame() {
    cancelAnimationFrame(animationFrameId);
    clearInterval(unitIntervalId);
    clearInterval(botIntervalId);
    gameActive = false;
    settingsModal.style.display = 'flex';
    gameContainer.classList.add('hidden');
    gameOverModal.classList.add('hidden');
}

playBtn.addEventListener('click', () => {
    if (menuPlayers.length < 2) {
        alert("You need at least two players to start the game!");
        return;
    }
    settingsModal.style.display = 'none';
    gameContainer.classList.remove('hidden');

    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(err => {
            console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
        });
    }

    startGame();
});

restartBtn.addEventListener('click', () => {
    stopGame();
});

quitBtn.addEventListener('click', () => {
    stopGame();
});

// --- Game Initialization ---
function startGame() {
    resizeCanvas(); // Initial resize and orientation check
    
    players = menuPlayers.map((p, index) => ({
        id: index,
        name: p.name,
        color: p.color,
        isBot: p.isBot,
        isAlive: true
    }));
    
    activeAttacks = [];
    playerSelections = Array(players.length).fill(null);

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

// --- Map Generation ---
function generateMap(numPlayers) {
    territories = [];
    // <-- FEWER NODES: Changed formula for a smaller map
    const numTerritories = Math.max(12, numPlayers * 4);
    const mapWidth = LOGICAL_WIDTH;
    const mapHeight = LOGICAL_HEIGHT;
    const margin = 100;

    let points = generateGuaranteedEvenPoints(mapWidth, mapHeight, numTerritories, margin);
    
    // <-- NEW: Enforce minimum distance between points after they are generated
    enforceMinimumDistance(points, MIN_NODE_DISTANCE, mapWidth, mapHeight, margin);

    points.forEach(p => {
        const baseRadius = 55;
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
    
    const UNPACKED = d3.Delaunay.from(territories.map(t => [t.x, t.y]));
    const { halfedges, triangles } = UNPACKED;
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
    const isolatedTerritories = territories.map((_, i) => i).filter(i => !visited.has(i));
    isolatedTerritories.forEach(isoIndex => {
        let closestDist = Infinity;
        let closestMainIndex = -1;
        visited.forEach(mainIndex => {
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
    if (isolatedTerritories.length > 0) {
        ensureConnectivity();
    }
}

function generateGuaranteedEvenPoints(width, height, count, margin) {
    const points = [];
    if (count === 0) return points;

    const aspectRatio = (width - margin * 2) / (height - margin * 2);
    const cols = Math.ceil(Math.sqrt(count * aspectRatio));
    const rows = Math.ceil(count / cols);

    const cellWidth = (width - margin * 2) / cols;
    const cellHeight = (height - margin * 2) / rows;

    const cells = [];
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            cells.push({ row: i, col: j });
        }
    }

    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    for (let i = 0; i < count; i++) {
        const cell = cells[i];
        if (!cell) continue;

        const paddingX = cellWidth * 0.15;
        const paddingY = cellHeight * 0.15;

        const x = margin + cell.col * cellWidth + paddingX + (Math.random() * (cellWidth - paddingX * 2));
        const y = margin + cell.row * cellHeight + paddingY + (Math.random() * (cellHeight - paddingY * 2));

        points.push({ x, y });
    }

    return points;
}

// <-- NEW FUNCTION to enforce minimum distance
function enforceMinimumDistance(points, minDistance, width, height, margin) {
    const iterations = 10;
    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < points.length; i++) {
            for (let j = i + 1; j < points.length; j++) {
                const p1 = points[i];
                const p2 = points[j];
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const distance = Math.hypot(dx, dy);

                if (distance < minDistance) {
                    const overlap = minDistance - distance;
                    const adjustX = (dx / distance) * overlap * 0.5;
                    const adjustY = (dy / distance) * overlap * 0.5;

                    p1.x -= adjustX;
                    p1.y -= adjustY;
                    p2.x += adjustX;
                    p2.y += adjustY;
                }
            }
        }
    }

    // Clamp points to stay within the margins after nudging them
    points.forEach(p => {
        p.x = Math.max(margin, Math.min(width - margin, p.x));
        p.y = Math.max(margin, Math.min(height - margin, p.y));
    });
}


// --- Territory Distribution ---
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

// --- Unit Generation & Attack Logic ---
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
    const duration = 1000; // milliseconds
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

// --- Win Condition & Bot AI ---
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

        myTerritories.forEach(from => {
            if (from.units < 15) return;

            let bestTarget = null;
            let bestScore = -1;

            from.connections.forEach(toIndex => {
                const to = territories[toIndex];
                if (to.owner !== player.id) {
                    const score = (from.units - to.units) / (to.units + 1);
                    if (score > bestScore && from.units > to.units + 3) {
                        bestScore = score;
                        bestTarget = to;
                    }
                }
            });

            if (bestTarget && Math.random() < 0.4) {
                launchAttack(from, bestTarget);
            }
        });

        const backlineTerritories = myTerritories
            .filter(t => t.units > 30 && t.connections.every(c => territories[c].owner === player.id))
            .sort((a, b) => b.units - a.units);

        const frontlineTerritories = myTerritories
            .filter(t => t.connections.some(c => territories[c].owner !== player.id))
            .sort((a, b) => a.units - b.units);

        if (backlineTerritories.length > 0 && frontlineTerritories.length > 0) {
            const reinforcer = backlineTerritories[0];
            const target = frontlineTerritories[0];
            
            if (reinforcer && target && reinforcer.units > target.units + 10 && Math.random() < 0.2) {
                launchAttack(reinforcer, target);
            }
        }
    });
}


// --- Game Loop ---
function gameLoop() {
    updateAttacks();
    draw();
    checkWinCondition();
    if (gameActive) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

// --- Drawing Functions ---
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();

    let scale, offsetX, offsetY;

    if (isPortrait) {
        scale = Math.min(canvas.height / LOGICAL_WIDTH, canvas.width / LOGICAL_HEIGHT);
        offsetX = (canvas.width - LOGICAL_HEIGHT * scale) / 2;
        offsetY = (canvas.height - LOGICAL_WIDTH * scale) / 2;
        
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
        ctx.translate(LOGICAL_HEIGHT, 0);
        ctx.rotate(Math.PI / 2);

    } else {
        scale = Math.min(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);
        offsetX = (canvas.width - LOGICAL_WIDTH * scale) / 2;
        offsetY = (canvas.height - LOGICAL_HEIGHT * scale) / 2;
        
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);
    }

    // Draw connections
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 4;
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

    // Draw territories
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

        if (playerSelections.includes(t)) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 6;
            ctx.stroke();
        }

        ctx.fillStyle = 'white';
        ctx.font = `bold ${t.radius / 1.5}px Poppins`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 5;
        ctx.fillText(Math.floor(t.units), t.x, t.y);
        ctx.shadowBlur = 0;
    });

    drawInteractiveArrows();

    // Draw attacks
    activeAttacks.forEach(attack => {
        const from = territories[attack.from];
        const to = territories[attack.to];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const currentX = from.x + dx * attack.progress;
        const currentY = from.y + dy * attack.progress;
        ctx.beginPath();
        ctx.arc(currentX, currentY, 15, 0, Math.PI * 2);
        ctx.fillStyle = players[attack.owner].color;
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Poppins';
        ctx.fillText(attack.units, currentX, currentY);
    });

    ctx.restore();
}

function drawInteractiveArrows() {
    playerSelections.forEach(selectedTerritory => {
        if (!selectedTerritory) {
            return;
        }

        selectedTerritory.connections.forEach(connIndex => {
            const from = selectedTerritory;
            const to = territories[connIndex];
            
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            const arrowOffset = from.radius + 40;
            const x = from.x + arrowOffset * Math.cos(angle);
            const y = from.y + arrowOffset * Math.sin(angle);

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -25);
            ctx.lineTo(40, 0);
            ctx.lineTo(0, 25);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        });
    });
}

function handleCanvasClick(event) {
    if (!gameActive) return;

    const rect = canvas.getBoundingClientRect();
    let scale, offsetX, offsetY;
    let clickX = event.clientX - rect.left;
    let clickY = event.clientY - rect.top;
    let logicalX, logicalY;

    if (isPortrait) {
        scale = Math.min(rect.height / LOGICAL_WIDTH, rect.width / LOGICAL_HEIGHT);
        offsetX = (rect.width - LOGICAL_HEIGHT * scale) / 2;
        offsetY = (rect.height - LOGICAL_WIDTH * scale) / 2;
        logicalX = (clickY - offsetY) / scale;
        logicalY = LOGICAL_HEIGHT - (clickX - offsetX) / scale;
    } else {
        scale = Math.min(rect.width / LOGICAL_WIDTH, rect.height / LOGICAL_HEIGHT);
        offsetX = (rect.width - LOGICAL_WIDTH * scale) / 2;
        offsetY = (rect.height - LOGICAL_HEIGHT * scale) / 2;
        logicalX = (clickX - offsetX) / scale;
        logicalY = (clickY - offsetY) / scale;
    }

    // --- Arrow Click Detection ---
    for (let playerId = 0; playerId < playerSelections.length; playerId++) {
        const selectedTerritory = playerSelections[playerId];
        if (!selectedTerritory) continue;

        for (const connIndex of selectedTerritory.connections) {
            const from = selectedTerritory;
            const to = territories[connIndex];
            
            const angle = Math.atan2(to.y - from.y, to.x - from.x);
            const arrowOffset = from.radius + 40;
            const arrowX = from.x + arrowOffset * Math.cos(angle);
            const arrowY = from.y + arrowOffset * Math.sin(angle);

            if (Math.hypot(logicalX - arrowX, logicalY - arrowY) < 40) {
                launchAttack(from, to);
                playerSelections[playerId] = null;
                return;
            }
        }
    }

    // --- Territory Click Detection ---
    const clickedTerritory = territories.find(t => Math.hypot(t.x - logicalX, t.y - logicalY) < t.radius);

    if (clickedTerritory) {
        const ownerId = clickedTerritory.owner;

        if (ownerId !== null && !players[ownerId].isBot) {
            if (playerSelections[ownerId] === clickedTerritory) {
                playerSelections[ownerId] = null;
            } else {
                playerSelections[ownerId] = clickedTerritory;
            }
        }
    }
}

// --- Canvas Resizing ---
function resizeCanvas() {
    canvas.width = gameContainer.clientWidth;
    canvas.height = gameContainer.clientHeight;
    isPortrait = canvas.width < canvas.height; // Update orientation flag
    if (gameActive) {
        draw();
    }
}

// --- Event Listeners ---
window.addEventListener('resize', resizeCanvas);
canvas.addEventListener('click', handleCanvasClick);
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault(); // Prevent scrolling/zooming
    handleCanvasClick(e.touches[0]);
}, { passive: false });

// --- Initial Setup ---
loadMenuPlayers();
renderPlayerList();
resizeCanvas();