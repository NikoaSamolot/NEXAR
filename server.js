const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

/*
 * RENDER:
 * Render sam ustawia zmienną PORT.
 * Lokalnie możesz używać 43827.
 */
const PORT = Number(process.env.PORT) || 43827;

const PUBLIC_DIR = path.join(__dirname, "public");

/*
 * ==========================================
 * EXPRESS
 * ==========================================
 */

app.use(express.static(PUBLIC_DIR));

app.use(
    "/three",
    express.static(
        path.join(
            __dirname,
            "node_modules",
            "three",
            "build"
        )
    )
);

/*
 * Prosty endpoint do sprawdzania,
 * czy serwer działa.
 */
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        game: "NEXAR",
        players: [...lobbies.values()]
            .reduce(
                (total, lobby) =>
                    total + lobby.players.size,
                0
            )
    });
});

/*
 * ==========================================
 * WEBSOCKET
 * ==========================================
 */

const wss = new WebSocket.Server({
    server
});

/*
 * ==========================================
 * LOBBIES
 * ==========================================
 */

const lobbies = new Map();

let nextPlayerId = 1;

const ALLOWED_KILL_LIMITS = [
    5,
    10,
    15,
    25,
    50,
    100
];

const ARENA_MIN = -18;
const ARENA_MAX = 18;

const SPAWN_MIN_DISTANCE = 4.5;
const SPAWN_ATTEMPTS = 1000;

const SPAWN_WALL_MARGIN = 0.7;

/*
 * ==========================================
 * MAPA
 * ==========================================
 */

const WALLS = [
    {
        x: 0,
        z: 0,
        w: 5,
        d: 5
    },
    {
        x: -9,
        z: 0,
        w: 3,
        d: 9
    },
    {
        x: 9,
        z: 0,
        w: 3,
        d: 9
    },
    {
        x: 0,
        z: -10,
        w: 8,
        d: 3
    },
    {
        x: 0,
        z: 10,
        w: 8,
        d: 3
    }
];

/*
 * ==========================================
 * SPAWN
 * ==========================================
 */

function pointInsideWall(x, z) {
    for (const wall of WALLS) {
        const left =
            wall.x -
            wall.w / 2 -
            SPAWN_WALL_MARGIN;

        const right =
            wall.x +
            wall.w / 2 +
            SPAWN_WALL_MARGIN;

        const top =
            wall.z -
            wall.d / 2 -
            SPAWN_WALL_MARGIN;

        const bottom =
            wall.z +
            wall.d / 2 +
            SPAWN_WALL_MARGIN;

        if (
            x >= left &&
            x <= right &&
            z >= top &&
            z <= bottom
        ) {
            return true;
        }
    }

    return false;
}

function spawnIsSafe(
    lobby,
    x,
    z,
    ignoredPlayer = null
) {
    if (
        pointInsideWall(
            x,
            z
        )
    ) {
        return false;
    }

    for (
        const other
        of lobby.players.values()
    ) {
        if (
            other ===
            ignoredPlayer
        ) {
            continue;
        }

        const dx =
            x -
            other.x;

        const dz =
            z -
            other.z;

        const distance =
            Math.sqrt(
                dx * dx +
                dz * dz
            );

        if (
            distance <
            SPAWN_MIN_DISTANCE
        ) {
            return false;
        }
    }

    return true;
}

