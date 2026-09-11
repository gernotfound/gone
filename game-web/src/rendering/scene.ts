import * as THREE from 'three';
import { DOM } from '../ui/menu.ts';

const CHUNK_SIZE = 400;
const CHUNK_RADIUS = 2;

export class SceneManager {
    public scene!: THREE.Scene;
    public camera!: THREE.PerspectiveCamera;
    public renderer!: THREE.WebGLRenderer;
    public terrainMaterial!: THREE.MeshStandardMaterial;
    public rockGeo!: THREE.DodecahedronGeometry;
    public rockMat!: THREE.MeshStandardMaterial;
    public rayGeo!: THREE.CylinderGeometry;
    public rayMat!: THREE.MeshBasicMaterial;

    private isInitialized = false;

    public init() {
        if (this.isInitialized) return;
        this.scene = new THREE.Scene();

        const fogColor = 0x1e293b;
        this.scene.background = new THREE.Color(fogColor);

        const fogNear = CHUNK_SIZE * (CHUNK_RADIUS - 1.6);
        const fogFar = CHUNK_SIZE * (CHUNK_RADIUS - 0.7);
        this.scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

        this.rayGeo = new THREE.CylinderGeometry(0, 45, 800, 12, 1, true);
        this.rayGeo.translate(0, 400, 0);
        this.rayMat = new THREE.MeshBasicMaterial({
            color: 0xfef08a,
            transparent: true,
            opacity: 0.03,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: true
        });

        this.rayMat.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                `#include <fog_fragment>`,
                `
                #ifdef USE_FOG
                    #ifdef FOG_EXP2
                        float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
                    #else
                        float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
                    #endif
                    gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3(0.0), fogFactor );
                #endif
                `
            );
        };

        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 3000);

        // Prioritize stable frame pacing over expensive desktop-style rendering.
        // At devicePixelRatio 2 the old path rendered 4x as many pixels and also
        // performed a full 2048² shadow pass, which was a major cost on laptops.
        this.renderer = new THREE.WebGLRenderer({
            canvas: DOM.gameCanvas,
            antialias: false,
            alpha: false,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
        this.renderer.shadowMap.enabled = false;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        const hemiLight = new THREE.HemisphereLight(0x0f172a, 0x020617, 1.5);
        this.scene.add(hemiLight);

        const sunLight = new THREE.DirectionalLight(0x38bdf8, 1.2);
        sunLight.position.set(200, 300, -100);
        sunLight.castShadow = false;
        this.scene.add(sunLight);

        this.terrainMaterial = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.9,
            metalness: 0.1,
            vertexColors: true
        });

        this.rockGeo = new THREE.DodecahedronGeometry(1, 0);
        this.rockMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.9,
            metalness: 0.1
        });

        this.isInitialized = true;
    }

    public resize(width: number, height: number) {
        if (!this.isInitialized) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    public dispose() {
        if (!this.isInitialized) return;

        this.terrainMaterial.dispose();
        this.rockGeo.dispose();
        this.rockMat.dispose();
        this.rayGeo.dispose();
        this.rayMat.dispose();

        this.renderer.dispose();
        this.isInitialized = false;
    }

    public disposeHierarchy(object: THREE.Object3D) {
        object.traverse((child: any) => {
            if (child.userData?.sharedAsset) return;
            if (child.isMesh || child.isInstancedMesh) {
                if (child.geometry && !child.geometry.userData?.sharedAsset) {
                    child.geometry.dispose();
                }
                if (child.material) {
                    const disposeMat = (mat: THREE.Material) => {
                        if (!mat.userData?.sharedAsset) mat.dispose();
                    };
                    if (Array.isArray(child.material)) {
                        child.material.forEach(disposeMat);
                    } else {
                        disposeMat(child.material);
                    }
                }
            }
        });
    }
}

export const sceneManager = new SceneManager();
