import * as THREE from 'three';
import type { Node, TextureNode, UniformNode } from 'three/webgpu';
import {
  If,
  clamp,
  float,
  max,
  min,
  renderGroup,
  type ShaderNodeObject,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Selective HDR bloom in TSL (Three.js Shading Language) for WebGPU:
 * A soft-knee luminance threshold prefilter (`BLOOM_THRESHOLD = 4.0`, `BLOOM_KNEE = 1.8`)
 * followed by a fast 5-tap tent/Kawase filter kernel in screen UV space.
 * Only pixels well above the threshold — emissive bulb cores (~10–20), LED diffusers, halos —
 * contribute, so lit white walls (< 3) do not glow.
 */

/** Pre-exposure HDR luminance where bloom starts (emissive cores are ~10–20, lit walls < 3). */
export const BLOOM_THRESHOLD = 4.0;
export const BLOOM_KNEE = 1.8;

export class BloomPass {
  public readonly uTexelSize: ShaderNodeObject<UniformNode<THREE.Vector2>>;
  public readonly uThreshold: ShaderNodeObject<UniformNode<number>>;
  public readonly uKnee: ShaderNodeObject<UniformNode<number>>;
  public readonly uIntensity: ShaderNodeObject<UniformNode<number>>;
  private width = 0;
  private height = 0;

  public constructor() {
    this.uTexelSize = uniform(new THREE.Vector2(1 / 1920, 1 / 1080)).setGroup(renderGroup);
    this.uThreshold = uniform(BLOOM_THRESHOLD).setGroup(renderGroup);
    this.uKnee = uniform(BLOOM_KNEE).setGroup(renderGroup);
    this.uIntensity = uniform(0.0).setGroup(renderGroup);
  }

  public setSize(fullWidth: number, fullHeight: number): void {
    const w = Math.max(1, Math.floor(fullWidth));
    const h = Math.max(1, Math.floor(fullHeight));
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.uTexelSize.value.set(1 / w, 1 / h);
  }

  public setIntensity(intensity: number): void {
    this.uIntensity.value = Math.max(0, intensity);
  }

  /**
   * Soft-knee HDR luminance threshold prefilter with firefly clamp (`<= 64.0`).
   */
  private prefilter(c: ShaderNodeObject<Node>): ShaderNodeObject<Node> {
    const lum = max(c.r, max(c.g, c.b));
    const soft = clamp(
      lum.sub(this.uThreshold).add(this.uKnee),
      0.0,
      this.uKnee.mul(2.0)
    );
    const softCurve = soft.mul(soft).div(this.uKnee.mul(4.0).add(1e-5));
    const contribution = max(softCurve, lum.sub(this.uThreshold)).div(max(lum, 1e-5));
    return min(c.mul(contribution), vec3(64.0));
  }

  /**
   * Builds the TSL node that evaluates a fast 5-tap warm architectural bloom at `uvNode`.
   */
  public buildNode(
    colorNode: ShaderNodeObject<TextureNode>,
    uvNode: ShaderNodeObject<Node>
  ): ShaderNodeObject<Node> {
    const bloomOut = vec3(0.0).toVar();

    const samplePrefiltered = (offsetTexelsX: number, offsetTexelsY: number): ShaderNodeObject<Node> => {
      const sampleUv = clamp(
        uvNode.add(this.uTexelSize.mul(vec2(offsetTexelsX, offsetTexelsY))),
        0.001,
        0.999
      );
      return this.prefilter(
        (colorNode.sample(sampleUv) as unknown as ShaderNodeObject<TextureNode>).level(float(0)).rgb
      );
    };

    If(this.uIntensity.greaterThan(0.001), () => {
      const center = samplePrefiltered(0.0, 0.0);
      const diag = samplePrefiltered(-3.5, -3.5)
        .add(samplePrefiltered(3.5, -3.5))
        .add(samplePrefiltered(-3.5, 3.5))
        .add(samplePrefiltered(3.5, 3.5))
        .mul(0.25);

      const combined = center.mul(0.36).add(diag.mul(0.64));
      bloomOut.assign(combined.mul(this.uIntensity));
    });

    return float(1.0).mul(bloomOut);
  }

  public dispose(): void {
    // TSL nodes are managed by the WebGPU PostProcessing pipeline
  }
}
