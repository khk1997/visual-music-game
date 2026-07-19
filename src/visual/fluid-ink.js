import * as THREE from 'three';

import { getEffectColor } from './piano-roll-bars.js';

// 流體墨水視覺系統（GPU 版）：速度場/壓力場/染料場全部存在 half-float render target 上，
// 平流、投影（Jacobi）、渦度增強都在 fragment shader 裡算，CPU 只負責丟 splat 座標與參數。
// 解析度可以開比 CPU 版高很多，並加了一層 bloom 讓亮部有發光的墨水質感。
const SIM_HEIGHT = 200;      // 速度/壓力場解析度（物理用，低一點就夠）
const DYE_HEIGHT = 640;      // 染料場解析度（決定視覺銳利度，跟速度場分開）
const BLOOM_HEIGHT = 100;    // bloom 取樣解析度（越低越柔）
const PRESSURE_ITERATIONS = 24;
const PRESSURE_WARM_START = 0.85; // 每步保留多少舊壓力場當初始值，加速收斂
const CURL_STRENGTH = 1.2;        // 渦度增強量：小漩渦細節（過高會馬上捲成漩渦）
const VELOCITY_HALF_LIFE = 0.85;  // 秒：速度場衰減半衰期（控制墨流「衝多久」）
const DYE_HALF_LIFE = 1.3;        // 秒：染料濃度半衰期（控制墨水多快消失）
const BUOYANCY = 0.12;            // 浮力：染料濃的地方持續緩慢上飄（UV/秒²）
const EXPOSURE = 2.1;
const BLOOM_THRESHOLD = 0.22;
const BLOOM_INTENSITY = 0.9;

const BASE_VERTEX = /* glsl */`
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const SPLAT_FRAGMENT = /* glsl */`
    uniform sampler2D uTarget;
    uniform float uAspect;
    uniform vec2 uPoint;
    uniform vec3 uValue;
    uniform float uRadius;
    varying vec2 vUv;
    void main() {
        vec2 p = vUv - uPoint;
        p.x *= uAspect;
        float w = exp(-dot(p, p) / uRadius);
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + uValue * w, 1.0);
    }
`;

const ADVECTION_FRAGMENT = /* glsl */`
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform float uDt;
    uniform float uDissipation;
    varying vec2 vUv;
    void main() {
        vec2 vel = texture2D(uVelocity, vUv).xy;
        vec2 coord = vUv - uDt * vel;
        gl_FragColor = texture2D(uSource, coord) * uDissipation;
    }
`;

const DIVERGENCE_FRAGMENT = /* glsl */`
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    varying vec2 vUv;
    void main() {
        float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;
        float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;
        float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;
        gl_FragColor = vec4(0.5 * ((R - L) + (T - B)), 0.0, 0.0, 1.0);
    }
`;

const CURL_FRAGMENT = /* glsl */`
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    varying vec2 vUv;
    void main() {
        float L = texture2D(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).y;
        float R = texture2D(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).y;
        float B = texture2D(uVelocity, vUv - vec2(0.0, uTexelSize.y)).x;
        float T = texture2D(uVelocity, vUv + vec2(0.0, uTexelSize.y)).x;
        gl_FragColor = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
    }
`;

const VORTICITY_FRAGMENT = /* glsl */`
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform vec2 uTexelSize;
    uniform float uCurlStrength;
    uniform float uDt;
    varying vec2 vUv;
    void main() {
        float L = texture2D(uCurl, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uCurl, vUv + vec2(uTexelSize.x, 0.0)).x;
        float B = texture2D(uCurl, vUv - vec2(0.0, uTexelSize.y)).x;
        float T = texture2D(uCurl, vUv + vec2(0.0, uTexelSize.y)).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 1e-5;
        force *= uCurlStrength * C;
        force.y *= -1.0;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * uDt, 0.0, 1.0);
    }
`;

const PRESSURE_FRAGMENT = /* glsl */`
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    uniform vec2 uTexelSize;
    varying vec2 vUv;
    void main() {
        float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
        float div = texture2D(uDivergence, vUv).x;
        gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
    }