function randomSpawn(
    lobby,
    ignoredPlayer = null
) {
    for (
        let attempt = 0;
        attempt < SPAWN_ATTEMPTS;
        attempt++
    ) {
        const x =
            ARENA_MIN +
            Math.random() *
            (
                ARENA_MAX -
                ARENA_MIN
            );

        const z =
            ARENA_MIN +
            Math.random() *
            (
                ARENA_MAX -
                ARENA_MIN
            );

        if (
            spawnIsSafe(
                lobby,
                x,
                z,
                ignoredPlayer
            )
        ) {
            return {
                x,
                y: 1.6,
                z
            };
        }
    }

    let bestSpawn = {
        x: 0,
        y: 1.6,
        z: 0
    };

    let bestDistance = -1;

    for (
        let attempt = 0;
        attempt < 100;
        attempt++
    ) {
        const x =
            ARENA_MIN +
            Math.random() *
            (
                ARENA_MAX -
                ARENA_MIN
            );

        const z =
            ARENA_MIN +
            Math.random() *
            (
                ARENA_MAX -
                ARENA_MIN
            );

        if (
            pointInsideWall(
                x,
                z
            )
        ) {
            continue;
        }

        let closest =
            Infinity;

        for (
            const other
            of lobby.players.values()
        ) {
            if (
                other ===
                ignoredPlayer
            ) {
                continue;
            }

            const distance =
                Math.hypot(
                    x -
                        other.x,
                    z -
                        other.z
                );

            closest =
                Math.min(
                    closest,
                    distance
                );
        }

        if (
            closest >
            bestDistance
        ) {
            bestDistance =
                closest;

            bestSpawn = {
                x,
                y: 1.6,
                z
            };
        }
    }

    return bestSpawn;
}

/*
 * ==========================================
 * UTILS
 * ==========================================
 */

function send(ws, data) {
    if (
        ws &&
        ws.readyState ===
        WebSocket.OPEN
    ) {
        ws.send(
            JSON.stringify(data)
        );
    }
}

function broadcast(
    lobby,
    data
) {
    for (
        const player
        of lobby.players.values()
    ) {
        send(
            player.ws,
            data
        );
    }
}

function randomCode() {
    let code;

    do {
        code =
            Math.random()
                .toString(36)
                .substring(2, 7)
                .toUpperCase();

    } while (
        lobbies.has(code)
    );

    return code;
}

function resetPlayer(player) {
    if (
        !player.lobby
    ) {
        return;
    }

    const spawn =
        randomSpawn(
            player.lobby,
            player
        );

    player.x =
        spawn.x;

    player.y =
        spawn.y;

    player.z =
        spawn.z;

    player.yaw =
        Math.random() *
        Math.PI *
        2;

    player.pitch =
        0;

    player.hp =
        100;
}

function playerInfo(player) {
    return {
        id:
            player.id,

        name:
            player.name,

        x:
            player.x,

        y:
            player.y,

        z:
            player.z,

        yaw:
            player.yaw,

        pitch:
            player.pitch,

        hp:
            player.hp,

        kills:
            player.kills,

        deaths:
            player.deaths,

        ready:
            player.ready
    };
}

function getLobbyInfo(lobby) {
    return {
        code:
            lobby.code,

        name:
            lobby.name,

        killLimit:
            lobby.killLimit,

        hostId:
            lobby.hostId,

        started:
            lobby.started,

        finished:
            lobby.finished,

        players:
            [
                ...lobby.players.values()
            ].map(
                playerInfo
            )
    };
}

function sendLobbyInfo(lobby) {
    broadcast(
        lobby,
        {
            type:
                "lobbyInfo",

            lobby:
                getLobbyInfo(
                    lobby
                )
        }
    );
}

function everyoneReady(lobby) {
    if (
        lobby.players.size === 0
    ) {
        return false;
    }

    for (
        const player
        of lobby.players.values()
    ) {
        if (
            !player.ready
        ) {
            return false;
        }
    }

    return true;
}

function resetScores(lobby) {
    for (
        const player
        of lobby.players.values()
    ) {
        player.kills =
            0;

        player.deaths =
            0;

        player.hp =
            100;

        player.ready =
            false;

        resetPlayer(
            player
        );
    }
}

function checkGameStart(lobby) {
    if (
        lobby.started ||
        lobby.finished
    ) {
        return;
    }

    if (
        !everyoneReady(
            lobby
        )
    ) {
        return;
    }

    lobby.started =
        true;

    resetScores(
        lobby
    );

    broadcast(
        lobby,
        {
            type:
                "gameStart",

            lobby:
                getLobbyInfo(
                    lobby
                ),

            players:
                getLobbyInfo(
                    lobby
                ).players
        }
    );
}

