import * as THREE from 'three';

export function createVisualMaterials({ bgTex, mistTex, sparkTex }) {
    const bgUniforms = {
        uTime: { value: 0 },
        uTex: { value: bgTex },
        uImpacts: { value: Array.from({ length: 20 }, () => new THREE.Vector3(100, 100, 0)) },
        uImpactTimes: { value: Array(20).fill(-100) }
    };

    const bgMaterial = new THREE.ShaderMaterial({
        uniforms: bgUniforms,
        vertexShader: `
            uniform float uTime;
            uniform vec3 uImpacts[20];
            uniform float uImpactTimes[20];
            attribute float aType;
            varying float vGlow;
            varying float vType;

            void main() {
                vType = aType;

                float totalOsc = 0.0;
                float brightEffect = 0.0;
                float maxRad = 8.0;

                for (int i = 0; i < 20; i++) {
                    float d = distance(position.xy, uImpacts[i].xy);
                    float e = uTime - uImpactTimes[i];

                    if (e > 0.0 && e < 4.0) {
                        float waveR = maxRad * smoothstep(0.0, 1.5, e);
                        float dec = exp(-e * 1.8) * exp(-d * 0.1);
                        float rip = sin(d * 3.5 - e * 15.0);
                        float m = smoothstep(2.5, 0.0, abs(d - waveR));

                        totalOsc += rip * m * dec;
                        brightEffect += m * dec * 1.0;
                    }
                }

                vGlow = max(0.0, brightEffect + max(0.0, totalOsc * 1.35)) * 0.9;

                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = 1.18 * (1.0 + totalOsc * 1.2) * (350.0 / -mvPos.z);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D uTex;
            varying float vGlow;
            varying float vType;

            void main() {
                vec2 uv = gl_PointCoord;
                uv.x = (uv.x + floor(vType)) / 4.0;
                vec4 tex = texture2D(uTex, uv);
                gl_FragColor = vec4(tex.rgb * vGlow, tex.a * vGlow * 0.25);
            }
        `,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false
    });

    const pianoRollJetMaterial = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: mistTex } },
        vertexShader: `
            attribute float aSize;
            attribute float aAlpha;
            attribute vec3 aColor;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vAlpha = aAlpha;
                vColor = aColor;
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (0.45 + aAlpha * 0.9) * (350.0 / -mvPos.z);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D uTex;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vec4 tex = texture2D(uTex, gl_PointCoord);
                gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const sparkMaterial = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: sparkTex } },
        vertexShader: `
            attribute float aSize;
            attribute float aAlpha;
            attribute float aType;
            attribute float aRotX;
            attribute float aRotY;
            attribute float aRotZ;

            varying float vAlpha;
            varying float vType;
            varying float vRotX;
            varying float vRotY;
            varying float vRotZ;

            void main() {
                vAlpha = aAlpha;
                vType = aType;
                vRotX = aRotX;
                vRotY = aRotY;
                vRotZ = aRotZ;

                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (0.3 + 0.7 * aAlpha) * (350.0 / -mvPos.z);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D uTex;

            varying float vAlpha;
            varying float vType;
            varying float vRotX;
            varying float vRotY;
            varying float vRotZ;

            void main() {
                vec2 uv = gl_PointCoord - vec2(0.5);

                float cY = cos(vRotY);
                float cX = cos(vRotX);
                float sZ = sin(vRotZ);
                float cZ = cos(vRotZ);

                vec2 rotUV = vec2(
                    uv.x * cZ - uv.y * sZ,
                    uv.x * sZ + uv.y * cZ
                );

                vec2 rUV = rotUV;
                rUV.x /= (abs(cY) < 0.15 ? 0.15 : cY);
                rUV.y /= (abs(cX) < 0.15 ? 0.15 : cX);

                if (abs(rUV.x) > 0.5 || abs(rUV.y) > 0.5) discard;

                vec2 finalUV = rUV + 0.5;
                finalUV.x = (finalUV.x + floor(vType + 0.5)) / 4.0;

                vec4 texColor = texture2D(uTex, finalUV);
                gl_FragColor = vec4(texColor.rgb, texColor.a * vAlpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    const mistMaterial = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: mistTex } },
        vertexShader: `
            attribute float aSize;
            attribute float aAlpha;
            attribute vec3 aColor;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vAlpha = aAlpha;
                vColor = aColor;
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = aSize * (350.0 / -mvPos.z);
                gl_Position = projectionMatrix * mvPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D uTex;
            varying float vAlpha;
            varying vec3 vColor;

            void main() {
                vec4 tex = texture2D(uTex, gl_PointCoord);
                gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    return {
        bgUniforms,
        bgMaterial,
        pianoRollJetMaterial,
        sparkMaterial,
        mistMaterial
    };
}