`;

const BUOYANCY_FRAGMENT = /* glsl */`
    uniform sampler2D uVelocity;
    uniform sampler2D uDye;
    uniform float uBuoyancy;
    uniform float uDt;
    uniform float uTime;
    varying vec2 vUv;

    // 程序化 value noise：讓浮力帶亂流擾動，墨雲上飄時會翻滾出不規則形狀
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
            u.y
        );
    }

    void main() {
        vec2 vel = texture2D(uVelocity, vUv).xy;
        vec3 dye = texture2D(uDye, vUv).rgb;
        float density = max(dye.r, max(dye.g, dye.b));

        // 兩層 noise：低頻大尺度翻滾 + 高頻小碎紋，並隨時間緩慢漂移
        vec2 np = vUv * 9.0 + vec2(0.0, -uTime * 0.35);
        float n1 = noise(np) * 0.65 + noise(np * 2.7 + 13.7) * 0.35;
        vec2 np2 = vUv * 14.0 + vec2(uTime * 0.22, -uTime * 0.4);
        float n2 = noise(np2);

        // 垂直浮力隨 noise 起伏（0.4~1.6 倍），水平方向給小側推讓雲左右搖曳
        float lift = uBuoyancy * (0.4 + 1.2 * n1);
        float sway = uBuoyancy * (n2 - 0.5) * 0.9;
        vel += vec2(sway, lift) * density * uDt;
        gl_FragColor = vec4(vel, 0.0, 1.0);
    }
`;

const CLEAR_FRAGMENT = /* glsl */`
    uniform sampler2D uTexture;
    uniform float uValue;
    varying vec2 vUv;
    void main() {
        gl_FragColor = uValue * texture2D(uTexture, vUv);
    }
