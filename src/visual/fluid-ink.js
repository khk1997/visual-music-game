import * as THREE from 'three';

import { getEffectColor } from './piano-roll-bars.js';

// 流體墨水視覺系統：低解析網格 stable fluids（半拉格朗日平流 + Jacobi 投影 + 渦度增強）。
// 染料場逐幀寫進 NX×NY 的 offscreen canvas，用 CanvasTexture 貼到全螢幕 plane，
// 放大交給 GPU 的 LinearFilter，每幀 CPU→GPU 只上傳一張低解析度小貼圖。
const GRID_HEIGHT = 120;
const PROJECT_ITERS = 12;
const DIFFUSE_ITERS = 4;
const VISCOSITY = 0.12;          // 越高流動越黏稠、擴散越慢
const CURL_STRENGTH = 0.5;       // 渦度增強量：小漩渦細節（過高會馬上捲成漩渦）
const VELOCITY_HALF_LIFE = 0.5;  // 秒：速度場衰減半衰期（控制墨流「衝多久」）
const DYE_HALF_LIFE = 1.1;       // 秒：染料濃度半衰期（控制墨水多快消失）
const BRIGHTNESS = 2.4;
const SHADING = 0.32;            // 依密度梯度做假光照，給墨水立體感

export function createFluidInkSystem({ scene, camera, planeZ = -1.5, renderOrder = 1 }) {
    let NX = 0;
    let NY = 0;
    let CELLS = 0;
    let u, v, u2, v2, prs, prs2, div;
    let dr, dg, db, dr2, dg2, db2;

    const simCanvas = document.createElement('canvas');
    const simCtx = simCanvas.getContext('2d');
    let simImg = null;

    let viewWidth = 0;
    let viewHeight = 0;

    const texture = new THREE.CanvasTexture(simCanvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.position.set(0, 0, planeZ);
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);

    // key(`${source}:${midi}`) → 按住期間持續注入的墨水流
    const heldNotes = new Map();
    // 按下瞬間的噴射：拉長成短時間的連續注入，形成「頭部 + 尾柱」的墨柱
    const activeBursts = [];
    const BURST_DURATION = 0.2;
    let simTime = 0;

    function computeViewSize() {
        const aspect = window.innerWidth / window.innerHeight;
        const fov = camera.fov * Math.PI / 180;
        const distance = camera.position.z - planeZ;
        viewHeight = 2 * Math.tan(fov / 2) * distance;
        viewWidth = viewHeight * aspect;
    }

    function allocGrid() {
        computeViewSize();
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(viewWidth, viewHeight);

        const gh = GRID_HEIGHT;
        const gw = Math.max(16, Math.round(gh * viewWidth / viewHeight));
        if (gw === NX && gh === NY) return;
        NX = gw;
        NY = gh;
        CELLS = NX * NY;
        u = new Float32Array(CELLS); v = new Float32Array(CELLS);
        u2 = new Float32Array(CELLS); v2 = new Float32Array(CELLS);
        prs = new Float32Array(CELLS); prs2 = new Float32Array(CELLS);
        div = new Float32Array(CELLS);
        dr = new Float32Array(CELLS); dg = new Float32Array(CELLS); db = new Float32Array(CELLS);
        dr2 = new Float32Array(CELLS); dg2 = new Float32Array(CELLS); db2 = new Float32Array(CELLS);
        simCanvas.width = NX;
        simCanvas.height = NY;
        simImg = simCtx.createImageData(NX, NY);
        const d = simImg.data;
        for (let i = 3; i < d.length; i += 4) d[i] = 255;
    }

    const IX = (x, y) => x + y * NX;

    function sample(f, x, y) {
        if (x < 0.5) x = 0.5; else if (x > NX - 1.5) x = NX - 1.5;
        if (y < 0.5) y = 0.5; else if (y > NY - 1.5) y = NY - 1.5;
        const x0 = x | 0, y0 = y | 0;
        const tx = x - x0, ty = y - y0;
        const i00 = IX(x0, y0), i10 = i00 + 1, i01 = i00 + NX, i11 = i01 + 1;
        const a = f[i00] + (f[i10] - f[i00]) * tx;
        const b = f[i01] + (f[i11] - f[i01]) * tx;
        return a + (b - a) * ty;
    }

    function advect(src, dst, dt, decay) {
        for (let y = 1; y < NY - 1; y++) {
            for (let x = 1; x < NX - 1; x++) {
                const i = IX(x, y);
                dst[i] = sample(src, x - dt * u[i], y - dt * v[i]) * decay;
            }
        }
    }

    function diffuse(f, tmp, a, iters) {
        const c = 1 / (1 + 4 * a);
        tmp.set(f);
        let src = f, dst = tmp;
        for (let k = 0; k < iters; k++) {
            for (let y = 1; y < NY - 1; y++) {
                for (let x = 1; x < NX - 1; x++) {
                    const i = IX(x, y);
                    dst[i] = (f[i] + a * (src[i - 1] + src[i + 1] + src[i - NX] + src[i + NX])) * c;
                }
            }
            const t = src; src = dst; dst = t;
        }
        if (src !== f) f.set(src);
    }

    function project(iters) {
        for (let y = 1; y < NY - 1; y++) {
            for (let x = 1; x < NX - 1; x++) {
                const i = IX(x, y);
                div[i] = -0.5 * (u[i + 1] - u[i - 1] + v[i + NX] - v[i - NX]);
                prs[i] = 0;
            }
        }
        let src = prs, dst = prs2;
        for (let k = 0; k < iters; k++) {
            for (let y = 1; y < NY - 1; y++) {
                for (let x = 1; x < NX - 1; x++) {
                    const i = IX(x, y);
                    dst[i] = (div[i] + src[i - 1] + src[i + 1] + src[i - NX] + src[i + NX]) * 0.25;
                }
            }
            const t = src; src = dst; dst = t;
        }
        for (let y = 1; y < NY - 1; y++) {
            for (let x = 1; x < NX - 1; x++) {
                const i = IX(x, y);
                u[i] -= 0.5 * (src[i + 1] - src[i - 1]);
                v[i] -= 0.5 * (src[i + NX] - src[i - NX]);
            }
        }
    }

    // 渦度增強：把數值耗散掉的小漩渦補回來（curl 暫存進閒置的 prs2）
    function vorticity(dt) {
        const crl = prs2;
        for (let y = 1; y < NY - 1; y++) {
            for (let x = 1; x < NX - 1; x++) {
                const i = IX(x, y);
                crl[i] = 0.5 * (v[i + 1] - v[i - 1] - u[i + NX] + u[i - NX]);
            }
        }
        for (let y = 2; y < NY - 2; y++) {
            for (let x = 2; x < NX - 2; x++) {
                const i = IX(x, y);
                let gx = 0.5 * (Math.abs(crl[i + 1]) - Math.abs(crl[i - 1]));
                let gy = 0.5 * (Math.abs(crl[i + NX]) - Math.abs(crl[i - NX]));
                const len = Math.sqrt(gx * gx + gy * gy) + 1e-5;
                gx /= len; gy /= len;
                const c = crl[i];
                u[i] += gy * c * CURL_STRENGTH * dt;
                v[i] += -gx * c * CURL_STRENGTH * dt;
            }
        }
    }

    function setBounds() {
        for (let x = 0; x < NX; x++) {
            u[IX(x, 0)] = v[IX(x, 0)] = 0;
            u[IX(x, NY - 1)] = v[IX(x, NY - 1)] = 0;
        }
        for (let y = 0; y < NY; y++) {
            u[IX(0, y)] = v[IX(0, y)] = 0;
            u[IX(NX - 1, y)] = v[IX(NX - 1, y)] = 0;
        }
    }

    function splat(gx, gy, du, dv, cr, cg, cb, radiusCells) {
        const r2 = radiusCells * radiusCells;
        const x0 = Math.max(1, Math.floor(gx - radiusCells * 2));
        const x1 = Math.min(NX - 2, Math.ceil(gx + radiusCells * 2));
        const y0 = Math.max(1, Math.floor(gy - radiusCells * 2));
        const y1 = Math.min(NY - 2, Math.ceil(gy + radiusCells * 2));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x - gx, dy = y - gy;
                const w = Math.exp(-(dx * dx + dy * dy) / r2);
                if (w < 0.01) continue;
                const i = IX(x, y);
                u[i] += du * w;
                v[i] += dv * w;
                dr[i] += cr * w;
                dg[i] += cg * w;
                db[i] += cb * w;
            }
        }
    }

    // 世界座標（plane 上）→ 模擬網格座標。網格 y 軸朝下，世界 y 軸朝上。
    function worldToGrid(x, y) {
        return {
            gx: (x / viewWidth + 0.5) * NX,
            gy: (0.5 - y / viewHeight) * NY
        };
    }

    function step(dtSeconds) {
        const dt = Math.min(dtSeconds, 0.05) * 60; // 模擬以 60fps 幀為步長單位

        vorticity(dt);

        const a = dt * VISCOSITY;
        diffuse(u, u2, a, DIFFUSE_ITERS);
        diffuse(v, v2, a, DIFFUSE_ITERS);

        setBounds();
        project(PROJECT_ITERS);

        u2.set(u); v2.set(v);
        const velDecay = Math.pow(0.5, dtSeconds / VELOCITY_HALF_LIFE);
        for (let y = 1; y < NY - 1; y++) {
            for (let x = 1; x < NX - 1; x++) {
                const i = IX(x, y);
                const bx = x - dt * u2[i];
                const by = y - dt * v2[i];
                u[i] = sample(u2, bx, by) * velDecay;
                v[i] = sample(v2, bx, by) * velDecay;
            }
        }
        setBounds();
        project(PROJECT_ITERS);

        const dyeDecay = Math.pow(0.5, dtSeconds / DYE_HALF_LIFE);
        advect(dr, dr2, dt, dyeDecay);
        advect(dg, dg2, dt, dyeDecay);
        advect(db, db2, dt, dyeDecay);
        let t;
        t = dr; dr = dr2; dr2 = t;
        t = dg; dg = dg2; dg2 = t;
        t = db; db = db2; db2 = t;
    }

    function render() {
        const d = simImg.data;
        const k = BRIGHTNESS;
        // 光源方向（左上），沿密度梯度做簡單 diffuse，讓墨團有立體層次
        const lx = -0.707, ly = -0.707;
        for (let y = 0; y < NY; y++) {
            for (let x = 0; x < NX; x++) {
                const i = IX(x, y);
                const j = i * 4;
                const xl = x > 0 ? i - 1 : i;
                const xr = x < NX - 1 ? i + 1 : i;
                const yu = y > 0 ? i - NX : i;
                const yd = y < NY - 1 ? i + NX : i;
                const gxd = (dr[xr] + dg[xr] + db[xr]) - (dr[xl] + dg[xl] + db[xl]);
                const gyd = (dr[yd] + dg[yd] + db[yd]) - (dr[yu] + dg[yu] + db[yu]);
                let light = 1 - (gxd * lx + gyd * ly) * SHADING;
                if (light < 0.55) light = 0.55; else if (light > 1.45) light = 1.45;

                // 軟性 tone-map：1 - e^(-x)，高濃度不會死白
                d[j] = (1 - Math.exp(-dr[i] * k)) * 255 * light;
                d[j + 1] = (1 - Math.exp(-dg[i] * k)) * 255 * light;
                d[j + 2] = (1 - Math.exp(-db[i] * k)) * 255 * light;
            }
        }
        simCtx.putImageData(simImg, 0, 0);
        texture.needsUpdate = true;
    }

    function noteOn(key, worldX, worldY, midi, intensity = 0.85, sustained = false) {
        if (!CELLS) return;
        const { gx, gy } = worldToGrid(worldX, worldY);
        const color = getEffectColor(midi);
        const note = {
            gx,
            gy,
            r: color.r,
            g: color.g,
            b: color.b,
            intensity,
            phase: Math.random() * Math.PI * 2
        };
        // 一次性觸發（滑鼠點擊、tap 音色、回放短音）沒有對應的 noteOff，
        // 只有 sustained 的音才註冊持續墨流，否則墨流會永遠停不下來。
        if (sustained) {
            heldNotes.set(key, note);
        }
        activeBursts.push({
            gx,
            gy,
            r: note.r,
            g: note.g,
            b: note.b,
            power: 0.6 + intensity * 0.8,
            remaining: BURST_DURATION
        });
    }

    function noteOff(key) {
        heldNotes.delete(key);
    }

    function noteOffByPrefix(prefix) {
        for (const key of Array.from(heldNotes.keys())) {
            if (key.startsWith(prefix)) {
                heldNotes.delete(key);
            }
        }
    }

    function stopAllNotes() {
        heldNotes.clear();
    }

    function clear() {
        stopAllNotes();
        activeBursts.length = 0;
        if (!CELLS) return;
        u.fill(0); v.fill(0); prs.fill(0);
        dr.fill(0); dg.fill(0); db.fill(0);
        render();
    }

    function update(deltaSeconds) {
        if (!mesh.visible || !CELLS) return;
        simTime += deltaSeconds;

        // 噴射柱：窄口徑 + 高速連續注入，形成有頭有尾的墨柱
        const jetRad = 0.014 * NY;
        for (let i = activeBursts.length - 1; i >= 0; i--) {
            const burst = activeBursts[i];
            // 頭部衝力最強，往尾端漸弱
            const falloff = burst.remaining / BURST_DURATION;
            const thrust = (1.8 + 2.2 * falloff) * burst.power;
            const dye = 0.25 * burst.power * (0.55 + 0.45 * falloff);
            splat(
                burst.gx, burst.gy - jetRad,
                0, -thrust,
                burst.r * dye, burst.g * dye, burst.b * dye,
                jetRad
            );
            burst.remaining -= deltaSeconds;
            if (burst.remaining <= 0) {
                activeBursts.splice(i, 1);
            }
        }

        // 按住的音持續注入細墨流，左右輕微擺動讓煙柱更自然
        const rad = 0.018 * NY;
        for (const note of heldNotes.values()) {
            const wobble = Math.sin(simTime * 3 + note.phase) * 0.15;
            splat(
                note.gx, note.gy - rad,
                wobble, -0.45,
                note.r * 0.1, note.g * 0.1, note.b * 0.1,
                rad
            );
        }

        step(deltaSeconds);
        render();
    }

    function setVisible(visible) {
        mesh.visible = visible;
    }

    function handleResize() {
        allocGrid();
    }

    allocGrid();

    return {
        clear,
        handleResize,
        noteOff,
        noteOffByPrefix,
        noteOn,
        setVisible,
        stopAllNotes,
        update
    };
}