function finishGame(
    lobby,
    winner
) {
    if (
        !lobby.started
    ) {
        return;
    }

    lobby.started =
        false;

    lobby.finished =
        true;

    broadcast(
        lobby,
        {
            type:
                "gameOver",

            winner:
                winner.id,

            winnerName:
                winner.name,

            kills:
                winner.kills,

            killLimit:
                lobby.killLimit,

            players:
                getLobbyInfo(
                    lobby
                ).players
        }
    );

    setTimeout(
        () => {
            if (
                !lobbies.has(
                    lobby.code
                )
            ) {
                return;
            }

            lobby.finished =
                false;

            for (
                const player
                of lobby.players.values()
            ) {
                player.ready =
                    false;

                player.hp =
                    100;

                resetPlayer(
                    player
                );
            }

            sendLobbyInfo(
                lobby
            );
        },
        5000
    );
}

function removePlayer(ws) {
    const player =
        ws.player;

    if (
        !player ||
        !player.lobby
    ) {
        return;
    }

    const lobby =
        player.lobby;

    lobby.players.delete(
        player.id
    );

    player.lobby =
        null;

    broadcast(
        lobby,
        {
            type:
                "playerLeft",

            id:
                player.id
        }
    );

    if (
        lobby.players.size === 0
    ) {
        lobbies.delete(
            lobby.code
        );

        return;
    }

    if (
        lobby.hostId ===
        player.id
    ) {
        const newHost =
            lobby.players
                .values()
                .next()
                .value;

        if (newHost) {
            lobby.hostId =
                newHost.id;

            broadcast(
                lobby,
                {
                    type:
                        "newHost",

                    hostId:
                        newHost.id
                }
            );
        }
    }

    sendLobbyInfo(
        lobby
    );
}

function number(value) {
    return (
        typeof value === "number" &&
        Number.isFinite(value)
    );
}

function clamp(
    value,
    min,
    max
) {
    return Math.max(
        min,
        Math.min(
            max,
            value
        )
    );
}

function direction(
    yaw,
    pitch
) {
    const cp =
        Math.cos(
            pitch
        );

    return {
        x:
            -Math.sin(yaw) *
            cp,

        y:
            Math.sin(pitch),

        z:
            -Math.cos(yaw) *
            cp
    };
}

function distance(a, b) {
    return Math.hypot(
        a.x - b.x,
        a.y - b.y,
        a.z - b.z
    );
}

function rayHitsPlayer(
    shooter,
    target
) {
    const dir =
        direction(
            shooter.yaw,
            shooter.pitch
        );

    const targetX =
        target.x;

    const targetY =
        target.y - 0.55;

    const targetZ =
        target.z;

    const vx =
        targetX -
        shooter.x;

    const vy =
        targetY -
        shooter.y;

    const vz =
        targetZ -
        shooter.z;

    const along =
        vx * dir.x +
        vy * dir.y +
        vz * dir.z;

    if (
        along < 0 ||
        along > 100
    ) {
        return false;
    }

    const closestX =
        shooter.x +
        dir.x *
        along;

    const closestY =
        shooter.y +
        dir.y *
        along;

    const closestZ =
        shooter.z +
        dir.z *
        along;

    const miss =
        Math.hypot(
            targetX -
                closestX,

            targetY -
                closestY,

            targetZ -
                closestZ
        );

    return (
        miss <=
        0.85
    );
}

/*
 * ==========================================
 * WEBSOCKET CONNECTION
 * ==========================================
 */