`;

const GRADIENT_SUBTRACT_FRAGMENT = /* glsl */`
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    uniform vec2 uTexelSize;
    varying vec2 vUv;
    void main() {
        float L = texture2D(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;
        float R = texture2D(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;
        float B = texture2D(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;
        float T = texture2D(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        vel -= 0.5 * vec2(R - L, T - B);
        gl_FragColor = vec4(vel, 0.0, 1.0);
    }
`;

const BRIGHT_PASS_FRAGMENT = /* glsl */`
    uniform sampler2D uTexture;
    uniform float uThreshold;
    varying vec2 vUv;
    void main() {
        vec3 c = texture2D(uTexture, vUv).rgb;
        float br = max(c.r, max(c.g, c.b));
        float soft = clamp(br - uThreshold, 0.0, 1.0);
        gl_FragColor = vec4(c * soft, 1.0);
    }
`;

const BLUR_FRAGMENT = /* glsl */`
    uniform sampler2D uTexture;
    uniform vec2 uTexelSize;
    uniform vec2 uDirection;
    varying vec2 vUv;
    void main() {
        vec2 off1 = uDirection * uTexelSize * 1.3846;
        vec2 off2 = uDirection * uTexelSize * 3.2308;
        vec3 c = texture2D(uTexture, vUv).rgb * 0.2270270270;
        c += texture2D(uTexture, vUv + off1).rgb * 0.3162162162;
        c += texture2D(uTexture, vUv - off1).rgb * 0.3162162162;
        c += texture2D(uTexture, vUv + off2).rgb * 0.0702702703;
        c += texture2D(uTexture, vUv - off2).rgb * 0.0702702703;
        gl_FragColor = vec4(c, 1.0);
    }
`;

const DISPLAY_FRAGMENT = /* glsl */`
    uniform sampler2D uDye;
    uniform sampler2D uBloom;
    uniform float uBloomIntensity;
    uniform float uExposure;
    varying vec2 vUv;
    void main() {
        vec3 c = texture2D(uDye, vUv).rgb;
        vec3 bloom = texture2D(uBloom, vUv).rgb * uBloomIntensity;
        vec3 color = 1.0 - exp(-(c + bloom) * uExposure);
        float alpha = clamp(max(color.r, max(color.g, color.b)) * 1.2, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
    }
`;

function createRenderTarget(width, height) {
    return new THREE.WebGLRenderTarget(width, height, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false
    });
}

function createDoubleFBO(width, height) {
    let read = createRenderTarget(width, height);
    let write = createRenderTarget(width, height);
    return {
        get read() { return read; },
        get write() { return write; },
        swap() {
            const tmp = read;
            read = write;
            write = tmp;
        },
        dispose() {
            read.dispose();
            write.dispose();
        }
    };
}

export function createFluidInkSystem({ scene, camera, renderer, planeZ = -1.5, renderOrder = 1 }) {
    const passScene = new THREE.Scene();
    const passCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    passCamera.position.z = 1;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    passScene.add(quad);

    function createPassMaterial(fragmentShader, uniforms) {
        return new THREE.ShaderMaterial({
            vertexShader: BASE_VERTEX,
            fragmentShader,
            uniforms,
            depthTest: false,
            depthWrite: false
        });
    }

    const splatMaterial = createPassMaterial(SPLAT_FRAGMENT, {
        uTarget: { value: null },
        uAspect: { value: 1 },
        uPoint: { value: new THREE.Vector2() },
        uValue: { value: new THREE.Vector3() },
        uRadius: { value: 0.01 }
    });
    const advectionMaterial = createPassMaterial(ADVECTION_FRAGMENT, {
        uVelocity: { value: null },
        uSource: { value: null },
        uDt: { value: 0 },
        uDissipation: { value: 1 }
    });
    const divergenceMaterial = createPassMaterial(DIVERGENCE_FRAGMENT, {
        uVelocity: { value: null },
        uTexelSize: { value: new THREE.Vector2() }
    });
    const curlMaterial = createPassMaterial(CURL_FRAGMENT, {
        uVelocity: { value: null },
        uTexelSize: { value: new THREE.Vector2() }
    });
    const vorticityMaterial = createPassMaterial(VORTICITY_FRAGMENT, {
        uVelocity: { value: null },
        uCurl: { value: null },
        uTexelSize: { value: new THREE.Vector2() },
        uCurlStrength: { value: CURL_STRENGTH },
        uDt: { value: 0 }
    });
    const pressureMaterial = createPassMaterial(PRESSURE_FRAGMENT, {
        uPressure: { value: null },
        uDivergence: { value: null },
        uTexelSize: { value: new THREE.Vector2() }
    });
    const buoyancyMaterial = createPassMaterial(BUOYANCY_FRAGMENT, {
        uVelocity: { value: null },
        uDye: { value: null },
        uBuoyancy: { value: BUOYANCY },
        uDt: { value: 0 },
        uTime: { value: 0 }
    });
    const clearMaterial = createPassMaterial(CLEAR_FRAGMENT, {
        uTexture: { value: null },
        uValue: { value: PRESSURE_WARM_START }
    });
    const gradientSubtractMaterial = createPassMaterial(GRADIENT_SUBTRACT_FRAGMENT, {
        uPressure: { value: null },
        uVelocity: { value: null },
        uTexelSize: { value: new THREE.Vector2() }
    });
    const brightPassMaterial = createPassMaterial(BRIGHT_PASS_FRAGMENT, {
        uTexture: { value: null },
        uThreshold: { value: BLOOM_THRESHOLD }
    });
    const blurMaterial = createPassMaterial(BLUR_FRAGMENT, {
        uTexture: { value: null },
        uTexelSize: { value: new THREE.Vector2() },
        uDirection: { value: new THREE.Vector2() }
    });

    function runPass(material, target) {
        quad.material = material;
        renderer.setRenderTarget(target);
        renderer.render(passScene, passCamera);
    }

    const displayMaterial = new THREE.ShaderMaterial({
        vertexShader: BASE_VERTEX,
        fragmentShader: DISPLAY_FRAGMENT,
        uniforms: {
            uDye: { value: null },
            uBloom: { value: null },
            uBloomIntensity: { value: BLOOM_INTENSITY },
            uExposure: { value: EXPOSURE }
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), displayMaterial);
    mesh.position.set(0, 0, planeZ);
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);

    let simWidth = 0;
    let simHeight = 0;
    let bloomWidth = 0;
    let bloomHeight = 0;
    let viewWidth = 0;
    let viewHeight = 0;
    let aspect = 1;

    let velocityFBO = null;
    let pressureFBO = null;
    let dyeFBO = null;
    let divergenceRT = null;
    let curlRT = null;
    let bloomBrightRT = null;
    let bloomBlurFBO = null;

    // key(`${source}:${midi}`) → 按住期間持續注入的墨水流
    const heldNotes = new Map();
    // 按下瞬間的噴射：拉長成短時間的連續注入，形成「頭部 + 尾柱」的墨柱
    const activeBursts = [];
    const BURST_DURATION = 0.55;
    let simTime = 0;
    let ready = false;
    const forceScratch = new THREE.Vector2();
    const colorScratch = new THREE.Vector3();

    function computeViewSize() {
        const winAspect = window.innerWidth / window.innerHeight;
        const fov = camera.fov * Math.PI / 180;
        const distance = camera.position.z - planeZ;
        viewHeight = 2 * Math.tan(fov / 2) * distance;
        viewWidth = viewHeight * winAspect;
        aspect = winAspect;
    }

    function disposeTargets() {
        velocityFBO?.dispose();
        pressureFBO?.dispose();
        dyeFBO?.dispose();
        divergenceRT?.dispose();
        curlRT?.dispose();
        bloomBrightRT?.dispose();
        bloomBlurFBO?.dispose();
    }

    function allocTargets() {
        computeViewSize();
        mesh.geometry.dispose();
        mesh.geometry = new THREE.PlaneGeometry(viewWidth, viewHeight);

        const gh = SIM_HEIGHT;
        const gw = Math.max(16, Math.round(gh * aspect));
        if (gw === simWidth && gh === simHeight) return;

        disposeTargets();

        simWidth = gw;
        simHeight = gh;
        const dyeHeight = DYE_HEIGHT;
        const dyeWidth = Math.max(16, Math.round(dyeHeight * aspect));
        bloomHeight = BLOOM_HEIGHT;
        bloomWidth = Math.max(8, Math.round(bloomHeight * aspect));

        velocityFBO = createDoubleFBO(simWidth, simHeight);
        pressureFBO = createDoubleFBO(simWidth, simHeight);
        dyeFBO = createDoubleFBO(dyeWidth, dyeHeight);
        divergenceRT = createRenderTarget(simWidth, simHeight);
        curlRT = createRenderTarget(simWidth, simHeight);
        bloomBrightRT = createRenderTarget(bloomWidth, bloomHeight);
        bloomBlurFBO = createDoubleFBO(bloomWidth, bloomHeight);

        ready = true;
    }

    function applySplat(point, force, colorValue, radius) {
        splatMaterial.uniforms.uAspect.value = aspect;
        splatMaterial.uniforms.uPoint.value.set(point.x, point.y);
        splatMaterial.uniforms.uRadius.value = radius;

        splatMaterial.uniforms.uTarget.value = velocityFBO.read.texture;
        splatMaterial.uniforms.uValue.value.set(force.x, force.y, 0);
        runPass(splatMaterial, velocityFBO.write);
        velocityFBO.swap();

        splatMaterial.uniforms.uTarget.value = dyeFBO.read.texture;
        splatMaterial.uniforms.uValue.value.set(colorValue.x, colorValue.y, colorValue.z);
        runPass(splatMaterial, dyeFBO.write);
        dyeFBO.swap();
    }

    // 世界座標（plane 上）→ 模擬 UV 座標（0..1）。
    // render target 的 UV 是 y 朝上（v=0 在畫面底部），跟世界座標同向，不需要翻轉。
    function worldToUv(x, y) {
        return {
            x: x / viewWidth + 0.5,
            y: y / viewHeight + 0.5
        };
    }

    function simulate(dtSeconds) {
        const dt = Math.min(dtSeconds, 1 / 30);
        const texelSize = new THREE.Vector2(1 / simWidth, 1 / simHeight);

        buoyancyMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        buoyancyMaterial.uniforms.uDye.value = dyeFBO.read.texture;
        buoyancyMaterial.uniforms.uDt.value = dt;
        buoyancyMaterial.uniforms.uTime.value = simTime;
        runPass(buoyancyMaterial, velocityFBO.write);
        velocityFBO.swap();

        curlMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        curlMaterial.uniforms.uTexelSize.value.copy(texelSize);
        runPass(curlMaterial, curlRT);

        vorticityMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        vorticityMaterial.uniforms.uCurl.value = curlRT.texture;
        vorticityMaterial.uniforms.uTexelSize.value.copy(texelSize);
        vorticityMaterial.uniforms.uDt.value = dt;
        runPass(vorticityMaterial, velocityFBO.write);
        velocityFBO.swap();

        divergenceMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        divergenceMaterial.uniforms.uTexelSize.value.copy(texelSize);
        runPass(divergenceMaterial, divergenceRT);

        clearMaterial.uniforms.uTexture.value = pressureFBO.read.texture;
        clearMaterial.uniforms.uValue.value = PRESSURE_WARM_START;
        runPass(clearMaterial, pressureFBO.write);
        pressureFBO.swap();

        pressureMaterial.uniforms.uDivergence.value = divergenceRT.texture;
        pressureMaterial.uniforms.uTexelSize.value.copy(texelSize);
        for (let i = 0; i < PRESSURE_ITERATIONS; i++) {
            pressureMaterial.uniforms.uPressure.value = pressureFBO.read.texture;
            runPass(pressureMaterial, pressureFBO.write);
            pressureFBO.swap();
        }

        gradientSubtractMaterial.uniforms.uPressure.value = pressureFBO.read.texture;
        gradientSubtractMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        gradientSubtractMaterial.uniforms.uTexelSize.value.copy(texelSize);
        runPass(gradientSubtractMaterial, velocityFBO.write);
        velocityFBO.swap();

        const velocityDecay = Math.pow(0.5, dtSeconds / VELOCITY_HALF_LIFE);
        advectionMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        advectionMaterial.uniforms.uSource.value = velocityFBO.read.texture;
        advectionMaterial.uniforms.uDt.value = dt;
        advectionMaterial.uniforms.uDissipation.value = velocityDecay;
        runPass(advectionMaterial, velocityFBO.write);
        velocityFBO.swap();

        const dyeDecay = Math.pow(0.5, dtSeconds / DYE_HALF_LIFE);
        advectionMaterial.uniforms.uVelocity.value = velocityFBO.read.texture;
        advectionMaterial.uniforms.uSource.value = dyeFBO.read.texture;
        advectionMaterial.uniforms.uDt.value = dt;
        advectionMaterial.uniforms.uDissipation.value = dyeDecay;
        runPass(advectionMaterial, dyeFBO.write);
        dyeFBO.swap();
    }

    function renderBloom() {
        brightPassMaterial.uniforms.uTexture.value = dyeFBO.read.texture;
        brightPassMaterial.uniforms.uThreshold.value = BLOOM_THRESHOLD;
        runPass(brightPassMaterial, bloomBrightRT);

        const texelSize = new THREE.Vector2(1 / bloomWidth, 1 / bloomHeight);

        blurMaterial.uniforms.uTexture.value = bloomBrightRT.texture;
        blurMaterial.uniforms.uTexelSize.value.copy(texelSize);
        blurMaterial.uniforms.uDirection.value.set(1, 0);
        runPass(blurMaterial, bloomBlurFBO.write);
        bloomBlurFBO.swap();

        blurMaterial.uniforms.uTexture.value = bloomBlurFBO.read.texture;
        blurMaterial.uniforms.uDirection.value.set(0, 1);
        runPass(blurMaterial, bloomBlurFBO.write);
        bloomBlurFBO.swap();
    }

    function noteOn(key, worldX, worldY, midi, intensity = 0.85, sustained = false) {
        if (!ready) return;
        const uv = worldToUv(worldX, worldY);
        const color = getEffectColor(midi);
        const note = {
            uv,
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
            uv,
            // 噴射點會隨時間往上爬（跟著墨柱頭部走），推力結束的高度才會捲出蘑菇雲
            climb: 0,
            // 側向擺動參數：每發不同相位/頻率，柱身才不會是死直一條線
            wigglePhase: Math.random() * Math.PI * 2,
            wiggleFreq: 9 + Math.random() * 5,
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
        if (!ready) return;

        const prevTarget = renderer.getRenderTarget();
        [velocityFBO, pressureFBO, dyeFBO].forEach((fbo) => {
            renderer.setRenderTarget(fbo.read);
            renderer.clearColor();
            renderer.setRenderTarget(fbo.write);
            renderer.clearColor();
        });
        renderer.setRenderTarget(prevTarget);
    }

    function update(deltaSeconds) {
        if (!mesh.visible || !ready) return;
        simTime += deltaSeconds;

        // 噴射柱：注入點沿路徑連續補點（不會逐幀跳格斷線），
        // 口徑尾細頭粗、帶隨機側向擺動，形成一條有機的錐形墨柱
        for (let i = activeBursts.length - 1; i >= 0; i--) {
            const burst = activeBursts[i];
            // 頭部衝力最強，往尾端漸弱
            const falloff = burst.remaining / BURST_DURATION;
            const thrust = (0.22 + 0.78 * falloff) * burst.power;

            const prevClimb = burst.climb;
            const nextClimb = prevClimb + thrust * deltaSeconds * 0.95;
            // 一幀的爬升距離切成小段補點，段距約半個噴口寬
            const steps = Math.max(1, Math.ceil((nextClimb - prevClimb) / 0.006));

            // 噴射整體進度 0（剛點火，畫細尾）→ 1（尾聲，畫粗頭）
            const progress = 1 - falloff;

            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                const climb = prevClimb + (nextClimb - prevClimb) * t;
                const radius = 0.00005 + 0.00003 * progress * progress;
                const dye = (1.1 * burst.power * (0.55 + 0.45 * falloff)) / steps;
                const wiggle = Math.sin(climb * burst.wiggleFreq * 40 + burst.wigglePhase) * 0.008 * progress;

                forceScratch.set(wiggle * 6, thrust);
                colorScratch.set(burst.r * dye, burst.g * dye, burst.b * dye);
                applySplat(
                    { x: burst.uv.x + wiggle, y: burst.uv.y - 0.01 + climb },
                    forceScratch,
                    colorScratch,
                    radius
                );
            }

            burst.climb = nextClimb;
            burst.remaining -= deltaSeconds;
            if (burst.remaining <= 0) {
                activeBursts.splice(i, 1);
            }
        }

        // 按住的音持續注入細墨流，左右輕微擺動讓煙柱更自然
        const holdRadius = 0.00045;
        for (const note of heldNotes.values()) {
            const wobble = Math.sin(simTime * 3 + note.phase) * 0.04;
            forceScratch.set(wobble, 0.1);
            colorScratch.set(note.r * 0.4, note.g * 0.4, note.b * 0.4);
            applySplat(
                { x: note.uv.x, y: note.uv.y - 0.008 },
                forceScratch,
                colorScratch,
                holdRadius
            );
        }

        simulate(deltaSeconds);
        renderBloom();
        renderer.setRenderTarget(null);

        // read/write 每步都會 swap，material 要重新指向「這一幀」的最新結果貼圖
        displayMaterial.uniforms.uDye.value = dyeFBO.read.texture;
        displayMaterial.uniforms.uBloom.value = bloomBlurFBO.read.texture;
    }

    function setVisible(visible) {
        mesh.visible = visible;
    }

    function handleResize() {
        allocTargets();
    }

    allocTargets();

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
