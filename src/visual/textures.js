import * as THREE from 'three';

export function createPS5Textures() {
    function makeCanvas() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.lineCap = 'round';
        return { canvas, ctx };
    }

    function drawSparkShapes(ctx, x, c, lw, sb) {
        ctx.save();
        ctx.translate(x, 64);
        ctx.shadowColor = c;
        ctx.shadowBlur = sb;
        ctx.strokeStyle = c;
        ctx.lineWidth = lw;

        // 底層加一圈較淡的粗描邊，做出一點厚度感
        ctx.globalAlpha = 0.38;
        ctx.lineWidth = lw + 4;
        if (x === 64) {
            ctx.beginPath();
            ctx.moveTo(-30, -30);
            ctx.lineTo(30, 30);
            ctx.moveTo(30, -30);
            ctx.lineTo(-30, 30);
            ctx.stroke();
        }
        if (x === 192) {
            ctx.beginPath();
            ctx.arc(0, 0, 35, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (x === 320) {
            ctx.beginPath();
            ctx.moveTo(0, -35);
            ctx.lineTo(-35, 30);
            ctx.lineTo(35, 30);
            ctx.closePath();
            ctx.stroke();
        }
        if (x === 448) {
            ctx.beginPath();
            ctx.rect(-30, -30, 60, 60);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
        ctx.lineWidth = lw;
        if (x === 64) {
            ctx.beginPath();
            ctx.moveTo(-30, -30);
            ctx.lineTo(30, 30);
            ctx.moveTo(30, -30);
            ctx.lineTo(-30, 30);
            ctx.stroke();
        }
        if (x === 192) {
            ctx.beginPath();
            ctx.arc(0, 0, 35, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (x === 320) {
            ctx.beginPath();
            ctx.moveTo(0, -35);
            ctx.lineTo(-35, 30);
            ctx.lineTo(35, 30);
            ctx.closePath();
            ctx.stroke();
        }
        if (x === 448) {
            ctx.beginPath();
            ctx.rect(-30, -30, 60, 60);
            ctx.stroke();
        }

        ctx.restore();
    }

    function carveHollowShape(ctx, x) {
        if (x === 64) {
            ctx.beginPath();
            ctx.moveTo(-20, -20);
            ctx.lineTo(20, 20);
            ctx.moveTo(20, -20);
            ctx.lineTo(-20, 20);
            ctx.stroke();
        }
        if (x === 192) {
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (x === 320) {
            ctx.beginPath();
            ctx.moveTo(0, -23);
            ctx.lineTo(-21, 16);
            ctx.lineTo(21, 16);
            ctx.closePath();
            ctx.stroke();
        }
        if (x === 448) {
            ctx.beginPath();
            ctx.rect(-18, -18, 36, 36);
            ctx.stroke();
        }
    }

    function drawBackgroundShapes(ctx, x, fillColor) {
        ctx.save();
        ctx.translate(x, 64);
        ctx.shadowColor = fillColor;
        ctx.shadowBlur = 10;
        ctx.fillStyle = fillColor;

        ctx.beginPath();
        ctx.arc(0, 0, 31, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 7;
        carveHollowShape(ctx, x);
        ctx.restore();
    }

    const { canvas: cC, ctx: cCtx } = makeCanvas();
    drawSparkShapes(cCtx, 64, '#00d2ff', 8.8, 13);
    drawSparkShapes(cCtx, 192, '#ff355e', 8.8, 13);
    drawSparkShapes(cCtx, 320, '#00ff85', 8.8, 13);
    drawSparkShapes(cCtx, 448, '#ff67e2', 8.8, 13);
    const sparkTex = new THREE.CanvasTexture(cC);

    const { canvas: bgC, ctx: bgCtx } = makeCanvas();
    drawBackgroundShapes(bgCtx, 64, '#ffffff');
    drawBackgroundShapes(bgCtx, 192, '#ffffff');
    drawBackgroundShapes(bgCtx, 320, '#ffffff');
    drawBackgroundShapes(bgCtx, 448, '#ffffff');
    const bgTex = new THREE.CanvasTexture(bgC);

    const mistCanvas = document.createElement('canvas');
    mistCanvas.width = 128;
    mistCanvas.height = 128;
    const mistCtx = mistCanvas.getContext('2d');
    const mistGradient = mistCtx.createRadialGradient(64, 64, 0, 64, 64, 64);
    mistGradient.addColorStop(0, 'rgba(255,255,255,0.95)');
    mistGradient.addColorStop(0.32, 'rgba(255,255,255,0.38)');
    mistGradient.addColorStop(0.65, 'rgba(255,255,255,0.1)');
    mistGradient.addColorStop(1, 'rgba(255,255,255,0)');
    mistCtx.fillStyle = mistGradient;
    mistCtx.beginPath();
    mistCtx.arc(64, 64, 64, 0, Math.PI * 2);
    mistCtx.fill();
    const mistTex = new THREE.CanvasTexture(mistCanvas);

    return { sparkTex, bgTex, mistTex };
}

export function createHaloTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(0.18, 'rgba(255,255,255,0.76)');
    gradient.addColorStop(0.34, 'rgba(255,255,255,0.28)');
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(128, 128, 128, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}

export function createPianoRollBarTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    gradient.addColorStop(0, 'rgba(0, 210, 255, 0.0)');
    gradient.addColorStop(0.14, 'rgba(0, 210, 255, 0.14)');
    gradient.addColorStop(0.52, 'rgba(116, 211, 255, 0.72)');
    gradient.addColorStop(0.9, 'rgba(183, 235, 255, 0.92)');
    gradient.addColorStop(0.985, 'rgba(228, 248, 255, 0.82)');
    gradient.addColorStop(1, 'rgba(228, 248, 255, 0.58)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const horizontalMask = ctx.createLinearGradient(0, 0, canvas.width, 0);
    horizontalMask.addColorStop(0, 'rgba(255,255,255,0)');
    horizontalMask.addColorStop(0.07, 'rgba(255,255,255,0.015)');
    horizontalMask.addColorStop(0.16, 'rgba(255,255,255,0.06)');
    horizontalMask.addColorStop(0.28, 'rgba(255,255,255,0.16)');
    horizontalMask.addColorStop(0.4, 'rgba(255,255,255,0.34)');
    horizontalMask.addColorStop(0.48, 'rgba(255,255,255,0.52)');
    horizontalMask.addColorStop(0.5, 'rgba(255,255,255,0.58)');
    horizontalMask.addColorStop(0.52, 'rgba(255,255,255,0.52)');
    horizontalMask.addColorStop(0.6, 'rgba(255,255,255,0.34)');
    horizontalMask.addColorStop(0.72, 'rgba(255,255,255,0.16)');
    horizontalMask.addColorStop(0.84, 'rgba(255,255,255,0.06)');
    horizontalMask.addColorStop(0.93, 'rgba(255,255,255,0.015)');
    horizontalMask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = horizontalMask;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    const coreGradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
    coreGradient.addColorStop(0, 'rgba(255,255,255,0)');
    coreGradient.addColorStop(0.18, 'rgba(70, 227, 255, 0.08)');
    coreGradient.addColorStop(0.56, 'rgba(180, 244, 255, 0.32)');
    coreGradient.addColorStop(0.9, 'rgba(255,255,255,0.18)');
    coreGradient.addColorStop(1, 'rgba(255,255,255,0.1)');
    ctx.fillStyle = coreGradient;
    ctx.fillRect(canvas.width * 0.36, 0, canvas.width * 0.28, canvas.height);

    const glowX = canvas.width * 0.5;
    const glowY = 30;
    const glowRadius = 48;
    const glow = ctx.createRadialGradient(glowX, glowY, 0, glowX, glowY, glowRadius);
    glow.addColorStop(0, 'rgba(255,255,255,0.62)');
    glow.addColorStop(0.5, 'rgba(164,230,255,0.26)');
    glow.addColorStop(1, 'rgba(164,230,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(glowX, glowY, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}