wss.on(
    "connection",
    ws => {
        const player = {
            ws,

            id:
                nextPlayerId++,

            name:
                "Player",

            lobby:
                null,

            x:
                0,

            y:
                1.6,

            z:
                0,

            yaw:
                0,

            pitch:
                0,

            hp:
                100,

            kills:
                0,

            deaths:
                0,

            ready:
                false,

            lastShot:
                0
        };

        ws.player =
            player;

        send(
            ws,
            {
                type:
                    "connected",

                id:
                    player.id
            }
        );

        ws.on(
            "message",
            raw => {
                let data;

                try {
                    data =
                        JSON.parse(
                            raw.toString()
                        );
                } catch {
                    return;
                }

                /*
                 * CREATE LOBBY
                 */

                if (
                    data.type ===
                    "createLobby"
                ) {
                    removePlayer(
                        ws
                    );

                    let killLimit =
                        Number(
                            data.killLimit
                        );

                    if (
                        !ALLOWED_KILL_LIMITS.includes(
                            killLimit
                        )
                    ) {
                        killLimit =
                            10;
                    }

                    const lobby = {
                        code:
                            randomCode(),

                        name:
                            String(
                                data.name ||
                                "FPS Lobby"
                            ).substring(
                                0,
                                30
                            ),

                        killLimit:
                            killLimit,

                        hostId:
                            player.id,

                        players:
                            new Map(),

                        started:
                            false,

                        finished:
                            false
                    };

                    lobbies.set(
                        lobby.code,
                        lobby
                    );

                    player.name =
                        String(
                            data.playerName ||
                            "Player"
                        ).substring(
                            0,
                            20
                        );

                    player.ready =
                        false;

                    player.lobby =
                        lobby;

                    resetPlayer(
                        player
                    );

                    lobby.players.set(
                        player.id,
                        player
                    );

                    send(
                        ws,
                        {
                            type:
                                "joined",

                            id:
                                player.id,

                            lobby:
                                getLobbyInfo(
                                    lobby
                                )
                        }
                    );

                    sendLobbyInfo(
                        lobby
                    );

                    return;
                }

                /*
                 * JOIN LOBBY
                 */

                if (
                    data.type ===
                    "joinLobby"
                ) {
                    removePlayer(
                        ws
                    );

                    const code =
                        String(
                            data.code ||
                            ""
                        )
                            .trim()
                            .toUpperCase();

                    const lobby =
                        lobbies.get(
                            code
                        );

                    if (!lobby) {
                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Nie znaleziono lobby."
                            }
                        );

                        return;
                    }

                    if (
                        lobby.started ||
                        lobby.finished
                    ) {
                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Ta runda jest już zakończona lub trwa."
                            }
                        );

                        return;
                    }

                    if (
                        lobby.players.size >=
                        16
                    ) {
                        send(
                            ws,
                            {
                                type:
                                    "error",

                                message:
                                    "Lobby jest pełne."
                            }
                        );

                        return;
                    }

                    player.name =
                        String(
                            data.playerName ||
                            "Player"
                        ).substring(
                            0,
                            20
                        );

                    player.ready =
                        false;

                    player.lobby =
                        lobby;

                    resetPlayer(
                        player
                    );

                    lobby.players.set(
                        player.id,
                        player
                    );

                    send(
                        ws,
                        {
                            type:
                                "joined",

                            id:
                                player.id,

                            lobby:
                                getLobbyInfo(
                                    lobby
                                )
                        }
                    );

                    sendLobbyInfo(
                        lobby
                    );

                    return;
                }

                /*
                 * READY
                 */

                if (
                    data.type ===
                    "ready"
                ) {
                    if (
                        !player.lobby ||
                        player.lobby.started ||
                        player.lobby.finished
                    ) {
                        return;
                    }

                    player.ready =
                        !player.ready;

                    sendLobbyInfo(
                        player.lobby
                    );

                    checkGameStart(
                        player.lobby
                    );

                    return;
                }

                /*
                 * UPDATE
                 */

                if (
                    data.type ===
                    "update"
                ) {
                    if (
                        !player.lobby ||
                        !player.lobby.started
                    ) {
                        return;
                    }

                    if (
                        number(
                            data.x
                        )
                    ) {
                        player.x =
                            clamp(
                                data.x,
                                -18.5,
                                18.5
                            );
                    }

                    if (
                        number(
                            data.y
                        )
                    ) {
                        player.y =
                            clamp(
                                data.y,
                                1.6,
                                30
                            );
                    }

                    if (
                        number(
                            data.z
                        )
                    ) {
                        player.z =
                            clamp(
                                data.z,
                                -18.5,
                                18.5
                            );
                    }

                    if (
                        number(
                            data.yaw
                        )
                    ) {
                        player.yaw =
                            data.yaw;
                    }

                    if (
                        number(
                            data.pitch
                        )
                    ) {
                        player.pitch =
                            clamp(
                                data.pitch,
                                -1.5,
                                1.5
                            );
                    }

                    broadcast(
                        player.lobby,
                        {
                            type:
                                "playerUpdate",

                            id:
                                player.id,

                            x:
                                player.x,

                            y:
                                player.y,

                            z:
                                player.z,

                            yaw:
                                player.yaw,

                            pitch:
                                player.pitch
                        }
                    );

                    return;
                }

                /*
                 * SHOOT
                 */

                if (
                    data.type ===
                    "shoot"
                ) {
                    if (
                        !player.lobby ||
                        !player.lobby.started
                    ) {
                        return;
                    }

                    const now =
                        Date.now();

                    if (
                        now -
                        player.lastShot <
                        150
                    ) {
                        return;
                    }

                    player.lastShot =
                        now;

                    broadcast(
                        player.lobby,
                        {
                            type:
                                "shot",

                            id:
                                player.id,

                            x:
                                player.x,

                            y:
                                player.y,

                            z:
                                player.z,

                            yaw:
                                player.yaw,

                            pitch:
                                player.pitch
                        }
                    );

                    let target =
                        null;

                    let bestDistance =
                        Infinity;

                    for (
                        const other
                        of player.lobby.players.values()
                    ) {
                        if (
                            other.id ===
                            player.id
                        ) {
                            continue;
                        }

                        if (
                            other.hp <= 0
                        ) {
                            continue;
                        }

                        if (
                            rayHitsPlayer(
                                player,
                                other
                            )
                        ) {
                            const d =
                                distance(
                                    player,
                                    other
                                );

                            if (
                                d <
                                bestDistance
                            ) {
                                bestDistance =
                                    d;

                                target =
                                    other;
                            }
                        }
                    }

                    if (!target) {
                        return;
                    }

                    target.hp -=
                        25;

                    broadcast(
                        player.lobby,
                        {
                            type:
                                "damage",

                            target:
                                target.id,

                            attacker:
                                player.id,

                            hp:
                                Math.max(
                                    0,
                                    target.hp
                                )
                        }
                    );

                    if (
                        target.hp <= 0
                    ) {
                        player.kills++;

                        target.deaths++;

                        const victimId =
                            target.id;

                        const killerName =
                            player.name;

                        const victimName =
                            target.name;

                        resetPlayer(
                            target
                        );

                        broadcast(
                            player.lobby,
                            {
                                type:
                                    "kill",

                                killer:
                                    player.id,

                                killerName:
                                    killerName,

                                victim:
                                    victimId,

                                victimName:
                                    victimName,

                                players:
                                    getLobbyInfo(
                                        player.lobby
                                    ).players
                            }
                        );

                        send(
                            target.ws,
                            {
                                type:
                                    "respawn",

                                x:
                                    target.x,

                                y:
                                    target.y,

                                z:
                                    target.z,

                                hp:
                                    100
                            }
                        );

                        if (
                            player.kills >=
                            player.lobby.killLimit
                        ) {
                            finishGame(
                                player.lobby,
                                player
                            );
                        } else {
                            sendLobbyInfo(
                                player.lobby
                            );
                        }
                    }

                    return;
                }

                /*
                 * LEAVE
                 */

                if (
                    data.type ===
                    "leave"
                ) {
                    removePlayer(
                        ws
                    );

                    return;
                }
            }
        );

        ws.on(
            "close",
            () => {
                removePlayer(
                    ws
                );
            }
        );
    }
);

/*
 * ==========================================
 * START SERVER
 * ==========================================
 */

server.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log(
            "======================================"
        );

        console.log(
            "              NEXAR FPS"
        );

        console.log(
            "======================================"
        );

        console.log(
            `Server listening on port ${PORT}`
        );

        console.log(
            "Environment:",
            process.env.NODE_ENV ||
            "development"
        );

        console.log(
            "======================================"
        );
    }
);

